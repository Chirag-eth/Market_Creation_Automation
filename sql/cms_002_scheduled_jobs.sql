-- cms_002_scheduled_jobs.sql
--
-- Backing store for the operator-facing "schedule a publish for later" flow.
-- A row is created when the dashboard POSTs /api/integrations/cms/schedule-publish.
-- An in-process worker (src/backend/cmsScheduler.js) polls this table every
-- SCHEDULER_TICK_INTERVAL_MS and fires due jobs through executeCmsBatchRun.
--
-- Concurrency model: SELECT ... FOR UPDATE SKIP LOCKED in claimDueJobs() lets
-- multiple replicas / restarts run side-by-side without leader election or
-- duplicate fires.
--
-- Apply per environment with:
--   psql "$DB_URL" -f sql/cms_002_scheduled_jobs.sql
--
-- Run on dev first, then uat. Mainnet only when the user explicitly green-lights it.

CREATE TABLE IF NOT EXISTS cms_scheduled_jobs (
  job_id        UUID PRIMARY KEY,
  environment   TEXT NOT NULL,
  status        TEXT NOT NULL CHECK (
                  status IN ('pending', 'in_flight', 'completed', 'failed', 'cancelled')
                ),
  scheduled_at  TIMESTAMPTZ NOT NULL,
  payload_json  JSONB NOT NULL,
  request_id    TEXT,
  created_by    TEXT,
  created_at    TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  attempts      INT NOT NULL DEFAULT 0,
  started_at    TIMESTAMPTZ,
  completed_at  TIMESTAMPTZ,
  cancelled_at  TIMESTAMPTZ,
  run_id        TEXT,
  last_error    TEXT
);

-- Worker poll path: only pending rows whose time has come.
CREATE INDEX IF NOT EXISTS idx_cms_scheduled_jobs_due
  ON cms_scheduled_jobs (scheduled_at)
  WHERE status = 'pending';

-- Operator queue listing: filter by env + recency.
CREATE INDEX IF NOT EXISTS idx_cms_scheduled_jobs_env_created
  ON cms_scheduled_jobs (environment, created_at DESC);
