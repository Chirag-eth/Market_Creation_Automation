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
    basicAuth ? { httpCredentials: { username: basicAuth.user, password: basicAuth.pass } } : {}
  );
  const page = await context.newPage();

  return { page, started, browser, context };
}

async function waitForAppReady(page) {
  await page.waitForSelector(".hdr", { timeout: 30_000 });
}

// -------------------------------------------------------------------------
// Test 1: Dashboard shell and theme toggle
// -------------------------------------------------------------------------

test("browser e2e: dashboard shell and theme toggle", async (t) => {
  const launched = await launchFixtureApp(t);
  if (!launched) return;

  const { page, started } = launched;
  await page.goto(`${started.baseUrl}/`, { waitUntil: "domcontentloaded" });
  await waitForAppReady(page);

  // Header is present
  const hdrVisible = await page.locator(".hdr").isVisible();
  assert.ok(hdrVisible, "Expected React header (.hdr) to be visible");

  // Tab bar has at least 2 tabs
  const tabTexts = await page.locator(".tabbar__btn").allTextContents();
  assert.ok(tabTexts.length >= 2, `Expected at least 2 tabs, got ${tabTexts.length}`);
  assert.ok(tabTexts.some((label) => /builder/i.test(label)), "Expected a Builder tab");
  assert.ok(tabTexts.some((label) => /upcoming fixtures/i.test(label)), "Expected an Upcoming Fixtures tab");

  // Theme toggle flips the light class on <html>
  const lightBefore = await page.evaluate(() => document.documentElement.classList.contains("light"));
  const themeBtn = page.locator(".hdr__theme");
  await themeBtn.waitFor({ timeout: 5_000 });
  await themeBtn.click();
  const lightAfter = await page.evaluate(() => document.documentElement.classList.contains("light"));
  assert.notEqual(lightBefore, lightAfter, "Theme toggle should flip the html.light class");
});

// -------------------------------------------------------------------------
// Tests 2-12: These tested the legacy market-ops.html / src/app/ui.js app
// which has been superseded by the React frontend. They are skipped until
// equivalent React-based coverage is written.
// -------------------------------------------------------------------------

const LEGACY_SKIP =
  "Tests legacy market-ops.html UI (src/app/ui.js) that has been replaced by the React frontend.";

test("browser e2e: planned fixture source state cannot strand the frontend", (t) => {
  t.skip(LEGACY_SKIP);
});

test("browser e2e: builder loads deterministic six-week EPL window and supports week switching", (t) => {
  t.skip(LEGACY_SKIP);
});

test("browser e2e: ambiguous FIFA schedule lanes stay hidden until the catalog maps them explicitly", (t) => {
  t.skip(LEGACY_SKIP);
});

test("browser e2e: upcoming fixtures exposes accessible league and week selectors, filter popover, and apply-to-generate", (t) => {
  t.skip(LEGACY_SKIP);
});

test("browser e2e: basic-auth protected app still loads schedules and fixture generation works when API bearer auth is disabled", (t) => {
  t.skip(LEGACY_SKIP);
});

test("browser e2e: basic-auth shell stays quiet when a saved bearer token unlocks the protected API", (t) => {
  t.skip(LEGACY_SKIP);
});

test("browser e2e: UAT composer exposes env badge, market-family switching, and UAT output panels", (t) => {
  t.skip(LEGACY_SKIP);
});

test("browser e2e: output rail captures wheel scrolling as a single component", (t) => {
  t.skip(LEGACY_SKIP);
});

test("browser e2e: schedule fetch failure keeps controls usable and surfaces clear errors", (t) => {
  t.skip(LEGACY_SKIP);
});

test("browser e2e: league switching clears stale search and shows explicit empty-state messaging", (t) => {
  t.skip(LEGACY_SKIP);
});

test("browser e2e: upcoming fixtures shows every backend-ready schedule league", (t) => {
  t.skip(LEGACY_SKIP);
});
