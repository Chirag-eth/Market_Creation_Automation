import test from "node:test";
import assert from "node:assert/strict";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { startServerForTest } from "./helpers/serverHarness.mjs";

const __filename = fileURLToPath(import.meta.url);
const WORKSPACE = path.resolve(path.dirname(__filename), "..");
const LEAGUES_CSV = `${WORKSPACE}/Info-source/leagues.csv`;
const TEAMS_CSV = `${WORKSPACE}/Info-source/teams.csv`;

function nextPort() {
  return 27000 + Math.floor(Math.random() * 1000);
}

test("browser e2e: dashboard shell loads", async (t) => {
  let playwright;
  try {
    playwright = await import("playwright");
  } catch {
    t.skip("Playwright is not installed in this environment.");
    return;
  }

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

  let browser;
  try {
    browser = await playwright.chromium.launch({ headless: true });
  } catch (error) {
    await started.stop();
    t.skip(`Playwright browser runtime unavailable: ${String(error?.message || error)}`);
    return;
  }

  t.after(async () => {
    try {
      await browser.close();
    } finally {
      await started.stop();
    }
  });

  const page = await browser.newPage();
  await page.goto(`${started.baseUrl}/`, { waitUntil: "domcontentloaded" });

  await page.waitForSelector("h1");
  const heading = await page.textContent("h1");
  assert.match(String(heading || ""), /Fixture & Parent Market Verifier/i);

  const hasFixtureJsonInput = await page.$("#fixtureInputJson");
  assert.ok(hasFixtureJsonInput, "Expected fixture JSON input to be present.");

  const hasEventInput = await page.$("#generateEventNameInput");
  assert.ok(hasEventInput, "Expected event-name generator input to be present.");
});
