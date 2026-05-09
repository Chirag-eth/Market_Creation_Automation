/**
 * Playwright e2e tests for the Market Ops React frontend.
 *
 * These tests launch a real backend server, intercept API routes with
 * Playwright's page.route() to supply deterministic fixture data, and
 * exercise the core UI flows.
 */

import test from "node:test";
import assert from "node:assert/strict";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { startServerForTest } from "./helpers/serverHarness.mjs";

const __filename = fileURLToPath(import.meta.url);
const WORKSPACE = path.resolve(path.dirname(__filename), "..");
const LEAGUES_CSV = `${WORKSPACE}/catalog/leagues.csv`;
const TEAMS_CSV = `${WORKSPACE}/catalog/teams.csv`;

// --- Mock data -----------------------------------------------------------

const MOCK_LEAGUES = [
  { code: "epl", label: "EPL" },
  { code: "laliga", label: "La Liga" },
];

const MOCK_FIXTURES_EPL = {
  fixtures: [
    {
      providerFixtureId: "epl-001",
      homeTeamName: "Arsenal",
      awayTeamName: "Chelsea",
      kickoffIso: "2026-05-01T15:00:00Z",
      matchDay: 35,
      gameId: null,
      provider: "sportsdata",
    },
    {
      providerFixtureId: "epl-002",
      homeTeamName: "Liverpool",
      awayTeamName: "Man City",
      kickoffIso: "2026-05-01T17:30:00Z",
      matchDay: 35,
      gameId: null,
      provider: "sportsdata",
    },
  ],
};

const MOCK_FIXTURES_LALIGA = {
  fixtures: [
    {
      providerFixtureId: "laliga-001",
      homeTeamName: "Barcelona",
      awayTeamName: "Real Madrid",
      kickoffIso: "2026-05-02T20:00:00Z",
      matchDay: 32,
      gameId: null,
      provider: "sportsdata",
    },
  ],
};

const MOCK_ALL_SCHEDULES = {
  leagues: [
    { code: "epl", label: "EPL" },
    { code: "laliga", label: "La Liga" },
  ],
  schedules: {
    epl: { version: 1, fixtures: MOCK_FIXTURES_EPL.fixtures },
    laliga: { version: 1, fixtures: MOCK_FIXTURES_LALIGA.fixtures },
  },
};

const MOCK_SCHEDULE_STATUS = {
  leagues: { epl: { version: 1 }, laliga: { version: 1 } },
};

// -------------------------------------------------------------------------

function nextPort() {
  return 29000 + Math.floor(Math.random() * 1000);
}

async function switchToFixturesTab(page) {
  await page.locator(".tabbar__btn", { hasText: /upcoming fixtures/i }).click();
}

async function launchFrontendApp(t, { serverEnv = {} } = {}) {
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

  const context = await browser.newContext();
  const page = await context.newPage();

  // Bypass Google OAuth gate — return a mock session user
  await page.route("**/auth/me", (route) => {
    route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify({ name: "Test User", email: "test@pred.app", initials: "TU" }),
    });
  });

  // All schedules in one request (replaces per-league /upcoming calls)
  await page.route("**/api/schedules/all", (route) => {
    route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify(MOCK_ALL_SCHEDULES),
    });
  });

  // Version-poll endpoint (background interval — prevent unhandled 401 noise)
  await page.route("**/api/schedules/status", (route) => {
    route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify(MOCK_SCHEDULE_STATUS),
    });
  });

  return { page, started, browser, context };
}

// -------------------------------------------------------------------------
// Test 1: Fixture table loads
// -------------------------------------------------------------------------

test("frontend e2e: fixture table loads rows from mocked API", async (t) => {
  const launched = await launchFrontendApp(t);
  if (!launched) return;

  const { page, started } = launched;

  await page.goto(`${started.baseUrl}/`, { waitUntil: "domcontentloaded" });

  // Wait for fixture rows to appear (the useFixtures hook fetches and renders them)
  await switchToFixturesTab(page);
  await page.waitForSelector(".frow", { timeout: 15_000 });
  const rows = await page.locator(".frow").count();
  assert.ok(rows >= 3, `Expected at least 3 fixture rows, got ${rows}`);

  // Verify team names from mocked data appear
  const text = await page.locator(".ftable").innerText();
  assert.ok(text.includes("Arsenal"), "Expected Arsenal in fixture table");
  assert.ok(text.includes("Barcelona"), "Expected Barcelona in fixture table");
});

// -------------------------------------------------------------------------
// Test 2: Filter by league
// -------------------------------------------------------------------------

test("frontend e2e: filter by league reduces visible fixtures", async (t) => {
  const launched = await launchFrontendApp(t);
  if (!launched) return;

  const { page, started } = launched;

  await page.goto(`${started.baseUrl}/`, { waitUntil: "domcontentloaded" });
  await switchToFixturesTab(page);
  await page.waitForSelector(".frow", { timeout: 15_000 });

  // Count before filter
  const totalBefore = await page.locator(".frow").count();
  assert.ok(totalBefore >= 3, `Expected at least 3 rows before filter, got ${totalBefore}`);

  // Select EPL from the league filter dropdown
  await page.locator(".fbar__sel").first().selectOption({ label: "EPL" });

  // After filtering for EPL, only EPL fixtures should appear
  await page.waitForFunction(
    () => {
      const rows = document.querySelectorAll(".frow");
      return rows.length > 0 && rows.length < 3;
    },
    { timeout: 5_000 }
  );

  const totalAfter = await page.locator(".frow").count();
  assert.ok(
    totalAfter < totalBefore,
    `Filter should reduce rows: before=${totalBefore} after=${totalAfter}`
  );
  assert.ok(totalAfter >= 1, "Expected at least 1 EPL row after filtering");

  // Barcelona (La Liga) should not be visible
  const tableText = await page.locator(".ftable").innerText();
  assert.ok(
    !tableText.includes("Barcelona"),
    "Barcelona (La Liga) should not appear when EPL filter is active"
  );
});

// -------------------------------------------------------------------------
// Test 3: Fixture selection opens submarket panel
// -------------------------------------------------------------------------

test("frontend e2e: clicking a fixture opens the submarket panel", async (t) => {
  const launched = await launchFrontendApp(t);
  if (!launched) return;

  const { page, started } = launched;

  await page.goto(`${started.baseUrl}/`, { waitUntil: "domcontentloaded" });
  await switchToFixturesTab(page);
  await page.waitForSelector(".frow", { timeout: 15_000 });

  // Submarket panel should not be visible before selection
  const panelBeforeVisible = await page
    .locator(".spanel")
    .isVisible()
    .catch(() => false);
  assert.ok(!panelBeforeVisible, "Submarket panel should be hidden before any fixture is selected");

  // Click the first fixture row
  await page.locator(".frow").first().click();

  // Submarket panel should now appear
  await page.waitForSelector(".spanel", { timeout: 5_000 });
  const panelAfterVisible = await page.locator(".spanel").isVisible();
  assert.ok(panelAfterVisible, "Submarket panel should appear after selecting a fixture");
});

// -------------------------------------------------------------------------
// Test 4: Selection bar appears after fixture + submarket selection
// -------------------------------------------------------------------------

test("frontend e2e: selection bar appears after selecting fixture and submarket", async (t) => {
  const launched = await launchFrontendApp(t);
  if (!launched) return;

  const { page, started } = launched;

  await page.goto(`${started.baseUrl}/`, { waitUntil: "domcontentloaded" });
  await switchToFixturesTab(page);
  await page.waitForSelector(".frow", { timeout: 15_000 });

  // Click the first fixture
  await page.locator(".frow").first().click();

  // Wait for submarket panel
  await page.waitForSelector(".spanel", { timeout: 5_000 });

  // Click the first submarket checkbox/button in the panel
  const submarketCheckbox = page.locator(".spanel input[type=checkbox]").first();
  await submarketCheckbox.click();

  // Selection bar should appear
  await page.waitForSelector(".selbar", { timeout: 5_000 });
  const selBarVisible = await page.locator(".selbar").isVisible();
  assert.ok(selBarVisible, "Selection bar should appear when a fixture and submarket are selected");

  // Verify it shows at least 1 fixture selected
  const sbarText = await page.locator(".selbar").innerText();
  assert.match(sbarText, /1\s*(fixture|selected)/i, "Selection bar should mention 1 fixture");
});

// -------------------------------------------------------------------------
// Test 5: Review overlay opens with fixture list
// -------------------------------------------------------------------------

test("frontend e2e: review overlay opens showing selected fixtures", async (t) => {
  const launched = await launchFrontendApp(t);
  if (!launched) return;

  const { page, started } = launched;

  await page.goto(`${started.baseUrl}/`, { waitUntil: "domcontentloaded" });
  await switchToFixturesTab(page);
  await page.waitForSelector(".frow", { timeout: 15_000 });

  // Select first fixture
  await page.locator(".frow").first().click();

  // Wait for submarket panel and select a real market checkbox (not the
  // group-header indeterminate, which is a presentation-only no-op).
  await page.waitForSelector(".spanel", { timeout: 5_000 });
  await page.locator(".sitem input[type=checkbox]").first().click();

  // Wait for selection bar and click Review
  await page.waitForSelector(".selbar", { timeout: 5_000 });
  const reviewBtn = page.locator(".selbar button", { hasText: /review/i });
  await reviewBtn.waitFor({ timeout: 5_000 });
  await reviewBtn.click();

  // Review overlay should open
  await page.waitForSelector(".review", { timeout: 5_000 });
  const overlayVisible = await page.locator(".review").isVisible();
  assert.ok(overlayVisible, "Review overlay should be visible after clicking Review");

  // It should show at least one fixture name
  const overlayText = await page.locator(".review").innerText();
  const hasFixtureName =
    overlayText.includes("Arsenal") ||
    overlayText.includes("Liverpool") ||
    overlayText.includes("Barcelona");
  assert.ok(hasFixtureName, "Review overlay should display a fixture name");
});

// -------------------------------------------------------------------------
// Test 6: Batch publish flow — mock 202 + completed run
// -------------------------------------------------------------------------

test("frontend e2e: publish flow reaches done screen via mocked batch endpoints", async (t) => {
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

  const context = await browser.newContext();
  const page = await context.newPage();

  // Auth bypass + fixture stubs
  await page.route("**/auth/me", (route) => {
    route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify({ name: "Test User", email: "test@pred.app", initials: "TU" }),
    });
  });
  await page.route("**/api/schedules/all", (route) => {
    route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify(MOCK_ALL_SCHEDULES),
    });
  });
  await page.route("**/api/schedules/status", (route) => {
    route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify(MOCK_SCHEDULE_STATUS),
    });
  });

  const TEST_RUN_ID = "run-test-abc123";

  // Stub batch-publish → 202
  await page.route("**/api/cms/batch-publish", (route) => {
    route.fulfill({
      status: 202,
      contentType: "application/json",
      body: JSON.stringify({ ok: true, run_id: TEST_RUN_ID, status: "queued" }),
    });
  });

  // Stub batch-runs/:id → completed immediately
  await page.route(`**/api/cms/batch-runs/${TEST_RUN_ID}`, (route) => {
    route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify({
        run_id: TEST_RUN_ID,
        status: "completed",
        completed_at: new Date().toISOString(),
      }),
    });
  });

  await page.goto(`${started.baseUrl}/`, { waitUntil: "domcontentloaded" });
  await switchToFixturesTab(page);
  await page.waitForSelector(".frow", { timeout: 15_000 });

  // Select a fixture and a real submarket checkbox (not the group-header
  // indeterminate, which is a presentation-only no-op).
  await page.locator(".frow").first().click();
  await page.waitForSelector(".spanel", { timeout: 5_000 });
  await page.locator(".sitem input[type=checkbox]").first().click();
  await page.waitForSelector(".selbar", { timeout: 5_000 });

  // Open review overlay
  const reviewBtn = page.locator(".selbar button", { hasText: /review/i });
  await reviewBtn.waitFor({ timeout: 5_000 });
  await reviewBtn.click();
  await page.waitForSelector(".review", { timeout: 5_000 });

  // Click "Publish now" button in the overlay
  const publishBtn = page.locator(".review button", { hasText: /publish now/i });
  await publishBtn.waitFor({ timeout: 5_000 });
  await publishBtn.click();

  // Wait for done view — the overlay should show a success/done state
  await page.waitForFunction(
    () => {
      const overlay = document.querySelector(".review");
      if (!overlay) return false;
      const text = overlay.textContent || "";
      return /done|published|success/i.test(text);
    },
    { timeout: 15_000 }
  );

  const overlayText = await page.locator(".review").innerText();
  assert.match(
    overlayText,
    /done|published|success/i,
    "Expected done/success state in overlay after publish"
  );
});

// -------------------------------------------------------------------------
// Test 7: Theme toggle switches html.light class
// -------------------------------------------------------------------------

test("frontend e2e: theme toggle adds light class to html element", async (t) => {
  const launched = await launchFrontendApp(t);
  if (!launched) return;

  const { page, started } = launched;

  await page.goto(`${started.baseUrl}/`, { waitUntil: "domcontentloaded" });

  // Wait for the app to render (header should be present)
  await page.waitForSelector(".hdr", { timeout: 10_000 });

  // Check initial theme class (defaults to dark — no 'light' class expected)
  const lightBefore = await page.evaluate(() =>
    document.documentElement.classList.contains("light")
  );

  // Click the theme toggle button in the header
  const themeBtn = page
    .locator(
      ".hdr button[aria-label*=theme], .hdr button[title*=theme], .hdr .theme-btn, .hdr button"
    )
    .filter({ hasText: /theme|light|dark|☀|🌙/i })
    .first();
  await themeBtn.waitFor({ timeout: 5_000 }).catch(async () => {
    // Fallback: any button in header area with relevant aria
    await page.locator(".hdr button").last().waitFor({ timeout: 5_000 });
  });

  // Try clicking the theme toggle — find it by clicking the last/only icon-button in header
  const headerButtons = await page.locator(".hdr button").all();
  let toggled = false;
  for (const btn of headerButtons) {
    const label = await btn.getAttribute("aria-label").catch(() => "");
    const title = await btn.getAttribute("title").catch(() => "");
    const text = await btn.innerText().catch(() => "");
    if (/theme|light|dark|toggle/i.test(`${label}${title}${text}`)) {
      await btn.click();
      toggled = true;
      break;
    }
  }

  if (!toggled && headerButtons.length > 0) {
    // click the first button in header as fallback
    await headerButtons[0].click();
    toggled = true;
  }

  assert.ok(toggled, "Should have found and clicked a header button to toggle theme");

  // After toggle, the html element's class set should differ from before
  const lightAfter = await page.evaluate(() =>
    document.documentElement.classList.contains("light")
  );
  assert.notEqual(lightBefore, lightAfter, "Theme toggle should flip the html.light class");
});
