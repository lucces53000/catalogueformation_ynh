const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const http = require("node:http");
const { once } = require("node:events");
const { createStore } = require("../server/store");

function temporaryDirectory() {
  return fs.mkdtempSync(path.join(os.tmpdir(), "catalogueformation-ynh-"));
}

test("public collections exclude agent calendars and hidden trainings", () => {
  const directory = temporaryDirectory();
  try {
    const store = createStore(path.join(directory, "firestore.json"));
    store.set("trainings/public", { title: "Visible" });
    store.set("trainings/private", { title: "Masquée", published: false });
    store.set("agentCalendars/agent-1", { firstName: "Agent", icsUrl: "secret" });
    assert.deepEqual(store.publicList("trainings").map(({ id }) => id), ["public"]);
    assert.throws(() => store.publicList("agentCalendars"), { status: 404 });
  } finally { fs.rmSync(directory, { recursive: true, force: true }); }
});

test("validates document paths and commits batches atomically", () => {
  const directory = temporaryDirectory();
  try {
    const store = createStore(path.join(directory, "firestore.json"));
    store.set("trainings/A", { title: "Before" });
    assert.throws(() => store.batch([{ path: "trainings/B", data: { title: "After" } }, { path: "invalid", data: {} }]));
    assert.equal(store.get("trainings/B"), null);
    store.batch([{ path: "trainings/A", data: { title: "After" } }, { path: "trainings/B", data: { title: "Second" } }]);
    assert.equal(store.get("trainings/A").title, "After");
    assert.equal(store.get("trainings/B").title, "Second");
  } finally { fs.rmSync(directory, { recursive: true, force: true }); }
});

test("admin and agent API routes require the authenticated Yunohost identity", async (t) => {
  const directory = temporaryDirectory();
  process.env.DATA_DIR = directory;
  process.env.APP_ROOT = path.join(__dirname, "..", "src");
  const { createServer } = require("../server/index");
  const server = createServer().listen(0, "127.0.0.1");
  await once(server, "listening");
  t.after(() => { server.close(); fs.rmSync(directory, { recursive: true, force: true }); delete process.env.DATA_DIR; delete process.env.APP_ROOT; });
  const url = `http://127.0.0.1:${server.address().port}`;
  const request = (pathname, headers = {}) => new Promise((resolve, reject) => {
    http.get(`${url}${pathname}`, { headers }, (res) => {
      let text = ""; res.setEncoding("utf8"); res.on("data", (chunk) => { text += chunk; }); res.on("end", () => resolve({ status: res.statusCode, body: JSON.parse(text) }));
    }).on("error", reject);
  });
  assert.equal((await request("/api/admin/session")).status, 401);
  assert.equal((await request("/api/agents/session")).status, 401);
  assert.equal((await request("/api/public/collections/trainings")).status, 200);
  assert.equal((await request("/admin.html")).status, 401);
  assert.equal((await request("/agent-calendar.html")).status, 401);
  assert.equal((await request("/api/admin/session", { YNH_USER: "alice" })).status, 403);
  assert.equal((await request("/api/agents/session", { YNH_USER: "alice" })).status, 403);
  assert.equal((await request("/api/admin/session", { YNH_USER: "alice", "X-YunoHost-Permission-Agents": "1" })).status, 403);
  assert.equal((await request("/api/agents/session", { YNH_USER: "alice", "X-YunoHost-Permission-Admin": "1" })).status, 403);
  assert.equal((await request("/api/admin/session", { YNH_USER: "alice", "X-YunoHost-Permission-Admin": "1" })).status, 200);
  assert.equal((await request("/api/agents/session", { YNH_USER: "alice", "X-YunoHost-Permission-Agents": "1" })).status, 200);
});
