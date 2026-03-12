import { sql } from "../../../db.js";

export async function getApplicantByEmail(email) {
  const rows = await sql`
    SELECT id, email, password_hash, name, phone, location, default_cv_filename, created_at
    FROM applicant_users
    WHERE email = ${email}
    LIMIT 1
  `;

  return rows[0] ?? null;
}

export async function createApplicant({ email, passwordHash, name, phone, location }) {
  const rows = await sql`
    INSERT INTO applicant_users (email, password_hash, name, phone, location)
    VALUES (${email}, ${passwordHash}, ${name}, ${phone || null}, ${location || null})
    RETURNING id, email, name, phone, location, default_cv_filename, created_at
  `;

  return rows[0];
}

export async function getApplicantById(applicantId) {
  const rows = await sql`
    SELECT id, email, name, phone, location, default_cv_filename, created_at
    FROM applicant_users
    WHERE id = ${applicantId}
    LIMIT 1
  `;

  return rows[0] ?? null;
}

export async function updateApplicantDefaultCvFilename(applicantId, cvFilename) {
  await sql`
    UPDATE applicant_users
    SET default_cv_filename = ${cvFilename}
    WHERE id = ${applicantId}
  `;
}
