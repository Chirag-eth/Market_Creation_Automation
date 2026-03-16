import test from "node:test";
import assert from "node:assert/strict";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { startServerForTest } from "./helpers/serverHarness.mjs";

const __filename = fileURLToPath(import.meta.url);
const WORKSPACE = path.resolve(path.dirname(__filename), "..");
const LEAGUES_CSV = `${WORKSPACE}/Info-source/leagues.csv`;
const TEAMS_CSV = `${WORKSPACE}/Info-source/teams.csv`;
const EPL_SCHEDULE_FIXTURE = `${WORKSPACE}/tests/fixtures/epl_schedule.sample.json`;

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
      SPORTSDATA_EPL_SCHEDULE_FIXTURE_PATH: EPL_SCHEDULE_FIXTURE,
      SCHEDULE_NOW_ISO: "2026-03-16T14:00:00Z",
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
  await page.addInitScript(() => {
    localStorage.setItem(
      "fixture-ocr-market-builder-state-v1",
      JSON.stringify({
        runtime: {
          scheduleSnapshotVersion: 3,
          referenceNowIso: "2026-03-16T14:00:00.000Z",
          scheduleSnapshots: {
            epl: {
              fetchedAt: "2026-03-16T14:00:00.000Z",
              referenceNowIso: "2026-03-16T14:00:00.000Z",
              selectedWeek: 32,
              selectedLabel: "Matchday 32",
              selectionMode: "immediate-week",
              fixtures: [
                {
                  gameId: "stale-fixture",
                  matchDay: 32,
                  eventName: "Stale Snapshot FC vs Placeholder United",
                  fixtureDate: "2026-03-27",
                  kickoffTimeUtc: "20:00",
                  kickoffIso: "2026-03-27T20:00:00.000Z",
                  status: "Scheduled",
                  isClosed: false,
                  optionLabel: "Stale Snapshot FC vs Placeholder United · Fri, Mar 27 · 20:00 UTC · Matchday 32",
                },
              ],
            },
          },
        },
      })
    );
  });
  await page.goto(`${started.baseUrl}/`, { waitUntil: "domcontentloaded" });

  await page.waitForSelector("h1");
  const heading = await page.textContent("h1");
  assert.match(String(heading || ""), /Fixture & Parent Market Verifier/i);

  const hasFixtureJsonInput = await page.$("#fixtureInputJson");
  assert.ok(hasFixtureJsonInput, "Expected fixture JSON input to be present.");

  const hasEventInput = await page.$("#generateEventNameInput");
  assert.ok(hasEventInput, "Expected event-name generator input to be present.");

  await page.selectOption("#generateLeagueSelect", "de1bd252-baf5-4417-89ba-77d635f5f8f0");
  await page.waitForFunction(() => {
    const status = document.querySelector("#generateScheduleStatus");
    return status && /Matchdays 30-31/i.test(status.textContent || "");
  });

  const summary = await page.textContent("#generateFixtureSummary");
  assert.match(String(summary || ""), /EPL/i);
  assert.match(String(summary || ""), /Matchdays 30-31/i);

  const activeSummaryBefore = await page.textContent("#generateFixtureActiveTitle");
  assert.equal(String(activeSummaryBefore || ""), "");

  const cardCount = await page.locator(".schedule-fixture-btn").count();
  assert.equal(cardCount, 3);

  await page.fill("#generateFixtureSearchInput", "Brentford");
  const filteredCardCount = await page.locator(".schedule-fixture-btn").count();
  assert.equal(filteredCardCount, 1);

  const optionCount = await page.locator("#generateEventFixtureSelect option").count();
  assert.equal(optionCount, 4, `Expected three upcoming fixture options plus the placeholder. Got ${optionCount}.`);

  await page.focus("#generateFixtureSearchInput");
  await page.keyboard.press("ArrowDown");
  await page.keyboard.press("Enter");
  await page.waitForFunction(() => {
    const input = document.querySelector("#generateEventNameInput");
    return input && input.value === "Brentford FC vs Wolverhampton Wanderers FC";
  });

  assert.equal(await page.inputValue("#generateFixtureDateInput"), "2026-03-16");
  assert.equal(await page.inputValue("#generateKickoffTimeInput"), "20:00");
  assert.equal(await page.inputValue("#generateMatchDayInput"), "30");

  const activeSummaryAfter = await page.textContent("#generateFixtureActiveTitle");
  const activeSummaryState = await page.textContent("#generateFixtureActiveState");
  assert.match(String(activeSummaryAfter || ""), /Brentford FC vs Wolverhampton Wanderers FC/i);
  assert.match(String(activeSummaryState || ""), /Applied to Event Setup/i);
});
