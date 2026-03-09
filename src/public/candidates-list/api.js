import { elements, state } from "./state.js";
import { renderCards, renderStatusOptions } from "./render.js";

export async function fetchCandidates() {
  elements.loading.classList.remove("hidden");
  elements.error.classList.add("hidden");

  try {
    const response = await fetch("/api/candidates");

    if (!response.ok) {
      throw new Error("Request failed");
    }

    state.candidates = await response.json();
    renderStatusOptions();
    renderCards();
  } catch (_error) {
    elements.error.textContent = "Could not load candidates. Check the API and database connection.";
    elements.error.classList.remove("hidden");
  } finally {
    elements.loading.classList.add("hidden");
  }
}
