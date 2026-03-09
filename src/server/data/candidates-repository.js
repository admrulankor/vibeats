import { sql } from "../../../db.js";
import { getCvFilenameForCandidateName } from "../fs/cv-paths.js";

export async function ensureCandidateColumnsAndSync() {
  await sql`
    ALTER TABLE candidates
    ADD COLUMN IF NOT EXISTS cv_filename TEXT
  `;

  await sql`
    ALTER TABLE candidates
    ADD COLUMN IF NOT EXISTS extraction_status TEXT NOT NULL DEFAULT 'idle'
  `;

  await sql`
    ALTER TABLE candidates
    ADD COLUMN IF NOT EXISTS extraction_error TEXT
  `;

  await sql`
    ALTER TABLE candidates
    ADD COLUMN IF NOT EXISTS extracted_at TIMESTAMPTZ
  `;

  await sql`
    ALTER TABLE candidates
    ADD COLUMN IF NOT EXISTS profile_email TEXT
  `;

  await sql`
    ALTER TABLE candidates
    ADD COLUMN IF NOT EXISTS profile_phone TEXT
  `;

  await sql`
    ALTER TABLE candidates
    ADD COLUMN IF NOT EXISTS profile_location TEXT
  `;

  await sql`
    ALTER TABLE candidates
    ADD COLUMN IF NOT EXISTS profile_summary TEXT
  `;

  await sql`
    ALTER TABLE candidates
    ADD COLUMN IF NOT EXISTS skills_json JSONB NOT NULL DEFAULT '[]'::jsonb
  `;

  await sql`
    ALTER TABLE candidates
    ADD COLUMN IF NOT EXISTS experience_json JSONB NOT NULL DEFAULT '[]'::jsonb
  `;

  await sql`
    ALTER TABLE candidates
    ADD COLUMN IF NOT EXISTS education_json JSONB NOT NULL DEFAULT '[]'::jsonb
  `;

  await sql`
    ALTER TABLE candidates
    ADD COLUMN IF NOT EXISTS works_json JSONB NOT NULL DEFAULT '[]'::jsonb
  `;

  await sql`
    ALTER TABLE candidates
    ADD COLUMN IF NOT EXISTS awards_json JSONB NOT NULL DEFAULT '[]'::jsonb
  `;

  await sql`
    ALTER TABLE candidates
    ADD COLUMN IF NOT EXISTS raw_cv_text TEXT
  `;

  const candidates = await sql`
    SELECT id, name, cv_filename
    FROM candidates
  `;

  for (const candidate of candidates) {
    if (candidate.cv_filename) {
      continue;
    }

    const detectedCvFilename = getCvFilenameForCandidateName(candidate.name);

    if (!detectedCvFilename) {
      continue;
    }

    await sql`
      UPDATE candidates
      SET cv_filename = ${detectedCvFilename}
      WHERE id = ${candidate.id}
    `;
  }
}

export function getAllCandidates() {
  return sql`
    SELECT
      id,
      name,
      role,
      status,
      notes,
      cv_filename,
      extraction_status,
      extraction_error,
      extracted_at,
      profile_email,
      profile_phone,
      profile_location,
      profile_summary,
      skills_json,
      experience_json,
      education_json,
      works_json,
      awards_json,
      raw_cv_text,
      created_at
    FROM candidates
    ORDER BY created_at DESC
  `;
}

export async function getCandidateById(id) {
  const result = await sql`
    SELECT
      id,
      name,
      role,
      status,
      notes,
      cv_filename,
      extraction_status,
      extraction_error,
      extracted_at,
      profile_email,
      profile_phone,
      profile_location,
      profile_summary,
      skills_json,
      experience_json,
      education_json,
      works_json,
      awards_json,
      raw_cv_text,
      created_at
    FROM candidates
    WHERE id = ${id}
    LIMIT 1
  `;

  return result[0] || null;
}

export function getCandidatesForExtractionPass() {
  return sql`
    SELECT id, name, cv_filename, extraction_status, extracted_at
    FROM candidates
    ORDER BY id ASC
  `;
}

export async function updateCandidateExtractedData(candidateId, payload) {
  await sql`
    UPDATE candidates
    SET
      extraction_status = 'completed',
      extraction_error = NULL,
      extracted_at = COALESCE(extracted_at, NOW()),
      profile_email = ${payload.profile.email || null},
      profile_phone = ${payload.profile.phone || null},
      profile_location = ${payload.profile.location || null},
      profile_summary = ${payload.profile.summary || null},
      skills_json = ${JSON.stringify(payload.skills)}::jsonb,
      experience_json = ${JSON.stringify(payload.experience)}::jsonb,
      education_json = ${JSON.stringify(payload.education)}::jsonb,
      works_json = ${JSON.stringify(payload.works)}::jsonb,
      awards_json = ${JSON.stringify(payload.awards)}::jsonb
    WHERE id = ${candidateId}
  `;
}

export { sql };
