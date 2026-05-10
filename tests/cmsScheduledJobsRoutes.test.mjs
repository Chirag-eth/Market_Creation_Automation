import test from "node:test";
import assert from "node:assert/strict";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { startServerForTest } from "./helpers/serverHarness.mjs";

const __filename = fileURLToPath(import.meta.url);
const WORKSPACE = path.resolve(path.dirname(__filename), "..");
const LEAGUES_CSV = `${WORKSPACE}/catalog/leagues.csv`;
const TEAMS_CSV = `${WORKSPACE}/catalog/teams.csv`;

function nextPort() {
  return 26000 + Math.floor(Math.random() * 2000);
}

async function postJson(url, payload) {
  const res = await fetch(url, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(payload),
  });
  const body = await res.json();
  return { status: res.status, body };
}

function envelope(overrides = {}) {
  return {
    environment: "dev",
    action: "schedule-publish",
    request_id: "test-sched-1",
    requested_by: "test",
    payload: {
      selected_fixtures: [
        {
          game_id: "g1",
          event_name: "Home vs Away",
          fixture_date: "2026-06-01",
          kickoff_time_utc: "15:00",
          league_code: "epl",
        },
      ],
      selected_publish_keys: ["moneyline|0"],
      confirmation: { operator_name: "Op", fixture_count: "1", confirmed: true },
      scheduled_at: new Date(Date.now() + 60 * 60 * 1000).toISOString(),
      ...overrides.payload,
    },
    ...overrides.envelope,
  };
}

test("schedule-publish: rejects confirmation.confirmed=false with same issue shape as batch-publish", async (t) => {
  const port = nextPort();
  const started = await startServerForTest({
    cwd: WORKSPACE,
    port,
    env: { APP_ENV: "dev", LEAGUES_CSV_PATH: LEAGUES_CSV, TEAMS_CSV_PATH: TEAMS_CSV },
  });
  if (started.skipReason) {
    t.skip(started.skipReason);
    return;
  }
  t.after(async () => started.stop());

  const env = envelope({
    payload: { confirmation: { operator_name: "x", fixture_count: "1", confirmed: false } },
  });
  const { status, body } = await postJson(
    `${started.baseUrl}/api/integrations/cms/schedule-publish`,
    env
  );
  assert.equal(status, 400);
  assert.equal(body.ok, false);
  const issues = body?.extras?.issues || [];
  assert.ok(
    issues.some((i) => String(i).includes("confirmed")),
    `Expected confirmed issue, got: ${JSON.stringify(issues)}`
  );
});

test("schedule-publish: rejects past or invalid scheduled_at", async (t) => {
  const port = nextPort();
  const started = await startServerForTest({
    cwd: WORKSPACE,
    port,
    env: { APP_ENV: "dev", LEAGUES_CSV_PATH: LEAGUES_CSV, TEAMS_CSV_PATH: TEAMS_CSV },
  });
  if (started.skipReason) {
    t.skip(started.skipReason);
    return;
  }
  t.after(async () => started.stop());

  const past = await postJson(
    `${started.baseUrl}/api/integrations/cms/schedule-publish`,
    envelope({
      payload: { scheduled_at: new Date(Date.now() - 60_000).toISOString() },
    })
  );
  assert.equal(past.status, 400);
  assert.ok(
    (past.body?.extras?.issues || []).some((i) => String(i).includes("scheduled_at.in_past")),
    `Expected scheduled_at.in_past, got: ${JSON.stringify(past.body)}`
  );

  const bad = await postJson(
    `${started.baseUrl}/api/integrations/cms/schedule-publish`,
    envelope({
      payload: { scheduled_at: "not-a-date" },
    })
  );
  assert.equal(bad.status, 400);
  assert.ok(
    (bad.body?.extras?.issues || []).some((i) => String(i).includes("scheduled_at.invalid")),
    `Expected scheduled_at.invalid, got: ${JSON.stringify(bad.body)}`
  );

  const missing = await postJson(
    `${started.baseUrl}/api/integrations/cms/schedule-publish`,
    envelope({
      payload: { scheduled_at: "" },
    })
  );
  assert.equal(missing.status, 400);
  assert.ok(
    (missing.body?.extras?.issues || []).some((i) => String(i).includes("scheduled_at.required")),
    `Expected scheduled_at.required, got: ${JSON.stringify(missing.body)}`
  );
});

test("schedule-publish: returns 503 when DB is not configured (no DB_HOST)", async (t) => {
  const port = nextPort();
  const started = await startServerForTest({
    cwd: WORKSPACE,
    port,
    env: {
      APP_ENV: "dev",
      LEAGUES_CSV_PATH: LEAGUES_CSV,
      TEAMS_CSV_PATH: TEAMS_CSV,
      DISABLE_DB: "1",
    },
  });
  if (started.skipReason) {
    t.skip(started.skipReason);
    return;
  }
  t.after(async () => started.stop());

  const { status, body } = await postJson(
    `${started.baseUrl}/api/integrations/cms/schedule-publish`,
    envelope()
  );
  assert.equal(status, 503);
  assert.equal(body.ok, false);
  assert.match(String(body.error || ""), /DB not configured/);
});

test("scheduled-jobs list: 405 on non-GET", async (t) => {
  const port = nextPort();
  const started = await startServerForTest({
    cwd: WORKSPACE,
    port,
    env: { APP_ENV: "dev", LEAGUES_CSV_PATH: LEAGUES_CSV, TEAMS_CSV_PATH: TEAMS_CSV },
  });
  if (started.skipReason) {
    t.skip(started.skipReason);
    return;
  }
  t.after(async () => started.stop());

  const res = await fetch(`${started.baseUrl}/api/integrations/cms/scheduled-jobs`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({}),
  });
  assert.equal(res.status, 405);
});

test("scheduled-jobs list: returns empty list when DB is not configured", async (t) => {
  const port = nextPort();
  const started = await startServerForTest({
    cwd: WORKSPACE,
    port,
    env: {
      APP_ENV: "dev",
      LEAGUES_CSV_PATH: LEAGUES_CSV,
      TEAMS_CSV_PATH: TEAMS_CSV,
      DISABLE_DB: "1",
    },
  });
  if (started.skipReason) {
    t.skip(started.skipReason);
    return;
  }
  t.after(async () => started.stop());

  const res = await fetch(`${started.baseUrl}/api/integrations/cms/scheduled-jobs?environment=dev`);
  assert.equal(res.status, 200);
  const body = await res.json();
  assert.equal(body.ok, true);
  assert.deepEqual(body.jobs, []);
  assert.equal(body.db_configured, false);
});

test("scheduled-jobs cancel/reschedule: 503 without DB", async (t) => {
  const port = nextPort();
  const started = await startServerForTest({
    cwd: WORKSPACE,
    port,
    env: {
      APP_ENV: "dev",
      LEAGUES_CSV_PATH: LEAGUES_CSV,
      TEAMS_CSV_PATH: TEAMS_CSV,
      DISABLE_DB: "1",
    },
  });
  if (started.skipReason) {
    t.skip(started.skipReason);
    return;
  }
  t.after(async () => started.stop());

  const cancel = await fetch(
    `${started.baseUrl}/api/integrations/cms/scheduled-jobs/some-id/cancel`,
    { method: "POST", headers: { "Content-Type": "application/json" }, body: "{}" }
  );
  assert.equal(cancel.status, 503);

  const reschedule = await postJson(
    `${started.baseUrl}/api/integrations/cms/scheduled-jobs/some-id/reschedule`,
    { scheduled_at: new Date(Date.now() + 60_000).toISOString() }
  );
  assert.equal(reschedule.status, 503);
});

test("reschedule: validates scheduled_at body before touching DB", async (t) => {
  const port = nextPort();
  const started = await startServerForTest({
    cwd: WORKSPACE,
    port,
    env: { APP_ENV: "dev", LEAGUES_CSV_PATH: LEAGUES_CSV, TEAMS_CSV_PATH: TEAMS_CSV },
  });
  if (started.skipReason) {
    t.skip(started.skipReason);
    return;
  }
  t.after(async () => started.stop());

  const past = await postJson(
    `${started.baseUrl}/api/integrations/cms/scheduled-jobs/abc/reschedule`,
    { scheduled_at: new Date(Date.now() - 60_000).toISOString() }
  );
  assert.equal(past.status, 400);
  assert.ok((past.body?.extras?.issues || []).some((i) => String(i).includes("in_past")));

  const missing = await postJson(
    `${started.baseUrl}/api/integrations/cms/scheduled-jobs/abc/reschedule`,
    {}
  );
  assert.equal(missing.status, 400);
  assert.ok((missing.body?.extras?.issues || []).some((i) => String(i).includes("required")));
});
