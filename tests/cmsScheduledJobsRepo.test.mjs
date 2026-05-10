import test from "node:test";
import assert from "node:assert/strict";

import {
  insertScheduledJob,
  getScheduledJob,
  listScheduledJobs,
  claimDueJobs,
  markCompleted,
  markFailed,
  cancelJob,
  rescheduleJob,
} from "../src/backend/cmsScheduledJobsRepo.js";

// Fake pg pool that records every (sql, params) call. Tests assert against
// the calls list to verify the repo emits the expected SQL — and against
// the rows the fake returns to verify shaping.
function createRecordingPool({ queryImpl, connectImpl } = {}) {
  const calls = [];
  return {
    calls,
    async query(sql, params = []) {
      calls.push({ sql: String(sql || "").trim(), params, scope: "pool" });
      const result = queryImpl ? await queryImpl(String(sql || ""), params) : { rows: [] };
      return result || { rows: [] };
    },
    async connect() {
      const txCalls = [];
      const client = {
        async query(sql, params = []) {
          const text = String(sql || "").trim();
          txCalls.push({ sql: text, params });
          calls.push({ sql: text, params, scope: "client" });
          if (connectImpl) return connectImpl(text, params, txCalls);
          return { rows: [] };
        },
        release() {
          // no-op
        },
      };
      return client;
    },
  };
}

test("insertScheduledJob: requires pool, environment, scheduledAt, payload", async () => {
  const pool = createRecordingPool();
  await assert.rejects(() => insertScheduledJob(null), /pool required/);
  await assert.rejects(
    () => insertScheduledJob(pool, { scheduledAt: new Date(), payload: {} }),
    /environment required/
  );
  await assert.rejects(
    () => insertScheduledJob(pool, { environment: "dev", payload: {} }),
    /scheduledAt required/
  );
  await assert.rejects(
    () => insertScheduledJob(pool, { environment: "dev", scheduledAt: new Date() }),
    /payload object required/
  );
});

test("insertScheduledJob: writes to cms_scheduled_jobs and returns the row", async () => {
  const fakeRow = {
    job_id: "11111111-1111-1111-1111-111111111111",
    environment: "dev",
    status: "pending",
    scheduled_at: new Date("2026-06-01T12:00:00Z"),
    payload_json: { request_id: "req-1" },
    request_id: "req-1",
    created_by: "tester",
    created_at: new Date(),
    attempts: 0,
  };
  const pool = createRecordingPool({
    queryImpl: () => ({ rows: [fakeRow] }),
  });

  const job = await insertScheduledJob(pool, {
    environment: "dev",
    scheduledAt: new Date("2026-06-01T12:00:00Z"),
    payload: { request_id: "req-1" },
    requestId: "req-1",
    createdBy: "tester",
  });

  assert.equal(pool.calls.length, 1);
  assert.match(pool.calls[0].sql, /INSERT INTO cms_scheduled_jobs/);
  assert.match(pool.calls[0].sql, /'pending'/);
  assert.equal(pool.calls[0].params[1], "dev"); // environment
  assert.equal(pool.calls[0].params[4], "req-1"); // request_id
  assert.equal(pool.calls[0].params[5], "tester"); // created_by
  assert.equal(job.environment, "dev");
  assert.equal(job.status, "pending");
  assert.equal(job.scheduled_at, "2026-06-01T12:00:00.000Z");
});

test("listScheduledJobs: filters by environment and status, validates status enum", async () => {
  const pool = createRecordingPool({
    queryImpl: () => ({ rows: [] }),
  });

  await listScheduledJobs(pool, { environment: "uat", status: "pending", limit: 50 });
  assert.equal(pool.calls.length, 1);
  assert.match(pool.calls[0].sql, /WHERE environment = \$1 AND status = \$2/);
  assert.deepEqual(pool.calls[0].params.slice(0, 2), ["uat", "pending"]);

  await assert.rejects(
    () => listScheduledJobs(pool, { status: "bogus" }),
    /invalid status "bogus"/
  );
});

test("claimDueJobs: claims pending rows and transitions them to in_flight in one txn", async () => {
  const pendingRow = {
    job_id: "aaaa1111-1111-1111-1111-111111111111",
    environment: "dev",
    status: "pending",
    scheduled_at: new Date("2026-06-01T12:00:00Z"),
    payload_json: {},
    attempts: 0,
  };
  let beganTxn = false;
  let committedTxn = false;
  const pool = createRecordingPool({
    connectImpl: async (sql) => {
      if (/^BEGIN$/i.test(sql)) {
        beganTxn = true;
        return { rows: [] };
      }
      if (/^COMMIT$/i.test(sql)) {
        committedTxn = true;
        return { rows: [] };
      }
      if (/SELECT \* FROM cms_scheduled_jobs/i.test(sql)) {
        assert.match(sql, /FOR UPDATE SKIP LOCKED/);
        return { rows: [pendingRow] };
      }
      if (/UPDATE cms_scheduled_jobs/i.test(sql)) {
        return { rows: [] };
      }
      return { rows: [] };
    },
  });

  const claimed = await claimDueJobs(pool, {
    environment: "dev",
    now: new Date("2026-06-01T12:01:00Z"),
    limit: 5,
  });

  assert.equal(beganTxn, true, "must begin a transaction before claiming");
  assert.equal(committedTxn, true, "must commit after marking in_flight");
  assert.equal(claimed.length, 1);
  assert.equal(claimed[0].status, "in_flight");
  assert.equal(claimed[0].attempts, 1);
});

test("claimDueJobs: empty result still commits txn and returns []", async () => {
  let committedTxn = false;
  const pool = createRecordingPool({
    connectImpl: async (sql) => {
      if (/^BEGIN$/i.test(sql)) return { rows: [] };
      if (/^COMMIT$/i.test(sql)) {
        committedTxn = true;
        return { rows: [] };
      }
      if (/SELECT \* FROM cms_scheduled_jobs/i.test(sql)) return { rows: [] };
      return { rows: [] };
    },
  });
  const claimed = await claimDueJobs(pool, { environment: "dev", limit: 5 });
  assert.equal(claimed.length, 0);
  assert.equal(committedTxn, true);
});

test("claimDueJobs: rolls back on error", async () => {
  let rolledBack = false;
  const pool = createRecordingPool({
    connectImpl: async (sql) => {
      if (/^BEGIN$/i.test(sql)) return { rows: [] };
      if (/^ROLLBACK$/i.test(sql)) {
        rolledBack = true;
        return { rows: [] };
      }
      if (/SELECT \* FROM cms_scheduled_jobs/i.test(sql)) {
        throw new Error("boom");
      }
      return { rows: [] };
    },
  });
  await assert.rejects(() => claimDueJobs(pool, { environment: "dev" }), /boom/);
  assert.equal(rolledBack, true, "rollback must run when SELECT throws");
});

test("markCompleted: only transitions in_flight rows", async () => {
  const pool = createRecordingPool({
    queryImpl: (sql) => {
      assert.match(sql, /SET status = 'completed'/);
      assert.match(sql, /WHERE job_id = \$1 AND status = 'in_flight'/);
      return {
        rows: [
          {
            job_id: "aaaa",
            environment: "dev",
            status: "completed",
            scheduled_at: new Date(),
            payload_json: {},
            attempts: 1,
            run_id: "run-xyz",
          },
        ],
      };
    },
  });
  const job = await markCompleted(pool, "aaaa", { runId: "run-xyz" });
  assert.equal(job.status, "completed");
  assert.equal(job.run_id, "run-xyz");
});

test("markFailed: stores trimmed error message and only transitions in_flight rows", async () => {
  const pool = createRecordingPool({
    queryImpl: (sql, params) => {
      assert.match(sql, /SET status = 'failed'/);
      assert.match(sql, /WHERE job_id = \$1 AND status = 'in_flight'/);
      assert.equal(params[1].length <= 4000, true);
      return {
        rows: [
          {
            job_id: "bbb",
            environment: "dev",
            status: "failed",
            scheduled_at: new Date(),
            payload_json: {},
            attempts: 1,
            last_error: params[1],
          },
        ],
      };
    },
  });
  const job = await markFailed(pool, "bbb", { error: "kaboom" });
  assert.equal(job.status, "failed");
  assert.equal(job.last_error, "kaboom");
});

test("cancelJob: only cancels pending rows; returns null if no row matched", async () => {
  let scenario = "ok";
  const pool = createRecordingPool({
    queryImpl: (sql) => {
      assert.match(sql, /SET status = 'cancelled'/);
      assert.match(sql, /WHERE job_id = \$1 AND status = 'pending'/);
      if (scenario === "ok") {
        return {
          rows: [
            {
              job_id: "ccc",
              environment: "dev",
              status: "cancelled",
              scheduled_at: new Date(),
              payload_json: {},
              attempts: 0,
            },
          ],
        };
      }
      return { rows: [] };
    },
  });
  const ok = await cancelJob(pool, "ccc");
  assert.equal(ok.status, "cancelled");

  scenario = "miss";
  const miss = await cancelJob(pool, "ddd");
  assert.equal(miss, null);
});

test("rescheduleJob: validates inputs and only updates pending rows", async () => {
  const pool = createRecordingPool({
    queryImpl: (sql, params) => {
      assert.match(sql, /SET scheduled_at = \$2::timestamptz/);
      assert.match(sql, /WHERE job_id = \$1 AND status = 'pending'/);
      return {
        rows: [
          {
            job_id: "eee",
            environment: "dev",
            status: "pending",
            scheduled_at: new Date(params[1]),
            payload_json: {},
            attempts: 0,
          },
        ],
      };
    },
  });
  await assert.rejects(() => rescheduleJob(pool, "eee", null), /newScheduledAt required/);
  const job = await rescheduleJob(pool, "eee", new Date("2026-06-02T15:00:00Z"));
  assert.equal(job.scheduled_at, "2026-06-02T15:00:00.000Z");
});

test("getScheduledJob: returns null for empty result", async () => {
  const pool = createRecordingPool({ queryImpl: () => ({ rows: [] }) });
  const job = await getScheduledJob(pool, "missing-id");
  assert.equal(job, null);
});
