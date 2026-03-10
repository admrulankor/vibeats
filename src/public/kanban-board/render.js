import { elements, state } from "./state.js";

function formatDate(value) {
  const date = new Date(value);
  return `Added ${date.toLocaleDateString()}`;
}

function getCandidatesByStatus() {
  const groups = new Map();

  for (const status of state.statuses) {
    groups.set(status, []);
  }

  for (const candidate of state.candidates) {
    if (!groups.has(candidate.status)) {
      groups.set(candidate.status, []);
    }

    groups.get(candidate.status).push(candidate);
  }

  return groups;
}

function createCard(candidate) {
  const item = document.createElement("li");
  item.className =
    "min-w-0 rounded-2xl border border-(--color-border) bg-white p-3 shadow-sm transition hover:-translate-y-0.5 hover:border-(--color-accent-soft) sm:p-4";
  item.draggable = true;
  item.dataset.candidateId = String(candidate.id);

  item.innerHTML = `
    <p class="wrap-break-word text-base font-semibold">${candidate.name}</p>
    <p class="mt-1 wrap-break-word text-sm text-(--color-muted)">${candidate.role}</p>
    <p class="mt-2 text-xs text-(--color-muted)">CV extraction: ${candidate.extraction_status || "idle"}</p>
    <p class="mt-2 wrap-break-word text-sm leading-relaxed">${candidate.notes || "No notes yet."}</p>
    <div class="mt-3 flex flex-wrap items-center justify-between gap-2">
      <a href="/candidates/${candidate.id}" class="text-sm font-medium text-(--color-accent)">Open details</a>
      <span class="text-xs text-(--color-muted)">${formatDate(candidate.created_at)}</span>
    </div>
    <label class="mt-3 block space-y-1">
      <span class="block text-xs font-medium text-(--color-muted)">Move with select</span>
      <select
        class="w-full rounded-xl border border-(--color-border) bg-white px-3 py-2 text-sm outline-none transition focus:border-(--color-accent) focus:ring-2 focus:ring-(--color-accent-soft)"
        data-status-select
        data-candidate-id="${candidate.id}"
      >
        ${state.statuses
          .map(
            (status) =>
              `<option value="${status}" ${status === candidate.status ? "selected" : ""}>${status}</option>`
          )
          .join("")}
      </select>
    </label>
  `;

  return item;
}

function createColumn(status, candidates) {
  const column = document.createElement("article");
  const isDraggingOver = state.dragOverStatus === status;
  const dragClass = isDraggingOver ? " ring-2 ring-(--color-accent)" : "";

  column.className =
    "w-full min-w-0 rounded-2xl border border-(--color-border) bg-white/70 p-2.5 shadow-sm backdrop-blur-sm transition sm:p-3 lg:w-80 lg:min-w-80 lg:shrink-0" +
    dragClass;
  column.dataset.statusColumn = status;
  column.setAttribute("aria-label", `${status} candidates column`);

  column.innerHTML = `
    <div class="mb-3 flex items-center justify-between gap-2">
      <h2 class="text-sm font-semibold uppercase tracking-wide text-(--color-muted)">${status}</h2>
      <span class="rounded-full bg-(--color-chip-bg) px-2.5 py-1 text-xs font-medium text-(--color-chip-text)">${candidates.length}</span>
    </div>
    <ul class="grid gap-3" data-status-list="${status}"></ul>
  `;

  const list = column.querySelector("[data-status-list]");

  for (const candidate of candidates) {
    list.append(createCard(candidate));
  }

  return column;
}

export function renderBoard() {
  elements.columns.innerHTML = "";
  elements.empty.classList.toggle("hidden", state.candidates.length !== 0);

  if (!state.candidates.length) {
    return;
  }

  const groups = getCandidatesByStatus();

  for (const status of state.statuses) {
    const candidates = groups.get(status) || [];
    elements.columns.append(createColumn(status, candidates));
  }

  for (const [status, candidates] of groups.entries()) {
    if (state.statuses.includes(status)) {
      continue;
    }

    elements.columns.append(createColumn(status, candidates));
  }
}
