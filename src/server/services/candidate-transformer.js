import { getCvFilenameForCandidateName } from "../fs/cv-paths.js";
import { extractPortfolioHighlights } from "../parsers/portfolio-parser.js";

function parseJsonArray(value) {
  if (Array.isArray(value)) {
    return value;
  }

  let current = value;

  for (let depth = 0; depth < 3; depth += 1) {
    if (Array.isArray(current)) {
      return current;
    }

    if (typeof current !== "string") {
      return [];
    }

    try {
      current = JSON.parse(current);
    } catch (_error) {
      return [];
    }
  }

  return [];
}

export function normalizeCandidate(candidate) {
  return {
    ...candidate,
    skills_json: parseJsonArray(candidate.skills_json),
    experience_json: parseJsonArray(candidate.experience_json),
    education_json: parseJsonArray(candidate.education_json),
    works_json: parseJsonArray(candidate.works_json),
    awards_json: parseJsonArray(candidate.awards_json)
  };
}

export function toCandidateDto(candidate) {
  const normalized = normalizeCandidate(candidate);
  const cvFilename = normalized.cv_filename || getCvFilenameForCandidateName(normalized.name);
  const portfolio = extractPortfolioHighlights(normalized.raw_cv_text);
  const works = normalized.works_json.length ? normalized.works_json : portfolio.works;
  const awards = normalized.awards_json.length ? normalized.awards_json : portfolio.awards;

  return {
    id: normalized.id,
    name: normalized.name,
    role: normalized.role,
    status: normalized.status,
    notes: normalized.notes,
    created_at: normalized.created_at,
    cv_filename: cvFilename,
    cv_url: cvFilename ? `/assets/uploads/${encodeURIComponent(cvFilename)}` : null,
    extraction_status: normalized.extraction_status,
    extraction_error: normalized.extraction_error,
    extracted_at: normalized.extracted_at,
    profile: {
      email: normalized.profile_email,
      phone: normalized.profile_phone,
      location: normalized.profile_location,
      summary: normalized.profile_summary
    },
    skills: normalized.skills_json,
    experience: normalized.experience_json,
    education: normalized.education_json,
    works,
    awards
  };
}
