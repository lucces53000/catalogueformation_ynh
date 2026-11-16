import { firebaseConfig } from "./firebase-config.js";
import {
  connectFirebaseEmulators,
  getFirebaseConfig
} from "./firebase-environment.js";
import { initializeApp } from "https://www.gstatic.com/firebasejs/11.10.0/firebase-app.js";
import {
  collection,
  getFirestore,
  onSnapshot
} from "https://www.gstatic.com/firebasejs/11.10.0/firebase-firestore.js";

const app = initializeApp(getFirebaseConfig(firebaseConfig));
const db = getFirestore(app);
connectFirebaseEmulators({ db });
const trainingsList = document.querySelector("#trainings-list");
const announcementsList = document.querySelector("#announcements-list");
const trainingSearch = document.querySelector("#training-search");
const trainingCount = document.querySelector("#training-count");
const pageStatus = document.querySelector("#page-status");
const trainingModal = document.querySelector("#training-modal");
const trainingModalTitle = document.querySelector("#training-modal-title");
const trainingModalCategory = document.querySelector("#training-modal-category");
const trainingModalSubcategory = document.querySelector("#training-modal-subcategory");
const trainingModalDuration = document.querySelector("#training-modal-duration");
const trainingModalSessions = document.querySelector("#training-modal-sessions");
const trainingModalContent = document.querySelector("#training-modal-content");
const importantInformationList = document.querySelector("#important-information-list");
const printCatalogButton = document.querySelector("#print-catalog");
const catalogPrintView = document.querySelector("#catalog-print-view");
const isCalendarPage = Boolean(document.querySelector("#training-calendar"));
let trainings = [];
let categories = new Map();
let importantInformation = [];
let currentImportantInformationCategories = [];
const publicCollections = [
  "trainings",
  "announcements",
  "trainingCategories",
  "importantInformation",
  "importantInformationCategories"
];
const loadedCollections = new Set();
const collectionErrors = new Map();

function showStatus(message, isError = false) {
  pageStatus.textContent = message;
  pageStatus.className = `mt-4 mb-0${isError ? " text-danger" : " text-secondary"}`;
}

function isHexColor(value) {
  return typeof value === "string" && /^#[0-9a-f]{6}$/i.test(value);
}

function categoryColor(category) {
  const color = categories.get(category)?.color;
  return isHexColor(color) ? color : "#205b98";
}

function subCategoryColor(category, subCategory) {
  const color = categories.get(category)?.subCategories.get(subCategory)?.color;
  return isHexColor(color) ? color : "#205b98";
}

function createElement(tag, className, text) {
  const element = document.createElement(tag);
  if (className) element.className = className;
  if (text !== undefined && text !== null) element.textContent = String(text);
  return element;
}

function createIcon(name) {
  const paths = {
    clock: "M12 8v4l2.5 2.5M21 12a9 9 0 1 1-18 0 9 9 0 0 1 18 0Z",
    calendar: "M8 2v4m8-4v4M3 10h18M5 4h14a2 2 0 0 1 2 2v14H3V6a2 2 0 0 1 2-2Z",
    check: "m5 12 4 4L19 6",
    eye: "M2 12s3.5-7 10-7 10 7 10 7-3.5 7-10 7-10-7-10-7Z M12 9a3 3 0 1 0 0 6 3 3 0 0 0 0-6Z",
    note: "M8 6h13M8 12h13M8 18h13M3 6h.01M3 12h.01M3 18h.01",
    location: "M20 10c0 5-8 12-8 12S4 15 4 10a8 8 0 1 1 16 0Z M12 10a2.5 2.5 0 1 0 0-5 2.5 2.5 0 0 0 0 5Z",
    person: "M20 21a8 8 0 0 0-16 0M12 13a5 5 0 1 0 0-10 5 5 0 0 0 0 10Z",
    book: "M4 19.5A2.5 2.5 0 0 1 6.5 17H20M6.5 2H20v20H6.5A2.5 2.5 0 0 1 4 19.5v-15A2.5 2.5 0 0 1 6.5 2Z"
  };
  const icon = document.createElementNS("http://www.w3.org/2000/svg", "svg");
  icon.setAttribute("viewBox", "0 0 24 24");
  icon.setAttribute("width", "16");
  icon.setAttribute("height", "16");
  icon.setAttribute("fill", "none");
  icon.setAttribute("stroke", "currentColor");
  icon.setAttribute("stroke-width", "2");
  icon.setAttribute("stroke-linecap", "round");
  icon.setAttribute("stroke-linejoin", "round");
  icon.setAttribute("aria-hidden", "true");
  const path = document.createElementNS("http://www.w3.org/2000/svg", "path");
  path.setAttribute("d", paths[name]);
  icon.append(path);
  return icon;
}

function createDurationBadge(duration) {
  const badge = createElement("span", "badge rounded-pill training-duration-badge");
  badge.append(createIcon("clock"), document.createTextNode(duration));
  return badge;
}

function scheduledSessionCount(training) {
  const phases = Array.isArray(training.phases) ? training.phases : [];
  if (phases.length > 0) return phases.length;
  return Array.isArray(training.sessions) ? training.sessions.length : 0;
}

function createSessionCountBadge(count) {
  const label = `${count} session${count === 1 ? "" : "s"}`;
  const badge = createElement("span", "badge rounded-pill training-sessions-badge", label);
  badge.prepend(createIcon("calendar"));
  return badge;
}

function sessionLabel(session) {
  const dateLabel = formatTrainingSessionDate(session);
  const parts = [session.sessionName, dateLabel].filter((value) =>
    typeof value === "string" && value.trim()
  );
  return parts.join(" · ") || "Dates non renseignées";
}

function formatTrainingSessionDate(session) {
  if (typeof session.startDate !== "string" || !/^\d{4}-\d{2}-\d{2}$/.test(session.startDate)) {
    return session.dates;
  }
  if (session.endDate) return session.dates;

  const [year, month, day] = session.startDate.split("-").map(Number);
  const date = new Date(Date.UTC(year, month - 1, day));
  if (date.toISOString().slice(0, 10) !== session.startDate) return session.dates;
  return new Intl.DateTimeFormat("fr-FR", {
    weekday: "long",
    day: "numeric",
    month: "long",
    year: "numeric",
    timeZone: "UTC"
  }).format(date);
}

function appendDetailCard(container, title, content, iconName) {
  if (!content) return;
  const column = createElement("div", "col-12");
  const card = createElement("section", `card detail-card detail-card-${iconName} h-100`);
  const body = createElement("div", "card-body");
  const heading = createElement("h3", "h6 card-title detail-card-title");
  heading.append(createIcon(iconName), createElement("span", "", title));
  body.append(heading);
  if (typeof content === "string") {
    body.append(createElement("p", "card-text detail-card-text mb-0", content));
  } else {
    body.append(content);
  }
  card.append(body);
  column.append(card);
  container.append(column);
}

function createSessionList(sessions) {
  if (sessions.length === 0) return null;
  const list = createElement("div", "list-group list-group-flush");
  [...sessions]
    .sort((left, right) =>
      String(left.startDate || "9999-12-31").localeCompare(String(right.startDate || "9999-12-31"), "en")
    )
    .forEach((session) => {
      const item = createElement("div", `list-group-item px-0${session.cancelled === true ? " is-cancelled-session" : ""}`);
      item.append(createElement("div", "fw-semibold", sessionLabel(session)));
      if (session.cancelled === true) {
        item.append(createElement("span", "session-cancelled-badge", "Session annulée"));
        if (session.cancellationReason) {
          item.append(createElement("p", "session-cancellation-reason mb-0 mt-1", `Motif : ${session.cancellationReason}`));
        }
      }
      const location = createElement("div", "small text-secondary mt-1 d-flex align-items-start gap-2");
      location.append(createIcon("location"), createElement("span", "", session.location || "Lieu non renseigné"));
      item.append(location);
      list.append(item);
    });
  return list;
}

function createPhaseList(phases) {
  if (phases.length === 0) return null;
  const list = createElement("div", "vstack gap-3");
  phases.forEach((phase, index) => {
    const phaseCard = createElement("section", "phase-detail-card");
    phaseCard.append(createElement("h4", "h6 mb-2", phase.phaseTitle || `Phase ${index + 1}`));
    const sessions = createSessionList(Array.isArray(phase.sessions) ? phase.sessions : []);
    if (sessions) phaseCard.append(sessions);
    list.append(phaseCard);
  });
  return list;
}

function openTrainingModal(training) {
  const category = String(training.category || "").trim() || "Sans catégorie";
  const subCategory = String(training.subCategory || "").trim();
  const accentColor = subCategory
    ? subCategoryColor(category, subCategory)
    : categoryColor(category);
  trainingModalTitle.textContent = training.title || training.id || "Formation sans titre";
  trainingModalCategory.textContent = category;
  trainingModalSubcategory.textContent = subCategory;
  trainingModalSubcategory.hidden = !subCategory;
  trainingModalSubcategory.style.setProperty("--subcategory-color", accentColor);
  trainingModalSubcategory.style.setProperty("--subcategory-bg", accentColor);
  trainingModalSessions.hidden = true;
  trainingModalSessions.replaceChildren();
  const sessionCount = scheduledSessionCount(training);
  if (sessionCount > 0) {
    const sessionBadge = createSessionCountBadge(sessionCount);
    trainingModalSessions.replaceChildren(...sessionBadge.childNodes);
    trainingModalSessions.hidden = false;
  }
  trainingModalDuration.hidden = !training.duration;
  trainingModalDuration.replaceChildren();
  if (training.duration) {
    trainingModalDuration.append(createIcon("clock"), document.createTextNode(training.duration));
  }
  trainingModal.querySelector(".training-modal-header").style.setProperty("--training-accent", accentColor);
  trainingModalContent.replaceChildren();

  const sheet = createElement("div", "training-sheet");
  if (training.summary) {
    const description = createElement("section", "training-description");
    const heading = createElement("h3", "training-section-title");
    heading.append(createIcon("book"), createElement("span", "", "Présentation"));
    description.append(heading);
    description.append(createElement("p", "training-description-text mb-0", training.summary));
    sheet.append(description);
  }

  const prerequisiteTrainings = (Array.isArray(training.prerequisiteTrainingIds)
    ? training.prerequisiteTrainingIds
    : [])
    .map((id) => trainings.find((item) => item.id === id))
    .filter((item) => item && item.id !== training.id && item.published !== false);
  if (prerequisiteTrainings.length > 0) {
    const cards = createElement("div", "prerequisite-training-cards");
    prerequisiteTrainings.forEach((prerequisite) => {
      const card = createElement("button", "prerequisite-training-card");
      card.type = "button";
      card.setAttribute(
        "aria-label",
        `Ouvrir la fiche de la formation prérequise ${prerequisite.title || prerequisite.id}`
      );
      const category = [prerequisite.category, prerequisite.subCategory].filter(Boolean).join(" · ");
      const accentColor = prerequisite.subCategory
        ? subCategoryColor(prerequisite.category, prerequisite.subCategory)
        : categoryColor(prerequisite.category);
      card.style.setProperty("--training-accent", accentColor);
      if (category) card.append(createElement("span", "prerequisite-training-category", category));
      card.append(createElement("span", "prerequisite-training-title", prerequisite.title || prerequisite.id));
      card.addEventListener("click", () => {
        trainingModal.close();
        openTrainingModal(prerequisite);
      });
      cards.append(card);
    });
    appendDetailCard(sheet, "Formations prérequises", cards, "book");
  }
  if (training.prerequisites) {
    const requirements = createElement("ul", "prerequisite-list list-unstyled mb-0");
    String(training.prerequisites).split(/\r?\n/).map((item) => item.trim()).filter(Boolean).forEach((item) => {
      const row = createElement("li", "prerequisite-item");
      row.append(createIcon("check"), createElement("span", "", item));
      requirements.append(row);
    });
    appendDetailCard(sheet, "Prérequis", requirements, "check");
  }
  if (training.observations) {
    appendDetailCard(sheet, "Observations", training.observations, "eye");
  }

  const directSessions = Array.isArray(training.sessions) ? training.sessions : [];
  const sessionList = createSessionList(directSessions);
  if (sessionList) appendDetailCard(sheet, directSessions.length > 1 ? "Sessions" : "Session", sessionList, "calendar");
  const phaseList = createPhaseList(Array.isArray(training.phases) ? training.phases : []);
  if (phaseList) appendDetailCard(sheet, "Sessions", phaseList, "calendar");

  const contactName = training.contactName || training.contact || "";
  const contactPhone = training.contactPhone || "";
  const contactEmail = training.contactEmail || "";
  if (contactName || contactPhone || contactEmail) {
    const contact = createElement("div", "vstack gap-1");
    if (contactName) contact.append(createElement("div", "fw-semibold", contactName));
    if (contactPhone) {
      const phone = createElement("a", "", contactPhone);
      phone.href = `tel:${contactPhone.replace(/[^\d+]/g, "")}`;
      contact.append(phone);
    }
    if (contactEmail) {
      const email = createElement("a", "", contactEmail);
      email.href = `mailto:${contactEmail}`;
      contact.append(email);
    }
    appendDetailCard(sheet, "Contact", contact, "person");
  }

  if (!sheet.childElementCount) {
    sheet.append(createElement("p", "text-secondary mb-0", "Aucune information descriptive n’est renseignée pour cette formation."));
  }
  trainingModalContent.append(sheet);
  trainingModal.showModal();
}

function trainingMatchesSearch(training, search) {
  if (!search) return true;
  const sessions = [
    ...(Array.isArray(training.sessions) ? training.sessions : []),
    ...(Array.isArray(training.phases) ? training.phases.flatMap((phase) => phase.sessions || []) : [])
  ];
  const searchableText = [
    training.title,
    training.category,
    training.subCategory,
    training.summary,
    training.duration,
    training.prerequisites,
    training.observations,
    training.contactName,
    training.contact,
    ...sessions.flatMap((session) => [session.sessionName, session.dates, session.location])
  ].filter(Boolean).join(" ").toLocaleLowerCase("fr");
  return searchableText.includes(search);
}

function renderTrainings() {
  trainingsList.replaceChildren();
  const search = trainingSearch.value.trim().toLocaleLowerCase("fr");
  const filtered = trainings.filter((training) =>
    training.published !== false && trainingMatchesSearch(training, search)
  );
  trainingCount.textContent = `${filtered.length} formation${filtered.length > 1 ? "s" : ""}`;

  if (filtered.length === 0) {
    trainingsList.append(createElement("p", "text-secondary", search
      ? "Aucune formation ne correspond à votre recherche."
      : "Aucune formation disponible."));
    return;
  }

  const groups = new Map();
  filtered.forEach((training) => {
    const categoryName = String(training.category || "").trim() || "Sans catégorie";
    if (!groups.has(categoryName)) groups.set(categoryName, []);
    groups.get(categoryName).push(training);
  });

  [...groups.entries()]
    .sort(([left], [right]) =>
      (categories.get(left)?.order ?? Number.POSITIVE_INFINITY) -
        (categories.get(right)?.order ?? Number.POSITIVE_INFINITY) ||
      left.localeCompare(right, "fr")
    )
    .forEach(([category, records], index) => {
      const accordion = createElement("details", "training-category");
      accordion.open = index === 0;
      accordion.style.setProperty("--category-color", categoryColor(category));
      const summary = createElement("summary", "training-category-summary");
      summary.append(createElement("span", "", category));
      summary.append(createElement("span", "badge rounded-pill text-bg-light", `${records.length} formation${records.length > 1 ? "s" : ""}`));
      accordion.append(summary);
      const cardGrid = createElement("div", "training-card-grid row g-3");
      records.sort((left, right) =>
        (Number.isFinite(left.order) ? left.order : Number.POSITIVE_INFINITY) -
          (Number.isFinite(right.order) ? right.order : Number.POSITIVE_INFINITY) ||
        String(left.title || left.id).localeCompare(String(right.title || right.id), "fr")
      );
      records.forEach((training) => {
        const sessionCount = scheduledSessionCount(training);
        const column = createElement("div", "col-12 col-md-6 col-xl-4");
        const record = createElement("button", "card training-card text-start h-100 w-100");
        record.type = "button";
        record.setAttribute("aria-label", `Ouvrir la fiche de ${training.title || training.id || "la formation"}`);
        record.title = "Ouvrir la fiche de présentation";
        const accentColor = training.subCategory
          ? subCategoryColor(category, training.subCategory)
          : categoryColor(category);
        record.style.setProperty("--training-accent", accentColor);
        const body = createElement("span", "card-body d-flex flex-column align-items-start");
        body.append(createElement("span", "training-title mb-2", training.title || training.id || "Formation sans titre"));
        const badges = createElement("span", "d-flex flex-wrap align-items-center gap-2");
        if (training.subCategory) {
          const subcategory = createElement("span", "badge rounded-pill subcategory-badge", training.subCategory);
          subcategory.style.setProperty("--subcategory-color", accentColor);
          subcategory.style.setProperty("--subcategory-bg", accentColor);
          badges.append(subcategory);
        }
        if (training.duration) {
          badges.append(createDurationBadge(training.duration));
        }
        if (sessionCount > 0) badges.append(createSessionCountBadge(sessionCount));
        if (badges.childElementCount) body.append(badges);
        record.append(body);
        record.addEventListener("click", () => openTrainingModal(training));
        column.append(record);
        cardGrid.append(column);
      });
      accordion.append(cardGrid);

      accordion.addEventListener("toggle", () => {
        if (!accordion.open) return;
        trainingsList.querySelectorAll(".training-category").forEach((other) => {
          if (other !== accordion) other.open = false;
        });
      });
      trainingsList.append(accordion);
    });
}

function announcementStyle(type) {
  const normalized = String(type || "INFO").trim().toLocaleUpperCase("fr");
  if (["ADDED", "AJOUT"].includes(normalized)) {
    return { variant: "added", text: "#0f5132", background: "#d1e7dd", border: "#a3cfbb" };
  }
  if (["CANCELLED", "CANCELED", "ANNULATION"].includes(normalized)) {
    return { variant: "cancelled", text: "#842029", background: "#f8d7da", border: "#f1aeb5" };
  }
  if (["MODIFIED", "MODIFICATION"].includes(normalized)) {
    return { variant: "modified", text: "#664d03", background: "#fff3cd", border: "#ffe69c" };
  }
  return { variant: "info", text: "#055160", background: "#cff4fc", border: "#9eeaf9" };
}

function announcementOrder(announcement) {
  const numericId = Number(announcement.id);
  return Number.isFinite(numericId) ? numericId : Number.NEGATIVE_INFINITY;
}

function renderAnnouncements(records) {
  announcementsList.replaceChildren();
  if (records.length === 0) {
    announcementsList.append(createElement("div", "col-12", "Aucune actualité ou information disponible."));
    return;
  }

  records.sort((left, right) => announcementOrder(right) - announcementOrder(left));
  records.forEach((announcement) => {
    const column = createElement("div", "col-12");
    const style = announcementStyle(announcement.type);
    const card = createElement("article", `alert announcement-card announcement-card--${style.variant} mb-0`);
    card.style.setProperty("--announcement-text", style.text);
    card.style.setProperty("--announcement-background", style.background);
    card.style.setProperty("--announcement-border", style.border);
    card.append(createElement("h3", "h5", announcement.title || "Information"));
    card.append(createElement("p", "mb-0", announcement.message || ""));
    if (announcement.date) {
      const date = createElement("time", "announcement-date small text-end mt-3", announcement.date);
      card.append(date);
    }
    column.append(card);
    announcementsList.append(column);
  });
}

function formatImportantDate(value) {
  if (!value) return "À définir";
  const dateMatch = /^(\d{4})-(\d{2})-(\d{2})$/.exec(value);
  if (!dateMatch) return value;
  const date = new Date(Date.UTC(Number(dateMatch[1]), Number(dateMatch[2]) - 1, Number(dateMatch[3])));
  if (date.toISOString().slice(0, 10) !== value) return value;
  return new Intl.DateTimeFormat("fr-FR", {
    weekday: "long",
    day: "numeric",
    month: "long",
    year: "numeric",
    timeZone: "UTC"
  }).format(date);
}

function renderImportantInformation(records, categoryRecords) {
  importantInformationList.replaceChildren();
  const published = records.filter((record) => record.published !== false);
  const visibleCategories = categoryRecords
    .map((category) => ({
      ...category,
      records: published.filter((record) => record.categoryId === category.id)
    }))
    .filter((category) => category.records.length > 0)
    .sort((left, right) =>
      (Number.isFinite(left.order) ? left.order : Number.POSITIVE_INFINITY) -
        (Number.isFinite(right.order) ? right.order : Number.POSITIVE_INFINITY) ||
      String(left.name || "").localeCompare(String(right.name || ""), "fr")
    );

  if (visibleCategories.length === 0) {
    importantInformationList.append(createElement("p", "text-secondary", "Aucune date ou information à retenir pour le moment."));
    return;
  }

  visibleCategories.forEach((category) => {
    const section = createElement("section", "important-info-public-category");
    const color = isHexColor(category.color) ? category.color : "#205b98";
    section.style.setProperty("--important-info-color", color);
    section.append(createElement("h3", "important-info-public-category-title", category.name));
    const entries = createElement("div", "important-info-public-entries");
    category.records
      .sort((left, right) =>
        (Number.isFinite(left.order) ? left.order : Number.POSITIVE_INFINITY) -
          (Number.isFinite(right.order) ? right.order : Number.POSITIVE_INFINITY) ||
        String(left.title || "").localeCompare(String(right.title || ""), "fr")
      )
      .forEach((record) => {
        const type = ["date", "text", "reminder"].includes(record.type) ? record.type : "text";
        const card = createElement("article", `important-info-public-card important-info-${type}`);
        card.style.setProperty("--important-info-color", color);
        const heading = createElement("h4", "important-info-public-title", record.title || "Information");
        card.append(heading);
        if (record.description) {
          card.append(createElement("p", "important-info-public-description", record.description));
        }
        if (Array.isArray(record.dates) && record.dates.length > 0) {
          const dateList = createElement("ul", "important-info-public-dates list-unstyled mb-0");
          record.dates.forEach((entry) => {
            const row = createElement("li", "important-info-public-date");
            row.append(createIcon("calendar"));
            const dateContent = createElement("span", "important-info-date-content");
            const dateTitle = [formatImportantDate(entry.date), entry.label].filter(Boolean).join(" · ");
            dateContent.append(createElement("strong", "", dateTitle));
            if (entry.location) {
              const location = createElement("span", "important-info-location");
              location.append(createIcon("location"), createElement("span", "", entry.location));
              dateContent.append(location);
            }
            row.append(dateContent);
            dateList.append(row);
          });
          card.append(dateList);
        }
        if (record.recurrence) {
          card.append(createElement("p", "important-info-recurrence mb-0", record.recurrence));
        }
        entries.append(card);
      });
    section.append(entries);
    importantInformationList.append(section);
  });
}

function sortCatalogTrainings(records) {
  return [...records].sort((left, right) =>
    (Number.isFinite(left.order) ? left.order : Number.POSITIVE_INFINITY) -
      (Number.isFinite(right.order) ? right.order : Number.POSITIVE_INFINITY) ||
    String(left.title || left.id).localeCompare(String(right.title || right.id), "fr")
  );
}

function appendPrintTextBlock(container, title, text) {
  if (!text) return;
  const block = createElement("section", "catalog-print-block");
  block.append(createElement("h2", "catalog-print-block-title", title));
  block.append(createElement("p", "catalog-print-copy", text));
  container.append(block);
}

function createPrintListBlock(title, items) {
  if (items.length === 0) return null;
  const block = createElement("section", "catalog-print-block");
  block.append(createElement("h2", "catalog-print-block-title", title));
  const list = createElement("ul", "catalog-print-copy-list");
  items.forEach((item) => list.append(createElement("li", "", item)));
  block.append(list);
  return block;
}

function createPrintSessionList(sessions) {
  if (sessions.length === 0) return null;
  const list = createElement("ul", "catalog-print-session-list");
  if (sessions.length === 1) list.classList.add("catalog-print-single-session");
  [...sessions]
    .sort((left, right) =>
      String(left.startDate || "9999-12-31").localeCompare(String(right.startDate || "9999-12-31"), "en")
    )
    .forEach((session) => {
      const item = createElement("li", "catalog-print-session");
      const title = createElement("div", "catalog-print-session-title", sessionLabel(session));
      item.append(title);
      if (session.cancelled === true) {
        item.append(createElement("span", "catalog-print-cancelled", "Session annulée"));
        if (session.cancellationReason) {
          item.append(createElement("p", "catalog-print-copy", `Motif : ${session.cancellationReason}`));
        }
      }
      item.append(createElement("p", "catalog-print-session-location", `Lieu : ${session.location || "Non renseigné"}`));
      list.append(item);
    });
  return list;
}

function createPrintTrainingPage(training, category) {
  const subCategory = String(training.subCategory || "").trim();
  const accentColor = subCategory
    ? subCategoryColor(category, subCategory)
    : categoryColor(category);
  const page = createElement("article", "catalog-print-page catalog-print-training");
  page.style.setProperty("--category-color", categoryColor(category));
  page.style.setProperty("--training-accent", accentColor);

  const heading = createElement("header", "catalog-print-training-heading");
  heading.append(createElement("p", "catalog-print-category-label", category));
  heading.append(createElement("h1", "catalog-print-training-title", training.title || training.id || "Formation sans titre"));
  const badges = createElement("div", "catalog-print-badges");
  if (subCategory) {
    badges.append(createElement("span", "catalog-print-subcategory", subCategory));
  }
  if (training.duration) {
    badges.append(createElement("span", "catalog-print-duration", `Durée : ${training.duration}`));
  }
  if (badges.childElementCount) heading.append(badges);
  page.append(heading);

  appendPrintTextBlock(page, "Présentation", training.summary);

  const prerequisiteTrainings = (Array.isArray(training.prerequisiteTrainingIds)
    ? training.prerequisiteTrainingIds
    : [])
    .map((id) => trainings.find((item) => item.id === id))
    .filter((item) => item && item.id !== training.id && item.published !== false);
  const requirements = String(training.prerequisites || "").split(/\r?\n/).map((item) => item.trim()).filter(Boolean);
  const prerequisiteColumns = createElement("div", "catalog-print-columns");
  const prerequisiteTrainingBlock = createPrintListBlock(
    "Formations prérequises",
    prerequisiteTrainings.map((item) => item.title || item.id)
  );
  const prerequisiteBlock = createPrintListBlock("Prérequis", requirements);
  if (prerequisiteTrainingBlock) prerequisiteColumns.append(prerequisiteTrainingBlock);
  if (prerequisiteBlock) prerequisiteColumns.append(prerequisiteBlock);
  if (prerequisiteColumns.childElementCount) {
    if (prerequisiteColumns.childElementCount === 1) prerequisiteColumns.classList.add("catalog-print-single-column");
    page.append(prerequisiteColumns);
  }

  const directSessions = Array.isArray(training.sessions) ? training.sessions : [];
  const sessionList = createPrintSessionList(directSessions);
  const scheduleColumns = createElement("div", "catalog-print-columns");
  if (sessionList) {
    const block = createElement("section", "catalog-print-block");
    block.append(createElement("h2", "catalog-print-block-title", directSessions.length > 1 ? "Sessions" : "Session"));
    block.append(sessionList);
    scheduleColumns.append(block);
  }

  const phases = Array.isArray(training.phases) ? training.phases : [];
  if (phases.length > 0) {
    const block = createElement("section", "catalog-print-block");
    block.append(createElement("h2", "catalog-print-block-title", "Phases et sessions"));
    const phaseList = createElement("div", "catalog-print-phase-list");
    if (phases.length === 1) phaseList.classList.add("catalog-print-single-phase");
    phases.forEach((phase, index) => {
      const phaseSection = createElement("section", "catalog-print-phase");
      phaseSection.append(createElement("h3", "catalog-print-phase-title", phase.phaseTitle || `Phase ${index + 1}`));
      const sessions = createPrintSessionList(Array.isArray(phase.sessions) ? phase.sessions : []);
      if (sessions) phaseSection.append(sessions);
      phaseList.append(phaseSection);
    });
    block.append(phaseList);
    scheduleColumns.append(block);
  }
  if (scheduleColumns.childElementCount) {
    if (scheduleColumns.childElementCount === 1) scheduleColumns.classList.add("catalog-print-single-column");
    page.append(scheduleColumns);
  }

  const contactName = training.contactName || training.contact || "";
  const contactPhone = training.contactPhone || "";
  const contactEmail = training.contactEmail || "";
  if (training.observations) {
    const observations = createElement("section", "catalog-print-block");
    observations.append(createElement("h2", "catalog-print-block-title", "Observations"));
    observations.append(createElement("p", "catalog-print-copy", training.observations));
    page.append(observations);
  }
  if (contactName || contactPhone || contactEmail) {
    const contact = createElement("section", "catalog-print-block");
    contact.append(createElement("h2", "catalog-print-block-title", "Contact"));
    if (contactName) contact.append(createElement("p", "catalog-print-copy", contactName));
    if (contactPhone) contact.append(createElement("p", "catalog-print-copy", `Téléphone : ${contactPhone}`));
    if (contactEmail) contact.append(createElement("p", "catalog-print-copy", `Courriel : ${contactEmail}`));
    page.append(contact);
  }

  if (page.childElementCount === 1) {
    page.append(createElement("p", "catalog-print-copy", "Aucune information descriptive n’est renseignée pour cette formation."));
  }
  return page;
}

function createPrintImportantInformationPage() {
  const page = createElement("section", "catalog-print-page catalog-print-important");
  page.append(createElement("p", "catalog-print-eyebrow", "SDIS 53 · Catalogue des formations"));
  page.append(createElement("h1", "catalog-print-important-title", "Dates et informations à retenir"));

  const published = importantInformation.filter((record) => record.published !== false);
  const visibleCategories = currentImportantInformationCategories
    .map((category) => ({
      ...category,
      records: published.filter((record) => record.categoryId === category.id)
    }))
    .filter((category) => category.records.length > 0)
    .sort((left, right) =>
      (Number.isFinite(left.order) ? left.order : Number.POSITIVE_INFINITY) -
        (Number.isFinite(right.order) ? right.order : Number.POSITIVE_INFINITY) ||
      String(left.name || "").localeCompare(String(right.name || ""), "fr")
    );

  if (visibleCategories.length === 0) {
    page.append(createElement("p", "catalog-print-copy", "Aucune date ou information à retenir pour le moment."));
  }

  visibleCategories.forEach((category) => {
    const color = isHexColor(category.color) ? category.color : "#205b98";
    const section = createElement("section", "catalog-print-info-category");
    section.style.setProperty("--important-info-color", color);
    section.append(createElement("h2", "catalog-print-info-category-title", category.name || "Informations"));
    [...category.records]
      .sort((left, right) =>
        (Number.isFinite(left.order) ? left.order : Number.POSITIVE_INFINITY) -
          (Number.isFinite(right.order) ? right.order : Number.POSITIVE_INFINITY) ||
        String(left.title || "").localeCompare(String(right.title || ""), "fr")
      )
      .forEach((record) => {
        const type = ["date", "text", "reminder"].includes(record.type) ? record.type : "text";
        const card = createElement("article", `catalog-print-info-card catalog-print-info-${type}`);
        card.append(createElement("h3", "catalog-print-info-title", record.title || "Information"));
        if (record.description) {
          card.append(createElement("p", "catalog-print-copy", record.description));
        }
        if (Array.isArray(record.dates) && record.dates.length > 0) {
          const dateList = createElement("ul", "catalog-print-copy-list");
          record.dates.forEach((entry) => {
            const details = [formatImportantDate(entry.date), entry.label].filter(Boolean).join(" · ");
            const item = createElement("li", "", entry.location ? `${details} · ${entry.location}` : details);
            dateList.append(item);
          });
          card.append(dateList);
        }
        if (record.recurrence) {
          card.append(createElement("p", "catalog-print-recurrence", record.recurrence));
        }
        section.append(card);
      });
    page.append(section);
  });
  return page;
}

function renderPrintableCatalog() {
  if (!catalogPrintView) return;
  const visibleTrainings = trainings.filter((training) => training.published !== false);
  const groups = new Map();
  visibleTrainings.forEach((training) => {
    const category = String(training.category || "").trim() || "Sans catégorie";
    if (!groups.has(category)) groups.set(category, []);
    groups.get(category).push(training);
  });
  const orderedGroups = [...groups.entries()].sort(([left], [right]) =>
    (categories.get(left)?.order ?? Number.POSITIVE_INFINITY) -
      (categories.get(right)?.order ?? Number.POSITIVE_INFINITY) ||
    left.localeCompare(right, "fr")
  );

  catalogPrintView.replaceChildren();
  orderedGroups.forEach(([category, records], index) => {
    const color = categoryColor(category);
    const subCategories = [...new Set(records.map((record) => String(record.subCategory || "").trim()).filter(Boolean))];
    const cover = createElement("section", `catalog-print-cover${index > 0 ? " catalog-print-page" : ""}`);
    cover.style.setProperty("--category-color", color);
    const brand = createElement("div", "catalog-print-brand");
    const logo = document.createElement("img");
    logo.src = "./logo.png";
    logo.alt = "SDIS 53 de la Mayenne";
    brand.append(logo);
    cover.append(brand, createElement("div", "catalog-print-cover-rule"));
    cover.append(createElement("h1", "catalog-print-cover-title", category));
    cover.append(createElement("p", "catalog-print-cover-subtitle", "Programme de formation"));
    cover.append(createElement("p", "catalog-print-cover-count", `${records.length} formation${records.length === 1 ? "" : "s"}`));
    if (subCategories.length > 0) {
      const subcategoryList = createElement("div", "catalog-print-cover-subcategories");
      subcategoryList.append(createElement("span", "catalog-print-cover-label", "Sous-catégories"));
      subcategoryList.append(createElement("p", "catalog-print-copy", subCategories.join(" · ")));
      cover.append(subcategoryList);
    }
    catalogPrintView.append(cover);
    sortCatalogTrainings(records).forEach((training) => {
      catalogPrintView.append(createPrintTrainingPage(training, category));
    });
  });
  catalogPrintView.append(createPrintImportantInformationPage());
}

function categoryMapFromSnapshot(snapshot) {
  const categoryEntries = [];
  snapshot.docs.forEach((item) => {
    if (item.id === "__settings__") return;
    const data = item.data();
    const subCategories = new Map();
    (Array.isArray(data.subCategories) ? data.subCategories : []).forEach((entry) => {
      const name = typeof entry === "string" ? entry : String(entry?.name || "").trim();
      if (name) subCategories.set(name, typeof entry === "string" ? {} : entry);
    });
    categoryEntries.push([String(data.name || item.id), {
      order: Number.isFinite(data.order) ? data.order : Number.POSITIVE_INFINITY,
      color: data.color,
      subCategories
    }]);
  });
  return new Map(categoryEntries);
}

function updatePublicStatus() {
  if (collectionErrors.size > 0) {
    const details = [...collectionErrors.entries()]
      .map(([name, error]) => `${name} : ${error.message}`)
      .join(" ; ");
    showStatus(`Certaines données ne sont pas à jour. ${details}`, true);
    return;
  }
  if (loadedCollections.size < publicCollections.length) {
    showStatus("Chargement des données…");
    return;
  }
  const visibleTrainingCount = trainings.filter((training) => training.published !== false).length;
  showStatus(`${visibleTrainingCount} formation(s), ${announcementsList.dataset.count || 0} actualité(s)/information(s) et ${importantInformation.filter((item) => item.published !== false).length} rappel(s) chargé(s).`);
}

function subscribeToPublicCollection(name, onData, onError) {
  onSnapshot(collection(db, name), (snapshot) => {
    loadedCollections.add(name);
    collectionErrors.delete(name);
    onData(snapshot);
    updatePublicStatus();
  }, (error) => {
    collectionErrors.set(name, error);
    onError(error);
    updatePublicStatus();
  });
}

function loadPublicData() {
  if (isCalendarPage) return;
  showStatus("Chargement des données…");
  subscribeToPublicCollection("trainings", (snapshot) => {
    trainings = snapshot.docs.map((item) => ({ ...item.data(), id: item.id }));
    renderTrainings();
  }, (error) => {
    trainingsList.replaceChildren(createElement("p", "text-danger", `Impossible de charger les formations : ${error.message}`));
  });
  subscribeToPublicCollection("announcements", (snapshot) => {
    announcementsList.dataset.loaded = "true";
    announcementsList.dataset.count = String(snapshot.size);
    renderAnnouncements(snapshot.docs.map((item) => ({ ...item.data(), id: item.id })));
  }, (error) => {
    announcementsList.replaceChildren(createElement("div", "col-12 text-danger", `Impossible de charger les actualités : ${error.message}`));
  });
  subscribeToPublicCollection("trainingCategories", (snapshot) => {
    categories = categoryMapFromSnapshot(snapshot);
    renderTrainings();
  }, () => {});
  subscribeToPublicCollection("importantInformation", (snapshot) => {
    importantInformation = snapshot.docs.map((item) => ({ ...item.data(), id: item.id }));
    renderImportantInformation(importantInformation, currentImportantInformationCategories);
  }, (error) => {
    importantInformationList.replaceChildren(createElement("p", "text-danger", `Impossible de charger les dates et informations : ${error.message}`));
  });
  subscribeToPublicCollection("importantInformationCategories", (snapshot) => {
    currentImportantInformationCategories = snapshot.docs.map((item) => ({
      ...item.data(),
      id: item.id
    }));
    renderImportantInformation(importantInformation, currentImportantInformationCategories);
  }, (error) => {
    importantInformationList.replaceChildren(createElement("p", "text-danger", `Impossible de charger les catégories d’informations : ${error.message}`));
  });
}

window.openTrainingModal = openTrainingModal;
window.updateTrainingCategoryMap = (snapshot) => {
  categories = categoryMapFromSnapshot(snapshot);
};

if (trainingSearch) trainingSearch.addEventListener("input", renderTrainings);
if (printCatalogButton) {
  printCatalogButton.addEventListener("click", () => {
    const requiredCollections = [
      "trainings",
      "trainingCategories",
      "importantInformation",
      "importantInformationCategories"
    ];
    const failedCollection = requiredCollections.find((name) => collectionErrors.has(name));
    if (failedCollection) {
      showStatus(`Impossible de préparer le catalogue : les données « ${failedCollection} » n’ont pas pu être chargées.`, true);
      return;
    }
    if (requiredCollections.some((name) => !loadedCollections.has(name))) {
      showStatus("Patientez jusqu’au chargement des formations et des informations à retenir avant l’export.", true);
      return;
    }
    if (!trainings.some((training) => training.published !== false)) {
      showStatus("Aucune formation publiée à imprimer.", true);
      return;
    }
    try {
      renderPrintableCatalog();
      window.requestAnimationFrame(() => window.print());
    } catch (error) {
      showStatus(`Impossible de préparer le catalogue à imprimer : ${error.message}`, true);
    }
  });
}
document.querySelector("#close-training-modal").addEventListener("click", () => trainingModal.close());
trainingModal.addEventListener("click", (event) => {
  if (event.target === trainingModal) trainingModal.close();
});
loadPublicData();
