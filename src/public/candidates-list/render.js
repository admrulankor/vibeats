import { elements, state } from "./state.js";

function formatDate(value) {
  const date = new Date(value);
  return `Added ${date.toLocaleDateString()}`;
}

export function getFilteredCandidates() {
  const term = state.search.trim().toLowerCase();

  return state.candidates.filter((candidate) => {
    const matchesStatus = state.statusFilter === "all" || candidate.status === state.statusFilter;
    const haystack = `${candidate.name} ${candidate.role} ${candidate.notes}`.toLowerCase();
    const matchesSearch = !term || haystack.includes(term);

    return matchesStatus && matchesSearch;
  });
}

export function renderStatusOptions() {
  elements.statusFilter.innerHTML = "";

  const allOption = document.createElement("option");
  allOption.value = "all";
  allOption.textContent = "All statuses";
  elements.statusFilter.append(allOption);

  const statuses = [...new Set(state.candidates.map((candidate) => candidate.status))];

  for (const status of statuses) {
    const option = document.createElement("option");
    option.value = status;
    option.textContent = status;
    elements.statusFilter.append(option);
  }
}

export function renderCards() {
  const filtered = getFilteredCandidates();
  elements.list.innerHTML = "";

  elements.empty.classList.toggle("hidden", filtered.length !== 0);

  for (const candidate of filtered) {
    const card = document.createElement("li");
    card.className = "rounded-2xl border border-(--color-border) bg-white p-4 shadow-sm";

    card.innerHTML = `
      <h3 class="text-base font-semibold">${candidate.name}</h3>
      <p class="mt-1 text-sm text-(--color-muted)">${candidate.role}</p>
      <p class="mt-3 inline-flex rounded-full bg-(--color-chip-bg) px-2.5 py-1 text-xs font-medium text-(--color-chip-text)">${candidate.status}</p>
      <p class="mt-3 text-xs text-(--color-muted)">CV extraction: ${candidate.extraction_status || "idle"}</p>
      <p class="mt-3 text-sm leading-relaxed">${candidate.notes}</p>
      <a href="/backoffice/candidates/${candidate.id}" class="mt-3 inline-flex text-sm font-medium text-(--color-accent)">Open Candidate Details</a>
      ${candidate.cv_url ? `<a href="${candidate.cv_url}" target="_blank" rel="noopener noreferrer" class="mt-3 inline-flex text-sm font-medium text-(--color-accent) hover:underline">Browse CV (PDF)</a>` : ""}
      <p class="mt-3 text-xs text-(--color-muted)">${formatDate(candidate.created_at)}</p>
    `;

    elements.list.append(card);
  }
}
