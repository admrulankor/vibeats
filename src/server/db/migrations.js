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

export async function ensureApplicantAuthTables() {
  await sql`
    CREATE TABLE IF NOT EXISTS applicant_users (
      id SERIAL PRIMARY KEY,
      email TEXT UNIQUE NOT NULL,
      password_hash TEXT NOT NULL,
      name TEXT NOT NULL,
      phone TEXT,
      location TEXT,
      created_at TIMESTAMPTZ DEFAULT NOW()
    )
  `;

  await sql`
    ALTER TABLE applicant_users
    ADD COLUMN IF NOT EXISTS default_cv_filename TEXT
  `;

  await sql`
    CREATE TABLE IF NOT EXISTS applicant_sessions (
      id TEXT PRIMARY KEY,
      applicant_user_id INTEGER NOT NULL REFERENCES applicant_users(id) ON DELETE CASCADE,
      expires_at TIMESTAMPTZ NOT NULL,
      created_at TIMESTAMPTZ DEFAULT NOW()
    )
  `;
}

export async function ensureJobBoardTables() {
  await sql`
    CREATE TABLE IF NOT EXISTS jobs (
      id SERIAL PRIMARY KEY,
      title TEXT NOT NULL,
      intro TEXT,
      required_qualifications TEXT,
      recommended_qualifications TEXT,
      description TEXT,
      employment_type TEXT,
      location TEXT,
      status TEXT NOT NULL DEFAULT 'draft' CHECK (status IN ('draft', 'published', 'closed')),
      created_by_user_id INTEGER REFERENCES ats_users(id) ON DELETE SET NULL,
      created_at TIMESTAMPTZ DEFAULT NOW(),
      updated_at TIMESTAMPTZ DEFAULT NOW()
    )
  `;

  await sql`
    CREATE TABLE IF NOT EXISTS job_questions (
      id SERIAL PRIMARY KEY,
      job_id INTEGER NOT NULL REFERENCES jobs(id) ON DELETE CASCADE,
      prompt TEXT NOT NULL,
      input_type TEXT NOT NULL DEFAULT 'text' CHECK (input_type IN ('text', 'textarea', 'number', 'boolean')),
      is_required BOOLEAN NOT NULL DEFAULT FALSE,
      display_order INTEGER NOT NULL DEFAULT 0,
      created_at TIMESTAMPTZ DEFAULT NOW()
    )
  `;

  await sql`
    CREATE TABLE IF NOT EXISTS job_applications (
      id SERIAL PRIMARY KEY,
      job_id INTEGER NOT NULL REFERENCES jobs(id) ON DELETE CASCADE,
      applicant_user_id INTEGER NOT NULL REFERENCES applicant_users(id) ON DELETE CASCADE,
      candidate_id INTEGER REFERENCES candidates(id) ON DELETE SET NULL,
      status TEXT NOT NULL DEFAULT 'Applied',
      notes TEXT,
      created_at TIMESTAMPTZ DEFAULT NOW(),
      updated_at TIMESTAMPTZ DEFAULT NOW()
    )
  `;

  await sql`
    CREATE TABLE IF NOT EXISTS job_application_answers (
      id SERIAL PRIMARY KEY,
      job_application_id INTEGER NOT NULL REFERENCES job_applications(id) ON DELETE CASCADE,
      job_question_id INTEGER REFERENCES job_questions(id) ON DELETE SET NULL,
      prompt TEXT NOT NULL,
      answer_text TEXT,
      display_order INTEGER NOT NULL DEFAULT 0,
      created_at TIMESTAMPTZ DEFAULT NOW()
    )
  `;

  await sql`
    CREATE TABLE IF NOT EXISTS job_application_status_events (
      id SERIAL PRIMARY KEY,
      job_application_id INTEGER NOT NULL REFERENCES job_applications(id) ON DELETE CASCADE,
      from_status TEXT,
      to_status TEXT NOT NULL,
      actor_user_id INTEGER REFERENCES ats_users(id) ON DELETE SET NULL,
      actor_applicant_id INTEGER REFERENCES applicant_users(id) ON DELETE SET NULL,
      created_at TIMESTAMPTZ DEFAULT NOW()
    )
  `;
}
