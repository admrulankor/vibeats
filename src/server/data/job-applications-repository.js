import { sql } from "../../../db.js";

export async function createJobApplication({ jobId, applicantUserId, candidateId, status, notes }) {
  const rows = await sql`
    INSERT INTO job_applications (
      job_id,
      applicant_user_id,
      candidate_id,
      status,
      notes,
      updated_at
    )
    VALUES (
      ${jobId},
      ${applicantUserId},
      ${candidateId},
      ${status},
      ${notes || null},
      NOW()
    )
    RETURNING id
  `;

  return rows[0]?.id ?? null;
}

export async function replaceApplicationAnswers(jobApplicationId, answers) {
  await sql`DELETE FROM job_application_answers WHERE job_application_id = ${jobApplicationId}`;

  for (const answer of answers) {
    await sql`
      INSERT INTO job_application_answers (
        job_application_id,
        job_question_id,
        prompt,
        answer_text,
        display_order
      )
      VALUES (
        ${jobApplicationId},
        ${answer.jobQuestionId || null},
        ${answer.prompt},
        ${answer.answerText || null},
        ${answer.displayOrder}
      )
    `;
  }
}

export async function addApplicationStatusEvent({
  jobApplicationId,
  fromStatus,
  toStatus,
  actorUserId,
  actorApplicantId
}) {
  await sql`
    INSERT INTO job_application_status_events (
      job_application_id,
      from_status,
      to_status,
      actor_user_id,
      actor_applicant_id
    )
    VALUES (
      ${jobApplicationId},
      ${fromStatus || null},
      ${toStatus},
      ${actorUserId || null},
      ${actorApplicantId || null}
    )
  `;
}

export async function getApplicationsByApplicant(applicantUserId) {
  return await sql`
    SELECT
      ja.id,
      ja.job_id,
      ja.applicant_user_id,
      ja.candidate_id,
      ja.status,
      ja.notes,
      ja.created_at,
      ja.updated_at,
      j.title AS job_title,
      j.status AS job_status
    FROM job_applications ja
    JOIN jobs j ON j.id = ja.job_id
    WHERE ja.applicant_user_id = ${applicantUserId}
    ORDER BY ja.created_at DESC, ja.id DESC
  `;
}

export async function getAllApplicationsForBackoffice() {
  return await sql`
    SELECT
      ja.id,
      ja.job_id,
      ja.applicant_user_id,
      ja.candidate_id,
      ja.status,
      ja.notes,
      ja.created_at,
      ja.updated_at,
      j.title AS job_title,
      j.status AS job_status,
      au.name AS applicant_name,
      au.email AS applicant_email
    FROM job_applications ja
    JOIN jobs j ON j.id = ja.job_id
    JOIN applicant_users au ON au.id = ja.applicant_user_id
    ORDER BY ja.updated_at DESC, ja.id DESC
  `;
}

export async function getJobApplicationById(applicationId) {
  const rows = await sql`
    SELECT
      ja.id,
      ja.job_id,
      ja.applicant_user_id,
      ja.candidate_id,
      ja.status,
      ja.notes,
      ja.created_at,
      ja.updated_at,
      j.title AS job_title,
      j.status AS job_status,
      au.name AS applicant_name,
      au.email AS applicant_email,
      au.phone AS applicant_phone,
      au.location AS applicant_location
    FROM job_applications ja
    JOIN jobs j ON j.id = ja.job_id
    JOIN applicant_users au ON au.id = ja.applicant_user_id
    WHERE ja.id = ${applicationId}
    LIMIT 1
  `;

  return rows[0] ?? null;
}

export async function getAnswersForApplication(applicationId) {
  return await sql`
    SELECT
      id,
      job_application_id,
      job_question_id,
      prompt,
      answer_text,
      display_order,
      created_at
    FROM job_application_answers
    WHERE job_application_id = ${applicationId}
    ORDER BY display_order ASC, id ASC
  `;
}

export async function getStatusEventsForApplication(applicationId) {
  return await sql`
    SELECT
      id,
      job_application_id,
      from_status,
      to_status,
      actor_user_id,
      actor_applicant_id,
      created_at
    FROM job_application_status_events
    WHERE job_application_id = ${applicationId}
    ORDER BY created_at ASC, id ASC
  `;
}

export async function updateJobApplicationStatus(applicationId, status) {
  const rows = await sql`
    UPDATE job_applications
    SET status = ${status}, updated_at = NOW()
    WHERE id = ${applicationId}
    RETURNING id, status, candidate_id
  `;

  return rows[0] ?? null;
}

export async function getStatusEventsForApplications(applicationIds) {
  if (!applicationIds.length) {
    return [];
  }

  const events = [];

  for (const applicationId of applicationIds) {
    const rows = await sql`
      SELECT
        id,
        job_application_id,
        from_status,
        to_status,
        actor_user_id,
        actor_applicant_id,
        created_at
      FROM job_application_status_events
      WHERE job_application_id = ${applicationId}
      ORDER BY created_at ASC, id ASC
    `;

    events.push(...rows);
  }

  events.sort((a, b) => {
    const dateDiff = new Date(a.created_at).getTime() - new Date(b.created_at).getTime();
    if (dateDiff !== 0) {
      return dateDiff;
    }

    return a.id - b.id;
  });

  return events;
}
