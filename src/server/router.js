import { appConfig, applicationStatuses, availableStatuses, directories } from "./config/app-config.js";
import {
  getAllCandidates,
  getCandidateById,
  updateCandidateExtractedData,
  updateCandidateStatus
} from "./data/candidates-repository.js";
import { extractCandidateCvData } from "./services/extraction-service.js";
import { toCandidateDto } from "./services/candidate-transformer.js";
import { buildAvailableCandidatesPdf } from "./services/pdf-service.js";
import { handleUploadScan } from "./services/upload-service.js";
import { jsonResponse, textResponse } from "./utils/http.js";
import { parseIdSegment, parseJsonBody } from "./utils/request.js";
import { maybeServeFile, safeStaticPath } from "./utils/static.js";
import { renderView } from "./views.js";
import { requireAuth } from "./auth/auth-middleware.js";
import { handleGetLogin, handlePostLogin, handlePostLogout } from "./routes/auth-routes.js";
import {
  handleGetAdminUsers,
  handlePostAdminCreateUser,
  handlePostAdminDeleteUser
} from "./routes/admin-routes.js";

export async function handleRequest(request) {
  const url = new URL(request.url);
  const pathname = decodeURIComponent(url.pathname);
  const method = request.method.toUpperCase();

  // ── Public routes (no auth required) ───────────────────────────────────────

  if (method === "GET" && pathname === "/login") {
    return handleGetLogin(request);
  }

  if (method === "POST" && pathname === "/login") {
    return handlePostLogin(request);
  }

  if (method === "POST" && pathname === "/logout") {
    return handlePostLogout(request);
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

  // ── Auth wall ───────────────────────────────────────────────────────────────

  const authResult = await requireAuth(request);
  if (authResult instanceof Response) return authResult;
  const user = authResult;

  // ── Admin-only routes ───────────────────────────────────────────────────────

  if (method === "GET" && pathname === "/admin/users") {
    return handleGetAdminUsers(request);
  }

  if (method === "POST" && pathname === "/admin/users") {
    return handlePostAdminCreateUser(request);
  }

  const adminDeleteMatch = parseIdSegment(pathname, "/admin/users/", "/delete");
  if (method === "POST" && adminDeleteMatch) {
    if (adminDeleteMatch.invalid) {
      return new Response(null, { status: 302, headers: { Location: "/admin/users" } });
    }
    return handlePostAdminDeleteUser(request, adminDeleteMatch.value);
  }

  // ── Authenticated page routes ───────────────────────────────────────────────

  if (method === "GET" && pathname === "/") {
    return renderView("index", {
      title: appConfig.companyName,
      companyName: appConfig.companyName,
      companySubtitle: appConfig.companySubtitle,
      user
    });
  }

  if (method === "GET" && pathname === "/applicants/new") {
    return renderView("new-applicant", {
      title: `${appConfig.companyName} · Add Applicant`,
      companyName: appConfig.companyName,
      companySubtitle: appConfig.companySubtitle,
      applicationStatuses,
      user
    });
  }

  if (method === "GET" && pathname === "/kanban") {
    return renderView("kanban", {
      title: `${appConfig.companyName} · Kanban`,
      companyName: appConfig.companyName,
      companySubtitle: appConfig.companySubtitle,
      applicationStatuses,
      user
    });
  }

  const candidatePageMatch = parseIdSegment(pathname, "/candidates/");

  if (method === "GET" && candidatePageMatch) {
    if (candidatePageMatch.invalid) {
      return textResponse("Invalid candidate id.", 400);
    }

    return renderView("candidate", {
      title: `${appConfig.companyName} · Candidate`,
      companyName: appConfig.companyName,
      companySubtitle: appConfig.companySubtitle,
      candidateId: candidatePageMatch.value,
      user
    });
  }

  // ── Authenticated API routes ────────────────────────────────────────────────

  if (method === "GET" && pathname === "/api/candidates") {
    try {
      const candidates = await getAllCandidates();
      return jsonResponse(candidates.map(toCandidateDto));
    } catch (error) {
      console.error("Failed to fetch candidates:", error);
      return jsonResponse({ error: "Unable to fetch candidates." }, 500);
    }
  }

  if (method === "GET" && pathname === "/api/candidates/available") {
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

  if (method === "GET" && pathname === "/api/candidates/available/cv.pdf") {
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

  const apiCandidateMatch = parseIdSegment(pathname, "/api/candidates/");

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

  const extractMatch = parseIdSegment(pathname, "/api/candidates/", "/extract");

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

  if (method === "POST" && pathname === "/api/candidates/upload-scan") {
    return handleUploadScan(request);
  }

  const extractedDataMatch = parseIdSegment(pathname, "/api/candidates/", "/extracted-data");

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

  const statusUpdateMatch = parseIdSegment(pathname, "/api/candidates/", "/status");

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
