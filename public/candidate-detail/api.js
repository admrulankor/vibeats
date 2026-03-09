import { candidateId, elements, state } from "./state.js";
import { clearError, readSkillsInput, renderCandidate, setBusy, showError } from "./ui.js";

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

export async function fetchCandidate() {
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

export async function extractCandidateData() {
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

export async function saveExtractedData() {
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
