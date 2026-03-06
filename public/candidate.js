const candidateId = Number.parseInt(document.body.dataset.candidateId, 10);

const state = {
  candidate: null,
  busy: false
};

const elements = {
  name: document.getElementById("candidate-name"),
  role: document.getElementById("candidate-role"),
  extractionStatus: document.getElementById("extraction-status"),
  error: document.getElementById("details-error"),
  extractButton: document.getElementById("extract-button"),
  saveButton: document.getElementById("save-button"),
  cvLink: document.getElementById("cv-link"),
  email: document.getElementById("profile-email"),
  phone: document.getElementById("profile-phone"),
  location: document.getElementById("profile-location"),
  summary: document.getElementById("profile-summary"),
  skillsInput: document.getElementById("skills-input"),
  skillsList: document.getElementById("skills-list"),
  experienceJson: document.getElementById("experience-json"),
  educationJson: document.getElementById("education-json"),
  worksJson: document.getElementById("works-json"),
  awardsJson: document.getElementById("awards-json")
};

function setBusy(value) {
  state.busy = value;
  elements.extractButton.disabled = value;
  elements.saveButton.disabled = value;
}

function showError(message) {
  elements.error.textContent = message;
  elements.error.classList.remove("hidden");
}

function clearError() {
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

function renderSkills(skills) {
  elements.skillsList.innerHTML = "";

  for (const skill of skills) {
    const item = document.createElement("li");
    item.className = "skill-chip";
    item.textContent = skill;
    elements.skillsList.append(item);
  }
}

function readSkillsInput() {
  return elements.skillsInput.value
    .split(",")
    .map((skill) => skill.trim())
    .filter(Boolean);
}

function renderCandidate() {
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

async function fetchCandidate() {
  clearError();

  try {
    const response = await fetch(`/api/candidates/${candidateId}`);

    if (!response.ok) {
      throw new Error("Could not load candidate details.");
    }

    state.candidate = await response.json();
    renderCandidate();
  } catch (error) {
    showError(error instanceof Error ? error.message : "Could not load candidate details.");
  }
}

async function extractCandidateData() {
  setBusy(true);
  clearError();

  try {
    const response = await fetch(`/api/candidates/${candidateId}/extract`, {
      method: "POST"
    });

    const payload = await response.json();

    if (!response.ok) {
      throw new Error(payload.error || "Extraction failed.");
    }

    state.candidate = payload;
    renderCandidate();
  } catch (error) {
    showError(error instanceof Error ? error.message : "Extraction failed.");
  } finally {
    setBusy(false);
  }
}

function parseJsonArrayField(value, fieldLabel) {
  try {
    const parsed = JSON.parse(value || "[]");

    if (!Array.isArray(parsed)) {
      throw new Error(`${fieldLabel} must be a JSON array.`);
    }

    return parsed;
  } catch (error) {
    if (error instanceof Error) {
      throw error;
    }

    throw new Error(`${fieldLabel} must be valid JSON.`);
  }
}

async function saveExtractedData() {
  setBusy(true);
  clearError();

  try {
    const experience = parseJsonArrayField(elements.experienceJson.value, "Experience");
    const education = parseJsonArrayField(elements.educationJson.value, "Education");
    const works = parseJsonArrayField(elements.worksJson.value, "Works");
    const awards = parseJsonArrayField(elements.awardsJson.value, "Awards");

    const payload = {
      profile: {
        email: elements.email.value.trim(),
        phone: elements.phone.value.trim(),
        location: elements.location.value.trim(),
        summary: elements.summary.value.trim()
      },
      skills: readSkillsInput(),
      experience,
      education,
      works,
      awards
    };

    const response = await fetch(`/api/candidates/${candidateId}/extracted-data`, {
      method: "PUT",
      headers: {
        "Content-Type": "application/json"
      },
      body: JSON.stringify(payload)
    });

    const data = await response.json();

    if (!response.ok) {
      throw new Error(data.error || "Save failed.");
    }

    state.candidate = data;
    renderCandidate();
  } catch (error) {
    showError(error instanceof Error ? error.message : "Save failed.");
  } finally {
    setBusy(false);
  }
}

elements.extractButton.addEventListener("click", extractCandidateData);
elements.saveButton.addEventListener("click", saveExtractedData);
elements.skillsInput.addEventListener("input", () => {
  renderSkills(readSkillsInput());
});

if (!Number.isNaN(candidateId)) {
  fetchCandidate();
} else {
  showError("Invalid candidate id.");
}
