import test from "node:test";
import assert from "node:assert/strict";

import {
  selectSelectedFixtures,
  selectVerificationByFixture,
  selectVisibleFixtures,
  selectPinnedFixtures,
  selectUnselectedFixtures,
  selectCanConfirm,
  selectCanStop,
  selectCanRetryFailed,
  selectSelectionSummary,
  getDevBatchMarketRows,
  getDevBatchFixtureCounts,
  getDevBatchRunTone,
} from "../src/app/devBatch/selectors.js";

import { createInitialDevBatchState } from "../src/app/devBatch/state.js";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function makeFixture(gameId, { leagueCode = "epl", eventName = `Match ${gameId}`, leagueLabel = "EPL" } = {}) {
  return { gameId, eventName, leagueCode, leagueLabel, kickoffIso: "2026-05-01T15:00:00Z" };
}

function identity(fixture) {
  return `game:${fixture.gameId}`;
}

const deps = { getScheduleFixtureIdentity: identity };

// ---------------------------------------------------------------------------
// selectSelectedFixtures
// ---------------------------------------------------------------------------

test("selectSelectedFixtures returns empty array when nothing selected", () => {
  const state = createInitialDevBatchState();
  state.fixtures = [makeFixture("1"), makeFixture("2")];
  assert.deepEqual(selectSelectedFixtures(state, deps), []);
});

test("selectSelectedFixtures returns only selected fixtures", () => {
  const state = createInitialDevBatchState();
  const f1 = makeFixture("1");
  const f2 = makeFixture("2");
  state.fixtures = [f1, f2];
  state.selectedFixtureIds = ["game:1"];
  const result = selectSelectedFixtures(state, deps);
  assert.equal(result.length, 1);
  assert.equal(result[0].gameId, "1");
});

test("selectSelectedFixtures uses fallback identity when no deps", () => {
  const state = createInitialDevBatchState();
  const f1 = makeFixture("42");
  state.fixtures = [f1];
  state.selectedFixtureIds = ["game:42"];
  // No deps → uses defaultGetScheduleFixtureIdentity which also produces game:42
  const result = selectSelectedFixtures(state);
  assert.equal(result.length, 1);
});

// ---------------------------------------------------------------------------
// selectVerificationByFixture
// ---------------------------------------------------------------------------

test("selectVerificationByFixture returns empty Map when no verification", () => {
  const state = createInitialDevBatchState();
  const map = selectVerificationByFixture(state);
  assert.equal(map.size, 0);
});

test("selectVerificationByFixture maps fixture_key and game: prefixed key", () => {
  const state = createInitialDevBatchState();
  state.verification = {
    fixtures: [{ fixture_key: "game:99", status: "ready", markets: [] }],
  };
  const map = selectVerificationByFixture(state);
  assert.ok(map.has("game:99"));
  assert.ok(map.has("game:game:99"));
  assert.equal(map.get("game:99").status, "ready");
});

// ---------------------------------------------------------------------------
// selectVisibleFixtures — filter tests
// ---------------------------------------------------------------------------

test("selectVisibleFixtures returns all fixtures when no filters active", () => {
  const state = createInitialDevBatchState();
  state.fixtures = [makeFixture("1"), makeFixture("2"), makeFixture("3")];
  const visible = selectVisibleFixtures(state, deps);
  assert.equal(visible.length, 3);
});

test("selectVisibleFixtures filters by leagueCode", () => {
  const state = createInitialDevBatchState();
  state.fixtures = [
    makeFixture("1", { leagueCode: "epl" }),
    makeFixture("2", { leagueCode: "laliga" }),
  ];
  state.filters.leagueFilter = "epl";
  const visible = selectVisibleFixtures(state, deps);
  assert.equal(visible.length, 1);
  assert.equal(visible[0].gameId, "1");
});

test("selectVisibleFixtures filters by selectedOnly", () => {
  const state = createInitialDevBatchState();
  state.fixtures = [makeFixture("1"), makeFixture("2")];
  state.selectedFixtureIds = ["game:2"];
  state.filters.selectedOnly = true;
  const visible = selectVisibleFixtures(state, deps);
  assert.equal(visible.length, 1);
  assert.equal(visible[0].gameId, "2");
});

test("selectVisibleFixtures filters by search matching eventName", () => {
  const state = createInitialDevBatchState();
  state.fixtures = [
    makeFixture("1", { eventName: "Arsenal vs Chelsea" }),
    makeFixture("2", { eventName: "Barcelona vs Madrid" }),
  ];
  state.filters.search = "arsenal";
  const visible = selectVisibleFixtures(state, deps);
  assert.equal(visible.length, 1);
  assert.equal(visible[0].gameId, "1");
});

// ---------------------------------------------------------------------------
// selectPinnedFixtures / selectUnselectedFixtures
// ---------------------------------------------------------------------------

test("selectPinnedFixtures returns only selected+visible fixtures", () => {
  const state = createInitialDevBatchState();
  state.fixtures = [makeFixture("1"), makeFixture("2"), makeFixture("3")];
  state.selectedFixtureIds = ["game:1", "game:3"];
  const pinned = selectPinnedFixtures(state, deps);
  assert.equal(pinned.length, 2);
  assert.ok(pinned.some((f) => f.gameId === "1"));
  assert.ok(pinned.some((f) => f.gameId === "3"));
});

test("selectUnselectedFixtures returns visible but unselected fixtures", () => {
  const state = createInitialDevBatchState();
  state.fixtures = [makeFixture("1"), makeFixture("2"), makeFixture("3")];
  state.selectedFixtureIds = ["game:2"];
  const unselected = selectUnselectedFixtures(state, deps);
  assert.equal(unselected.length, 2);
  assert.ok(unselected.every((f) => f.gameId !== "2"));
});

// ---------------------------------------------------------------------------
// selectCanConfirm
// ---------------------------------------------------------------------------

test("selectCanConfirm is false when nothing selected", () => {
  const state = createInitialDevBatchState();
  assert.equal(selectCanConfirm(state), false);
});

test("selectCanConfirm is true when at least one fixture selected", () => {
  const state = createInitialDevBatchState();
  state.selectedFixtureIds = ["game:1"];
  assert.equal(selectCanConfirm(state), true);
});

// ---------------------------------------------------------------------------
// selectCanStop
// ---------------------------------------------------------------------------

test("selectCanStop is false when no current run", () => {
  const state = createInitialDevBatchState();
  assert.equal(selectCanStop(state), false);
});

test("selectCanStop is true when run is running and stop_requested is false", () => {
  const state = createInitialDevBatchState();
  state.currentRun = { status: "running", stop_requested: false };
  assert.equal(selectCanStop(state), true);
});

test("selectCanStop is false when run is running but stop_requested is true", () => {
  const state = createInitialDevBatchState();
  state.currentRun = { status: "running", stop_requested: true };
  assert.equal(selectCanStop(state), false);
});

test("selectCanStop is false when run is completed", () => {
  const state = createInitialDevBatchState();
  state.currentRun = { status: "completed", stop_requested: false };
  assert.equal(selectCanStop(state), false);
});

// ---------------------------------------------------------------------------
// selectCanRetryFailed
// ---------------------------------------------------------------------------

test("selectCanRetryFailed is false when no last run", () => {
  const state = createInitialDevBatchState();
  assert.equal(selectCanRetryFailed(state), false);
});

test("selectCanRetryFailed is false when last run has no failed markets", () => {
  const state = createInitialDevBatchState();
  state.lastRun = {
    fixtures: [{ markets: [{ status: "published" }, { status: "existing" }] }],
  };
  assert.equal(selectCanRetryFailed(state), false);
});

test("selectCanRetryFailed is true when at least one market is failed", () => {
  const state = createInitialDevBatchState();
  state.lastRun = {
    fixtures: [{ markets: [{ status: "published" }, { status: "failed" }] }],
  };
  assert.equal(selectCanRetryFailed(state), true);
});

// ---------------------------------------------------------------------------
// selectSelectionSummary
// ---------------------------------------------------------------------------

test("selectSelectionSummary returns zero count for empty selection", () => {
  const state = createInitialDevBatchState();
  state.fixtures = [makeFixture("1")];
  const summary = selectSelectionSummary(state, deps);
  assert.equal(summary.count, 0);
  assert.equal(summary.selectionMeta, "0 selected");
});

test("selectSelectionSummary includes league names and count when fixtures selected", () => {
  const state = createInitialDevBatchState();
  const f1 = makeFixture("1", { leagueLabel: "EPL" });
  const f2 = makeFixture("2", { leagueLabel: "LaLiga" });
  state.fixtures = [f1, f2];
  state.selectedFixtureIds = ["game:1", "game:2"];
  state.selectedPublishKeys = ["moneyline|0", "btts|0"];
  const summary = selectSelectionSummary(state, deps);
  assert.equal(summary.count, 2);
  assert.equal(summary.selectionMeta, "2/10 selected");
  assert.ok(summary.leagues.includes("EPL"));
  assert.ok(summary.leagues.includes("LaLiga"));
  assert.ok(summary.configMeta.includes("2 market keys"));
});

// ---------------------------------------------------------------------------
// getDevBatchMarketRows
// ---------------------------------------------------------------------------

test("getDevBatchMarketRows returns markets array when present", () => {
  const fixture = { markets: [{ status: "ready" }, { status: "existing" }] };
  assert.equal(getDevBatchMarketRows(fixture).length, 2);
});

test("getDevBatchMarketRows falls back to market_results", () => {
  const fixture = { market_results: [{ status: "published" }] };
  assert.equal(getDevBatchMarketRows(fixture).length, 1);
});

test("getDevBatchMarketRows returns empty array for null input", () => {
  assert.deepEqual(getDevBatchMarketRows(null), []);
});

// ---------------------------------------------------------------------------
// getDevBatchFixtureCounts
// ---------------------------------------------------------------------------

test("getDevBatchFixtureCounts counts market statuses correctly", () => {
  const fixture = {
    markets: [
      { status: "existing" },
      { status: "missing" },
      { status: "missing" },
      { status: "published" },
      { status: "failed" },
    ],
  };
  const counts = getDevBatchFixtureCounts(fixture);
  assert.equal(counts.existing, 1);
  assert.equal(counts.missing, 2);
  assert.equal(counts.published, 1);
  assert.equal(counts.failed, 1);
});

test("getDevBatchFixtureCounts uses top-level count fields when present", () => {
  const fixture = {
    existing_market_count: 5,
    missing_market_count: 3,
    markets: [],
  };
  const counts = getDevBatchFixtureCounts(fixture);
  assert.equal(counts.existing, 5);
  assert.equal(counts.missing, 3);
});

// ---------------------------------------------------------------------------
// getDevBatchRunTone
// ---------------------------------------------------------------------------

test("getDevBatchRunTone returns success for completed status", () => {
  assert.equal(getDevBatchRunTone("completed"), "success");
});

test("getDevBatchRunTone returns warn for partial status", () => {
  assert.equal(getDevBatchRunTone("partial"), "warn");
});

test("getDevBatchRunTone returns error for failed status", () => {
  assert.equal(getDevBatchRunTone("failed"), "error");
});

test("getDevBatchRunTone returns neutral for empty/unknown status", () => {
  assert.equal(getDevBatchRunTone(""), "neutral");
  assert.equal(getDevBatchRunTone("unknown"), "neutral");
});
