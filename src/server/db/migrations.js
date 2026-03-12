import { sql } from "../../../db.js";

export async function ensureAuthTables() {
  await sql`
    CREATE TABLE IF NOT EXISTS ats_users (
      id SERIAL PRIMARY KEY,
      username TEXT UNIQUE NOT NULL,
      password_hash TEXT NOT NULL,
      role TEXT NOT NULL CHECK (role IN ('admin', 'user')),
      created_at TIMESTAMPTZ DEFAULT NOW()
    )
  `;

  await sql`
    CREATE TABLE IF NOT EXISTS ats_sessions (
      id TEXT PRIMARY KEY,
      user_id INTEGER NOT NULL REFERENCES ats_users(id) ON DELETE CASCADE,
      expires_at TIMESTAMPTZ NOT NULL,
      created_at TIMESTAMPTZ DEFAULT NOW()
    )
  `;
}
