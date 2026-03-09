import { fetchCandidates } from "./api.js";
import { elements, state } from "./state.js";
import { renderCards } from "./render.js";

elements.searchInput.addEventListener("input", (event) => {
  state.search = event.target.value;
  renderCards();
});

elements.statusFilter.addEventListener("change", (event) => {
  state.statusFilter = event.target.value;
  renderCards();
});

fetchCandidates();
