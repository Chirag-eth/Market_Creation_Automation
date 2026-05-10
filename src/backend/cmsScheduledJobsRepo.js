// cmsScheduledJobsRepo.js
//
// Pure DB layer for cms_scheduled_jobs. Every function takes a `pool` (or a
// `client` for transactional callers) so the worker and route handlers don't
// share state — and so unit tests can pass a fake `{ query }` shaped object.
//
// Schema: see sql/cms_002_scheduled_jobs.sql.
//
// Status state machine:
//   pending ──claim──▶ in_flight ──ok──▶ completed
//                                  └fail▶ failed
//   pending ──cancel──▶ cancelled
//   pending ──reschedule──▶ pending (with new scheduled_at)
// in_flight, completed, failed, cancelled are terminal from the repo's view —
// callers must not transition out of them.

import { randomUUID } from "node:crypto";

const VALID_STATUSES = new Set(["pending", "in_flight", "completed", "failed", "cancelled"]);

function rowToJob(row) {
  if (!row) return null;
  return {
    job_id: String(row.job_id),
    environment: String(row.environment),
    status: String(row.status),
    scheduled_at:
      row.scheduled_at instanceof Date ? row.scheduled_at.toISOString() : String(row.scheduled_at),
    payload: row.payload_json || null,
    request_id: row.request_id ? String(row.request_id) : null,
    created_by: row.created_by ? String(row.created_by) : null,
    created_at:
      row.created_at instanceof Date ? row.created_at.toISOString() : String(row.created_at),
    attempts: Number(row.attempts || 0),
    started_at:
      row.started_at instanceof Date ? row.started_at.toISOString() : row.started_at || null,
    completed_at:
      row.completed_at instanceof Date ? row.completed_at.toISOString() : row.completed_at || null,
    cancelled_at:
      row.cancelled_at instanceof Date ? row.cancelled_at.toISOString() : row.cancelled_at || null,
    run_id: row.run_id ? String(row.run_id) : null,
    last_error: row.last_error ? String(row.last_error) : null,
  };
}

export async function insertScheduledJob(
  pool,
  { environment, scheduledAt, payload, requestId = null, createdBy = null } = {}
) {
  if (!pool) throw new Error("insertScheduledJob: pool required");
  if (!environment) throw new Error("insertScheduledJob: environment required");
  if (!scheduledAt) throw new Error("insertScheduledJob: scheduledAt required");
  if (!payload || typeof payload !== "object") {
    throw new Error("insertScheduledJob: payload object required");
  }

  const jobId = randomUUID();
  const result = await pool.query(
    `INSERT INTO cms_scheduled_jobs
       (job_id, environment, status, scheduled_at, payload_json, request_id, created_by)
     VALUES ($1, $2, 'pending', $3::timestamptz, $4::jsonb, $5, $6)
     RETURNING *`,
    [jobId, environment, toIso(scheduledAt), JSON.stringify(payload), requestId, createdBy]
  );
  return rowToJob(result.rows[0]);
}

export async function getScheduledJob(pool, jobId) {
  if (!pool) throw new Error("getScheduledJob: pool required");
  if (!jobId) return null;
  const result = await pool.query(`SELECT * FROM cms_scheduled_jobs WHERE job_id = $1`, [jobId]);
  return rowToJob(result.rows[0] || null);
}

export async function listScheduledJobs(
  pool,
  { environment = null, status = null, limit = 100 } = {}
) {
  if (!pool) throw new Error("listScheduledJobs: pool required");
  const filters = [];
  const params = [];
  if (environment) {
    params.push(environment);
    filters.push(`environment = $${params.length}`);
  }
  if (status) {
    if (!VALID_STATUSES.has(status)) {
      throw new Error(`listScheduledJobs: invalid status "${status}"`);
    }
    params.push(status);
    filters.push(`status = $${params.length}`);
  }
  params.push(Math.min(Math.max(1, Number(limit) || 100), 500));
  const where = filters.length ? `WHERE ${filters.join(" AND ")}` : "";
  const result = await pool.query(
    `SELECT * FROM cms_scheduled_jobs ${where}
     ORDER BY scheduled_at DESC
     LIMIT $${params.length}`,
    params
  );
  return result.rows.map(rowToJob);
}

/**
 * Atomically claim up to `limit` pending jobs whose scheduled_at <= now and
 * environment matches. Each claimed job is transitioned to 'in_flight' and its
 * attempts counter is incremented. Uses FOR UPDATE SKIP LOCKED so concurrent
 * workers (or restart races) cannot double-fire the same job.
 *
 * Caller MUST eventually call markCompleted / markFailed for every claimed job.
 */
export async function claimDueJobs(pool, { environment, now = new Date(), limit = 5 } = {}) {
  if (!pool) throw new Error("claimDueJobs: pool required");
  if (!environment) throw new Error("claimDueJobs: environment required");
  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    const due = await client.query(
      `SELECT * FROM cms_scheduled_jobs
       WHERE status = 'pending'
         AND environment = $1
         AND scheduled_at <= $2::timestamptz
       ORDER BY scheduled_at
       LIMIT $3
       FOR UPDATE SKIP LOCKED`,
      [environment, toIso(now), Math.min(Math.max(1, Number(limit) || 5), 50)]
    );
    if (due.rows.length === 0) {
      await client.query("COMMIT");
      return [];
    }
    const ids = due.rows.map((r) => r.job_id);
    await client.query(
      `UPDATE cms_scheduled_jobs
         SET status = 'in_flight',
             started_at = NOW(),
             attempts = attempts + 1
       WHERE job_id = ANY($1::uuid[])`,
      [ids]
    );
    await client.query("COMMIT");
    return due.rows.map((r) =>
      rowToJob({
        ...r,
        status: "in_flight",
        started_at: new Date(),
        attempts: Number(r.attempts || 0) + 1,
      })
    );
  } catch (err) {
    try {
      await client.query("ROLLBACK");
    } catch {
      // ignore
    }
    throw err;
  } finally {
    client.release();
  }
}

export async function markCompleted(pool, jobId, { runId = null } = {}) {
  if (!pool) throw new Error("markCompleted: pool required");
  if (!jobId) throw new Error("markCompleted: jobId required");
  const result = await pool.query(
    `UPDATE cms_scheduled_jobs
        SET status = 'completed',
            completed_at = NOW(),
            run_id = $2,
            last_error = NULL
      WHERE job_id = $1 AND status = 'in_flight'
      RETURNING *`,
    [jobId, runId]
  );
  return rowToJob(result.rows[0] || null);
}

export async function markFailed(pool, jobId, { error = "", runId = null } = {}) {
  if (!pool) throw new Error("markFailed: pool required");
  if (!jobId) throw new Error("markFailed: jobId required");
  const result = await pool.query(
    `UPDATE cms_scheduled_jobs
        SET status = 'failed',
            completed_at = NOW(),
            run_id = COALESCE($3, run_id),
            last_error = $2
      WHERE job_id = $1 AND status = 'in_flight'
      RETURNING *`,
    [jobId, String(error || "").slice(0, 4000), runId]
  );
  return rowToJob(result.rows[0] || null);
}

export async function cancelJob(pool, jobId) {
  if (!pool) throw new Error("cancelJob: pool required");
  if (!jobId) throw new Error("cancelJob: jobId required");
  const result = await pool.query(
    `UPDATE cms_scheduled_jobs
        SET status = 'cancelled',
            cancelled_at = NOW()
      WHERE job_id = $1 AND status = 'pending'
      RETURNING *`,
    [jobId]
  );
  return rowToJob(result.rows[0] || null);
}

export async function rescheduleJob(pool, jobId, newScheduledAt) {
  if (!pool) throw new Error("rescheduleJob: pool required");
  if (!jobId) throw new Error("rescheduleJob: jobId required");
  if (!newScheduledAt) throw new Error("rescheduleJob: newScheduledAt required");
  const result = await pool.query(
    `UPDATE cms_scheduled_jobs
        SET scheduled_at = $2::timestamptz
      WHERE job_id = $1 AND status = 'pending'
      RETURNING *`,
    [jobId, toIso(newScheduledAt)]
  );
  return rowToJob(result.rows[0] || null);
}

function toIso(value) {
  if (value instanceof Date) return value.toISOString();
  const trimmed = String(value || "").trim();
  if (!trimmed) return "";
  const parsed = new Date(trimmed);
  if (Number.isNaN(parsed.getTime())) return trimmed;
  return parsed.toISOString();
}
