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

  elements.experienceJson.value = JSON.stringify(safeArray(candidate.experience), null, 2);
  elements.educationJson.value = JSON.stringify(safeArray(candidate.education), null, 2);
  elements.worksJson.value = JSON.stringify(safeArray(candidate.works), null, 2);
  elements.awardsJson.value = JSON.stringify(safeArray(candidate.awards), null, 2);
}
