import fs from "node:fs";
import path from "node:path";
import { randomUUID } from "node:crypto";
import { fileURLToPath } from "node:url";
import YAML from "yaml";
import PDFDocument from "pdfkit";
import { PDFParse } from "pdf-parse";
import ejs from "ejs";
import { sql } from "./db.js";

const port = Number(Bun.env.PORT || 3000);

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
const publicDirectory = path.join(__dirname, "public");
const assetsDirectory = path.join(__dirname, "assets");
const viewsDirectory = path.join(__dirname, "views");
const autoExtractionIntervalMs = Number(Bun.env.CV_AUTO_EXTRACT_INTERVAL_MS || 30000);
let autoExtractionPassRunning = false;
const maxJsonBodyBytes = 1024 * 1024;
const maxUploadBytes = 8 * 1024 * 1024;
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
function jsonResponse(payload, status = 200, headers = {}) {
  return new Response(JSON.stringify(payload), {
    status,
    headers: {
      "Content-Type": "application/json; charset=utf-8",
      ...headers
    }
  });
}

function textResponse(body, status = 200, headers = {}) {
  return new Response(body, {
    status,
    headers: {
      "Content-Type": "text/plain; charset=utf-8",
      ...headers
    }
  });
}

function createHttpError(status, message) {
  const error = new Error(message);
  error.status = status;
  return error;
}

function safeStaticPath(rootDirectory, incomingPath) {
  const relativePath = incomingPath.replace(/^[/\\]+/, "");
  const resolvedRoot = path.resolve(rootDirectory);
  const resolvedPath = path.resolve(rootDirectory, relativePath);

  if (resolvedPath === resolvedRoot || resolvedPath.startsWith(`${resolvedRoot}${path.sep}`)) {
    return resolvedPath;
  }

  return null;
}

async function maybeServeFile(filePath) {
  if (!filePath || !fs.existsSync(filePath)) {
    return null;
  }

  const stats = fs.statSync(filePath);

  if (!stats.isFile()) {
    return null;
  }

  return new Response(Bun.file(filePath));
}

function renderView(viewName, data) {
  return new Promise((resolve, reject) => {
    ejs.renderFile(path.join(viewsDirectory, `${viewName}.ejs`), data, (error, html) => {
      if (error) {
        reject(error);
        return;
      }

      resolve(
        new Response(html, {
          headers: {
            "Content-Type": "text/html; charset=utf-8"
          }
        })
      );
    });
  });
}

function parseIdSegment(pathname, prefix, suffix = "") {
  const escapedPrefix = prefix.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const escapedSuffix = suffix.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const matcher = new RegExp(`^${escapedPrefix}([^/]+)${escapedSuffix}$`);
  const match = pathname.match(matcher);

  if (!match) {
    return null;
  }

  const candidateId = Number.parseInt(match[1], 10);

  return Number.isNaN(candidateId)
    ? {
        invalid: true
      }
    : {
        value: candidateId
      };
}

async function parseJsonBody(request) {
  const contentLength = Number(request.headers.get("content-length") || "0");

  if (contentLength > maxJsonBodyBytes) {
    throw createHttpError(413, "JSON payload is too large.");
  }

  const rawBody = await request.text();

  if (Buffer.byteLength(rawBody, "utf8") > maxJsonBodyBytes) {
    throw createHttpError(413, "JSON payload is too large.");
  }

  if (!rawBody.trim()) {
    return {};
  }

  try {
    return JSON.parse(rawBody);
  } catch (_error) {
    throw createHttpError(400, "Invalid JSON payload.");
  }
}

function sanitizeUploadFilename(originalname) {
  const extension = path.extname(originalname || "").toLowerCase() || ".pdf";
  const baseName = path.basename(originalname || "cv", extension);
  const sanitizedBase = baseName
    .replace(/[^A-Za-z0-9\-_.\s]/g, "")
    .trim()
    .replace(/\s+/g, "-")
    .slice(0, 60) || "cv";

  return `${Date.now()}-${randomUUID()}-${sanitizedBase}${extension}`;
}

function getStringFormField(formData, key) {
  const value = formData.get(key);

  return typeof value === "string" ? value.trim() : "";
}

async function handleUploadScan(request) {
  let parser;
  let uploadedFilePath;

  try {
    const formData = await request.formData();
    const cv = formData.get("cv");

    if (!(cv instanceof File)) {
      return jsonResponse({ error: "A CV PDF file is required." }, 400);
    }

    const originalname = cv.name || "cv.pdf";
    const isPdfMime = cv.type === "application/pdf";
    const isPdfName = /\.pdf$/i.test(originalname);

    if (!isPdfMime && !isPdfName) {
      return jsonResponse({ error: "Only PDF files are supported." }, 400);
    }

    if (cv.size > maxUploadBytes) {
      return jsonResponse({ error: "File is too large. Maximum allowed size is 8MB." }, 400);
    }

    fs.mkdirSync(uploadsDirectory, { recursive: true });

    const filename = sanitizeUploadFilename(originalname);
    const filePath = path.join(uploadsDirectory, filename);
    const buffer = Buffer.from(await cv.arrayBuffer());

    uploadedFilePath = filePath;
    await Bun.write(filePath, buffer);

    const requestedStatus = getStringFormField(formData, "status");
    const status = applicationStatuses.includes(requestedStatus) ? requestedStatus : "Applied";
    const requestedRole = getStringFormField(formData, "role");
    const requestedNotes = getStringFormField(formData, "notes");

    parser = new PDFParse({ data: buffer });
    const parsedPdf = await parser.getText();
    const rawText = (parsedPdf.text || "").trim();

    if (!rawText) {
      throw new Error("PDF text extraction returned empty content. The file may be image-only.");
    }

    const extracted = extractCandidateDataFromCvText(rawText, {
      name: extractNameFromFilename(originalname),
      role: requestedRole || "Applicant",
      notes: requestedNotes || null
    });
    const portfolio = extractPortfolioHighlights(rawText);

    const candidateName = extracted.name || extractNameFromFilename(originalname) || "Unnamed Applicant";
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
        ${filename},
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
    return jsonResponse(toCandidateDto(createdCandidate), 201);
  } catch (error) {
    console.error("Failed to upload and scan CV:", error);

    try {
      if (uploadedFilePath && fs.existsSync(uploadedFilePath)) {
        fs.unlinkSync(uploadedFilePath);
      }
    } catch (_unlinkError) {
    }

    const message = error instanceof Error ? error.message : "Unable to upload and scan CV.";
    return jsonResponse({ error: message }, 400);
  } finally {
    if (parser) {
      try {
        await parser.destroy();
      } catch (_error) {
      }
    }
  }
}

function buildAvailableCandidatesPdf(candidates) {
  return new Promise((resolve, reject) => {
    const document = new PDFDocument({ margin: 48, size: "A4" });
    const chunks = [];

    document.on("data", (chunk) => {
      chunks.push(Buffer.from(chunk));
    });

    document.on("end", () => {
      resolve(Buffer.concat(chunks));
    });

    document.on("error", reject);

    writeCvDocumentHeader(document, "Available Applicants CV Packet");

    candidates.forEach((candidate, index) => {
      writeCandidateCv(document, candidate);

      if (index < candidates.length - 1) {
        document.addPage();
      }
    });

    document.end();
  });
}

async function handleRequest(request) {
  const url = new URL(request.url);
  const pathname = decodeURIComponent(url.pathname);
  const method = request.method.toUpperCase();

  if (method === "GET" && pathname === "/") {
    return renderView("index", {
      title: appConfig.companyName,
      companyName: appConfig.companyName,
      companySubtitle: appConfig.companySubtitle
    });
  }

  if (method === "GET" && pathname === "/applicants/new") {
    return renderView("new-applicant", {
      title: `${appConfig.companyName} · Add Applicant`,
      companyName: appConfig.companyName,
      companySubtitle: appConfig.companySubtitle
    });
  }

  const candidatePageMatch = parseIdSegment(pathname, "/candidates/");

  if (method === "GET" && candidatePageMatch) {
    if (candidatePageMatch.invalid) {
      return textResponse("Invalid candidate id.", 400);
    }

    return renderView("candidate", {
      title: `${appConfig.companyName} · Candidate`,
      companyName: appConfig.companyName,
      companySubtitle: appConfig.companySubtitle,
      candidateId: candidatePageMatch.value
    });
  }

  if (method === "GET" && pathname === "/api/candidates") {
    try {
      const candidates = await getAllCandidates();
      return jsonResponse(candidates.map(toCandidateDto));
    } catch (error) {
      console.error("Failed to fetch candidates:", error);
      return jsonResponse({ error: "Unable to fetch candidates." }, 500);
    }
  }

  if (method === "GET" && pathname === "/api/candidates/available") {
    try {
      const candidates = await getAllCandidates();
      const availableCandidates = candidates.filter((candidate) => availableStatuses.has(candidate.status)).map(toCandidateDto);
      return jsonResponse(availableCandidates);
    } catch (error) {
      console.error("Failed to fetch available candidates:", error);
      return jsonResponse({ error: "Unable to fetch available candidates." }, 500);
    }
  }

  if (method === "GET" && pathname === "/api/candidates/available/cv.pdf") {
    try {
      const candidates = await getAllCandidates();
      const availableCandidates = candidates.filter((candidate) => availableStatuses.has(candidate.status));

      if (!availableCandidates.length) {
        return jsonResponse({ error: "No available candidates found." }, 404);
      }

      const pdfBuffer = await buildAvailableCandidatesPdf(availableCandidates);
      return new Response(pdfBuffer, {
        headers: {
          "Content-Type": "application/pdf",
          "Content-Disposition": 'attachment; filename="available-applicants-cv.pdf"'
        }
      });
    } catch (error) {
      console.error("Failed to generate available candidate CV PDF:", error);
      return jsonResponse({ error: "Unable to generate candidate CV PDF." }, 500);
    }
  }

  const apiCandidateMatch = parseIdSegment(pathname, "/api/candidates/");

  if (method === "GET" && apiCandidateMatch) {
    if (apiCandidateMatch.invalid) {
      return jsonResponse({ error: "Invalid candidate id." }, 400);
    }

    try {
      const candidate = await getCandidateById(apiCandidateMatch.value);

      if (!candidate) {
        return jsonResponse({ error: "Candidate not found." }, 404);
      }

      return jsonResponse(toCandidateDto(candidate));
    } catch (error) {
      console.error("Failed to fetch candidate details:", error);
      return jsonResponse({ error: "Unable to fetch candidate details." }, 500);
    }
  }

  const extractMatch = parseIdSegment(pathname, "/api/candidates/", "/extract");

  if (method === "POST" && extractMatch) {
    if (extractMatch.invalid) {
      return jsonResponse({ error: "Invalid candidate id." }, 400);
    }

    try {
      const updatedCandidate = await extractCandidateCvData(extractMatch.value);
      return jsonResponse(toCandidateDto(updatedCandidate));
    } catch (error) {
      const message = error instanceof Error ? error.message : "Extraction failed.";
      const statusCode = message === "Candidate not found." ? 404 : message.includes("No CV PDF") ? 400 : 500;

      console.error("CV extraction failed:", error);
      return jsonResponse({ error: message }, statusCode);
    }
  }

  if (method === "POST" && pathname === "/api/candidates/upload-scan") {
    return handleUploadScan(request);
  }

  const extractedDataMatch = parseIdSegment(pathname, "/api/candidates/", "/extracted-data");

  if (method === "PUT" && extractedDataMatch) {
    if (extractedDataMatch.invalid) {
      return jsonResponse({ error: "Invalid candidate id." }, 400);
    }

    try {
      const payload = await parseJsonBody(request);
      const candidateId = extractedDataMatch.value;
      const candidate = await getCandidateById(candidateId);

      if (!candidate) {
        return jsonResponse({ error: "Candidate not found." }, 404);
      }

      const profile = payload.profile || {};
      const skills = Array.isArray(payload.skills) ? payload.skills : [];
      const experience = Array.isArray(payload.experience) ? payload.experience : [];
      const education = Array.isArray(payload.education) ? payload.education : [];
      const works = Array.isArray(payload.works) ? payload.works : [];
      const awards = Array.isArray(payload.awards) ? payload.awards : [];

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
      return jsonResponse(toCandidateDto(updatedCandidate));
    } catch (error) {
      if (error?.status) {
        return jsonResponse({ error: error.message }, error.status);
      }

      console.error("Failed to update extracted candidate data:", error);
      return jsonResponse({ error: "Unable to update extracted candidate data." }, 500);
    }
  }

  if (pathname.startsWith("/assets/")) {
    const assetPath = safeStaticPath(assetsDirectory, pathname.slice("/assets/".length));
    const assetResponse = await maybeServeFile(assetPath);

    if (assetResponse) {
      return assetResponse;
    }
  }

  if (method === "GET") {
    const filePath = safeStaticPath(publicDirectory, pathname);
    const fileResponse = await maybeServeFile(filePath);

    if (fileResponse) {
      return fileResponse;
    }
  }

  return jsonResponse({ error: "Not found." }, 404);
}

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

startServer();
