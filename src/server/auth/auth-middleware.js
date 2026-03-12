import { jsonResponse } from "../utils/http.js";
import { getSessionCookie } from "./cookies.js";
import { getSessionWithUser } from "./sessions-repository.js";

export async function getAuthenticatedUser(request) {
  const token = getSessionCookie(request);
  if (!token) return null;

  const result = await getSessionWithUser(token);
  return result?.user ?? null;
}

/**
 * Returns the authenticated user object, or a Response to send back
 * (401 JSON for API routes, 302 redirect to /login for page routes).
 * Always check: if (result instanceof Response) return result;
 */
export async function requireAuth(request) {
  const user = await getAuthenticatedUser(request);
  if (!user) {
    const { pathname } = new URL(request.url);
    if (pathname.startsWith("/api/")) {
      return jsonResponse({ error: "Unauthorized." }, 401);
    }
    return new Response(null, { status: 302, headers: { Location: "/login" } });
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
    if (pathname.startsWith("/api/")) {
      return jsonResponse({ error: "Forbidden." }, 403);
    }
    return new Response(null, { status: 302, headers: { Location: "/" } });
  }

  return authResult;
}
