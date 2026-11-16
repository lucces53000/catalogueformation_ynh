const fs = require("node:fs");
const path = require("node:path");

const PUBLIC_COLLECTIONS = new Set([
  "trainings",
  "announcements",
  "trainingCategories",
  "trainingLocations",
  "trainingContacts",
  "importantInformation",
  "importantInformationCategories"
]);
const ADMIN_COLLECTIONS = new Set([...PUBLIC_COLLECTIONS, "siteSettings", "catalogVersions", "catalogReviewLinks", "catalogArchives"]);
const AGENT_COLLECTIONS = new Set(["agentCalendars", "agentCalendarSync", "agentOccupations"]);

function createStore(storePath) {
  fs.mkdirSync(path.dirname(storePath), { recursive: true, mode: 0o700 });
  let state = fs.existsSync(storePath)
    ? JSON.parse(fs.readFileSync(storePath, "utf8"))
    : { formatVersion: 1, documents: [] };
  if (state.formatVersion !== 1 || !Array.isArray(state.documents)) {
    throw new Error("Format de la base Yunohost inconnu.");
  }

  const persist = () => {
    const temporaryPath = `${storePath}.${process.pid}.tmp`;
    fs.writeFileSync(temporaryPath, `${JSON.stringify(state)}\n`, { mode: 0o600 });
    fs.renameSync(temporaryPath, storePath);
  };
  const get = (documentPath) => state.documents.find((document) => document.path === documentPath)?.data ?? null;
  const list = (collectionPath) => state.documents
    .filter((document) => document.path.startsWith(`${collectionPath}/`) && document.path.split("/").length === collectionPath.split("/").length + 1)
    .map((document) => ({ id: document.path.split("/").at(-1), path: document.path, ...structuredClone(document.data) }));
  const set = (documentPath, data) => {
    const index = state.documents.findIndex((document) => document.path === documentPath);
    const document = { path: documentPath, data: structuredClone(data) };
    if (index < 0) state.documents.push(document);
    else state.documents[index] = document;
    persist();
  };
  const remove = (documentPath) => {
    state.documents = state.documents.filter((document) => document.path !== documentPath);
    persist();
  };
  const batch = (operations) => {
    if (!Array.isArray(operations) || operations.length > 450) throw new Error("Lot d'écriture invalide.");
    const nextDocuments = structuredClone(state.documents);
    for (const operation of operations) {
      if (!operation || typeof operation.path !== "string" || !/^[A-Za-z][A-Za-z0-9_-]*\/(?:[^/]+\/)*[^/]+$/.test(operation.path) || operation.path.split("/").length % 2 !== 0) {
        throw new Error("Chemin de document invalide.");
      }
      if (operation.delete === true) {
        const index = nextDocuments.findIndex((item) => item.path === operation.path);
        if (index >= 0) nextDocuments.splice(index, 1);
      } else if (operation.data && typeof operation.data === "object" && !Array.isArray(operation.data)) {
        const index = nextDocuments.findIndex((item) => item.path === operation.path);
        const document = { path: operation.path, data: structuredClone(operation.data) };
        if (index < 0) nextDocuments.push(document);
        else nextDocuments[index] = document;
      } else throw new Error("Données de document invalides.");
    }
    state.documents = nextDocuments;
    persist();
  };
  return {
    get,
    list,
    set,
    remove,
    batch,
    get setting() { return get("siteSettings/public") || { maintenance: false }; },
    publicList(collection) {
      if (!PUBLIC_COLLECTIONS.has(collection)) throw Object.assign(new Error("Collection publique inconnue."), { status: 404 });
      return list(collection).filter((item) => item.published !== false);
    },
    adminList(collectionPath) {
      const root = collectionPath.split("/")[0];
      if (!ADMIN_COLLECTIONS.has(root) || collectionPath.split("/").length % 2 !== 1) throw Object.assign(new Error("Collection d'administration inconnue."), { status: 404 });
      return list(collectionPath);
    },
    agentList(collectionPath) {
      const root = collectionPath.split("/")[0];
      if (!AGENT_COLLECTIONS.has(root) || collectionPath.split("/").length % 2 !== 1) throw Object.assign(new Error("Collection agent inconnue."), { status: 404 });
      return list(collectionPath);
    },
    all() { return structuredClone(state.documents); }
  };
}

module.exports = { ADMIN_COLLECTIONS, AGENT_COLLECTIONS, PUBLIC_COLLECTIONS, createStore };
