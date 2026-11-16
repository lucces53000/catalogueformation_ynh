import { firebaseConfig } from "./firebase-config.js";
import {
  connectFirebaseEmulators,
  getFirebaseConfig
} from "./firebase-environment.js";
import { getApp, getApps, initializeApp } from "https://www.gstatic.com/firebasejs/11.10.0/firebase-app.js";
import {
  doc,
  getFirestore,
  onSnapshot
} from "https://www.gstatic.com/firebasejs/11.10.0/firebase-firestore.js";

const root = document.documentElement;
const notice = document.querySelector("#public-maintenance-notice");
const noticeTitle = document.querySelector("#public-maintenance-title");
const noticeMessage = document.querySelector("#public-maintenance-message");

function setPublicAvailability(mode) {
  root.classList.remove("maintenance-checking", "maintenance-active", "maintenance-unavailable");
  root.classList.add(`maintenance-${mode}`);
  notice.hidden = mode === "available";
  if (mode === "checking") {
    noticeTitle.textContent = "Vérification de la disponibilité";
    noticeMessage.textContent = "Veuillez patienter quelques instants.";
  } else if (mode === "active") {
    noticeTitle.textContent = "Mise à jour en cours";
    noticeMessage.textContent = "Le catalogue et le calendrier sont temporairement indisponibles. Merci de réessayer ultérieurement.";
  } else if (mode === "unavailable") {
    noticeTitle.textContent = "Service temporairement indisponible";
    noticeMessage.textContent = "La disponibilité du catalogue et du calendrier ne peut pas être vérifiée pour le moment. Merci de réessayer ultérieurement.";
  }
}

setPublicAvailability("checking");
try {
  const app = getApps().length ? getApp() : initializeApp(getFirebaseConfig(firebaseConfig));
  const db = getFirestore(app);
  connectFirebaseEmulators({ db });
  onSnapshot(doc(db, "siteSettings", "public"), { includeMetadataChanges: true }, (snapshot) => {
    if (snapshot.metadata.fromCache) return;
    setPublicAvailability(snapshot.exists() && snapshot.data().maintenance === true ? "active" : "available");
  }, (error) => {
    console.error("Impossible de vérifier le mode maintenance public.", error);
    setPublicAvailability("unavailable");
  });
} catch (error) {
  console.error("Impossible d'initialiser la vérification de maintenance.", error);
  setPublicAvailability("unavailable");
}
