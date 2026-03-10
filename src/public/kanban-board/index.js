import { fetchCandidates, persistCandidateStatus, showError, clearError } from "./api.js";
import { renderBoard } from "./render.js";
import { elements, state } from "./state.js";

function setBusy(value) {
  state.busy = value;
}

function findCandidate(candidateId) {
  return state.candidates.find((candidate) => candidate.id === candidateId) || null;
}

async function updateStatus(candidateId, nextStatus) {
  const candidate = findCandidate(candidateId);

  if (!candidate || candidate.status === nextStatus || state.busy) {
    return;
  }

  const previousStatus = candidate.status;
  clearError();
  setBusy(true);

  candidate.status = nextStatus;
  renderBoard();

  try {
    const updatedCandidate = await persistCandidateStatus(candidateId, nextStatus);
    const targetIndex = state.candidates.findIndex((item) => item.id === candidateId);

    if (targetIndex !== -1) {
      state.candidates[targetIndex] = updatedCandidate;
    }

    renderBoard();
  } catch (error) {
    candidate.status = previousStatus;
    renderBoard();
    showError(error instanceof Error ? error.message : "Unable to update candidate status.");
  } finally {
    setBusy(false);
  }
}

function getCandidateIdFromCardElement(target) {
  if (!(target instanceof Element)) {
    return null;
  }

  const card = target.closest("[data-candidate-id]");

  if (!card) {
    return null;
  }

  const value = Number.parseInt(card.dataset.candidateId || "", 10);
  return Number.isNaN(value) ? null : value;
}

function getStatusFromColumnElement(target) {
  if (!(target instanceof Element)) {
    return null;
  }

  const column = target.closest("[data-status-column]");
  return column ? column.dataset.statusColumn || null : null;
}

function onDragStart(event) {
  const candidateId = getCandidateIdFromCardElement(event.target);

  if (!candidateId) {
    return;
  }

  state.draggedCandidateId = candidateId;
  const transfer = event.dataTransfer;

  if (transfer) {
    transfer.effectAllowed = "move";
    transfer.setData("text/plain", String(candidateId));
  }
}

function onDragOver(event) {
  const status = getStatusFromColumnElement(event.target);

  if (!status) {
    return;
  }

  event.preventDefault();

  if (state.dragOverStatus !== status) {
    state.dragOverStatus = status;
    renderBoard();
  }
}

function onDragLeave(event) {
  if (!(event.target instanceof Element)) {
    return;
  }

  const leavingColumn = event.target.closest("[data-status-column]");

  if (!leavingColumn) {
    return;
  }

  const stillInside = leavingColumn.contains(event.relatedTarget);

  if (stillInside) {
    return;
  }

  if (state.dragOverStatus) {
    state.dragOverStatus = null;
    renderBoard();
  }
}

async function onDrop(event) {
  const nextStatus = getStatusFromColumnElement(event.target);

  if (!nextStatus) {
    return;
  }

  event.preventDefault();

  const transferId = Number.parseInt(event.dataTransfer?.getData("text/plain") || "", 10);
  const candidateId = Number.isNaN(transferId) ? state.draggedCandidateId : transferId;

  state.draggedCandidateId = null;
  state.dragOverStatus = null;

  if (!candidateId) {
    renderBoard();
    return;
  }

  await updateStatus(candidateId, nextStatus);
}

function onDragEnd() {
  state.draggedCandidateId = null;

  if (state.dragOverStatus) {
    state.dragOverStatus = null;
    renderBoard();
  }
}

function onStatusSelectChange(event) {
  if (!(event.target instanceof Element)) {
    return;
  }

  const select = event.target.closest("[data-status-select]");

  if (!select) {
    return;
  }

  const candidateId = Number.parseInt(select.dataset.candidateId || "", 10);

  if (Number.isNaN(candidateId)) {
    return;
  }

  updateStatus(candidateId, select.value);
}

async function init() {
  elements.columns.addEventListener("dragstart", onDragStart);
  elements.columns.addEventListener("dragover", onDragOver);
  elements.columns.addEventListener("dragleave", onDragLeave);
  elements.columns.addEventListener("drop", (event) => {
    void onDrop(event);
  });
  elements.columns.addEventListener("dragend", onDragEnd);
  elements.columns.addEventListener("change", (event) => {
    onStatusSelectChange(event);
  });

  await fetchCandidates();
  renderBoard();
}

void init();
