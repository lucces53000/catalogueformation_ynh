const crypto = require("node:crypto");
const fs = require("node:fs");
const path = require("node:path");

function canonicalJson(value) {
  if (Array.isArray(value)) return `[${value.map(canonicalJson).join(",")}]`;
  if (value && typeof value === "object") {
    return `{${Object.keys(value).sort().map((key) =>
      `${JSON.stringify(key)}:${canonicalJson(value[key])}`
    ).join(",")}}`;
  }
  return JSON.stringify(value);
}

function checksum(documents) {
  return crypto.createHash("sha256").update(canonicalJson(documents), "utf8").digest("hex");
}

function decodeFirestoreValue(value) {
  if (Array.isArray(value)) return value.map(decodeFirestoreValue);
  if (!value || typeof value !== "object") return value;
  switch (value.__firestoreBackupType) {
    case "map":
      if (!Array.isArray(value.entries)) throw new Error("Entrées de map Firestore invalides.");
      return Object.fromEntries(value.entries.map(([key, child]) => [key, decodeFirestoreValue(child)]));
    case "timestamp":
      if (!Number.isInteger(value.seconds) || !Number.isInteger(value.nanoseconds)) throw new Error("Horodatage invalide.");
      return new Date(value.seconds * 1000 + value.nanoseconds / 1e6).toISOString();
    case "geoPoint":
      return { latitude: value.latitude, longitude: value.longitude };
    case "bytes":
      return { base64: value.base64 };
    case "reference":
      return { firestoreReference: value.path };
    case "number":
      if (!["NaN", "Infinity", "-Infinity"].includes(value.value)) throw new Error("Nombre Firestore spécial invalide.");
      return value.value;
    default:
      throw new Error("Type Firestore inconnu dans la sauvegarde.");
  }
}

function validateBackup(backup) {
  if (!backup || backup.formatVersion !== 1 || backup.projectId !== "seec-2da03") {
    throw new Error("La sauvegarde n'est pas une sauvegarde Firestore v1 du projet seec-2da03.");
  }
  if (!Array.isArray(backup.documents) || backup.documentCount !== backup.documents.length) {
    throw new Error("Le nombre de documents ne correspond pas à la sauvegarde.");
  }
  const paths = new Set();
  for (const document of backup.documents) {
    if (!document || typeof document.path !== "string" || !/^(?:[A-Za-z][A-Za-z0-9_-]*\/[^/]+)(?:\/[^/]+\/[^/]+)*$/.test(document.path)) {
      throw new Error(`Chemin Firestore invalide : ${document?.path || "(vide)"}`);
    }
    if (paths.has(document.path)) throw new Error(`Document dupliqué : ${document.path}`);
    paths.add(document.path);
    decodeFirestoreValue(document.data);
  }
  if (checksum(backup.documents) !== backup.sha256) throw new Error("L'empreinte SHA-256 de la sauvegarde est invalide.");
  return backup.documents;
}

function importBackupFile(filePath, storePath, { replace = false } = {}) {
  const backup = JSON.parse(fs.readFileSync(filePath, "utf8"));
  const sourceDocuments = validateBackup(backup);
  let current = { formatVersion: 1, documents: [] };
  if (fs.existsSync(storePath)) current = JSON.parse(fs.readFileSync(storePath, "utf8"));
  if (!Array.isArray(current.documents)) throw new Error("Le magasin Yunohost existant est invalide.");
  if (!replace && current.documents.length > 0) throw new Error("Le magasin contient déjà des données ; utilisez explicitement --replace après sauvegarde.");
  const indexed = new Map(current.documents.map((document) => [document.path, document]));
  for (const document of sourceDocuments) {
    indexed.set(document.path, { path: document.path, data: decodeFirestoreValue(document.data) });
  }
  const output = { formatVersion: 1, documents: [...indexed.values()] };
  fs.mkdirSync(path.dirname(storePath), { recursive: true, mode: 0o700 });
  const temporaryPath = `${storePath}.${process.pid}.tmp`;
  fs.writeFileSync(temporaryPath, `${JSON.stringify(output)}\n`, { mode: 0o600, flag: "wx" });
  fs.renameSync(temporaryPath, storePath);
  return { imported: sourceDocuments.length, total: output.documents.length, collections: countCollections(sourceDocuments) };
}

function countCollections(documents) {
  return documents.reduce((counts, document) => {
    const collection = document.path.split("/")[0];
    counts[collection] = (counts[collection] || 0) + 1;
    return counts;
  }, {});
}

if (require.main === module) {
  try {
    const args = process.argv.slice(2);
    const replace = args.includes("--replace");
    const positional = args.filter((argument) => argument !== "--replace");
    if (positional.length !== 2) throw new Error("Usage : node server/import-firestore.js SAUVEGARDE.json data/firestore.json [--replace]");
    const result = importBackupFile(path.resolve(positional[0]), path.resolve(positional[1]), { replace });
    console.log(JSON.stringify(result, null, 2));
  } catch (error) {
    console.error(`Import Firestore refusé : ${error.message}`);
    process.exitCode = 1;
  }
}

module.exports = { canonicalJson, checksum, countCollections, decodeFirestoreValue, importBackupFile, validateBackup };
