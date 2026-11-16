const test = require("node:test");
const assert = require("node:assert/strict");
const { generateKeyPairSync } = require("node:crypto");
const { createServiceAssertion, sendToTopic } = require("../server/fcm");

const serviceAccount = (() => {
  const pair = generateKeyPairSync("rsa", { modulusLength: 2048, privateKeyEncoding: { type: "pkcs8", format: "pem" }, publicKeyEncoding: { type: "spki", format: "pem" } });
  return { type: "service_account", project_id: "seec-2da03", client_email: "test@example.invalid", private_key: pair.privateKey };
})();

test("creates a signed OAuth assertion for the existing FCM project", () => {
  const assertion = createServiceAssertion(serviceAccount, 1_800_000_000);
  const [header, claims, signature] = assertion.split(".");
  assert.equal(JSON.parse(Buffer.from(header, "base64url").toString()).alg, "RS256");
  const payload = JSON.parse(Buffer.from(claims, "base64url").toString());
  assert.equal(payload.iss, serviceAccount.client_email);
  assert.equal(payload.aud, "https://oauth2.googleapis.com/token");
  assert.equal(payload.scope, "https://www.googleapis.com/auth/firebase.messaging");
  assert.ok(signature.length > 100);
});

test("sends an Android topic message using a mocked transport only", async () => {
  const requests = [];
  const fakeFetch = async (url, init) => {
    requests.push({ url, init });
    if (url === "https://oauth2.googleapis.com/token") return { ok: true, json: async () => ({ access_token: "mock-access-token" }) };
    return { ok: true, json: async () => ({ name: "mock-message" }) };
  };
  const result = await sendToTopic({ title: "Formation ajoutée", message: "Inscription ouverte", announcementId: "42", announcementType: "AJOUT" }, { serviceAccount, fetch: fakeFetch });
  assert.deepEqual(result, { sent: true, status: "accepted_by_fcm" });
  assert.equal(requests.length, 2);
  const payload = JSON.parse(requests[1].init.body);
  assert.equal(payload.message.topic, "announcements");
  assert.equal(payload.message.data.type, "announcement");
  assert.equal(payload.message.data.announcementType, "AJOUT");
  assert.equal(payload.message.data.announcementId, "42");
});

test("rejects invalid notification payload before making any network call", async () => {
  let calls = 0;
  await assert.rejects(() => sendToTopic({ title: "", message: "x", announcementId: "1" }, { serviceAccount, fetch: async () => { calls += 1; } }), /invalide ou trop long/);
  assert.equal(calls, 0);
});
