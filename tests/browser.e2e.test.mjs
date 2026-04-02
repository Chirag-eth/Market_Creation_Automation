import test from "node:test";
import assert from "node:assert/strict";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { startServerForTest } from "./helpers/serverHarness.mjs";

const __filename = fileURLToPath(import.meta.url);
const WORKSPACE = path.resolve(path.dirname(__filename), "..");
const LEAGUES_CSV = `${WORKSPACE}/catalog/leagues-main.csv`;
const TEAMS_CSV = `${WORKSPACE}/catalog/teams-main.csv`;
const EPL_SCHEDULE_FIXTURE = `${WORKSPACE}/tests/fixtures/epl_schedule.browser.sample.json`;
const UCL_SCHEDULE_FIXTURE = `${WORKSPACE}/tests/fixtures/ucl_schedule.sample.json`;
const UCL_EMPTY_SCHEDULE_FIXTURE = `${WORKSPACE}/tests/fixtures/ucl_schedule.empty.json`;
const LALIGA_SCHEDULE_FIXTURE = `${WORKSPACE}/tests/fixtures/laliga_schedule.sample.json`;
const FIFA_WORLDCUP_SCHEDULE_FIXTURE = `${WORKSPACE}/tests/fixtures/fifa_worldcup_schedule.sample.json`;
const FIFA_FRIENDLIES_SCHEDULE_FIXTURE = `${WORKSPACE}/tests/fixtures/fifa_friendlies_schedule.sample.json`;
const EXTRA_LEAGUES_CSV = `${WORKSPACE}/tests/fixtures/catalog_extra_leagues.sample.csv`;
const EXTRA_TEAMS_CSV = `${WORKSPACE}/tests/fixtures/catalog_extra_teams.sample.csv`;
const TEST_REFERENCE_NOW_ISO = "2026-03-18T14:00:00Z";

function nextPort() {
  return 27000 + Math.floor(Math.random() * 1000);
}

async function launchFixtureApp(t, { serverEnv = {}, basicAuth = null, snapshotGenerate = {} } = {}) {
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
      EXTRA_LEAGUES_CSV_PATHS: `${WORKSPACE}/tests/fixtures/does-not-exist-leagues.csv`,
      EXTRA_TEAMS_CSV_PATHS: `${WORKSPACE}/tests/fixtures/does-not-exist-teams.csv`,
      SPORTSDATA_EPL_SCHEDULE_FIXTURE_PATH: EPL_SCHEDULE_FIXTURE,
      SPORTSDATA_UCL_SCHEDULE_FIXTURE_PATH: UCL_SCHEDULE_FIXTURE,
      SPORTSDATA_LALIGA_SCHEDULE_FIXTURE_PATH: LALIGA_SCHEDULE_FIXTURE,
      SPORTSDATA_FIFA_WORLD_CUP_SCHEDULE_FIXTURE_PATH: FIFA_WORLDCUP_SCHEDULE_FIXTURE,
      SPORTSDATA_FIFA_FRIENDLIES_SCHEDULE_FIXTURE_PATH: FIFA_FRIENDLIES_SCHEDULE_FIXTURE,
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
        }
      : {}
  );
  const page = await context.newPage();
  await page.addInitScript(({ referenceNowIso, snapshotGenerate }) => {
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
          fixtureSourceKey: "live-schedules",
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
          ...snapshotGenerate,
        },
      })
    );
  }, {
    referenceNowIso: TEST_REFERENCE_NOW_ISO,
    snapshotGenerate,
  });

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
  assert.equal(await page.locator('meta[name="theme-color"]').getAttribute("content"), "#243140");

  await page.locator("#generateFixturesPageBtn").click();
  await page.waitForFunction(() => document.querySelectorAll(".league-nav-tab").length >= 1);
  const darkThemeNav = await page.evaluate(() => {
    const icon = document.querySelector(".league-nav-tab__icon");
    const inactiveTab = document.querySelector(".league-nav-tab:not(.is-active)");
    const activeTab = document.querySelector(".league-nav-tab.is-active");
    const sources = Array.from(document.querySelectorAll(".league-nav-tab__icon-image"))
      .map((image) => String(image.getAttribute("src") || ""))
      .filter(Boolean);

    return {
      iconBackground: icon ? getComputedStyle(icon).backgroundColor : "",
      inactiveColor: inactiveTab ? getComputedStyle(inactiveTab).color : "",
      activeColor: activeTab ? getComputedStyle(activeTab).color : "",
      iconSources: sources,
    };
  });
  assert.notEqual(darkThemeNav.iconBackground, "rgba(0, 0, 0, 0)");
  assert.notEqual(darkThemeNav.activeColor, darkThemeNav.inactiveColor);
  assert.ok(darkThemeNav.iconSources.every((src) => !/Inactive/i.test(src)));

  assert.ok(await page.$("#generateEventNameInput"), "Expected event-name generator input to be present.");
  assert.ok(await page.$("#generateLeagueSelect"), "Expected league selector to be present.");
  assert.ok(await page.$("#generateFixtureDateInput"), "Expected fixture date input to be present.");
  assert.ok(await page.$("#generateFixtureSearchInput"), "Expected fixture search input to be present.");
  assert.ok(await page.$("#refreshScheduleBtn"), "Expected schedule refetch button to be present.");
  assert.ok(await page.$("#generateBuilderPageBtn"), "Expected builder page tab to be present.");
  assert.ok(await page.$("#generateFixturesPageBtn"), "Expected upcoming fixtures page tab to be present.");
  assert.equal(await page.locator("#generateBuilderPageBtn").getAttribute("aria-controls"), "generateBuilderPage");
  assert.equal(await page.locator("#generateFixturesPageBtn").getAttribute("aria-controls"), "generateFixturesPage");
  assert.equal(await page.locator("#generateBuilderPage").getAttribute("role"), "tabpanel");
  assert.equal(await page.locator("#generateFixturesPage").getAttribute("role"), "tabpanel");
  assert.equal(await page.locator("#fixtureSourceCard").evaluate((el) => el.hidden), true);
});

test("browser e2e: planned fixture source state cannot strand the frontend", async (t) => {
  const launched = await launchFixtureApp(t, {
    snapshotGenerate: {
      fixtureSourceKey: "imported-csv",
      page: "fixtures",
    },
  });
  if (!launched) {
    return;
  }

  const { page, started } = launched;
  await page.goto(`${started.baseUrl}/`, { waitUntil: "domcontentloaded" });
  await waitForCatalogReady(page);

  assert.equal(await page.locator("#generateFixturesPageBtn").getAttribute("aria-selected"), "true");
  await page.locator("#generateBuilderPageBtn").click();
  await page.waitForFunction(() => document.querySelector("#generateBuilderPageBtn")?.getAttribute("aria-selected") === "true");
  await selectLeague(page, /English Premier League/i);
  assert.equal(await page.locator("#fixtureSourceCard").evaluate((el) => el.hidden), true);
  await page.locator("#generateFixturesPageBtn").click();
  await page.waitForFunction(() => document.querySelector("#generateFixturesPageBtn")?.getAttribute("aria-selected") === "true");
  assert.equal(await page.locator("#generateFixturesSourcePlaceholder").evaluate((el) => el.hidden), true);
  assert.match(
    String(await page.locator("#generateFixtureSummary").textContent()),
    /English Premier League|EPL|Matchday/i
  );
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
  assert.match(
    String(await page.locator("#generateBuilderFixturePreview .builder-fixture-id").first().textContent()),
    /Game ID \d+/i
  );

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


test("browser e2e: ambiguous FIFA schedule lanes stay hidden until the catalog maps them explicitly", async (t) => {
  const launched = await launchFixtureApp(t);
  if (!launched) {
    return;
  }

  const { page, started } = launched;
  await page.goto(`${started.baseUrl}/`, { waitUntil: "domcontentloaded" });
  await waitForCatalogReady(page);

  const fifaOptions = await page.locator("#generateLeagueSelect option").evaluateAll((options) =>
    options
      .filter((option) => /FIFA WC|Friendlies/i.test(option.textContent || ""))
      .map((option) => ({
        value: option.value,
        text: option.textContent?.trim() || "",
        disabled: option.disabled,
      }))
  );

  assert.deepEqual(
    fifaOptions.map((option) => ({ text: option.text, disabled: option.disabled })),
    []
  );

  await page.locator("#generateFixturesPageBtn").click();
  await page.waitForFunction(() => document.querySelector("#generateFixturesPageBtn")?.getAttribute("aria-selected") === "true");
  const leagueTabs = await page.locator(".league-nav-tab").allTextContents();
  assert.ok(leagueTabs.every((text) => !/FIFA/i.test(String(text || ""))));
});

test("browser e2e: upcoming fixtures exposes accessible league and week selectors, filter popover, and apply-to-generate", async (t) => {
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

  assert.equal(await page.locator(".league-nav-tab").first().getAttribute("role"), "radio");
  assert.equal(await page.locator(".league-nav-tab").first().getAttribute("aria-checked"), "true");
  assert.equal(await page.locator("#generateFixtureResults").getAttribute("role"), null);
  assert.equal(await page.locator("#generateFixtureResults").getAttribute("tabindex"), null);

  const weekTabs = page.locator("#generateFixtureWeekTabs .fixtures-week-pill");
  await weekTabs.first().waitFor();
  assert.equal(await weekTabs.count(), 6);

  const groups = page.locator("#generateFixtureResults .fixtures-week-group");
  await groups.first().waitFor();
  assert.equal(await groups.count(), 1);
  assert.match(
    String(await page.locator("#generateFixtureResults .schedule-fixture-id").first().textContent()),
    /Game ID \d+/i
  );
  assert.equal(await page.locator("#generateFixtureResults .schedule-fixture-btn").first().getAttribute("role"), null);

  const titles = await page.locator("#generateFixtureResults .fixtures-week-group__title").allTextContents();
  assert.deepEqual(titles.map((text) => String(text).trim()), ["Matchday 31"]);

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
  await page.waitForFunction(() => document.querySelectorAll("#generateFixtureResults .schedule-fixture-btn").length === 2);

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

  await page.locator('#generateFixtureWeekTabs .fixtures-week-pill[data-week="35"]').click();
  await page.waitForFunction(() => {
    const summary = document.querySelector("#generateFixtureSummary")?.textContent || "";
    const title = document.querySelector("#generateFixtureResults .fixtures-week-group__title")?.textContent || "";
    return /Matchday 35/i.test(summary) && /Matchday 35/i.test(title);
  });
  assert.equal(await page.locator("#generateFixtureResults .schedule-fixture-btn").count(), 1);

  await page.locator('.league-nav-tab:has-text("UCL")').click();
  await page.waitForFunction(() => {
    const summary = document.querySelector("#generateFixtureSummary")?.textContent || "";
    return /UCL/i.test(summary) && /Matchday 16/i.test(summary);
  });
  await page.waitForFunction(() => document.querySelector("#generateEventNameInput")?.value === "");
  const uclTitles = await page.locator("#generateFixtureResults .fixtures-week-group__title").allTextContents();
  assert.deepEqual(uclTitles.map((text) => String(text).trim()), ["Matchday 16"]);

  await page.locator('.league-nav-tab:has-text("La Liga")').click();
  await page.waitForFunction(() => {
    const summary = document.querySelector("#generateFixtureSummary")?.textContent || "";
    return /La Liga/i.test(summary) && /Matchday 29/i.test(summary);
  });
  const laligaTitles = await page.locator("#generateFixtureResults .fixtures-week-group__title").allTextContents();
  assert.deepEqual(laligaTitles.map((text) => String(text).trim()), ["Matchday 29"]);

  await page.locator("#refreshScheduleBtn").click();
  await page.waitForFunction(() => {
    const btn = document.querySelector("#refreshScheduleBtn");
    return Boolean(btn && btn.textContent?.trim() === "Refetch Fixtures");
  });
});

test("browser e2e: basic-auth protected app still loads schedules and fixture generation works when API bearer auth is disabled", async (t) => {
  const launched = await launchFixtureApp(t, {
    basicAuth: {
      user: "tester",
      pass: "secret",
    },
    serverEnv: {
      APP_BASIC_AUTH_USER: "tester",
      APP_BASIC_AUTH_PASS: "secret",
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

test("browser e2e: basic-auth shell stays quiet when a saved bearer token unlocks the protected API", async (t) => {
  const launched = await launchFixtureApp(t, {
    basicAuth: {
      user: "tester",
      pass: "secret",
    },
    serverEnv: {
      APP_BASIC_AUTH_USER: "tester",
      APP_BASIC_AUTH_PASS: "secret",
      API_BEARER_TOKEN: "top-secret-token",
    },
  });
  if (!launched) {
    return;
  }

  const { page, started } = launched;
  await page.addInitScript(() => {
    localStorage.setItem("fixture-ocr-market-builder-api-bearer-token-v1", "top-secret-token");
  });
  await page.goto(`${started.baseUrl}/`, { waitUntil: "domcontentloaded" });

  await waitForCatalogReady(page);
  await page.waitForFunction(() => document.querySelector("#apiAccessPanel")?.hidden === true);

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

test("browser e2e: UAT composer exposes env badge, market-family switching, and UAT output panels", async (t) => {
  const launched = await launchFixtureApp(t);
  if (!launched) {
    return;
  }

  const { page, started } = launched;
  await page.goto(`${started.baseUrl}/`, { waitUntil: "domcontentloaded" });
  await waitForCatalogReady(page);

  assert.equal(await page.locator("#runtimeEnvSelect").inputValue(), "mainnet");
  assert.match(String(await page.locator("#runtimeEnvBadge").textContent()), /Mainnet/i);
  assert.equal(await page.locator("#generateMarketFamilySelect").isDisabled(), true);
  assert.equal(await page.locator("#generateMarketFamilyActivateBtn").isVisible(), true);
  assert.equal(await page.locator("#generateMarketLineField").evaluate((el) => el.hidden), true);
  assert.equal(await page.locator("#generateSpreadTeamField").evaluate((el) => el.hidden), true);
  assert.equal(await page.locator("#generatedParentPanel").evaluate((el) => el.hidden), false);
  assert.equal(await page.locator("#generatedUatFamilyPanel").evaluate((el) => el.hidden), true);

  await page.locator("#generateMarketFamilyActivateBtn").click();
  await waitForCatalogReady(page);
  await page.waitForFunction(() => {
    const badge = document.querySelector("#runtimeEnvBadge")?.textContent || "";
    const family = document.querySelector("#generateMarketFamilySelect");
    const activateBtn = document.querySelector("#generateMarketFamilyActivateBtn");
    return /UAT/i.test(badge) && Boolean(family) && !family.disabled && Boolean(activateBtn) && activateBtn.hidden === true;
  });
  assert.equal(await page.locator("#generateMarketLineField").evaluate((el) => el.hidden), true);
  assert.equal(await page.locator("#generateSpreadTeamField").evaluate((el) => el.hidden), true);

  await selectLeague(page, /English Premier League/i);
  await page.locator("#generateEventNameInput").fill("Bournemouth vs Man Utd");
  await page.locator("#generateTypeRefInput").fill("1be3abef-9230-4f38-b371-42aad85f7c8c");

  await page.locator("#generateBtn").click();
  await page.waitForFunction(() => {
    const fixture = document.querySelector("#generatedFixtureOutput");
    const family = document.querySelector("#generatedUatFamilyOutput");
    const typeRefs = document.querySelector("#generatedTypeReferencesOutput");
    const parentPanel = document.querySelector("#generatedParentPanel");
    const uatPanel = document.querySelector("#generatedUatFamilyPanel");
    return (
      fixture?.dataset.empty === "false" &&
      family?.dataset.empty === "false" &&
      typeRefs?.dataset.empty === "false" &&
      parentPanel?.hidden === true &&
      uatPanel?.hidden === false
    );
  });

  await page.locator("#validateGeneratedFixtureBtn").click();
  await page.locator("#validateGeneratedUatFamilyBtn").click();
  await page.locator("#validateGeneratedTypeReferencesBtn").click();
  await page.waitForFunction(() => {
    const fixtureState = document.querySelector("#generatedFixtureValidationState")?.textContent || "";
    const familyState = document.querySelector("#generatedUatFamilyValidationState")?.textContent || "";
    const typeRefState = document.querySelector("#generatedTypeReferencesValidationState")?.textContent || "";
    return /Valid/i.test(fixtureState) && /Valid/i.test(familyState) && /Valid/i.test(typeRefState);
  });

  await page.locator("#generateMarketFamilySelect").selectOption("spreads");
  await page.waitForFunction(() => {
    const field = document.querySelector("#generateMarketLineField");
    const line = document.querySelector("#generateMarketLineSelect");
    const spreadTeamField = document.querySelector("#generateSpreadTeamField");
    const spreadTeam = document.querySelector("#generateSpreadTeamSelect");
    const lineOptions = Array.from(line?.options || []).map((option) => option.value);
    return (
      Boolean(field) &&
      field.hidden === false &&
      Boolean(line) &&
      line.value === "1.5" &&
      JSON.stringify(lineOptions) === JSON.stringify(["1.5", "2.5"]) &&
      Boolean(spreadTeamField) &&
      spreadTeamField.hidden === false &&
      Boolean(spreadTeam) &&
      spreadTeam.value === "home"
    );
  });
  await page.locator("#generateMarketLineSelect").selectOption("2.5");
  await page.locator("#generateSpreadTeamSelect").selectOption("away");
  await page.locator("#generateBtn").click();
  await page.waitForFunction(() => {
    const body = document.querySelector("#generatedUatFamilyOutput")?.textContent || "";
    return /\"parent_market_family\": \"spreads\"/i.test(body) && /\"market_line\": \"-2.5\"/i.test(body) && /Man Utd Over 2.5 Goals/i.test(body);
  });

  await page.locator("#generateMarketFamilySelect").selectOption("totals");
  await page.waitForFunction(() => {
    const field = document.querySelector("#generateMarketLineField");
    const line = document.querySelector("#generateMarketLineSelect");
    const spreadTeamField = document.querySelector("#generateSpreadTeamField");
    const lineOptions = Array.from(line?.options || []).map((option) => option.value);
    return (
      Boolean(field) &&
      field.hidden === false &&
      Boolean(line) &&
      line.value === "1.5" &&
      JSON.stringify(lineOptions) === JSON.stringify(["1.5", "2.5", "3.5", "4.5"]) &&
      Boolean(spreadTeamField) &&
      spreadTeamField.hidden === true
    );
  });
  await page.locator("#generateMarketLineSelect").selectOption("3.5");
  await page.locator("#generateBtn").click();
  await page.waitForFunction(() => {
    const title = document.querySelector("#generatedUatFamilyTitle")?.textContent || "";
    const body = document.querySelector("#generatedUatFamilyOutput")?.textContent || "";
    return /Totals/i.test(title) && /3.5/i.test(title) && /\"parent_market_family\": \"totals\"/i.test(body) && /\"market_line\": \"3.5\"/i.test(body);
  });

  await page.locator("#generateMarketFamilySelect").selectOption("spreads");
  await page.waitForFunction(() => {
    const family = document.querySelector("#generateMarketFamilySelect");
    const lineField = document.querySelector("#generateMarketLineField");
    const spreadTeamField = document.querySelector("#generateSpreadTeamField");
    return family?.value === "spreads" && lineField?.hidden === false && spreadTeamField?.hidden === false;
  });
  await page.waitForFunction(() => document.querySelectorAll(".builder-fixture-row").length >= 1);
  await page.locator(".builder-fixture-row").first().click();
  await page.waitForFunction(() => {
    const family = document.querySelector("#generateMarketFamilySelect");
    const lineField = document.querySelector("#generateMarketLineField");
    const spreadTeamField = document.querySelector("#generateSpreadTeamField");
    return family?.value === "moneyline" && lineField?.hidden === true && spreadTeamField?.hidden === true;
  });
});

test("browser e2e: output rail captures wheel scrolling as a single component", async (t) => {
  const launched = await launchFixtureApp(t);
  if (!launched) {
    return;
  }

  const { page, started } = launched;
  await page.goto(`${started.baseUrl}/`, { waitUntil: "domcontentloaded" });
  await waitForCatalogReady(page);

  await page.locator("#generateMarketFamilyActivateBtn").click();
  await page.waitForFunction(() => /UAT/i.test(document.querySelector("#runtimeEnvBadge")?.textContent || ""));

  await selectLeague(page, /English Premier League/i);
  await page.locator("#generateEventNameInput").fill("Bournemouth vs Man Utd");
  await page.locator("#generateTypeRefInput").fill("1be3abef-9230-4f38-b371-42aad85f7c8c");
  await page.locator("#generateBtn").click();

  await page.waitForFunction(() => {
    const fixture = document.querySelector("#generatedFixtureOutput");
    const family = document.querySelector("#generatedUatFamilyOutput");
    const typeRefs = document.querySelector("#generatedTypeReferencesOutput");
    return fixture?.dataset.empty === "false" && family?.dataset.empty === "false" && typeRefs?.dataset.empty === "false";
  });

  const before = await page.evaluate(() => {
    const rail = document.querySelector(".output-column-stack");
    const json = document.querySelector("#generatedUatFamilyOutput");
    return {
      railClientHeight: rail?.clientHeight ?? 0,
      railScrollHeight: rail?.scrollHeight ?? 0,
      railScrollTop: rail?.scrollTop ?? 0,
      jsonOverflowY: json ? getComputedStyle(json).overflowY : "",
      pageY: window.scrollY,
    };
  });

  assert.ok(before.railScrollHeight > before.railClientHeight, "Expected the output rail to overflow vertically.");
  assert.notEqual(before.jsonOverflowY, "auto");

  const railBox = await page.locator(".output-column-stack").boundingBox();
  assert.ok(railBox, "Expected output rail to be visible.");

  await page.mouse.move(railBox.x + Math.min(railBox.width / 2, 180), railBox.y + Math.min(railBox.height / 2, 240));
  await page.mouse.wheel(0, 900);
  await page.waitForTimeout(200);

  const after = await page.evaluate(() => {
    const rail = document.querySelector(".output-column-stack");
    return {
      railScrollTop: rail?.scrollTop ?? 0,
      pageY: window.scrollY,
    };
  });

  assert.ok(after.railScrollTop > before.railScrollTop, "Expected wheel motion to move the output rail.");
  assert.equal(after.pageY, before.pageY);
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

test("browser e2e: league switching clears stale search and shows explicit empty-state messaging", async (t) => {
  const launched = await launchFixtureApp(t, {
    serverEnv: {
      SPORTSDATA_UCL_SCHEDULE_FIXTURE_PATH: UCL_EMPTY_SCHEDULE_FIXTURE,
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

  await page.locator('#generateFixtureWeekTabs .fixtures-week-pill[data-week="34"]').click();
  await page.waitForFunction(() => {
    const title = document.querySelector("#generateFixtureResults .fixtures-week-group__title")?.textContent || "";
    return /Matchday 34/i.test(title);
  });

  await page.locator("#generateFixtureSearchInput").fill("Fulham");
  await page.waitForFunction(() => document.querySelectorAll("#generateFixtureResults .schedule-fixture-btn").length >= 1);
  assert.equal(await page.locator("#generateFixtureSearchInput").inputValue(), "Fulham");

  await page.locator('.league-nav-tab:has-text("UCL")').click();
  await page.waitForFunction(() => {
    const summary = document.querySelector("#generateFixtureSummary")?.textContent || "";
    return /UCL/i.test(summary) && /No upcoming fixtures right now/i.test(summary);
  });

  assert.equal(await page.locator("#generateFixtureSearchInput").inputValue(), "");
  assert.match(
    String(await page.locator("#generateScheduleStatus").textContent()),
    /UCL has no upcoming fixtures from SportsData right now\./i
  );
  assert.match(
    String(await page.locator("#generateFixtureResults").textContent()),
    /UCL has no upcoming fixtures from SportsData right now\. Try Refetch Fixtures later\./i
  );

  await page.locator("#generateBuilderPageBtn").click();
  await page.waitForFunction(() => document.querySelector("#generateBuilderPageBtn")?.getAttribute("aria-selected") === "true");
  assert.match(
    String(await page.locator("#generateBuilderFixturePreview").textContent()),
    /UCL has no upcoming fixtures from SportsData right now\. Try Refetch Fixtures later\./i
  );

  await selectLeague(page, /English Premier League/i);
  await page.waitForFunction(() => /Matchdays 31-36 loaded from EPL schedule API/i.test(document.querySelector("#generateScheduleStatus")?.textContent || ""));
  await page.locator("#generateFixturesPageBtn").click();
  await page.locator("#generateFixtureResults .schedule-fixture-btn").first().click();
  await page.waitForFunction(() => {
    const fixture = document.querySelector("#generatedFixtureOutput");
    const parent = document.querySelector("#generatedParentOutput");
    return fixture?.dataset.empty === "false" && parent?.dataset.empty === "false";
  });

  const generatedFixture = JSON.parse(String(await page.locator("#generatedFixtureOutput").textContent()));
  assert.equal(generatedFixture.name, "Bournemouth vs Man Utd");
});

test("browser e2e: upcoming fixtures only shows schedule leagues that are both ready and unambiguous in the catalog", async (t) => {
  const launched = await launchFixtureApp(t);
  if (!launched) {
    return;
  }

  const { page, started } = launched;
  await page.goto(`${started.baseUrl}/`, { waitUntil: "domcontentloaded" });
  await waitForCatalogReady(page);
  await page.locator("#generateFixturesPageBtn").click();
  await page.waitForFunction(() => document.querySelector("#generateFixturesPageBtn")?.getAttribute("aria-selected") === "true");
  const tabLabels = await page.locator(".league-nav-tab .league-nav-tab__label").allTextContents();
  assert.deepEqual(tabLabels.map((text) => String(text).trim()), ["EPL", "UCL", "La Liga"]);
});
