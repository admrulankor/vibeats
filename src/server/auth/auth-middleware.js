import { jsonResponse } from "../utils/http.js";
import { getApplicantSessionCookie, getSessionCookie } from "./cookies.js";
import { getApplicantSessionWithUser } from "./applicant-sessions-repository.js";
import { getSessionWithUser } from "./sessions-repository.js";

export async function getAuthenticatedUser(request) {
  const token = getSessionCookie(request);
  if (!token) return null;

  const result = await getSessionWithUser(token);
  return result?.user ?? null;
}

export async function getAuthenticatedApplicant(request) {
  const token = getApplicantSessionCookie(request);
  if (!token) return null;

  const result = await getApplicantSessionWithUser(token);
  return result?.applicant ?? null;
}

/**
 * Returns the authenticated user object, or a Response to send back
 * (401 JSON for API routes, 302 redirect to /backoffice/login for page routes).
 * Always check: if (result instanceof Response) return result;
 */
export async function requireAuth(request) {
  const user = await getAuthenticatedUser(request);
  if (!user) {
    const { pathname } = new URL(request.url);
    if (pathname.startsWith("/backoffice/api/")) {
      return jsonResponse({ error: "Unauthorized." }, 401);
    }
    return new Response(null, { status: 302, headers: { Location: "/backoffice/login" } });
  }
  return user;
}

/**
 * Returns the authenticated admin user, or a Response.
 * Non-admins get 403 JSON (API) or redirect to / (page routes).
 */
export async function requireAdmin(request) {
  const authResult = await requireAuth(request);
  if (authResult instanceof Response) return authResult;

  if (authResult.role !== "admin") {
    const { pathname } = new URL(request.url);
    if (pathname.startsWith("/backoffice/api/")) {
      return jsonResponse({ error: "Forbidden." }, 403);
    }
    return new Response(null, { status: 302, headers: { Location: "/backoffice" } });
  }

  return authResult;
}

export async function requireApplicantAuth(request) {
  const applicant = await getAuthenticatedApplicant(request);
  if (!applicant) {
    const { pathname } = new URL(request.url);
    if (pathname.startsWith("/applicant/api/")) {
      return jsonResponse({ error: "Unauthorized." }, 401);
    }
    return new Response(null, { status: 302, headers: { Location: "/applicant/login" } });
  }

  return applicant;
}
