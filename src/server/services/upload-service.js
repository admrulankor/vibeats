import fs from "node:fs";
import path from "node:path";
import { randomUUID } from "node:crypto";
import { PDFParse } from "pdf-parse";
import { applicationStatuses, directories, maxUploadBytes } from "../config/app-config.js";
import { sql, getCandidateById } from "../data/candidates-repository.js";
import { extractPortfolioHighlights } from "../parsers/portfolio-parser.js";
import { extractCandidateDataFromCvText, extractNameFromFilename } from "./cv-parser.js";
import { toCandidateDto } from "./candidate-transformer.js";
import { jsonResponse } from "../utils/http.js";

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

export async function handleUploadScan(request) {
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

    fs.mkdirSync(directories.uploads, { recursive: true });

    const filename = sanitizeUploadFilename(originalname);
    const filePath = path.join(directories.uploads, filename);
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
        ${extracted.skills}::jsonb,
        ${extracted.experience}::jsonb,
        ${extracted.education}::jsonb,
        ${portfolio.works}::jsonb,
        ${portfolio.awards}::jsonb,
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
