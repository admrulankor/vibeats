import { sql } from "./db.js";

const TABLES_TO_DROP = [
  "job_application_status_events",
  "job_application_answers",
  "job_applications",
  "job_questions",
  "jobs",
  "applicant_sessions",
  "applicant_users",
  "ats_sessions",
  "ats_users",
  "candidates",
  "application_statuses"
];

async function reset() {
  if (Bun.env.NODE_ENV === "production") {
    throw new Error("Refusing to reset database in production mode.");
  }

  for (const table of TABLES_TO_DROP) {
    await sql.unsafe(`DROP TABLE IF EXISTS ${table} CASCADE`);
  }

  console.log("Reset complete. All Vibeats tables were dropped.");
  await sql.close();
}

reset().catch(async (error) => {
  console.error("Reset failed:", error);
  await sql.close();
  process.exit(1);
});
