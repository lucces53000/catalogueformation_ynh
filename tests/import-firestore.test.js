const test = require("node:test");
const assert = require("node:assert/strict");
const { checksum, countCollections, decodeFirestoreValue, validateBackup } = require("../server/import-firestore");

function backup(documents) {
  return { formatVersion: 1, projectId: "seec-2da03", documentCount: documents.length, sha256: checksum(documents), documents };
}

test("validates and counts exported Firestore documents by collection", () => {
  const documents = [
    { path: "trainings/SECURITE", data: { __firestoreBackupType: "map", entries: [["title", "Sécurité"]] } },
    { path: "agentCalendars/agent-1", data: { __firestoreBackupType: "map", entries: [["formateurCaisson", true]] } }
  ];
  const result = validateBackup(backup(documents));
  assert.equal(result.length, 2);
  assert.deepEqual(countCollections(result), { trainings: 1, agentCalendars: 1 });
});

test("decodes Firestore maps, arrays and timestamps without contacting Firebase", () => {
  const value = decodeFirestoreValue({
    __firestoreBackupType: "map",
    entries: [
      ["enabled", true],
      ["title", "Formation"],
      ["dates", ["2026-01-01", "2026-02-01"]],
      ["updatedAt", { __firestoreBackupType: "timestamp", seconds: 1767225600, nanoseconds: 0 }]
    ]
  });
  assert.deepEqual(value, { enabled: true, title: "Formation", dates: ["2026-01-01", "2026-02-01"], updatedAt: "2026-01-01T00:00:00.000Z" });
});

test("rejects a checksum mismatch and any project other than seec-2da03", () => {
  const valid = backup([{ path: "trainings/A", data: { __firestoreBackupType: "map", entries: [] } }]);
  assert.throws(() => validateBackup({ ...valid, sha256: "0".repeat(64) }), /empreinte SHA-256/);
  assert.throws(() => validateBackup({ ...valid, projectId: "other-project" }), /projet seec-2da03/);
});

test("rejects duplicate document paths and malformed Firestore encodings", () => {
  const document = { path: "trainings/A", data: { __firestoreBackupType: "map", entries: [] } };
  assert.throws(() => validateBackup(backup([document, document])), /dupliqué/);
  assert.throws(() => decodeFirestoreValue({ __firestoreBackupType: "map", entries: "bad" }), /Entrées de map/);
});
