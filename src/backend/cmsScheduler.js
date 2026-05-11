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

      let claimed;
      try {
        claimed = await claimDueJobs(pool, { environment, now, limit: batchSize });
      } catch (err) {
        log?.error?.({ err: String(err?.message || err) }, "scheduler claim failed");
        return { claimed: 0, fired: 0, error: String(err?.message || err) };
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
  };
}
