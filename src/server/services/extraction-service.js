import fs from "node:fs";
import { PDFParse } from "pdf-parse";
import {
  getCandidateById,
  getCandidatesForExtractionPass,
  sql
} from "../data/candidates-repository.js";
import { getCvAbsolutePath, getCvFilenameForCandidateName } from "../fs/cv-paths.js";
import { extractPortfolioHighlights } from "../parsers/portfolio-parser.js";
import { extractCandidateDataFromCvText } from "./cv-parser.js";

let autoExtractionPassRunning = false;

export async function extractCandidateCvData(candidateId) {
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

export async function runAutoExtractionPass() {
  if (autoExtractionPassRunning) {
    return;
  }

  autoExtractionPassRunning = true;

  try {
    const candidates = await getCandidatesForExtractionPass();

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
