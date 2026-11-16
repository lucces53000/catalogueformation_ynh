import { firebaseConfig } from "./firebase-config.js";
import {
  connectFirebaseEmulators,
  getFirebaseConfig,
  isFirebaseEmulatorEnvironment
} from "./firebase-environment.js";
import { initializeApp } from "https://www.gstatic.com/firebasejs/11.10.0/firebase-app.js";
import {
  getAuth,
  onAuthStateChanged,
  signInWithEmailAndPassword,
  signOut
} from "https://www.gstatic.com/firebasejs/11.10.0/firebase-auth.js";
import {
  addDoc,
  collection,
  deleteDoc,
  doc,
  getDocs,
  getFirestore,
  query,
  updateDoc,
  where,
  writeBatch
} from "https://www.gstatic.com/firebasejs/11.10.0/firebase-firestore.js";
const ADMIN_EMAIL = "luc.cesbron@sdis53.fr";
const WORKER_FEED_BATCH_SIZE = 50;
const app = initializeApp(getFirebaseConfig(firebaseConfig));
const auth = getAuth(app);
const db = getFirestore(app);
connectFirebaseEmulators({ auth, db });
const cloudflareWorkerUrl = "https://wild-sky-abe4.cesbronluc.workers.dev/";
const loginPanel = document.querySelector("#agent-login-panel");
const deniedPanel = document.querySelector("#agent-access-denied");
const calendarPanel = document.querySelector("#agent-calendar-panel");
const statusElement = document.querySelector("#agent-calendar-status");
const agentList = document.querySelector("#agent-list");
const calendarElement = document.querySelector("#agent-month-calendar");
const monthTitle = document.querySelector("#agent-calendar-month");
const summary = document.querySelector("#agent-calendar-summary");
const agentForm = document.querySelector("#agent-form");
const agentFormDialog = document.querySelector("#agent-form-dialog");
const agentFormTitle = document.querySelector("#agent-form-title");
const openAgentCreateButton = document.querySelector("#open-agent-create");
const closeAgentDialogButton = document.querySelector("#close-agent-dialog");
const saveAgentButton = document.querySelector("#save-agent");
const cancelAgentEditButton = document.querySelector("#cancel-agent-edit");
const signOutButton = document.querySelector("#agent-sign-out");
const previousMonthButton = document.querySelector("#agent-month-previous");
const nextMonthButton = document.querySelector("#agent-month-next");
const occupationFilter = document.querySelector("#agent-occupation-filter");
const calendarView = document.querySelector("#agent-calendar-view");
const managementView = document.querySelector("#agent-management-view");
const statisticsView = document.querySelector("#agent-statistics-view");
const statisticsList = document.querySelector("#agent-statistics-list");
const statisticsYear = document.querySelector("#agent-statistics-year");
const previousStatisticsYearButton = document.querySelector("#agent-statistics-previous-year");
const nextStatisticsYearButton = document.querySelector("#agent-statistics-next-year");
const monthNames = new Intl.DateTimeFormat("fr-FR", { month: "long", timeZone: "UTC" });
const weekdayNames = ["L", "M", "M", "J", "V", "S", "D"];

let agents = [];
let events = [];
let trainingSessions = [];
let statisticsEvents = [];
const selectedMonth = new Date();
selectedMonth.setDate(1);
let refreshId = 0;
let statisticsRefreshId = 0;
let selectedStatisticsYear = new Date().getFullYear();
let editingAgentId = "";
const agentEventsCache = new Map();
const agentEventsRequests = new Map();
const AGENT_EVENTS_CACHE_MS = 24 * 60 * 60 * 1000;
statisticsYear.value = String(selectedStatisticsYear);

function showStatus(message, isError = false) {
  statusElement.textContent = message;
  statusElement.classList.toggle("error", isError);
}

function isAuthorized(user) {
  return Boolean(
    user
    && user.emailVerified
    && user.email?.trim().toLowerCase() === ADMIN_EMAIL
  );
}

function validFeedUrl(value) {
  try {
    const url = new URL(value);
    return url.protocol === "https:"
      && url.hostname === "agatt.sdis53.fr"
      && url.port === ""
      && !url.username
      && !url.password
      && !url.search
      && !url.hash
      && /^\/calendrier\/\d+\/[A-Za-z0-9_-]{16,128}\/occupation\.ics$/.test(url.pathname);
  } catch {
    return false;
  }
}

function createElement(tag, className, text) {
  const element = document.createElement(tag);
  if (className) element.className = className;
  if (text !== undefined) element.textContent = text;
  return element;
}

function createAgentActionButton(label, className, pathData) {
  const button = createElement("button", `agent-icon-button ${className}`);
  button.type = "button";
  button.setAttribute("aria-label", label);
  button.title = label;
  const icon = document.createElementNS("http://www.w3.org/2000/svg", "svg");
  icon.setAttribute("viewBox", "0 0 24 24");
  icon.setAttribute("aria-hidden", "true");
  icon.setAttribute("focusable", "false");
  icon.setAttribute("fill", "none");
  icon.setAttribute("stroke", "currentColor");
  icon.setAttribute("stroke-width", "1.8");
  icon.setAttribute("stroke-linecap", "round");
  icon.setAttribute("stroke-linejoin", "round");
  const path = document.createElementNS("http://www.w3.org/2000/svg", "path");
  path.setAttribute("d", pathData);
  icon.append(path);
  button.append(icon);
  return button;
}

function renderAgents() {
  agentList.replaceChildren();
  if (agents.length === 0) {
    agentList.append(createElement("p", "agent-calendar-status", "Aucun agent enregistré."));
    return;
  }

  const trainerColumns = [
    { key: "incendie", title: "Formateurs incendie", matches: (agent) => agent.formateurCaisson !== true },
    { key: "caisson", title: "Formateurs caisson", matches: (agent) => agent.formateurCaisson === true }
  ];
  for (const column of trainerColumns) {
    const section = createElement("section", `agent-trainer-column ${column.key}`);
    section.append(createElement("h3", "", column.title));
    const list = createElement("div", "agent-list");
    const columnAgents = agents.filter(column.matches);
    if (columnAgents.length === 0) {
      list.append(createElement("p", "agent-calendar-status", "Aucun formateur."));
    }
    for (const agent of columnAgents) {
      const item = createElement("div", "agent-list-item");
      const details = createElement("p");
      details.append(document.createTextNode(`${agent.firstName} ${agent.lastName}`));
      details.append(createElement("span", "agent-status-tag", agent.status));
      const actions = createElement("div", "agent-list-actions");
      const editButton = createAgentActionButton(
        `Modifier ${agent.firstName} ${agent.lastName}`,
        "edit",
        "M16.862 3.487a2.1 2.1 0 0 1 2.97 2.97L8.66 17.63l-4.1 1.12 1.12-4.1L16.862 3.487ZM14.75 5.6l3.65 3.65M4.5 21h15"
      );
      editButton.addEventListener("click", () => editAgent(agent));
      const removeButton = createAgentActionButton(
        `Supprimer ${agent.firstName} ${agent.lastName}`,
        "remove",
        "M4 7h16M10 11v6m4-6v6M5 7l1 14h12l1-14M9 7V4h6v3"
      );
      removeButton.addEventListener("click", () => removeAgent(agent));
      actions.append(editButton, removeButton);
      item.append(details, actions);
      list.append(item);
    }
    section.append(list);
    agentList.append(section);
  }
}

function resetAgentForm() {
  agentForm.reset();
  editingAgentId = "";
  saveAgentButton.textContent = "Ajouter l’agent";
  agentFormTitle.textContent = "Ajouter un agent";
  if (agentFormDialog.open) agentFormDialog.close();
}

function openAgentForm() {
  agentFormDialog.showModal();
  agentForm.elements.namedItem("firstName").focus();
}

function editAgent(agent) {
  editingAgentId = agent.id;
  agentForm.elements.namedItem("firstName").value = agent.firstName;
  agentForm.elements.namedItem("lastName").value = agent.lastName;
  agentForm.elements.namedItem("status").value = agent.status;
  agentForm.elements.namedItem("formateurCaisson").checked = agent.formateurCaisson === true;
  agentForm.elements.namedItem("icsUrl").value = agent.icsUrl;
  saveAgentButton.textContent = "Enregistrer les modifications";
  agentFormTitle.textContent = "Modifier un agent";
  openAgentForm();
}

async function loadAgents() {
  const snapshot = await getDocs(collection(db, "agentCalendars"));
  agents = snapshot.docs.map((agentDocument) => ({
    id: agentDocument.id,
    ...agentDocument.data()
  })).sort((first, second) =>
    `${first.lastName} ${first.firstName}`.localeCompare(`${second.lastName} ${second.firstName}`, "fr")
  );
  renderAgents();
}

function addDays(dateKey, days) {
  const [year, month, day] = dateKey.split("-").map(Number);
  const date = new Date(Date.UTC(year, month - 1, day + days));
  return `${date.getUTCFullYear()}-${String(date.getUTCMonth() + 1).padStart(2, "0")}-${String(date.getUTCDate()).padStart(2, "0")}`;
}

async function loadTrainingSessions(year, month) {
  const snapshot = await getDocs(collection(db, "trainings"));
  const monthStart = `${year}-${String(month + 1).padStart(2, "0")}-01`;
  const monthEnd = `${year}-${String(month + 1).padStart(2, "0")}-${String(new Date(Date.UTC(year, month + 1, 0)).getUTCDate()).padStart(2, "0")}`;
  return snapshot.docs.flatMap((trainingDocument) => {
    const training = trainingDocument.data();
    const subCategory = String(training.subCategory || "").trim().toLocaleUpperCase("fr-FR");
    if (
      training.published === false
      || !["INC", "INCENDIE"].includes(subCategory)
    ) return [];

    const directSessions = Array.isArray(training.sessions) ? training.sessions : [];
    const phaseSessions = Array.isArray(training.phases)
      ? training.phases.flatMap((phase) =>
        (Array.isArray(phase?.sessions) ? phase.sessions : []).map((session) => ({
          ...session,
          phaseTitle: phase?.phaseTitle || ""
        }))
      )
      : [];
    return [...directSessions, ...phaseSessions].flatMap((session) => {
      if (!session || typeof session !== "object") return [];
      const startDate = session.startDate;
      if (typeof startDate !== "string" || !/^\d{4}-\d{2}-\d{2}$/.test(startDate)) return [];
      const parsedStart = new Date(`${startDate}T00:00:00Z`);
      if (Number.isNaN(parsedStart.getTime()) || parsedStart.toISOString().slice(0, 10) !== startDate) return [];
      const candidateEndDate = typeof session.endDate === "string"
        && /^\d{4}-\d{2}-\d{2}$/.test(session.endDate)
        && session.endDate >= startDate
        ? new Date(`${session.endDate}T00:00:00Z`)
        : null;
      const endDate = candidateEndDate
        && !Number.isNaN(candidateEndDate.getTime())
        && candidateEndDate.toISOString().slice(0, 10) === session.endDate
        ? session.endDate
        : startDate;
      if (endDate < monthStart || startDate > monthEnd) return [];
      return [{
        kind: "training",
        startDate,
        endDate,
        title: [
          String(training.title || trainingDocument.id),
          session.phaseTitle,
          session.sessionName
        ].filter(Boolean).join(" · ")
      }];
    });
  });
}

function eventsByDate() {
  const result = new Map();
  const year = selectedMonth.getFullYear();
  const month = selectedMonth.getMonth();
  const filter = occupationFilter.value;
  const monthStart = `${year}-${String(month + 1).padStart(2, "0")}-01`;
  const monthEnd = `${year}-${String(month + 1).padStart(2, "0")}-${String(new Date(Date.UTC(year, month + 1, 0)).getUTCDate()).padStart(2, "0")}`;
  for (const event of events) {
    if (filter !== "all" && event.category !== filter) continue;
    const startDate = event.startDate < monthStart ? monthStart : event.startDate;
    const endDate = event.endDate > monthEnd ? monthEnd : event.endDate;
    if (startDate > endDate) continue;
    for (let dateKey = startDate; dateKey <= endDate; dateKey = addDays(dateKey, 1)) {
      if (!result.has(dateKey)) result.set(dateKey, []);
      result.get(dateKey).push(event);
    }
  }
  for (const session of trainingSessions) {
    const startDate = session.startDate < monthStart ? monthStart : session.startDate;
    const endDate = session.endDate > monthEnd ? monthEnd : session.endDate;
    if (startDate > endDate) continue;
    for (let dateKey = startDate; dateKey <= endDate; dateKey = addDays(dateKey, 1)) {
      if (!result.has(dateKey)) result.set(dateKey, []);
      result.get(dateKey).push(session);
    }
  }
  for (const dayEvents of result.values()) {
    dayEvents.sort((first, second) =>
      (first.kind === "training" ? 0 : 1)
      - (second.kind === "training" ? 0 : 1)
      || (first.calendarStatus === "CONFIRMED" ? 0 : 1)
        - (second.calendarStatus === "CONFIRMED" ? 0 : 1)
      || (first.agentName || first.title || "").localeCompare(second.agentName || second.title || "", "fr")
    );
  }
  return result;
}

function renderCalendar() {
  const year = selectedMonth.getFullYear();
  const month = selectedMonth.getMonth();
  monthTitle.textContent = monthNames.format(new Date(Date.UTC(year, month, 1))).replace(/^\p{L}/u, (letter) => letter.toLocaleUpperCase("fr-FR"))
    + ` ${year}`;
  calendarElement.replaceChildren();
  const byDate = eventsByDate();

  const grid = createElement("div", "agent-month-grid");
  grid.setAttribute("role", "grid");
  for (const weekday of weekdayNames) {
    const heading = createElement("span", "agent-weekday", weekday);
    heading.setAttribute("role", "columnheader");
    grid.append(heading);
  }

  const firstWeekday = (new Date(Date.UTC(year, month, 1)).getUTCDay() + 6) % 7;
  for (let index = 0; index < firstWeekday; index += 1) {
    grid.append(createElement("span", "agent-day empty"));
  }
  const daysInMonth = new Date(Date.UTC(year, month + 1, 0)).getUTCDate();
  for (let day = 1; day <= daysInMonth; day += 1) {
    const dateKey = `${year}-${String(month + 1).padStart(2, "0")}-${String(day).padStart(2, "0")}`;
    const cell = createElement("div", "agent-day");
    cell.setAttribute("role", "gridcell");
    const dayEvents = byDate.get(dateKey) || [];
    const dayHeader = createElement("div", "agent-day-header");
    dayHeader.append(createElement("span", "agent-day-number", String(day)));
    const occupationEvents = dayEvents.filter((event) => event.kind !== "training");
    if (occupationEvents.length > 0) {
      const counts = createElement("span", "agent-day-status-counts");
      const confirmedCount = occupationEvents.filter((event) => event.calendarStatus === "CONFIRMED").length;
      const tentativeCount = occupationEvents.length - confirmedCount;
      if (confirmedCount > 0) {
        const badge = createElement("span", "agent-status-count confirmed", String(confirmedCount));
        badge.setAttribute("aria-label", `${confirmedCount} occupation${confirmedCount === 1 ? "" : "s"} validée${confirmedCount === 1 ? "" : "s"}`);
        counts.append(badge);
      }
      if (tentativeCount > 0) {
        const badge = createElement("span", "agent-status-count tentative", String(tentativeCount));
        badge.setAttribute("aria-label", `${tentativeCount} occupation${tentativeCount === 1 ? "" : "s"} disponible${tentativeCount === 1 ? "" : "s"}`);
        counts.append(badge);
      }
      dayHeader.append(counts);
    }
    cell.append(dayHeader);
    for (const event of dayEvents) {
      if (event.kind === "training") {
        const label = `Formation · ${event.title}`;
        const chip = createElement("span", "agent-event training-session", label);
        chip.title = label;
        cell.append(chip);
        continue;
      }
      const label = `${event.agentName} · ${event.summary}`;
      const statusLabel = event.calendarStatus === "CONFIRMED" ? "Validé" : "Disponible";
      const chip = createElement(
        "span",
        `agent-event ${event.colorType} ${event.calendarStatus === "CONFIRMED" ? "confirmed" : "tentative"}`
      );
      const marker = createElement("i", `agent-event-status-marker ${event.calendarStatus.toLowerCase()}`);
      marker.setAttribute("aria-label", statusLabel);
      chip.append(marker, createElement("span", "", label));
      chip.title = `${label} · ${statusLabel} · ${event.status}`;
      cell.append(chip);
    }
    grid.append(cell);
  }
  calendarElement.append(grid);
}

function renderStatistics(yearEvents = statisticsEvents) {
  statisticsList.replaceChildren();

  if (agents.length === 0) {
    statisticsList.append(createElement("p", "agent-calendar-status", "Ajoutez un agent pour afficher les statistiques."));
    return;
  }

  const groups = [
    { key: "incendie", label: "Incendie", matches: (event) => event.category === "incendie" && event.colorType !== "assistant" },
    { key: "caisson", label: "Caisson", matches: (event) => event.category === "caisson" },
    { key: "assistant", label: "Assistants INC / COD", matches: (event) => event.colorType === "assistant" }
  ];
  const statuses = [
    { key: "CONFIRMED", label: "Validé" },
    { key: "TENTATIVE", label: "Disponible" }
  ];
  const eventsByAgent = new Map(agents.map((agent) => [agent.id, []]));
  for (const event of yearEvents) {
    if (Number(event.startDate?.slice(0, 4)) !== selectedStatisticsYear) continue;
    if (eventsByAgent.has(event.agentId)) eventsByAgent.get(event.agentId).push(event);
  }

  for (const agent of agents) {
    const card = createElement("article", "agent-statistics-card");
    const heading = createElement("h3", "", `${agent.firstName} ${agent.lastName}`);
    heading.append(createElement("span", "agent-status-tag", agent.status));
    const groupsElement = createElement("div", "agent-statistics-groups");
    const agentEvents = eventsByAgent.get(agent.id) || [];

    for (const group of groups) {
      const groupElement = createElement("section", `agent-statistics-group ${group.key}`);
      groupElement.append(createElement("h4", "", group.label));
      for (const status of statuses) {
        const matchingEvents = agentEvents.filter((event) =>
          group.matches(event) && event.calendarStatus === status.key
        );
        const hours = matchingEvents.reduce(
          (total, event) => total + (Number.isFinite(event.durationHours) ? event.durationHours : 0),
          0
        );
        const row = createElement("p", `agent-statistics-row ${status.key.toLowerCase()}`);
        row.append(createElement("strong", "", status.label));
        row.append(document.createTextNode(
          `${matchingEvents.length} occupation${matchingEvents.length === 1 ? "" : "s"} · ${new Intl.NumberFormat("fr-FR", { maximumFractionDigits: 1 }).format(hours)} h`
        ));
        groupElement.append(row);
      }
      if (group.key === "caisson") {
        const caissonEvents = agentEvents.filter(group.matches);
        if (caissonEvents.length > 0) {
          const validatedCaisson = caissonEvents.filter((event) =>
            event.calendarStatus === "CONFIRMED"
          );
          const burns = validatedCaisson.reduce(
            (total, event) => total + (Number.isFinite(event.caissonBurns) ? event.caissonBurns : 0),
            0
          );
          const exposureMinutes = validatedCaisson.reduce(
            (total, event) => total + (Number.isFinite(event.exposureMinutes) ? event.exposureMinutes : 0),
            0
          );
          const exposureHours = Math.floor(exposureMinutes / 60);
          const remainingMinutes = exposureMinutes % 60;
          groupElement.append(createElement(
            "p",
            "agent-statistics-caisson-extra",
            `${burns} brûlage${burns === 1 ? "" : "s"} · Exposition : ${exposureHours} h ${String(remainingMinutes).padStart(2, "0")} min`
          ));
        }
      }
      groupsElement.append(groupElement);
    }

    card.append(heading, groupsElement);
    statisticsList.append(card);
  }
}

function agentEventsCacheKey(agent, year) {
  return `${agent.id}\u0000${year}\u0000${agent.icsUrl}`;
}

function clearAgentEventsCache(agentId) {
  const prefix = `${agentId}\u0000`;
  for (const key of agentEventsCache.keys()) {
    if (key.startsWith(prefix)) agentEventsCache.delete(key);
  }
}

function mapFeedEvents(agent, feedEvents) {
  if (!Array.isArray(feedEvents)) {
    throw new Error("Le Worker a renvoyé une liste d’occupations invalide.");
  }
  return feedEvents.map((event) => {
    if (
      !event
      || typeof event.startDate !== "string"
      || !/^\d{4}-\d{2}-\d{2}$/.test(event.startDate)
      || typeof event.endDate !== "string"
      || !/^\d{4}-\d{2}-\d{2}$/.test(event.endDate)
      || event.endDate < event.startDate
      || typeof event.summary !== "string"
      || !["incendie", "caisson"].includes(event.category)
      || !["incendie", "caisson", "assistant"].includes(event.colorType)
      || !["CONFIRMED", "TENTATIVE"].includes(event.status)
    ) {
      throw new Error("Le Worker a renvoyé une occupation ICS invalide.");
    }
    return {
      agentId: agent.id,
      agentName: `${agent.firstName} ${agent.lastName}`,
      status: agent.status,
      calendarStatus: event.status,
      summary: event.summary,
      code: String(event.code || ""),
      category: event.category,
      colorType: event.colorType,
      durationHours: Number.isFinite(event.durationHours) ? event.durationHours : 0,
      caissonBurns: Number.isInteger(event.caissonBurns) ? event.caissonBurns : 0,
      exposureMinutes: Number.isInteger(event.exposureMinutes) ? event.exposureMinutes : 0,
      startDate: event.startDate,
      endDate: event.endDate
    };
  });
}

async function fetchAgentEvents(year, agentsToFetch) {
  const user = auth.currentUser;
  if (!isAuthorized(user)) throw new Error("Une session administrateur vérifiée est requise.");
  if (isFirebaseEmulatorEnvironment) {
    throw new Error("La récupération des calendriers AGATT est désactivée dans l’environnement de test local.");
  }

  const idToken = await user.getIdToken();
  const failures = [];
  let fetchedCount = 0;
  for (let offset = 0; offset < agentsToFetch.length; offset += WORKER_FEED_BATCH_SIZE) {
    const batchAgents = agentsToFetch.slice(offset, offset + WORKER_FEED_BATCH_SIZE);
    showStatus(
      `Lecture des flux ICS de ${year} (${Math.min(offset + batchAgents.length, agentsToFetch.length)}/${agentsToFetch.length})…`
    );
    let results;
    try {
      const response = await fetch(cloudflareWorkerUrl, {
        method: "POST",
        headers: {
          "Authorization": `Bearer ${idToken}`,
          "Content-Type": "application/json"
        },
        body: JSON.stringify({
          kind: "agent_occupations",
          year,
          feeds: batchAgents.map((agent) => ({ agentId: agent.id, url: agent.icsUrl }))
        })
      });
      const result = await response.json().catch(() => ({}));
      if (!response.ok) throw new Error(result.error || `Le Worker a répondu avec le statut ${response.status}.`);
      if (!Array.isArray(result.results)) throw new Error("Le Worker a renvoyé une réponse de lecture invalide.");
      results = result.results;
    } catch (error) {
      const reason = error instanceof Error ? error.message : "Erreur inconnue pendant la requête.";
      failures.push(...batchAgents.map((agent) => ({ agent, error: reason })));
      continue;
    }

    const agentById = new Map(batchAgents.map((agent) => [agent.id, agent]));
    const receivedIds = new Set();
    for (const feedResult of results) {
      const agent = agentById.get(feedResult.agentId);
      if (!agent) continue;
      receivedIds.add(agent.id);
      if (feedResult.error) {
        failures.push({ agent, error: feedResult.error });
        continue;
      }
      try {
        if (feedResult.unchanged) {
          throw new Error("Le Worker n’a pas renvoyé le contenu actuel du calendrier.");
        }
        if (!isAuthorized(auth.currentUser)) {
          throw new Error("La session administrateur a expiré pendant la lecture du calendrier.");
        }
        const key = agentEventsCacheKey(agent, year);
        agentEventsCache.set(key, {
          fetchedAt: Date.now(),
          events: mapFeedEvents(agent, feedResult.events)
        });
        fetchedCount += 1;
      } catch (error) {
        failures.push({
          agent,
          error: error instanceof Error ? error.message : "Réponse de calendrier invalide."
        });
      }
    }
    for (const agent of batchAgents) {
      if (!receivedIds.has(agent.id)) {
        failures.push({ agent, error: "Le Worker n’a pas renvoyé de résultat pour ce calendrier." });
      }
    }
  }
  return { failures, fetchedCount };
}

async function loadAgentEvents(year, forceRefresh = false) {
  if (agentEventsRequests.has(year)) return agentEventsRequests.get(year);
  const request = (async () => {
    const now = Date.now();
    const agentsToFetch = agents.filter((agent) => {
      const key = agentEventsCacheKey(agent, year);
      const cached = agentEventsCache.get(key);
      if (cached && (now < cached.fetchedAt || now - cached.fetchedAt >= AGENT_EVENTS_CACHE_MS)) {
        agentEventsCache.delete(key);
      }
      return forceRefresh || !agentEventsCache.has(key);
    });
    const result = agentsToFetch.length > 0
      ? await fetchAgentEvents(year, agentsToFetch)
      : { failures: [], fetchedCount: 0 };
    const eventsForYear = agents.flatMap((agent) =>
      agentEventsCache.get(agentEventsCacheKey(agent, year))?.events || []
    );
    return { ...result, events: eventsForYear };
  })();
  agentEventsRequests.set(year, request);
  try {
    return await request;
  } finally {
    if (agentEventsRequests.get(year) === request) agentEventsRequests.delete(year);
  }
}

function showFeedFailures(failures) {
  if (failures.length === 0) return;
  const names = failures
    .map(({ agent }) => agent)
    .filter(Boolean)
    .map((agent) => `${agent.firstName} ${agent.lastName}`);
  showStatus(`Calendrier${names.length > 1 ? "s" : ""} illisible${names.length > 1 ? "s" : ""} : ${names.join(", ")}. ${failures[0].error}`, true);
}

async function refreshStatistics() {
  const requestId = ++statisticsRefreshId;
  if (agents.length === 0) {
    statisticsEvents = [];
    renderStatistics();
    return;
  }
  statisticsList.replaceChildren(createElement("p", "agent-calendar-status", `Chargement des statistiques ${selectedStatisticsYear}…`));
  try {
    const result = await loadAgentEvents(selectedStatisticsYear);
    if (requestId !== statisticsRefreshId) return;
    statisticsEvents = result.events;
    renderStatistics();
    showFeedFailures(result.failures);
  } catch (error) {
    if (requestId !== statisticsRefreshId) return;
    statisticsEvents = [];
    renderStatistics();
    showStatus(`Impossible de lire les flux ICS pour les statistiques : ${error.message}`, true);
  }
}

async function refreshCalendars(forceRefresh = false) {
  const requestId = ++refreshId;
  if (agents.length === 0) {
    events = [];
    trainingSessions = [];
    statisticsEvents = [];
    summary.textContent = "Ajoutez un agent pour afficher ses occupations.";
    renderCalendar();
    renderStatistics();
    return;
  }
  showStatus("");
  summary.textContent = "Lecture des occupations depuis les flux ICS…";
  try {
    const monthYear = selectedMonth.getFullYear();
    const [monthResult, statisticsResult, monthTrainingSessions] = await Promise.all([
      loadAgentEvents(monthYear, forceRefresh),
      selectedStatisticsYear === selectedMonth.getFullYear()
        ? Promise.resolve(null)
        : loadAgentEvents(selectedStatisticsYear, forceRefresh),
      loadTrainingSessions(monthYear, selectedMonth.getMonth())
    ]);
    if (requestId !== refreshId) return;
    events = monthResult.events;
    trainingSessions = monthTrainingSessions;
    statisticsEvents = statisticsResult ? statisticsResult.events : monthResult.events;
    summary.textContent = `${events.length} occupation${events.length === 1 ? "" : "s"} lue${events.length === 1 ? "" : "s"} depuis les flux ICS (non enregistrées).`;
    renderCalendar();
    renderStatistics();

    const failures = [
      ...monthResult.failures,
      ...(statisticsResult?.failures || [])
    ];
    showFeedFailures(failures);
    if (failures.length === 0) {
      showStatus("Calendriers lus depuis les flux ICS. Les occupations ne sont pas enregistrées dans Firestore.");
    }
  } catch (error) {
    if (requestId !== refreshId) return;
    showStatus(`Impossible de lire les calendriers ICS : ${error.message}`, true);
  }
}

async function addAgent(event) {
  event.preventDefault();
  const form = event.currentTarget;
  const firstName = form.elements.namedItem("firstName").value.trim();
  const lastName = form.elements.namedItem("lastName").value.trim();
  const status = form.elements.namedItem("status").value;
  const formateurCaisson = form.elements.namedItem("formateurCaisson").checked;
  const icsUrl = form.elements.namedItem("icsUrl").value.trim();
  if (!firstName || !lastName || !["SPP", "SPV"].includes(status)) {
    showStatus("Renseignez le prénom, le nom et un statut valide.", true);
    return;
  }
  if (!validFeedUrl(icsUrl)) {
    showStatus("Le lien doit être une URL HTTPS de calendrier AGATT se terminant par /occupation.ics.", true);
    return;
  }

  saveAgentButton.disabled = true;
  const wasEditing = Boolean(editingAgentId);
  showStatus(wasEditing ? "Enregistrement des modifications…" : "Enregistrement de l’agent…");
  try {
    if (editingAgentId) {
      await updateDoc(doc(db, "agentCalendars", editingAgentId), { firstName, lastName, status, formateurCaisson, icsUrl });
      clearAgentEventsCache(editingAgentId);
    } else {
      await addDoc(collection(db, "agentCalendars"), { firstName, lastName, status, formateurCaisson, icsUrl });
    }
  } catch (error) {
    showStatus(`Impossible d’enregistrer l’agent : ${error.message}`, true);
    saveAgentButton.disabled = false;
    return;
  }
  saveAgentButton.disabled = false;
  resetAgentForm();
  showStatus(wasEditing ? "Agent modifié." : "Agent ajouté.");
  try {
    await loadAgents();
    await refreshCalendars();
  } catch (error) {
    showStatus(`Agent enregistré, mais les données associées n’ont pas pu être actualisées : ${error.message}`, true);
  }
}

async function deleteLegacyAgentOccupationData(agentId) {
  const snapshot = await getDocs(query(
    collection(db, "agentOccupations"),
    where("agentId", "==", agentId)
  ));
  for (let offset = 0; offset < snapshot.docs.length; offset += 450) {
    const batch = writeBatch(db);
    for (const occupation of snapshot.docs.slice(offset, offset + 450)) {
      batch.delete(occupation.ref);
    }
    await batch.commit();
  }
  await deleteDoc(doc(db, "agentCalendarSync", agentId));
}

async function removeAgent(agent) {
  if (!window.confirm(`Supprimer l’agent ${agent.firstName} ${agent.lastName}, son lien ICS et ses anciennes occupations enregistrées ?`)) return;
  try {
    await deleteLegacyAgentOccupationData(agent.id);
    await deleteDoc(doc(db, "agentCalendars", agent.id));
    clearAgentEventsCache(agent.id);
    if (editingAgentId === agent.id) resetAgentForm();
    await loadAgents();
    await refreshCalendars();
    showStatus("Agent supprimé.");
  } catch (error) {
    showStatus(`Impossible de supprimer l’agent : ${error.message}`, true);
  }
}

async function initializeAdminPage(user) {
  loginPanel.classList.toggle("hidden", Boolean(user));
  calendarPanel.classList.toggle("hidden", !isAuthorized(user));
  deniedPanel.classList.toggle("hidden", !user || isAuthorized(user));
  signOutButton.classList.toggle("hidden", !user);
  if (!isAuthorized(user)) {
    agents = [];
    events = [];
    trainingSessions = [];
    statisticsEvents = [];
    agentEventsCache.clear();
    agentList.replaceChildren();
    calendarElement.replaceChildren();
    statisticsList.replaceChildren();
    return;
  }

  try {
    await loadAgents();
    await refreshCalendars();
  } catch (error) {
    showStatus(`Impossible de charger les agents : ${error.message}`, true);
  }
}

document.querySelector("#agent-login-form").addEventListener("submit", async (event) => {
  event.preventDefault();
  const form = event.currentTarget;
  try {
    await signInWithEmailAndPassword(auth, form.elements.email.value, form.elements.password.value);
    form.reset();
  } catch (error) {
    showStatus(`Connexion impossible : ${error.message}`, true);
  }
});
agentForm.addEventListener("submit", addAgent);
openAgentCreateButton.addEventListener("click", () => {
  resetAgentForm();
  openAgentForm();
});
closeAgentDialogButton.addEventListener("click", resetAgentForm);
cancelAgentEditButton.addEventListener("click", resetAgentForm);
agentFormDialog.addEventListener("click", (event) => {
  if (event.target === agentFormDialog) resetAgentForm();
});
agentFormDialog.addEventListener("close", () => {
  if (editingAgentId) resetAgentForm();
});
document.querySelector("#refresh-agent-calendars").addEventListener("click", () => refreshCalendars(true));
previousMonthButton.addEventListener("click", () => {
  selectedMonth.setMonth(selectedMonth.getMonth() - 1);
  refreshCalendars();
});
nextMonthButton.addEventListener("click", () => {
  selectedMonth.setMonth(selectedMonth.getMonth() + 1);
  refreshCalendars();
});
document.querySelector("#agent-month-today").addEventListener("click", () => {
  selectedMonth.setFullYear(new Date().getFullYear(), new Date().getMonth(), 1);
  refreshCalendars();
});
statisticsYear.addEventListener("change", () => {
  const year = Number(statisticsYear.value);
  if (!Number.isInteger(year) || year < 2000 || year > 2100) {
    statisticsYear.value = String(selectedStatisticsYear);
    showStatus("Choisissez une année comprise entre 2000 et 2100.", true);
    return;
  }
  selectedStatisticsYear = year;
  refreshStatistics();
});
previousStatisticsYearButton.addEventListener("click", () => {
  if (selectedStatisticsYear <= 2000) return;
  selectedStatisticsYear -= 1;
  statisticsYear.value = String(selectedStatisticsYear);
  refreshStatistics();
});
nextStatisticsYearButton.addEventListener("click", () => {
  if (selectedStatisticsYear >= 2100) return;
  selectedStatisticsYear += 1;
  statisticsYear.value = String(selectedStatisticsYear);
  refreshStatistics();
});
occupationFilter.addEventListener("change", renderCalendar);
document.querySelectorAll("[data-agent-tab]").forEach((tab) => {
  tab.addEventListener("click", () => {
    const showCalendar = tab.dataset.agentTab === "calendar";
    const showManagement = tab.dataset.agentTab === "management";
    const showStatistics = tab.dataset.agentTab === "statistics";
    document.querySelectorAll("[data-agent-tab]").forEach((item) => {
      const isActive = item === tab;
      item.classList.toggle("active", isActive);
      item.setAttribute("aria-selected", String(isActive));
    });
    calendarView.classList.toggle("hidden", !showCalendar);
    managementView.classList.toggle("hidden", !showManagement);
    statisticsView.hidden = !showStatistics;
  });
});
signOutButton.addEventListener("click", async () => {
  try {
    await signOut(auth);
  } catch (error) {
    showStatus(`Déconnexion impossible : ${error.message}`, true);
  }
});
onAuthStateChanged(auth, initializeAdminPage);
