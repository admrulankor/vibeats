export const state = {
  candidates: [],
  search: "",
  statusFilter: "all"
};

export const elements = {
  loading: document.getElementById("loading"),
  error: document.getElementById("error"),
  empty: document.getElementById("empty"),
  list: document.getElementById("candidates-list"),
  searchInput: document.getElementById("search-input"),
  statusFilter: document.getElementById("status-filter")
};
