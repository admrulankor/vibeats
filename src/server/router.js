import { appConfig, applicationStatuses, availableStatuses, directories } from "./config/app-config.js";
import {
  getAllCandidates,
  getCandidateById,
  updateCandidateExtractedData,
  updateCandidateStatus
} from "./data/candidates-repository.js";
import {
  createJob,
  getAllJobsForBackoffice,
  getJobById,
  getJobQuestions,
  getPublishedJobs,
  replaceJobQuestions,
  sanitizeJobPayload,
  sanitizeQuestionsPayload,
  toJobDto,
  updateJob
} from "./data/jobs-repository.js";
import {
  addApplicationStatusEvent,
  getAllApplicationsForBackoffice,
  getAnswersForApplication,
  getApplicationsByApplicant,
  getJobApplicationById,
  getStatusEventsForApplication,
  getStatusEventsForApplications
  , updateJobApplicationStatus
} from "./data/job-applications-repository.js";
import { extractCandidateCvData } from "./services/extraction-service.js";
import { toCandidateDto } from "./services/candidate-transformer.js";
import { buildAvailableCandidatesPdf } from "./services/pdf-service.js";
import { handleUploadScan } from "./services/upload-service.js";
import { submitJobApplication } from "./services/job-application-service.js";
import { jsonResponse, textResponse } from "./utils/http.js";
import { parseIdSegment, parseJsonBody } from "./utils/request.js";
import { maybeServeFile, safeStaticPath } from "./utils/static.js";
import { renderView } from "./views.js";
import { getAuthenticatedApplicant, requireApplicantAuth, requireAuth } from "./auth/auth-middleware.js";
import { handleGetLogin, handlePostLogin, handlePostLogout } from "./routes/auth-routes.js";
import {
  handleGetApplicantLogin,
  handleGetApplicantSignup,
  handlePostApplicantLogin,
  handlePostApplicantLogout,
  handlePostApplicantSignup
} from "./routes/applicant-auth-routes.js";
import {
  handleGetAdminUsers,
  handlePostAdminCreateUser,
  handlePostAdminDeleteUser
} from "./routes/admin-routes.js";

function parseQuestionsFromFormData(formData) {
  const prompts = formData.getAll("question_prompt");
  const inputTypes = formData.getAll("question_input_type");
  const requiredIndices = new Set(
    formData
      .getAll("question_required")
      .map((value) => Number.parseInt(value.toString(), 10))
      .filter((value) => !Number.isNaN(value))
  );

  const questions = [];

  for (let index = 0; index < prompts.length; index += 1) {
    const prompt = prompts[index]?.toString().trim();
    if (!prompt) {
      continue;
    }

    questions.push({
      prompt,
      inputType: inputTypes[index]?.toString().trim() || "text",
      isRequired: requiredIndices.has(index),
      displayOrder: index
    });
  }

  return questions;
}

export async function handleRequest(request) {
  const url = new URL(request.url);
  const pathname = decodeURIComponent(url.pathname);
  const method = request.method.toUpperCase();

  // ── Public routes (no auth required) ───────────────────────────────────────

  if (method === "GET" && pathname === "/") {
    return new Response(null, { status: 302, headers: { Location: "/jobs" } });
  }

  if (method === "GET" && pathname === "/backoffice/login") {
    return handleGetLogin(request);
  }

  if (method === "POST" && pathname === "/backoffice/login") {
    return handlePostLogin(request);
  }

  if (method === "POST" && pathname === "/backoffice/logout") {
    return handlePostLogout(request);
  }

  if (method === "GET" && pathname === "/applicant/login") {
    return handleGetApplicantLogin(request);
  }

  if (method === "POST" && pathname === "/applicant/login") {
    return handlePostApplicantLogin(request);
  }

  if (method === "GET" && pathname === "/applicant/signup") {
    return handleGetApplicantSignup(request);
  }

  if (method === "POST" && pathname === "/applicant/signup") {
    return handlePostApplicantSignup(request);
  }

  if (method === "POST" && pathname === "/applicant/logout") {
    return handlePostApplicantLogout(request);
  }

  if (pathname.startsWith("/assets/")) {
    const assetPath = safeStaticPath(directories.assets, pathname.slice("/assets/".length));
    const assetResponse = await maybeServeFile(assetPath);
    if (assetResponse) return assetResponse;
  }

  if (method === "GET") {
    const filePath = safeStaticPath(directories.public, pathname);
    const fileResponse = await maybeServeFile(filePath);
    if (fileResponse) return fileResponse;
  }

  const isLegacyAtsApiPath =
    pathname === "/api/candidates" || pathname.startsWith("/api/candidates/");
  const isLegacyAtsPagePath =
    pathname === "/kanban" ||
    pathname === "/applicants/new" ||
    pathname.startsWith("/candidates/") ||
    pathname === "/admin/users" ||
    pathname.startsWith("/admin/users/");

  if (isLegacyAtsApiPath) {
    return jsonResponse({ error: "Not found." }, 404);
  }

  if (isLegacyAtsPagePath) {
    return textResponse("Not found.", 404);
  }

  if (method === "GET" && pathname === "/jobs") {
    try {
      const jobs = await getPublishedJobs();
      const applicant = await getAuthenticatedApplicant(request);
      return renderView("jobs", {
        title: `${appConfig.companyName} · Job Board`,
        companyName: appConfig.companyName,
        applicant,
        jobs: jobs.map((job) => toJobDto(job))
      });
    } catch (error) {
      console.error("Failed to render job board:", error);
      return textResponse("Unable to load jobs.", 500);
    }
  }

  const publicJobPageMatch = parseIdSegment(pathname, "/jobs/");

  if (method === "GET" && publicJobPageMatch) {
    if (publicJobPageMatch.invalid) {
      return textResponse("Invalid job id.", 400);
    }

    try {
      const job = await getJobById(publicJobPageMatch.value);
      if (!job || job.status !== "published") {
        return textResponse("Job not found.", 404);
      }

      const questions = await getJobQuestions(publicJobPageMatch.value);
      const applicant = await getAuthenticatedApplicant(request);
      const url = new URL(request.url);
      const error = url.searchParams.get("error") || null;

      return renderView("job-detail", {
        title: `${appConfig.companyName} · ${job.title}`,
        companyName: appConfig.companyName,
        job: toJobDto(job, questions),
        applicant,
        error
      });
    } catch (error) {
      console.error("Failed to render job detail:", error);
      return textResponse("Unable to load job.", 500);
    }
  }

  const publicJobApplyMatch = parseIdSegment(pathname, "/jobs/", "/apply");

  if (method === "POST" && publicJobApplyMatch) {
    if (publicJobApplyMatch.invalid) {
      return textResponse("Invalid job id.", 400);
    }

    const applicantAuthResult = await requireApplicantAuth(request);
    if (applicantAuthResult instanceof Response) return applicantAuthResult;

    try {
      const formData = await request.formData();

      await submitJobApplication({
        jobId: publicJobApplyMatch.value,
        applicantId: applicantAuthResult.id,
        formData
      });

      return new Response(null, {
        status: 302,
        headers: {
          Location: "/applicant/my-page?flash=applied"
        }
      });
    } catch (error) {
      const message = error instanceof Error ? error.message : "Unable to submit application.";
      const redirectMessage = encodeURIComponent(message);
      return new Response(null, {
        status: 302,
        headers: {
          Location: `/jobs/${publicJobApplyMatch.value}?error=${redirectMessage}`
        }
      });
    }
  }

  if (method === "GET" && pathname === "/public/api/jobs") {
    try {
      const jobs = await getPublishedJobs();
      return jsonResponse(jobs.map((job) => toJobDto(job)));
    } catch (error) {
      console.error("Failed to fetch public jobs:", error);
      return jsonResponse({ error: "Unable to fetch jobs." }, 500);
    }
  }

  const publicJobMatch = parseIdSegment(pathname, "/public/api/jobs/");

  if (method === "GET" && publicJobMatch) {
    if (publicJobMatch.invalid) {
      return jsonResponse({ error: "Invalid job id." }, 400);
    }

    try {
      const job = await getJobById(publicJobMatch.value);
      if (!job || job.status !== "published") {
        return jsonResponse({ error: "Job not found." }, 404);
      }

      const questions = await getJobQuestions(publicJobMatch.value);
      return jsonResponse(toJobDto(job, questions));
    } catch (error) {
      console.error("Failed to fetch public job detail:", error);
      return jsonResponse({ error: "Unable to fetch job." }, 500);
    }
  }

  if (method === "GET" && pathname === "/applicant/my-page") {
    const applicantAuthResult = await requireApplicantAuth(request);
    if (applicantAuthResult instanceof Response) return applicantAuthResult;

    const applications = await getApplicationsByApplicant(applicantAuthResult.id);
    const events = await getStatusEventsForApplications(applications.map((item) => item.id));
    const eventsByApplicationId = new Map();

    for (const event of events) {
      if (!eventsByApplicationId.has(event.job_application_id)) {
        eventsByApplicationId.set(event.job_application_id, []);
      }

      eventsByApplicationId.get(event.job_application_id).push(event);
    }

    const url = new URL(request.url);
    const flash = url.searchParams.get("flash");
    const flashMessage = flash === "applied" ? "Application submitted successfully." : null;

    return renderView("applicant-my-page", {
      title: `${appConfig.companyName} · My Page`,
      companyName: appConfig.companyName,
      applicant: applicantAuthResult,
      flashMessage,
      applications: applications.map((application) => ({
        ...application,
        timeline: eventsByApplicationId.get(application.id) || []
      }))
    });
  }

  // ── Auth wall ───────────────────────────────────────────────────────────────

  const authResult = await requireAuth(request);
  if (authResult instanceof Response) return authResult;
  const user = authResult;

  // ── Admin-only routes ───────────────────────────────────────────────────────

  if (method === "GET" && pathname === "/backoffice/users") {
    return handleGetAdminUsers(request);
  }

  if (method === "POST" && pathname === "/backoffice/users") {
    return handlePostAdminCreateUser(request);
  }

  const adminDeleteMatch = parseIdSegment(pathname, "/backoffice/users/", "/delete");
  if (method === "POST" && adminDeleteMatch) {
    if (adminDeleteMatch.invalid) {
      return new Response(null, { status: 302, headers: { Location: "/backoffice/users" } });
    }
    return handlePostAdminDeleteUser(request, adminDeleteMatch.value);
  }

  // ── Authenticated page routes ───────────────────────────────────────────────

  if (method === "GET" && pathname === "/backoffice") {
    return renderView("index", {
      title: appConfig.companyName,
      companyName: appConfig.companyName,
      companySubtitle: appConfig.companySubtitle,
      currentPath: pathname,
      user
    });
  }

  if (method === "GET" && pathname === "/backoffice/jobs") {
    const jobs = await getAllJobsForBackoffice();
    return renderView("backoffice/jobs", {
      title: `${appConfig.companyName} · Jobs`,
      companyName: appConfig.companyName,
      companySubtitle: appConfig.companySubtitle,
      currentPath: pathname,
      user,
      jobs: jobs.map((job) => toJobDto(job))
    });
  }

  if (method === "GET" && pathname === "/backoffice/applications") {
    const applications = await getAllApplicationsForBackoffice();

    return renderView("backoffice/applications", {
      title: `${appConfig.companyName} · Applications`,
      companyName: appConfig.companyName,
      companySubtitle: appConfig.companySubtitle,
      currentPath: pathname,
      user,
      applications
    });
  }

  const backofficeApplicationPageMatch = parseIdSegment(pathname, "/backoffice/applications/");

  if (method === "GET" && backofficeApplicationPageMatch) {
    if (backofficeApplicationPageMatch.invalid) {
      return textResponse("Invalid application id.", 400);
    }

    const application = await getJobApplicationById(backofficeApplicationPageMatch.value);
    if (!application) {
      return textResponse("Application not found.", 404);
    }

    const answers = await getAnswersForApplication(backofficeApplicationPageMatch.value);
    const timeline = await getStatusEventsForApplication(backofficeApplicationPageMatch.value);

    return renderView("backoffice/application-detail", {
      title: `${appConfig.companyName} · Application #${application.id}`,
      companyName: appConfig.companyName,
      companySubtitle: appConfig.companySubtitle,
      currentPath: "/backoffice/applications",
      user,
      application,
      answers,
      timeline,
      statuses: applicationStatuses
    });
  }

  const backofficeApplicationStatusMatch = parseIdSegment(pathname, "/backoffice/applications/", "/status");

  if (method === "POST" && backofficeApplicationStatusMatch) {
    if (backofficeApplicationStatusMatch.invalid) {
      return textResponse("Invalid application id.", 400);
    }

    const formData = await request.formData();
    const nextStatus = (formData.get("status") ?? "").toString().trim();

    if (!applicationStatuses.includes(nextStatus)) {
      return textResponse("Invalid status.", 400);
    }

    const currentApplication = await getJobApplicationById(backofficeApplicationStatusMatch.value);
    if (!currentApplication) {
      return textResponse("Application not found.", 404);
    }

    const updated = await updateJobApplicationStatus(backofficeApplicationStatusMatch.value, nextStatus);
    await addApplicationStatusEvent({
      jobApplicationId: backofficeApplicationStatusMatch.value,
      fromStatus: currentApplication.status,
      toStatus: nextStatus,
      actorUserId: user.id
    });

    if (updated?.candidate_id) {
      await updateCandidateStatus(updated.candidate_id, nextStatus);
    }

    return new Response(null, {
      status: 302,
      headers: {
        Location: `/backoffice/applications/${backofficeApplicationStatusMatch.value}`
      }
    });
  }

  if (method === "GET" && pathname === "/backoffice/jobs/new") {
    return renderView("backoffice/job-editor", {
      title: `${appConfig.companyName} · New Job`,
      companyName: appConfig.companyName,
      companySubtitle: appConfig.companySubtitle,
      currentPath: "/backoffice/jobs",
      user,
      formMode: "create",
      formAction: "/backoffice/jobs",
      job: null,
      questions: [],
      error: null
    });
  }

  const backofficeJobPageMatch = parseIdSegment(pathname, "/backoffice/jobs/");

  if (method === "GET" && backofficeJobPageMatch) {
    if (backofficeJobPageMatch.invalid) {
      return textResponse("Invalid job id.", 400);
    }

    const job = await getJobById(backofficeJobPageMatch.value);
    if (!job) {
      return textResponse("Job not found.", 404);
    }

    const questions = await getJobQuestions(backofficeJobPageMatch.value);
    const jobDto = toJobDto(job, questions);

    return renderView("backoffice/job-editor", {
      title: `${appConfig.companyName} · Edit Job`,
      companyName: appConfig.companyName,
      companySubtitle: appConfig.companySubtitle,
      currentPath: "/backoffice/jobs",
      user,
      formMode: "update",
      formAction: `/backoffice/jobs/${backofficeJobPageMatch.value}`,
      job: jobDto,
      questions: jobDto.questions,
      error: null
    });
  }

  if (method === "POST" && pathname === "/backoffice/jobs") {
    const formData = await request.formData();

    const payload = {
      title: formData.get("title"),
      intro: formData.get("intro"),
      requiredQualifications: formData.get("requiredQualifications"),
      recommendedQualifications: formData.get("recommendedQualifications"),
      description: formData.get("description"),
      employmentType: formData.get("employmentType"),
      location: formData.get("location"),
      status: formData.get("status")
    };

    const job = sanitizeJobPayload(payload);
    const questions = sanitizeQuestionsPayload(parseQuestionsFromFormData(formData));

    if (!job.title) {
      return textResponse("Job title is required.", 400);
    }

    const createdJobId = await createJob(job, user.id);
    await replaceJobQuestions(createdJobId, questions);

    return new Response(null, {
      status: 302,
      headers: {
        Location: "/backoffice/jobs"
      }
    });
  }

  const backofficeJobSubmitMatch = parseIdSegment(pathname, "/backoffice/jobs/");

  if (method === "POST" && backofficeJobSubmitMatch) {
    if (backofficeJobSubmitMatch.invalid) {
      return textResponse("Invalid job id.", 400);
    }

    const formData = await request.formData();

    const payload = {
      title: formData.get("title"),
      intro: formData.get("intro"),
      requiredQualifications: formData.get("requiredQualifications"),
      recommendedQualifications: formData.get("recommendedQualifications"),
      description: formData.get("description"),
      employmentType: formData.get("employmentType"),
      location: formData.get("location"),
      status: formData.get("status")
    };

    const job = sanitizeJobPayload(payload);
    const questions = sanitizeQuestionsPayload(parseQuestionsFromFormData(formData));

    if (!job.title) {
      return textResponse("Job title is required.", 400);
    }

    const updatedJobId = await updateJob(backofficeJobSubmitMatch.value, job);
    if (!updatedJobId) {
      return textResponse("Job not found.", 404);
    }

    await replaceJobQuestions(backofficeJobSubmitMatch.value, questions);

    return new Response(null, {
      status: 302,
      headers: {
        Location: `/backoffice/jobs/${backofficeJobSubmitMatch.value}`
      }
    });
  }

  if (method === "GET" && pathname === "/backoffice/applicants/new") {
    return renderView("new-applicant", {
      title: `${appConfig.companyName} · Add Applicant`,
      companyName: appConfig.companyName,
      companySubtitle: appConfig.companySubtitle,
      currentPath: pathname,
      applicationStatuses,
      user
    });
  }

  if (method === "GET" && pathname === "/backoffice/kanban") {
    return renderView("kanban", {
      title: `${appConfig.companyName} · Kanban`,
      companyName: appConfig.companyName,
      companySubtitle: appConfig.companySubtitle,
      currentPath: pathname,
      applicationStatuses,
      user
    });
  }

  const candidatePageMatch = parseIdSegment(pathname, "/backoffice/candidates/");

  if (method === "GET" && candidatePageMatch) {
    if (candidatePageMatch.invalid) {
      return textResponse("Invalid candidate id.", 400);
    }

    return renderView("candidate", {
      title: `${appConfig.companyName} · Candidate`,
      companyName: appConfig.companyName,
      companySubtitle: appConfig.companySubtitle,
      currentPath: "/backoffice/candidates",
      candidateId: candidatePageMatch.value,
      user
    });
  }

  // ── Authenticated API routes ────────────────────────────────────────────────

  if (method === "GET" && pathname === "/backoffice/api/candidates") {
    try {
      const candidates = await getAllCandidates();
      return jsonResponse(candidates.map(toCandidateDto));
    } catch (error) {
      console.error("Failed to fetch candidates:", error);
      return jsonResponse({ error: "Unable to fetch candidates." }, 500);
    }
  }

  if (method === "GET" && pathname === "/backoffice/api/jobs") {
    try {
      const jobs = await getAllJobsForBackoffice();
      return jsonResponse(jobs.map((job) => toJobDto(job)));
    } catch (error) {
      console.error("Failed to fetch jobs:", error);
      return jsonResponse({ error: "Unable to fetch jobs." }, 500);
    }
  }

  if (method === "POST" && pathname === "/backoffice/api/jobs") {
    try {
      const payload = await parseJsonBody(request);
      const job = sanitizeJobPayload(payload);
      const questions = sanitizeQuestionsPayload(payload.questions);

      if (!job.title) {
        return jsonResponse({ error: "Job title is required." }, 400);
      }

      const createdJobId = await createJob(job, user.id);
      await replaceJobQuestions(createdJobId, questions);

      const createdJob = await getJobById(createdJobId);
      const createdQuestions = await getJobQuestions(createdJobId);

      return jsonResponse(toJobDto(createdJob, createdQuestions), 201);
    } catch (error) {
      if (error?.status) {
        return jsonResponse({ error: error.message }, error.status);
      }

      console.error("Failed to create job:", error);
      return jsonResponse({ error: "Unable to create job." }, 500);
    }
  }

  const backofficeJobMatch = parseIdSegment(pathname, "/backoffice/api/jobs/");

  if (method === "GET" && backofficeJobMatch) {
    if (backofficeJobMatch.invalid) {
      return jsonResponse({ error: "Invalid job id." }, 400);
    }

    try {
      const job = await getJobById(backofficeJobMatch.value);
      if (!job) {
        return jsonResponse({ error: "Job not found." }, 404);
      }

      const questions = await getJobQuestions(backofficeJobMatch.value);
      return jsonResponse(toJobDto(job, questions));
    } catch (error) {
      console.error("Failed to fetch job:", error);
      return jsonResponse({ error: "Unable to fetch job." }, 500);
    }
  }

  if (method === "PUT" && backofficeJobMatch) {
    if (backofficeJobMatch.invalid) {
      return jsonResponse({ error: "Invalid job id." }, 400);
    }

    try {
      const payload = await parseJsonBody(request);
      const job = sanitizeJobPayload(payload);
      const questions = sanitizeQuestionsPayload(payload.questions);

      if (!job.title) {
        return jsonResponse({ error: "Job title is required." }, 400);
      }

      const updatedJobId = await updateJob(backofficeJobMatch.value, job);
      if (!updatedJobId) {
        return jsonResponse({ error: "Job not found." }, 404);
      }

      await replaceJobQuestions(backofficeJobMatch.value, questions);

      const updatedJob = await getJobById(backofficeJobMatch.value);
      const updatedQuestions = await getJobQuestions(backofficeJobMatch.value);

      return jsonResponse(toJobDto(updatedJob, updatedQuestions));
    } catch (error) {
      if (error?.status) {
        return jsonResponse({ error: error.message }, error.status);
      }

      console.error("Failed to update job:", error);
      return jsonResponse({ error: "Unable to update job." }, 500);
    }
  }

  const backofficeApplicationApiMatch = parseIdSegment(pathname, "/backoffice/api/applications/", "/status");

  if (method === "PUT" && backofficeApplicationApiMatch) {
    if (backofficeApplicationApiMatch.invalid) {
      return jsonResponse({ error: "Invalid application id." }, 400);
    }

    try {
      const payload = await parseJsonBody(request);
      const nextStatus = typeof payload.status === "string" ? payload.status.trim() : "";

      if (!applicationStatuses.includes(nextStatus)) {
        return jsonResponse({ error: "Invalid status." }, 400);
      }

      const currentApplication = await getJobApplicationById(backofficeApplicationApiMatch.value);
      if (!currentApplication) {
        return jsonResponse({ error: "Application not found." }, 404);
      }

      const updated = await updateJobApplicationStatus(backofficeApplicationApiMatch.value, nextStatus);
      await addApplicationStatusEvent({
        jobApplicationId: backofficeApplicationApiMatch.value,
        fromStatus: currentApplication.status,
        toStatus: nextStatus,
        actorUserId: user.id
      });

      if (updated?.candidate_id) {
        await updateCandidateStatus(updated.candidate_id, nextStatus);
      }

      return jsonResponse({ id: updated.id, status: updated.status });
    } catch (error) {
      if (error?.status) {
        return jsonResponse({ error: error.message }, error.status);
      }

      console.error("Failed to update application status:", error);
      return jsonResponse({ error: "Unable to update application status." }, 500);
    }
  }

  if (method === "GET" && pathname === "/backoffice/api/candidates/available") {
    try {
      const candidates = await getAllCandidates();
      const availableCandidates = candidates
        .filter((candidate) => availableStatuses.has(candidate.status))
        .map(toCandidateDto);
      return jsonResponse(availableCandidates);
    } catch (error) {
      console.error("Failed to fetch available candidates:", error);
      return jsonResponse({ error: "Unable to fetch available candidates." }, 500);
    }
  }

  if (method === "GET" && pathname === "/backoffice/api/candidates/available/cv.pdf") {
    try {
      const candidates = await getAllCandidates();
      const availableCandidates = candidates.filter((candidate) => availableStatuses.has(candidate.status));

      if (!availableCandidates.length) {
        return jsonResponse({ error: "No available candidates found." }, 404);
      }

      const pdfBuffer = await buildAvailableCandidatesPdf(availableCandidates);
      return new Response(pdfBuffer, {
        headers: {
          "Content-Type": "application/pdf",
          "Content-Disposition": 'attachment; filename="available-applicants-cv.pdf"'
        }
      });
    } catch (error) {
      console.error("Failed to generate available candidate CV PDF:", error);
      return jsonResponse({ error: "Unable to generate candidate CV PDF." }, 500);
    }
  }

  const apiCandidateMatch = parseIdSegment(pathname, "/backoffice/api/candidates/");

  if (method === "GET" && apiCandidateMatch) {
    if (apiCandidateMatch.invalid) {
      return jsonResponse({ error: "Invalid candidate id." }, 400);
    }

    try {
      const candidate = await getCandidateById(apiCandidateMatch.value);

      if (!candidate) {
        return jsonResponse({ error: "Candidate not found." }, 404);
      }

      return jsonResponse(toCandidateDto(candidate));
    } catch (error) {
      console.error("Failed to fetch candidate details:", error);
      return jsonResponse({ error: "Unable to fetch candidate details." }, 500);
    }
  }

  const extractMatch = parseIdSegment(pathname, "/backoffice/api/candidates/", "/extract");

  if (method === "POST" && extractMatch) {
    if (extractMatch.invalid) {
      return jsonResponse({ error: "Invalid candidate id." }, 400);
    }

    try {
      const updatedCandidate = await extractCandidateCvData(extractMatch.value);
      return jsonResponse(toCandidateDto(updatedCandidate));
    } catch (error) {
      const message = error instanceof Error ? error.message : "Extraction failed.";
      const statusCode = message === "Candidate not found." ? 404 : message.includes("No CV PDF") ? 400 : 500;

      console.error("CV extraction failed:", error);
      return jsonResponse({ error: message }, statusCode);
    }
  }

  if (method === "POST" && pathname === "/backoffice/api/candidates/upload-scan") {
    return handleUploadScan(request);
  }

  const extractedDataMatch = parseIdSegment(pathname, "/backoffice/api/candidates/", "/extracted-data");

  if (method === "PUT" && extractedDataMatch) {
    if (extractedDataMatch.invalid) {
      return jsonResponse({ error: "Invalid candidate id." }, 400);
    }

    try {
      const payload = await parseJsonBody(request);
      const candidateId = extractedDataMatch.value;
      const candidate = await getCandidateById(candidateId);

      if (!candidate) {
        return jsonResponse({ error: "Candidate not found." }, 404);
      }

      await updateCandidateExtractedData(candidateId, {
        profile: payload.profile || {},
        skills: Array.isArray(payload.skills) ? payload.skills : [],
        experience: Array.isArray(payload.experience) ? payload.experience : [],
        education: Array.isArray(payload.education) ? payload.education : [],
        works: Array.isArray(payload.works) ? payload.works : [],
        awards: Array.isArray(payload.awards) ? payload.awards : []
      });

      const updatedCandidate = await getCandidateById(candidateId);
      return jsonResponse(toCandidateDto(updatedCandidate));
    } catch (error) {
      if (error?.status) {
        return jsonResponse({ error: error.message }, error.status);
      }

      console.error("Failed to update extracted candidate data:", error);
      return jsonResponse({ error: "Unable to update extracted candidate data." }, 500);
    }
  }

  const statusUpdateMatch = parseIdSegment(pathname, "/backoffice/api/candidates/", "/status");

  if (method === "PUT" && statusUpdateMatch) {
    if (statusUpdateMatch.invalid) {
      return jsonResponse({ error: "Invalid candidate id." }, 400);
    }

    try {
      const payload = await parseJsonBody(request);
      const nextStatus = typeof payload.status === "string" ? payload.status.trim() : "";

      if (!applicationStatuses.includes(nextStatus)) {
        return jsonResponse(
          { error: `Invalid status. Allowed values: ${applicationStatuses.join(", ")}.` },
          400
        );
      }

      const candidateId = statusUpdateMatch.value;
      const candidate = await getCandidateById(candidateId);

      if (!candidate) {
        return jsonResponse({ error: "Candidate not found." }, 404);
      }

      const updatedCandidate = await updateCandidateStatus(candidateId, nextStatus);

      if (!updatedCandidate) {
        return jsonResponse({ error: "Candidate not found." }, 404);
      }

      return jsonResponse(toCandidateDto(updatedCandidate));
    } catch (error) {
      if (error?.status) {
        return jsonResponse({ error: error.message }, error.status);
      }

      console.error("Failed to update candidate status:", error);
      return jsonResponse({ error: "Unable to update candidate status." }, 500);
    }
  }

  return jsonResponse({ error: "Not found." }, 404);
}
