import { firebaseConfig } from "./firebase-config.js";
import { attachCalendarPopover } from "./calendar-tooltip.js";
import {
  connectFirebaseEmulators,
  getFirebaseConfig
} from "./firebase-environment.js";
import { getApp, getApps, initializeApp } from "https://www.gstatic.com/firebasejs/11.10.0/firebase-app.js";
import {
  collection,
  getFirestore,
  onSnapshot
} from "https://www.gstatic.com/firebasejs/11.10.0/firebase-firestore.js";

const app = getApps().length ? getApp() : initializeApp(getFirebaseConfig(firebaseConfig));
const db = getFirestore(app);
connectFirebaseEmulators({ db });
const monthTitle = document.querySelector("#calendar-month-title");
const sessionCount = document.querySelector("#calendar-session-count");
const monthGrid = document.querySelector("#calendar-month-grid");
const agenda = document.querySelector("#calendar-agenda");
const status = document.querySelector("#page-status");
const monthPicker = document.querySelector("#calendar-month-picker");
const calendarDate = new Date();
calendarDate.setDate(1);

let trainings = [];
let categories = new Map();
let sessions = [];
let expandedDays = new Set();
let loadErrors = new Map();

function createElement(tag, className, text) {
  const element = document.createElement(tag);
  if (className) element.className = className;
  if (text !== undefined) element.textContent = String(text);
  return element;
}

function parseIsoDate(value) {
  if (typeof value !== "string" || !/^\d{4}-\d{2}-\d{2}$/.test(value)) return null;
  const [year, month, day] = value.split("-").map(Number);
  const date = new Date(Date.UTC(year, month - 1, day));
  return date.toISOString().slice(0, 10) === value ? date : null;
}

function formatIsoDate(date) {
  return date.toISOString().slice(0, 10);
}

function formatFullDate(date) {
  return new Intl.DateTimeFormat("fr-FR", {
    weekday: "long",
    day: "numeric",
    month: "long",
    year: "numeric",
    timeZone: "UTC"
  }).format(date);
}

function formatDateRange(start, end) {
  const startText = new Intl.DateTimeFormat("fr-FR", {
    day: "numeric",
    month: "long",
    year: "numeric",
    timeZone: "UTC"
  }).format(start);
  if (formatIsoDate(start) === formatIsoDate(end)) return startText;
  const endText = new Intl.DateTimeFormat("fr-FR", {
    day: "numeric",
    month: "long",
    year: "numeric",
    timeZone: "UTC"
  }).format(end);
  return `${startText} au ${endText}`;
}

function sessionEntries(training) {
  const directSessions = Array.isArray(training.sessions) ? training.sessions : [];
  const phaseSessions = Array.isArray(training.phases)
    ? training.phases.flatMap((phase) =>
      (Array.isArray(phase.sessions) ? phase.sessions : []).map((session) => ({
        ...session,
        phaseTitle: phase.phaseTitle || ""
      }))
    )
    : [];
  return [...directSessions, ...phaseSessions];
}

function buildSessions() {
  sessions = [];
  trainings.forEach((training) => {
    if (training.published === false) return;
    sessionEntries(training).forEach((session, index) => {
      const start = parseIsoDate(session.startDate);
      if (!start) return;
      const parsedEnd = parseIsoDate(session.endDate);
      const end = parsedEnd && parsedEnd >= start ? parsedEnd : start;
      const sessionName = [session.phaseTitle, session.sessionName].filter(Boolean).join(" · ");
      sessions.push({
        id: `${training.id}-${index}`,
        training,
        start,
        end,
        startKey: formatIsoDate(start),
        endKey: formatIsoDate(end),
        sessionName,
        location: String(session.location || "").trim(),
        cancelled: session.cancelled === true,
        cancellationReason: String(session.cancellationReason || "")
      });
    });
  });
  sessions.sort(compareTrainingOrder);
}

function sessionColor(training) {
  const category = categories.get(String(training.category || "").trim());
  const subCategory = category?.subCategories?.find((item) =>
    typeof item === "object" && item.name === training.subCategory
  );
  const color = subCategory?.color || category?.color;
  return typeof color === "string" && /^#[\da-f]{6}$/i.test(color) ? color : "#205b98";
}

function compareTrainingOrder(left, right) {
  const dateOrder = left.start - right.start || left.end - right.end;
  if (dateOrder) return dateOrder;
  const leftCategory = categories.get(String(left.training.category || "").trim());
  const rightCategory = categories.get(String(right.training.category || "").trim());
  const leftCategoryOrder = Number.isFinite(leftCategory?.order)
    ? leftCategory.order
    : Number.POSITIVE_INFINITY;
  const rightCategoryOrder = Number.isFinite(rightCategory?.order)
    ? rightCategory.order
    : Number.POSITIVE_INFINITY;
  if (leftCategoryOrder !== rightCategoryOrder) return leftCategoryOrder - rightCategoryOrder;

  const categoryNameOrder = String(left.training.category || "").localeCompare(
    String(right.training.category || ""),
    "fr"
  );
  if (categoryNameOrder !== 0) return categoryNameOrder;

  const leftTrainingOrder = Number.isFinite(left.training.order)
    ? left.training.order
    : Number.POSITIVE_INFINITY;
  const rightTrainingOrder = Number.isFinite(right.training.order)
    ? right.training.order
    : Number.POSITIVE_INFINITY;
  if (leftTrainingOrder !== rightTrainingOrder) return leftTrainingOrder - rightTrainingOrder;

  const titleOrder = String(left.training.title || left.training.id).localeCompare(
    String(right.training.title || right.training.id),
    "fr"
  );
  return titleOrder || left.id.localeCompare(right.id, "fr");
}

function statusMessage() {
  if (loadErrors.size > 0) {
    status.className = "mt-4 mb-0 text-danger";
    status.textContent = `Impossible de charger le calendrier : ${[...loadErrors.values()].join(" ; ")}`;
    return;
  }
  status.className = "mt-4 mb-0 text-secondary";
  const cancelledCount = sessions.filter((session) => session.cancelled).length;
  const scheduledCount = sessions.length - cancelledCount;
  status.textContent = `${scheduledCount} session${scheduledCount === 1 ? "" : "s"} programmée${scheduledCount === 1 ? "" : "s"} avec une date exploitable${cancelledCount ? ` ; ${cancelledCount} session${cancelledCount === 1 ? "" : "s"} annulée${cancelledCount === 1 ? "" : "s"} affichée${cancelledCount === 1 ? "" : "s"}` : ""}.`;
}

function createSessionButton(session, dateKey) {
  const title = session.training.title || session.training.id || "Formation sans titre";
  const sessionText = session.sessionName || session.location;
  const button = createElement("button", "calendar-event");
  const titleElement = createElement("span", "calendar-event-title", title);
  if (session.cancelled) titleElement.classList.add("is-cancelled-session");
  const dayNumber = Math.floor((parseIsoDate(dateKey) - session.start) / 86400000) + 1;
  if (session.startKey !== session.endKey) {
    button.append(titleElement, createElement("span", "calendar-event-day", `J${dayNumber}`));
  } else {
    button.append(titleElement);
  }
  if (session.cancelled) {
    button.classList.add("is-cancelled-session");
    button.append(createElement("span", "session-cancelled-badge", "Annulée"));
    if (session.cancellationReason) {
      button.append(createElement("span", "session-cancellation-reason", `Motif : ${session.cancellationReason}`));
    }
  }
  button.type = "button";
  button.style.setProperty("--calendar-event-color", sessionColor(session.training));
  button.setAttribute(
    "aria-label",
    `${title}${session.startKey !== session.endKey ? `, jour ${dayNumber}` : ""}${sessionText ? `, ${sessionText}` : ""}${session.cancelled ? `, session annulée${session.cancellationReason ? `, motif : ${session.cancellationReason}` : ""}` : ""}, ${formatFullDate(parseIsoDate(dateKey))}. Ouvrir la fiche.`
  );
  attachCalendarPopover(button, title, [
    { label: "Date", value: formatDateRange(session.start, session.end) },
    { label: "Jour", value: session.startKey !== session.endKey ? `J${dayNumber}` : "" },
    { label: "Session", value: session.sessionName },
    { label: "Lieu", value: session.location },
    { label: "État", value: session.cancelled ? `Annulée${session.cancellationReason ? ` — ${session.cancellationReason}` : ""}` : "Programmée" },
    { label: "Catégorie", value: session.training.category }
  ]);
  button.addEventListener("click", () => window.openTrainingModal(session.training));
  return button;
}

function createDayCell(date, monthIndex, todayKey) {
  const dateKey = formatIsoDate(date);
  const cell = createElement("section", "calendar-day");
  if (date.getUTCMonth() !== monthIndex) cell.classList.add("is-outside-month");
  if (dateKey === todayKey) cell.classList.add("is-today");
  cell.setAttribute("aria-label", formatFullDate(date));

  const heading = createElement("div", "calendar-day-heading");
  heading.append(createElement("span", "calendar-day-number", date.getUTCDate()));
  if (dateKey === todayKey) heading.append(createElement("span", "calendar-today-label", "Aujourd’hui"));
  const eventList = createElement("div", "calendar-day-events");
  const matching = sessions.filter((session) => session.startKey <= dateKey && session.endKey >= dateKey);
  const expanded = expandedDays.has(dateKey);
  const visible = expanded ? matching : matching.slice(0, 3);
  visible.forEach((session) => eventList.append(createSessionButton(session, dateKey)));
  if (matching.length > 3) {
    const moreButton = createElement(
      "button",
      "calendar-more-button",
      expanded ? "Réduire" : `+ ${matching.length - 3} autre${matching.length - 3 === 1 ? "" : "s"}`
    );
    moreButton.type = "button";
    moreButton.addEventListener("click", () => {
      if (expanded) expandedDays.delete(dateKey);
      else expandedDays.add(dateKey);
      renderCalendar();
    });
    eventList.append(moreButton);
  }
  cell.append(heading, eventList);
  return cell;
}

function renderMonthGrid(monthIndex, year, todayKey) {
  monthGrid.replaceChildren();
  const firstDay = new Date(Date.UTC(year, monthIndex, 1));
  const mondayOffset = (firstDay.getUTCDay() + 6) % 7;
  const daysInMonth = new Date(Date.UTC(year, monthIndex + 1, 0)).getUTCDate();
  const totalCells = Math.ceil((mondayOffset + daysInMonth) / 7) * 7;
  const gridStart = new Date(Date.UTC(year, monthIndex, 1 - mondayOffset));
  for (let index = 0; index < totalCells; index += 1) {
    const date = new Date(gridStart);
    date.setUTCDate(gridStart.getUTCDate() + index);
    monthGrid.append(createDayCell(date, monthIndex, todayKey));
  }
}

function createAgendaEntry(session, dateKey) {
  const title = session.training.title || session.training.id || "Formation sans titre";
  const button = createElement("button", "calendar-agenda-entry");
  button.type = "button";
  button.style.setProperty("--calendar-event-color", sessionColor(session.training));
  const entryDate = parseIsoDate(dateKey);
  const dayNumber = Math.floor((entryDate - session.start) / 86400000) + 1;
  const date = createElement("span", "calendar-agenda-date", formatFullDate(entryDate));
  const details = createElement("span", "calendar-agenda-details");
  const titleElement = createElement("span", "calendar-agenda-title");
  titleElement.append(createElement("span", "", title));
  if (session.cancelled) titleElement.classList.add("is-cancelled-session");
  if (session.startKey !== session.endKey) {
    titleElement.append(createElement("span", "calendar-event-day", `J${dayNumber}`));
  }
  details.append(titleElement);
  if (session.cancelled) {
    details.append(createElement("span", "session-cancelled-badge", "Annulée"));
    if (session.cancellationReason) {
      details.append(createElement("span", "session-cancellation-reason", `Motif : ${session.cancellationReason}`));
    }
    button.classList.add("is-cancelled-session");
  }
  if (session.sessionName) details.append(createElement("span", "calendar-agenda-session", session.sessionName));
  details.append(createElement("span", "calendar-agenda-range", formatDateRange(session.start, session.end)));
  if (session.location) details.append(createElement("span", "calendar-agenda-location", session.location));
  button.append(date, details, createElement("span", "calendar-agenda-arrow", "›"));
  button.setAttribute(
    "aria-label",
    `Ouvrir la fiche de ${title}${session.startKey !== session.endKey ? `, jour ${dayNumber}` : ""}, ${formatDateRange(session.start, session.end)}${session.cancelled ? `, session annulée${session.cancellationReason ? `, motif : ${session.cancellationReason}` : ""}` : ""}.`
  );
  button.addEventListener("click", () => window.openTrainingModal(session.training));
  return button;
}

function renderAgenda(monthIndex, year) {
  agenda.replaceChildren();
  agenda.hidden = false;
  const monthStartKey = formatIsoDate(new Date(Date.UTC(year, monthIndex, 1)));
  const monthEndKey = formatIsoDate(new Date(Date.UTC(year, monthIndex + 1, 0)));
  const monthSessions = sessions.filter((session) =>
    session.startKey <= monthEndKey && session.endKey >= monthStartKey
  );
  if (monthSessions.length === 0) {
    agenda.append(createElement("p", "calendar-empty-state", "Aucune session programmée ce mois-ci."));
    return;
  }

  const daysInMonth = new Date(Date.UTC(year, monthIndex + 1, 0)).getUTCDate();
  for (let day = 1; day <= daysInMonth; day += 1) {
    const dateKey = formatIsoDate(new Date(Date.UTC(year, monthIndex, day)));
    const daySessions = monthSessions.filter((session) =>
      session.startKey <= dateKey && session.endKey >= dateKey
    );
    if (daySessions.length === 0) continue;
    const date = parseIsoDate(dateKey);
    const group = createElement("section", "calendar-agenda-day");
    group.append(createElement("h4", "calendar-agenda-heading", formatFullDate(date)));
    const entries = createElement("div", "calendar-agenda-entries");
    daySessions.forEach((session) => entries.append(createAgendaEntry(session, dateKey)));
    group.append(entries);
    agenda.append(group);
  }
}

function renderCalendar() {
  const year = calendarDate.getFullYear();
  const monthIndex = calendarDate.getMonth();
  monthTitle.textContent = new Intl.DateTimeFormat("fr-FR", { month: "long", year: "numeric" }).format(calendarDate);
  monthPicker.value = `${year}-${String(monthIndex + 1).padStart(2, "0")}`;
  const monthStartKey = formatIsoDate(new Date(Date.UTC(year, monthIndex, 1)));
  const monthEndKey = formatIsoDate(new Date(Date.UTC(year, monthIndex + 1, 0)));
  const monthSessions = sessions.filter((session) =>
    session.startKey <= monthEndKey && session.endKey >= monthStartKey
  );
  sessionCount.textContent = `${monthSessions.length} session${monthSessions.length === 1 ? "" : "s"}`;
  const now = new Date();
  const todayKey = formatIsoDate(new Date(Date.UTC(now.getFullYear(), now.getMonth(), now.getDate())));
  renderMonthGrid(monthIndex, year, todayKey);
  renderAgenda(monthIndex, year);
  statusMessage();
}

document.querySelector("#calendar-previous").addEventListener("click", () => {
  calendarDate.setMonth(calendarDate.getMonth() - 1);
  expandedDays.clear();
  renderCalendar();
});
document.querySelector("#calendar-next").addEventListener("click", () => {
  calendarDate.setMonth(calendarDate.getMonth() + 1);
  expandedDays.clear();
  renderCalendar();
});
document.querySelector("#calendar-today").addEventListener("click", () => {
  const now = new Date();
  calendarDate.setFullYear(now.getFullYear(), now.getMonth(), 1);
  expandedDays.clear();
  renderCalendar();
});
monthPicker.addEventListener("change", () => {
  const match = /^(\d{4})-(\d{2})$/.exec(monthPicker.value);
  if (!match) return;
  calendarDate.setFullYear(Number(match[1]), Number(match[2]) - 1, 1);
  expandedDays.clear();
  renderCalendar();
});

onSnapshot(collection(db, "trainingCategories"), (snapshot) => {
  categories.clear();
  snapshot.docs.forEach((document) => {
    if (document.id === "__settings__") return;
    const data = document.data();
    const subCategories = Array.isArray(data.subCategories) ? data.subCategories : [];
    categories.set(String(data.name || document.id).trim(), {
      order: Number.isFinite(data.order) ? data.order : Number.POSITIVE_INFINITY,
      color: data.color,
      subCategories
    });
  });
  window.updateTrainingCategoryMap(snapshot);
  buildSessions();
  renderCalendar();
}, (error) => {
  loadErrors.set("trainingCategories", error.message);
  renderCalendar();
});

onSnapshot(collection(db, "trainings"), (snapshot) => {
  trainings = snapshot.docs.map((document) => ({ ...document.data(), id: document.id }));
  loadErrors.delete("trainings");
  buildSessions();
  renderCalendar();
}, (error) => {
  loadErrors.set("trainings", error.message);
  renderCalendar();
});
