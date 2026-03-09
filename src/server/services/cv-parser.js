import path from "node:path";
import { headingLabels } from "../config/app-config.js";
import { escapeRegExp, uniqueStrings, toTitleCaseName } from "../utils/string.js";

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

function extractEmail(text) {
  const match = text.match(/[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}/i);
  return match ? match[0] : null;
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

export function extractNameFromFilename(filename) {
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

    if (!current || !next || /^●/.test(current)) {
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

export function extractCandidateDataFromCvText(text, candidate) {
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
