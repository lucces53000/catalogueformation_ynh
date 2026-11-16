import { firebaseConfig } from "./firebase-config.js";
import {
  connectFirebaseEmulators,
  getFirebaseConfig,
  isFirebaseEmulatorEnvironment
} from "./firebase-environment.js";
import { attachCalendarPopover } from "./calendar-tooltip.js";
import {
  getVenueCalendarOverbookings,
  getVenueCalendarStatistics
} from "./venue-calendar-stats.js";
import { initializeApp } from "https://www.gstatic.com/firebasejs/11.10.0/firebase-app.js";
import {
  getAuth,
  onAuthStateChanged,
  sendEmailVerification,
  signInWithEmailAndPassword,
  signOut
} from "https://www.gstatic.com/firebasejs/11.10.0/firebase-auth.js";
import {
  collection,
  deleteDoc,
  doc,
  getDoc,
  getDocs,
  getFirestore,
  setDoc,
  updateDoc,
  writeBatch
} from "https://www.gstatic.com/firebasejs/11.10.0/firebase-firestore.js";

const requiredConfigKeys = ["apiKey", "authDomain", "projectId", "appId"];
const adminEmails = [
    "luc.cesbron@sdis53.fr",
    "formation@sdis53.fr"
  ];
const notificationWorkerUrl = "https://wild-sky-abe4.cesbronluc.workers.dev/";
const isConfigured = requiredConfigKeys.every((key) => Boolean(firebaseConfig[key]));
const status = document.querySelector("#status");
const loginPanel = document.querySelector("#login-panel");
const adminPanel = document.querySelector("#admin-panel");
const adminStickyControls = document.querySelector("#admin-sticky-controls");
const signOutButton = document.querySelector("#sign-out");
const agentCalendarLink = document.querySelector("#agent-calendar-link");
const catalogLink = document.querySelector("#catalog-link");
const catalogVersionEditBanner = document.querySelector("#catalog-version-edit-banner");
const verificationNotice = document.querySelector("#verification-notice");
const maintenanceToggle = document.querySelector("#public-maintenance-enabled");
const maintenanceSettingsStatus = document.querySelector("#maintenance-settings-status");
const maintenanceConfirmDialog = document.querySelector("#maintenance-confirm-dialog");
const maintenanceConfirmMessage = document.querySelector("#maintenance-confirm-message");
const maintenanceConfirmButton = document.querySelector("#confirm-maintenance-change");
const maintenanceCancelButton = document.querySelector("#cancel-maintenance-change");
const trainingVisibilityDialog = document.querySelector("#training-visibility-dialog");
const trainingVisibilityTitle = document.querySelector("#training-visibility-title");
const trainingVisibilityMessage = document.querySelector("#training-visibility-message");
const trainingVisibilityError = document.querySelector("#training-visibility-error");
const confirmTrainingVisibilityButton = document.querySelector("#confirm-training-visibility");
const cancelTrainingVisibilityButton = document.querySelector("#cancel-training-visibility");
const sessionCancellationDialog = document.querySelector("#session-cancellation-dialog");
const sessionCancellationTitle = document.querySelector("#session-cancellation-title");
const sessionCancellationPrompt = document.querySelector("#session-cancellation-prompt");
const sessionCancellationReasonField = document.querySelector("#session-cancellation-reason-field");
const sessionCancellationReason = document.querySelector("#session-cancellation-reason");
const sessionCancellationError = document.querySelector("#session-cancellation-error");
const confirmSessionCancellationButton = document.querySelector("#confirm-session-cancellation");
const cancelSessionCancellationButton = document.querySelector("#cancel-session-cancellation");
const recordDialog = document.querySelector("#record-dialog");
const recordForm = document.querySelector("#record-form");
const recordFields = document.querySelector("#record-fields");
const dialogTitle = document.querySelector("#dialog-title");

let auth;
let db;
let currentCollection;
let editorInputId = 0;
let trainingCategories = new Map();
let categoryDialogMode = "create";
let categoryDialogContext = {};
let loadedTrainings = [];
let loadedLocations = [];
let loadedContacts = [];
let loadedImportantInformation = [];
let loadedImportantInformationCategories = [];
const requestedCatalogVersionId = new URLSearchParams(window.location.search).get("catalogVersionId") || "";
let activeCatalogVersionId = "";
if (requestedCatalogVersionId) document.body.classList.add("catalog-version-editor-mode");
let activeSortableDrag;
let maintenanceSettingEnabled = false;
let maintenanceSettingSaving = false;
let pendingTrainingVisibilityChange = null;
let trainingVisibilitySaving = false;
let pendingSessionCancellation = null;
const venueCalendarDate = new Date();
venueCalendarDate.setDate(1);
let venueCalendarLocation = "";
let venueCalendarLoadError = "";
const expandedVenueCalendarDays = new Set();
const catalogCollections = new Set([
  "trainings",
  "trainingCategories",
  "trainingLocations",
  "trainingContacts",
  "importantInformation",
  "importantInformationCategories"
]);

function catalogCollection(collectionName) {
  return activeCatalogVersionId && catalogCollections.has(collectionName)
    ? collection(db, "catalogVersions", activeCatalogVersionId, "records", collectionName, "items")
    : collection(db, collectionName);
}

function catalogDocument(collectionName, documentId) {
  return activeCatalogVersionId && catalogCollections.has(collectionName)
    ? doc(db, "catalogVersions", activeCatalogVersionId, "records", collectionName, "items", documentId)
    : doc(db, collectionName, documentId);
}

function setCatalogVersionEditing(versionId, title = "") {
  activeCatalogVersionId = versionId;
  catalogVersionEditBanner.hidden = !versionId;
  catalogVersionEditBanner.querySelector("[data-version-title]").textContent = versionId
    ? `Vous modifiez la copie isolée « ${title} ». Le catalogue public n’est pas modifié.`
    : "";
}

function isAuthorizedAdminEmail(email) {
  const normalizedEmail = typeof email === "string" ? email.trim().toLocaleLowerCase("fr") : "";
  return adminEmails.includes(normalizedEmail);
}

async function sendNotificationToWorker(payload) {
  if (isFirebaseEmulatorEnvironment) {
    throw new Error("Les notifications externes sont désactivées dans l’environnement de test local.");
  }
  const user = auth.currentUser;
  if (!user || !user.emailVerified || !isAuthorizedAdminEmail(user.email)) {
    throw new Error("Une session administrateur vérifiée est requise.");
  }
  const idToken = await user.getIdToken();
  const response = await fetch(notificationWorkerUrl, {
    method: "POST",
    headers: {
      "Authorization": `Bearer ${idToken}`,
      "Content-Type": "application/json"
    },
    body: JSON.stringify(payload)
  });
  const result = await response.json().catch(() => ({}));
  if (!response.ok) {
    throw new Error(result.error || `Le service de notification a répondu avec le statut ${response.status}.`);
  }
  if (result.sent !== true) {
    throw new Error("Le service n’a pas confirmé l’envoi à FCM.");
  }
}
let directoryDialogKind = "";
let directoryDialogRecord = null;
let editingImportantCategoryId = "";
let editingImportantInformationId = "";

const DEFAULT_CATEGORY_COLOR = "#205b98";
const DEFAULT_SUBCATEGORY_COLOR = "#eaf2fb";
const CATEGORY_SETTINGS_ID = "__settings__";
const STANDARD_CATEGORY_COLORS = [
  "#dc3545", "#fd7e14", "#ffc107", "#198754", "#20c997", "#0dcaf0",
  "#0d6efd", "#6f42c1", "#d63384", "#795548", "#607d8b", "#343a40",
  "#205b98", "#e76f51", "#8a9a5b", "#9c6644"
];
let selectedImportantCategoryColor = DEFAULT_CATEGORY_COLOR;
let categoryColorPalette = [...STANDARD_CATEGORY_COLORS];
let selectedCategoryColor = DEFAULT_CATEGORY_COLOR;
const CATEGORY_COLORS = {
  "incendie": "#dc3545",
  "secours à personnes": "#0d6efd",
  "feux de forêt": "#198754",
  "secours routier": "#fd7e14",
  "management & cadre": "#6f42c1",
  "cta / codis": "#0dcaf0",
  "initial": "#20c997"
};

const trainingFields = [
  { name: "id", label: "Identifiant", required: true },
  { name: "title", label: "Intitulé", required: true },
  { name: "category", label: "Catégorie", required: true, type: "category" },
  { name: "subCategory", label: "Sous-catégorie", type: "subCategory" },
  { name: "summary", label: "Résumé", type: "textarea" },
  { name: "duration", label: "Durée" },
  { name: "prerequisiteTrainingIds", label: "Formations prérequises", type: "prerequisiteTrainings" },
  { name: "prerequisites", label: "Prérequis", type: "textarea" },
  { name: "observations", label: "Observations", type: "textarea" },
  { name: "sessions", type: "sessions" },
  { name: "phases", type: "phases" },
  { name: "contact", label: "Contact", type: "contact" }
];

const announcementFields = [
  { name: "title", label: "Titre", required: true },
  { name: "message", label: "Message", required: true, type: "textarea" },
  {
    name: "type",
    label: "Type",
    required: true,
    type: "select",
    options: [
      { value: "AJOUT", label: "AJOUT" },
      { value: "ANNULATION", label: "ANNULATION" },
      { value: "MODIFICATION", label: "MODIFICATION" },
      { value: "INFO", label: "INFORMATION" }
    ]
  }
];

function showStatus(message, isError = false) {
  status.textContent = message;
  status.classList.toggle("error", isError);
}

async function loadMaintenanceSetting() {
  maintenanceSettingsStatus.textContent = "Chargement du réglage…";
  maintenanceToggle.disabled = true;
  const snapshot = await getDoc(doc(db, "siteSettings", "public"));
  maintenanceSettingEnabled = snapshot.exists() && snapshot.data().maintenance === true;
  maintenanceToggle.setAttribute("aria-checked", String(maintenanceSettingEnabled));
  maintenanceSettingsStatus.textContent = maintenanceSettingEnabled
    ? "Le mode maintenance est activé."
    : "Le site public est disponible.";
  maintenanceToggle.disabled = false;
}

function resetMaintenanceToggle() {
  maintenanceToggle.setAttribute("aria-checked", String(maintenanceSettingEnabled));
}

function requestMaintenanceSettingChange() {
  if (maintenanceToggle.disabled) return;
  const isEnabling = maintenanceToggle.getAttribute("aria-checked") !== "true";
  maintenanceToggle.setAttribute("aria-checked", String(isEnabling));
  maintenanceConfirmMessage.textContent = isEnabling
    ? "Le catalogue et le calendrier publics seront masqués et afficheront le message de maintenance. Confirmez-vous l’activation ?"
    : "Le catalogue et le calendrier seront de nouveau accessibles au public. Confirmez-vous la désactivation ?";
  maintenanceConfirmButton.textContent = isEnabling ? "Activer la maintenance" : "Rendre le site public";
  maintenanceConfirmDialog.showModal();
}

async function saveMaintenanceSetting() {
  const user = auth.currentUser;
  if (!user || !user.emailVerified || !isAuthorizedAdminEmail(user.email)) {
    maintenanceSettingsStatus.textContent = "Une session administrateur vérifiée est requise.";
    maintenanceConfirmDialog.close();
    return;
  }

  const nextMaintenanceSetting = maintenanceToggle.getAttribute("aria-checked") === "true";
  maintenanceSettingSaving = true;
  maintenanceToggle.disabled = true;
  maintenanceConfirmButton.disabled = true;
  maintenanceCancelButton.disabled = true;
  maintenanceSettingsStatus.textContent = "Enregistrement…";
  try {
    await setDoc(doc(db, "siteSettings", "public"), {
      maintenance: nextMaintenanceSetting,
      updatedAt: Date.now()
    });
    maintenanceSettingEnabled = nextMaintenanceSetting;
    maintenanceSettingsStatus.textContent = maintenanceSettingEnabled
      ? "Mode maintenance activé. Les pages publiques afficheront le message dès réception du réglage."
      : "Mode maintenance désactivé. Les pages publiques sont de nouveau disponibles.";
  } catch (error) {
    maintenanceSettingsStatus.textContent = `Impossible d’enregistrer le réglage : ${error.message}`;
    showStatus(`Échec de l’enregistrement du mode maintenance : ${error.message}`, true);
  } finally {
    resetMaintenanceToggle();
    maintenanceConfirmDialog.close();
    maintenanceToggle.disabled = false;
    maintenanceConfirmButton.disabled = false;
    maintenanceCancelButton.disabled = false;
    maintenanceSettingSaving = false;
  }
}

function parseVenueCalendarDate(value) {
  if (typeof value !== "string" || !/^\d{4}-\d{2}-\d{2}$/.test(value)) return null;
  const [year, month, day] = value.split("-").map(Number);
  const date = new Date(Date.UTC(year, month - 1, day));
  return date.toISOString().slice(0, 10) === value ? date : null;
}

function formatVenueCalendarDate(date) {
  return date.toISOString().slice(0, 10);
}

function formatVenueCalendarRange(start, end) {
  const formatter = new Intl.DateTimeFormat("fr-FR", {
    day: "numeric",
    month: "long",
    year: "numeric",
    timeZone: "UTC"
  });
  const startText = formatter.format(start);
  return formatVenueCalendarDate(start) === formatVenueCalendarDate(end)
    ? startText
    : `${startText} au ${formatter.format(end)}`;
}

function getVenueCalendarSessions() {
  const entries = [];
  loadedTrainings.forEach((training) => {
    const directSessions = Array.isArray(training.sessions) ? training.sessions : [];
    const phaseSessions = Array.isArray(training.phases)
      ? training.phases.flatMap((phase) =>
        (Array.isArray(phase.sessions) ? phase.sessions : []).map((session) => ({
          ...session,
          phaseTitle: phase.phaseTitle || ""
        }))
      )
      : [];
    [...directSessions, ...phaseSessions].forEach((session, index) => {
      const start = parseVenueCalendarDate(session.startDate);
      if (!start) return;
      const parsedEnd = parseVenueCalendarDate(session.endDate);
      const end = parsedEnd && parsedEnd >= start ? parsedEnd : start;
      const rawLocation = String(session.location || "").trim();
      const registeredLocation = loadedLocations.find((location) =>
        location.id === rawLocation || location.name === rawLocation
      );
      entries.push({
        id: `${training.id}-${index}`,
        training,
        start,
        end,
        startKey: formatVenueCalendarDate(start),
        endKey: formatVenueCalendarDate(end),
        locationId: registeredLocation?.id || "",
        locationKey: registeredLocation?.id ||
          (rawLocation ? `name:${rawLocation.toLocaleLowerCase("fr")}` : ""),
        hasLocation: Boolean(rawLocation),
        location: registeredLocation?.name || rawLocation || "Lieu non renseigné",
        cancelled: session.cancelled === true,
        cancellationReason: String(session.cancellationReason || ""),
        sessionName: [session.phaseTitle, session.sessionName].filter(Boolean).join(" · ")
      });
    });
  });
  return entries.sort((left, right) => {
    const dateOrder = left.start - right.start || left.end - right.end;
    if (dateOrder) return dateOrder;
    const leftCategoryOrder = trainingCategories.get(String(left.training.category || "").trim())?.order
      ?? Number.POSITIVE_INFINITY;
    const rightCategoryOrder = trainingCategories.get(String(right.training.category || "").trim())?.order
      ?? Number.POSITIVE_INFINITY;
    const categoryOrder = leftCategoryOrder - rightCategoryOrder ||
      String(left.training.category || "").localeCompare(String(right.training.category || ""), "fr");
    const trainingOrder = (Number.isFinite(left.training.order) ? left.training.order : Number.POSITIVE_INFINITY) -
      (Number.isFinite(right.training.order) ? right.training.order : Number.POSITIVE_INFINITY);
    return categoryOrder ||
      trainingOrder ||
      String(left.training.title || left.training.id).localeCompare(String(right.training.title || right.training.id), "fr") ||
      left.id.localeCompare(right.id, "fr");
  });
}

function venueCalendarSessionMatchesLocation(session) {
  if (!venueCalendarLocation) return true;
  const selectedLocation = loadedLocations.find((location) => location.id === venueCalendarLocation);
  return session.locationId === venueCalendarLocation || session.location === selectedLocation?.name;
}

function renderVenueCalendarStatistics(sessions) {
  const yearSelect = document.querySelector("#venue-statistics-year");
  const selectedYear = yearSelect.value;
  const years = new Set();
  sessions.filter((session) => !session.cancelled).forEach((session) => {
    for (let year = session.start.getUTCFullYear(); year <= session.end.getUTCFullYear(); year += 1) {
      years.add(year);
    }
  });
  yearSelect.replaceChildren(new Option("Toutes les années", "all"));
  [...years].sort((left, right) => right - left)
    .forEach((year) => yearSelect.append(new Option(String(year), String(year))));
  if ([...years].some((year) => String(year) === selectedYear) || selectedYear === "all") {
    yearSelect.value = selectedYear;
  } else {
    yearSelect.value = "all";
  }
  const year = yearSelect.value === "all" ? null : Number(yearSelect.value);
  const statistics = getVenueCalendarStatistics(
    sessions.filter((session) => !session.cancelled),
    year
  );
  const summary = document.querySelector("#venue-calendar-statistics-summary");
  const subcategoryBody = document.querySelector("#venue-calendar-subcategory-statistics");
  const locationBody = document.querySelector("#venue-calendar-location-statistics");
  summary.replaceChildren();
  subcategoryBody.replaceChildren();
  locationBody.replaceChildren();

  [
    { label: "Formations programmées", value: statistics.trainingCount },
    { label: "Jours de formation cumulés", value: statistics.subcategoryDayCount },
    { label: "Jours-lieux utilisés", value: statistics.locationDayCount }
  ].forEach((item) => {
    const card = document.createElement("article");
    card.className = "venue-calendar-statistic-card";
    const value = document.createElement("strong");
    value.textContent = String(item.value);
    const label = document.createElement("span");
    label.textContent = item.label;
    card.append(value, label);
    summary.append(card);
  });

  const appendEmptyRow = (tbody, columnCount, message) => {
    const row = document.createElement("tr");
    const cell = document.createElement("td");
    cell.colSpan = columnCount;
    cell.textContent = message;
    row.append(cell);
    tbody.append(row);
  };

  if (statistics.subcategoryRows.length === 0) {
    appendEmptyRow(subcategoryBody, 4, "Aucune formation programmée avec une date exploitable.");
  } else {
    statistics.subcategoryRows.forEach((item) => {
      const row = document.createElement("tr");
      [item.name, item.trainingCount, item.sessionCount, item.dayCount].forEach((value) => {
        const cell = document.createElement("td");
        cell.textContent = String(value);
        row.append(cell);
      });
      subcategoryBody.append(row);
    });
  }

  if (statistics.locationRows.length === 0) {
    appendEmptyRow(locationBody, 2, "Aucun lieu utilisé dans les sessions datées.");
  } else {
    statistics.locationRows.forEach((item) => {
      const row = document.createElement("tr");
      [item.name, item.dayCount].forEach((value) => {
        const cell = document.createElement("td");
        cell.textContent = String(value);
        row.append(cell);
      });
      locationBody.append(row);
    });
  }
}

function createVenueCalendarOverbookingAlert(overbookings) {
  if (overbookings.length === 0) return null;
  const alert = document.createElement("div");
  alert.className = "venue-calendar-overbooking-alert";
  alert.setAttribute("role", "alert");
  const title = document.createElement("strong");
  title.textContent = "⚠ Plus de 2 formations sur un même lieu";
  alert.append(title);
  overbookings.forEach((overbooking) => {
    const detail = document.createElement("span");
    detail.textContent = `${overbooking.name} : ${overbooking.trainingIds.size} formations`;
    alert.append(detail);
  });
  return alert;
}

function createVenueCalendarEvent(session, dateKey) {
  const title = session.training.title || session.training.id || "Formation sans titre";
  const date = parseVenueCalendarDate(dateKey);
  const dayNumber = Math.floor((date - session.start) / 86400000) + 1;
  const event = document.createElement("article");
  event.className = "venue-calendar-event";
  if (session.cancelled) event.classList.add("is-cancelled-session");
  event.tabIndex = 0;
  event.setAttribute(
    "aria-label",
    `${title}${session.startKey !== session.endKey ? `, jour ${dayNumber}` : ""}, ${session.location}, ${formatVenueCalendarRange(session.start, session.end)}${session.cancelled ? `, session annulée${session.cancellationReason ? `, motif : ${session.cancellationReason}` : ""}` : ""}`
  );
  const heading = document.createElement("span");
  heading.className = "venue-calendar-event-title";
  heading.textContent = title;
  event.append(heading);
  if (session.cancelled) {
    const cancellation = document.createElement("span");
    cancellation.className = "session-cancelled-badge";
    cancellation.textContent = "Annulée";
    event.append(cancellation);
    if (session.cancellationReason) {
      const reason = document.createElement("span");
      reason.className = "session-cancellation-reason";
      reason.textContent = `Motif : ${session.cancellationReason}`;
      event.append(reason);
    }
  }
  if (session.startKey !== session.endKey) {
    const day = document.createElement("span");
    day.className = "calendar-event-day";
    day.textContent = `J${dayNumber}`;
    event.append(day);
  }
  const location = document.createElement("span");
  location.className = "venue-calendar-event-location";
  location.textContent = session.location;
  event.append(location);
  attachCalendarPopover(event, title, [
    { label: "Lieu", value: session.location },
    { label: "Dates", value: formatVenueCalendarRange(session.start, session.end) },
    { label: "Jour", value: session.startKey !== session.endKey ? `J${dayNumber}` : "" },
    { label: "Session", value: session.sessionName },
    { label: "État", value: session.cancelled ? `Annulée${session.cancellationReason ? ` — ${session.cancellationReason}` : ""}` : "Programmée" },
    { label: "Catégorie", value: session.training.category }
  ]);
  return event;
}

function createVenueCalendarDayCell(date, monthIndex, sessions) {
  const dateKey = formatVenueCalendarDate(date);
  const cell = document.createElement("section");
  cell.className = "venue-calendar-day";
  if (date.getUTCMonth() !== monthIndex) cell.classList.add("is-outside-month");
  const heading = document.createElement("div");
  heading.className = "venue-calendar-day-heading";
  heading.textContent = String(date.getUTCDate());
  const eventList = document.createElement("div");
  eventList.className = "venue-calendar-day-events";
  const matches = sessions.filter((session) => session.startKey <= dateKey && session.endKey >= dateKey);
  const overbookingAlert = createVenueCalendarOverbookingAlert(
    getVenueCalendarOverbookings(matches.filter((session) => !session.cancelled), dateKey)
  );
  if (overbookingAlert) eventList.append(overbookingAlert);
  const expanded = expandedVenueCalendarDays.has(dateKey);
  (expanded ? matches : matches.slice(0, 3)).forEach((session) => {
    eventList.append(createVenueCalendarEvent(session, dateKey));
  });
  if (matches.length > 3) {
    const more = document.createElement("button");
    more.className = "venue-calendar-more";
    more.type = "button";
    more.textContent = expanded ? "Réduire" : `+ ${matches.length - 3} autre${matches.length === 4 ? "" : "s"}`;
    more.addEventListener("click", () => {
      if (expanded) expandedVenueCalendarDays.delete(dateKey);
      else expandedVenueCalendarDays.add(dateKey);
      renderVenueCalendar();
    });
    eventList.append(more);
  }
  cell.append(heading, eventList);
  return cell;
}

function renderVenueCalendarGrid(monthIndex, year, sessions) {
  const grid = document.querySelector("#venue-calendar-grid");
  grid.replaceChildren();
  const firstDay = new Date(Date.UTC(year, monthIndex, 1));
  const mondayOffset = (firstDay.getUTCDay() + 6) % 7;
  const daysInMonth = new Date(Date.UTC(year, monthIndex + 1, 0)).getUTCDate();
  const totalCells = Math.ceil((mondayOffset + daysInMonth) / 7) * 7;
  const gridStart = new Date(Date.UTC(year, monthIndex, 1 - mondayOffset));
  for (let index = 0; index < totalCells; index += 1) {
    const date = new Date(gridStart);
    date.setUTCDate(gridStart.getUTCDate() + index);
    grid.append(createVenueCalendarDayCell(date, monthIndex, sessions));
  }
}

function renderVenueCalendarAgenda(monthIndex, year, sessions) {
  const agenda = document.querySelector("#venue-calendar-agenda");
  agenda.replaceChildren();
  const daysInMonth = new Date(Date.UTC(year, monthIndex + 1, 0)).getUTCDate();
  for (let day = 1; day <= daysInMonth; day += 1) {
    const date = new Date(Date.UTC(year, monthIndex, day));
    const dateKey = formatVenueCalendarDate(date);
    const daySessions = sessions.filter((session) => session.startKey <= dateKey && session.endKey >= dateKey);
    if (daySessions.length === 0) continue;
    const group = document.createElement("section");
    group.className = "venue-calendar-agenda-day";
    const heading = document.createElement("h4");
    heading.textContent = new Intl.DateTimeFormat("fr-FR", {
      weekday: "long",
      day: "numeric",
      month: "long",
      year: "numeric",
      timeZone: "UTC"
    }).format(date);
    const entries = document.createElement("div");
    entries.className = "venue-calendar-day-events";
    const overbookingAlert = createVenueCalendarOverbookingAlert(
      getVenueCalendarOverbookings(daySessions, dateKey)
    );
    if (overbookingAlert) entries.append(overbookingAlert);
    daySessions.forEach((session) => entries.append(createVenueCalendarEvent(session, dateKey)));
    group.append(heading, entries);
    agenda.append(group);
  }
  if (!agenda.children.length) {
    const empty = document.createElement("p");
    empty.className = "venue-calendar-empty";
    empty.textContent = "Aucune formation programmée pour ce lieu à ce mois.";
    agenda.append(empty);
  }
}

function renderVenueCalendar() {
  const monthPicker = document.querySelector("#venue-calendar-month");
  const grid = document.querySelector("#venue-calendar-grid");
  const statusElement = document.querySelector("#venue-calendar-status");
  if (!monthPicker || !grid || !statusElement) return;

  const year = venueCalendarDate.getFullYear();
  const monthIndex = venueCalendarDate.getMonth();
  const monthStartKey = formatVenueCalendarDate(new Date(Date.UTC(year, monthIndex, 1)));
  const monthEndKey = formatVenueCalendarDate(new Date(Date.UTC(year, monthIndex + 1, 0)));
  const locationSelect = document.querySelector("#venue-calendar-location");
  const currentLocation = venueCalendarLocation;
  locationSelect.replaceChildren(new Option("Tous les lieux", ""));
  loadedLocations.forEach((location) => locationSelect.append(new Option(location.name, location.id)));
  if (currentLocation && loadedLocations.some((location) => location.id === currentLocation)) {
    locationSelect.value = currentLocation;
  } else {
    venueCalendarLocation = "";
    locationSelect.value = "";
  }

  const allSessions = getVenueCalendarSessions();
  const monthSessions = allSessions
    .filter((session) => session.startKey <= monthEndKey && session.endKey >= monthStartKey)
    .filter(venueCalendarSessionMatchesLocation);
  document.querySelector("#venue-calendar-month-title").textContent =
    new Intl.DateTimeFormat("fr-FR", { month: "long", year: "numeric" }).format(venueCalendarDate);
  monthPicker.value = `${year}-${String(monthIndex + 1).padStart(2, "0")}`;
  document.querySelector("#venue-calendar-session-count").textContent =
    `${monthSessions.length} session${monthSessions.length === 1 ? "" : "s"}`;

  renderVenueCalendarGrid(monthIndex, year, monthSessions);
  renderVenueCalendarAgenda(monthIndex, year, monthSessions);
  renderVenueCalendarStatistics(allSessions);
  statusElement.classList.toggle("error", Boolean(venueCalendarLoadError));
  statusElement.textContent = venueCalendarLoadError ||
    `${allSessions.length} session${allSessions.length === 1 ? "" : "s"} datée${allSessions.length === 1 ? "" : "s"} chargée${allSessions.length === 1 ? "" : "s"}.`;
}

function appendSelectOption(select, value, label) {
  const option = document.createElement("option");
  option.value = value;
  option.textContent = label;
  select.append(option);
}

function updateSubCategoryOptions(select, categoryName, selectedValue = "") {
  select.replaceChildren();
  appendSelectOption(select, "", "Aucune sous-catégorie");
  const subCategories = trainingCategories.get(categoryName)?.subCategories || [];
  subCategories.forEach((subCategory) => appendSelectOption(select, subCategory.name, subCategory.name));
  if (selectedValue && !subCategories.some((subCategory) => subCategory.name === selectedValue)) {
    appendSelectOption(select, selectedValue, `${selectedValue} (actuelle)`);
  }
  select.value = selectedValue || "";
}

function addPrerequisiteTrainingsEditor(record) {
  const wrapper = document.createElement("div");
  wrapper.className = "field";
  wrapper.dataset.prerequisiteTrainings = "";
  wrapper.setAttribute("role", "group");
  wrapper.setAttribute("aria-label", "Formations prérequises");
  const label = document.createElement("strong");
  label.textContent = "Formations prérequises";
  const help = document.createElement("small");
  help.className = "field-help";
  help.textContent = "Filtrez par catégorie et sous-catégorie, puis ajoutez une ou plusieurs formations.";

  const filters = document.createElement("div");
  filters.className = "prerequisite-training-filters";
  const categoryField = document.createElement("div");
  categoryField.className = "field";
  const categoryLabel = document.createElement("label");
  const categorySelect = document.createElement("select");
  categorySelect.id = `prerequisite-category-${editorInputId++}`;
  categoryLabel.htmlFor = categorySelect.id;
  categoryLabel.textContent = "Catégorie";
  appendSelectOption(categorySelect, "", "Toutes les catégories");
  const categoryNames = [...new Set(loadedTrainings.map((training) =>
    String(training.category || "").trim()
  ).filter(Boolean))].sort((left, right) =>
    (trainingCategories.get(left)?.order ?? Number.POSITIVE_INFINITY) -
      (trainingCategories.get(right)?.order ?? Number.POSITIVE_INFINITY) ||
    left.localeCompare(right, "fr")
  );
  categoryNames.forEach((name) => appendSelectOption(categorySelect, name, name));
  categoryField.append(categoryLabel, categorySelect);

  const subCategoryField = document.createElement("div");
  subCategoryField.className = "field";
  const subCategoryLabel = document.createElement("label");
  const subCategorySelect = document.createElement("select");
  subCategorySelect.id = `prerequisite-subcategory-${editorInputId++}`;
  subCategoryLabel.htmlFor = subCategorySelect.id;
  subCategoryLabel.textContent = "Sous-catégorie";

  const trainingField = document.createElement("div");
  trainingField.className = "field";
  const trainingLabel = document.createElement("label");
  const trainingSelect = document.createElement("select");
  trainingSelect.id = `prerequisite-training-${editorInputId++}`;
  trainingLabel.htmlFor = trainingSelect.id;
  trainingLabel.textContent = "Formation";
  const addButton = document.createElement("button");
  addButton.className = "button secondary";
  addButton.type = "button";
  addButton.textContent = "Ajouter comme prérequis";
  addButton.disabled = true;
  const trainingPicker = document.createElement("div");
  trainingPicker.className = "prerequisite-training-picker";
  trainingPicker.append(trainingSelect, addButton);
  trainingField.append(trainingLabel, trainingPicker);
  filters.append(categoryField, subCategoryField, trainingField);

  const selectedIds = new Set(
    (Array.isArray(record.prerequisiteTrainingIds) ? record.prerequisiteTrainingIds : [])
      .filter((id) => typeof id === "string" && id && id !== record.id)
  );
  const selectedList = document.createElement("div");
  selectedList.className = "prerequisite-training-selections";
  const currentId = record.id || "";

  function updateSubCategoryOptionsForFilter() {
    const categoryName = categorySelect.value;
    const names = new Set();
    if (categoryName) {
      (trainingCategories.get(categoryName)?.subCategories || []).forEach((item) => names.add(item.name));
    }
    loadedTrainings.forEach((training) => {
      if ((!categoryName || training.category === categoryName) && training.subCategory) {
        names.add(String(training.subCategory));
      }
    });
    const orderedNames = [...names].sort((left, right) => left.localeCompare(right, "fr"));
    subCategorySelect.replaceChildren();
    appendSelectOption(subCategorySelect, "", "Toutes les sous-catégories");
    orderedNames.forEach((name) => appendSelectOption(subCategorySelect, name, name));
  }

  function renderSelected() {
    selectedList.replaceChildren();
    selectedIds.forEach((id) => {
      const selectedTraining = loadedTrainings.find((training) => training.id === id);
      const card = document.createElement("div");
      card.className = "prerequisite-training-selection";
      card.dataset.prerequisiteTrainingId = id;
      const details = document.createElement("span");
      const title = document.createElement("strong");
      title.textContent = selectedTraining?.title || id;
      details.append(title);
      if (selectedTraining) {
        const category = [selectedTraining.category, selectedTraining.subCategory].filter(Boolean).join(" · ");
        if (category) {
          const meta = document.createElement("small");
          meta.textContent = category;
          details.append(meta);
        }
      }
      const removeButton = document.createElement("button");
      removeButton.className = "button secondary";
      removeButton.type = "button";
      removeButton.textContent = "Retirer";
      removeButton.setAttribute("aria-label", `Retirer ${selectedTraining?.title || id} des prérequis`);
      removeButton.addEventListener("click", () => {
        selectedIds.delete(id);
        renderSelected();
        renderTrainingOptions();
      });
      card.append(details, removeButton);
      selectedList.append(card);
    });
    if (selectedIds.size === 0) {
      const empty = document.createElement("p");
      empty.className = "field-help";
      empty.textContent = "Aucune formation ajoutée.";
      selectedList.append(empty);
    }
  }

  function renderTrainingOptions() {
    const categoryName = categorySelect.value;
    const subCategoryName = subCategorySelect.value;
    const available = loadedTrainings.filter((training) =>
      training.id !== currentId &&
      !selectedIds.has(training.id) &&
      (!categoryName || training.category === categoryName) &&
      (!subCategoryName || training.subCategory === subCategoryName)
    ).sort((left, right) =>
      String(left.title || left.id).localeCompare(String(right.title || right.id), "fr")
    );
    trainingSelect.replaceChildren();
    appendSelectOption(trainingSelect, "", available.length ? "Choisir une formation" : "Aucune formation disponible");
    available.forEach((training) => {
      const meta = [training.category, training.subCategory].filter(Boolean).join(" · ");
      appendSelectOption(
        trainingSelect,
        training.id,
        [training.title || training.id, meta].filter(Boolean).join(" — ")
      );
    });
    addButton.disabled = !trainingSelect.value;
  }

  updateSubCategoryOptionsForFilter();
  renderTrainingOptions();
  renderSelected();
  categorySelect.addEventListener("change", () => {
    updateSubCategoryOptionsForFilter();
    renderTrainingOptions();
  });
  subCategorySelect.addEventListener("change", renderTrainingOptions);
  trainingSelect.addEventListener("change", () => {
    addButton.disabled = !trainingSelect.value;
  });
  addButton.addEventListener("click", () => {
    if (!trainingSelect.value) return;
    selectedIds.add(trainingSelect.value);
    renderSelected();
    renderTrainingOptions();
  });
  wrapper.append(label, help, filters, selectedList);
  recordFields.append(wrapper);
}

function updateLocationOptions(select, selectedValue = "") {
  select.replaceChildren();
  appendSelectOption(select, "", "Lieu non renseigné");
  loadedLocations.forEach((location) => appendSelectOption(select, location.id, location.name));
  const selectedLocation = loadedLocations.find((location) => location.id === selectedValue || location.name === selectedValue);
  if (selectedValue && !selectedLocation) {
    appendSelectOption(select, selectedValue, `${selectedValue} (actuel)`);
    select.value = selectedValue;
  } else {
    select.value = selectedLocation?.id || "";
  }
}

function contactLabel(contact) {
  return [contact.name, contact.email, contact.phone].filter(Boolean).join(" · ");
}

function updateContactOptions(select, selectedValue = "") {
  select.replaceChildren();
  appendSelectOption(select, "", "Aucun contact");
  loadedContacts.forEach((contact) => appendSelectOption(select, contact.id, contactLabel(contact)));
  const selectedContact = loadedContacts.find((contact) =>
    contact.id === selectedValue ||
    contact.name === selectedValue ||
    contactLabel(contact) === selectedValue
  );
  if (selectedValue && !selectedContact) {
    appendSelectOption(select, selectedValue, `${selectedValue} (actuel)`);
    select.value = selectedValue;
  } else {
    select.value = selectedContact?.id || "";
  }
}

function defaultCategoryColor(categoryName) {
  const key = categoryName.trim().toLocaleLowerCase("fr");
  return Object.hasOwn(CATEGORY_COLORS, key) ? CATEGORY_COLORS[key] : DEFAULT_CATEGORY_COLOR;
}

function localizedAnnouncementType(type) {
  return ({
    ADDED: "AJOUT",
    CANCELLED: "ANNULATION",
    MODIFIED: "MODIFICATION"
  })[type] || type;
}

function escapeHtml(value) {
  return String(value ?? "").replace(/[&<>"']/g, (character) => ({
    "&": "&amp;",
    "<": "&lt;",
    ">": "&gt;",
    '"': "&quot;",
    "'": "&#39;"
  })[character]);
}

const ACTION_ICONS = {
  add: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M12 5v14M5 12h14"/></svg>',
  delete: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M4 7h16M10 11v6m4-6v6M6 7l1 14h10l1-14M9 7V4h6v3"/></svg>',
  drag: '<svg viewBox="0 0 24 24" aria-hidden="true"><circle cx="9" cy="5" r="1"/><circle cx="15" cy="5" r="1"/><circle cx="9" cy="12" r="1"/><circle cx="15" cy="12" r="1"/><circle cx="9" cy="19" r="1"/><circle cx="15" cy="19" r="1"/></svg>',
  edit: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="m4 16.5-.8 4.3 4.3-.8L20 7.5 16.5 4 4 16.5ZM14.8 5.7l3.5 3.5"/></svg>',
  eye: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M2 12s3.5-7 10-7 10 7 10 7-3.5 7-10 7-10-7-10-7Z"/><circle cx="12" cy="12" r="3"/></svg>',
  eyeOff: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="m3 3 18 18M10.6 10.6a2 2 0 0 0 2.8 2.8M9.9 5.2A10.7 10.7 0 0 1 12 5c6.5 0 10 7 10 7a15.7 15.7 0 0 1-3.1 3.9M6.2 6.2C3.5 8 2 12 2 12s3.5 7 10 7a10.7 10.7 0 0 0 3.3-.5"/></svg>',
  cancel: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M8 3H5a2 2 0 0 0-2 2v3m13-5h3a2 2 0 0 1 2 2v3M3 16v3a2 2 0 0 0 2 2h3m8 0h3a2 2 0 0 0 2-2v-3M8 8l8 8m0-8-8 8"/></svg>'
};

function makeIconButton(icon, label, style, onClick) {
  const button = document.createElement("button");
  button.className = `button icon-action ${style}`;
  button.type = "button";
  button.innerHTML = ACTION_ICONS[icon];
  button.setAttribute("aria-label", label);
  button.title = label;
  if (icon === "drag") button.dataset.dragHandle = "";
  button.addEventListener("click", onClick);
  return button;
}

function attachDragSort(container, itemSelector, onReorder) {
  const items = [...container.querySelectorAll(itemSelector)];
  items.forEach((item) => {
    const handle = item.querySelector("[data-drag-handle]");
    if (!handle) return;
    handle.addEventListener("pointerdown", (event) => {
      if (event.button !== 0 || activeSortableDrag) return;
      event.preventDefault();
      activeSortableDrag = {
        container,
        item,
        itemSelector,
        onReorder,
        pointerId: event.pointerId,
        moved: false
      };
      item.classList.add("dragging");
      try {
        handle.setPointerCapture(event.pointerId);
      } catch (error) {
        item.classList.remove("dragging");
        activeSortableDrag = null;
        showStatus(`Impossible de démarrer le déplacement : ${error.message}`, true);
      }
    });
    handle.addEventListener("keydown", (event) => {
      const direction = { ArrowUp: -1, ArrowLeft: -1, ArrowDown: 1, ArrowRight: 1 }[event.key];
      if (!direction) return;
      const siblings = [...container.querySelectorAll(itemSelector)];
      const index = siblings.indexOf(item);
      const target = siblings[index + direction];
      if (!target) return;
      event.preventDefault();
      container.insertBefore(item, direction < 0 ? target : target.nextSibling);
      void onReorder([...container.querySelectorAll(itemSelector)].map((entry) => entry.dataset.sortableId));
      handle.focus();
    });
  });
}

document.addEventListener("pointermove", (event) => {
  const drag = activeSortableDrag;
  if (!drag || drag.pointerId !== event.pointerId) return;
  event.preventDefault();
  const target = document.elementFromPoint(event.clientX, event.clientY)?.closest(drag.itemSelector);
  if (!target || target === drag.item || target.parentElement !== drag.container) return;

  const rect = target.getBoundingClientRect();
  const style = window.getComputedStyle(drag.container);
  const isGrid = style.display.includes("grid") && style.gridTemplateColumns.split(" ").length > 1;
  const horizontal = isGrid &&
    Math.abs(event.clientX - (rect.left + rect.width / 2)) / rect.width >
      Math.abs(event.clientY - (rect.top + rect.height / 2)) / rect.height;
  const after = horizontal
    ? event.clientX > rect.left + rect.width / 2
    : event.clientY > rect.top + rect.height / 2;
  drag.container.insertBefore(drag.item, after ? target.nextSibling : target);
  drag.moved = true;
});

document.addEventListener("pointerup", (event) => {
  const drag = activeSortableDrag;
  if (!drag || drag.pointerId !== event.pointerId) return;
  drag.item.classList.remove("dragging");
  activeSortableDrag = null;
  if (drag.moved) {
    void drag.onReorder(
      [...drag.container.querySelectorAll(drag.itemSelector)].map((item) => item.dataset.sortableId)
    );
  }
});

document.addEventListener("pointercancel", (event) => {
  const drag = activeSortableDrag;
  if (!drag || drag.pointerId !== event.pointerId) return;
  drag.item.classList.remove("dragging");
  activeSortableDrag = null;
  if (drag.moved) {
    void drag.onReorder(
      [...drag.container.querySelectorAll(drag.itemSelector)].map((item) => item.dataset.sortableId)
    );
  }
});

function sortByOrder(items, getLabel) {
  return [...items].sort((left, right) => {
    const leftOrder = Number.isFinite(left.order) ? left.order : Number.POSITIVE_INFINITY;
    const rightOrder = Number.isFinite(right.order) ? right.order : Number.POSITIVE_INFINITY;
    return leftOrder - rightOrder || getLabel(left).localeCompare(getLabel(right), "fr");
  });
}

function normalizeTrainingOrders(records) {
  const groups = new Map();
  records.forEach((record) => {
    const key = String(record.category || "").trim() || "Sans catégorie";
    if (!groups.has(key)) groups.set(key, []);
    groups.get(key).push(record);
  });
  groups.forEach((group) => {
    sortByOrder(group, (record) => String(record.title || record.id))
      .forEach((record, index) => {
        record.order = index;
      });
  });
}

function trainingCategoryMatches(training, categoryName) {
  const actualCategory = String(training.category || "").trim() || "Sans catégorie";
  return actualCategory === categoryName;
}

function makeRecordCard(record, collectionName, sortable = false) {
  const card = document.createElement("article");
  card.className = "record-card";
  if (collectionName === "trainings" && record.published === false) {
    card.classList.add("is-hidden-publicly");
  }
  if (sortable) {
    card.dataset.sortableId = record.id;
  }
  const title = record.title || record.id || "Sans titre";
  if (collectionName === "trainings") {
    const categoryName = String(record.category || "").trim() || "Sans catégorie";
    const category = trainingCategories.get(categoryName);
    const subCategoryName = String(record.subCategory || "").trim();
    const subCategory = category?.subCategories.find((item) => item.name === subCategoryName);
    const accentColor = safeColor(
      subCategory?.color,
      safeColor(category?.color, DEFAULT_CATEGORY_COLOR)
    );
    card.classList.add("training-admin-card");
    card.style.setProperty("--training-accent", accentColor);

    const badges = document.createElement("div");
    badges.className = "training-admin-badges";
    if (subCategoryName) {
      const badge = document.createElement("span");
      badge.className = "training-admin-badge training-admin-subcategory";
      badge.textContent = subCategoryName;
      badge.style.setProperty("--subcategory-color", accentColor);
      badges.append(badge);
    }
    if (record.duration) {
      const badge = document.createElement("span");
      badge.className = "training-admin-badge training-admin-duration";
      badge.textContent = record.duration;
      badges.append(badge);
    }
    const sessionCount = Array.isArray(record.phases) && record.phases.length > 0
      ? record.phases.length
      : Array.isArray(record.sessions) ? record.sessions.length : 0;
    if (sessionCount > 0) {
      const badge = document.createElement("span");
      badge.className = "training-admin-badge training-admin-sessions";
      badge.textContent = `${sessionCount} session${sessionCount === 1 ? "" : "s"}`;
      badges.append(badge);
    }
    const actions = document.createElement("div");
    actions.className = "record-actions";
    actions.classList.add("training-admin-actions");
    if (sortable) {
      actions.append(makeIconButton("drag", `Réordonner ${title}`, "secondary drag-handle", () => {}));
    }
    const isPublished = record.published !== false;
    actions.append(
      makeIconButton(
        isPublished ? "eyeOff" : "eye",
        `${isPublished ? "Masquer" : "Afficher"} ${title}`,
        isPublished ? "secondary" : "primary",
        () => requestTrainingVisibilityChange(record)
      ),
      makeIconButton("edit", `Modifier ${title}`, "secondary", () => openRecordDialog(collectionName, record)),
      makeIconButton("delete", `Supprimer ${title}`, "danger", () => removeRecord(collectionName, record))
    );

    const heading = document.createElement("h3");
    heading.className = "training-admin-title";
    heading.textContent = title;
    card.append(badges, heading, actions);
    return card;
  }

  const subtitle = `${localizedAnnouncementType(record.type) || "Annonce"} · ${record.date || ""}`;

  card.innerHTML = `${sortable ? `<button class="button icon-action drag-handle" type="button" data-drag-handle aria-label="Réordonner ${escapeHtml(title)}" title="Glisser pour réordonner">${ACTION_ICONS.drag}</button>` : ""}
    <div class="record-copy">
      <h3>${escapeHtml(title)}</h3>
      <p class="record-meta">${escapeHtml(subtitle)}</p>
      <p>${escapeHtml(record.message)}</p>
      <small>Document : ${escapeHtml(record.id)}</small>
    </div>
    <div class="record-actions"></div>`;
  const actions = card.querySelector(".record-actions");
  actions.append(
    makeIconButton("edit", `Modifier ${title}`, "secondary", () => openRecordDialog(collectionName, record)),
    makeIconButton("delete", `Supprimer ${title}`, "danger", () => removeRecord(collectionName, record))
  );
  return card;
}

function requestTrainingVisibilityChange(training) {
  const isPublished = training.published !== false;
  pendingTrainingVisibilityChange = { training, published: !isPublished };
  trainingVisibilityTitle.textContent = isPublished ? "Masquer cette formation ?" : "Afficher cette formation ?";
  trainingVisibilityMessage.textContent = isPublished
    ? `« ${training.title || training.id} » ne sera plus visible dans le catalogue ni le calendrier publics.`
    : `« ${training.title || training.id} » sera de nouveau visible dans le catalogue et le calendrier publics.`;
  trainingVisibilityError.textContent = "";
  confirmTrainingVisibilityButton.textContent = isPublished ? "Masquer la formation" : "Afficher la formation";
  trainingVisibilityDialog.showModal();
}

async function saveTrainingVisibilityChange() {
  if (!pendingTrainingVisibilityChange || trainingVisibilitySaving) return;
  const { training, published } = pendingTrainingVisibilityChange;
  let saved = false;
  trainingVisibilitySaving = true;
  confirmTrainingVisibilityButton.disabled = true;
  cancelTrainingVisibilityButton.disabled = true;
  try {
    await updateDoc(catalogDocument("trainings", training.id), { published });
    training.published = published;
    renderTrainingGroups();
    renderVenueCalendar();
    showStatus(published
      ? `La formation « ${training.title || training.id} » est maintenant visible publiquement.`
      : `La formation « ${training.title || training.id} » est masquée du catalogue et du calendrier publics.`);
    trainingVisibilityDialog.close();
    saved = true;
  } catch (error) {
    trainingVisibilityError.textContent = `Impossible de modifier la visibilité : ${error.message}`;
  } finally {
    trainingVisibilitySaving = false;
    confirmTrainingVisibilityButton.disabled = false;
    cancelTrainingVisibilityButton.disabled = false;
    if (saved) pendingTrainingVisibilityChange = null;
  }
}

async function loadCollection(collectionName) {
  const list = document.querySelector(`#${collectionName}-list`);
  list.replaceChildren();
  const snapshot = await getCollectionSnapshot(collectionName);
  const records = snapshot.docs.map((item) => ({ ...item.data(), id: item.id }));

  if (collectionName === "trainings") {
    const previousTrainings = new Map(loadedTrainings.map((training) => [training.id, training]));
    records.forEach((record) => {
      if (record.published === undefined && previousTrainings.has(record.id)) {
        record.published = previousTrainings.get(record.id).published;
      }
    });
    normalizeTrainingOrders(records);
    loadedTrainings = records;
    renderTrainingGroups();
    renderVenueCalendar();
    return;
  }

  if (records.length === 0) {
    const emptyState = document.createElement("p");
    emptyState.className = "empty-state";
    emptyState.textContent = "Aucun document dans cette collection.";
    list.append(emptyState);
    return;
  }
  sortByOrder(records, (record) => String(record.title || record.id))
    .forEach((record) => list.append(makeRecordCard(record, collectionName)));
}

async function getCollectionSnapshot(collectionName) {
  try {
    return await getDocs(catalogCollection(collectionName));
  } catch (error) {
    throw new Error(`collection « ${collectionName} » : ${error.message}`);
  }
}

async function loadAllCollections() {
  const tasks = [loadCollection("trainings")];
  if (!activeCatalogVersionId) tasks.push(loadCollection("announcements"));
  tasks.push(
    loadCategories(),
    loadDirectoryCollection("trainingLocations", "locations-list"),
    loadDirectoryCollection("trainingContacts", "contacts-list"),
    loadImportantInformationCategories(),
    loadImportantInformation()
  );
  const results = await Promise.allSettled(tasks);
  const failures = results
    .filter((result) => result.status === "rejected")
    .map((result) => result.reason.message);
  venueCalendarLoadError = [
    results[0].status === "rejected" ? `Formations : ${results[0].reason.message}` : "",
    results[activeCatalogVersionId ? 2 : 3].status === "rejected"
      ? `Lieux : ${results[activeCatalogVersionId ? 2 : 3].reason.message}`
      : ""
  ].filter(Boolean).join(" · ");
  renderVenueCalendar();

  if (failures.length > 0) {
    const successes = results.length - failures.length;
    const prefix = successes > 0 ? `${successes} chargement(s) réussi(s). ` : "";
    showStatus(`${prefix}Échec : ${failures.join(" · ")}`, true);
  } else {
    showStatus("Données chargées.");
  }
}

async function loadImportantInformationCategories() {
  const snapshot = await getCollectionSnapshot("importantInformationCategories");
  loadedImportantInformationCategories = snapshot.docs
    .map((item) => ({ ...item.data(), id: item.id }))
    .sort((left, right) =>
      (Number.isFinite(left.order) ? left.order : Number.POSITIVE_INFINITY) -
        (Number.isFinite(right.order) ? right.order : Number.POSITIVE_INFINITY) ||
      String(left.name || "").localeCompare(String(right.name || ""), "fr")
    );
  renderImportantInformationCategories();
  renderImportantInformation();
}

async function loadImportantInformation() {
  const snapshot = await getCollectionSnapshot("importantInformation");
  loadedImportantInformation = snapshot.docs.map((item) => ({ ...item.data(), id: item.id }));
  renderImportantInformation();
}

function renderImportantInformationCategories() {
  const list = document.querySelector("#important-information-categories");
  list.replaceChildren();
  if (loadedImportantInformationCategories.length === 0) {
    const empty = document.createElement("p");
    empty.className = "empty-state";
    empty.textContent = "Aucune catégorie. Créez-en une avant d’ajouter une information.";
    list.append(empty);
    return;
  }

  loadedImportantInformationCategories.forEach((category) => {
    const item = document.createElement("div");
    item.className = "important-info-category-item";
    item.dataset.sortableId = category.id;
    item.style.setProperty("--important-info-color", safeColor(category.color, DEFAULT_CATEGORY_COLOR));
    const name = document.createElement("strong");
    name.textContent = category.name;
    const actions = document.createElement("div");
    actions.className = "record-actions";
    actions.append(
      makeIconButton("drag", `Réordonner la catégorie ${category.name}`, "secondary drag-handle", () => {}),
      makeIconButton("edit", `Modifier la catégorie ${category.name}`, "secondary", () => openImportantCategoryDialog(category)),
      makeIconButton("delete", `Supprimer la catégorie ${category.name}`, "danger", () => removeImportantCategory(category))
    );
    item.append(name, actions);
    list.append(item);
  });
  attachDragSort(list, ".important-info-category-item", saveImportantInformationCategoryOrder);
}

function renderImportantInformation() {
  const list = document.querySelector("#important-information-admin-list");
  list.replaceChildren();
  if (loadedImportantInformationCategories.length === 0) {
    const empty = document.createElement("p");
    empty.className = "empty-state";
    empty.textContent = "Créez une catégorie pour organiser les informations à retenir.";
    list.append(empty);
    return;
  }

  loadedImportantInformationCategories.forEach((category) => {
    const categoryRecords = loadedImportantInformation
      .filter((record) => record.categoryId === category.id)
      .sort((left, right) =>
        (Number.isFinite(left.order) ? left.order : Number.POSITIVE_INFINITY) -
          (Number.isFinite(right.order) ? right.order : Number.POSITIVE_INFINITY) ||
        String(left.title || "").localeCompare(String(right.title || ""), "fr")
      );
    const section = document.createElement("section");
    section.className = "important-info-group";
    section.style.setProperty("--important-info-color", safeColor(category.color, DEFAULT_CATEGORY_COLOR));
    const heading = document.createElement("h3");
    heading.textContent = category.name;
    const recordsList = document.createElement("div");
    recordsList.className = "important-info-records";
    section.append(heading);
    if (categoryRecords.length === 0) {
      const empty = document.createElement("p");
      empty.className = "empty-state";
      empty.textContent = "Aucune information dans cette catégorie.";
      recordsList.append(empty);
    } else {
      categoryRecords.forEach((record) => recordsList.append(createImportantInformationCard(record)));
    }
    attachDragSort(recordsList, ".important-info-admin-card", (recordIds) =>
      saveImportantInformationOrder(category.id, recordIds)
    );
    section.append(recordsList);
    list.append(section);
  });

  const uncategorized = loadedImportantInformation.filter((record) =>
    !loadedImportantInformationCategories.some((category) => category.id === record.categoryId)
  );
  uncategorized.forEach((record) => list.append(createImportantInformationCard(record)));
}

function createImportantInformationCard(record) {
  const card = document.createElement("article");
  card.className = "important-info-admin-card";
  card.dataset.sortableId = record.id;
  const category = loadedImportantInformationCategories.find((item) => item.id === record.categoryId);
  card.style.setProperty("--important-info-color", safeColor(category?.color, DEFAULT_CATEGORY_COLOR));
  const copy = document.createElement("div");
  copy.className = "important-info-admin-copy";
  const titleRow = document.createElement("div");
  titleRow.className = "important-info-admin-title";
  const title = document.createElement("h4");
  title.textContent = record.title || "Information sans titre";
  const visibility = document.createElement("span");
  visibility.className = `important-info-visibility${record.published ? " is-published" : ""}`;
  visibility.textContent = record.published ? "Publiée" : "Masquée";
  titleRow.append(title, visibility);
  const detail = document.createElement("p");
  detail.textContent = record.description || record.recurrence || (Array.isArray(record.dates) ? record.dates.map((item) => item.date || "À définir").join(" · ") : "");
  const dateSummary = document.createElement("small");
  dateSummary.textContent = Array.isArray(record.dates) && record.dates.length
    ? record.dates.map((item) => [item.date || "À définir", item.location].filter(Boolean).join(" · ")).join(" | ")
    : ({ date: "Dates / événement", text: "Texte informatif", reminder: "Rappel important" })[record.type] || "Information";
  copy.append(titleRow, detail, dateSummary);
  const actions = document.createElement("div");
  actions.className = "record-actions";
  actions.append(
    makeIconButton("drag", `Réordonner ${record.title}`, "secondary drag-handle", () => {}),
    makeIconButton("edit", `Modifier ${record.title}`, "secondary", () => openImportantInformationDialog(record)),
    makeIconButton("delete", `Supprimer ${record.title}`, "danger", () => removeImportantInformation(record))
  );
  card.append(copy, actions);
  return card;
}

function createImportantInfoDateRow(date = {}) {
  const row = document.createElement("div");
  row.className = "important-info-date-row";
  const dateField = document.createElement("div");
  dateField.className = "field";
  const dateLabel = document.createElement("label");
  dateLabel.textContent = "Date";
  const dateInput = document.createElement("input");
  dateInput.type = "date";
  dateInput.name = "date";
  dateInput.value = date.date || "";
  dateLabel.append(dateInput);
  dateField.append(dateLabel);

  const labelField = document.createElement("div");
  labelField.className = "field";
  const labelLabel = document.createElement("label");
  labelLabel.textContent = "Précision (facultatif)";
  const labelInput = document.createElement("input");
  labelInput.type = "text";
  labelInput.name = "label";
  labelInput.maxLength = 140;
  labelInput.value = date.label || "";
  labelLabel.append(labelInput);
  labelField.append(labelLabel);

  const locationField = document.createElement("div");
  locationField.className = "field";
  const locationLabel = document.createElement("label");
  locationLabel.textContent = "Lieu (facultatif)";
  const locationInput = document.createElement("input");
  locationInput.type = "text";
  locationInput.name = "location";
  locationInput.maxLength = 140;
  locationInput.value = date.location || "";
  locationLabel.append(locationInput);
  locationField.append(locationLabel);

  const remove = makeIconButton("delete", "Retirer cette date", "danger", () => row.remove());
  row.append(dateField, labelField, locationField, remove);
  return row;
}

function fillImportantInformationCategoryOptions(selectedId = "") {
  const select = document.querySelector("#important-info-category");
  select.replaceChildren();
  loadedImportantInformationCategories.forEach((category) =>
    appendSelectOption(select, category.id, category.name)
  );
  select.value = selectedId;
}

function openImportantCategoryDialog(category = null) {
  editingImportantCategoryId = category?.id || "";
  selectedImportantCategoryColor = safeColor(category?.color, DEFAULT_CATEGORY_COLOR);
  document.querySelector("#important-category-dialog-title").textContent =
    category ? "Modifier une catégorie" : "Ajouter une catégorie";
  document.querySelector("#important-category-name").value = category?.name || "";
  document.querySelector("#important-category-custom-color").value = selectedImportantCategoryColor;
  renderImportantInformationCategoryColorPalette();
  document.querySelector("#important-category-dialog").showModal();
}

function renderImportantInformationCategoryColorPalette() {
  const palette = document.querySelector("#important-category-color-palette");
  palette.replaceChildren();
  categoryColorPalette.forEach((color) => {
    const button = document.createElement("button");
    button.className = "category-color-swatch";
    button.type = "button";
    button.style.setProperty("--swatch-color", color);
    button.setAttribute("aria-label", `Choisir la couleur ${color}`);
    button.setAttribute("aria-pressed", String(color.toLowerCase() === selectedImportantCategoryColor.toLowerCase()));
    button.title = color;
    button.addEventListener("click", () => {
      selectedImportantCategoryColor = color;
      document.querySelector("#important-category-custom-color").value = color;
      renderImportantInformationCategoryColorPalette();
    });
    palette.append(button);
  });
}

async function saveImportantCategory(event) {
  event.preventDefault();
  const nameInput = document.querySelector("#important-category-name");
  const name = nameInput.value.trim();
  if (!name) return;
  const duplicate = loadedImportantInformationCategories.some((category) =>
    category.id !== editingImportantCategoryId &&
    category.name.toLocaleLowerCase("fr") === name.toLocaleLowerCase("fr")
  );
  if (duplicate) {
    showStatus(`La catégorie « ${name} » existe déjà.`, true);
    return;
  }
  try {
    const previous = loadedImportantInformationCategories.find((category) => category.id === editingImportantCategoryId);
    const id = editingImportantCategoryId || crypto.randomUUID();
    await setDoc(catalogDocument("importantInformationCategories", id), {
      name,
      order: previous?.order ?? Math.max(
        -1,
        ...loadedImportantInformationCategories.map((item) =>
          Number.isFinite(item.order) ? item.order : -1
        )
      ) + 1,
      color: selectedImportantCategoryColor
    });
    document.querySelector("#important-category-dialog").close();
    await loadImportantInformationCategories();
    await loadImportantInformation();
    showStatus("Catégorie d’informations enregistrée.");
  } catch (error) {
    showStatus(`Impossible d’enregistrer la catégorie : ${error.message}`, true);
  }
}

async function saveImportantInformationCategoryOrder(categoryIds) {
  try {
    if (categoryIds.length !== loadedImportantInformationCategories.length) {
      throw new Error("La liste des catégories a changé. Rechargez la page.");
    }
    if (categoryIds.length > 500) {
      throw new Error("Trop de catégories pour une seule opération (limite Firestore : 500 écritures).");
    }
    if (new Set(categoryIds).size !== categoryIds.length) {
      throw new Error("La liste contient des catégories en double.");
    }
    const batch = writeBatch(db);
    categoryIds.forEach((id, order) => {
      const category = loadedImportantInformationCategories.find((item) => item.id === id);
      if (!category) throw new Error(`Catégorie introuvable : ${id}.`);
      batch.update(catalogDocument("importantInformationCategories", id), { order });
    });
    await batch.commit();
    categoryIds.forEach((id, order) => {
      const category = loadedImportantInformationCategories.find((item) => item.id === id);
      category.order = order;
    });
    loadedImportantInformationCategories.sort((left, right) => left.order - right.order);
    renderImportantInformationCategories();
    renderImportantInformation();
    showStatus("Ordre des catégories d’informations enregistré.");
  } catch (error) {
    showStatus(`Impossible d’enregistrer l’ordre des catégories d’informations : ${error.message}`, true);
    try {
      await loadImportantInformationCategories();
    } catch (refreshError) {
      showStatus(`Impossible d’enregistrer l’ordre des catégories : ${error.message}. Actualisation impossible : ${refreshError.message}`, true);
    }
  }
}

async function saveImportantInformationOrder(categoryId, recordIds) {
  try {
    const categoryRecords = loadedImportantInformation.filter((record) => record.categoryId === categoryId);
    if (recordIds.length !== categoryRecords.length) {
      throw new Error("La liste des informations a changé. Rechargez la page.");
    }
    if (recordIds.length > 500) {
      throw new Error("Trop d’informations pour une seule opération (limite Firestore : 500 écritures).");
    }
    if (new Set(recordIds).size !== recordIds.length) {
      throw new Error("La liste contient des informations en double.");
    }
    const batch = writeBatch(db);
    recordIds.forEach((id, order) => {
      if (!categoryRecords.some((record) => record.id === id)) {
        throw new Error(`Information introuvable dans cette catégorie : ${id}.`);
      }
      batch.update(catalogDocument("importantInformation", id), { order });
    });
    await batch.commit();
    const orderById = new Map(recordIds.map((id, order) => [id, order]));
    loadedImportantInformation.forEach((record) => {
      if (orderById.has(record.id)) record.order = orderById.get(record.id);
    });
    showStatus("Ordre des informations enregistré.");
  } catch (error) {
    showStatus(`Impossible d’enregistrer l’ordre des informations : ${error.message}`, true);
    try {
      await loadImportantInformation();
    } catch (refreshError) {
      showStatus(`Impossible d’enregistrer l’ordre des informations : ${error.message}. Actualisation impossible : ${refreshError.message}`, true);
    }
  }
}

async function removeImportantCategory(category) {
  if (loadedImportantInformation.some((record) => record.categoryId === category.id)) {
    showStatus(`Impossible de supprimer « ${category.name} » tant qu’elle contient des informations.`, true);
    return;
  }
  if (!window.confirm(`Supprimer la catégorie « ${category.name} » ?`)) return;
  try {
    await deleteDoc(catalogDocument("importantInformationCategories", category.id));
    await loadImportantInformationCategories();
    await loadImportantInformation();
    showStatus("Catégorie d’informations supprimée.");
  } catch (error) {
    showStatus(`Impossible de supprimer la catégorie : ${error.message}`, true);
  }
}

function openImportantInformationDialog(record = null) {
  if (loadedImportantInformationCategories.length === 0) {
    showStatus("Créez d’abord une catégorie d’informations.", true);
    return;
  }
  editingImportantInformationId = record?.id || "";
  const form = document.querySelector("#important-info-form");
  form.reset();
  document.querySelector("#important-info-dialog-title").textContent =
    record ? "Modifier une information" : "Ajouter une information";
  fillImportantInformationCategoryOptions(record?.categoryId || loadedImportantInformationCategories[0].id);
  form.elements.namedItem("title").value = record?.title || "";
  form.elements.namedItem("type").value = record?.type || "date";
  form.elements.namedItem("description").value = record?.description || "";
  form.elements.namedItem("recurrence").value = record?.recurrence || "";
  form.elements.namedItem("published").checked = record ? record.published !== false : true;
  const dates = document.querySelector("#important-info-dates");
  dates.replaceChildren();
  (Array.isArray(record?.dates) && record.dates.length ? record.dates : [{}])
    .forEach((date) => dates.append(createImportantInfoDateRow(date)));
  document.querySelector("#important-info-dialog").showModal();
}

async function saveImportantInformation(event) {
  event.preventDefault();
  const form = document.querySelector("#important-info-form");
  const formData = new FormData(form);
  const category = loadedImportantInformationCategories.find((item) => item.id === formData.get("categoryId"));
  if (!category) {
    showStatus("Sélectionnez une catégorie valide.", true);
    return;
  }
  const dates = [...document.querySelectorAll(".important-info-date-row")].map((row) => ({
    date: row.querySelector('[name="date"]').value,
    label: row.querySelector('[name="label"]').value.trim(),
    location: row.querySelector('[name="location"]').value.trim()
  })).filter((date) => date.date || date.label || date.location);
  const id = editingImportantInformationId || crypto.randomUUID();
  const previous = loadedImportantInformation.find((item) => item.id === id);
  const nextOrder = Math.max(
    -1,
    ...loadedImportantInformation
      .filter((item) => item.categoryId === category.id)
      .map((item) => Number.isFinite(item.order) ? item.order : -1)
  ) + 1;
  const record = {
    categoryId: category.id,
    title: String(formData.get("title") || "").trim(),
    type: String(formData.get("type") || "date"),
    description: String(formData.get("description") || "").trim(),
    dates,
    recurrence: String(formData.get("recurrence") || "").trim(),
    published: formData.get("published") === "on",
    order: previous?.categoryId === category.id
      ? Number.isFinite(previous.order) ? previous.order : nextOrder
      : nextOrder
  };
  if (!record.title) {
    showStatus("Le titre est obligatoire.", true);
    return;
  }
  try {
    await setDoc(catalogDocument("importantInformation", id), record);
    document.querySelector("#important-info-dialog").close();
    await loadImportantInformation();
    showStatus("Information enregistrée.");
  } catch (error) {
    showStatus(`Impossible d’enregistrer l’information : ${error.message}`, true);
  }
}

async function removeImportantInformation(record) {
  if (!window.confirm(`Supprimer « ${record.title} » ? Cette action est définitive.`)) return;
  try {
    await deleteDoc(catalogDocument("importantInformation", record.id));
    await loadImportantInformation();
    showStatus("Information supprimée.");
  } catch (error) {
    showStatus(`Impossible de supprimer l’information : ${error.message}`, true);
  }
}

async function loadDirectoryCollection(collectionName, listId) {
  const list = document.querySelector(`#${listId}`);
  const snapshot = await getCollectionSnapshot(collectionName);
  const records = snapshot.docs
    .map((item) => ({ ...item.data(), id: item.id }))
    .sort((left, right) => String(left.name || "").localeCompare(String(right.name || ""), "fr"));
  if (collectionName === "trainingLocations") loadedLocations = records;
  else loadedContacts = records;
  renderDirectoryCollection(collectionName, list, records);
  if (collectionName === "trainingLocations") renderVenueCalendar();
}

function renderDirectoryCollection(collectionName, list, records) {
  list.replaceChildren();
  if (records.length === 0) {
    const emptyState = document.createElement("p");
    emptyState.className = "empty-state";
    emptyState.textContent = "Aucun élément enregistré.";
    list.append(emptyState);
    return;
  }
  records.forEach((record) => {
    const card = document.createElement("article");
    card.className = "record-card";
    const copy = document.createElement("div");
    copy.className = "record-copy";
    const title = document.createElement("h3");
    title.textContent = record.name || "Sans nom";
    copy.append(title);
    if (collectionName === "trainingContacts") {
      const details = document.createElement("p");
      details.className = "record-meta";
      details.textContent = [record.email, record.phone].filter(Boolean).join(" · ") || "Aucune coordonnée";
      copy.append(details);
    }
    const actions = document.createElement("div");
    actions.className = "record-actions";
    actions.append(
      makeIconButton("edit", `Modifier ${record.name}`, "secondary", () =>
        openDirectoryDialog(collectionName, record)
      ),
      makeIconButton("delete", `Supprimer ${record.name}`, "danger", () =>
        removeDirectoryRecord(collectionName, record)
      )
    );
    card.append(copy, actions);
    list.append(card);
  });
}

async function loadCategories() {
  const [categorySnapshot, trainingSnapshot] = await Promise.all([
    getCollectionSnapshot("trainingCategories"),
    getCollectionSnapshot("trainings")
  ]);
  const categories = new Map();
  const settings = categorySnapshot.docs.find((item) => item.id === CATEGORY_SETTINGS_ID)?.data();
  const savedPalette = Array.isArray(settings?.colorPalette)
    ? settings.colorPalette.filter(isHexColor)
    : [];
  categoryColorPalette = [...new Set([...STANDARD_CATEGORY_COLORS, ...savedPalette].map((color) => color.toLowerCase()))];

  categorySnapshot.docs.forEach((item) => {
    if (item.id === CATEGORY_SETTINGS_ID) return;
    const data = item.data();
    const name = String(data.name || item.id).trim();
    if (!name) return;
    const subCategories = new Map();
    if (Array.isArray(data.subCategories)) {
      data.subCategories.forEach((entry, index) => {
        const subCategoryName = typeof entry === "string" ? entry : String(entry?.name || "").trim();
        if (subCategoryName) {
          subCategories.set(subCategoryName, {
            name: subCategoryName,
            order: Number.isFinite(entry?.order) ? entry.order : Number.POSITIVE_INFINITY + index,
            color: isHexColor(entry?.color) ? entry.color : DEFAULT_SUBCATEGORY_COLOR
          });
        }
      });
    }
    categories.set(name, {
      order: Number.isFinite(data.order) ? data.order : Number.POSITIVE_INFINITY,
      color: isHexColor(data.color) ? data.color : defaultCategoryColor(name),
      subCategories
    });
  });

  trainingSnapshot.docs.forEach((item) => {
    const training = item.data();
    const name = String(training.category || "").trim();
    if (!name) return;
    if (!categories.has(name)) {
      categories.set(name, { order: Number.POSITIVE_INFINITY, color: defaultCategoryColor(name), subCategories: new Map() });
    }
    const subCategory = String(training.subCategory || "").trim();
    if (subCategory && !categories.get(name).subCategories.has(subCategory)) {
      categories.get(name).subCategories.set(subCategory, {
        name: subCategory,
        order: Number.POSITIVE_INFINITY,
        color: DEFAULT_SUBCATEGORY_COLOR
      });
    }
  });

  trainingCategories = new Map(
    [...categories.entries()]
      .sort(([leftName, left], [rightName, right]) =>
        left.order - right.order || leftName.localeCompare(rightName, "fr")
      )
      .map(([name, category], index) => [name, {
        order: Number.isFinite(category.order) ? category.order : index,
        color: category.color,
        subCategories: sortByOrder([...category.subCategories.values()], (subCategory) => subCategory.name)
          .map((subCategory, subIndex) => ({
            ...subCategory,
            order: Number.isFinite(subCategory.order) ? subCategory.order : subIndex
          }))
      }])
  );
  renderCategories();
  renderTrainingGroups();
}

function isHexColor(value) {
  return typeof value === "string" && /^#[0-9a-f]{6}$/i.test(value);
}

function safeColor(value, fallback) {
  return isHexColor(value) ? value : fallback;
}

function categoryDocument(categoryName, overrides = {}) {
  const category = trainingCategories.get(categoryName);
  return {
    name: overrides.name || categoryName,
    order: overrides.order ?? category?.order ?? trainingCategories.size,
    color: overrides.color || category?.color || defaultCategoryColor(categoryName),
    subCategories: (overrides.subCategories || category?.subCategories || []).map((subCategory, index) => ({
      name: subCategory.name,
      order: Number.isFinite(subCategory.order) ? subCategory.order : index,
      color: subCategory.color || DEFAULT_SUBCATEGORY_COLOR
    }))
  };
}

function renderTrainingGroups() {
  const list = document.querySelector("#trainings-list");
  if (!list) return;
  list.replaceChildren();

  if (loadedTrainings.length === 0) {
    const emptyState = document.createElement("p");
    emptyState.className = "empty-state";
    emptyState.textContent = "Aucun document dans cette collection.";
    list.append(emptyState);
    return;
  }

  const groups = new Map();
  loadedTrainings.forEach((training) => {
    const categoryName = String(training.category || "").trim() || "Sans catégorie";
    if (!groups.has(categoryName)) groups.set(categoryName, []);
    groups.get(categoryName).push(training);
  });

  [...groups.entries()]
    .sort(([leftName], [rightName]) =>
      (trainingCategories.get(leftName)?.order ?? Number.POSITIVE_INFINITY) -
        (trainingCategories.get(rightName)?.order ?? Number.POSITIVE_INFINITY) ||
      leftName.localeCompare(rightName, "fr")
    )
    .forEach(([categoryName, records], categoryIndex) => {
      const category = trainingCategories.get(categoryName);
      const section = document.createElement("details");
      section.className = "training-category-group";
      section.open = categoryIndex === 0;
      const heading = document.createElement("summary");
      heading.className = "training-category-heading";
      heading.textContent = categoryName;
      heading.style.setProperty("--group-color", safeColor(category?.color, DEFAULT_CATEGORY_COLOR));
      heading.setAttribute("aria-label", `Afficher les formations de ${categoryName}`);
      const cards = document.createElement("div");
      cards.className = "record-list training-category-records";
      sortByOrder(records, (record) => String(record.title || record.id))
        .forEach((record) => cards.append(makeRecordCard(record, "trainings", true)));
      attachDragSort(cards, ".record-card", (recordIds) =>
        saveTrainingOrder(categoryName, recordIds)
      );
      section.append(heading, cards);
      section.addEventListener("toggle", () => {
        if (!section.open) return;
        list.querySelectorAll(".training-category-group").forEach((otherSection) => {
          if (otherSection !== section) otherSection.open = false;
        });
      });
      list.append(section);
    });
}

function renderCategories() {
  const list = document.querySelector("#categories-list");
  list.replaceChildren();

  if (trainingCategories.size === 0) {
    const emptyState = document.createElement("p");
    emptyState.className = "empty-state";
    emptyState.textContent = "Aucune catégorie. Créez-en une pour l’utiliser dans une formation.";
    list.append(emptyState);
    return;
  }

  trainingCategories.forEach((category, name) => {
    const card = document.createElement("article");
    card.className = "category-card";
    card.dataset.sortableId = name;
    card.style.setProperty("--group-color", safeColor(category.color, DEFAULT_CATEGORY_COLOR));
    const heading = document.createElement("div");
    heading.className = "category-heading";
    const titleRow = document.createElement("div");
    titleRow.className = "category-title-row";
    const title = document.createElement("h3");
    title.textContent = name;
    const categoryActions = document.createElement("div");
    categoryActions.className = "taxonomy-actions";
    categoryActions.append(
      makeIconButton("add", `Ajouter une sous-catégorie à ${name}`, "secondary", () => {
        openTaxonomyDialog("create-subcategory", name);
      }),
      makeIconButton("edit", `Modifier la catégorie ${name}`, "secondary", () => {
        openTaxonomyDialog("edit-category", name);
      }),
      makeIconButton("delete", `Supprimer la catégorie ${name}`, "danger", () => {
        removeCategory(name);
      })
    );
    titleRow.append(
      makeIconButton("drag", `Réordonner la catégorie ${name}`, "secondary drag-handle", () => {}),
      title
    );
    heading.append(titleRow, categoryActions);

    const subCategoryList = document.createElement("ul");
    subCategoryList.className = "subcategory-chips";
    if (category.subCategories.length === 0) {
      const empty = document.createElement("li");
      empty.className = "category-empty";
      empty.textContent = "Aucune sous-catégorie";
      subCategoryList.append(empty);
    } else {
      category.subCategories.forEach((subCategory) => {
        const chip = document.createElement("li");
        chip.dataset.sortableId = subCategory.name;
        chip.style.setProperty("--chip-color", safeColor(subCategory.color, DEFAULT_SUBCATEGORY_COLOR));
        const label = document.createElement("span");
        label.textContent = subCategory.name;
        const actions = document.createElement("div");
        actions.className = "taxonomy-actions";
        actions.append(
          makeIconButton("edit", `Modifier ${subCategory.name}`, "secondary", () => {
            openTaxonomyDialog("edit-subcategory", name, subCategory.name);
          }),
          makeIconButton("delete", `Supprimer ${subCategory.name}`, "danger", () => {
            removeSubCategory(name, subCategory.name);
          })
        );
        chip.append(
          makeIconButton("drag", `Réordonner ${subCategory.name}`, "secondary drag-handle", () => {}),
          label,
          actions
        );
        subCategoryList.append(chip);
      });
    }
    attachDragSort(subCategoryList, "li[data-sortable-id]", (subCategoryNames) =>
      saveSubCategoryOrder(name, subCategoryNames)
    );

    card.append(heading, subCategoryList);
    list.append(card);
  });
  attachDragSort(list, ".category-card", saveCategoryOrder);
}

async function saveCategoryOrder(categoryNames) {
  try {
    if (categoryNames.length !== trainingCategories.size) throw new Error("La liste des catégories a changé. Rechargez la page.");
    if (categoryNames.length > 500) throw new Error("Trop de catégories pour une seule opération (limite Firestore : 500 écritures).");
    const batch = writeBatch(db);
    categoryNames.forEach((name, order) => {
      batch.set(
        catalogDocument("trainingCategories", name),
        categoryDocument(name, { order })
      );
    });
    await batch.commit();
    await loadCategories();
    showStatus("Ordre des catégories enregistré.");
  } catch (error) {
    showStatus(`Impossible d’enregistrer l’ordre des catégories : ${error.message}`, true);
    try {
      await loadCategories();
    } catch (refreshError) {
      showStatus(`Impossible d’enregistrer l’ordre des catégories : ${error.message}. Actualisation impossible : ${refreshError.message}`, true);
    }
  }
}

async function saveSubCategoryOrder(categoryName, subCategoryNames) {
  try {
    const category = trainingCategories.get(categoryName);
    if (!category) throw new Error("La catégorie est introuvable.");
    if (subCategoryNames.length !== category.subCategories.length) throw new Error("La liste des sous-catégories a changé. Rechargez la page.");
    const subCategories = subCategoryNames.map((name, order) => {
      const subCategory = category.subCategories.find((item) => item.name === name);
      if (!subCategory) throw new Error(`Sous-catégorie introuvable : ${name}.`);
      return { ...subCategory, order };
    });
    await setDoc(
      catalogDocument("trainingCategories", categoryName),
      categoryDocument(categoryName, { subCategories })
    );
    await loadCategories();
    showStatus(`Ordre des sous-catégories de « ${categoryName} » enregistré.`);
  } catch (error) {
    showStatus(`Impossible d’enregistrer l’ordre des sous-catégories : ${error.message}`, true);
    try {
      await loadCategories();
    } catch (refreshError) {
      showStatus(`Impossible d’enregistrer l’ordre des sous-catégories : ${error.message}. Actualisation impossible : ${refreshError.message}`, true);
    }
  }
}

async function saveTrainingOrder(categoryName, trainingIds) {
  try {
    if (trainingIds.length > 500) throw new Error("Trop de formations dans cette catégorie pour une seule opération (limite Firestore : 500 écritures).");
    const categoryTrainings = loadedTrainings.filter((training) =>
      trainingCategoryMatches(training, categoryName)
    );
    if (trainingIds.length !== categoryTrainings.length) throw new Error("La liste des formations a changé. Rechargez la page.");
    if (trainingIds.some((id) => !categoryTrainings.some((training) => training.id === id))) {
      throw new Error("Une formation ne correspond pas à cette catégorie.");
    }
    const batch = writeBatch(db);
    trainingIds.forEach((id, order) => {
      batch.update(catalogDocument("trainings", id), { order });
    });
    await batch.commit();
    const orderById = new Map(trainingIds.map((id, order) => [id, order]));
    loadedTrainings.forEach((training) => {
      if (orderById.has(training.id)) training.order = orderById.get(training.id);
    });
    showStatus(`Ordre des formations enregistré dans « ${categoryName} ».`);
  } catch (error) {
    showStatus(`Impossible d’enregistrer l’ordre des formations : ${error.message}`, true);
    try {
      await loadCollection("trainings");
    } catch (refreshError) {
      showStatus(`Impossible d’enregistrer l’ordre des formations : ${error.message}. Actualisation impossible : ${refreshError.message}`, true);
    }
  }
}

function openTaxonomyDialog(mode, categoryName = "", subCategory = "") {
  categoryDialogMode = mode;
  categoryDialogContext = { categoryName, subCategory };
  const title = document.querySelector("#category-dialog-title");
  const label = document.querySelector("#category-name-label");
  const colorLabel = document.querySelector("#category-color-label");
  const input = document.querySelector("#category-name");
  const submit = document.querySelector("#save-category");
  const colorField = document.querySelector("#category-color-field");
  const editingCategory = mode === "edit-category";
  const editingSubCategory = mode === "edit-subcategory";
  const creatingSubCategory = mode === "create-subcategory";

  title.textContent = editingCategory
    ? "Modifier la catégorie"
    : editingSubCategory
      ? `Modifier une sous-catégorie de « ${categoryName} »`
      : creatingSubCategory
        ? `Créer une sous-catégorie dans « ${categoryName} »`
        : "Créer une catégorie";
  label.textContent = editingSubCategory || creatingSubCategory
    ? "Nom de la sous-catégorie"
    : "Nom de la catégorie";
  colorLabel.textContent = creatingSubCategory || editingSubCategory
    ? "Couleur de la sous-catégorie"
    : "Couleur de la catégorie";
  input.value = editingCategory ? categoryName : editingSubCategory ? subCategory : "";
  submit.textContent = editingCategory || editingSubCategory ? "Enregistrer" : "Créer";
  colorField.classList.toggle("hidden", !editingCategory && !editingSubCategory && !creatingSubCategory);
  const currentSubCategory = trainingCategories.get(categoryName)?.subCategories
    .find((item) => item.name === subCategory);
  selectedCategoryColor = editingCategory
    ? safeColor(trainingCategories.get(categoryName)?.color, defaultCategoryColor(categoryName))
    : editingSubCategory
      ? safeColor(currentSubCategory?.color, DEFAULT_SUBCATEGORY_COLOR)
      : DEFAULT_CATEGORY_COLOR;
  const customColor = document.querySelector("#category-custom-color");
  customColor.value = selectedCategoryColor;
  renderCategoryColorPalette();
  document.querySelector("#category-dialog").showModal();
  input.focus();
  input.select();
}

async function saveTaxonomyName(event) {
  event.preventDefault();
  const form = event.currentTarget;
  const newName = form.elements.name.value.trim();
  if (!newName || newName.includes("/")) {
    showStatus("Le nom est obligatoire et ne doit pas contenir de barre oblique.", true);
    return;
  }

  if (categoryDialogMode === "create") {
    await createCategory(event);
    return;
  }

  const { categoryName, subCategory } = categoryDialogContext;
  if (categoryDialogMode === "create-subcategory") {
    await saveSubCategory(categoryName, newName, selectedCategoryColor);
  } else if (categoryDialogMode === "edit-category") {
    await renameCategory(categoryName, newName, selectedCategoryColor);
  } else {
    await renameSubCategory(categoryName, subCategory, newName, selectedCategoryColor);
  }
}

async function renameCategory(oldName, newName, color) {
  const currentCategory = trainingCategories.get(oldName);
  if (!isHexColor(color)) {
    showStatus("Choisissez une couleur hexadécimale valide.", true);
    return;
  }
  if (oldName === newName && currentCategory?.color.toLowerCase() === color.toLowerCase()) {
    document.querySelector("#category-dialog").close();
    return;
  }
  if (newName === CATEGORY_SETTINGS_ID) {
    showStatus("Ce nom est réservé à la configuration de la palette.", true);
    return;
  }
  if ([...trainingCategories.keys()].some((item) =>
    item !== oldName && item.toLocaleLowerCase("fr") === newName.toLocaleLowerCase("fr")
  )) {
    showStatus("Une catégorie portant ce nom existe déjà.", true);
    return;
  }

  try {
    if (oldName === newName) {
      await setDoc(
        catalogDocument("trainingCategories", oldName),
        categoryDocument(oldName, { color })
      );
      document.querySelector("#category-dialog").close();
      await loadCategories();
      showStatus(`Couleur de « ${newName} » enregistrée.`);
      return;
    }
    const trainingSnapshot = await getCollectionSnapshot("trainings");
    const linkedTrainings = trainingSnapshot.docs.filter((item) => item.data().category === oldName);
    const writeCount = linkedTrainings.length + 2;
    if (writeCount > 500) {
      throw new Error("Cette catégorie est utilisée par trop de formations pour être renommée en une seule opération (limite Firestore : 500 écritures).");
    }

    const categoryData = categoryDocument(oldName, { name: newName, color });
    const batch = writeBatch(db);
    batch.set(catalogDocument("trainingCategories", newName), categoryData);
    linkedTrainings.forEach((item) => {
      batch.update(item.ref, { category: newName });
    });
    batch.delete(catalogDocument("trainingCategories", oldName));
    await batch.commit();
    document.querySelector("#category-dialog").close();
    await Promise.all([loadCollection("trainings"), loadCategories()]);
    showStatus(oldName === newName
      ? `Couleur de « ${newName} » enregistrée.`
      : `Catégorie renommée en « ${newName} »${linkedTrainings.length ? ` ; ${linkedTrainings.length} formation(s) mise(s) à jour` : ""}.`);
  } catch (error) {
    showStatus(`Impossible de renommer la catégorie : ${error.message}`, true);
  }
}

async function renameSubCategory(categoryName, oldName, newName, color) {
  const currentSubCategories = trainingCategories.get(categoryName)?.subCategories || [];
  const currentSubCategory = currentSubCategories.find((item) => item.name === oldName);
  if (!isHexColor(color)) {
    showStatus("Choisissez une couleur hexadécimale valide.", true);
    return;
  }
  if (oldName === newName && currentSubCategory?.color.toLowerCase() === color.toLowerCase()) {
    document.querySelector("#category-dialog").close();
    return;
  }
  if (currentSubCategories.some((item) =>
    item.name !== oldName && item.name.toLocaleLowerCase("fr") === newName.toLocaleLowerCase("fr")
  )) {
    showStatus("Cette sous-catégorie existe déjà dans cette catégorie.", true);
    return;
  }

  try {
    if (oldName === newName) {
      const subCategories = currentSubCategories.map((item) =>
        item.name === oldName ? { ...item, color } : item
      );
      await setDoc(
        catalogDocument("trainingCategories", categoryName),
        categoryDocument(categoryName, { subCategories })
      );
      document.querySelector("#category-dialog").close();
      await loadCategories();
      showStatus(`Couleur de la sous-catégorie « ${newName} » enregistrée.`);
      return;
    }

    const trainingSnapshot = await getCollectionSnapshot("trainings");
    const linkedTrainings = trainingSnapshot.docs.filter((item) =>
      item.data().category === categoryName && item.data().subCategory === oldName
    );
    if (linkedTrainings.length + 1 > 500) {
      throw new Error("Cette sous-catégorie est utilisée par trop de formations pour être renommée en une seule opération (limite Firestore : 500 écritures).");
    }

    const subCategories = currentSubCategories.map((item) =>
      item.name === oldName ? { ...item, name: newName, color } : item
    );
    const batch = writeBatch(db);
    batch.set(catalogDocument("trainingCategories", categoryName), categoryDocument(categoryName, { subCategories }));
    linkedTrainings.forEach((item) => {
      batch.update(item.ref, { subCategory: newName });
    });
    await batch.commit();
    document.querySelector("#category-dialog").close();
    await Promise.all([loadCollection("trainings"), loadCategories()]);
    showStatus(oldName === newName
      ? `Couleur de la sous-catégorie « ${newName} » enregistrée.`
      : `Sous-catégorie renommée en « ${newName} »${linkedTrainings.length ? ` ; ${linkedTrainings.length} formation(s) mise(s) à jour` : ""}.`);
  } catch (error) {
    showStatus(`Impossible de renommer la sous-catégorie : ${error.message}`, true);
  }
}

async function removeCategory(categoryName) {
  if (!window.confirm(`Supprimer la catégorie « ${categoryName} » ?`)) return;
  try {
    const trainingSnapshot = await getCollectionSnapshot("trainings");
    const linkedCount = trainingSnapshot.docs.filter((item) => item.data().category === categoryName).length;
    if (linkedCount > 0) {
      throw new Error(`Impossible de supprimer cette catégorie : ${linkedCount} formation(s) l’utilisent. Modifiez ou supprimez ces formations d’abord.`);
    }
    await deleteDoc(catalogDocument("trainingCategories", categoryName));
    await loadCategories();
    showStatus(`Catégorie « ${categoryName} » supprimée.`);
  } catch (error) {
    showStatus(`Impossible de supprimer la catégorie : ${error.message}`, true);
  }
}

async function removeSubCategory(categoryName, subCategory) {
  if (!window.confirm(`Supprimer la sous-catégorie « ${subCategory} » de « ${categoryName} » ?`)) return;
  try {
    const trainingSnapshot = await getCollectionSnapshot("trainings");
    const linkedCount = trainingSnapshot.docs.filter((item) =>
      item.data().category === categoryName && item.data().subCategory === subCategory
    ).length;
    if (linkedCount > 0) {
      throw new Error(`Impossible de supprimer cette sous-catégorie : ${linkedCount} formation(s) l’utilisent. Modifiez ou supprimez ces formations d’abord.`);
    }

    const subCategories = (trainingCategories.get(categoryName)?.subCategories || [])
      .filter((item) => item.name !== subCategory);
    await setDoc(
      catalogDocument("trainingCategories", categoryName),
      categoryDocument(categoryName, { subCategories })
    );
    await loadCategories();
    showStatus(`Sous-catégorie « ${subCategory} » supprimée.`);
  } catch (error) {
    showStatus(`Impossible de supprimer la sous-catégorie : ${error.message}`, true);
  }
}

async function saveSubCategory(categoryName, subCategoryName, color) {
  const subCategory = subCategoryName.trim();
  if (!subCategory || subCategory.includes("/")) {
    showStatus("La sous-catégorie est obligatoire et ne doit pas contenir de barre oblique.", true);
    return;
  }
  if (!isHexColor(color)) {
    showStatus("Choisissez une couleur hexadécimale valide.", true);
    return;
  }

  const currentSubCategories = trainingCategories.get(categoryName)?.subCategories || [];
  if (currentSubCategories.some((item) => item.name.toLocaleLowerCase("fr") === subCategory.toLocaleLowerCase("fr"))) {
    showStatus("Cette sous-catégorie existe déjà pour cette catégorie.", true);
    return;
  }

  try {
    const subCategories = [...currentSubCategories, {
      name: subCategory,
      order: currentSubCategories.length,
      color
    }].sort((left, right) => left.name.localeCompare(right.name, "fr"));
    await setDoc(
      catalogDocument("trainingCategories", categoryName),
      categoryDocument(categoryName, { subCategories })
    );
    document.querySelector("#category-dialog").close();
    document.querySelector("#category-form").reset();
    await loadCategories();
    showStatus(`Sous-catégorie « ${subCategory} » ajoutée à « ${categoryName} ».`);
  } catch (error) {
    showStatus(`Impossible d’ajouter la sous-catégorie : ${error.message}`, true);
  }
}

async function createCategory(event) {
  event.preventDefault();
  const form = event.currentTarget;
  const name = form.elements.name.value.trim();
  if (!name || name.includes("/")) {
    showStatus("Le nom de la catégorie est obligatoire et ne doit pas contenir de barre oblique.", true);
    return;
  }
  if (name === CATEGORY_SETTINGS_ID) {
    showStatus("Ce nom est réservé à la configuration de la palette.", true);
    return;
  }
  if ([...trainingCategories.keys()].some((item) => item.toLocaleLowerCase("fr") === name.toLocaleLowerCase("fr"))) {
    showStatus("Cette catégorie existe déjà. Vous pouvez lui ajouter une sous-catégorie depuis sa fiche.", true);
    return;
  }

  try {
    const order = Math.max(-1, ...[...trainingCategories.values()].map((category) => category.order)) + 1;
    await setDoc(catalogDocument("trainingCategories", name), {
      name,
      order,
      color: selectedCategoryColor,
      subCategories: []
    });
    await loadCategories();
    form.reset();
    document.querySelector("#category-dialog").close();
    showStatus(`Catégorie « ${name} » créée.`);
  } catch (error) {
    showStatus(`Impossible de créer la catégorie : ${error.message}`, true);
  }
}

function renderCategoryColorPalette() {
  const palette = document.querySelector("#category-color-palette");
  palette.replaceChildren();
  categoryColorPalette.forEach((color) => {
    const button = document.createElement("button");
    button.className = "category-color-swatch";
    button.type = "button";
    button.style.setProperty("--swatch-color", color);
    button.setAttribute("aria-label", `Choisir la couleur ${color}`);
    button.setAttribute("aria-pressed", String(color.toLowerCase() === selectedCategoryColor.toLowerCase()));
    button.title = color;
    button.addEventListener("click", () => {
      selectedCategoryColor = color;
      document.querySelector("#category-custom-color").value = color;
      renderCategoryColorPalette();
    });
    palette.append(button);
  });
}

async function addSelectedColorToPalette() {
  const color = document.querySelector("#category-custom-color").value;
  if (!isHexColor(color)) {
    showStatus("Choisissez une couleur hexadécimale valide.", true);
    return;
  }
  selectedCategoryColor = color.toLowerCase();
  const previousPalette = categoryColorPalette;
  if (!categoryColorPalette.includes(selectedCategoryColor)) {
    categoryColorPalette = [...categoryColorPalette, selectedCategoryColor];
  }
  try {
    await setDoc(
      catalogDocument("trainingCategories", CATEGORY_SETTINGS_ID),
      { colorPalette: categoryColorPalette },
      { merge: true }
    );
    renderCategoryColorPalette();
    showStatus("Couleur ajoutée à la palette.");
  } catch (error) {
    categoryColorPalette = previousPalette;
    showStatus(`Impossible d’ajouter cette couleur à la palette : ${error.message}`, true);
  }
}

function addField(field, record = {}) {
  if (field.type === "sessions") {
    addSessionsEditor(record.sessions);
    return;
  }
  if (field.type === "phases") {
    addPhasesEditor(record.phases);
    return;
  }
  if (field.type === "prerequisiteTrainings") {
    addPrerequisiteTrainingsEditor(record);
    return;
  }

  const wrapper = document.createElement("div");
  wrapper.className = "field";
  const label = document.createElement("label");
  const inputId = `field-${field.name}`;
  label.htmlFor = inputId;
  label.textContent = field.label;
  wrapper.append(label);

  let input;
  if (field.type === "textarea") {
    input = document.createElement("textarea");
    input.rows = 3;
    input.value = record[field.name] ?? "";
  } else if (field.type === "select") {
    input = document.createElement("select");
    field.options.forEach((option) => {
      if (typeof option === "string") {
        appendSelectOption(input, option, option);
      } else {
        appendSelectOption(input, option.value, option.label);
      }
    });
    const selectedValue = field.name === "type"
      ? localizedAnnouncementType(record[field.name])
      : record[field.name];
    input.value = selectedValue || (typeof field.options[0] === "string" ? field.options[0] : field.options[0].value);
  } else if (field.type === "category") {
    input = document.createElement("select");
    appendSelectOption(input, "", "Choisir une catégorie");
    [...trainingCategories.keys()].forEach((category) => appendSelectOption(input, category, category));
    if (record.category && !trainingCategories.has(record.category)) {
      appendSelectOption(input, record.category, `${record.category} (actuelle)`);
    }
    input.value = record.category || "";
  } else if (field.type === "subCategory") {
    input = document.createElement("select");
    input.dataset.subcategorySelect = "";
    updateSubCategoryOptions(input, record.category, record.subCategory);
  } else if (field.type === "contact") {
    input = document.createElement("select");
    updateContactOptions(input, record.contactId || record.contactName || record.contact || "");
  } else {
    input = document.createElement("input");
    input.type = "text";
    input.value = record[field.name] ?? "";
  }
  input.id = inputId;
  input.name = field.name;
  input.required = Boolean(field.required);
  wrapper.append(input);
  if (field.type === "category") {
    input.addEventListener("change", () => {
      const subCategorySelect = recordFields.querySelector("[data-subcategory-select]");
      if (subCategorySelect) updateSubCategoryOptions(subCategorySelect, input.value, "");
    });
  }

  if (field.help) {
    const help = document.createElement("small");
    help.className = "field-help";
    help.textContent = field.help;
    wrapper.append(help);
  }
  recordFields.append(wrapper);
}

function addEditorField(container, labelText, name, value = "", required = false) {
  const wrapper = document.createElement("div");
  wrapper.className = "field";
  const input = document.createElement("input");
  const inputId = `editor-field-${editorInputId++}`;
  const label = document.createElement("label");
  label.htmlFor = inputId;
  label.textContent = labelText;
  input.id = inputId;
  input.name = name;
  input.type = "text";
  input.value = value ?? "";
  input.required = required;
  wrapper.append(label, input);
  container.append(wrapper);
  return input;
}

function openDirectoryDialog(collectionName, record = null) {
  directoryDialogKind = collectionName;
  directoryDialogRecord = record;
  const form = document.querySelector("#directory-form");
  const title = document.querySelector("#directory-dialog-title");
  const contactFields = document.querySelector("#directory-contact-fields");
  const nameInput = form.elements.name;
  const emailInput = form.elements.email;
  const phoneInput = form.elements.phone;
  const isContact = collectionName === "trainingContacts";
  title.textContent = `${record ? "Modifier" : "Ajouter"} ${isContact ? "un contact" : "un lieu"}`;
  document.querySelector("#directory-name-label").textContent = isContact ? "Nom du contact" : "Nom du lieu";
  contactFields.classList.toggle("hidden", !isContact);
  nameInput.value = record?.name || "";
  emailInput.value = record?.email || "";
  phoneInput.value = record?.phone || "";
  document.querySelector("#directory-dialog").showModal();
  nameInput.focus();
}

async function saveDirectoryRecord(event) {
  event.preventDefault();
  const form = event.currentTarget;
  const name = form.elements.name.value.trim();
  if (!name) {
    showStatus("Le nom est obligatoire.", true);
    return;
  }

  const isContact = directoryDialogKind === "trainingContacts";
  const record = { name };
  if (isContact) {
    record.email = form.elements.email.value.trim();
    record.phone = form.elements.phone.value.trim();
  }
  try {
    const id = directoryDialogRecord?.id || doc(catalogCollection(directoryDialogKind)).id;
    await setDoc(catalogDocument(directoryDialogKind, id), record);
    document.querySelector("#directory-dialog").close();
    form.reset();
    await loadDirectoryCollection(
      directoryDialogKind,
      isContact ? "contacts-list" : "locations-list"
    );
    showStatus(`${isContact ? "Contact" : "Lieu"} « ${name} » enregistré.`);
  } catch (error) {
    showStatus(`Impossible d’enregistrer ${isContact ? "le contact" : "le lieu"} : ${error.message}`, true);
  }
}

async function removeDirectoryRecord(collectionName, record) {
  if (!window.confirm(`Supprimer « ${record.name} » ?`)) return;
  try {
    await deleteDoc(catalogDocument(collectionName, record.id));
    await loadDirectoryCollection(
      collectionName,
      collectionName === "trainingContacts" ? "contacts-list" : "locations-list"
    );
    showStatus(`${collectionName === "trainingContacts" ? "Contact" : "Lieu"} « ${record.name} » supprimé.`);
  } catch (error) {
    showStatus(`Impossible de supprimer « ${record.name} » : ${error.message}`, true);
  }
}

function updatePhaseLabels() {
  recordFields.querySelectorAll("[data-phase-card]").forEach((phase, index) => {
    const phaseName = `Phase ${index + 1}`;
    phase.querySelector("[data-phase-heading]").textContent = phaseName;
    phase.setAttribute("aria-label", phaseName);
    phase.querySelectorAll("[data-session-card]").forEach((session, sessionIndex) => {
      const sessionName = `Session ${sessionIndex + 1}`;
      session.querySelector("[data-session-heading]").textContent = sessionName;
      session.setAttribute("aria-label", sessionName);
      const isCancelled = session.querySelector('[name="cancelled"]').value === "true";
      const cancellationAction = session.querySelector("[data-cancellation-action]");
      cancellationAction.setAttribute("aria-label", `${isCancelled ? "Rétablir" : "Annuler"} ${sessionName}`);
      cancellationAction.title = `${isCancelled ? "Rétablir" : "Annuler"} ${sessionName}`;
    });
  });
}

function sortSessionsChronologically(sessions) {
  return [...sessions].sort((left, right) => {
    const leftDate = String(left.startDate || "");
    const rightDate = String(right.startDate || "");
    return (leftDate || "9999-12-31").localeCompare(rightDate || "9999-12-31", "en") ||
      String(left.sessionName || "").localeCompare(String(right.sessionName || ""), "fr");
  });
}

function formatSessionDates(startDate, endDate) {
  const dateFormatter = new Intl.DateTimeFormat("fr-FR", {
    day: "numeric",
    month: "long",
    year: "numeric",
    timeZone: "UTC"
  });
  const parseDate = (value) => {
    const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(value);
    if (!match) throw new Error("Choisissez une date valide.");
    const date = new Date(Date.UTC(Number(match[1]), Number(match[2]) - 1, Number(match[3])));
    if (date.toISOString().slice(0, 10) !== value) throw new Error("Choisissez une date valide.");
    return date;
  };
  const start = parseDate(startDate);
  if (!endDate || endDate === startDate) return dateFormatter.format(start);

  const end = parseDate(endDate);
  if (end < start) throw new Error("La date de fin doit être égale ou postérieure à la date de début.");

  if (start.getUTCFullYear() === end.getUTCFullYear() && start.getUTCMonth() === end.getUTCMonth()) {
    const startDay = new Intl.DateTimeFormat("fr-FR", { day: "numeric", timeZone: "UTC" }).format(start);
    const endFormatted = dateFormatter.format(end);
    return `${startDay} au ${endFormatted}`;
  }

  return `${dateFormatter.format(start)} au ${dateFormatter.format(end)}`;
}

function addSession(sessionsContainer, session = {}) {
  const sessionCard = document.createElement("div");
  sessionCard.className = "session-card";
  sessionCard.dataset.sessionCard = "";
  sessionCard.setAttribute("role", "group");
  const heading = document.createElement("div");
  heading.className = "editor-card-heading";
  const title = document.createElement("h5");
  title.dataset.sessionHeading = "";
  const sessionIsCancelled = session.cancelled === true;
  const cancellationBadge = document.createElement("span");
  cancellationBadge.className = "session-cancelled-badge";
  cancellationBadge.textContent = "Annulée";
  cancellationBadge.hidden = !sessionIsCancelled;
  cancellationBadge.dataset.cancellationBadge = "";
  const cancelSessionButton = makeIconButton(
    "cancel",
    sessionIsCancelled ? "Rétablir cette session" : "Annuler cette session",
    sessionIsCancelled ? "primary" : "danger",
    () => requestSessionCancellation(sessionCard)
  );
  cancelSessionButton.classList.add("session-cancellation-action");
  cancelSessionButton.dataset.cancellationAction = "";
  const actions = document.createElement("div");
  actions.className = "session-card-actions";
  actions.append(cancellationBadge, cancelSessionButton);
  const removeButton = makeIconButton("delete", "Supprimer cette session", "danger", () => {
    sessionCard.remove();
    updatePhaseLabels();
  });
  actions.append(removeButton);
  heading.append(title, actions);

  const fields = document.createElement("div");
  fields.className = "session-fields";
  addEditorField(fields, "Nom de la session (facultatif)", "sessionName", session.sessionName);
  const cancelledInput = document.createElement("input");
  cancelledInput.type = "hidden";
  cancelledInput.name = "cancelled";
  cancelledInput.value = String(sessionIsCancelled);
  const cancellationReasonInput = document.createElement("input");
  cancellationReasonInput.type = "hidden";
  cancellationReasonInput.name = "cancellationReason";
  cancellationReasonInput.value = session.cancellationReason || "";
  fields.append(cancelledInput, cancellationReasonInput);
  sessionCard.dataset.originalDates = session.dates || "";
  sessionCard.dataset.originalStartDate = session.startDate || "";
  sessionCard.dataset.originalEndDate = session.endDate || "";
  const dateFields = document.createElement("div");
  dateFields.className = "session-date-fields";
  let startDateInput;
  let endDateInput;
  [
    { name: "startDate", labelText: "Date de début", value: session.startDate || "" },
    { name: "endDate", labelText: "Date de fin (facultative)", value: session.endDate || "" }
  ].forEach(({ name, labelText, value }) => {
    const wrapper = document.createElement("div");
    wrapper.className = "field";
    const inputId = `editor-field-${editorInputId++}`;
    const label = document.createElement("label");
    const input = document.createElement("input");
    label.htmlFor = inputId;
    label.textContent = labelText;
    input.id = inputId;
    input.type = "date";
    input.inputMode = "numeric";
    input.name = name;
    input.value = value;
    if (name === "startDate") startDateInput = input;
    if (name === "endDate") endDateInput = input;
    wrapper.append(label, input);
    dateFields.append(wrapper);
  });
  const updateEndDateMinimum = () => {
    endDateInput.min = startDateInput.value;
    endDateInput.setCustomValidity(
      endDateInput.value && startDateInput.value && endDateInput.value < startDateInput.value
        ? "La date de fin doit être égale ou postérieure à la date de début."
        : ""
    );
  };
  startDateInput.addEventListener("input", updateEndDateMinimum);
  startDateInput.addEventListener("change", updateEndDateMinimum);
  endDateInput.addEventListener("input", updateEndDateMinimum);
  endDateInput.addEventListener("change", updateEndDateMinimum);
  updateEndDateMinimum();
  const legacyDates = session.dates && !session.startDate
    ? document.createElement("small")
    : null;
  if (legacyDates) {
    legacyDates.className = "field-help legacy-session-dates";
    legacyDates.textContent = `Dates actuelles : ${session.dates}. Choisissez une date pour les remplacer.`;
  }
  fields.append(dateFields);
  if (sessionIsCancelled && session.cancellationReason) {
    const reason = document.createElement("small");
    reason.className = "field-help session-cancellation-summary";
    reason.textContent = `Motif : ${session.cancellationReason}`;
    reason.dataset.cancellationSummary = "";
    fields.append(reason);
  }
  if (legacyDates) fields.append(legacyDates);
  const locationWrapper = document.createElement("div");
  locationWrapper.className = "field";
  const locationId = `editor-field-${editorInputId++}`;
  const locationLabel = document.createElement("label");
  locationLabel.htmlFor = locationId;
  locationLabel.textContent = "Lieu";
  const locationSelect = document.createElement("select");
  locationSelect.id = locationId;
  locationSelect.name = "location";
  updateLocationOptions(locationSelect, session.location || "");
  locationWrapper.append(locationLabel, locationSelect);
  fields.append(locationWrapper);
  sessionCard.append(heading, fields);
  sessionsContainer.append(sessionCard);
}

function requestSessionCancellation(sessionCard) {
  const isCancelled = sessionCard.querySelector('[name="cancelled"]').value === "true";
  pendingSessionCancellation = { sessionCard, cancelled: !isCancelled };
  sessionCancellationTitle.textContent = isCancelled ? "Rétablir cette session ?" : "Annuler cette session ?";
  sessionCancellationPrompt.textContent = isCancelled
    ? "Cette session redeviendra visible comme programmée."
    : "La session restera visible avec la mention « Annulée » et le motif renseigné. Enregistrez ensuite la fiche de la formation pour appliquer le changement.";
  sessionCancellationReasonField.classList.toggle("hidden", isCancelled);
  sessionCancellationReason.value = isCancelled
    ? ""
    : sessionCard.querySelector('[name="cancellationReason"]').value;
  sessionCancellationReason.required = !isCancelled;
  sessionCancellationError.textContent = "";
  confirmSessionCancellationButton.textContent = isCancelled ? "Rétablir la session" : "Confirmer l’annulation";
  confirmSessionCancellationButton.classList.toggle("danger", !isCancelled);
  confirmSessionCancellationButton.classList.toggle("primary", isCancelled);
  sessionCancellationDialog.showModal();
  if (!isCancelled) sessionCancellationReason.focus();
}

function confirmSessionCancellation() {
  if (!pendingSessionCancellation) return;
  const { sessionCard, cancelled } = pendingSessionCancellation;
  const reason = sessionCancellationReason.value.trim();
  if (cancelled && !reason) {
    sessionCancellationError.textContent = "Indiquez le motif de l’annulation.";
    sessionCancellationReason.focus();
    return;
  }
  sessionCard.querySelector('[name="cancelled"]').value = String(cancelled);
  sessionCard.querySelector('[name="cancellationReason"]').value = cancelled ? reason : "";
  const badge = sessionCard.querySelector("[data-cancellation-badge]");
  badge.hidden = !cancelled;
  const action = sessionCard.querySelector("[data-cancellation-action]");
  const title = sessionCard.querySelector("[data-session-heading]").textContent;
  action.setAttribute("aria-label", `${cancelled ? "Rétablir" : "Annuler"} ${title}`);
  action.title = `${cancelled ? "Rétablir" : "Annuler"} ${title}`;
  action.classList.toggle("danger", !cancelled);
  action.classList.toggle("primary", cancelled);
  const oldSummary = sessionCard.querySelector("[data-cancellation-summary]");
  oldSummary?.remove();
  if (cancelled) {
    const summary = document.createElement("small");
    summary.className = "field-help session-cancellation-summary";
    summary.textContent = `Motif : ${reason}`;
    summary.dataset.cancellationSummary = "";
    sessionCard.querySelector(".session-fields").prepend(summary);
  }
  pendingSessionCancellation = null;
  sessionCancellationDialog.close();
}

function addSessionsEditor(sessions = []) {
  const wrapper = document.createElement("section");
  wrapper.className = "phases-editor";
  wrapper.setAttribute("aria-labelledby", "sessions-editor-title");
  const heading = document.createElement("div");
  heading.className = "phases-editor-heading";
  const title = document.createElement("h3");
  title.id = "sessions-editor-title";
  title.textContent = "Sessions";
  const description = document.createElement("p");
  description.textContent = "Ajoutez les dates et le lieu directement, sans créer de phase. Le nom est facultatif.";
  heading.append(title, description);

  const sessionsContainer = document.createElement("div");
  sessionsContainer.className = "sessions-list standalone-sessions";
  (Array.isArray(sessions) ? sessions : []).forEach((session) => addSession(sessionsContainer, session));

  const addSessionButton = document.createElement("button");
  addSessionButton.className = "button secondary icon-action add-session";
  addSessionButton.type = "button";
  addSessionButton.innerHTML = ACTION_ICONS.add;
  addSessionButton.setAttribute("aria-label", "Ajouter une session sans phase");
  addSessionButton.title = "Ajouter une session";
  addSessionButton.addEventListener("click", () => addSession(sessionsContainer));

  wrapper.append(heading, sessionsContainer, addSessionButton);
  recordFields.append(wrapper);
}

function addPhase(phasesContainer, phase = {}) {
  const phaseCard = document.createElement("div");
  phaseCard.className = "phase-card";
  phaseCard.dataset.phaseCard = "";
  phaseCard.setAttribute("role", "group");

  const heading = document.createElement("div");
  heading.className = "editor-card-heading";
  const title = document.createElement("h4");
  title.dataset.phaseHeading = "";
  const removeButton = makeIconButton("delete", "Supprimer cette phase", "danger", () => {
    phaseCard.remove();
    updatePhaseLabels();
  });
  heading.append(title, removeButton);

  const phaseTitle = addEditorField(phaseCard, "Intitulé de la phase", "phaseTitle", phase.phaseTitle, true);
  phaseTitle.classList.add("phase-title-input");

  const sessionsContainer = document.createElement("div");
  sessionsContainer.className = "sessions-list";
  const existingSessions = Array.isArray(phase.sessions) ? phase.sessions : [];
  existingSessions.forEach((session) => addSession(sessionsContainer, session));

  const addSessionButton = document.createElement("button");
  addSessionButton.className = "button secondary icon-action add-session";
  addSessionButton.type = "button";
  addSessionButton.innerHTML = ACTION_ICONS.add;
  addSessionButton.setAttribute("aria-label", "Ajouter une session");
  addSessionButton.title = "Ajouter une session";
  addSessionButton.addEventListener("click", () => addSession(sessionsContainer));

  phaseCard.insertBefore(heading, phaseCard.firstChild);
  phaseCard.append(sessionsContainer, addSessionButton);
  phasesContainer.append(phaseCard);
  updatePhaseLabels();
}

function addPhasesEditor(phases = []) {
  const wrapper = document.createElement("section");
  wrapper.className = "phases-editor";
  wrapper.setAttribute("aria-labelledby", "phases-editor-title");
  const heading = document.createElement("div");
  heading.className = "phases-editor-heading";
  const title = document.createElement("h3");
  title.id = "phases-editor-title";
  title.textContent = "Phases et sessions";
  const description = document.createElement("p");
  description.textContent = "Organisez les phases, puis ajoutez leurs sessions avec leurs dates et lieux.";
  heading.append(title, description);

  const phasesContainer = document.createElement("div");
  phasesContainer.id = "phases-list";
  phasesContainer.className = "phases-list";
  (Array.isArray(phases) ? phases : []).forEach((phase) => addPhase(phasesContainer, phase));

  const addPhaseButton = document.createElement("button");
  addPhaseButton.className = "button secondary icon-action";
  addPhaseButton.type = "button";
  addPhaseButton.innerHTML = ACTION_ICONS.add;
  addPhaseButton.setAttribute("aria-label", "Ajouter une phase");
  addPhaseButton.title = "Ajouter une phase";
  addPhaseButton.addEventListener("click", () => addPhase(phasesContainer));

  wrapper.append(heading, phasesContainer, addPhaseButton);
  recordFields.append(wrapper);
}

function openRecordDialog(collectionName, record = null) {
  currentCollection = collectionName;
  const fields = collectionName === "trainings" ? trainingFields : announcementFields;
  dialogTitle.textContent = `${record ? "Modifier" : "Ajouter"} ${collectionName === "trainings" ? "une formation" : "une annonce"}`;
  recordFields.replaceChildren();
  fields.forEach((field) => addField(field, record || {}));
  recordForm.dataset.originalId = record?.id || "";
  recordDialog.showModal();
}

function readFormRecord() {
  const fields = currentCollection === "trainings" ? trainingFields : announcementFields;
  const record = {};
  for (const field of fields) {
    if (field.type === "phases") {
      record.phases = [...recordFields.querySelectorAll("[data-phase-card]")].map((phase) => ({
        phaseTitle: phase.querySelector(".phase-title-input").value.trim(),
        sessions: sortSessionsChronologically(
          [...phase.querySelectorAll("[data-session-card]")].map(readSessionRecord)
        )
      }));
      continue;
    }
    if (field.type === "sessions") {
      record.sessions = sortSessionsChronologically(
        [...recordFields.querySelectorAll(".standalone-sessions [data-session-card]")]
          .map(readSessionRecord)
      );
      continue;
    }
    if (field.type === "contact") {
      const selectedId = recordForm.elements.namedItem(field.name).value;
      const selectedContact = loadedContacts.find((contact) => contact.id === selectedId);
      record.contact = selectedContact ? contactLabel(selectedContact) : selectedId;
      record.contactId = selectedContact?.id || "";
      record.contactName = String(selectedContact?.name || selectedId || "");
      record.contactPhone = String(selectedContact?.phone || "");
      record.contactEmail = String(selectedContact?.email || "");
      continue;
    }
    if (field.type === "prerequisiteTrainings") {
      record[field.name] = [...recordFields.querySelectorAll("[data-prerequisite-training-id]")]
        .map((card) => card.dataset.prerequisiteTrainingId);
      continue;
    }

    const value = recordForm.elements.namedItem(field.name).value.trim();
    record[field.name] = value;
  }
  if (currentCollection === "trainings" && (!record.id || record.id.includes("/"))) {
    throw new Error("L’identifiant est obligatoire et ne doit pas contenir de barre oblique.");
  }
  return record;
}

async function nextAnnouncementId() {
  const snapshot = await getCollectionSnapshot("announcements");
  const highestId = snapshot.docs.reduce((highest, item) => {
    if (!/^\d+$/.test(item.id)) return highest;
    const numericId = Number(item.id);
    return Number.isSafeInteger(numericId) ? Math.max(highest, numericId) : highest;
  }, 0);
  return String(highestId + 1);
}

function currentAnnouncementDate() {
  return new Intl.DateTimeFormat("fr-FR", {
    day: "numeric",
    month: "long",
    year: "numeric"
  }).format(new Date());
}

function readSessionRecord(session) {
  const startDate = session.querySelector('[name="startDate"]').value;
  const endDate = session.querySelector('[name="endDate"]').value;
  if (endDate && !startDate) {
    throw new Error("Renseignez la date de début de chaque session ayant une date de fin.");
  }
  const selectedLocation = session.querySelector('[name="location"]').value;
  const location = loadedLocations.find((item) =>
    item.id === selectedLocation || item.name === selectedLocation
  );
  return {
    sessionName: session.querySelector('[name="sessionName"]').value.trim(),
    dates: startDate ? formatSessionDates(startDate, endDate) : session.dataset.originalDates,
    startDate: startDate || session.dataset.originalStartDate,
    endDate: startDate ? endDate : session.dataset.originalEndDate,
    location: location?.name || selectedLocation,
    cancelled: session.querySelector('[name="cancelled"]').value === "true",
    cancellationReason: session.querySelector('[name="cancellationReason"]').value.trim()
  };
}

async function saveRecord(event) {
  event.preventDefault();
  try {
    const record = readFormRecord();
    const oldId = recordForm.dataset.originalId;
    const collectionName = currentCollection;
    if (collectionName === "announcements") {
      record.id = oldId || await nextAnnouncementId();
      record.date = currentAnnouncementDate();
    }
    if (collectionName === "trainings") {
      const previous = loadedTrainings.find((training) => training.id === oldId);
      record.published = previous ? previous.published !== false : true;
      const sameCategory = previous && previous.category === record.category;
      record.order = sameCategory
        ? previous.order
        : loadedTrainings.filter((training) =>
          String(training.category || "").trim() === record.category
        ).length;
    }
    await setDoc(catalogDocument(currentCollection, record.id), record);
    if (oldId && oldId !== record.id) {
      await deleteDoc(catalogDocument(currentCollection, oldId));
    }
    recordDialog.close();
    let notificationError;
    const isNewAnnouncement = collectionName === "announcements" && !oldId;
    if (isNewAnnouncement) {
      showStatus("Annonce enregistrée. Envoi de la notification…");
      try {
        await sendNotificationToWorker({
          title: record.title,
          message: record.message,
          announcementId: record.id,
          announcementType: record.type
        });
      } catch (error) {
        notificationError = error;
      }
    }

    try {
      await loadCollection(collectionName);
    } catch (error) {
      showStatus(`Document enregistré, mais impossible d’actualiser la liste : ${error.message}`, true);
      return;
    }

    if (notificationError) {
      showStatus(`Annonce enregistrée, mais notification non envoyée : ${notificationError.message}`, true);
    } else if (isNewAnnouncement) {
      showStatus("Annonce enregistrée et envoi accepté par FCM.");
    } else {
      showStatus("Document enregistré.");
    }
  } catch (error) {
    showStatus(`Impossible d’enregistrer le document : ${error.message}`, true);
  }
}

async function removeRecord(collectionName, record) {
  if (!window.confirm(`Supprimer « ${record.title || record.id} » ? Cette action est définitive.`)) return;
  try {
    await deleteDoc(catalogDocument(collectionName, record.id));
    showStatus("Document supprimé.");
    await loadCollection(collectionName);
  } catch (error) {
    showStatus(`Impossible de supprimer le document : ${error.message}`, true);
  }
}

async function sendStandaloneNotification(event) {
  event.preventDefault();
  const form = event.currentTarget;
  const submitButton = document.querySelector("#send-notification");
  const title = form.elements.namedItem("title").value.trim();
  const message = form.elements.namedItem("message").value.trim();
  if (!title || !message) {
    showStatus("Renseignez le titre et le texte de la notification.", true);
    return;
  }

  submitButton.disabled = true;
  showStatus("Envoi de la notification…");
  try {
    await sendNotificationToWorker({
      kind: "standalone_notification",
      title,
      message
    });
    form.reset();
    showStatus("FCM a accepté la notification pour envoi aux appareils abonnés. Le nombre d’appareils effectivement notifiés n’est pas disponible.");
  } catch (error) {
    showStatus(`Notification non envoyée : ${error.message}`, true);
  } finally {
    submitButton.disabled = false;
  }
}

document.querySelector("#login-form").addEventListener("submit", async (event) => {
  event.preventDefault();
  const form = event.currentTarget;
  try {
    await signInWithEmailAndPassword(auth, form.elements.email.value, form.elements.password.value);
    form.reset();
  } catch (error) {
    showStatus(`Connexion impossible : ${error.message}`, true);
  }
});

maintenanceToggle.addEventListener("click", requestMaintenanceSettingChange);
maintenanceConfirmButton.addEventListener("click", saveMaintenanceSetting);
maintenanceCancelButton.addEventListener("click", () => maintenanceConfirmDialog.close());
maintenanceConfirmDialog.addEventListener("cancel", (event) => {
  if (maintenanceSettingSaving) event.preventDefault();
});
maintenanceConfirmDialog.addEventListener("close", resetMaintenanceToggle);
confirmTrainingVisibilityButton.addEventListener("click", saveTrainingVisibilityChange);
cancelTrainingVisibilityButton.addEventListener("click", () => trainingVisibilityDialog.close());
trainingVisibilityDialog.addEventListener("close", () => {
  if (!trainingVisibilitySaving) pendingTrainingVisibilityChange = null;
});
trainingVisibilityDialog.addEventListener("cancel", (event) => {
  if (trainingVisibilitySaving) event.preventDefault();
});
confirmSessionCancellationButton.addEventListener("click", confirmSessionCancellation);
cancelSessionCancellationButton.addEventListener("click", () => sessionCancellationDialog.close());
sessionCancellationDialog.addEventListener("close", () => {
  pendingSessionCancellation = null;
  sessionCancellationReason.value = "";
  sessionCancellationError.textContent = "";
});

signOutButton.addEventListener("click", async () => {
  try {
    await signOut(auth);
  } catch (error) {
    showStatus(`Déconnexion impossible : ${error.message}`, true);
  }
});

document.querySelector("#resend-verification").addEventListener("click", async () => {
  const user = auth.currentUser;
  if (!user || user.emailVerified) {
    showStatus("Connectez-vous avec un compte non vérifié pour demander un nouveau courriel.", true);
    return;
  }
  try {
    await sendEmailVerification(user);
    showStatus(`Courriel de vérification envoyé à ${user.email}. Vérifiez aussi vos courriers indésirables.`);
  } catch (error) {
    showStatus(`Impossible d’envoyer le courriel de vérification : ${error.message}`, true);
  }
});

recordForm.addEventListener("submit", saveRecord);
document.querySelector("#notification-form").addEventListener("submit", sendStandaloneNotification);
document.querySelector("#cancel-dialog").addEventListener("click", () => recordDialog.close());
document.querySelector("#close-dialog").addEventListener("click", () => recordDialog.close());
document.querySelector("#add-training").addEventListener("click", () => openRecordDialog("trainings"));
document.querySelector("#add-announcement").addEventListener("click", () => openRecordDialog("announcements"));
document.querySelector("#add-category").addEventListener("click", () => {
  openTaxonomyDialog("create");
});
document.querySelector("#category-form").addEventListener("submit", saveTaxonomyName);
document.querySelector("#category-custom-color").addEventListener("input", (event) => {
  selectedCategoryColor = event.currentTarget.value;
  renderCategoryColorPalette();
});
document.querySelector("#add-category-color").addEventListener("click", addSelectedColorToPalette);
document.querySelector("#add-location").addEventListener("click", () => openDirectoryDialog("trainingLocations"));
document.querySelector("#add-contact").addEventListener("click", () => openDirectoryDialog("trainingContacts"));
document.querySelector("#directory-form").addEventListener("submit", saveDirectoryRecord);
document.querySelector("#add-important-category").addEventListener("click", () => openImportantCategoryDialog());
document.querySelector("#important-category-form").addEventListener("submit", saveImportantCategory);
document.querySelector("#important-category-custom-color").addEventListener("input", (event) => {
  selectedImportantCategoryColor = event.currentTarget.value.toLowerCase();
  renderImportantInformationCategoryColorPalette();
});
document.querySelector("#add-important-information").addEventListener("click", () => openImportantInformationDialog());
document.querySelector("#important-info-form").addEventListener("submit", saveImportantInformation);
document.querySelector("#add-important-info-date").addEventListener("click", () => {
  document.querySelector("#important-info-dates").append(createImportantInfoDateRow());
});
document.querySelector("#cancel-important-category-dialog").addEventListener("click", () => {
  document.querySelector("#important-category-dialog").close();
});
document.querySelector("#close-important-category-dialog").addEventListener("click", () => {
  document.querySelector("#important-category-dialog").close();
});
document.querySelector("#cancel-important-info-dialog").addEventListener("click", () => {
  document.querySelector("#important-info-dialog").close();
});
document.querySelector("#close-important-info-dialog").addEventListener("click", () => {
  document.querySelector("#important-info-dialog").close();
});
document.querySelector("#cancel-directory-dialog").addEventListener("click", () => {
  document.querySelector("#directory-dialog").close();
});
document.querySelector("#close-directory-dialog").addEventListener("click", () => {
  document.querySelector("#directory-dialog").close();
});
document.querySelector("#cancel-category-dialog").addEventListener("click", () => {
  document.querySelector("#category-dialog").close();
});
document.querySelector("#close-category-dialog").addEventListener("click", () => {
  document.querySelector("#category-dialog").close();
});

document.querySelectorAll(".tab").forEach((tab) => {
  tab.addEventListener("click", () => {
    document.querySelectorAll(".tab").forEach((item) => item.classList.toggle("active", item === tab));
    document.querySelectorAll(".collection-view").forEach((view) => {
      view.classList.toggle("hidden", view.id !== `${tab.dataset.tab}-view`);
    });
  });
});

document.querySelector("#venue-statistics-year").addEventListener("change", () => renderVenueCalendar());

document.querySelector("#venue-calendar-previous").addEventListener("click", () => {
  venueCalendarDate.setMonth(venueCalendarDate.getMonth() - 1);
  expandedVenueCalendarDays.clear();
  renderVenueCalendar();
});
document.querySelector("#venue-calendar-next").addEventListener("click", () => {
  venueCalendarDate.setMonth(venueCalendarDate.getMonth() + 1);
  expandedVenueCalendarDays.clear();
  renderVenueCalendar();
});
document.querySelector("#venue-calendar-today").addEventListener("click", () => {
  const today = new Date();
  venueCalendarDate.setFullYear(today.getFullYear(), today.getMonth(), 1);
  expandedVenueCalendarDays.clear();
  renderVenueCalendar();
});
document.querySelector("#venue-calendar-month").addEventListener("change", (event) => {
  const match = /^(\d{4})-(\d{2})$/.exec(event.currentTarget.value);
  if (!match) return;
  venueCalendarDate.setFullYear(Number(match[1]), Number(match[2]) - 1, 1);
  expandedVenueCalendarDays.clear();
  renderVenueCalendar();
});
document.querySelector("#venue-calendar-location").addEventListener("change", (event) => {
  venueCalendarLocation = event.currentTarget.value;
  expandedVenueCalendarDays.clear();
  renderVenueCalendar();
});

if (!isConfigured) {
  showStatus("Configuration Firebase manquante : renseignez les valeurs dans firebase-config.js puis rechargez la page.", true);
} else {
  const firebaseApp = initializeApp(getFirebaseConfig(firebaseConfig));
  auth = getAuth(firebaseApp);
  db = getFirestore(firebaseApp);
  connectFirebaseEmulators({ auth, db });
  onAuthStateChanged(auth, async (user) => {
    loginPanel.classList.toggle("hidden", Boolean(user));
    adminPanel.classList.toggle("hidden", !user);
    adminStickyControls.classList.toggle("hidden", !user);
    signOutButton.classList.toggle("hidden", !user);
    agentCalendarLink.classList.toggle(
      "hidden",
      !user || !user.emailVerified || user.email?.trim().toLocaleLowerCase("fr") !== "luc.cesbron@sdis53.fr"
    );
    verificationNotice.classList.toggle("hidden", !user || user.emailVerified);
    if (user) {
      document.querySelector("#signed-in-as").textContent = `Connecté en tant que ${user.email || user.uid}`;
      const email = user.email?.trim().toLocaleLowerCase("fr");
      if (!user.emailVerified) {
        showStatus("Accès Firestore refusé : vérifiez l’adresse e-mail du compte dans Firebase Authentication, puis déconnectez-vous et reconnectez-vous.", true);
      } else if (!isAuthorizedAdminEmail(email)) {
        showStatus("Accès Firestore réservé aux adresses administrateur autorisées. Ajoutez cette adresse dans app.js, firestore.rules et le Worker Cloudflare.", true);
      } else {
        try {
          await user.getIdToken(true);
        } catch (error) {
          showStatus(`Impossible d’actualiser la session Firebase : ${error.message}`, true);
        }
        try {
          if (requestedCatalogVersionId) {
            const versionSnapshot = await getDoc(doc(db, "catalogVersions", requestedCatalogVersionId));
            const version = versionSnapshot.exists() ? versionSnapshot.data() : null;
            if (!version || !["draft", "corrections_requested"].includes(version.status)) {
              throw new Error("Cette version n’existe pas ou ne peut plus être modifiée.");
            }
            activeCatalogVersionId = requestedCatalogVersionId;
            setCatalogVersionEditing(requestedCatalogVersionId, `${version.title} · ${version.year}`);
            document.querySelector("#admin-page-title").textContent = "Modifier une copie de relecture";
            catalogLink.classList.add("hidden");
            await loadAllCollections();
            showStatus("Copie chargée pour modification. Les changements restent isolés du catalogue public.");
          } else {
            await loadMaintenanceSetting();
            await loadAllCollections();
          }
        } catch (error) {
          showStatus(`Impossible de charger l’administration : ${error.message}`, true);
        }
      }
    } else {
      document.querySelector("#signed-in-as").textContent = "";
      document.querySelector("#trainings-list").replaceChildren();
      document.querySelector("#announcements-list").replaceChildren();
      document.querySelector("#categories-list").replaceChildren();
      document.querySelector("#locations-list").replaceChildren();
      document.querySelector("#contacts-list").replaceChildren();
      document.querySelector("#important-information-categories").replaceChildren();
      document.querySelector("#important-information-admin-list").replaceChildren();
      document.querySelector("#venue-calendar-grid").replaceChildren();
      document.querySelector("#venue-calendar-agenda").replaceChildren();
      document.querySelector("#venue-calendar-session-count").textContent = "";
      document.querySelector("#venue-calendar-status").textContent = "";
      document.querySelector("#venue-calendar-statistics-summary").replaceChildren();
      document.querySelector("#venue-calendar-subcategory-statistics").replaceChildren();
      document.querySelector("#venue-calendar-location-statistics").replaceChildren();
      document.querySelector("#venue-calendar-location").replaceChildren(new Option("Tous les lieux", ""));
      setCatalogVersionEditing("");
      trainingCategories = new Map();
      loadedTrainings = [];
      loadedLocations = [];
      venueCalendarLoadError = "";
      venueCalendarLocation = "";
      loadedContacts = [];
      loadedImportantInformation = [];
      loadedImportantInformationCategories = [];
    }
  });
}
