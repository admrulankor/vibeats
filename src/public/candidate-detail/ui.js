import { elements, state } from "./state.js";

export function setBusy(value) {
  state.busy = value;
  elements.extractButton.disabled = value;
  elements.saveButton.disabled = value;
}

export function showError(message) {
  elements.error.textContent = message;
  elements.error.classList.remove("hidden");
}

export function clearError() {
  elements.error.classList.add("hidden");
  elements.error.textContent = "";
}

function safeArray(value) {
  return Array.isArray(value) ? value : [];
}

function toReadableLabel(value) {
  return String(value)
    .replace(/[_-]+/g, " ")
    .replace(/\s+/g, " ")
    .trim()
    .replace(/\b\w/g, (char) => char.toUpperCase());
}

function formatDisplayValue(value) {
  if (value === null || value === undefined) {
    return "";
  }

  if (typeof value === "string") {
    return value;
  }

  if (typeof value === "number" || typeof value === "boolean") {
    return String(value);
  }

  if (Array.isArray(value)) {
    return value
      .map((item) => formatDisplayValue(item))
      .filter(Boolean)
      .join(" • ");
  }

  if (typeof value === "object") {
    const entries = Object.entries(value)
      .map(([key, nestedValue]) => {
        const formattedValue = formatDisplayValue(nestedValue);
        return formattedValue ? `${toReadableLabel(key)}: ${formattedValue}` : "";
      })
      .filter(Boolean);

    return entries.join(" • ");
  }

  return "";
}

function getPrimaryLabel(item, index) {
  if (!item || typeof item !== "object") {
    return `Item ${index + 1}`;
  }

  const titleKey = ["title", "position", "role", "company", "institution", "name", "project", "award"].find(
    (key) => typeof item[key] === "string" && item[key].trim()
  );

  if (titleKey) {
    return item[titleKey].trim();
  }

  return `Item ${index + 1}`;
}

function appendDetailRow(container, label, value) {
  const row = document.createElement("div");
  row.className = "details-row";

  const term = document.createElement("span");
  term.className = "details-row-label";
  term.textContent = label;

  const description = document.createElement("p");
  description.className = "details-row-value";
  description.textContent = value;

  row.append(term, description);
  container.append(row);
}

function renderCollection(container, items, emptyLabel) {
  container.innerHTML = "";

  if (!items.length) {
    const empty = document.createElement("p");
    empty.className = "details-empty";
    empty.textContent = emptyLabel;
    container.append(empty);
    return;
  }

  items.forEach((item, index) => {
    const card = document.createElement("article");
    card.className = "details-card";

    if (typeof item !== "object" || item === null) {
      appendDetailRow(card, `Item ${index + 1}`, formatDisplayValue(item));
      container.append(card);
      return;
    }

    const primaryLabel = getPrimaryLabel(item, index);
    const heading = document.createElement("h3");
    heading.className = "details-card-title";
    heading.textContent = primaryLabel;
    card.append(heading);

    let hasRows = false;

    Object.entries(item).forEach(([key, value]) => {
      const formattedValue = formatDisplayValue(value);

      if (!formattedValue || formattedValue === primaryLabel) {
        return;
      }

      appendDetailRow(card, toReadableLabel(key), formattedValue);
      hasRows = true;
    });

    if (!hasRows) {
      appendDetailRow(card, "Details", "No additional details provided.");
    }

    container.append(card);
  });
}

function formatExtractionStatus(candidate) {
  if (!candidate.extraction_status) {
    return "idle";
  }

  if (candidate.extraction_status === "failed" && candidate.extraction_error) {
    return `failed (${candidate.extraction_error})`;
  }

  if (candidate.extraction_status === "completed" && candidate.extracted_at) {
    return `completed (${new Date(candidate.extracted_at).toLocaleString()})`;
  }

  return candidate.extraction_status;
}

export function renderSkills(skills) {
  elements.skillsList.innerHTML = "";

  for (const skill of skills) {
    const item = document.createElement("li");
    item.className = "skill-chip";
    item.textContent = skill;
    elements.skillsList.append(item);
  }
}

export function readSkillsInput() {
  return elements.skillsInput.value
    .split(",")
    .map((skill) => skill.trim())
    .filter(Boolean);
}

export function renderCandidate() {
  const candidate = state.candidate;

  elements.name.textContent = candidate.name;
  elements.role.textContent = `${candidate.role} · ${candidate.status}`;
  elements.extractionStatus.textContent = `Extraction status: ${formatExtractionStatus(candidate)}`;

  if (candidate.cv_url) {
    elements.cvLink.href = candidate.cv_url;
    elements.cvLink.classList.remove("hidden");
  } else {
    elements.cvLink.classList.add("hidden");
  }

  elements.email.value = candidate.profile?.email || "";
  elements.phone.value = candidate.profile?.phone || "";
  elements.location.value = candidate.profile?.location || "";
  elements.summary.value = candidate.profile?.summary || "";

  const skills = safeArray(candidate.skills);
  elements.skillsInput.value = skills.join(", ");
  renderSkills(skills);

  renderCollection(elements.experienceList, safeArray(candidate.experience), "No experience records available.");
  renderCollection(elements.educationList, safeArray(candidate.education), "No education records available.");
  renderCollection(elements.worksList, safeArray(candidate.works), "No work samples available.");
  renderCollection(elements.awardsList, safeArray(candidate.awards), "No awards listed.");
}
