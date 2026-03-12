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

export function validatePdfMetadata(filename, mimeType) {
  const isPdfMime = mimeType === "application/pdf";
  const isPdfName = /\.pdf$/i.test(filename || "");

  if (!isPdfMime && !isPdfName) {
    throw new Error("Only PDF files are supported.");
  }
}

export async function storeUploadedCvFile(cvFile) {
  if (!(cvFile instanceof File)) {
    throw new Error("A CV PDF file is required.");
  }

  const originalname = cvFile.name || "cv.pdf";
  validatePdfMetadata(originalname, cvFile.type);

  if (cvFile.size > maxUploadBytes) {
    throw new Error("File is too large. Maximum allowed size is 8MB.");
  }

  fs.mkdirSync(directories.uploads, { recursive: true });

  const filename = sanitizeUploadFilename(originalname);
  const filePath = path.join(directories.uploads, filename);
  const buffer = Buffer.from(await cvFile.arrayBuffer());

  await Bun.write(filePath, buffer);

  return {
    filename,
    filePath,
    originalname,
    buffer
  };
}

export async function createCandidateFromCvPayload({
  buffer,
  originalname,
  filename,
  requestedStatus,
  requestedRole,
  requestedNotes
}) {
  let parser;

  try {
    const status = applicationStatuses.includes(requestedStatus) ? requestedStatus : "Applied";

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
    return createdCandidate;
  } finally {
    if (parser) {
      try {
        await parser.destroy();
      } catch (_error) {
      }
    }
  }
}

export async function handleUploadScan(request) {
  let uploadedFilePath;

  try {
    const formData = await request.formData();
    const cv = formData.get("cv");

    const storedCv = await storeUploadedCvFile(cv);
    uploadedFilePath = storedCv.filePath;

    const requestedStatus = getStringFormField(formData, "status");
    const requestedRole = getStringFormField(formData, "role");
    const requestedNotes = getStringFormField(formData, "notes");

    const createdCandidate = await createCandidateFromCvPayload({
      buffer: storedCv.buffer,
      originalname: storedCv.originalname,
      filename: storedCv.filename,
      requestedStatus,
      requestedRole,
      requestedNotes
    });

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
  }
}
