import test from "node:test";
import assert from "node:assert/strict";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { getBasicAuthHeader, startServerForTest } from "./helpers/serverHarness.mjs";

const __filename = fileURLToPath(import.meta.url);
const WORKSPACE = path.resolve(path.dirname(__filename), "..");
const LEAGUES_CSV = `${WORKSPACE}/Info-source/leagues.csv`;
const TEAMS_CSV = `${WORKSPACE}/Info-source/teams.csv`;
const EPL_SCHEDULE_FIXTURE = `${WORKSPACE}/tests/fixtures/epl_schedule.browser.sample.json`;
const UCL_SCHEDULE_FIXTURE = `${WORKSPACE}/tests/fixtures/ucl_schedule.sample.json`;
const LALIGA_SCHEDULE_FIXTURE = `${WORKSPACE}/tests/fixtures/laliga_schedule.sample.json`;
const TEST_REFERENCE_NOW_ISO = "2026-03-18T14:00:00Z";

function nextPort() {
  return 27000 + Math.floor(Math.random() * 1000);
}

async function launchFixtureApp(t, { serverEnv = {}, basicAuth = null } = {}) {
  let playwright;
  try {
    playwright = await import("playwright");
  } catch {
    t.skip("Playwright is not installed in this environment.");
    return null;
  }

  const started = await startServerForTest({
    cwd: WORKSPACE,
    port: nextPort(),
    env: {
      LEAGUES_CSV_PATH: LEAGUES_CSV,
      TEAMS_CSV_PATH: TEAMS_CSV,
      SPORTSDATA_EPL_SCHEDULE_FIXTURE_PATH: EPL_SCHEDULE_FIXTURE,
      SPORTSDATA_UCL_SCHEDULE_FIXTURE_PATH: UCL_SCHEDULE_FIXTURE,
      SPORTSDATA_LALIGA_SCHEDULE_FIXTURE_PATH: LALIGA_SCHEDULE_FIXTURE,
      SCHEDULE_NOW_ISO: TEST_REFERENCE_NOW_ISO,
      ...serverEnv,
    },
  });

  if (started.skipReason) {
    t.skip(started.skipReason);
    return null;
  }

  let browser;
  try {
    browser = await playwright.chromium.launch({ headless: true });
  } catch (error) {
    await started.stop();
    t.skip(`Playwright browser runtime unavailable: ${String(error?.message || error)}`);
    return null;
  }

  t.after(async () => {
    try {
      await browser.close();
    } finally {
      await started.stop();
    }
  });

  const context = await browser.newContext(
    basicAuth
      ? {
          httpCredentials: {
            username: basicAuth.user,
            password: basicAuth.pass,
          },
          extraHTTPHeaders: {
            Authorization: getBasicAuthHeader(basicAuth.user, basicAuth.pass),
          },
        }
      : {}
  );
  const page = await context.newPage();
  await page.addInitScript((referenceNowIso) => {
    localStorage.clear();
    localStorage.setItem(
      "fixture-ocr-market-builder-state-v1",
      JSON.stringify({
        runtime: {
          scheduleSnapshotVersion: 5,
          referenceNowIso,
          scheduleSnapshots: {},
        },
        verify: {
          fixtureJson: "",
          parentJson: "",
        },
        generate: {
          page: "builder",
          builderScheduleWeek: "",
          fixturesPageScheduleWeek: "",
          eventName: "",
          leagueSelection: "",
          selectedScheduleFixtureId: "",
          fixtureSearch: "",
          fixtureSearchFilters: {
            team: true,
            date: true,
            kickoff: true,
            matchday: true,
          },
          typeReferenceId: "",
          fixtureDate: "",
          kickoffTimeUtc: "",
          matchDay: "",
          matchWeek: "",
          location: "",
          venue: "",
        },
      })
    );
  }, TEST_REFERENCE_NOW_ISO);

  return { page, started, browser, context };
}

async function selectLeague(page, labelPattern) {
  const leagueOptions = await page.locator("#generateLeagueSelect option").allTextContents();
  const label = leagueOptions.find((text) => labelPattern.test(String(text || "")));
  assert.ok(label, `Expected league option matching ${labelPattern}. Got: ${leagueOptions.join(", ")}`);
  await page.locator("#generateLeagueSelect").selectOption({ label });
}

async function waitForCatalogReady(page) {
  await page.waitForFunction(() => {
    const status = document.querySelector("#catalogStatus")?.textContent || "";
    const leagueSelect = document.querySelector("#generateLeagueSelect");
    return /CSV catalog loaded:/i.test(status) && !!leagueSelect && leagueSelect.options.length > 1;
  }, { timeout: 30_000 });
}

async function waitForBuilderWeeks(page, expectedCount) {
  await page.waitForFunction(
    (count) => {
      const select = document.querySelector("#generateBuilderWeekSelect");
      if (!select || select.disabled) {
        return false;
      }
      const populated = Array.from(select.options).filter((option) => option.value);
      return populated.length === count;
    },
    expectedCount,
    { timeout: 30_000 }
  );
}

test("browser e2e: dashboard shell, verify collapse, and theme toggle", async (t) => {
  const launched = await launchFixtureApp(t);
  if (!launched) {
    return;
  }

  const { page, started } = launched;

  await page.goto(`${started.baseUrl}/`, { waitUntil: "domcontentloaded" });
  await waitForCatalogReady(page);

  await page.waitForSelector("h1");
  const heading = await page.textContent("h1");
  assert.match(String(heading || ""), /Fixture & Parent Market Verifier/i);

  const verifySectionOpen = await page.locator("#verifySection").evaluate((el) => el.open);
  assert.equal(verifySectionOpen, false);

  await page.locator("#verifyToggleBtn").click();
  await page.waitForFunction(() => document.querySelector("#verifySection")?.open === true);
  assert.ok(await page.$("#fixtureInputJson"), "Expected fixture JSON input to be present after opening verify.");
  assert.ok(await page.$("#parentInputJson"), "Expected parent market JSON input to be present after opening verify.");

  const themeBefore = await page.evaluate(() => document.documentElement.dataset.theme || "light");
  await page.locator("#themeToggleBtn").click();
  const themeAfter = await page.evaluate(() => document.documentElement.dataset.theme || "light");
  assert.notEqual(themeAfter, themeBefore);

  assert.ok(await page.$("#generateEventNameInput"), "Expected event-name generator input to be present.");
  assert.ok(await page.$("#generateLeagueSelect"), "Expected league selector to be present.");
  assert.ok(await page.$("#generateFixtureDateInput"), "Expected fixture date input to be present.");
  assert.ok(await page.$("#generateFixtureSearchInput"), "Expected fixture search input to be present.");
  assert.ok(await page.$("#refreshScheduleBtn"), "Expected schedule refetch button to be present.");
  assert.ok(await page.$("#generateBuilderPageBtn"), "Expected builder page tab to be present.");
  assert.ok(await page.$("#generateFixturesPageBtn"), "Expected upcoming fixtures page tab to be present.");
});

test("browser e2e: builder loads deterministic six-week EPL window and supports week switching", async (t) => {
  const launched = await launchFixtureApp(t);
  if (!launched) {
    return;
  }

  const { page, started } = launched;
  await page.goto(`${started.baseUrl}/`, { waitUntil: "domcontentloaded" });
  await waitForCatalogReady(page);

  await selectLeague(page, /English Premier League/i);
  await waitForBuilderWeeks(page, 6);

  const weekOptions = await page.locator("#generateBuilderWeekSelect option").evaluateAll((options) =>
    options.filter((option) => option.value).map((option) => ({ value: option.value, text: option.textContent?.trim() }))
  );
  assert.deepEqual(
    weekOptions.map((option) => option.value),
    ["31", "32", "33", "34", "35", "36"]
  );

  const firstPreview = page.locator("#generateBuilderFixturePreview .builder-fixture-row");
  await firstPreview.first().waitFor();
  const previewRows = await firstPreview.count();
  assert.equal(previewRows, 2);
  assert.match(String(await firstPreview.first().textContent()), /AFC Bournemouth vs Manchester United FC/i);

  await firstPreview.first().click();
  await page.waitForFunction(() => {
    const eventInput = document.querySelector("#generateEventNameInput");
    return /AFC Bournemouth vs Manchester United FC/.test(eventInput?.value || "");
  });

  const builderSelectedLabel = await page.locator("#generateBuilderFixturePreview .builder-fixture-row").first().textContent();
  assert.match(String(builderSelectedLabel), /Applied/i);

  await page.locator("#generateBuilderWeekSelect").selectOption("35");
  await page.waitForFunction(() => {
    const firstCard = document.querySelector("#generateBuilderFixturePreview .builder-fixture-row");
    return Boolean(firstCard && /Manchester United FC vs Liverpool FC/.test(firstCard.textContent || ""));
  });

  const updatedRows = await page.locator("#generateBuilderFixturePreview .builder-fixture-row").count();
  assert.equal(updatedRows, 1);
  assert.match(String(await page.locator("#generateBuilderFixturePreview .builder-fixture-row").first().textContent()), /Manchester United FC vs Liverpool FC/i);

  await page.locator("#generateBuilderRefetchBtn").click();
  await page.waitForFunction(() => {
    const status = document.querySelector("#generateScheduleStatus")?.textContent || "";
    return /Matchdays 31-36 loaded from EPL schedule API/i.test(status);
  });
});

test("browser e2e: upcoming fixtures groups by matchweek, supports league tabs, filter popover, and apply-to-generate", async (t) => {
  const launched = await launchFixtureApp(t);
  if (!launched) {
    return;
  }

  const { page, started } = launched;
  await page.goto(`${started.baseUrl}/`, { waitUntil: "domcontentloaded" });
  await waitForCatalogReady(page);

  await selectLeague(page, /English Premier League/i);
  await waitForBuilderWeeks(page, 6);

  const filterMenu = page.locator("#generateFixtureSearchFiltersMenu");
  assert.equal(await filterMenu.evaluate((el) => el.hidden), true);

  await page.locator("#generateFixturesPageBtn").click();
  await page.waitForFunction(() => document.querySelector("#generateFixturesPageBtn")?.getAttribute("aria-selected") === "true");

  const groups = page.locator("#generateFixtureResults .fixtures-week-group");
  await groups.first().waitFor();
  assert.equal(await groups.count(), 6);

  const titles = await page.locator("#generateFixtureResults .fixtures-week-group__title").allTextContents();
  assert.deepEqual(titles.map((text) => String(text).trim()), [
    "Matchday 31",
    "Matchday 32",
    "Matchday 33",
    "Matchday 34",
    "Matchday 35",
    "Matchday 36",
  ]);

  await page.locator("#generateFixtureSearchFiltersBtn").click();
  await page.waitForFunction(() => document.querySelector("#generateFixtureSearchFiltersMenu")?.hidden === false);
  await page.mouse.click(10, 10);
  await page.waitForFunction(() => document.querySelector("#generateFixtureSearchFiltersMenu")?.hidden === true);

  await page.locator("#generateFixtureSearchInput").fill("Bournemouth vs Manchester");
  await page.waitForFunction(() => {
    return document.querySelectorAll("#generateFixtureResults .schedule-fixture-btn").length === 1;
  });
  assert.match(
    String(await page.locator("#generateFixtureResults .schedule-fixture-btn").first().textContent()),
    /AFC Bournemouth vs Manchester United FC/i
  );

  await page.locator("#generateFixtureSearchInput").fill("");
  await page.waitForFunction(() => document.querySelectorAll("#generateFixtureResults .schedule-fixture-btn").length === 7);

  await page.locator("#generateFixtureResults .schedule-fixture-btn").first().click();
  await page.waitForFunction(() => {
    const fixture = document.querySelector("#generatedFixtureOutput");
    const parent = document.querySelector("#generatedParentOutput");
    return fixture?.dataset.empty === "false" && parent?.dataset.empty === "false";
  });

  assert.equal(await page.locator("#generateFixturesPageBtn").getAttribute("aria-selected"), "true");

  const eventName = await page.locator("#generateEventNameInput").inputValue();
  assert.match(eventName, /AFC Bournemouth vs Manchester United FC/i);

  const generatedFixture = JSON.parse(String(await page.locator("#generatedFixtureOutput").textContent()));
  const generatedParent = JSON.parse(String(await page.locator("#generatedParentOutput").textContent()));
  assert.equal(generatedFixture.name, "Bournemouth vs Man Utd");
  assert.equal(generatedParent.parent_market.title, "Bournemouth vs Man Utd");

  await page.locator('.league-nav-tab:has-text("UCL")').click();
  await page.waitForFunction(() => {
    const summary = document.querySelector("#generateFixtureSummary")?.textContent || "";
    return /UCL/i.test(summary) && /fixture/.test(summary);
  });
  await page.waitForFunction(() => document.querySelector("#generateEventNameInput")?.value === "");
  const uclTitles = await page.locator("#generateFixtureResults .fixtures-week-group__title").allTextContents();
  assert.deepEqual(uclTitles.map((text) => String(text).trim()), ["Matchday 16", "Matchday 17"]);

  await page.locator('.league-nav-tab:has-text("La Liga")').click();
  await page.waitForFunction(() => {
    const summary = document.querySelector("#generateFixtureSummary")?.textContent || "";
    return /LALIGA/i.test(summary);
  });
  const laligaTitles = await page.locator("#generateFixtureResults .fixtures-week-group__title").allTextContents();
  assert.deepEqual(laligaTitles.map((text) => String(text).trim()), ["Matchday 29", "Matchday 30"]);

  await page.locator("#refreshScheduleBtn").click();
  await page.waitForFunction(() => {
    const btn = document.querySelector("#refreshScheduleBtn");
    return Boolean(btn && btn.textContent?.trim() === "Refetch Fixtures");
  });
});

test("browser e2e: basic-auth protected app still loads schedules and fixture generation works", async (t) => {
  const launched = await launchFixtureApp(t, {
    basicAuth: {
      user: "tester",
      pass: "secret",
    },
    serverEnv: {
      APP_BASIC_AUTH_USER: "tester",
      APP_BASIC_AUTH_PASS: "secret",
      API_BEARER_TOKEN: "api-test-token",
    },
  });
  if (!launched) {
    return;
  }

  const { page, started } = launched;
  await page.goto(`${started.baseUrl}/`, { waitUntil: "domcontentloaded" });
  await waitForCatalogReady(page);

  await selectLeague(page, /English Premier League/i);
  await waitForBuilderWeeks(page, 6);

  await page.locator("#generateFixturesPageBtn").click();
  await page.waitForFunction(() => document.querySelector("#generateFixturesPageBtn")?.getAttribute("aria-selected") === "true");
  await page.locator("#generateFixtureResults .schedule-fixture-btn").first().click();
  await page.waitForFunction(() => {
    const fixture = document.querySelector("#generatedFixtureOutput");
    const parent = document.querySelector("#generatedParentOutput");
    return fixture?.dataset.empty === "false" && parent?.dataset.empty === "false";
  });

  const generatedFixture = JSON.parse(String(await page.locator("#generatedFixtureOutput").textContent()));
  assert.equal(generatedFixture.name, "Bournemouth vs Man Utd");
});

test("browser e2e: schedule fetch failure keeps controls usable and surfaces clear errors", async (t) => {
  const launched = await launchFixtureApp(t, {
    serverEnv: {
      SPORTSDATA_EPL_SCHEDULE_FIXTURE_PATH: "",
      SPORTSDATA_UCL_SCHEDULE_FIXTURE_PATH: "",
      SPORTSDATA_LALIGA_SCHEDULE_FIXTURE_PATH: "",
      SPORTSDATA_API_KEY: "",
    },
  });
  if (!launched) {
    return;
  }

  const { page, started } = launched;
  await page.goto(`${started.baseUrl}/`, { waitUntil: "domcontentloaded" });
  await waitForCatalogReady(page);

  await selectLeague(page, /English Premier League/i);
  await page.waitForFunction(() => {
    const status = document.querySelector("#generateScheduleStatus")?.textContent || "";
    return /Could not load upcoming EPL fixtures: SPORTSDATA_API_KEY is not configured on the server\./i.test(status);
  });

  assert.match(
    String(await page.locator("#generateScheduleStatus").textContent()),
    /Could not load upcoming EPL fixtures: SPORTSDATA_API_KEY is not configured on the server\./i
  );
  assert.equal(await page.locator("#generateBuilderRefetchBtn").isDisabled(), false);
  assert.equal(await page.locator("#refreshScheduleBtn").isDisabled(), false);

  await page.locator("#generateFixturesPageBtn").click();
  await page.waitForFunction(() => document.querySelector("#generateFixturesPageBtn")?.getAttribute("aria-selected") === "true");
  assert.match(
    String(await page.locator("#generateFixtureResults").textContent()),
    /Could not load upcoming fixtures right now\./i
  );

  await page.locator("#refreshScheduleBtn").click();
  await page.waitForFunction(() => {
    const btn = document.querySelector("#refreshScheduleBtn");
    const status = document.querySelector("#generateScheduleStatus")?.textContent || "";
    return Boolean(
      btn &&
      btn.textContent?.trim() === "Refetch Fixtures" &&
      /Could not load upcoming EPL fixtures: SPORTSDATA_API_KEY is not configured on the server\./i.test(status)
    );
  });
});
