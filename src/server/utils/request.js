import { maxJsonBodyBytes } from "../config/app-config.js";
import { createHttpError } from "./http.js";

export function parseIdSegment(pathname, prefix, suffix = "") {
  const escapedPrefix = prefix.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const escapedSuffix = suffix.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const matcher = new RegExp(`^${escapedPrefix}([^/]+)${escapedSuffix}$`);
  const match = pathname.match(matcher);

  if (!match) {
    return null;
  }

  const candidateId = Number.parseInt(match[1], 10);

  return Number.isNaN(candidateId)
    ? { invalid: true }
    : { value: candidateId };
}

export async function parseJsonBody(request) {
  const contentLength = Number(request.headers.get("content-length") || "0");

  if (contentLength > maxJsonBodyBytes) {
    throw createHttpError(413, "JSON payload is too large.");
  }

  const rawBody = await request.text();

  if (Buffer.byteLength(rawBody, "utf8") > maxJsonBodyBytes) {
    throw createHttpError(413, "JSON payload is too large.");
  }

  if (!rawBody.trim()) {
    return {};
  }

  try {
    return JSON.parse(rawBody);
  } catch (_error) {
    throw createHttpError(400, "Invalid JSON payload.");
  }
}
