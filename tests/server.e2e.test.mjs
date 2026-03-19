import test from "node:test";
import assert from "node:assert/strict";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { getBasicAuthHeader, startServerForTest } from "./helpers/serverHarness.mjs";

const __filename = fileURLToPath(import.meta.url);
const WORKSPACE = path.resolve(path.dirname(__filename), "..");
const LEAGUES_CSV = `${WORKSPACE}/Info-source/leagues.csv`;
const TEAMS_CSV = `${WORKSPACE}/Info-source/teams.csv`;
const EPL_SCHEDULE_FIXTURE = `${WORKSPACE}/tests/fixtures/epl_schedule.sample.json`;
const UCL_SCHEDULE_FIXTURE = `${WORKSPACE}/tests/fixtures/ucl_schedule.sample.json`;
const LALIGA_SCHEDULE_FIXTURE = `${WORKSPACE}/tests/fixtures/laliga_schedule.sample.json`;

function nextPort() {
  return 24000 + Math.floor(Math.random() * 2000);
}

test("server e2e: static auth, api auth, and rate limiting", async (t) => {
  const port = nextPort();
  const basicUser = "tester";
  const basicPass = "secret";
  const bearer = "api-test-token";

  const started = await startServerForTest({
    cwd: WORKSPACE,
    port,
    env: {
      LEAGUES_CSV_PATH: LEAGUES_CSV,
      TEAMS_CSV_PATH: TEAMS_CSV,
      APP_BASIC_AUTH_USER: basicUser,
      APP_BASIC_AUTH_PASS: basicPass,
      API_BEARER_TOKEN: bearer,
      API_RATE_MAX_REQUESTS: "6",
      API_RATE_WINDOW_MS: "60000",
      SPORTSDATA_EPL_SCHEDULE_FIXTURE_PATH: EPL_SCHEDULE_FIXTURE,
      SCHEDULE_NOW_ISO: "2026-03-16T14:00:00Z",
    },
  });

  if (started.skipReason) {
    t.skip(started.skipReason);
    return;
  }

  t.after(async () => {
    await started.stop();
  });

  const basicAuth = getBasicAuthHeader(basicUser, basicPass);

  const health = await fetch(`${started.baseUrl}/api/healthz`);
  assert.equal(health.status, 200);
  const healthBody = await health.json();
  assert.equal(healthBody?.status, "ok");

  const ready = await fetch(`${started.baseUrl}/api/readyz`);
  assert.equal(ready.status, 200);
  const readyBody = await ready.json();
  assert.equal(readyBody?.status, "ready");

  const staticDenied = await fetch(`${started.baseUrl}/`);
  assert.equal(staticDenied.status, 401);
  assert.match(String(staticDenied.headers.get("www-authenticate") || ""), /Basic/i);

  const staticAllowed = await fetch(`${started.baseUrl}/`, {
    headers: { Authorization: basicAuth },
  });
  assert.equal(staticAllowed.status, 200);
  const html = await staticAllowed.text();
  assert.match(html, /Fixture & Parent Market Verifier/i);

  const apiDenied = await fetch(`${started.baseUrl}/api/catalog/meta`);
  assert.equal(apiDenied.status, 401);

  const apiAllowed = await fetch(`${started.baseUrl}/api/catalog/meta`, {
    headers: { Authorization: `Bearer ${bearer}` },
  });
  assert.equal(apiAllowed.status, 200);
  const meta = await apiAllowed.json();
  assert.equal(typeof meta?.counts?.leagues, "number");
  assert.equal(typeof meta?.counts?.teams, "number");

  const schedules = await fetch(`${started.baseUrl}/api/schedules/upcoming?league=epl`, {
    headers: { Authorization: `Bearer ${bearer}` },
  });
  assert.equal(schedules.status, 200);
  const scheduleBody = await schedules.json();
  assert.equal(scheduleBody?.league, "epl");
  assert.equal(scheduleBody?.reference_now, "2026-03-16T14:00:00.000Z");
  assert.equal(scheduleBody?.selected_week, 30);
  assert.deepEqual(scheduleBody?.selected_weeks, [30, 31]);
  assert.equal(scheduleBody?.selected_label, "Matchdays 30-31");
  assert.equal(scheduleBody?.selection_mode, "immediate-six-weeks");
  assert.equal(Array.isArray(scheduleBody?.fixtures), true);
  assert.equal(scheduleBody.fixtures.length, 3);
  assert.equal(scheduleBody.fixtures[0]?.eventName, "Brentford FC vs Wolverhampton Wanderers FC");
  assert.equal(scheduleBody.fixtures[0]?.gameId, "900002");
  assert.equal(scheduleBody.fixtures[0]?.game_id, "900002");
  assert.equal(scheduleBody.fixtures[1]?.eventName, "AFC Bournemouth vs Manchester United FC");

  const rateStatuses = [];
  for (let i = 0; i < 8; i += 1) {
    const response = await fetch(`${started.baseUrl}/api/catalog/meta`, {
      headers: { Authorization: `Bearer ${bearer}` },
    });
    rateStatuses.push(response.status);
  }
  assert.ok(rateStatuses.includes(429), `Expected at least one 429 status. Got: ${rateStatuses.join(",")}`);
});

test("server e2e: multi-league schedule contracts stay normalized across providers", async (t) => {
  const port = nextPort();
  const bearer = "api-test-token";

  const started = await startServerForTest({
    cwd: WORKSPACE,
    port,
    env: {
      LEAGUES_CSV_PATH: LEAGUES_CSV,
      TEAMS_CSV_PATH: TEAMS_CSV,
      API_BEARER_TOKEN: bearer,
      SPORTSDATA_EPL_SCHEDULE_FIXTURE_PATH: EPL_SCHEDULE_FIXTURE,
      SPORTSDATA_UCL_SCHEDULE_FIXTURE_PATH: UCL_SCHEDULE_FIXTURE,
      SPORTSDATA_LALIGA_SCHEDULE_FIXTURE_PATH: LALIGA_SCHEDULE_FIXTURE,
      SCHEDULE_NOW_ISO: "2026-03-18T14:00:00Z",
    },
  });

  if (started.skipReason) {
    t.skip(started.skipReason);
    return;
  }

  t.after(async () => {
    await started.stop();
  });

  const authHeaders = { Authorization: `Bearer ${bearer}` };

  const eplResponse = await fetch(`${started.baseUrl}/api/schedules/upcoming?league=epl`, {
    headers: authHeaders,
  });
  assert.equal(eplResponse.status, 200);
  const eplBody = await eplResponse.json();
  assert.equal(eplBody?.league, "epl");
  assert.equal(eplBody?.selection_mode, "immediate-six-weeks");
  assert.equal(eplBody?.selected_week, 31);
  assert.deepEqual(eplBody?.selected_weeks, [31]);
  assert.equal(eplBody?.fixtures?.length, 2);
  assert.equal(eplBody?.fixtures?.[0]?.eventName, "AFC Bournemouth vs Manchester United FC");
  assert.equal(eplBody?.fixtures?.[0]?.gameId, "900003");

  const uclResponse = await fetch(`${started.baseUrl}/api/schedules/upcoming?league=ucl`, {
    headers: authHeaders,
  });
  assert.equal(uclResponse.status, 200);
  const uclBody = await uclResponse.json();
  assert.equal(uclBody?.league, "ucl");
  assert.equal(uclBody?.selection_mode, "immediate-six-weeks");
  assert.equal(uclBody?.selected_week, 16);
  assert.deepEqual(uclBody?.selected_weeks, [16, 17]);
  assert.equal(uclBody?.fixtures?.length, 3);
  assert.equal(uclBody?.fixtures?.[0]?.eventName, "FC Barcelona vs Newcastle United FC");
  assert.equal(uclBody?.fixtures?.[2]?.game_id, "910201");

  const laligaResponse = await fetch(`${started.baseUrl}/api/schedules/upcoming?league=laliga`, {
    headers: authHeaders,
  });
  assert.equal(laligaResponse.status, 200);
  const laligaBody = await laligaResponse.json();
  assert.equal(laligaBody?.league, "laliga");
  assert.equal(laligaBody?.selection_mode, "immediate-six-weeks");
  assert.equal(laligaBody?.selected_week, 29);
  assert.deepEqual(laligaBody?.selected_weeks, [29, 30]);
  assert.equal(laligaBody?.fixtures?.length, 3);
  assert.equal(laligaBody?.fixtures?.[0]?.eventName, "Villarreal CF vs Real Sociedad de Fútbol");
  assert.equal(laligaBody?.fixtures?.[2]?.gameId, "920201");
});

test("server e2e: schedule endpoint validates request params and surfaces provider failures", async (t) => {
  const port = nextPort();
  const bearer = "api-test-token";

  const started = await startServerForTest({
    cwd: WORKSPACE,
    port,
    env: {
      LEAGUES_CSV_PATH: LEAGUES_CSV,
      TEAMS_CSV_PATH: TEAMS_CSV,
      API_BEARER_TOKEN: bearer,
      SPORTSDATA_EPL_SCHEDULE_FIXTURE_PATH: "",
      SPORTSDATA_UCL_SCHEDULE_FIXTURE_PATH: "",
      SPORTSDATA_LALIGA_SCHEDULE_FIXTURE_PATH: "",
      SPORTSDATA_API_KEY: "",
      SCHEDULE_NOW_ISO: "2026-03-18T14:00:00Z",
    },
  });

  if (started.skipReason) {
    t.skip(started.skipReason);
    return;
  }

  t.after(async () => {
    await started.stop();
  });

  const authHeaders = { Authorization: `Bearer ${bearer}` };

  const unsupportedLeague = await fetch(`${started.baseUrl}/api/schedules/upcoming?league=seriea`, {
    headers: authHeaders,
  });
  assert.equal(unsupportedLeague.status, 400);
  assert.match(String((await unsupportedLeague.json())?.detail || ""), /\?league=epl, \?league=ucl, or \?league=laliga/i);

  const invalidNow = await fetch(`${started.baseUrl}/api/schedules/upcoming?league=epl&now=not-a-date`, {
    headers: authHeaders,
  });
  assert.equal(invalidNow.status, 400);
  assert.match(String((await invalidNow.json())?.detail || ""), /valid ISO-8601 UTC timestamp/i);

  const missingProviderConfig = await fetch(`${started.baseUrl}/api/schedules/upcoming?league=epl`, {
    headers: authHeaders,
  });
  assert.equal(missingProviderConfig.status, 502);
  const missingProviderBody = await missingProviderConfig.json();
  assert.equal(missingProviderBody?.error, "Failed to load schedule data");
  assert.match(String(missingProviderBody?.detail || ""), /SPORTSDATA_API_KEY is not configured on the server/i);
  assert.equal(missingProviderBody?.league, "epl");
});
