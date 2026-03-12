import { sql } from "../../../db.js";

export async function getUserByUsername(username) {
  const rows = await sql`SELECT * FROM ats_users WHERE username = ${username} LIMIT 1`;
  return rows[0] ?? null;
}

export async function getAllUsers() {
  return await sql`SELECT id, username, role, created_at FROM ats_users ORDER BY created_at ASC`;
}

export async function createUser(username, passwordHash, role) {
  const rows = await sql`
    INSERT INTO ats_users (username, password_hash, role)
    VALUES (${username}, ${passwordHash}, ${role})
    RETURNING id, username, role, created_at
  `;
  return rows[0];
}

export async function deleteUser(id) {
  await sql`DELETE FROM ats_users WHERE id = ${id}`;
}

export async function countAdmins() {
  const rows = await sql`SELECT COUNT(*) AS count FROM ats_users WHERE role = 'admin'`;
  return Number(rows[0].count);
}
