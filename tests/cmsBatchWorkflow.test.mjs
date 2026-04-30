/**
 * cmsBatchWorkflow.test.mjs
 *
 * Covers the DEV batch publish workflow behaviors that go beyond the pure-unit
 * layer in cmsBatchPublish.test.mjs:
 *
 *   - Kickoff-chronological fixture ordering (sortCmsBatchFixturesByKickoff)
 *   - Mixed-league multi-select envelope normalization
 *   - Frontend vs backend fixture-count caps
 *   - Retry-failed-only key extraction (extractRetryKeysFromRunRecord)
 *     · only failed / half_prepared markets are retried
 *     · successful / existing / excluded markets are never retried
 *     · fully-successful fixtures are absent from the retry map
 *     · partial fixtures contribute only their failed keys
 *   - HTTP environment gating (batch routes blocked outside DEV)
 *   - Server-side confirmed=false rejection after the fix
 */

import test from "node:test";
import assert from "node:assert/strict";
import path from "node:path";
import { fileURLToPath } from "node:url";

import {
  CMS_BATCH_BACKEND_MAX_FIXTURES,
  CMS_BATCH_FRONTEND_MAX_FIXTURES,
  extractRetryKeysFromRunRecord,
  getCmsBatchFixtureKey,
  normalizeCmsBatchEnvelope,
} from "../src/backend/cmsBatchPublish.js";

import { sortCmsBatchFixturesByKickoff } from "../server.js";

import { startServerForTest } from "./helpers/serverHarness.mjs";

const __filename = fileURLToPath(import.meta.url);
const WORKSPACE = path.resolve(path.dirname(__filename), "..");
const LEAGUES_CSV = `${WORKSPACE}/catalog/leagues.csv`;
const TEAMS_CSV = `${WORKSPACE}/catalog/teams.csv`;

function nextPort() {
  return 28000 + Math.floor(Math.random() * 2000);
}

async function postJson(url, payload) {
  const res = await fetch(url, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(payload),
  });
  return { status: res.status, body: await res.json() };
}

function makeFixture(overrides = {}) {
  return {
    game_id: String(overrides.game_id || `gid-${Math.random().toString(36).slice(2)}`),
    event_name: String(overrides.event_name || "Home vs Away"),
    fixture_date: String(overrides.fixture_date || "2026-04-20"),
    kickoff_time_utc: String(overrides.kickoff_time_utc || "15:00"),
    league_code: String(overrides.league_code || "epl"),
  };
}

// ─── Fixture-count caps ───────────────────────────────────────────────────────

test("frontend cap is 15 and backend cap is 30", () => {
  assert.equal(CMS_BATCH_FRONTEND_MAX_FIXTURES, 15);
  assert.equal(CMS_BATCH_BACKEND_MAX_FIXTURES, 30);
  assert.ok(
    CMS_BATCH_FRONTEND_MAX_FIXTURES < CMS_BATCH_BACKEND_MAX_FIXTURES,
    "frontend cap must be stricter than backend cap"
  );
});

// ─── Kickoff chronological ordering ──────────────────────────────────────────

test("sort places earliest kickoff first across different dates", () => {
  const fixtures = [
    makeFixture({ game_id: "late",  fixture_date: "2026-04-22", kickoff_time_utc: "20:00", league_code: "bundesliga" }),
    makeFixture({ game_id: "first", fixture_date: "2026-04-20", kickoff_time_utc: "13:00", league_code: "epl" }),
    makeFixture({ game_id: "mid",   fixture_date: "2026-04-21", kickoff_time_utc: "17:30", league_code: "laliga" }),
  ];
  const sorted = sortCmsBatchFixturesByKickoff(fixtures);
  assert.deepEqual(
    sorted.map((f) => f.game_id),
    ["first", "mid", "late"]
  );
});

test("sort places earlier kickoff first when fixtures share the same date", () => {
  const fixtures = [
    makeFixture({ game_id: "evening", fixture_date: "2026-04-20", kickoff_time_utc: "20:00" }),
    makeFixture({ game_id: "noon",    fixture_date: "2026-04-20", kickoff_time_utc: "12:00" }),
    makeFixture({ game_id: "midaft",  fixture_date: "2026-04-20", kickoff_time_utc: "15:00" }),
  ];
  const sorted = sortCmsBatchFixturesByKickoff(fixtures);
  assert.deepEqual(
    sorted.map((f) => f.game_id),
    ["noon", "midaft", "evening"]
  );
});

test("sort uses event_name as tiebreaker when date and kickoff are identical", () => {
  const sharedDate = "2026-04-20";
  const sharedTime = "15:00";
  const fixtures = [
    makeFixture({ game_id: "c", event_name: "Zebra vs Ant",    fixture_date: sharedDate, kickoff_time_utc: sharedTime }),
    makeFixture({ game_id: "a", event_name: "Arsenal vs Barca", fixture_date: sharedDate, kickoff_time_utc: sharedTime }),
    makeFixture({ game_id: "b", event_name: "Milan vs Inter",   fixture_date: sharedDate, kickoff_time_utc: sharedTime }),
  ];
  const sorted = sortCmsBatchFixturesByKickoff(fixtures);
  assert.deepEqual(
    sorted.map((f) => f.game_id),
    ["a", "b", "c"]
  );
});

test("sort is stable and deterministic for all-valid fixtures across leagues and dates", () => {
  // Only tests deterministic guarantees: earlier date → lower index.
  // The relative position of fixtures with missing/malformed date strings is
  // V8-version-dependent and is intentionally not asserted here.
  const fixtures = [
    makeFixture({ game_id: "d3", league_code: "bundesliga", fixture_date: "2026-06-01", kickoff_time_utc: "18:00" }),
    makeFixture({ game_id: "d1", league_code: "epl",        fixture_date: "2026-04-20", kickoff_time_utc: "13:00" }),
    makeFixture({ game_id: "d2", league_code: "laliga",     fixture_date: "2026-05-10", kickoff_time_utc: "20:00" }),
  ];
  const sorted = sortCmsBatchFixturesByKickoff(fixtures);
  assert.deepEqual(sorted.map((f) => f.game_id), ["d1", "d2", "d3"]);
});

test("sort returns empty array for empty input", () => {
  assert.deepEqual(sortCmsBatchFixturesByKickoff([]), []);
  assert.deepEqual(sortCmsBatchFixturesByKickoff(null), []);
});

test("sort preserves a single fixture unchanged", () => {
  const fixture = makeFixture({ game_id: "solo", fixture_date: "2026-05-01", kickoff_time_utc: "18:00" });
  const sorted = sortCmsBatchFixturesByKickoff([fixture]);
  assert.equal(sorted.length, 1);
  assert.equal(sorted[0].game_id, "solo");
});

test("sort does not mutate the original array", () => {
  const original = [
    makeFixture({ game_id: "b", fixture_date: "2026-04-21", kickoff_time_utc: "15:00" }),
    makeFixture({ game_id: "a", fixture_date: "2026-04-20", kickoff_time_utc: "15:00" }),
  ];
  const before = original.map((f) => f.game_id);
  sortCmsBatchFixturesByKickoff(original);
  assert.deepEqual(original.map((f) => f.game_id), before, "original array must not be mutated");
});

// ─── Mixed-league multi-select ────────────────────────────────────────────────

test("normalization preserves fixtures from distinct leagues without cross-contamination", () => {
  const eplFixture       = makeFixture({ game_id: "epl-1",  league_code: "epl",        event_name: "Arsenal vs Chelsea" });
  const laligaFixture    = makeFixture({ game_id: "ll-1",   league_code: "laliga",     event_name: "Barca vs Madrid" });
  const bundesligaFixture = makeFixture({ game_id: "bund-1", league_code: "bundesliga", event_name: "Bayern vs Dortmund" });

  const result = normalizeCmsBatchEnvelope({
    selected_fixtures: [eplFixture, laligaFixture, bundesligaFixture],
    selected_publish_keys: ["moneyline|0", "btts|0"],
  });

  assert.equal(result.selectedFixtures.length, 3, "all three league fixtures must be retained");

  const codes = result.selectedFixtures.map((f) => f.league_code);
  assert.ok(codes.includes("epl"),        "epl fixture missing");
  assert.ok(codes.includes("laliga"),     "laliga fixture missing");
  assert.ok(codes.includes("bundesliga"), "bundesliga fixture missing");
});

test("fixture keys are unique across leagues even when event name, date, and time are shared", () => {
  const shared = { event_name: "Home vs Away", fixture_date: "2026-04-20", kickoff_time_utc: "15:00" };
  const eplKey   = getCmsBatchFixtureKey({ ...shared, league_code: "epl" });
  const laligaKey = getCmsBatchFixtureKey({ ...shared, league_code: "laliga" });
  assert.notEqual(eplKey, laligaKey, "same match in different leagues must produce different fixture keys");
});

test("normalization deduplicates fixtures across leagues using fixture key", () => {
  const f1 = makeFixture({ game_id: "dup-1", league_code: "epl" });
  const f2 = makeFixture({ game_id: "dup-1", league_code: "epl" }); // same game_id = same key
  const f3 = makeFixture({ game_id: "uniq-2", league_code: "laliga" });

  const result = normalizeCmsBatchEnvelope({
    selected_fixtures: [f1, f2, f3],
    selected_publish_keys: ["moneyline|0"],
  });

  assert.equal(result.selectedFixtures.length, 2, "duplicate fixture key must be deduped");
});

// ─── Retry-failed-only key extraction ────────────────────────────────────────

test("extractRetryKeysFromRunRecord returns empty map for null or missing run", () => {
  assert.equal(extractRetryKeysFromRunRecord(null).size, 0);
  assert.equal(extractRetryKeysFromRunRecord(undefined).size, 0);
  assert.equal(extractRetryKeysFromRunRecord({}).size, 0);
  assert.equal(extractRetryKeysFromRunRecord({ fixtures: [] }).size, 0);
});

test("extractRetryKeysFromRunRecord extracts only failed and half_prepared keys", () => {
  const runRecord = {
    fixtures: [{
      fixture_key: "epl-1",
      markets: [
        { publish_key: "moneyline|0",      status: "created"       }, // success — skip
        { publish_key: "btts|0",           status: "failed"        }, // retry
        { publish_key: "totals|2.5",       status: "half_prepared" }, // retry
        { publish_key: "totals|1.5",       status: "existing"      }, // skip
        { publish_key: "spreads|1.5|home", status: "skipped"       }, // skip
        { publish_key: "spreads|1.5|away", status: "excluded"      }, // skip
      ],
    }],
  };
  const map = extractRetryKeysFromRunRecord(runRecord);
  assert.equal(map.size, 1, "only one fixture has retryable markets");
  const retryKeys = map.get("epl-1");
  assert.ok(Array.isArray(retryKeys), "fixture key must map to an array");
  assert.deepEqual(retryKeys.sort(), ["btts|0", "totals|2.5"].sort());
});

test("extractRetryKeysFromRunRecord omits fully-successful fixtures from the map", () => {
  const runRecord = {
    fixtures: [
      {
        fixture_key: "success-fixture",
        markets: [
          { publish_key: "moneyline|0", status: "created" },
          { publish_key: "btts|0",      status: "existing" },
        ],
      },
    ],
  };
  const map = extractRetryKeysFromRunRecord(runRecord);
  assert.equal(map.size, 0, "fully-successful fixture must not appear in retry map");
});

test("extractRetryKeysFromRunRecord handles multi-fixture runs with mixed outcomes", () => {
  const runRecord = {
    fixtures: [
      {
        fixture_key: "fix-a",
        markets: [
          { publish_key: "moneyline|0", status: "created" },
          { publish_key: "btts|0",      status: "failed"  },
        ],
      },
      {
        fixture_key: "fix-b",
        markets: [
          { publish_key: "moneyline|0", status: "created" },
          { publish_key: "totals|2.5",  status: "created" },
        ],
      },
      {
        fixture_key: "fix-c",
        markets: [
          { publish_key: "totals|1.5",  status: "half_prepared" },
          { publish_key: "btts|0",      status: "half_prepared" },
        ],
      },
    ],
  };
  const map = extractRetryKeysFromRunRecord(runRecord);
  assert.equal(map.size, 2, "only fix-a and fix-c have retryable markets");
  assert.deepEqual(map.get("fix-a"), ["btts|0"]);
  assert.deepEqual(map.get("fix-c").sort(), ["btts|0", "totals|1.5"].sort());
  assert.equal(map.has("fix-b"), false, "fully-successful fixture must not be retried");
});

test("extractRetryKeysFromRunRecord is case-insensitive when reading market statuses", () => {
  const runRecord = {
    fixtures: [{
      fixture_key: "case-test",
      markets: [
        { publish_key: "moneyline|0", status: "FAILED" },
        { publish_key: "btts|0",      status: "Half_Prepared" },
      ],
    }],
  };
  const map = extractRetryKeysFromRunRecord(runRecord);
  assert.equal(map.size, 1);
  assert.deepEqual(map.get("case-test").sort(), ["btts|0", "moneyline|0"].sort());
});

test("extractRetryKeysFromRunRecord excludes fixtures with empty fixture_key", () => {
  const runRecord = {
    fixtures: [{
      fixture_key: "",
      markets: [{ publish_key: "moneyline|0", status: "failed" }],
    }],
  };
  const map = extractRetryKeysFromRunRecord(runRecord);
  assert.equal(map.size, 0, "fixture with blank key must not be added to retry map");
});

// ─── HTTP environment gating ──────────────────────────────────────────────────

test("batch preflight route allows mainnet requests past the environment gate", async (t) => {
  const port = nextPort();
  const started = await startServerForTest({
    cwd: WORKSPACE,
    port,
    env: {
      APP_ENV: "mainnet",
      LEAGUES_CSV_PATH: LEAGUES_CSV,
      TEAMS_CSV_PATH: TEAMS_CSV,
    },
  });
  if (started.skipReason) {
    t.skip(started.skipReason);
    return;
  }
  t.after(async () => started.stop());

  const { status, body } = await postJson(
    `${started.baseUrl}/api/integrations/cms/batch-preflight`,
    {
      environment: "mainnet",
      action: "batch-preflight",
      request_id: "test-gate-1",
      requested_by: "test",
      payload: {
        selected_fixtures: [makeFixture()],
        selected_publish_keys: ["moneyline|0"],
      },
    }
  );
  const issues = body?.extras?.issues || body?.issues || [];
  const blockedByEnvGate = status === 400 && issues.includes("environment");
  assert.equal(blockedByEnvGate, false, "mainnet batch preflight must not be blocked by the environment gate");
});

test("batch publish in UAT still enforces confirmation validation", async (t) => {
  const port = nextPort();
  const started = await startServerForTest({
    cwd: WORKSPACE,
    port,
    env: {
      APP_ENV: "uat",
      LEAGUES_CSV_PATH: LEAGUES_CSV,
      TEAMS_CSV_PATH: TEAMS_CSV,
    },
  });
  if (started.skipReason) {
    t.skip(started.skipReason);
    return;
  }
  t.after(async () => started.stop());

  const { status, body } = await postJson(
    `${started.baseUrl}/api/integrations/cms/batch-publish`,
    {
      environment: "uat",
      action: "batch-publish",
      request_id: "test-gate-2",
      requested_by: "test",
      payload: {
        selected_fixtures: [makeFixture()],
        selected_publish_keys: ["moneyline|0"],
        confirmation: { operator_name: "Op", fixture_count: "1", confirmed: false },
      },
    }
  );
  assert.equal(status, 400, "confirmed=false must be rejected with 400 in UAT too");
  assert.equal(body.ok, false);
  const issues = body?.extras?.issues || body?.issues || [];
  assert.ok(
    issues.some((issue) => String(issue).includes("confirmed")),
    `Expected confirmed issue in response, got: ${JSON.stringify(issues)}`
  );
});

test("batch publish in DEV returns 400 when confirmed is false", async (t) => {
  const port = nextPort();
  const started = await startServerForTest({
    cwd: WORKSPACE,
    port,
    env: {
      APP_ENV: "dev",
      LEAGUES_CSV_PATH: LEAGUES_CSV,
      TEAMS_CSV_PATH: TEAMS_CSV,
    },
  });
  if (started.skipReason) {
    t.skip(started.skipReason);
    return;
  }
  t.after(async () => started.stop());

  const { status, body } = await postJson(
    `${started.baseUrl}/api/integrations/cms/batch-publish`,
    {
      environment: "dev",
      action: "batch-publish",
      request_id: "test-confirm-1",
      requested_by: "test",
      payload: {
        selected_fixtures: [makeFixture()],
        selected_publish_keys: ["moneyline|0"],
        confirmation: { operator_name: "Op", fixture_count: "1", confirmed: false },
      },
    }
  );
  assert.equal(status, 400, "confirmed=false must be rejected with 400");
  assert.equal(body.ok, false);
  const issues = body?.extras?.issues || body?.issues || [];
  assert.ok(
    issues.some((issue) => String(issue).includes("confirmed")),
    `Expected confirmed issue in response, got: ${JSON.stringify(issues)}`
  );
});

test("batch preflight in DEV and UAT both pass the environment gate", async (t) => {
  const port = nextPort();
  const started = await startServerForTest({
    cwd: WORKSPACE,
    port,
    env: {
      APP_ENV: "dev",
      LEAGUES_CSV_PATH: LEAGUES_CSV,
      TEAMS_CSV_PATH: TEAMS_CSV,
      // No CMS URL or DB config intentionally — only the env gate is being tested
    },
  });
  if (started.skipReason) {
    t.skip(started.skipReason);
    return;
  }
  t.after(async () => started.stop());

  // A UAT request on the same server should also pass the environment gate now.
  const uatResponse = await postJson(
    `${started.baseUrl}/api/integrations/cms/batch-preflight`,
    {
      environment: "uat",
      action: "batch-preflight",
      request_id: "test-gate-dev-server",
      requested_by: "test",
      payload: {
        selected_fixtures: [makeFixture()],
        selected_publish_keys: ["moneyline|0"],
      },
    }
  );
  const uatIssues = uatResponse.body?.extras?.issues || uatResponse.body?.issues || [];
  const uatBlockedByEnvGate = uatResponse.status === 400 && uatIssues.includes("environment");
  assert.equal(uatBlockedByEnvGate, false, "UAT request on DEV server must not be blocked by the environment gate");

  // A DEV request passes the env gate — the response may be 400 (missing config),
  // 503 (CMS disabled / no DB), or 500 (internal error from missing config) but it
  // must NOT be 400 with an "environment" issue, which would indicate the gate blocked it.
  const devResponse = await postJson(
    `${started.baseUrl}/api/integrations/cms/batch-preflight`,
    {
      environment: "dev",
      action: "batch-preflight",
      request_id: "test-dev-passthru",
      requested_by: "test",
      payload: {
        selected_fixtures: [makeFixture()],
        selected_publish_keys: ["moneyline|0"],
      },
    }
  );
  const devIssues = devResponse.body?.extras?.issues || devResponse.body?.issues || [];
  const blockedByEnvGate = devResponse.status === 400 && devIssues.includes("environment");
  assert.equal(blockedByEnvGate, false, "DEV request must not be blocked by the environment gate");
});

// ─── Stop endpoint ────────────────────────────────────────────────────────────

test("batch stop returns 404 for unknown run ID", async (t) => {
  const port = nextPort();
  const started = await startServerForTest({
    cwd: WORKSPACE,
    port,
    env: {
      APP_ENV: "dev",
      LEAGUES_CSV_PATH: LEAGUES_CSV,
      TEAMS_CSV_PATH: TEAMS_CSV,
    },
  });
  if (started.skipReason) {
    t.skip(started.skipReason);
    return;
  }
  t.after(async () => started.stop());

  const res = await fetch(`${started.baseUrl}/api/integrations/cms/batch-runs/nonexistent-run-id/stop`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({}),
  });
  const body = await res.json();
  assert.equal(res.status, 404, "unknown run ID must return 404");
  assert.equal(body.ok, false);
});

test("batch stop returns 405 for GET requests", async (t) => {
  const port = nextPort();
  const started = await startServerForTest({
    cwd: WORKSPACE,
    port,
    env: {
      APP_ENV: "dev",
      LEAGUES_CSV_PATH: LEAGUES_CSV,
      TEAMS_CSV_PATH: TEAMS_CSV,
    },
  });
  if (started.skipReason) {
    t.skip(started.skipReason);
    return;
  }
  t.after(async () => started.stop());

  const res = await fetch(`${started.baseUrl}/api/integrations/cms/batch-runs/any-run-id/stop`, {
    method: "GET",
  });
  const body = await res.json();
  assert.equal(res.status, 405, "GET on stop endpoint must return 405 Method Not Allowed");
  assert.equal(body.ok, false);
});
