const elements = {
  form: document.getElementById("add-applicant-form"),
  submitButton: document.getElementById("add-applicant-button"),
  message: document.getElementById("add-applicant-message"),
  cvFileInput: document.getElementById("cv-file-input")
};

function setMessage(text, isError = false) {
  elements.message.textContent = text;
  elements.message.classList.toggle("text-red-700", isError);
  elements.message.classList.toggle("text-(--color-muted)", !isError);
}

async function submitNewApplicant(event) {
  event.preventDefault();

  const file = elements.cvFileInput?.files?.[0];

  if (!file) {
    setMessage("Please choose a CV PDF before uploading.", true);
    return;
  }

  const formData = new FormData(elements.form);
  elements.submitButton.disabled = true;
  setMessage("Uploading and scanning CV...");

  try {
    const response = await fetch("/backoffice/api/candidates/upload-scan", {
      method: "POST",
      body: formData
    });

    const payload = await response.json();

    if (!response.ok) {
      throw new Error(payload.error || "Upload failed.");
    }

    setMessage(`Created ${payload.name}. Redirecting to candidate details...`);

    window.setTimeout(() => {
      window.location.href = `/backoffice/candidates/${payload.id}`;
    }, 500);
  } catch (error) {
    setMessage(error instanceof Error ? error.message : "Upload failed.", true);
    elements.submitButton.disabled = false;
  }
}

if (elements.form) {
  elements.form.addEventListener("submit", submitNewApplicant);
}
