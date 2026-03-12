const SESSION_COOKIE_NAME = "ats_session";
const APPLICANT_SESSION_COOKIE_NAME = "applicant_session";

export function getSessionCookie(request) {
  const cookieHeader = request.headers.get("cookie");
  if (!cookieHeader) return null;

  for (const part of cookieHeader.split(";")) {
    const [name, ...rest] = part.trim().split("=");
    if (name.trim() === SESSION_COOKIE_NAME) {
      return rest.join("=").trim() || null;
    }
  }

  return null;
}

export function makeSessionCookieHeader(token, expiresAt) {
  const expires = new Date(expiresAt).toUTCString();
  return `${SESSION_COOKIE_NAME}=${token}; Path=/; HttpOnly; SameSite=Lax; Expires=${expires}`;
}

export function clearSessionCookieHeader() {
  return `${SESSION_COOKIE_NAME}=; Path=/; HttpOnly; SameSite=Lax; Expires=Thu, 01 Jan 1970 00:00:00 GMT`;
}

export function getApplicantSessionCookie(request) {
  const cookieHeader = request.headers.get("cookie");
  if (!cookieHeader) return null;

  for (const part of cookieHeader.split(";")) {
    const [name, ...rest] = part.trim().split("=");
    if (name.trim() === APPLICANT_SESSION_COOKIE_NAME) {
      return rest.join("=").trim() || null;
    }
  }

  return null;
}

export function makeApplicantSessionCookieHeader(token, expiresAt) {
  const expires = new Date(expiresAt).toUTCString();
  return `${APPLICANT_SESSION_COOKIE_NAME}=${token}; Path=/; HttpOnly; SameSite=Lax; Expires=${expires}`;
}

export function clearApplicantSessionCookieHeader() {
  return `${APPLICANT_SESSION_COOKIE_NAME}=; Path=/; HttpOnly; SameSite=Lax; Expires=Thu, 01 Jan 1970 00:00:00 GMT`;
}
