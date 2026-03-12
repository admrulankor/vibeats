import { autoExtractionIntervalMs, port } from "./config/app-config.js";
import { ensureCandidateColumnsAndSync } from "./data/candidates-repository.js";
import { ensureApplicantAuthTables, ensureAuthTables, ensureJobBoardTables } from "./db/migrations.js";
import { countAdmins } from "./data/users-repository.js";
import { deleteExpiredSessions } from "./auth/sessions-repository.js";
import { deleteExpiredApplicantSessions } from "./auth/applicant-sessions-repository.js";
import { runAutoExtractionPass } from "./services/extraction-service.js";
import { jsonResponse } from "./utils/http.js";
import { handleRequest } from "./router.js";

export async function startServer() {
  try {
    await ensureAuthTables();
    await ensureApplicantAuthTables();
    await ensureJobBoardTables();
    await deleteExpiredSessions();
    await deleteExpiredApplicantSessions();

    const adminCount = await countAdmins();
    if (adminCount === 0) {
      console.warn(
        "[auth] No admin accounts exist. Set ADMIN_USERNAME and ADMIN_PASSWORD env vars and run: bun seed.js"
      );
    }

    await ensureCandidateColumnsAndSync();
    await runAutoExtractionPass();

    const autoExtractionTimer = setInterval(() => {
      runAutoExtractionPass();
    }, autoExtractionIntervalMs);

    autoExtractionTimer.unref?.();
  } catch (error) {
    console.error("Failed to initialize CV metadata:", error);
  }

  Bun.serve({
    port,
    fetch: async (request) => {
      try {
        return await handleRequest(request);
      } catch (error) {
        console.error("Unhandled server error:", error);
        return jsonResponse({ error: "Internal server error." }, 500);
      }
    }
  });

  console.log(`ATS server running at http://localhost:${port}`);
}
