import { sql } from "../../../db.js";

const JOB_STATUSES = new Set(["draft", "published", "closed"]);
const QUESTION_INPUT_TYPES = new Set(["text", "textarea", "number", "boolean"]);

function normalizeJobStatus(status) {
  const value = typeof status === "string" ? status.trim().toLowerCase() : "";
  return JOB_STATUSES.has(value) ? value : "draft";
}

function normalizeQuestionInputType(inputType) {
  const value = typeof inputType === "string" ? inputType.trim().toLowerCase() : "";
  return QUESTION_INPUT_TYPES.has(value) ? value : "text";
}

export function sanitizeJobPayload(payload = {}) {
  return {
    title: (payload.title ?? "").toString().trim(),
    intro: (payload.intro ?? "").toString().trim() || null,
    requiredQualifications: (payload.requiredQualifications ?? "").toString().trim() || null,
    recommendedQualifications: (payload.recommendedQualifications ?? "").toString().trim() || null,
    description: (payload.description ?? "").toString().trim() || null,
    employmentType: (payload.employmentType ?? "").toString().trim() || null,
    location: (payload.location ?? "").toString().trim() || null,
    status: normalizeJobStatus(payload.status)
  };
}

export function sanitizeQuestionsPayload(payload) {
  if (!Array.isArray(payload)) {
    return [];
  }

  return payload
    .map((item, index) => ({
      prompt: (item?.prompt ?? "").toString().trim(),
      inputType: normalizeQuestionInputType(item?.inputType),
      isRequired: Boolean(item?.isRequired),
      displayOrder: Number.isInteger(item?.displayOrder) ? item.displayOrder : index
    }))
    .filter((item) => item.prompt);
}

export async function getAllJobsForBackoffice() {
  const rows = await sql`
    SELECT
      j.id,
      j.title,
      j.intro,
      j.required_qualifications,
      j.recommended_qualifications,
      j.description,
      j.employment_type,
      j.location,
      j.status,
      j.created_by_user_id,
      j.created_at,
      j.updated_at,
      COUNT(q.id)::int AS question_count
    FROM jobs j
    LEFT JOIN job_questions q ON q.job_id = j.id
    GROUP BY j.id
    ORDER BY j.updated_at DESC, j.id DESC
  `;

  return rows;
}

export async function getPublishedJobs() {
  const rows = await sql`
    SELECT
      id,
      title,
      intro,
      required_qualifications,
      recommended_qualifications,
      description,
      employment_type,
      location,
      status,
      created_at,
      updated_at
    FROM jobs
    WHERE status = 'published'
    ORDER BY updated_at DESC, id DESC
  `;

  return rows;
}

export async function getJobById(jobId) {
  const rows = await sql`
    SELECT
      id,
      title,
      intro,
      required_qualifications,
      recommended_qualifications,
      description,
      employment_type,
      location,
      status,
      created_by_user_id,
      created_at,
      updated_at
    FROM jobs
    WHERE id = ${jobId}
    LIMIT 1
  `;

  return rows[0] ?? null;
}

export async function getJobQuestions(jobId) {
  return await sql`
    SELECT id, job_id, prompt, input_type, is_required, display_order, created_at
    FROM job_questions
    WHERE job_id = ${jobId}
    ORDER BY display_order ASC, id ASC
  `;
}

export async function createJob(job, createdByUserId) {
  const rows = await sql`
    INSERT INTO jobs (
      title,
      intro,
      required_qualifications,
      recommended_qualifications,
      description,
      employment_type,
      location,
      status,
      created_by_user_id,
      updated_at
    )
    VALUES (
      ${job.title},
      ${job.intro},
      ${job.requiredQualifications},
      ${job.recommendedQualifications},
      ${job.description},
      ${job.employmentType},
      ${job.location},
      ${job.status},
      ${createdByUserId},
      NOW()
    )
    RETURNING id
  `;

  return rows[0]?.id ?? null;
}

export async function updateJob(jobId, job) {
  const rows = await sql`
    UPDATE jobs
    SET
      title = ${job.title},
      intro = ${job.intro},
      required_qualifications = ${job.requiredQualifications},
      recommended_qualifications = ${job.recommendedQualifications},
      description = ${job.description},
      employment_type = ${job.employmentType},
      location = ${job.location},
      status = ${job.status},
      updated_at = NOW()
    WHERE id = ${jobId}
    RETURNING id
  `;

  return rows[0]?.id ?? null;
}

export async function replaceJobQuestions(jobId, questions) {
  await sql`DELETE FROM job_questions WHERE job_id = ${jobId}`;

  for (const question of questions) {
    await sql`
      INSERT INTO job_questions (
        job_id,
        prompt,
        input_type,
        is_required,
        display_order
      )
      VALUES (
        ${jobId},
        ${question.prompt},
        ${question.inputType},
        ${question.isRequired},
        ${question.displayOrder}
      )
    `;
  }
}

export function toJobDto(job, questions = []) {
  if (!job) return null;

  return {
    id: job.id,
    title: job.title,
    intro: job.intro,
    requiredQualifications: job.required_qualifications,
    recommendedQualifications: job.recommended_qualifications,
    description: job.description,
    employmentType: job.employment_type,
    location: job.location,
    status: job.status,
    createdByUserId: job.created_by_user_id,
    createdAt: job.created_at,
    updatedAt: job.updated_at,
    questionCount: typeof job.question_count === "number" ? job.question_count : questions.length,
    questions: questions.map((item) => ({
      id: item.id,
      prompt: item.prompt,
      inputType: item.input_type,
      isRequired: item.is_required,
      displayOrder: item.display_order,
      createdAt: item.created_at
    }))
  };
}
