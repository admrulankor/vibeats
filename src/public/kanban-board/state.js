export const state = {
  statuses: ["Applied", "Screening", "Interview", "Offer"],
  candidates: [],
  draggedCandidateId: null,
  dragOverStatus: null,
  busy: false
};

export const elements = {
  loading: document.getElementById("kanban-loading"),
  error: document.getElementById("kanban-error"),
  empty: document.getElementById("kanban-empty"),
  columns: document.getElementById("kanban-columns")
};
