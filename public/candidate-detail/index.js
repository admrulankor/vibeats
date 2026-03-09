import { candidateId, elements } from "./state.js";
import { extractCandidateData, fetchCandidate, saveExtractedData } from "./api.js";
import { readSkillsInput, renderSkills, showError } from "./ui.js";

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
