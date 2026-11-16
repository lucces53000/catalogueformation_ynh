const fs = require("node:fs");
const http = require("node:http");
const path = require("node:path");
const { sendToTopic } = require("./fcm");
const { createStore, ADMIN_COLLECTIONS, AGENT_COLLECTIONS } = require("./store");
const ROOT = path.resolve(process.env.APP_ROOT || path.join(__dirname, "..", "src"));
const DATA_DIR = path.resolve(process.env.DATA_DIR || path.join(__dirname, "..", "data"));
const PORT = Number(process.env.PORT || 3017);
const store = createStore(path.join(DATA_DIR, "firestore.json"));
const MIME = { ".css": "text/css; charset=utf-8", ".html": "text/html; charset=utf-8", ".ico": "image/x-icon", ".ics": "text/calendar; charset=utf-8", ".js": "text/javascript; charset=utf-8", ".json": "application/json; charset=utf-8", ".png": "image/png", ".svg": "image/svg+xml", ".webmanifest": "application/manifest+json; charset=utf-8" };
function response(res, status, body) { res.writeHead(status, { "Cache-Control": "no-store", "Content-Type": "application/json; charset=utf-8" }); res.end(JSON.stringify(body)); }
function identity(req) { const value = req.headers.ynh_user || ""; return /^[a-zA-Z0-9_.@-]{1,128}$/.test(value) ? value : ""; }
function requireUser(req) { const user = identity(req); if (!user) throw Object.assign(new Error("Connexion Yunohost requise."), { status: 401 }); return user; }
function requirePermission(req, permission) {
  const user = requireUser(req);
  const marker = permission === "admin" ? req.headers["x-yunohost-permission-admin"] : req.headers["x-yunohost-permission-agents"];
  if (marker !== "1") throw Object.assign(new Error("Permission Yunohost insuffisante."), { status: 403 });
  return user;
}
function validateDocumentPath(value, allowed) {
  if (typeof value !== "string" || !/^[A-Za-z][A-Za-z0-9_-]*(?:\/[^/]+)+$/.test(value) || value.split("/").length % 2 !== 0) throw Object.assign(new Error("Chemin Firestore invalide."), { status: 400 });
  if (!allowed.has(value.split("/")[0])) throw Object.assign(new Error("Collection non autorisée."), { status: 403 });
  return value;
}
async function readBody(req) {
  let bytes = 0; const chunks = [];
  for await (const chunk of req) { bytes += chunk.length; if (bytes > 1_000_000) throw Object.assign(new Error("Requête trop volumineuse."), { status: 413 }); chunks.push(chunk); }
  if (!chunks.length) return {};
  try { return JSON.parse(Buffer.concat(chunks).toString("utf8")); } catch { throw Object.assign(new Error("Le corps doit être un JSON valide."), { status: 400 }); }
}
function staticFile(req, res, pathname) {
  if (!new Set(["GET", "HEAD"]).has(req.method)) return response(res, 405, { error: "Méthode non autorisée." });
  let file = path.resolve(ROOT, `.${decodeURIComponent(pathname)}`);
  if (file !== ROOT && !file.startsWith(`${ROOT}${path.sep}`)) return response(res, 403, { error: "Accès refusé." });
  if (!fs.existsSync(file) || !fs.statSync(file).isFile()) { if (pathname === "/" || pathname.endsWith("/")) file = path.join(ROOT, "index.html"); else return response(res, 404, { error: "Page introuvable." }); }
  res.writeHead(200, { "Content-Type": MIME[path.extname(file).toLowerCase()] || "application/octet-stream", "Cache-Control": path.extname(file) === ".html" ? "no-store" : "public, max-age=300", "X-Content-Type-Options": "nosniff" });
  if (req.method === "HEAD") return res.end();
  fs.createReadStream(file).pipe(res);
}

async function handleApi(req, res, url) {
  const route = url.pathname.split("/").filter(Boolean).slice(1);
  const method = req.method;
  if (route[0] === "public") {
    if (route[1] === "settings" && method === "GET") return response(res, 200, { document: store.get("siteSettings/public") || { maintenance: false } });
    if (route[1] === "collections" && method === "GET") return response(res, 200, { documents: store.publicList(route[2] || "") });
    if (route[1] === "documents" && method === "GET") { const target = validateDocumentPath(decodeURIComponent(route.slice(2).join("/")), new Set(["trainings", "announcements", "trainingCategories", "trainingLocations", "trainingContacts", "importantInformation", "importantInformationCategories"])); return response(res, 200, { document: store.get(target) }); }
    return response(res, 404, { error: "Route publique introuvable." });
  }
  if (route[0] === "admin") {
    const user = requirePermission(req, "admin");
    if (route[1] === "session" && method === "GET") return response(res, 200, { user });
    if (route[1] === "collections" && method === "GET") return response(res, 200, { documents: store.adminList(route.slice(2).join("/")) });
    if (route[1] === "documents") {
      const target = validateDocumentPath(decodeURIComponent(route.slice(2).join("/")), ADMIN_COLLECTIONS);
      if (method === "GET") return response(res, 200, { document: store.get(target) });
      if (["PUT", "POST", "PATCH"].includes(method)) { const data = await readBody(req); if (!data || typeof data !== "object" || Array.isArray(data)) throw Object.assign(new Error("Document invalide."), { status: 400 }); store.set(target, data); return response(res, 200, { document: data, updatedBy: user }); }
      if (method === "DELETE") { store.remove(target); return response(res, 200, { deleted: true }); }
    }
    if (route[1] === "batch" && method === "POST") { const body = await readBody(req); if (!Array.isArray(body.operations) || body.operations.length > 400) throw Object.assign(new Error("Lot invalide."), { status: 400 }); store.batch(body.operations.map((item) => ({ ...item, path: validateDocumentPath(item.path, ADMIN_COLLECTIONS) }))); return response(res, 200, { committed: body.operations.length }); }
    if (route[1] === "notification" && method === "POST") return response(res, 200, await sendToTopic(await readBody(req)));
    return response(res, 404, { error: "Route d'administration introuvable." });
  }
  if (route[0] === "agents") {
    const user = requirePermission(req, "agents");
    if (route[1] === "session" && method === "GET") return response(res, 200, { user });
    if (route[1] === "collections" && method === "GET") return response(res, 200, { documents: store.agentList(route.slice(2).join("/")) });
    if (route[1] === "documents") {
      const target = validateDocumentPath(decodeURIComponent(route.slice(2).join("/")), AGENT_COLLECTIONS);
      if (method === "GET") return response(res, 200, { document: store.get(target) });
      if (["PUT", "POST", "PATCH"].includes(method)) { const data = await readBody(req); if (!data || typeof data !== "object" || Array.isArray(data)) throw Object.assign(new Error("Document invalide."), { status: 400 }); store.set(target, data); return response(res, 200, { document: data, updatedBy: user }); }
      if (method === "DELETE") { store.remove(target); return response(res, 200, { deleted: true }); }
    }
    if (route[1] === "batch" && method === "POST") { const body = await readBody(req); if (!Array.isArray(body.operations) || body.operations.length > 400) throw Object.assign(new Error("Lot agents invalide."), { status: 400 }); store.batch(body.operations.map((item) => ({ ...item, path: validateDocumentPath(item.path, AGENT_COLLECTIONS) }))); return response(res, 200, { committed: body.operations.length }); }
    return response(res, 404, { error: "Route agents introuvable." });
  }
  if (route[0] === "health" && method === "GET") return response(res, 200, { status: "ok" });
  return response(res, 404, { error: "API introuvable." });
}
function createServer() {
  return http.createServer(async (req, res) => {
    try {
      const url = new URL(req.url, `http://${req.headers.host || "localhost"}`);
      if (url.pathname.startsWith("/api/")) return await handleApi(req, res, url);
      if (["/admin.html", "/admin-versions.html"].includes(url.pathname)) requirePermission(req, "admin");
      if (url.pathname === "/agent-calendar.html") requirePermission(req, "agents");
      return staticFile(req, res, url.pathname);
    } catch (error) { return response(res, Number(error.status) || 500, { error: error.message || "Erreur interne." }); }
  });
}
if (require.main === module) {
  if (!Number.isInteger(PORT) || PORT < 1024 || PORT > 65535) throw new Error("PORT invalide.");
  createServer().listen(PORT, "127.0.0.1", () => console.log(`Formation Yunohost écoute sur 127.0.0.1:${PORT}`));
}
module.exports = { createServer, handleApi, identity, validateDocumentPath };
