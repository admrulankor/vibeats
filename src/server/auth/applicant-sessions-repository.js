import { sql } from "../../../db.js";

export async function createApplicantSession(applicantUserId, expiresAt) {
  const id = crypto.randomUUID();

  await sql`
    INSERT INTO applicant_sessions (id, applicant_user_id, expires_at)
    VALUES (${id}, ${applicantUserId}, ${expiresAt})
  `;

  return id;
}

export async function getApplicantSessionWithUser(sessionId) {
  const rows = await sql`
    SELECT
      s.id AS session_id,
      s.expires_at,
      u.id AS applicant_id,
      u.email,
      u.name,
      u.phone,
      u.location
    FROM applicant_sessions s
    JOIN applicant_users u ON u.id = s.applicant_user_id
    WHERE s.id = ${sessionId}
      AND s.expires_at > NOW()
    LIMIT 1
  `;

  if (!rows[0]) {
    return null;
  }

  const row = rows[0];

  return {
    session: { id: row.session_id, expiresAt: row.expires_at },
    applicant: {
      id: row.applicant_id,
      email: row.email,
      name: row.name,
      phone: row.phone,
      location: row.location
    }
  };
}

export async function deleteApplicantSession(sessionId) {
  await sql`DELETE FROM applicant_sessions WHERE id = ${sessionId}`;
}

export async function deleteExpiredApplicantSessions() {
  await sql`DELETE FROM applicant_sessions WHERE expires_at <= NOW()`;
}
