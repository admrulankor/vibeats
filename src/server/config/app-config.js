import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import YAML from "yaml";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const rootDirectory = path.resolve(__dirname, "../../..");

function loadAppConfig() {
  const configPath = path.join(rootDirectory, "config", "app.yaml");

  try {
    const raw = fs.readFileSync(configPath, "utf8");
    const parsed = YAML.parse(raw) ?? {};

    return {
      companyName: parsed.company?.name || "Comic Collective ATS",
      companySubtitle: parsed.company?.subtitle || "MVP hiring pipeline for fictional creative studios."
    };
  } catch (error) {
    console.warn("Could not read config/app.yaml, using defaults.", error);
    return {
      companyName: "Comic Collective ATS",
      companySubtitle: "MVP hiring pipeline for fictional creative studios."
    };
  }
}

export const port = Number(Bun.env.PORT || 3000);
export const appConfig = loadAppConfig();
export const availableStatuses = new Set(["Applied", "Screening", "Interview", "Offer"]);
export const applicationStatuses = ["Applied", "Screening", "Interview", "Offer"];
export const autoExtractionIntervalMs = Number(Bun.env.CV_AUTO_EXTRACT_INTERVAL_MS || 30000);
export const maxJsonBodyBytes = 1024 * 1024;
export const maxUploadBytes = 8 * 1024 * 1024;

export const headingLabels = [
  "summary",
  "profile",
  "skills",
  "technical skills",
  "core skills",
  "experience",
  "work experience",
  "professional experience",
  "employment",
  "education",
  "projects",
  "languages",
  "certifications",
  "references",
  "selected comic book credits"
];

export const directories = {
  root: rootDirectory,
  uploads: path.join(rootDirectory, "assets", "uploads"),
  public: path.join(rootDirectory, "src", "public"),
  assets: path.join(rootDirectory, "assets"),
  views: path.join(rootDirectory, "views")
};
