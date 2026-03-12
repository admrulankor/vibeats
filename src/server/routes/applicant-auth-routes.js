import { appConfig } from "../config/app-config.js";
import {
  clearApplicantSessionCookieHeader,
  getApplicantSessionCookie,
  makeApplicantSessionCookieHeader
} from "../auth/cookies.js";
import {
  createApplicantSession,
  deleteApplicantSession
} from "../auth/applicant-sessions-repository.js";
import { createApplicant, getApplicantByEmail } from "../data/applicant-users-repository.js";
import { renderView } from "../views.js";

const SESSION_TTL_HOURS = Number(Bun.env.APPLICANT_SESSION_TTL_HOURS || 24);

function normalizeEmail(value) {
  return value.toString().trim().toLowerCase();
}

export async function handleGetApplicantLogin(request) {
  const url = new URL(request.url);
  const errorParam = url.searchParams.get("error");
  const error = errorParam === "invalid" ? "Invalid email or password." : null;

  return renderView("applicant-login", {
    title: `${appConfig.companyName} · Applicant Sign In`,
    companyName: appConfig.companyName,
    error
  });
}

export async function handleGetApplicantSignup(request) {
  const url = new URL(request.url);
  const errorParam = url.searchParams.get("error");

  const error =
    errorParam === "duplicate" ? "An account with this email already exists." :
    errorParam === "invalid" ? "Please complete all required fields." :
    null;

  return renderView("applicant-signup", {
    title: `${appConfig.companyName} · Applicant Sign Up`,
    companyName: appConfig.companyName,
    error
  });
}

export async function handlePostApplicantSignup(request) {
  let email, password, name, phone, location;

  try {
    const formData = await request.formData();
    email = normalizeEmail(formData.get("email") ?? "");
    password = (formData.get("password") ?? "").toString();
    name = (formData.get("name") ?? "").toString().trim();
    phone = (formData.get("phone") ?? "").toString().trim();
    location = (formData.get("location") ?? "").toString().trim();
  } catch {
    return new Response(null, { status: 302, headers: { Location: "/applicant/signup?error=invalid" } });
  }

  if (!email || !password || !name) {
    return new Response(null, { status: 302, headers: { Location: "/applicant/signup?error=invalid" } });
  }

  const existing = await getApplicantByEmail(email);
  if (existing) {
    return new Response(null, { status: 302, headers: { Location: "/applicant/signup?error=duplicate" } });
  }

  const passwordHash = await Bun.password.hash(password);
  const applicant = await createApplicant({ email, passwordHash, name, phone, location });

  const expiresAt = new Date(Date.now() + SESSION_TTL_HOURS * 60 * 60 * 1000);
  const sessionId = await createApplicantSession(applicant.id, expiresAt);

  return new Response(null, {
    status: 302,
    headers: {
      Location: "/applicant/my-page",
      "Set-Cookie": makeApplicantSessionCookieHeader(sessionId, expiresAt)
    }
  });
}

export async function handlePostApplicantLogin(request) {
  let email, password;

  try {
    const formData = await request.formData();
    email = normalizeEmail(formData.get("email") ?? "");
    password = (formData.get("password") ?? "").toString();
  } catch {
    return new Response(null, { status: 302, headers: { Location: "/applicant/login?error=invalid" } });
  }

  if (!email || !password) {
    return new Response(null, { status: 302, headers: { Location: "/applicant/login?error=invalid" } });
  }

  const applicant = await getApplicantByEmail(email);
  if (!applicant) {
    return new Response(null, { status: 302, headers: { Location: "/applicant/login?error=invalid" } });
  }

  const valid = await Bun.password.verify(password, applicant.password_hash);
  if (!valid) {
    return new Response(null, { status: 302, headers: { Location: "/applicant/login?error=invalid" } });
  }

  const expiresAt = new Date(Date.now() + SESSION_TTL_HOURS * 60 * 60 * 1000);
  const sessionId = await createApplicantSession(applicant.id, expiresAt);

  return new Response(null, {
    status: 302,
    headers: {
      Location: "/applicant/my-page",
      "Set-Cookie": makeApplicantSessionCookieHeader(sessionId, expiresAt)
    }
  });
}

export async function handlePostApplicantLogout(request) {
  const token = getApplicantSessionCookie(request);
  if (token) {
    await deleteApplicantSession(token);
  }

  return new Response(null, {
    status: 302,
    headers: {
      Location: "/applicant/login",
      "Set-Cookie": clearApplicantSessionCookieHeader()
    }
  });
}
