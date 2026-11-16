import { firebaseConfig } from "./firebase-config.js";
import {
  connectFirebaseEmulators,
  getFirebaseConfig
} from "./firebase-environment.js";
import { initializeApp } from "https://www.gstatic.com/firebasejs/11.10.0/firebase-app.js";
import {
  getAuth,
  onAuthStateChanged,
  sendEmailVerification,
  signInWithEmailAndPassword,
  signOut
} from "https://www.gstatic.com/firebasejs/11.10.0/firebase-auth.js";
import {
  arrayUnion,
  collection,
  doc,
  getFirestore,
  onSnapshot,
  Timestamp,
  updateDoc
} from "https://www.gstatic.com/firebasejs/11.10.0/firebase-firestore.js";
import {
  createCatalogReviewVersion,
  addCatalogReviewer,
  deleteCatalogReviewVersion,
  endCatalogReview,
  listCatalogReviewData,
  publishCatalogReviewVersion,
  restoreCatalogArchive,
  resetCatalogReviewerLink,
  revokeCatalogReviewer,
  submitCatalogReviewVersion
} from "./catalog-review-workflow.js";

const adminEmails = ["luc.cesbron@sdis53.fr", "formation@sdis53.fr"];
const loginPanel = document.querySelector("#login-panel");
const versionsPanel = document.querySelector("#versions-panel");
const workspace = document.querySelector("#versions-workspace");
const accessStatus = document.querySelector("#access-status");
const status = document.querySelector("#versions-status");
const reviewVersionsList = document.querySelector("#review-versions-list");
const catalogArchivesList = document.querySelector("#catalog-archives-list");
const liveUpdateStatus = document.querySelector("#live-update-status");
const versionFilter = document.querySelector("#version-filter");
const versionResultsSummary = document.querySelector("#version-results-summary");
const reviewLinkResult = document.querySelector("#review-link-result");
const createForm = document.querySelector("#create-version-form");
const createButton = document.querySelector("#create-version-button");
const signOutButton = document.querySelector("#sign-out");
const verificationNotice = document.querySelector("#verification-notice");
const isConfigured = ["apiKey", "authDomain", "projectId", "appId"]
  .every((key) => Boolean(firebaseConfig[key]));

let auth;
let db;
let versions = [];
let stopWatchingReviewData;
let liveRefreshTimer;
let displayedVersions = [];

function showStatus(message, isError = false) {
  status.textContent = message;
  status.classList.toggle("error", isError);
}

function setAccessStatus(message, isError = false) {
  accessStatus.textContent = message;
  accessStatus.classList.toggle("error", isError);
}

function isAuthorized(user) {
  return user?.emailVerified &&
    adminEmails.includes(String(user.email || "").trim().toLocaleLowerCase("fr"));
}

function makeButton(label, className, handler) {
  const button = document.createElement("button");
  button.type = "button";
  button.className = className;
  button.textContent = label;
  button.addEventListener("click", handler);
  return button;
}

function formatReviewTimestamp(value) {
  const date = value?.toDate?.() || (value instanceof Date ? value : null);
  if (!date) return "";
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
  const time = new Intl.DateTimeFormat("fr-FR", {
    hour: "2-digit",
    minute: "2-digit"
  }).format(date);
  return `${dateText} ${time}`;
}

async function replyToReviewComment(version, comment, button, textarea, feedback) {
  const text = textarea.value.trim();
  if (!text) {
    feedback.textContent = "Saisissez une réponse avant de l’envoyer.";
    feedback.classList.add("error");
    textarea.focus();
    return;
  }
  button.disabled = true;
  feedback.textContent = "";
  try {
    const reply = {
      comment: text,
      adminName: auth.currentUser?.displayName || auth.currentUser?.email || "Administration",
      createdAt: Timestamp.now()
    };
    if (comment.legacyReviewComment && comment.reviewLinkId) {
      await updateDoc(doc(db, "catalogReviewLinks", comment.reviewLinkId), {
        lastReviewReplies: arrayUnion(reply)
      });
    } else {
      const commentRef = comment.reviewLinkId
        ? doc(db, "catalogReviewLinks", comment.reviewLinkId, "comments", comment.id)
        : doc(db, "catalogVersions", version.id, "comments", comment.id);
      await updateDoc(commentRef, { replies: arrayUnion(reply) });
    }
    textarea.value = "";
    feedback.textContent = "Réponse publiée. Elle est visible par les relecteurs.";
    feedback.classList.remove("error");
    showStatus("Réponse publiée. Elle est visible par les relecteurs.");
    try {
      await refreshVersions();
    } catch (error) {
      showStatus(`Réponse publiée, mais la liste n’a pas pu être actualisée : ${error.message}`, true);
    }
  } catch (error) {
    feedback.textContent = `La réponse n’a pas pu être publiée : ${error.message}`;
    feedback.classList.add("error");
    button.disabled = false;
  }
}

function appendCommentReplies(entry, comment) {
  (Array.isArray(comment.replies) ? comment.replies : []).forEach((reply) => {
    const response = document.createElement("div");
    response.className = "review-admin-reply";
    const author = document.createElement("strong");
    author.textContent = `Réponse de ${reply.adminName || "l’administration"}`;
    const text = document.createElement("p");
    text.textContent = reply.comment || "";
    response.append(author, text);
    const timestamp = reply.createdAt?.toDate?.() || (
      reply.createdAt instanceof Date ? reply.createdAt : null
    );
    if (timestamp) {
      const date = document.createElement("time");
      date.dateTime = timestamp.toISOString();
      date.textContent = formatReviewTimestamp(timestamp);
      response.append(date);
    }
    entry.append(response);
  });
}

function showReviewLink(code, version, reviewerName) {
  const link = new URL("./relecture.html", window.location.href);
  link.searchParams.set("code", code);
  const message = document.createElement("p");
  message.textContent = `Lien individuel de ${reviewerName} pour « ${version.title} · ${version.year} ». Copiez-le maintenant : il ne sera affiché qu’une seule fois.`;
  const anchor = document.createElement("a");
  anchor.href = link.href;
  anchor.target = "_blank";
  anchor.rel = "noopener noreferrer";
  anchor.textContent = link.href;
  const copyButton = makeButton("Copier le lien", "button secondary", async () => {
    try {
      await navigator.clipboard.writeText(link.href);
      showStatus("Lien de relecture copié.");
    } catch (error) {
      showStatus(`Impossible de copier le lien : ${error.message}`, true);
    }
  });
  reviewLinkResult.replaceChildren(message, anchor, copyButton);
  reviewLinkResult.hidden = false;
  reviewLinkResult.scrollIntoView({ behavior: "smooth", block: "center" });
}

function makeVersionCard(version) {
  const labels = {
    draft: "Brouillon",
    in_review: "En relecture",
    corrections_requested: "Corrections demandées",
    approved: "Approuvée",
    published: "Publiée",
    archived: "Archivée",
    incomplete: "Copie incomplète — ne pas publier",
    deleting: "Suppression en cours",
    revoked: "Lien révoqué"
  };
  const card = document.createElement("article");
  card.className = "catalog-version-card";
  card.dataset.versionId = version.id;
  const details = document.createElement("div");
  const title = document.createElement("h3");
  title.textContent = `${version.title} · ${version.year}`;
  const state = document.createElement("p");
  state.className = "version-status";
  state.textContent = labels[version.status] || version.status;
  details.append(title, state);
  const reviewers = version.reviewers || [];
  const activeReviewers = reviewers.filter((reviewer) =>
    !["revoked", "deleting", "published", "Lien historique"].includes(reviewer.status)
  );
  const commentCount = reviewers.reduce((total, reviewer) =>
    total + (reviewer.comments || []).filter((comment) => comment.type !== "validation").length, 0
  );
  const reviewSummary = document.createElement("p");
  reviewSummary.className = "version-review-summary";
  const validatedCount = activeReviewers.filter((reviewer) => reviewer.validated).length;
  reviewSummary.textContent =
    `${activeReviewers.length} relecteur${activeReviewers.length > 1 ? "s" : ""} · ` +
    `${validatedCount} validation${validatedCount > 1 ? "s" : ""} · ` +
    `${commentCount} commentaire${commentCount > 1 ? "s" : ""}`;
  details.append(reviewSummary);
  const canManageReviewers = ["draft", "corrections_requested", "in_review"].includes(version.status);
  if (canManageReviewers) {
    const reviewerForm = document.createElement("form");
    reviewerForm.className = "reviewer-add-form";
    const reviewerLabel = document.createElement("label");
    reviewerLabel.textContent = "Ajouter un relecteur";
    const reviewerNameInput = document.createElement("input");
    reviewerNameInput.type = "text";
    reviewerNameInput.maxLength = 100;
    reviewerNameInput.required = true;
    reviewerNameInput.placeholder = "Nom du relecteur";
    reviewerNameInput.dataset.stateKey = `reviewer-name-${version.id}`;
    reviewerLabel.append(reviewerNameInput);
    const identityNote = document.createElement("small");
    identityNote.textContent = "Un lien perdu ne peut pas être récupéré ; réinitialisez-le pour en créer un nouveau. Le nom n’est pas vérifié.";
    const addButton = document.createElement("button");
    addButton.type = "submit";
    addButton.className = "button secondary";
    addButton.textContent = "Ajouter et créer son lien";
    reviewerForm.append(reviewerLabel, identityNote, addButton);
    reviewerForm.addEventListener("submit", (event) => {
      event.preventDefault();
      addReviewer(version, reviewerNameInput.value, addButton);
    });
    details.append(reviewerForm);
  }

  const reviewerSection = document.createElement("section");
  reviewerSection.className = "version-reviewers";
  const reviewerHeading = document.createElement("h4");
  reviewerHeading.textContent = `Relecteurs et commentaires (${reviewers.length})`;
  reviewerSection.append(reviewerHeading);
  if (reviewers.length === 0) {
    const noReviewers = document.createElement("p");
    noReviewers.textContent = "Aucun relecteur ajouté.";
    reviewerSection.append(noReviewers);
  }
  reviewers.forEach((reviewer) => {
    const reviewerDetails = document.createElement("details");
    reviewerDetails.className = "reviewer-details";
    reviewerDetails.dataset.versionId = version.id;
    reviewerDetails.dataset.reviewerId = reviewer.id;
    reviewerDetails.dataset.detailKey = `reviewer-${version.id}-${reviewer.id}`;
    const reviewerSummary = document.createElement("summary");
    const reviewerStatus = labels[reviewer.status] || reviewer.status || "Lien historique";
    reviewerSummary.textContent = `${reviewer.reviewerName || "Relecteur"} · ${reviewerStatus} · ${reviewer.validated ? "Version validée" : "En attente de validation"} · ${(reviewer.comments || []).filter((comment) => comment.type !== "validation").length} commentaire(s)`;
    reviewerDetails.append(reviewerSummary);
    if (reviewer.validated) {
      const validationBadge = document.createElement("p");
      validationBadge.className = "review-validation-badge";
      validationBadge.textContent = "✓ Version validée en l’état par ce relecteur";
      reviewerDetails.append(validationBadge);
    }
    if (canManageReviewers && !String(reviewer.id).startsWith("historical-")) {
      const reviewerActions = document.createElement("div");
      reviewerActions.className = "reviewer-actions";
      if (!["deleting", "published"].includes(reviewer.status)) {
        reviewerActions.append(makeButton("Réinitialiser le lien", "button secondary", () =>
          resetReviewerLink(version, reviewer)
        ));
      }
      if (["draft", "in_review", "corrections_requested"].includes(reviewer.status)) {
        reviewerActions.append(makeButton("Supprimer ce relecteur", "button danger", () =>
          removeReviewer(version, reviewer)
        ));
      }
      if (reviewerActions.childElementCount) reviewerDetails.append(reviewerActions);
    }
    if (!reviewer.comments?.length) {
      const noComments = document.createElement("p");
      noComments.textContent = "Aucun commentaire transmis.";
      reviewerDetails.append(noComments);
    }
    (reviewer.comments || [])
      .slice()
      .sort((left, right) => (right.createdAt?.toMillis?.() || 0) - (left.createdAt?.toMillis?.() || 0))
      .forEach((comment) => {
        const entry = document.createElement("article");
        entry.className = "review-comment-entry";
        if (comment.type === "validation") {
          const validation = document.createElement("p");
          validation.className = "review-validation-entry";
          validation.textContent = `✓ ${comment.reviewerName || reviewer.reviewerName || "Relecteur"} a validé cette version en l’état`;
          const validationDate = formatReviewTimestamp(comment.createdAt);
          if (validationDate) validation.textContent += ` · ${validationDate}`;
          entry.append(validation);
          reviewerDetails.append(entry);
          return;
        }
        const subject = document.createElement("strong");
        subject.textContent = comment.type === "training"
          ? `Formation : ${comment.trainingTitle || comment.trainingId}`
          : "Commentaire général";
        const text = document.createElement("p");
        text.textContent = comment.comment || "";
        const date = document.createElement("time");
        const timestamp = comment.createdAt?.toDate?.();
        if (timestamp) {
          date.dateTime = timestamp.toISOString();
          date.textContent = formatReviewTimestamp(timestamp);
        }
        entry.append(subject, text);
        if (date.textContent) entry.append(date);
        appendCommentReplies(entry, comment);
        const replyDetails = document.createElement("details");
        replyDetails.className = "review-admin-reply-form";
        replyDetails.dataset.detailKey = `reply-${version.id}-${reviewer.id}-${comment.id}`;
        const replySummary = document.createElement("summary");
        replySummary.textContent = "Répondre au commentaire";
        const replyTextarea = document.createElement("textarea");
        replyTextarea.maxLength = 2000;
        replyTextarea.rows = 3;
        replyTextarea.dataset.stateKey = `reply-${version.id}-${reviewer.id}-${comment.id}`;
        replyTextarea.setAttribute("aria-label", "Votre réponse au commentaire");
        const feedback = document.createElement("p");
        feedback.className = "review-comment-feedback";
        feedback.setAttribute("role", "status");
        const replyButton = makeButton("Envoyer la réponse", "button secondary", () =>
          replyToReviewComment(version, comment, replyButton, replyTextarea, feedback)
        );
        replyDetails.append(replySummary, replyTextarea, replyButton, feedback);
        entry.append(replyDetails);
        reviewerDetails.append(entry);
      });
    reviewerSection.append(reviewerDetails);
  });
  const actions = document.createElement("div");
  actions.className = "catalog-version-actions";
  const deletableStatuses = [
    "draft",
    "in_review",
    "corrections_requested",
    "approved",
    "incomplete",
    "deleting"
  ];
  if (version.status === "deleting") {
    const deletionNote = document.createElement("p");
    deletionNote.textContent = "La suppression a été interrompue. Relancez-la pour terminer.";
    details.append(deletionNote);
    actions.append(makeButton("Reprendre la suppression", "button danger", () => deleteVersion(version, true)));
  } else if (["draft", "corrections_requested"].includes(version.status)) {
    actions.append(makeButton("Modifier cette copie", "button secondary", () => {
      const url = new URL("./admin.html", window.location.href);
      url.searchParams.set("catalogVersionId", version.id);
      window.location.assign(url.href);
    }));
    actions.append(makeButton(
      version.status === "draft" ? "Soumettre à la relecture" : "Renvoyer en relecture",
      "button secondary",
      () => submitVersion(version)
    ));
  }
  if (["in_review", "corrections_requested", "approved"].includes(version.status)) {
    actions.append(makeButton("Publier cette version", "button primary", () => publishVersion(version)));
  }
  if (version.status === "in_review") {
    actions.append(makeButton("Terminer les retours et modifier", "button secondary", () =>
      finishReview(version)
    ));
  }
  if (deletableStatuses.includes(version.status) && version.status !== "deleting") {
    actions.append(makeButton("Supprimer cette version", "button danger", () => deleteVersion(version)));
  }
  card.append(details, actions, reviewerSection);
  return card;
}

function renderVersions() {
  const openDetails = new Set(
    [...reviewVersionsList.querySelectorAll("details[data-detail-key][open]")].map((details) =>
      details.dataset.detailKey
    )
  );
  const fieldValues = new Map(
    [...reviewVersionsList.querySelectorAll("[data-state-key]")].map((field) => [
      field.dataset.stateKey,
      field.value
    ])
  );
  const focusedStateKey = reviewVersionsList.contains(document.activeElement)
    ? document.activeElement.dataset.stateKey
    : null;
  reviewVersionsList.replaceChildren();
  const filter = versionFilter.value.trim().toLocaleLowerCase("fr");
  displayedVersions = versions.filter((version) => {
    if (!filter) return true;
    return [
      version.title,
      version.year,
      version.status,
      ({
        draft: "Brouillon",
        in_review: "En relecture",
        corrections_requested: "Corrections demandées",
        approved: "Approuvée",
        published: "Publiée",
        archived: "Archivée"
      })[version.status],
      ...(version.reviewers || []).map((reviewer) => reviewer.reviewerName)
    ].some((value) => String(value || "").toLocaleLowerCase("fr").includes(filter));
  });
  versionResultsSummary.textContent = filter
    ? `${displayedVersions.length} version${displayedVersions.length === 1 ? "" : "s"} sur ${versions.length}`
    : `${versions.length} version${versions.length === 1 ? "" : "s"}`;
  if (versions.length === 0) {
    const empty = document.createElement("p");
    empty.className = "empty-state";
    empty.textContent = "Aucune version de relecture créée.";
    reviewVersionsList.append(empty);
    return;
  }
  if (displayedVersions.length === 0) {
    const empty = document.createElement("p");
    empty.className = "empty-state";
    empty.textContent = "Aucune version ne correspond à cette recherche.";
    reviewVersionsList.append(empty);
    return;
  }
  displayedVersions.forEach((version) => {
    const card = makeVersionCard(version);
    card.querySelectorAll("details[data-detail-key]").forEach((details) => {
      details.open = openDetails.has(details.dataset.detailKey);
    });
    reviewVersionsList.append(card);
  });
  reviewVersionsList.querySelectorAll("[data-state-key]").forEach((field) => {
    if (fieldValues.has(field.dataset.stateKey)) field.value = fieldValues.get(field.dataset.stateKey);
  });
  if (focusedStateKey) {
    const focusedField = [...reviewVersionsList.querySelectorAll("[data-state-key]")]
      .find((field) => field.dataset.stateKey === focusedStateKey);
    focusedField?.focus();
  }
}

async function refreshVersions() {
  const { versions: loadedVersions, archives } = await listCatalogReviewData(db);
  versions = loadedVersions;
  renderVersions();
  renderArchives(archives);
}

function watchReviewDataChanges() {
  stopWatchingReviewData?.();
  const stopListeners = [];
  const nestedListeners = new Map();
  const scheduleRefresh = () => {
    liveUpdateStatus.textContent = "Nouvelle activité détectée · actualisation…";
    liveUpdateStatus.classList.remove("error");
    clearTimeout(liveRefreshTimer);
    liveRefreshTimer = setTimeout(async () => {
      try {
        await refreshVersions();
        const syncedAt = new Intl.DateTimeFormat("fr-FR", {
          hour: "2-digit",
          minute: "2-digit",
          second: "2-digit"
        }).format(new Date());
        liveUpdateStatus.textContent = `Mises à jour en direct actives · synchronisé à ${syncedAt}`;
        liveUpdateStatus.classList.remove("error");
      } catch (error) {
        liveUpdateStatus.textContent = `Actualisation en direct impossible : ${error.message}`;
        liveUpdateStatus.classList.add("error");
      }
    }, 250);
  };
  const showListenerError = (error) => {
    liveUpdateStatus.textContent = `Mises à jour en direct interrompues : ${error.message}`;
    liveUpdateStatus.classList.add("error");
  };
  const syncNestedListeners = (prefix, documents, getCollection) => {
    const desired = new Map(documents.map((snapshot) => [
      `${prefix}:${snapshot.id}`,
      getCollection(snapshot)
    ]));
    for (const [key, unsubscribe] of nestedListeners) {
      if (key.startsWith(`${prefix}:`) && !desired.has(key)) {
        unsubscribe();
        nestedListeners.delete(key);
      }
    }
    desired.forEach((targetCollection, key) => {
      if (nestedListeners.has(key)) return;
      nestedListeners.set(key, onSnapshot(
        targetCollection,
        scheduleRefresh,
        showListenerError
      ));
    });
  };

  stopListeners.push(
    onSnapshot(collection(db, "catalogVersions"), (snapshot) => {
      const activeVersions = snapshot.docs.filter((version) =>
        ["draft", "in_review", "corrections_requested"].includes(version.data().status)
      );
      syncNestedListeners("version-comments", activeVersions, (version) =>
        collection(version.ref, "comments")
      );
      const editableVersions = snapshot.docs.filter((version) =>
        ["draft", "corrections_requested"].includes(version.data().status)
      );
      const versionRecordCollections = editableVersions.flatMap((version) =>
        [
          "trainings",
          "trainingCategories",
          "trainingLocations",
          "trainingContacts",
          "importantInformation",
          "importantInformationCategories"
        ].map((name) => ({
          id: `${version.id}:${name}`,
          ref: collection(version.ref, "records", name, "items")
        }))
      );
      syncNestedListeners("version-records", versionRecordCollections, (item) => item.ref);
      scheduleRefresh();
    }, showListenerError),
    onSnapshot(collection(db, "catalogReviewLinks"), (snapshot) => {
      const activeLinks = snapshot.docs.filter((link) => link.data().status === "in_review");
      syncNestedListeners("link-comments", activeLinks, (link) =>
        collection(link.ref, "comments")
      );
      scheduleRefresh();
    }, showListenerError),
    onSnapshot(collection(db, "catalogArchives"), scheduleRefresh, showListenerError)
  );
  stopWatchingReviewData = () => {
    clearTimeout(liveRefreshTimer);
    stopListeners.forEach((unsubscribe) => unsubscribe());
    nestedListeners.forEach((unsubscribe) => unsubscribe());
    nestedListeners.clear();
  };
}

async function refreshAfterAction(message) {
  showStatus(message);
  try {
    await refreshVersions();
  } catch (error) {
    showStatus(`${message} La liste n’a pas pu être actualisée : ${error.message}`, true);
  }
}

function renderArchives(archives) {
  catalogArchivesList.replaceChildren();
  if (archives.length === 0) {
    const empty = document.createElement("p");
    empty.className = "empty-state";
    empty.textContent = "Aucun catalogue remplacé n’est archivé.";
    catalogArchivesList.append(empty);
    return;
  }
  archives.forEach((archive) => {
    const card = document.createElement("article");
    card.className = "catalog-version-card";
    const details = document.createElement("div");
    const title = document.createElement("h3");
    title.textContent = "Catalogue archivé";
    const description = document.createElement("p");
    description.textContent = archive.beforePublishingVersionId
      ? `Archive créée avant la publication de la version ${archive.beforePublishingVersionId}.`
      : "Archive du catalogue précédent.";
    details.append(title, description);
    const actions = document.createElement("div");
    actions.className = "catalog-version-actions";
    actions.append(makeButton("Restaurer cette archive", "button secondary", async () => {
      if (!window.confirm("Restaurer cette archive ? Vérifiez le catalogue après le retour arrière.")) return;
      try {
        await restoreCatalogArchive(db, archive.id, auth.currentUser.email);
        await refreshAfterAction("Archive restaurée. Les changements postérieurs non conflictuels ont été conservés.");
      } catch (error) {
        showStatus(`Impossible de restaurer l’archive : ${error.message}`, true);
      }
    }));
    card.append(details, actions);
    catalogArchivesList.append(card);
  });
}

async function submitVersion(version) {
  if (!window.confirm(`Soumettre « ${version.title} » à la relecture ? La copie sera figée pendant la collecte des commentaires.`)) return;
  try {
    await submitCatalogReviewVersion(db, version.id);
    await refreshAfterAction("Version soumise à la relecture.");
  } catch (error) {
    showStatus(`Impossible de soumettre la version : ${error.message}`, true);
  }
}

async function addReviewer(version, reviewerName, button) {
  const normalizedName = reviewerName.trim();
  if (!normalizedName) return;
  button.disabled = true;
  try {
    const result = await addCatalogReviewer(db, version.id, normalizedName);
    showReviewLink(result.code, version, result.reviewerName);
    showStatus(`Le lien individuel de ${result.reviewerName} a été créé.`);
    try {
      await refreshVersions();
    } catch (error) {
      showStatus(`Lien créé et affiché, mais la liste n’a pas pu être actualisée : ${error.message}`, true);
    }
  } catch (error) {
    showStatus(`Impossible d’ajouter ce relecteur : ${error.message}`, true);
    button.disabled = false;
  }
}

async function removeReviewer(version, reviewer) {
  const name = reviewer.reviewerName || "Relecteur";
  if (!window.confirm(`Révoquer le lien individuel de ${name} ? Ses commentaires déjà transmis resteront consultables.`)) return;
  try {
    await revokeCatalogReviewer(db, version.id, reviewer.id);
    await refreshAfterAction(`Le lien de ${name} a été révoqué. Ses commentaires sont conservés.`);
  } catch (error) {
    showStatus(`Impossible de supprimer ce relecteur : ${error.message}`, true);
  }
}

async function resetReviewerLink(version, reviewer) {
  const name = reviewer.reviewerName || "Relecteur";
  if (!window.confirm(
    `Créer un nouveau lien pour ${name} ? L’ancien lien sera immédiatement désactivé. Ses commentaires déjà transmis resteront conservés.`
  )) return;
  try {
    const result = await resetCatalogReviewerLink(db, version.id, reviewer.id);
    showReviewLink(result.code, version, result.reviewerName);
    showStatus(`Nouveau lien créé pour ${result.reviewerName}. Transmettez ce nouveau lien au relecteur.`);
    try {
      await refreshVersions();
    } catch (error) {
      showStatus(`Nouveau lien créé et affiché, mais la liste n’a pas pu être actualisée : ${error.message}`, true);
    }
  } catch (error) {
    showStatus(`Impossible de réinitialiser le lien de ${name} : ${error.message}`, true);
  }
}

async function finishReview(version) {
  if (!window.confirm(`Terminer la collecte des retours pour « ${version.title} » et ouvrir la copie à la modification ? Les liens seront temporairement désactivés ; les commentaires resteront conservés.`)) return;
  try {
    await endCatalogReview(db, version.id);
    await refreshAfterAction("Relecture terminée. Les commentaires sont conservés et la copie peut être modifiée.");
  } catch (error) {
    showStatus(`Impossible de terminer la relecture : ${error.message}`, true);
  }
}

async function publishVersion(version) {
  if (!window.confirm(`Publier « ${version.title} » ? Les commentaires des relecteurs ne bloquent pas cette décision. Le catalogue public actuel sera archivé et remplacé.`)) return;
  try {
    await publishCatalogReviewVersion(db, version.id, auth.currentUser.email);
    await refreshAfterAction("Nouvelle version publiée. L’ancien catalogue est archivé et la relecture est désactivée.");
  } catch (error) {
    showStatus(`Impossible de publier la version : ${error.message}`, true);
  }
}

async function deleteVersion(version, resume = false) {
  const message = resume
    ? `Terminer la suppression de « ${version.title} » ?`
    : `Supprimer définitivement « ${version.title} », ses liens de relecture et les commentaires associés ? Cette action est réservée aux versions non publiées et ne modifie pas le catalogue public.`;
  if (!window.confirm(message)) return;
  try {
    await deleteCatalogReviewVersion(db, version.id);
    await refreshAfterAction(`La version « ${version.title} » et son lien de relecture ont été supprimés.`);
  } catch (error) {
    showStatus(`Suppression incomplète de « ${version.title} » : ${error.message}. Si elle apparaît toujours comme « Suppression en cours », relancez sa suppression.`, true);
    try {
      await refreshVersions();
    } catch (refreshError) {
      showStatus(`Suppression incomplète : ${error.message}. Impossible d’actualiser la liste : ${refreshError.message}`, true);
    }
  }
}

createForm.addEventListener("submit", async (event) => {
  event.preventDefault();
  const year = Number(createForm.elements.year.value);
  const title = createForm.elements.title.value.trim();
  const reviewerName = createForm.elements.reviewerName.value.trim();
  if (!Number.isInteger(year) || year < 2000 || year > 2200 || !title || !reviewerName) {
    showStatus("Renseignez une année, un nom de version et le nom du premier relecteur.", true);
    return;
  }
  createButton.disabled = true;
  reviewLinkResult.hidden = true;
  try {
    const version = await createCatalogReviewVersion(db, {
      year,
      title,
      reviewerName,
      createdBy: auth.currentUser.email
    });
    showReviewLink(version.code, version, version.reviewerName);
    showStatus("Copie créée. Elle est distincte du catalogue public.");
    try {
      await refreshVersions();
    } catch (error) {
      showStatus(`Version créée et lien affiché, mais la liste n’a pas pu être actualisée : ${error.message}`, true);
    }
  } catch (error) {
    showStatus(`Impossible de créer la version : ${error.message}`, true);
  } finally {
    createButton.disabled = false;
  }
});

document.querySelector("#refresh-versions").addEventListener("click", async () => {
  try {
    await refreshVersions();
    showStatus("Liste des versions actualisée.");
  } catch (error) {
    showStatus(`Impossible d’actualiser les versions : ${error.message}`, true);
  }
});

versionFilter.addEventListener("input", renderVersions);

document.querySelector("#login-form").addEventListener("submit", async (event) => {
  event.preventDefault();
  const form = event.currentTarget;
  try {
    await signInWithEmailAndPassword(auth, form.elements.email.value, form.elements.password.value);
    form.reset();
  } catch (error) {
    setAccessStatus(`Connexion impossible : ${error.message}`, true);
  }
});

signOutButton.addEventListener("click", async () => {
  try {
    await signOut(auth);
  } catch (error) {
    setAccessStatus(`Déconnexion impossible : ${error.message}`, true);
  }
});

document.querySelector("#resend-verification").addEventListener("click", async () => {
  if (!auth.currentUser || auth.currentUser.emailVerified) return;
  try {
    await sendEmailVerification(auth.currentUser);
    setAccessStatus(`Courriel de vérification envoyé à ${auth.currentUser.email}.`);
  } catch (error) {
    setAccessStatus(`Impossible d’envoyer le courriel : ${error.message}`, true);
  }
});

const yearField = document.querySelector("#version-year");
const titleField = document.querySelector("#version-title");
yearField.value = String(new Date().getFullYear() + 1);
titleField.value = `Catalogue ${yearField.value}`;
yearField.addEventListener("input", () => {
  if (titleField.value.startsWith("Catalogue ")) {
    titleField.value = `Catalogue ${yearField.value}`;
  }
});

if (!isConfigured) {
  setAccessStatus("Configuration Firebase manquante. Vérifiez firebase-config.js.", true);
} else {
  const app = initializeApp(getFirebaseConfig(firebaseConfig));
  auth = getAuth(app);
  db = getFirestore(app);
  connectFirebaseEmulators({ auth, db });
  onAuthStateChanged(auth, async (user) => {
    stopWatchingReviewData?.();
    stopWatchingReviewData = null;
    loginPanel.classList.toggle("hidden", Boolean(user));
    versionsPanel.classList.toggle("hidden", !user);
    verificationNotice.classList.toggle("hidden", !user || user.emailVerified);
    workspace.classList.add("hidden");
    if (!user) {
      liveUpdateStatus.textContent = "Mises à jour en direct en attente…";
      document.querySelector("#signed-in-as").textContent = "";
      setAccessStatus("");
      return;
    }
    document.querySelector("#signed-in-as").textContent = `Connecté en tant que ${user.email || user.uid}`;
    if (!user.emailVerified) {
      setAccessStatus("Vérifiez l’adresse e-mail du compte pour accéder à la gestion des versions.", true);
      return;
    }
    if (!isAuthorized(user)) {
      setAccessStatus("Cette page est réservée aux comptes administrateur autorisés.", true);
      return;
    }
    try {
      await user.getIdToken(true);
      await refreshVersions();
      workspace.classList.remove("hidden");
      setAccessStatus("");
      watchReviewDataChanges();
    } catch (error) {
      setAccessStatus(`Impossible de charger la gestion des versions : ${error.message}`, true);
    }
  });
}
