import { appConfig } from "../config/app-config.js";
import { getUserByUsername } from "../data/users-repository.js";
import { createSession, deleteSession } from "../auth/sessions-repository.js";
import { getSessionCookie, makeSessionCookieHeader, clearSessionCookieHeader } from "../auth/cookies.js";
import { renderView } from "../views.js";

const SESSION_TTL_HOURS = Number(Bun.env.SESSION_TTL_HOURS || 24);

export async function handleGetLogin(request) {
  const url = new URL(request.url);
  const errorParam = url.searchParams.get("error");
  const error = errorParam === "invalid" ? "Invalid username or password." : null;

  return renderView("login", {
    title: `${appConfig.companyName} · Sign In`,
    companyName: appConfig.companyName,
    error
  });
}

export async function handlePostLogin(request) {
  let username, password;
  try {
    const formData = await request.formData();
    username = (formData.get("username") ?? "").toString().trim();
    password = (formData.get("password") ?? "").toString();
  } catch {
    return new Response(null, { status: 302, headers: { Location: "/login?error=invalid" } });
  }

  if (!username || !password) {
    return new Response(null, { status: 302, headers: { Location: "/login?error=invalid" } });
  }

  const user = await getUserByUsername(username);
  if (!user) {
    return new Response(null, { status: 302, headers: { Location: "/login?error=invalid" } });
  }

  const valid = await Bun.password.verify(password, user.password_hash);
  if (!valid) {
    return new Response(null, { status: 302, headers: { Location: "/login?error=invalid" } });
  }

  const expiresAt = new Date(Date.now() + SESSION_TTL_HOURS * 60 * 60 * 1000);
  const sessionId = await createSession(user.id, expiresAt);

  return new Response(null, {
    status: 302,
    headers: {
      Location: "/",
      "Set-Cookie": makeSessionCookieHeader(sessionId, expiresAt)
    }
  });
}

export async function handlePostLogout(request) {
  const token = getSessionCookie(request);
  if (token) {
    await deleteSession(token);
  }

  return new Response(null, {
    status: 302,
    headers: {
      Location: "/login",
      "Set-Cookie": clearSessionCookieHeader()
    }
  });
}
