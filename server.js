import express from "express";
import fs from "node:fs";
import path from "node:path";
import { randomUUID } from "node:crypto";
import { fileURLToPath } from "node:url";
import YAML from "yaml";
import PDFDocument from "pdfkit";
import { PDFParse } from "pdf-parse";
import multer from "multer";
import { sql } from "./db.js";

const app = express();
const port = Number(Bun.env.PORT || process.env.PORT || 3000);

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

function loadAppConfig() {
  const configPath = path.join(__dirname, "config", "app.yaml");

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

const appConfig = loadAppConfig();
const availableStatuses = new Set(["Applied", "Screening", "Interview", "Offer"]);
const uploadsDirectory = path.join(__dirname, "assets", "uploads");
const autoExtractionIntervalMs = Number(Bun.env.CV_AUTO_EXTRACT_INTERVAL_MS || process.env.CV_AUTO_EXTRACT_INTERVAL_MS || 30000);
let autoExtractionPassRunning = false;
const headingLabels = [
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
const applicationStatuses = ["Applied", "Screening", "Interview", "Offer"];

const upload = multer({
  storage: multer.diskStorage({
    destination: (_request, _file, callback) => {
      fs.mkdirSync(uploadsDirectory, { recursive: true });
      callback(null, uploadsDirectory);
    },
    filename: (_request, file, callback) => {
      const extension = path.extname(file.originalname || "").toLowerCase() || ".pdf";
      const baseName = path.basename(file.originalname || "cv", extension);
      const sanitizedBase = baseName
        .replace(/[^A-Za-z0-9\-_.\s]/g, "")
        .trim()
        .replace(/\s+/g, "-")
        .slice(0, 60) || "cv";

      callback(null, `${Date.now()}-${randomUUID()}-${sanitizedBase}${extension}`);
    }
  }),
  limits: {
    fileSize: 8 * 1024 * 1024
  },
  fileFilter: (_request, file, callback) => {
    const filename = file.originalname || "";
    const isPdfMime = file.mimetype === "application/pdf";
    const isPdfName = /\.pdf$/i.test(filename);

    if (isPdfMime || isPdfName) {
      callback(null, true);
      return;
    }

    callback(new Error("Only PDF files are supported."));
  }
});

function escapeRegExp(value) {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function parseJsonArray(value) {
  if (Array.isArray(value)) {
    return value;
  }

  if (typeof value === "string") {
    try {
      const parsed = JSON.parse(value);
      return Array.isArray(parsed) ? parsed : [];
    } catch (_error) {
      return [];
    }
  }

  return [];
}

function sanitizePortfolioLines(text) {
  return String(text || "")
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter((line) => line && !/^\d+\/\d+$/.test(line) && !/^--\s*\d+\s+of\s+\d+\s*--$/i.test(line));
}

function isYearEntry(line) {
  return /^\d{4}(?:[–-]\d{4})?\b/.test(line);
}

function collectSectionEntries(lines, startHeading, endHeadings) {
  const startIndex = lines.findIndex((line) => line.toLowerCase() === startHeading.toLowerCase());

  if (startIndex === -1) {
    return [];
  }

  const entries = [];

  for (let index = startIndex + 1; index < lines.length; index += 1) {
    const line = lines[index];
    const lower = line.toLowerCase();

    if (endHeadings.some((heading) => lower === heading.toLowerCase())) {
      break;
    }

    entries.push(line);
  }

  return entries;
}

function mergeYearBasedLines(lines) {
  const entries = [];
  let currentEntry = "";

  for (const line of lines) {
    if (isYearEntry(line)) {
      if (currentEntry) {
        entries.push(currentEntry);
      }

      currentEntry = line;
      continue;
    }

    if (!currentEntry) {
      currentEntry = line;
      continue;
    }

    currentEntry = `${currentEntry} ${line}`;
  }

  if (currentEntry) {
    entries.push(currentEntry);
  }

  return entries;
}

function extractPortfolioHighlights(rawText) {
  const lines = sanitizePortfolioLines(rawText);

  if (!lines.length) {
    return {
      works: [],
      awards: []
    };
  }

  const works = [];
  const worksSections = [
    "literary works",
    "standalone novels",
    "comic book runs",
    "filmography & screenwriting"
  ];

  for (let index = 0; index < worksSections.length; index += 1) {
    const currentHeading = worksSections[index];
    const remainingHeadings = worksSections.slice(index + 1);
    const endHeadings = [...remainingHeadings, "awards & honors", "education"];
    const sectionEntries = collectSectionEntries(lines, currentHeading, endHeadings);

    if (sectionEntries.length) {
      works.push(...sectionEntries);
    }
  }

  const awardsLines = collectSectionEntries(lines, "awards & honors", ["education"]);

  return {
    works: mergeYearBasedLines(works),
    awards: mergeYearBasedLines(awardsLines)
  };
}

function normalizeCandidate(candidate) {
  return {
    ...candidate,
    skills_json: parseJsonArray(candidate.skills_json),
    experience_json: parseJsonArray(candidate.experience_json),
    education_json: parseJsonArray(candidate.education_json),
    works_json: parseJsonArray(candidate.works_json),
    awards_json: parseJsonArray(candidate.awards_json)
  };
}

function getCvFilenameForCandidateName(name) {
  const expectedFileName = `${name} - CV.pdf`;
  const expectedFilePath = path.join(uploadsDirectory, expectedFileName);

  return fs.existsSync(expectedFilePath) ? expectedFileName : null;
}

function toCandidateDto(candidate) {
  const normalized = normalizeCandidate(candidate);
  const cvFilename = normalized.cv_filename || getCvFilenameForCandidateName(normalized.name);
  const portfolio = extractPortfolioHighlights(normalized.raw_cv_text);
  const works = normalized.works_json.length ? normalized.works_json : portfolio.works;
  const awards = normalized.awards_json.length ? normalized.awards_json : portfolio.awards;

  return {
    id: normalized.id,
    name: normalized.name,
    role: normalized.role,
    status: normalized.status,
    notes: normalized.notes,
    created_at: normalized.created_at,
    cv_filename: cvFilename,
    cv_url: cvFilename ? `/assets/uploads/${encodeURIComponent(cvFilename)}` : null,
    extraction_status: normalized.extraction_status,
    extraction_error: normalized.extraction_error,
    extracted_at: normalized.extracted_at,
    profile: {
      email: normalized.profile_email,
      phone: normalized.profile_phone,
      location: normalized.profile_location,
      summary: normalized.profile_summary
    },
    skills: normalized.skills_json,
    experience: normalized.experience_json,
    education: normalized.education_json,
    works,
    awards
  };
}

async function ensureCandidateColumnsAndSync() {
  await sql`
    ALTER TABLE candidates
    ADD COLUMN IF NOT EXISTS cv_filename TEXT
  `;

  await sql`
    ALTER TABLE candidates
    ADD COLUMN IF NOT EXISTS extraction_status TEXT NOT NULL DEFAULT 'idle'
  `;

  await sql`
    ALTER TABLE candidates
    ADD COLUMN IF NOT EXISTS extraction_error TEXT
  `;

  await sql`
    ALTER TABLE candidates
    ADD COLUMN IF NOT EXISTS extracted_at TIMESTAMPTZ
  `;

  await sql`
    ALTER TABLE candidates
    ADD COLUMN IF NOT EXISTS profile_email TEXT
  `;

  await sql`
    ALTER TABLE candidates
    ADD COLUMN IF NOT EXISTS profile_phone TEXT
  `;

  await sql`
    ALTER TABLE candidates
    ADD COLUMN IF NOT EXISTS profile_location TEXT
  `;

  await sql`
    ALTER TABLE candidates
    ADD COLUMN IF NOT EXISTS profile_summary TEXT
  `;

  await sql`
    ALTER TABLE candidates
    ADD COLUMN IF NOT EXISTS skills_json JSONB NOT NULL DEFAULT '[]'::jsonb
  `;

  await sql`
    ALTER TABLE candidates
    ADD COLUMN IF NOT EXISTS experience_json JSONB NOT NULL DEFAULT '[]'::jsonb
  `;

  await sql`
    ALTER TABLE candidates
    ADD COLUMN IF NOT EXISTS education_json JSONB NOT NULL DEFAULT '[]'::jsonb
  `;

  await sql`
    ALTER TABLE candidates
    ADD COLUMN IF NOT EXISTS works_json JSONB NOT NULL DEFAULT '[]'::jsonb
  `;

  await sql`
    ALTER TABLE candidates
    ADD COLUMN IF NOT EXISTS awards_json JSONB NOT NULL DEFAULT '[]'::jsonb
  `;

  await sql`
    ALTER TABLE candidates
    ADD COLUMN IF NOT EXISTS raw_cv_text TEXT
  `;

  const candidates = await sql`
    SELECT id, name, cv_filename
    FROM candidates
  `;

  for (const candidate of candidates) {
    if (candidate.cv_filename) {
      continue;
    }

    const detectedCvFilename = getCvFilenameForCandidateName(candidate.name);

    if (!detectedCvFilename) {
      continue;
    }

    await sql`
      UPDATE candidates
      SET cv_filename = ${detectedCvFilename}
      WHERE id = ${candidate.id}
    `;
  }
}

async function extractCandidateCvData(candidateId) {
  const candidate = await getCandidateById(candidateId);

  if (!candidate) {
    throw new Error("Candidate not found.");
  }

  if (candidate.extraction_status === "processing") {
    return candidate;
  }

  const cvFilename = candidate.cv_filename || getCvFilenameForCandidateName(candidate.name);

  if (!cvFilename) {
    throw new Error("No CV PDF found for this candidate.");
  }

  const cvFilePath = getCvAbsolutePath(cvFilename);

  if (!fs.existsSync(cvFilePath)) {
    throw new Error("CV PDF file is missing from assets/uploads.");
  }

  let parser;

  try {
    await sql`
      UPDATE candidates
      SET extraction_status = 'processing', extraction_error = NULL, cv_filename = ${cvFilename}
      WHERE id = ${candidateId}
    `;

    const buffer = fs.readFileSync(cvFilePath);
    parser = new PDFParse({ data: buffer });
    const parsedPdf = await parser.getText();
    const rawText = (parsedPdf.text || "").trim();

    if (!rawText) {
      throw new Error("PDF text extraction returned empty content. The file may be image-only.");
    }

    const extracted = extractCandidateDataFromCvText(rawText, candidate);
    const portfolio = extractPortfolioHighlights(rawText);

    await sql`
      UPDATE candidates
      SET
        cv_filename = ${cvFilename},
        extraction_status = 'completed',
        extraction_error = NULL,
        extracted_at = NOW(),
        profile_email = ${extracted.email},
        profile_phone = ${extracted.phone},
        profile_location = ${extracted.location},
        profile_summary = ${extracted.summary},
        skills_json = ${JSON.stringify(extracted.skills)}::jsonb,
        experience_json = ${JSON.stringify(extracted.experience)}::jsonb,
        education_json = ${JSON.stringify(extracted.education)}::jsonb,
        works_json = ${JSON.stringify(portfolio.works)}::jsonb,
        awards_json = ${JSON.stringify(portfolio.awards)}::jsonb,
        raw_cv_text = ${extracted.rawText}
      WHERE id = ${candidateId}
    `;

    return await getCandidateById(candidateId);
  } catch (error) {
    const message = error instanceof Error ? error.message : "Extraction failed.";

    await sql`
      UPDATE candidates
      SET extraction_status = 'failed', extraction_error = ${message}
      WHERE id = ${candidateId}
    `;

    throw error;
  } finally {
    if (parser) {
      try {
        await parser.destroy();
      } catch (_error) {
      }
    }
  }
}

async function runAutoExtractionPass() {
  if (autoExtractionPassRunning) {
    return;
  }

  autoExtractionPassRunning = true;

  try {
    const candidates = await sql`
      SELECT id, name, cv_filename, extraction_status, extracted_at
      FROM candidates
      ORDER BY id ASC
    `;

    for (const candidate of candidates) {
      const detectedCvFilename = getCvFilenameForCandidateName(candidate.name);

      if (!detectedCvFilename) {
        continue;
      }

      if (candidate.cv_filename !== detectedCvFilename) {
        await sql`
          UPDATE candidates
          SET cv_filename = ${detectedCvFilename}
          WHERE id = ${candidate.id}
        `;

        candidate.cv_filename = detectedCvFilename;
      }

      const cvFilePath = getCvAbsolutePath(detectedCvFilename);

      if (!fs.existsSync(cvFilePath) || candidate.extraction_status === "processing") {
        continue;
      }

      const extractedAtMs = candidate.extracted_at ? new Date(candidate.extracted_at).getTime() : 0;
      const cvUpdatedAtMs = fs.statSync(cvFilePath).mtime.getTime();
      const needsExtraction =
        candidate.extraction_status === "idle" ||
        candidate.extraction_status === "failed" ||
        !candidate.extracted_at ||
        cvUpdatedAtMs > extractedAtMs;

      if (!needsExtraction) {
        continue;
      }

      try {
        await extractCandidateCvData(candidate.id);
      } catch (error) {
        console.error(`Auto extraction failed for candidate ${candidate.id}:`, error);
      }
    }
  } catch (error) {
    console.error("Auto extraction pass failed:", error);
  } finally {
    autoExtractionPassRunning = false;
  }
}

function getAllCandidates() {
  return sql`
    SELECT
      id,
      name,
      role,
      status,
      notes,
      cv_filename,
      extraction_status,
      extraction_error,
      extracted_at,
      profile_email,
      profile_phone,
      profile_location,
      profile_summary,
      skills_json,
      experience_json,
      education_json,
      raw_cv_text,
      created_at
    FROM candidates
    ORDER BY created_at DESC
  `;
}

async function getCandidateById(id) {
  const result = await sql`
    SELECT
      id,
      name,
      role,
      status,
      notes,
      cv_filename,
      extraction_status,
      extraction_error,
      extracted_at,
      profile_email,
      profile_phone,
      profile_location,
      profile_summary,
      skills_json,
      experience_json,
      education_json,
      raw_cv_text,
      created_at
    FROM candidates
    WHERE id = ${id}
    LIMIT 1
  `;

  return result[0] || null;
}

function getCvAbsolutePath(cvFilename) {
  return path.join(uploadsDirectory, cvFilename);
}

function cleanLines(text) {
  return text
    .split(/\r?\n/g)
    .map((line) => line.trim())
    .filter(Boolean);
}

function isHeading(line) {
  const normalized = line.toLowerCase().replace(/[:\-]/g, "").trim();
  return headingLabels.some((heading) => normalized === heading);
}

function readSectionLines(lines, labels) {
  const lookup = new Set(labels.map((label) => label.toLowerCase()));
  const startIndex = lines.findIndex((line) => lookup.has(line.toLowerCase().replace(/[:\-]/g, "").trim()));

  if (startIndex === -1) {
    return [];
  }

  const section = [];

  for (let index = startIndex + 1; index < lines.length; index += 1) {
    const line = lines[index];

    if (isHeading(line)) {
      break;
    }

    section.push(line);
  }

  return section;
}

function uniqueStrings(items) {
  const seen = new Set();
  const ordered = [];

  for (const item of items) {
    const normalized = item.trim();
    if (!normalized) {
      continue;
    }

    const key = normalized.toLowerCase();
    if (seen.has(key)) {
      continue;
    }

    seen.add(key);
    ordered.push(normalized);
  }

  return ordered;
}

function extractEmail(text) {
  const match = text.match(/[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}/i);
  return match ? match[0] : null;
}

function toTitleCaseName(value) {
  return value
    .split(/\s+/)
    .map((token) => {
      if (!token) {
        return token;
      }

      if (/^[A-Z]\.?(?:[A-Z]\.?)?$/.test(token)) {
        return token.toUpperCase();
      }

      return token
        .toLowerCase()
        .replace(/(^|[-'])\p{L}/gu, (match) => match.toUpperCase());
    })
    .join(" ");
}

function normalizePersonName(line) {
  const cleaned = line
    .replace(/[•|]/g, " ")
    .replace(/\s+/g, " ")
    .trim();

  if (!cleaned || cleaned.length < 3 || cleaned.length > 80) {
    return null;
  }

  if (/[@\d]/.test(cleaned) || /https?:\/\//i.test(cleaned)) {
    return null;
  }

  if (/\b(curriculum vitae|resume|cv|contact|summary|profile|experience|education|skills)\b/i.test(cleaned)) {
    return null;
  }

  const words = cleaned
    .split(/\s+/)
    .map((word) => word.trim())
    .filter(Boolean);

  if (words.length < 2 || words.length > 6) {
    return null;
  }

  if (words.some((word) => !/^[\p{L}][\p{L}'\-.]*$/u.test(word) && !/^[A-Za-z]\.?(?:[A-Za-z]\.?)?$/.test(word))) {
    return null;
  }

  return toTitleCaseName(words.join(" "));
}

function extractNameFromFilename(filename) {
  const basename = path.basename(filename || "", path.extname(filename || ""));
  const normalized = basename
    .replace(/[-_]+/g, " ")
    .replace(/\b(cv|resume|curriculum vitae|final|draft|updated|v\d+)\b/gi, " ")
    .replace(/\s+/g, " ")
    .trim();

  return normalizePersonName(normalized);
}

function extractCandidateName(lines, fallbackName = null) {
  const upperWindow = lines.slice(0, 12);

  for (const line of upperWindow) {
    const fromLabel = line.match(/^(?:name|candidate)\s*[:\-]\s*(.+)$/i);
    const candidateLine = fromLabel?.[1] || line;
    const parsed = normalizePersonName(candidateLine);

    if (parsed) {
      return parsed;
    }
  }

  return fallbackName;
}

function extractRole(text, lines) {
  for (const line of lines.slice(0, 20)) {
    const labeled = line.match(/^(?:role|position|applied\s+for|title)\s*[:\-]\s*(.+)$/i);

    if (labeled?.[1]) {
      return labeled[1].trim().slice(0, 80);
    }
  }

  const inline = text.match(/(?:applying for|seeking|target(?:ing)? role(?: as)?)\s+([A-Za-z][A-Za-z\s/&-]{2,80})/i);
  return inline?.[1]?.trim() || null;
}

function extractPhone(_text, lines) {
  const contactCuePattern = /(phone|mobile|tel|telephone|contact|whatsapp|📞|☎|📱)/i;
  const phonePattern = /(?:\+?\d[\d\s().\-–]{8,}\d)/g;

  const candidateLines = lines.filter((line, index) => {
    if (contactCuePattern.test(line)) {
      return true;
    }

    if (index < 8 && /[•|]/.test(line) && /\d/.test(line)) {
      return true;
    }

    return false;
  });

  for (const line of candidateLines) {
    const matches = line.match(phonePattern) || [];

    for (const match of matches) {
      const normalized = match.replace(/\s+/g, " ").trim();
      const digits = normalized.replace(/\D/g, "");

      if (/^\d{4}\s*[–-]\s*(?:present|\d{4})$/i.test(normalized)) {
        continue;
      }

      if (digits.length < 10 || digits.length > 15) {
        continue;
      }

      return normalized;
    }
  }

  return null;
}

function extractLocation(lines) {
  const topText = lines.slice(0, 8).join(" ");
  const pinMatch = topText.match(/📍\s*([^•\n]+)/u);

  if (pinMatch?.[1]) {
    return pinMatch[1].trim();
  }

  const maybeLocation = lines
    .slice(0, 12)
    .find(
      (line) =>
        !line.includes("@") &&
        /,/.test(line) &&
        /[A-Za-z]/.test(line) &&
        !/\b(phone|email|github|linkedin)\b/i.test(line) &&
        line.length <= 80 &&
        (line.match(/,/g) || []).length <= 2
    );

  return maybeLocation || null;
}

function extractSummary(text, lines) {
  const summarySection = readSectionLines(lines, ["summary", "profile"]);
  if (summarySection.length) {
    return summarySection.join(" ").slice(0, 600);
  }

  const snippets = text
    .replace(/\s+/g, " ")
    .split(/[.!?]/)
    .map((part) => part.trim())
    .filter(Boolean)
    .slice(0, 3);

  return snippets.length ? `${snippets.join(". ")}.` : null;
}

function extractSkills(text, lines) {
  const knownSkills = [
    "JavaScript",
    "TypeScript",
    "Node.js",
    "Express",
    "Bun",
    "Python",
    "SQL",
    "PostgreSQL",
    "AWS",
    "Docker",
    "Kubernetes",
    "Linux",
    "Git",
    "CI/CD",
    "React",
    "Vue",
    "Figma",
    "Clip Studio Paint",
    "Adobe Photoshop",
    "Procreate",
    "SketchUp",
    "Sequential storytelling",
    "Figure drawing",
    "Anatomy",
    "Perspective",
    "Inking",
    "Character design",
    "Concept art"
  ];
  const sectionLines = readSectionLines(lines, ["skills", "technical skills"]);
  const coreSectionLines = readSectionLines(lines, ["core skills"]);
  const mergedSection = [...sectionLines, ...coreSectionLines];

  const sectionChunks = mergedSection
    .join(" ")
    .split("●")
    .map((chunk) => chunk.trim())
    .filter(Boolean);

  const sectionSkills = sectionChunks
    .flatMap((chunk) => {
      const cleanedChunk = chunk
        .replace(/\([^)]*\)/g, "")
        .replace(/^\w+\s*:\s*/i, "")
        .replace(/\s+/g, " ")
        .trim();

      return cleanedChunk
        .split(/[,/;]|\band\b/gi)
        .map((token) => token.trim().replace(/[\s.:-]+$/g, ""))
        .filter((token) => token.length >= 3 && token.length <= 48)
        .filter((token) => !/^\d+$/.test(token))
        .filter((token) => !/^[#\-–—]+$/.test(token))
        .filter((token) => !/^for$/i.test(token));
    })
    .slice(0, 40);

  const detectedKnown = knownSkills.filter((skill) => {
    const expression = new RegExp(`\\b${escapeRegExp(skill)}\\b`, "i");
    return expression.test(text);
  });

  return uniqueStrings([...sectionSkills, ...detectedKnown]).slice(0, 40);
}

function looksLikeDateLine(line) {
  return /\b(19|20)\d{2}\b/.test(line) || /\b(?:present|current)\b/i.test(line);
}

function buildTimelineItems(lines) {
  if (!lines.length) {
    return [];
  }

  const items = [];
  let cursor = 0;

  while (cursor < lines.length) {
    const title = lines[cursor] || null;
    const company = lines[cursor + 1] || null;
    const third = lines[cursor + 2] || null;
    const fourth = lines[cursor + 3] || null;

    const period = looksLikeDateLine(third || "") ? third : looksLikeDateLine(fourth || "") ? fourth : null;
    const descriptionStart = period && third === period ? cursor + 3 : cursor + 2;
    const description = lines
      .slice(descriptionStart, descriptionStart + 2)
      .join(" ")
      .trim();

    items.push({
      title,
      company,
      period,
      description: description || null
    });

    cursor += 4;
  }

  return items
    .filter((item) => item.title)
    .slice(0, 10);
}

function extractExperience(lines) {
  const section = readSectionLines(lines, ["experience", "work experience", "employment", "professional experience"]);

  if (!section.length) {
    return [];
  }

  const entries = [];
  let index = 0;

  function isEntryStart(at) {
    const current = section[at] || "";
    const next = section[at + 1] || "";

    if (!current || !next) {
      return false;
    }

    if (/^●/.test(current)) {
      return false;
    }

    return /\|/.test(next) && /\b(19|20)\d{2}\b/.test(next);
  }

  while (index < section.length) {
    if (!isEntryStart(index)) {
      index += 1;
      continue;
    }

    const title = section[index].trim();
    const metadataLine = section[index + 1].trim();
    const metadataParts = metadataLine.split("|").map((part) => part.trim()).filter(Boolean);

    const company = metadataParts[0] || null;
    const period = metadataParts.find((part) => /\b(19|20)\d{2}\b/.test(part)) || null;

    const bullets = [];
    index += 2;

    while (index < section.length && !isEntryStart(index)) {
      const line = section[index].trim();

      if (!line) {
        index += 1;
        continue;
      }

      if (/^●/.test(line)) {
        bullets.push(line.replace(/^●\s*/, "").trim());
      } else if (bullets.length) {
        bullets[bullets.length - 1] = `${bullets[bullets.length - 1]} ${line}`.replace(/\s+/g, " ").trim();
      }

      index += 1;
    }

    entries.push({
      title,
      company,
      period,
      description: bullets.join(" ") || null
    });
  }

  return entries.slice(0, 10);
}

function extractEducation(lines) {
  const section = readSectionLines(lines, ["education"]);
  return buildTimelineItems(section).filter((item) => !/^--\s*\d+\s+of\s+\d+\s*--$/i.test(item.title || ""));
}

function extractCandidateDataFromCvText(text, candidate) {
  const lines = cleanLines(text);
  const fallbackName = candidate?.name ? normalizePersonName(candidate.name) || candidate.name : null;

  return {
    name: extractCandidateName(lines, fallbackName),
    role: extractRole(text, lines) || candidate?.role || null,
    email: extractEmail(text),
    phone: extractPhone(text, lines),
    location: extractLocation(lines),
    summary: extractSummary(text, lines) || candidate?.notes || null,
    skills: extractSkills(text, lines),
    experience: extractExperience(lines),
    education: extractEducation(lines),
    rawText: text
  };
}

function writeCvDocumentHeader(document, title) {
  document
    .font("Helvetica-Bold")
    .fontSize(18)
    .fillColor("#111827")
    .text(title);

  document
    .moveDown(0.4)
    .font("Helvetica")
    .fontSize(10)
    .fillColor("#6B7280")
    .text(`Generated: ${new Date().toLocaleString()}`)
    .moveDown(1);
}

function writeCandidateCv(document, candidate) {
  document
    .font("Helvetica-Bold")
    .fontSize(14)
    .fillColor("#111827")
    .text(candidate.name);

  document
    .moveDown(0.3)
    .font("Helvetica")
    .fontSize(11)
    .fillColor("#374151")
    .text(`Target Role: ${candidate.role}`)
    .text(`Application Status: ${candidate.status}`)
    .text(`Profile Created: ${new Date(candidate.created_at).toLocaleDateString()}`)
    .moveDown(0.8);

  document
    .font("Helvetica-Bold")
    .fontSize(11)
    .fillColor("#111827")
    .text("Summary")
    .moveDown(0.2)
    .font("Helvetica")
    .fillColor("#374151")
    .text(candidate.notes, {
      align: "left",
      lineGap: 2
    })
    .moveDown(1.2);
}

app.set("view engine", "ejs");
app.set("views", path.join(__dirname, "views"));

app.use(express.static(path.join(__dirname, "public")));
app.use("/assets", express.static(path.join(__dirname, "assets")));
app.use(express.json({ limit: "1mb" }));

app.get("/", (_request, response) => {
  response.render("index", {
    title: appConfig.companyName,
    companyName: appConfig.companyName,
    companySubtitle: appConfig.companySubtitle
  });
});

app.get("/applicants/new", (_request, response) => {
  response.render("new-applicant", {
    title: `${appConfig.companyName} · Add Applicant`,
    companyName: appConfig.companyName,
    companySubtitle: appConfig.companySubtitle
  });
});

app.get("/candidates/:id", (request, response) => {
  const candidateId = Number.parseInt(request.params.id, 10);

  if (Number.isNaN(candidateId)) {
    response.status(400).send("Invalid candidate id.");
    return;
  }

  response.render("candidate", {
    title: `${appConfig.companyName} · Candidate`,
    companyName: appConfig.companyName,
    companySubtitle: appConfig.companySubtitle,
    candidateId
  });
});

app.get("/api/candidates", async (_request, response) => {
  try {
    const candidates = await getAllCandidates();

    response.json(candidates.map(toCandidateDto));
  } catch (error) {
    console.error("Failed to fetch candidates:", error);
    response.status(500).json({ error: "Unable to fetch candidates." });
  }
});

app.get("/api/candidates/:id", async (request, response) => {
  const candidateId = Number.parseInt(request.params.id, 10);

  if (Number.isNaN(candidateId)) {
    response.status(400).json({ error: "Invalid candidate id." });
    return;
  }

  try {
    const candidate = await getCandidateById(candidateId);

    if (!candidate) {
      response.status(404).json({ error: "Candidate not found." });
      return;
    }

    response.json(toCandidateDto(candidate));
  } catch (error) {
    console.error("Failed to fetch candidate details:", error);
    response.status(500).json({ error: "Unable to fetch candidate details." });
  }
});

app.post("/api/candidates/:id/extract", async (request, response) => {
  const candidateId = Number.parseInt(request.params.id, 10);

  if (Number.isNaN(candidateId)) {
    response.status(400).json({ error: "Invalid candidate id." });
    return;
  }

  try {
    const updatedCandidate = await extractCandidateCvData(candidateId);
    response.json(toCandidateDto(updatedCandidate));
  } catch (error) {
    const message = error instanceof Error ? error.message : "Extraction failed.";
    const statusCode = message === "Candidate not found." ? 404 : message.includes("No CV PDF") ? 400 : 500;

    console.error("CV extraction failed:", error);
    response.status(statusCode).json({ error: message });
  }
});

app.post("/api/candidates/upload-scan", upload.single("cv"), async (request, response) => {
  const uploadedFile = request.file;

  if (!uploadedFile) {
    response.status(400).json({ error: "A CV PDF file is required." });
    return;
  }

  const requestedStatus = typeof request.body?.status === "string" ? request.body.status.trim() : "";
  const status = applicationStatuses.includes(requestedStatus) ? requestedStatus : "Applied";
  const requestedRole = typeof request.body?.role === "string" ? request.body.role.trim() : "";
  const requestedNotes = typeof request.body?.notes === "string" ? request.body.notes.trim() : "";

  let parser;

  try {
    const buffer = fs.readFileSync(uploadedFile.path);
    parser = new PDFParse({ data: buffer });
    const parsedPdf = await parser.getText();
    const rawText = (parsedPdf.text || "").trim();

    if (!rawText) {
      throw new Error("PDF text extraction returned empty content. The file may be image-only.");
    }

    const extracted = extractCandidateDataFromCvText(rawText, {
      name: extractNameFromFilename(uploadedFile.originalname),
      role: requestedRole || "Applicant",
      notes: requestedNotes || null
    });
    const portfolio = extractPortfolioHighlights(rawText);

    const candidateName = extracted.name || extractNameFromFilename(uploadedFile.originalname) || "Unnamed Applicant";
    const role = requestedRole || extracted.role || "Applicant";
    const notes = requestedNotes || extracted.summary || "Uploaded CV and scanned automatically.";

    const inserted = await sql`
      INSERT INTO candidates (
        name,
        role,
        status,
        notes,
        cv_filename,
        extraction_status,
        extraction_error,
        extracted_at,
        profile_email,
        profile_phone,
        profile_location,
        profile_summary,
        skills_json,
        experience_json,
        education_json,
        works_json,
        awards_json,
        raw_cv_text
      )
      VALUES (
        ${candidateName},
        ${role},
        ${status},
        ${notes},
        ${uploadedFile.filename},
        'completed',
        NULL,
        NOW(),
        ${extracted.email},
        ${extracted.phone},
        ${extracted.location},
        ${extracted.summary || notes},
        ${JSON.stringify(extracted.skills)}::jsonb,
        ${JSON.stringify(extracted.experience)}::jsonb,
        ${JSON.stringify(extracted.education)}::jsonb,
        ${JSON.stringify(portfolio.works)}::jsonb,
        ${JSON.stringify(portfolio.awards)}::jsonb,
        ${rawText}
      )
      RETURNING id
    `;

    const createdCandidate = await getCandidateById(inserted[0].id);
    response.status(201).json(toCandidateDto(createdCandidate));
  } catch (error) {
    console.error("Failed to upload and scan CV:", error);

    try {
      if (uploadedFile.path && fs.existsSync(uploadedFile.path)) {
        fs.unlinkSync(uploadedFile.path);
      }
    } catch (_unlinkError) {
    }

    const message = error instanceof Error ? error.message : "Unable to upload and scan CV.";
    response.status(400).json({ error: message });
  } finally {
    if (parser) {
      try {
        await parser.destroy();
      } catch (_error) {
      }
    }
  }
});

app.put("/api/candidates/:id/extracted-data", async (request, response) => {
  const candidateId = Number.parseInt(request.params.id, 10);

  if (Number.isNaN(candidateId)) {
    response.status(400).json({ error: "Invalid candidate id." });
    return;
  }

  const candidate = await getCandidateById(candidateId);

  if (!candidate) {
    response.status(404).json({ error: "Candidate not found." });
    return;
  }

  const payload = request.body || {};
  const profile = payload.profile || {};

  const skills = Array.isArray(payload.skills) ? payload.skills : [];
  const experience = Array.isArray(payload.experience) ? payload.experience : [];
  const education = Array.isArray(payload.education) ? payload.education : [];
  const works = Array.isArray(payload.works) ? payload.works : [];
  const awards = Array.isArray(payload.awards) ? payload.awards : [];

  try {
    await sql`
      UPDATE candidates
      SET
        extraction_status = 'completed',
        extraction_error = NULL,
        extracted_at = COALESCE(extracted_at, NOW()),
        profile_email = ${profile.email || null},
        profile_phone = ${profile.phone || null},
        profile_location = ${profile.location || null},
        profile_summary = ${profile.summary || null},
        skills_json = ${JSON.stringify(skills)}::jsonb,
        experience_json = ${JSON.stringify(experience)}::jsonb,
        education_json = ${JSON.stringify(education)}::jsonb,
        works_json = ${JSON.stringify(works)}::jsonb,
        awards_json = ${JSON.stringify(awards)}::jsonb
      WHERE id = ${candidateId}
    `;

    const updatedCandidate = await getCandidateById(candidateId);
    response.json(toCandidateDto(updatedCandidate));
  } catch (error) {
    console.error("Failed to update extracted candidate data:", error);
    response.status(500).json({ error: "Unable to update extracted candidate data." });
  }
});

app.get("/api/candidates/available", async (_request, response) => {
  try {
    const candidates = await getAllCandidates();
    const availableCandidates = candidates
      .filter((candidate) => availableStatuses.has(candidate.status))
      .map(toCandidateDto);

    response.json(availableCandidates);
  } catch (error) {
    console.error("Failed to fetch available candidates:", error);
    response.status(500).json({ error: "Unable to fetch available candidates." });
  }
});

app.get("/api/candidates/available/cv.pdf", async (_request, response) => {
  try {
    const candidates = await getAllCandidates();
    const availableCandidates = candidates.filter((candidate) => availableStatuses.has(candidate.status));

    if (!availableCandidates.length) {
      response.status(404).json({ error: "No available candidates found." });
      return;
    }

    response.setHeader("Content-Type", "application/pdf");
    response.setHeader("Content-Disposition", 'attachment; filename="available-applicants-cv.pdf"');

    const document = new PDFDocument({ margin: 48, size: "A4" });
    document.pipe(response);

    writeCvDocumentHeader(document, "Available Applicants CV Packet");

    availableCandidates.forEach((candidate, index) => {
      writeCandidateCv(document, candidate);

      if (index < availableCandidates.length - 1) {
        document.addPage();
      }
    });

    document.end();
  } catch (error) {
    console.error("Failed to generate available candidate CV PDF:", error);
    response.status(500).json({ error: "Unable to generate candidate CV PDF." });
  }
});

async function startServer() {
  try {
    await ensureCandidateColumnsAndSync();
    await runAutoExtractionPass();

    const autoExtractionTimer = setInterval(() => {
      runAutoExtractionPass();
    }, autoExtractionIntervalMs);

    autoExtractionTimer.unref?.();
  } catch (error) {
    console.error("Failed to initialize CV metadata:", error);
  }

  app.listen(port, () => {
    console.log(`ATS server running at http://localhost:${port}`);
  });
}

startServer();
