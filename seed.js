import { sql } from "./db.js";
import { APPLICATION_STATUSES } from "./src/shared/application-statuses.js";
import { ensureApplicantAuthTables, ensureAuthTables, ensureJobBoardTables } from "./src/server/db/migrations.js";

async function seed() {
  await ensureAuthTables();
  await ensureApplicantAuthTables();
  await ensureJobBoardTables();

  // Bootstrap initial admin account from env vars (idempotent)
  const adminUsername = Bun.env.ADMIN_USERNAME?.trim();
  const adminPassword = Bun.env.ADMIN_PASSWORD;
  if (adminUsername && adminPassword) {
    const existing = await sql`SELECT id FROM ats_users WHERE username = ${adminUsername} LIMIT 1`;
    if (!existing[0]) {
      const hash = await Bun.password.hash(adminPassword);
      await sql`INSERT INTO ats_users (username, password_hash, role) VALUES (${adminUsername}, ${hash}, 'admin')`;
      console.log(`Admin account created: ${adminUsername}`);
    } else {
      console.log(`Admin account already exists: ${adminUsername}`);
    }
  } else {
    console.log("Skipping admin bootstrap: ADMIN_USERNAME / ADMIN_PASSWORD not set.");
  }

  await sql`DROP TABLE IF EXISTS candidates`;
  await sql`DROP TABLE IF EXISTS application_statuses`;

  await sql`
    CREATE TABLE application_statuses (
      name TEXT PRIMARY KEY,
      sort_order INTEGER NOT NULL UNIQUE
    )
  `;

  for (const [index, status] of APPLICATION_STATUSES.entries()) {
    await sql`
      INSERT INTO application_statuses (name, sort_order)
      VALUES (${status}, ${index})
    `;
  }

  await sql`
    CREATE TABLE candidates (
      id SERIAL PRIMARY KEY,
      name TEXT NOT NULL,
      role TEXT NOT NULL,
      status TEXT NOT NULL REFERENCES application_statuses(name),
      notes TEXT NOT NULL,
      cv_filename TEXT,
      extraction_status TEXT NOT NULL DEFAULT 'idle',
      extraction_error TEXT,
      extracted_at TIMESTAMPTZ,
      profile_email TEXT,
      profile_phone TEXT,
      profile_location TEXT,
      profile_summary TEXT,
      skills_json JSONB NOT NULL DEFAULT '[]'::jsonb,
      experience_json JSONB NOT NULL DEFAULT '[]'::jsonb,
      education_json JSONB NOT NULL DEFAULT '[]'::jsonb,
      raw_cv_text TEXT,
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    )
  `;

  console.log("Seed complete. Schema initialized with application statuses and empty candidates table.");
  await sql.close();
}

seed().catch(async (error) => {
  console.error("Seeding failed:", error);
  await sql.close();
  process.exit(1);
});
