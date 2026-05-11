import test from "node:test";
import assert from "node:assert/strict";

import { createCmsScheduler } from "../src/backend/cmsScheduler.js";

// The scheduler talks to the DB only through claimDueJobs / markCompleted /
// markFailed in cmsScheduledJobsRepo. Those go through `pool.connect()` /
// `pool.query()`. We give the scheduler a fake pool whose .connect() / .query()
// are scripted per scenario.

function buildFakePool({ pendingRows = [], onUpdate = () => {} } = {}) {
  return {
    async connect() {
      return {
        async query(sql, _params = []) {
          const text = String(sql || "").trim();
          if (/^BEGIN$/i.test(text) || /^COMMIT$/i.test(text)) return { rows: [] };
          if (/^ROLLBACK$/i.test(text)) return { rows: [] };
          if (/SELECT \* FROM cms_scheduled_jobs/i.test(text)) {
            return { rows: pendingRows };
          }
          if (/UPDATE cms_scheduled_jobs/i.test(text)) {
            return { rows: [] };
          }
          return { rows: [] };
        },
        release() {},
      };
    },
    async query(sql, params = []) {
      const text = String(sql || "").trim();
      if (/UPDATE cms_scheduled_jobs/i.test(text)) {
        onUpdate(text, params);
      }
      // markCompleted / markFailed RETURNING shape
      return {
        rows: [
          {
            job_id: params[0],
            environment: "dev",
            status: /completed/.test(text)
              ? "completed"
              : /failed/.test(text)
                ? "failed"
                : "pending",
            scheduled_at: new Date(),
            payload_json: {},
            attempts: 1,
          },
        ],
      };
    },
  };
}

test("scheduler tick: skipped when no DB pool", async () => {
  const sched = createCmsScheduler({
    getActiveEnvCode: () => "dev",
    getDbPoolForEnv: () => null,
    getActiveRuntimeEnvVars: () => ({}),
    fireScheduledJob: async () => ({ runId: "run-1" }),
  });
  const result = await sched.tick();
  assert.equal(result.skipped, true);
  assert.equal(result.reason, "no_db_pool");
});

test("scheduler tick: claims due jobs, fires each, marks completed on success", async () => {
  const fired = [];
  const updates = [];
  const pool = buildFakePool({
    pendingRows: [
      {
        job_id: "j1",
        environment: "dev",
        status: "pending",
        scheduled_at: new Date(),
        payload_json: { request_id: "r1" },
        attempts: 0,
      },
      {
        job_id: "j2",
        environment: "dev",
        status: "pending",
        scheduled_at: new Date(),
        payload_json: { request_id: "r2" },
        attempts: 0,
      },
    ],
    onUpdate: (sql, params) => updates.push({ sql, params }),
  });

  const sched = createCmsScheduler({
    getActiveEnvCode: () => "dev",
    getDbPoolForEnv: () => pool,
    getActiveRuntimeEnvVars: () => ({}),
    async fireScheduledJob(job) {
      fired.push(job.job_id);
      return { runId: `run-${job.job_id}` };
    },
  });

  const result = await sched.tick();
  assert.equal(result.claimed, 2);
  assert.equal(result.fired, 2);
  assert.deepEqual(fired, ["j1", "j2"]);
  // Two markCompleted calls happen via pool.query
  const completedUpdates = updates.filter((u) => /SET status = 'completed'/.test(u.sql));
  assert.equal(completedUpdates.length, 2);
});

test("scheduler tick: marks failed when fireScheduledJob throws — does not throw out of tick", async () => {
  const updates = [];
  const pool = buildFakePool({
    pendingRows: [
      {
        job_id: "jf",
        environment: "dev",
        status: "pending",
        scheduled_at: new Date(),
        payload_json: {},
        attempts: 0,
      },
    ],
    onUpdate: (sql, params) => updates.push({ sql, params }),
  });
  const sched = createCmsScheduler({
    getActiveEnvCode: () => "dev",
    getDbPoolForEnv: () => pool,
    getActiveRuntimeEnvVars: () => ({}),
    async fireScheduledJob() {
      throw new Error("downstream-blew-up");
    },
  });
  const result = await sched.tick();
  assert.equal(result.claimed, 1);
  assert.equal(result.fired, 0);
  assert.equal(result.failed, 1);
  const failedUpdates = updates.filter((u) => /SET status = 'failed'/.test(u.sql));
  assert.equal(failedUpdates.length, 1);
  assert.match(failedUpdates[0].params[1], /downstream-blew-up/);
});

test("scheduler tick: skipped when active env code is empty", async () => {
  const sched = createCmsScheduler({
    getActiveEnvCode: () => "",
    getDbPoolForEnv: () => buildFakePool(),
    getActiveRuntimeEnvVars: () => ({}),
    fireScheduledJob: async () => ({ runId: "x" }),
  });
  const result = await sched.tick();
  assert.equal(result.skipped, true);
  assert.equal(result.reason, "no_env");
});

test("scheduler tick: re-entrancy guard skips overlapping ticks", async () => {
  let resolveFire;
  const firePromise = new Promise((r) => {
    resolveFire = r;
  });
  const pool = buildFakePool({
    pendingRows: [
      {
        job_id: "slow",
        environment: "dev",
        status: "pending",
        scheduled_at: new Date(),
        payload_json: {},
        attempts: 0,
      },
    ],
  });
  const sched = createCmsScheduler({
    getActiveEnvCode: () => "dev",
    getDbPoolForEnv: () => pool,
    getActiveRuntimeEnvVars: () => ({}),
    async fireScheduledJob() {
      await firePromise;
      return { runId: "run-slow" };
    },
  });

  const first = sched.tick();
  // Second tick fires immediately while first is still in flight
  const secondResult = await sched.tick();
  assert.equal(secondResult.skipped, true);
  // Let the first tick finish so the test doesn't hang
  resolveFire({ runId: "run-slow" });
  const firstResult = await first;
  assert.equal(firstResult.fired, 1);
});

test("scheduler tick: skipped with schema_missing reason when probe fails; getLastSchemaError reports it", async () => {
  // Fake pool whose schema probe ("SELECT 1 FROM cms_scheduled_jobs LIMIT 0")
  // throws like Postgres 42P01. This is the exact failure mode that hit UAT
  // on 2026-05-11 — see bugs.md BUG-S001.
  const pool = {
    async query(sql) {
      const text = String(sql || "");
      if (/SELECT 1 FROM cms_scheduled_jobs LIMIT 0/i.test(text)) {
        const err = new Error('relation "cms_scheduled_jobs" does not exist');
        err.code = "42P01";
        throw err;
      }
      return { rows: [] };
    },
    async connect() {
      throw new Error("connect should not be reached — schema check fails first");
    },
  };
  const sched = createCmsScheduler({
    getActiveEnvCode: () => "uat",
    getDbPoolForEnv: () => pool,
    getActiveRuntimeEnvVars: () => ({}),
    fireScheduledJob: async () => ({ runId: "x" }),
  });
  const result = await sched.tick();
  assert.equal(result.skipped, true);
  assert.equal(result.reason, "schema_missing");
  assert.match(String(result.error), /does not exist/);
  assert.match(String(sched.getLastSchemaError()), /does not exist/);
});

test("scheduler tick: re-probes schema after env switch (cache is per-env)", async () => {
  // Simulate switching active env between ticks. First tick on uat fails the
  // probe; second tick on dev should re-probe (and succeed here) — i.e. the
  // "checked once per env" cache must be invalidated on env change.
  let currentEnv = "uat";
  let probeCalls = 0;
  const pool = {
    async query(sql) {
      const text = String(sql || "");
      if (/SELECT 1 FROM cms_scheduled_jobs LIMIT 0/i.test(text)) {
        probeCalls += 1;
        if (currentEnv === "uat") {
          throw new Error('relation "cms_scheduled_jobs" does not exist');
        }
        return { rows: [] };
      }
      return { rows: [] };
    },
    async connect() {
      return {
        async query(sql) {
          const text = String(sql || "").trim();
          if (/^BEGIN$/i.test(text) || /^COMMIT$/i.test(text)) return { rows: [] };
          if (/SELECT \* FROM cms_scheduled_jobs/i.test(text)) return { rows: [] };
          return { rows: [] };
        },
        release() {},
      };
    },
  };
  const sched = createCmsScheduler({
    getActiveEnvCode: () => currentEnv,
    getDbPoolForEnv: () => pool,
    getActiveRuntimeEnvVars: () => ({}),
    fireScheduledJob: async () => ({ runId: "x" }),
  });

  const first = await sched.tick();
  assert.equal(first.reason, "schema_missing");

  currentEnv = "dev";
  const second = await sched.tick();
  assert.equal(second.skipped, undefined); // healthy path
  assert.equal(probeCalls, 2); // re-probed on env switch
  assert.equal(sched.getLastSchemaError(), null);
});

test("scheduler start/stop are idempotent and unref the timer", async () => {
  const pool = buildFakePool();
  const sched = createCmsScheduler({
    getActiveEnvCode: () => "dev",
    getDbPoolForEnv: () => pool,
    getActiveRuntimeEnvVars: () => ({}),
    fireScheduledJob: async () => ({ runId: "x" }),
    tickIntervalMs: 60_000,
  });
  sched.start();
  sched.start(); // second call is no-op
  assert.equal(sched.isRunning(), true);
  sched.stop();
  sched.stop(); // second call is no-op
  assert.equal(sched.isRunning(), false);
});
