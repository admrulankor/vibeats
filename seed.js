import { sql } from "./db.js";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { APPLICATION_STATUSES } from "./src/shared/application-statuses.js";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const uploadsDirectory = path.join(__dirname, "assets", "uploads");

const seedCandidates = [
  {
    name: "Lena Ashford",
    role: "Lead Illustrator",
    status: "Client Interview",
    notes: "Portfolio review for Moonglyph Atelier's upcoming title, The Starline Syndicate, was strong on character consistency."
  },
  {
    name: "Milo Quince",
    role: "Storyboard Writer",
    status: "Interested",
    notes: "Interested in panel pacing role for Bramble Frame Studio's fictional anthology project Lantern District Files."
  },
  {
    name: "Sora Vale",
    role: "Colorist",
    status: "Offer",
    notes: "Color script exercise for Velvet Comet Works' series Neon Orchard Brigade matched mood targets and production cadence."
  },
  {
    name: "Iris Fen",
    role: "Lettering Specialist",
    status: "Shortlisted",
    notes: "Shortlisted after intro call for Ink Harbor Collective's internal pilot project Ember Alley Chronicle."
  },
  {
    name: "Rian Thorne",
    role: "Comic Editor",
    status: "Client Submission",
    notes: "Submission packet prepared and sent to client stakeholders for final interview loop."
  },
  {
    name: "Nia Carden",
    role: "Production Artist",
    status: "Hired",
    notes: "Offer accepted, hire paperwork complete, and onboarding schedule confirmed."
  },
  {
    name: "Theo Marsh",
    role: "Layout Designer",
    status: "Started",
    notes: "Candidate has started and is paired with a mentor for first sprint handoff."
  },
  {
    name: "Uma Bell",
    role: "Visual Development Artist",
    status: "Probation passed",
    notes: "Passed probation review with strong collaboration and delivery consistency."
  },
  {
    name: "Gio Park",
    role: "Concept Artist",
    status: "Applied",
    notes: "Applied directly through studio referral with environment concept samples attached."
  }
];

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

  for (const candidate of seedCandidates) {
    const cvFilename = `${candidate.name} - CV.pdf`;
    const cvFilePath = path.join(uploadsDirectory, cvFilename);

    await sql`
      INSERT INTO candidates (name, role, status, notes, cv_filename)
      VALUES (
        ${candidate.name},
        ${candidate.role},
        ${candidate.status},
        ${candidate.notes},
        ${fs.existsSync(cvFilePath) ? cvFilename : null}
      )
    `;
  }

  console.log(`Seed complete. Inserted ${seedCandidates.length} candidates.`);
  await sql.close();
}

seed().catch(async (error) => {
  console.error("Seeding failed:", error);
  await sql.close();
  process.exit(1);
});
