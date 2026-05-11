// cmsScheduler.js
//
// In-process worker that fires due cms_scheduled_jobs every
// SCHEDULER_TICK_INTERVAL_MS. Single tick:
//   1. claimDueJobs(pool, {environment, now}) — atomic pending → in_flight
//   2. for each claimed job: build batch run, kick off executeCmsBatchRun,
//      await it, then markCompleted / markFailed
//
// Concurrency: one tick at a time per process. If a tick is still running when
// the interval fires again, the next tick is skipped — claimed jobs that
// haven't yet finished cannot be double-fired (the row is in_flight).
//
// Env-safety: the worker only fires jobs whose `environment` matches the
// active runtime env. Jobs scheduled for a different env sit until that env
// becomes active. This makes it safe to run a single server process while
// switching APP_ENV at runtime.

import { claimDueJobs, markCompleted, markFailed } from "./cmsScheduledJobsRepo.js";

const DEFAULT_TICK_INTERVAL_MS = 60_000;
const DEFAULT_BATCH_SIZE = 5;

export function createCmsScheduler({
  getActiveEnvCode,
  getDbPoolForEnv,
  getActiveRuntimeEnvVars,
  fireScheduledJob,
  log,
  tickIntervalMs = DEFAULT_TICK_INTERVAL_MS,
  batchSize = DEFAULT_BATCH_SIZE,
} = {}) {
  if (typeof getActiveEnvCode !== "function") {
    throw new Error("createCmsScheduler: getActiveEnvCode is required");
  }
  if (typeof getDbPoolForEnv !== "function") {
    throw new Error("createCmsScheduler: getDbPoolForEnv is required");
  }
  if (typeof fireScheduledJob !== "function") {
    throw new Error("createCmsScheduler: fireScheduledJob is required");
  }

  let timer = null;
  let tickInProgress = false;
  let stopped = false;
  let lastSchemaError = null;
  let schemaCheckedFor = null;

  // Probes the active env's pool for the cms_scheduled_jobs table. Called
  // lazily from tick() so we only hit the DB once per env-switch. If the
  // table is missing or the pool refuses the query, we record the error so
  // future health endpoints / operators can see why nothing is firing.
  async function ensureSchema(pool, environment) {
    if (schemaCheckedFor === environment && lastSchemaError === null) return true;
    try {
      await pool.query("SELECT 1 FROM cms_scheduled_jobs LIMIT 0");
      schemaCheckedFor = environment;
      lastSchemaError = null;
      return true;
    } catch (err) {
      const msg = String(err?.message || err);
      schemaCheckedFor = environment;
      lastSchemaError = msg;
      log?.error?.(
        { err: msg, environment },
        "scheduler schema check failed — cms_scheduled_jobs missing or unreadable. Apply sql/cms_002_scheduled_jobs.sql to this env's DB. Worker will retry on next tick."
      );
      return false;
    }
  }

  async function tick(now = new Date()) {
    if (tickInProgress) {
      log?.debug?.("scheduler tick skipped — previous tick still running");
      return { claimed: 0, fired: 0, skipped: true };
    }
    tickInProgress = true;
    try {
      const envVars =
        typeof getActiveRuntimeEnvVars === "function" ? getActiveRuntimeEnvVars() : {};
      const pool = getDbPoolForEnv(envVars);
      if (!pool) {
        log?.debug?.("scheduler tick skipped — no DB pool for active env");
        return { claimed: 0, fired: 0, skipped: true, reason: "no_db_pool" };
      }
      const environment = String(getActiveEnvCode() || "").trim();
      if (!environment) {
        log?.warn?.("scheduler tick skipped — active env code is empty");
        return { claimed: 0, fired: 0, skipped: true, reason: "no_env" };
      }

      // Re-check schema whenever env changes so a UAT-then-dev switch
      // (or vice versa) re-probes the new env's DB. Cheap (one round-trip)
      // and we only probe once per env per process while healthy.
      if (schemaCheckedFor !== environment) {
        const ok = await ensureSchema(pool, environment);
        if (!ok) {
          return {
            claimed: 0,
            fired: 0,
            skipped: true,
            reason: "schema_missing",
            error: lastSchemaError,
          };
        }
      }

      let claimed;
      try {
        claimed = await claimDueJobs(pool, { environment, now, limit: batchSize });
      } catch (err) {
        const msg = String(err?.message || err);
        // 42P01 = undefined_table. If the table has gone missing between
        // ticks (or our cached schema-OK signal is stale), force a re-probe
        // on the next tick so getLastSchemaError() reports it.
        if (/relation .* does not exist/i.test(msg) || /42P01/.test(msg)) {
          schemaCheckedFor = null;
          lastSchemaError = msg;
        }
        log?.error?.({ err: msg }, "scheduler claim failed");
        return { claimed: 0, fired: 0, error: msg };
      }

      if (claimed.length === 0) {
        return { claimed: 0, fired: 0 };
      }

      log?.info?.({ count: claimed.length, environment }, "scheduler claimed due jobs");

      let fired = 0;
      let failed = 0;
      // Fire sequentially. Each batch run is non-trivial; sequencing keeps the
      // worker predictable and avoids piling concurrent CMS requests.
      for (const job of claimed) {
        const startedAt = Date.now();
        try {
          const { runId } = await fireScheduledJob(job, { pool, environment });
          await markCompleted(pool, job.job_id, { runId: runId || null });
          fired += 1;
          log?.info?.(
            {
              jobId: job.job_id,
              runId: runId || null,
              durationMs: Date.now() - startedAt,
            },
            "scheduled job completed"
          );
        } catch (err) {
          log?.error?.(
            {
              err: String(err?.message || err),
              jobId: job.job_id,
              durationMs: Date.now() - startedAt,
            },
            "scheduled job failed"
          );
          await markFailed(pool, job.job_id, {
            error: String(err?.message || err),
          }).catch((markErr) =>
            log?.error?.(
              { err: String(markErr?.message || markErr), jobId: job.job_id },
              "scheduler failed to mark job failed"
            )
          );
          failed += 1;
        }
      }

      return { claimed: claimed.length, fired, failed };
    } finally {
      tickInProgress = false;
    }
  }

  function start() {
    if (timer || stopped) return;
    log?.info?.({ intervalMs: tickIntervalMs }, "cms scheduler started");
    timer = setInterval(() => {
      tick().catch((err) =>
        log?.error?.({ err: String(err?.message || err) }, "scheduler tick error")
      );
    }, tickIntervalMs);
    if (typeof timer.unref === "function") timer.unref();
  }

  function stop() {
    stopped = true;
    if (timer) {
      clearInterval(timer);
      timer = null;
    }
  }

  return {
    start,
    stop,
    tick, // exposed for tests
    isRunning: () => Boolean(timer),
    isTickInProgress: () => tickInProgress,
    // Schema-health surface. Returns null when no probe has run yet or when
    // the last probe succeeded; returns the error message string otherwise.
    // Consumers (future /scheduler-health route, frontend banner) should
    // treat any non-null value as "operator action needed".
    getLastSchemaError: () => lastSchemaError,
  };
}
