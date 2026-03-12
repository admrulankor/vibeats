import fs from "node:fs";
import path from "node:path";
import { directories } from "../config/app-config.js";
import { getJobById, getJobQuestions } from "../data/jobs-repository.js";
import {
  addApplicationStatusEvent,
  createJobApplication,
  replaceApplicationAnswers
} from "../data/job-applications-repository.js";
import {
  getApplicantById,
  updateApplicantDefaultCvFilename
} from "../data/applicant-users-repository.js";
import {
  createCandidateFromCvPayload,
  storeUploadedCvFile,
  validatePdfMetadata
} from "./upload-service.js";

function getQuestionAnswerValue(formData, questionId) {
  const value = formData.get(`question_${questionId}`);
  return typeof value === "string" ? value.trim() : "";
}

function buildApplicationAnswers(questions, formData) {
  const missingRequired = [];
  const answers = [];

  for (const question of questions) {
    const answerText = getQuestionAnswerValue(formData, question.id);

    if (question.is_required && !answerText) {
      missingRequired.push(question.prompt);
    }

    answers.push({
      jobQuestionId: question.id,
      prompt: question.prompt,
      answerText,
      displayOrder: question.display_order
    });
  }

  return { answers, missingRequired };
}

async function loadStoredApplicantCvPayload(applicant) {
  if (!applicant?.default_cv_filename) {
    throw new Error("Please upload a CV to apply for this job.");
  }

  const filePath = path.join(directories.uploads, applicant.default_cv_filename);

  if (!fs.existsSync(filePath)) {
    throw new Error("Saved CV file was not found. Please upload a new CV.");
  }

  const buffer = fs.readFileSync(filePath);
  validatePdfMetadata(applicant.default_cv_filename, "application/pdf");

  return {
    filename: applicant.default_cv_filename,
    originalname: applicant.default_cv_filename,
    buffer,
    filePath
  };
}

async function resolveCvPayload(formData, applicant) {
  const cv = formData.get("cv");

  if (cv instanceof File && cv.size > 0) {
    const stored = await storeUploadedCvFile(cv);
    await updateApplicantDefaultCvFilename(applicant.id, stored.filename);
    return stored;
  }

  return loadStoredApplicantCvPayload(applicant);
}

export async function submitJobApplication({ jobId, applicantId, formData }) {
  const job = await getJobById(jobId);
  if (!job || job.status !== "published") {
    throw new Error("Job not found.");
  }

  const applicant = await getApplicantById(applicantId);
  if (!applicant) {
    throw new Error("Applicant account not found.");
  }

  const questions = await getJobQuestions(jobId);
  const { answers, missingRequired } = buildApplicationAnswers(questions, formData);

  if (missingRequired.length) {
    throw new Error(`Please answer required questions: ${missingRequired.join(", ")}`);
  }

  const notes = (formData.get("notes") ?? "").toString().trim();
  const cvPayload = await resolveCvPayload(formData, applicant);

  const createdCandidate = await createCandidateFromCvPayload({
    buffer: cvPayload.buffer,
    originalname: cvPayload.originalname,
    filename: cvPayload.filename,
    requestedStatus: "Applied",
    requestedRole: job.title,
    requestedNotes: notes || `Applied to ${job.title}`
  });

  const applicationId = await createJobApplication({
    jobId,
    applicantUserId: applicant.id,
    candidateId: createdCandidate.id,
    status: "Applied",
    notes
  });

  await replaceApplicationAnswers(applicationId, answers);
  await addApplicationStatusEvent({
    jobApplicationId: applicationId,
    fromStatus: null,
    toStatus: "Applied",
    actorApplicantId: applicant.id
  });

  return {
    applicationId,
    candidateId: createdCandidate.id
  };
}
