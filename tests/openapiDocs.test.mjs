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
  return 37000 + Math.floor(Math.random() * 1000);
}

test("OpenAPI endpoints are served", async (t) => {
  const started = await startServerForTest({
    cwd: WORKSPACE,
    port: nextPort(),
    env: {
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

  const jsonRes = await fetch(`${started.baseUrl}/api/openapi.json`);
  assert.equal(jsonRes.status, 200);
  const jsonBody = await jsonRes.json();
  assert.equal(jsonBody.openapi, "3.0.3");

  const yamlRes = await fetch(`${started.baseUrl}/api/openapi.yaml`);
  assert.equal(yamlRes.status, 200);
  const yamlBody = await yamlRes.text();
  assert.match(yamlBody, /openapi:\s*3\.0\.3/i);

  const docsRes = await fetch(`${started.baseUrl}/api/docs`);
  assert.equal(docsRes.status, 200);
  assert.match(String(docsRes.headers.get("content-type") || ""), /text\/html/i);
  const docsHtml = await docsRes.text();
  assert.match(docsHtml, /redoc/i);
});
