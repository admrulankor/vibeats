import { sql } from "./db.js";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const uploadsDirectory = path.join(__dirname, "assets", "uploads");

const seedCandidates = [
  {
    name: "Lena Ashford",
    role: "Lead Illustrator",
    status: "Interview",
    notes: "Portfolio review for Moonglyph Atelier's upcoming title, The Starline Syndicate, was strong on character consistency."
  },
  {
    name: "Milo Quince",
    role: "Storyboard Writer",
    status: "Applied",
    notes: "Applied to panel pacing role for Bramble Frame Studio's fictional anthology project Lantern District Files."
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
    status: "Screening",
    notes: "Screening call completed for Ink Harbor Collective's internal pilot project Ember Alley Chronicle."
  }
];

async function seed() {
  await sql`DROP TABLE IF EXISTS candidates`;

  await sql`
    CREATE TABLE candidates (
      id SERIAL PRIMARY KEY,
      name TEXT NOT NULL,
      role TEXT NOT NULL,
      status TEXT NOT NULL,
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
