const status = document.querySelector("#review-status");
const content = document.querySelector("#review-content");
const recordsContainer = document.querySelector("#review-records");
const commentField = document.querySelector("#review-comment");
const generalFeedback = document.querySelector("#general-comment-feedback");
const generalComments = document.querySelector("#general-review-comments");
const reviewerRoster = document.querySelector("#reviewer-roster-list");
const validationCount = document.querySelector("#review-validation-count");
const validationButton = document.querySelector("#validate-review");
const validationDialog = document.querySelector("#validation-dialog");
const confirmValidationButton = document.querySelector("#confirm-review-validation");
const reviewCode = new URLSearchParams(window.location.search).get("code") || "";
const cloudflareWorkerUrl = "https://wild-sky-abe4.cesbronluc.workers.dev/";
let reviewComments = [];
let reviewParticipants = [];
let currentReviewerValidated = false;

async function sendReviewRequest(kind, data = {}) {
  const response = await fetch(cloudflareWorkerUrl, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ kind, code: reviewCode, ...data })
  });
  let result;
  try {
    result = await response.json();
  } catch {
    throw new Error(`Le service de relecture a renvoyé une réponse invalide (HTTP ${response.status}).`);
  }
  if (!response.ok) {
    throw new Error(result.error || `Le service de relecture a répondu avec le statut HTTP ${response.status}.`);
  }
  return result;
}

function createText(tag, className, text) {
  const element = document.createElement(tag);
  if (className) element.className = className;
  if (text !== undefined) element.textContent = text;
  return element;
}

function safeColor(value, fallback = "#205b98") {
  return typeof value === "string" && /^#[\da-f]{6}$/i.test(value) ? value : fallback;
}

function toDate(value) {
  if (value instanceof Date) return value;
  if (typeof value === "string" || typeof value === "number") {
    const date = new Date(value);
    return Number.isNaN(date.getTime()) ? null : date;
  }
  return value?.toDate?.() || null;
}

function formatReviewDate(value, includeTime = false) {
  if (typeof value === "string") {
    const dateOnly = /^(\d{4})-(\d{2})-(\d{2})$/.exec(value);
    if (dateOnly) {
      const [, year, month, day] = dateOnly;
      return `${day}-${month}-${year}`;
    }
  }
  const date = toDate(value);
  if (!date) return typeof value === "string" ? value : "";
  const parts = new Intl.DateTimeFormat("fr-FR", {
    day: "2-digit",
    month: "2-digit",
    year: "numeric"
  }).formatToParts(date);
  const dateText = [
    parts.find((part) => part.type === "day")?.value,
    parts.find((part) => part.type === "month")?.value,
    parts.find((part) => part.type === "year")?.value
  ].join("-");
  if (!includeTime) return dateText;
  const time = new Intl.DateTimeFormat("fr-FR", {
    hour: "2-digit",
    minute: "2-digit"
  }).format(date);
  return `${dateText} ${time}`;
}

function renderCommentList(container, comments, emptyMessage) {
  container.replaceChildren();
  if (comments.length === 0) {
    container.append(createText("p", "review-empty-comments text-secondary small", emptyMessage));
    return;
  }
  comments.forEach((comment) => {
    const entry = createText("article", "review-comment-entry", "");
    const metadata = createText(
      "p",
      "review-comment-author",
      comment.reviewerName || "Relecteur"
    );
    const timestamp = toDate(comment.createdAt);
    if (timestamp) {
      metadata.append(document.createTextNode(` · ${formatReviewDate(timestamp, true)}`));
    }
    entry.append(metadata, createText("p", "review-comment-text", comment.comment || ""));
    (Array.isArray(comment.replies) ? comment.replies : []).forEach((reply) => {
      const response = createText("div", "review-reply-entry", "");
      const replyDate = toDate(reply.createdAt);
      response.append(createText(
        "p",
        "review-reply-author",
        `Réponse de ${reply.adminName || "l’administration"}${replyDate ? ` · ${formatReviewDate(replyDate, true)}` : ""}`
      ));
      response.append(createText("p", "review-reply-text", reply.comment || ""));
      entry.append(response);
    });
    container.append(entry);
  });
}

function renderCommentThreads() {
  renderCommentList(
    generalComments,
    reviewComments.filter((comment) => comment.type === "general"),
    "Aucun commentaire général pour le moment."
  );
  recordsContainer.querySelectorAll("[data-training-comments]").forEach((container) => {
    const trainingComments = reviewComments.filter((comment) =>
      comment.type === "training" && comment.trainingId === container.dataset.trainingComments
    );
    renderCommentList(container, trainingComments, "Aucun commentaire sur cette formation pour le moment.");
  });
}

function renderReviewerRoster() {
  reviewerRoster.replaceChildren();
  const participants = reviewParticipants.filter((reviewer) =>
    !["revoked", "published"].includes(reviewer.status)
  );
  const validatedCount = participants.filter((reviewer) => reviewer.validated).length;
  validationCount.textContent = `${validatedCount} relecteur${validatedCount > 1 ? "s" : ""} sur ${participants.length} a${validatedCount > 1 ? "ont" : ""} validé`;
  if (participants.length === 0) {
    reviewerRoster.append(createText("p", "text-secondary small mb-0", "Aucun autre relecteur n’est inscrit."));
    return;
  }
  participants.forEach((reviewer) => {
    const item = createText(
      "span",
      `reviewer-roster-item${reviewer.validated ? " is-validated" : ""}`,
      ""
    );
    item.append(createText("span", "", reviewer.validated ? "✓" : "○"));
    item.append(createText("span", "", reviewer.reviewerName || "Relecteur"));
    item.append(createText(
      "span",
      "small",
      reviewer.validated ? "Validée" : "En attente"
    ));
    reviewerRoster.append(item);
  });
}

function updateCurrentValidationState(isValidated) {
  currentReviewerValidated = Boolean(isValidated);
  validationButton.disabled = currentReviewerValidated;
  validationButton.classList.toggle("btn-success", !currentReviewerValidated);
  validationButton.classList.toggle("btn-outline-success", currentReviewerValidated);
  validationButton.textContent = currentReviewerValidated ? "Version validée" : "Valider cette version";
}

document.querySelector("#cancel-review-validation").addEventListener("click", () => {
  validationDialog.close();
});

validationButton.addEventListener("click", () => {
  if (!currentReviewerValidated) validationDialog.showModal();
});

confirmValidationButton.addEventListener("click", async () => {
  confirmValidationButton.disabled = true;
  try {
    const result = await sendReviewRequest("review_validate");
    reviewParticipants = result.reviewers || reviewParticipants;
    updateCurrentValidationState(result.currentReviewerValidated || result.alreadyValidated);
    renderReviewerRoster();
    validationDialog.close();
    status.textContent = "Votre validation a été enregistrée. Le service en est informé dans l’administration.";
    status.classList.remove("review-error");
  } catch (error) {
    status.textContent = `La validation n’a pas pu être enregistrée : ${error.message}`;
    status.classList.add("review-error");
  } finally {
    confirmValidationButton.disabled = false;
  }
});

async function submitComment({ type, textarea, feedback, button, trainingId }) {
  const comment = textarea.value.trim();
  if (!comment) {
    feedback.textContent = "Saisissez un commentaire avant de l’envoyer.";
    feedback.classList.add("review-error");
    textarea.focus();
    return;
  }
  button.disabled = true;
  try {
    const result = await sendReviewRequest("review_comment", { type, comment, trainingId });
    if (Array.isArray(result.comments)) {
      reviewComments = result.comments;
    } else if (result.comment) {
      reviewComments = [...reviewComments, result.comment];
    }
    textarea.value = "";
    feedback.textContent = "Commentaire transmis. Il est visible par les autres relecteurs et l’administration.";
    feedback.classList.remove("review-error");
    renderCommentThreads();
  } catch (error) {
    feedback.textContent = `Le commentaire n’a pas pu être transmis : ${error.message}`;
    feedback.classList.add("review-error");
  } finally {
    button.disabled = false;
  }
}

function renderTraining(training, trainingsById) {
  const card = createText("article", "card training-card h-100 review-training-card", "");
  const trainingAnchorId = `review-training-${training.id}`;
  card.id = trainingAnchorId;
  card.style.setProperty("--training-accent", training.accentColor);
  const body = createText("div", "card-body d-flex flex-column align-items-start", "");
  body.append(createText("h3", "training-title mb-2", training.title || training.id));
  const sessions = [
    ...(Array.isArray(training.sessions) ? training.sessions : []),
  ];
  const phases = Array.isArray(training.phases) ? training.phases : [];
  const badges = createText("div", "d-flex flex-wrap align-items-center gap-2 mb-3", "");
  if (training.subCategory) {
    const subcategory = createText("span", "badge rounded-pill subcategory-badge", training.subCategory);
    subcategory.style.setProperty("--subcategory-color", training.accentColor);
    subcategory.style.setProperty("--subcategory-bg", training.accentColor);
    badges.append(subcategory);
  }
  if (training.duration) {
    badges.append(createText("span", "badge rounded-pill training-duration-badge", training.duration));
  }
  const sessionCount = phases.length > 0 ? phases.length : sessions.length;
  if (sessionCount > 0) {
    badges.append(createText("span", "badge rounded-pill training-sessions-badge", `${sessionCount} session${sessionCount === 1 ? "" : "s"}`));
  }
  if (training.published === false) {
    badges.append(createText("span", "badge text-bg-secondary", "Masquée du catalogue public"));
  }
  if (badges.childElementCount) body.append(badges);
  const prerequisiteTrainings = (Array.isArray(training.prerequisiteTrainingIds)
    ? training.prerequisiteTrainingIds
    : [])
    .map((id) => trainingsById.get(id))
    .filter((item) => item && item.id !== training.id && item.published !== false);
  if (prerequisiteTrainings.length > 0) {
    const prerequisiteSection = createText("section", "review-prerequisites", "");
    prerequisiteSection.append(createText("h4", "h6 card-title detail-card-title", "Formations prérequises"));
    const prerequisiteCards = createText("div", "prerequisite-training-cards", "");
    prerequisiteTrainings.forEach((prerequisite) => {
      const link = createText("a", "prerequisite-training-card", "");
      link.href = `#review-training-${encodeURIComponent(prerequisite.id)}`;
      link.setAttribute(
        "aria-label",
        `Aller à la formation prérequise ${prerequisite.title || prerequisite.id}`
      );
      link.style.setProperty("--training-accent", prerequisite.accentColor);
      if (prerequisite.categoryName) {
        link.append(createText(
          "span",
          "prerequisite-training-category",
          [prerequisite.categoryName, prerequisite.subCategory].filter(Boolean).join(" · ")
        ));
      }
      link.append(createText(
        "span",
        "prerequisite-training-title",
        prerequisite.title || prerequisite.id
      ));
      link.addEventListener("click", (event) => {
        event.preventDefault();
        const target = document.getElementById(`review-training-${prerequisite.id}`);
        const targetCategory = target?.closest(".training-category");
        if (targetCategory) {
          targetCategory.open = true;
          recordsContainer.querySelectorAll(".training-category").forEach((category) => {
            if (category !== targetCategory) category.open = false;
          });
        }
        window.history.replaceState({}, document.title, link.href);
        window.requestAnimationFrame(() => target?.scrollIntoView({ behavior: "smooth", block: "start" }));
      });
      prerequisiteCards.append(link);
    });
    prerequisiteSection.append(prerequisiteCards);
    body.append(prerequisiteSection);
  }
  if (training.prerequisites) body.append(createText("p", "", `Prérequis : ${training.prerequisites}`));
  if (training.observations) body.append(createText("p", "", `Observations : ${training.observations}`));

  const schedule = createText("section", "review-schedule", "");
  const appendSessionList = (sessionRecords, container) => {
    if (sessionRecords.length === 0) return;
    const list = createText("div", "list-group list-group-flush review-session-list", "");
    [...sessionRecords]
      .sort((left, right) =>
        String(left.startDate || "9999-12-31").localeCompare(String(right.startDate || "9999-12-31"), "en")
      )
      .forEach((session) => {
        const item = createText("div", "list-group-item px-0 review-session-item", "");
        const dateText = session.startDate && session.endDate
          ? `${formatReviewDate(session.startDate)} au ${formatReviewDate(session.endDate)}`
          : session.startDate
            ? formatReviewDate(session.startDate)
            : session.dates || "Dates non renseignées";
        const sessionTitle = [session.sessionName, dateText]
          .filter((value) => typeof value === "string" && value.trim())
          .join(" · ") || "Dates non renseignées";
        item.append(createText("div", "fw-semibold", sessionTitle));
        if (session.cancelled === true) {
          item.append(createText("span", "session-cancelled-badge", "Session annulée"));
          if (session.cancellationReason) {
            item.append(createText("p", "session-cancellation-reason mb-0 mt-1", `Motif : ${session.cancellationReason}`));
          }
        }
        const location = createText("div", "small text-secondary mt-1 d-flex align-items-start gap-2 review-session-location", "");
        location.append(createReviewIcon("location"), createText("span", "", session.location || "Lieu non renseigné"));
        item.append(location);
        list.append(item);
      });
    container.append(list);
  };
  if (phases.length > 0) {
    const phaseList = createText("div", "vstack gap-3 review-phase-list", "");
    phases.forEach((phase, index) => {
      const phaseCard = createText("section", "phase-detail-card", "");
      phaseCard.append(createText("h4", "h6 mb-2", phase.phaseTitle || `Phase ${index + 1}`));
      appendSessionList(Array.isArray(phase.sessions) ? phase.sessions : [], phaseCard);
      phaseList.append(phaseCard);
    });
    schedule.append(phaseList);
  } else {
    appendSessionList(sessions, schedule);
  }
  if (schedule.childElementCount > 0) {
    schedule.prepend(createText("h4", "h6 card-title detail-card-title review-schedule-title", "Sessions"));
    body.append(schedule);
  }

  const discussion = createText("section", "review-discussion", "");
  discussion.append(createText("h4", "h6", "Commentaires des relecteurs"));
  const thread = createText("div", "review-comments-list", "");
  thread.dataset.trainingComments = training.id;
  discussion.append(thread);

  const form = createText("div", "review-comment-form", "");
  const label = document.createElement("label");
  const textarea = document.createElement("textarea");
  const id = `training-comment-${training.id}`;
  label.htmlFor = id;
  label.textContent = "Ajouter un commentaire (facultatif)";
  textarea.id = id;
  textarea.maxLength = 2000;
  const button = createText("button", "btn btn-outline-primary btn-sm align-self-start", "Envoyer ce commentaire");
  button.type = "button";
  const feedback = createText("p", "review-comment-feedback small", "");
  feedback.setAttribute("role", "status");
  feedback.setAttribute("aria-live", "polite");
  button.addEventListener("click", () => submitComment({
    type: "training",
    trainingId: training.id,
    textarea,
    feedback,
    button
  }));
  form.append(label, textarea, button, feedback);
  body.append(discussion, form);
  card.append(body);
  return card;
}

function renderImportantInformation(record, categoryColor) {
  const card = createText("article", "important-info-public-card important-info-text", "");
  card.style.setProperty("--important-info-color", categoryColor);
  card.append(createText("h3", "important-info-public-title", record.title || "Information"));
  if (record.published === false) card.append(createText("p", "text-secondary small", "Masquée du catalogue public"));
  if (record.description) card.append(createText("p", "important-info-public-description", record.description));
  if (record.recurrence) card.append(createText("p", "", `Récurrence : ${record.recurrence}`));
  if (Array.isArray(record.dates) && record.dates.length > 0) {
    const list = document.createElement("ul");
    record.dates.forEach((date) => {
      list.append(createText("li", "", [
        formatReviewDate(date.date) || "Date à définir",
        date.label,
        date.location
      ].filter(Boolean).join(" · ")));
    });
    card.append(list);
  }
  return card;
}

function createReviewIcon(name) {
  const paths = {
    location: "M20 10c0 5-8 12-8 12S4 15 4 10a8 8 0 1 1 16 0Z M12 10a2.5 2.5 0 1 0 0-5 2.5 2.5 0 0 0 0 5Z"
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

function renderRecords(records) {
  const categoryRecords = (records.trainingCategories || [])
    .filter((record) => record.id !== "__settings__")
    .map((record) => ({
      id: record.id,
      ...record.data
    }));
  const categoryById = new Map(categoryRecords.map((category) => [category.id, category]));
  const categoryByName = new Map(categoryRecords.map((category) => [
    String(category.name || category.id),
    category
  ]));
  const trainings = (records.trainings || []).map((record) => {
    const training = { ...record.data, id: record.id };
    const categoryValue = String(training.category || "").trim();
    const subcategoryValue = String(training.subCategory || "").trim();
    const category = categoryByName.get(categoryValue) || categoryById.get(categoryValue);
    training.categoryName = String(category?.name || categoryValue || "Sans catégorie");
    training.categoryOrder = Number.isFinite(category?.order) ? category.order : Number.POSITIVE_INFINITY;
    const subcategory = (Array.isArray(category?.subCategories) ? category.subCategories : [])
      .find((item) =>
        (typeof item === "string" ? item : String(item?.name || "").trim()) === subcategoryValue
      );
    training.subCategory = subcategoryValue;
    training.accentColor = safeColor(
      typeof subcategory === "string" ? "" : subcategory?.color,
      safeColor(category?.color)
    );
    return training;
  }).sort((left, right) =>
    left.categoryOrder - right.categoryOrder ||
    left.categoryName.localeCompare(right.categoryName, "fr") ||
    (Number.isFinite(left.order) ? left.order : Number.POSITIVE_INFINITY) -
      (Number.isFinite(right.order) ? right.order : Number.POSITIVE_INFINITY) ||
    String(left.title || left.id).localeCompare(String(right.title || right.id), "fr")
  );
  const trainingsById = new Map(trainings.map((training) => [training.id, training]));

  const trainingGroups = new Map();
  trainings.forEach((training) => {
    if (!trainingGroups.has(training.categoryName)) trainingGroups.set(training.categoryName, []);
    trainingGroups.get(training.categoryName).push(training);
  });
  const contentNodes = [
    createText("h2", "h3 mb-0", `Toutes les formations (${trainings.length})`)
  ];
  [...trainingGroups.entries()].forEach(([categoryName, categoryTrainings], index) => {
    const category = categoryByName.get(categoryName);
    const accordion = createText("details", "training-category", "");
    accordion.open = index === 0;
    accordion.style.setProperty("--category-color", safeColor(category?.color));
    const summary = createText("summary", "training-category-summary", "");
    summary.append(
      createText("span", "", categoryName),
      createText("span", "badge rounded-pill text-bg-light", `${categoryTrainings.length} formation${categoryTrainings.length > 1 ? "s" : ""}`)
    );
    accordion.append(summary);
    const cardGrid = createText("div", "training-card-grid row g-3", "");
    categoryTrainings.forEach((training) => {
      const column = createText("div", "col-12 col-md-6 col-xl-4", "");
      column.append(renderTraining(training, trainingsById));
      cardGrid.append(column);
    });
    accordion.append(cardGrid);
    accordion.addEventListener("toggle", () => {
      if (!accordion.open) return;
      recordsContainer.querySelectorAll(".training-category").forEach((other) => {
        if (other !== accordion) other.open = false;
      });
    });
    contentNodes.push(accordion);
  });

  const infoCategories = (records.importantInformationCategories || [])
    .map((record) => ({ id: record.id, ...record.data }));
  const infoCategoryById = new Map(infoCategories.map((category) => [category.id, category]));
  const info = (records.importantInformation || []).map((record) => ({
    ...record.data,
    id: record.id
  }));
  const groupedInfo = new Map();
  info.forEach((record) => {
    if (!groupedInfo.has(record.categoryId)) groupedInfo.set(record.categoryId, []);
    groupedInfo.get(record.categoryId).push(record);
  });
  const sortedInfoCategories = [...groupedInfo.entries()].sort(([leftId], [rightId]) => {
    const left = infoCategoryById.get(leftId);
    const right = infoCategoryById.get(rightId);
    return (Number.isFinite(left?.order) ? left.order : Number.POSITIVE_INFINITY) -
      (Number.isFinite(right?.order) ? right.order : Number.POSITIVE_INFINITY) ||
      String(left?.name || "").localeCompare(String(right?.name || ""), "fr");
  });
  contentNodes.push(createText("section", "important-information-section", ""));
  const infoSection = contentNodes[contentNodes.length - 1];
  infoSection.append(createText("h2", "h3 mb-3", "Dates et informations à retenir"));
  if (sortedInfoCategories.length === 0) {
    infoSection.append(createText("p", "text-secondary", "Aucune date ou information à retenir."));
  }
  sortedInfoCategories.forEach(([categoryId, categoryRecordsForInfo]) => {
    const category = infoCategoryById.get(categoryId);
    const group = createText("section", "important-info-public-category", "");
    group.style.setProperty("--important-info-color", safeColor(category?.color));
    group.append(createText("h3", "important-info-public-category-title", category?.name || "Sans catégorie"));
    const entries = createText("div", "important-info-public-entries", "");
    categoryRecordsForInfo
      .sort((left, right) =>
        (Number.isFinite(left.order) ? left.order : Number.POSITIVE_INFINITY) -
          (Number.isFinite(right.order) ? right.order : Number.POSITIVE_INFINITY) ||
        String(left.title || "").localeCompare(String(right.title || ""), "fr")
      )
      .forEach((record) => entries.append(renderImportantInformation(
        record,
        safeColor(category?.color)
      )));
    group.append(entries);
    infoSection.append(group);
  });
  recordsContainer.replaceChildren(...contentNodes);
  renderCommentThreads();
}

document.querySelector("#submit-general-comment").addEventListener("click", (event) => {
  submitComment({
    type: "general",
    textarea: commentField,
    feedback: generalFeedback,
    button: event.currentTarget
  });
});

document.querySelector("#refresh-review-comments").addEventListener("click", async (event) => {
  const button = event.currentTarget;
  button.disabled = true;
  try {
    const result = await sendReviewRequest("review_comments");
    reviewComments = result.comments || [];
    reviewParticipants = result.reviewers || reviewParticipants;
    updateCurrentValidationState(result.currentReviewerValidated);
    renderReviewerRoster();
    renderCommentThreads();
    status.textContent = "Commentaires et réponses actualisés.";
    status.classList.remove("review-error");
  } catch (error) {
    status.textContent = `Impossible d’actualiser les commentaires : ${error.message}`;
    status.classList.add("review-error");
  } finally {
    button.disabled = false;
  }
});

async function loadReview() {
  if (!reviewCode) {
    status.textContent = "Lien incomplet. Demandez un nouveau lien aux administrateurs.";
    status.classList.add("review-error");
    return;
  }
  try {
    const result = await sendReviewRequest("review_load");
    document.querySelector("#review-title").textContent = `${result.version.title} · ${result.version.year}`;
    document.querySelector("#reviewer-name").textContent = `Relecture attribuée à : ${result.version.reviewerName || "Relecteur"}`;
    reviewComments = result.comments || [];
    reviewParticipants = result.reviewers || [];
    updateCurrentValidationState(result.currentReviewerValidated);
    renderReviewerRoster();
    renderRecords(result.records);
    content.hidden = false;
    document.querySelector("#refresh-review-comments").disabled = false;
    validationButton.disabled = currentReviewerValidated;
    status.textContent = "Version en cours de relecture. Les commentaires et les réponses sont partagés entre les relecteurs ; ils ne bloquent pas la publication.";
  } catch (error) {
    status.textContent = `Accès refusé : ${error.message}`;
    status.classList.add("review-error");
  }
}

loadReview();
