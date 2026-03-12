import { sql } from "../../../db.js";

export async function createSession(userId, expiresAt) {
  const id = crypto.randomUUID();
  await sql`
    INSERT INTO ats_sessions (id, user_id, expires_at)
    VALUES (${id}, ${userId}, ${expiresAt})
  `;
  return id;
}

export async function getSessionWithUser(sessionId) {
  const rows = await sql`
    SELECT
      s.id AS session_id,
      s.expires_at,
      u.id AS user_id,
      u.username,
      u.role
    FROM ats_sessions s
    JOIN ats_users u ON u.id = s.user_id
    WHERE s.id = ${sessionId}
      AND s.expires_at > NOW()
    LIMIT 1
  `;
  if (!rows[0]) return null;

  const row = rows[0];
  return {
    session: { id: row.session_id, expiresAt: row.expires_at },
    user: { id: row.user_id, username: row.username, role: row.role }
  };
}

export async function deleteSession(sessionId) {
  await sql`DELETE FROM ats_sessions WHERE id = ${sessionId}`;
}

export async function deleteExpiredSessions() {
  await sql`DELETE FROM ats_sessions WHERE expires_at <= NOW()`;
}
