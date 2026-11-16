const fs = require("node:fs/promises");
const crypto = require("node:crypto");
const { URLSearchParams } = require("node:url");

const SCOPE = "https://www.googleapis.com/auth/firebase.messaging";
const TOKEN_URL = "https://oauth2.googleapis.com/token";
const FCM_TOPIC_URL = "https://fcm.googleapis.com/v1/projects";
const MAX_TITLE_LENGTH = 500;
const MAX_MESSAGE_LENGTH = 3000;
const MAX_NOTIFICATION_BYTES = 3500;

function base64Url(value) {
  return Buffer.from(value).toString("base64url");
}

function createServiceAssertion(serviceAccount, nowSeconds = Math.floor(Date.now() / 1000)) {
  if (!serviceAccount || typeof serviceAccount.client_email !== "string" || typeof serviceAccount.private_key !== "string" || typeof serviceAccount.project_id !== "string") {
    throw new Error("Le compte de service FCM n'est pas complet.");
  }
  const header = base64Url(JSON.stringify({ alg: "RS256", typ: "JWT" }));
  const payload = base64Url(JSON.stringify({
    iss: serviceAccount.client_email,
    scope: SCOPE,
    aud: TOKEN_URL,
    iat: nowSeconds,
    exp: nowSeconds + 3600
  }));
  const unsigned = `${header}.${payload}`;
  const signer = crypto.createSign("RSA-SHA256");
  signer.update(unsigned);
  signer.end();
  return `${unsigned}.${signer.sign(serviceAccount.private_key, "base64url")}`;
}

async function loadServiceAccount(filePath) {
  if (!filePath) throw new Error("FCM n'est pas configuré : la clé de service doit rester sur Yunohost.");
  const account = JSON.parse(await fs.readFile(filePath, "utf8"));
  if (account.type !== "service_account" || account.project_id !== "seec-2da03") {
    throw new Error("Le compte de service configuré n'appartient pas au projet FCM attendu.");
  }
  return account;
}

async function sendToTopic(payload, options = {}) {
  const { title, announcementId } = payload || {};
  const message = payload?.message ?? payload?.body;
  const type = payload?.kind === "standalone_notification" ? "standalone_notification" : (payload?.type || "announcement");
  const announcementType = typeof payload?.announcementType === "string" ? payload.announcementType.toUpperCase() : "INFO";
  if (type === "announcement" && !["AJOUT", "ANNULATION", "MODIFICATION", "INFO"].includes(announcementType)) throw new Error("Type d'annonce invalide.");
  const normalizedTitle = typeof title === "string" ? title.trim() : "";
  const normalizedMessage = typeof message === "string" ? message.trim() : "";
  if (!normalizedTitle || !normalizedMessage || normalizedTitle.length > MAX_TITLE_LENGTH || normalizedMessage.length > MAX_MESSAGE_LENGTH || Buffer.byteLength(normalizedTitle) + Buffer.byteLength(normalizedMessage) > MAX_NOTIFICATION_BYTES) {
    throw new Error("Le titre ou le texte de la notification est invalide ou trop long.");
  }
  if (type === "announcement" && !/^\d+$/.test(String(announcementId || ""))) {
    throw new Error("L'identifiant de l'annonce est invalide.");
  }
  if (!new Set(["announcement", "standalone_notification"]).has(type)) throw new Error("Type de notification inconnu.");
  const serviceAccount = options.serviceAccount || await loadServiceAccount(options.filePath || process.env.FCM_SERVICE_ACCOUNT_FILE);
  const assertion = createServiceAssertion(serviceAccount);
  const tokenResponse = await (options.fetch || fetch)(TOKEN_URL, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      grant_type: "urn:ietf:params:oauth:grant-type:jwt-bearer",
      assertion
    })
  });
  const tokenResult = await tokenResponse.json().catch(() => ({}));
  if (!tokenResponse.ok || typeof tokenResult.access_token !== "string") throw new Error("Échec de l'authentification auprès de FCM.");
  const notificationData = type === "standalone_notification"
    ? { type }
    : { type, announcementId: String(announcementId), announcementType };
  const response = await (options.fetch || fetch)(`${FCM_TOPIC_URL}/${encodeURIComponent(serviceAccount.project_id)}/messages:send`, {
    method: "POST",
    headers: { Authorization: `Bearer ${tokenResult.access_token}`, "Content-Type": "application/json" },
    body: JSON.stringify({
      message: {
        topic: "announcements",
        data: { ...notificationData, title: normalizedTitle, body: normalizedMessage },
        android: { priority: "HIGH" }
      }
    })
  });
  if (!response.ok) {
    const details = await response.json().catch(() => ({}));
    throw new Error(`FCM a refusé la notification (HTTP ${response.status}${details.error?.status ? `, ${details.error.status}` : ""}).`);
  }
  return { sent: true, status: "accepted_by_fcm" };
}

module.exports = { MAX_MESSAGE_LENGTH, MAX_TITLE_LENGTH, SCOPE, createServiceAssertion, loadServiceAccount, sendToTopic };
