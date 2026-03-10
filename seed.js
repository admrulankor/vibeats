import { sql } from "./db.js";
import { APPLICATION_STATUSES } from "./src/shared/application-statuses.js";

async function seed() {
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
