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
  return 36000 + Math.floor(Math.random() * 1000);
}

async function fetchManual(url, init = {}) {
  const response = await fetch(url, { redirect: "manual", ...init });
  const body = await response.text();
  return { response, body };
}

test("OAuth mode rejects unauthenticated API requests when no bearer token is configured", async (t) => {
  const port = nextPort();
  const baseUrl = `http://127.0.0.1:${port}`;
  const started = await startServerForTest({
    cwd: WORKSPACE,
    port,
    env: {
      LEAGUES_CSV_PATH: LEAGUES_CSV,
      TEAMS_CSV_PATH: TEAMS_CSV,
      GOOGLE_CLIENT_ID: "test-client-id",
      GOOGLE_CLIENT_SECRET: "test-client-secret",
      PUBLIC_BASE_URL: baseUrl,
      API_BEARER_TOKEN: "",
    },
  });
  if (started.skipReason) {
    t.skip(started.skipReason);
    return;
  }
  t.after(async () => {
    await started.stop();
  });

  const { response, body } = await fetchManual(`${baseUrl}/api/runtime/environment`);
  assert.equal(response.status, 401);
  assert.match(String(response.headers.get("www-authenticate") || ""), /Bearer/i);
  assert.match(body, /Unauthorized/i);
});

test("OAuth callback consumes state even on error responses", async (t) => {
  const port = nextPort();
  const baseUrl = `http://127.0.0.1:${port}`;
  const started = await startServerForTest({
    cwd: WORKSPACE,
    port,
    env: {
      LEAGUES_CSV_PATH: LEAGUES_CSV,
      TEAMS_CSV_PATH: TEAMS_CSV,
      GOOGLE_CLIENT_ID: "test-client-id",
      GOOGLE_CLIENT_SECRET: "test-client-secret",
      PUBLIC_BASE_URL: baseUrl,
      API_BEARER_TOKEN: "test-bearer",
    },
  });
  if (started.skipReason) {
    t.skip(started.skipReason);
    return;
  }
  t.after(async () => {
    await started.stop();
  });

  const start = await fetchManual(`${baseUrl}/auth/google`);
  assert.equal(start.response.status, 302);
  const location = String(start.response.headers.get("location") || "");
  const authUrl = new URL(location);
  const state = authUrl.searchParams.get("state");
  assert.ok(state);

  const first = await fetchManual(
    `${baseUrl}/auth/google/callback?error=access_denied&state=${encodeURIComponent(state)}`
  );
  assert.equal(first.response.status, 400);

  const replay = await fetchManual(
    `${baseUrl}/auth/google/callback?code=fake-code&state=${encodeURIComponent(state)}`
  );
  // If state was consumed by the first callback, replay must be rejected as invalid/expired.
  assert.equal(replay.response.status, 400);
  assert.match(replay.body, /invalid or expired state/i);
});
