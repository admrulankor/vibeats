export const candidateId = Number.parseInt(document.body.dataset.candidateId, 10);

export const state = {
  candidate: null,
  busy: false
};

export const elements = {
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
  experienceList: document.getElementById("experience-list"),
  educationList: document.getElementById("education-list"),
  worksList: document.getElementById("works-list"),
  awardsList: document.getElementById("awards-list")
};
