const columnsElement = document.getElementById("kanban-columns");

function readStatusesFromDataset() {
  const raw = columnsElement?.dataset?.statuses;

  if (!raw) {
    return null;
  }

  try {
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed) && parsed.length ? parsed : null;
  } catch (_error) {
    return null;
  }
}

const fallbackStatuses = [
  "Applied",
  "Interested",
  "Shortlisted",
  "Client Submission",
  "Client Interview",
  "Offer",
  "Hired",
  "Started",
  "Probation passed"
];

export const state = {
  statuses: readStatusesFromDataset() || fallbackStatuses,
  candidates: [],
  draggedCandidateId: null,
  dragOverStatus: null,
  busy: false
};

export const elements = {
  loading: document.getElementById("kanban-loading"),
  error: document.getElementById("kanban-error"),
  empty: document.getElementById("kanban-empty"),
  columns: columnsElement
};
