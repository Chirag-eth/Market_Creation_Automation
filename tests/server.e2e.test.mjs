import test from "node:test";
import assert from "node:assert/strict";
import http from "node:http";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { getBasicAuthHeader, startServerForTest } from "./helpers/serverHarness.mjs";

const __filename = fileURLToPath(import.meta.url);
const WORKSPACE = path.resolve(path.dirname(__filename), "..");
const LEAGUES_CSV = `${WORKSPACE}/catalog/leagues-main.csv`;
const TEAMS_CSV = `${WORKSPACE}/catalog/teams-main.csv`;
const EXTRA_LEAGUES_CSV = `${WORKSPACE}/tests/fixtures/catalog_extra_leagues.sample.csv`;
const EXTRA_TEAMS_CSV = `${WORKSPACE}/tests/fixtures/catalog_extra_teams.sample.csv`;
const EPL_SCHEDULE_FIXTURE = `${WORKSPACE}/tests/fixtures/epl_schedule.sample.json`;
const UCL_SCHEDULE_FIXTURE = `${WORKSPACE}/tests/fixtures/ucl_schedule.sample.json`;
const LALIGA_SCHEDULE_FIXTURE = `${WORKSPACE}/tests/fixtures/laliga_schedule.sample.json`;
const FIFA_FRIENDLIES_SCHEDULE_FIXTURE = `${WORKSPACE}/tests/fixtures/fifa_friendlies_schedule.sample.json`;

function nextPort() {
  return 24000 + Math.floor(Math.random() * 2000);
}

async function startCmsStub({
  port,
  failStep = "",
  expectedBearer = "",
} = {}) {
  const requests = [];
  const server = http.createServer(async (req, res) => {
    const chunks = [];
    for await (const chunk of req) {
      chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(String(chunk || "")));
    }
    const raw = Buffer.concat(chunks).toString("utf8");
    const body = raw ? JSON.parse(raw) : null;
    requests.push({
      method: req.method,
      url: req.url,
      authorization: String(req.headers.authorization || ""),
      body,
    });

    if (expectedBearer) {
      assert.equal(req.headers.authorization, `Bearer ${expectedBearer}`);
    }

    const stepKey =
      req.url === "/api/v1/cms/internal/fixtures/"
        ? "fixture"
        : req.url === "/api/v1/cms/internal/type-reference"
          ? "type_reference"
          : req.url === "/api/v1/cms/internal/parent-and-market/"
            ? "parent_market"
            : "unknown";

    if (stepKey === failStep) {
      res.writeHead(500, { "Content-Type": "application/json; charset=utf-8" });
      res.end(JSON.stringify({ ok: false, step: stepKey }));
      return;
    }

    res.writeHead(200, { "Content-Type": "application/json; charset=utf-8" });
    res.end(JSON.stringify({ ok: true, step: stepKey, id: `${stepKey}-created` }));
  });

  await new Promise((resolve, reject) => {
    server.once("error", reject);
    server.listen(port, "127.0.0.1", resolve);
  });

  return {
    baseUrl: `http://127.0.0.1:${port}`,
    requests,
    close: () =>
      new Promise((resolve) => {
        server.close(() => resolve());
      }),
  };
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

  const apiDeniedWithBasicOnly = await fetch(`${started.baseUrl}/api/catalog/meta`, {
    headers: { Authorization: basicAuth },
  });
  assert.equal(apiDeniedWithBasicOnly.status, 401);

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

test("server e2e: runtime environment can switch between Mainnet and UAT without restart", async (t) => {
  const port = nextPort();
  const bearer = "api-test-token";

  const started = await startServerForTest({
    cwd: WORKSPACE,
    port,
    env: {
      APP_ENV: "mainnet",
      API_BEARER_TOKEN: bearer,
      LEAGUES_CSV_PATH: LEAGUES_CSV,
      TEAMS_CSV_PATH: TEAMS_CSV,
    },
  });

  if (started.skipReason) {
    t.skip(started.skipReason);
    return;
  }

  t.after(async () => {
    await started.stop();
  });

  const headers = {
    Authorization: `Bearer ${bearer}`,
    "Content-Type": "application/json",
  };

  const initialResponse = await fetch(`${started.baseUrl}/api/runtime/environment`, {
    headers: { Authorization: `Bearer ${bearer}` },
  });
  assert.equal(initialResponse.status, 200);
  const initialPayload = await initialResponse.json();
  assert.equal(initialPayload?.active_env?.code, "mainnet");
  assert.equal(initialPayload?.active_env?.label, "Mainnet");

  const switchToUatResponse = await fetch(`${started.baseUrl}/api/runtime/environment`, {
    method: "POST",
    headers,
    body: JSON.stringify({ app_env: "uat" }),
  });
  assert.equal(switchToUatResponse.status, 200);
  const switchToUatPayload = await switchToUatResponse.json();
  assert.equal(switchToUatPayload?.active_env?.code, "uat");
  assert.equal(switchToUatPayload?.active_env?.label, "UAT");

  const metaAfterUatResponse = await fetch(`${started.baseUrl}/api/catalog/meta`, {
    headers: { Authorization: `Bearer ${bearer}` },
  });
  assert.equal(metaAfterUatResponse.status, 200);
  const metaAfterUat = await metaAfterUatResponse.json();
  assert.equal(metaAfterUat?.source?.environment?.app_env, "uat");
  assert.equal(metaAfterUat?.source?.environment?.app_env_label, "UAT");

  const switchToMainnetResponse = await fetch(`${started.baseUrl}/api/runtime/environment`, {
    method: "POST",
    headers,
    body: JSON.stringify({ app_env: "mainnet" }),
  });
  assert.equal(switchToMainnetResponse.status, 200);
  const switchToMainnetPayload = await switchToMainnetResponse.json();
  assert.equal(switchToMainnetPayload?.active_env?.code, "mainnet");
  assert.equal(switchToMainnetPayload?.active_env?.label, "Mainnet");
});

test("server e2e: CMS publish posts fixture, type reference, and parent market in order", async (t) => {
  const port = nextPort();
  const cmsPort = nextPort();
  const bearer = "api-test-token";
  const cmsBearer = "cms-test-token";

  const cms = await startCmsStub({ port: cmsPort, expectedBearer: cmsBearer });
  t.after(async () => {
    await cms.close();
  });

  const started = await startServerForTest({
    cwd: WORKSPACE,
    port,
    env: {
      APP_ENV: "mainnet",
      API_BEARER_TOKEN: bearer,
      LEAGUES_CSV_PATH: LEAGUES_CSV,
      TEAMS_CSV_PATH: TEAMS_CSV,
      COMP_SERVICE_INTERNAL_HOST: cms.baseUrl,
      COMP_SERVICE_INTERNAL_BEARER_TOKEN: cmsBearer,
    },
  });

  if (started.skipReason) {
    t.skip(started.skipReason);
    return;
  }

  t.after(async () => {
    await started.stop();
  });

  const response = await fetch(`${started.baseUrl}/api/cms/publish`, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${bearer}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      fixture_json: { name: "Fulham vs Aston Villa" },
      type_reference_payloads: {
        fixture: { canonical_name: "fulham-vs-aston-villa-2026-04-25" },
      },
      uat_parent_payloads: {
        moneyline: { parent_market: { title: "Fulham vs Aston Villa" }, markets: [] },
      },
      parent_market_family: "moneyline",
    }),
  });

  assert.equal(response.status, 200);
  const body = await response.json();
  assert.equal(body?.ok, true);
  assert.equal(body?.failed_step, null);
  assert.equal(body?.environment?.code, "mainnet");
  assert.equal(body?.requested_family, "moneyline");
  assert.deepEqual(
    body?.steps?.map((step) => step.key),
    ["fixture", "type_reference", "parent_market"]
  );
  assert.deepEqual(
    cms.requests.map((request) => request.url),
    [
      "/api/v1/cms/internal/fixtures/",
      "/api/v1/cms/internal/type-reference",
      "/api/v1/cms/internal/parent-and-market/",
    ]
  );
  assert.deepEqual(cms.requests[0]?.body, { name: "Fulham vs Aston Villa" });
  assert.deepEqual(cms.requests[1]?.body, { canonical_name: "fulham-vs-aston-villa-2026-04-25" });
  assert.deepEqual(cms.requests[2]?.body, { parent_market: { title: "Fulham vs Aston Villa" }, markets: [] });
});

test("server e2e: CMS publish stops when an intermediate step fails", async (t) => {
  const port = nextPort();
  const cmsPort = nextPort();
  const bearer = "api-test-token";

  const cms = await startCmsStub({ port: cmsPort, failStep: "type_reference" });
  t.after(async () => {
    await cms.close();
  });

  const started = await startServerForTest({
    cwd: WORKSPACE,
    port,
    env: {
      APP_ENV: "mainnet",
      API_BEARER_TOKEN: bearer,
      LEAGUES_CSV_PATH: LEAGUES_CSV,
      TEAMS_CSV_PATH: TEAMS_CSV,
      COMP_SERVICE_INTERNAL_HOST: cms.baseUrl,
    },
  });

  if (started.skipReason) {
    t.skip(started.skipReason);
    return;
  }

  t.after(async () => {
    await started.stop();
  });

  const response = await fetch(`${started.baseUrl}/api/cms/publish`, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${bearer}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      fixture_payload: { name: "Fixture One" },
      type_reference_payload: { canonical_name: "fixture-one-2026-04-25" },
      parent_market_payload: { parent_market: { title: "Fixture One" }, markets: [] },
    }),
  });

  assert.equal(response.status, 502);
  const body = await response.json();
  assert.equal(body?.ok, false);
  assert.equal(body?.failed_step, "type_reference");
  assert.deepEqual(
    cms.requests.map((request) => request.url),
    [
      "/api/v1/cms/internal/fixtures/",
      "/api/v1/cms/internal/type-reference",
    ]
  );
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
      POLYMARKET_SCHEDULE_ENABLED: "0",
      LSPORTS_SCHEDULE_CSV_PATH: `${WORKSPACE}/tests/fixtures/does-not-exist.csv`,
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

  const unsupportedLeague = await fetch(`${started.baseUrl}/api/schedules/upcoming?league=unknown-league`, {
    headers: authHeaders,
  });
  assert.equal(unsupportedLeague.status, 400);
  assert.match(
    String((await unsupportedLeague.json())?.detail || ""),
    /\?league=epl, \?league=ucl, \?league=laliga, \?league=seriea, \?league=bundesliga, \?league=ligue1, \?league=europa, \?league=fifa-worldcup, or \?league=fifa-friendlies/i
  );

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

test("server e2e: supplemental catalog CSVs merge into the source of truth", async (t) => {
  const port = nextPort();
  const bearer = "api-test-token";

  const started = await startServerForTest({
    cwd: WORKSPACE,
    port,
    env: {
      LEAGUES_CSV_PATH: LEAGUES_CSV,
      TEAMS_CSV_PATH: TEAMS_CSV,
      EXTRA_LEAGUES_CSV_PATHS: EXTRA_LEAGUES_CSV,
      EXTRA_TEAMS_CSV_PATHS: EXTRA_TEAMS_CSV,
      SPORTSDATA_FIFA_FRIENDLIES_SCHEDULE_FIXTURE_PATH: FIFA_FRIENDLIES_SCHEDULE_FIXTURE,
      API_BEARER_TOKEN: bearer,
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

  const metaResponse = await fetch(`${started.baseUrl}/api/catalog/meta`, {
    headers: authHeaders,
  });
  assert.equal(metaResponse.status, 200);
  const meta = await metaResponse.json();
  assert.equal(meta?.counts?.leagues, 5);
  assert.equal(meta?.counts?.teams, 120);
  assert.equal(meta?.source?.label, "CSV files (env override) + supplemental CSV files");
  assert.deepEqual(meta?.source?.supplemental_leagues_files, ["catalog_extra_leagues.sample.csv"]);
  assert.deepEqual(meta?.source?.supplemental_teams_files, ["catalog_extra_teams.sample.csv"]);

  const catalogResponse = await fetch(`${started.baseUrl}/api/catalog`, {
    headers: authHeaders,
  });
  assert.equal(catalogResponse.status, 200);
  const catalog = await catalogResponse.json();
  assert.equal(catalog?.counts?.leagues, 5);
  assert.equal(catalog?.counts?.teams, 120);
  assert.equal(
    catalog?.leagues?.some((league) => league?.league_id === "b6e39e21-8fdf-44ee-9fd0-abe8578854a6"),
    true
  );
  assert.equal(
    catalog?.teams?.some((team) => team?.team_id === "f11b97f6-54f4-4e07-88d0-2143fbfbb656"),
    true
  );
  assert.equal(
    catalog?.teams?.some((team) => team?.team_id === "efcc800b-92c3-4327-9955-1c8de62cb556"),
    true
  );
  assert.ok(Array.isArray(catalog?.schedule_support?.ready_leagues));
  assert.equal(catalog.schedule_support.ready_leagues.includes("fifa-friendlies"), true);
});

test("server e2e: supplemental CSVs stay opt-in and do not auto-merge from Downloads", async (t) => {
  const port = nextPort();
  const bearer = "api-test-token";

  const started = await startServerForTest({
    cwd: WORKSPACE,
    port,
    env: {
      LEAGUES_CSV_PATH: LEAGUES_CSV,
      TEAMS_CSV_PATH: TEAMS_CSV,
      EXTRA_LEAGUES_CSV_PATHS: "",
      EXTRA_TEAMS_CSV_PATHS: "",
      API_BEARER_TOKEN: bearer,
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
  const metaResponse = await fetch(`${started.baseUrl}/api/catalog/meta`, {
    headers: authHeaders,
  });
  assert.equal(metaResponse.status, 200);
  const meta = await metaResponse.json();
  assert.deepEqual(meta?.source?.supplemental_leagues_files, []);
  assert.deepEqual(meta?.source?.supplemental_teams_files, []);

  const catalogResponse = await fetch(`${started.baseUrl}/api/catalog`, {
    headers: authHeaders,
  });
  assert.equal(catalogResponse.status, 200);
  const catalog = await catalogResponse.json();
  assert.equal(catalog?.counts?.leagues, 4);
  assert.equal(catalog?.counts?.teams, 120);
});
