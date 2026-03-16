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
  assert.equal(scheduleBody?.selected_label, "Matchday 30");
  assert.equal(Array.isArray(scheduleBody?.fixtures), true);
  assert.equal(scheduleBody.fixtures.length, 1);
  assert.equal(scheduleBody.fixtures[0]?.eventName, "Brentford FC vs Wolverhampton Wanderers FC");

  const rateStatuses = [];
  for (let i = 0; i < 8; i += 1) {
    const response = await fetch(`${started.baseUrl}/api/catalog/meta`, {
      headers: { Authorization: `Bearer ${bearer}` },
    });
    rateStatuses.push(response.status);
  }
  assert.ok(rateStatuses.includes(429), `Expected at least one 429 status. Got: ${rateStatuses.join(",")}`);
});
