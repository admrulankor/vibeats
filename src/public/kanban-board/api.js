import { elements, state } from "./state.js";

function showError(message) {
  elements.error.textContent = message;
  elements.error.classList.remove("hidden");
}

function clearError() {
  elements.error.classList.add("hidden");
  elements.error.textContent = "";
}

export async function fetchCandidates() {
  clearError();
  elements.loading.classList.remove("hidden");

  try {
    const response = await fetch("/backoffice/api/candidates");

    if (!response.ok) {
      throw new Error("Could not load candidates.");
    }

    state.candidates = await response.json();
  } catch (_error) {
    showError("Could not load candidates. Check the API and database connection.");
    state.candidates = [];
  } finally {
    elements.loading.classList.add("hidden");
  }
}

export async function persistCandidateStatus(candidateId, status) {
  const response = await fetch(`/backoffice/api/candidates/${candidateId}/status`, {
    method: "PUT",
    headers: {
      "Content-Type": "application/json"
    },
    body: JSON.stringify({ status })
  });

  const payload = await response.json();

  if (!response.ok) {
    throw new Error(payload.error || "Unable to update candidate status.");
  }

  return payload;
}

export { clearError, showError };
