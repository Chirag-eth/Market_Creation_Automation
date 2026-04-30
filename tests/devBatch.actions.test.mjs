import test from "node:test";
import assert from "node:assert/strict";

import {
  toggleFixtureSelection,
  toggleMarketKey,
  setFixtureExcluded,
  toggleMarketExclusion,
  clearSelection,
  confirmSelection,
  goBack,
  toggleExpandResult,
  toggleExpandExclusion,
  selectUnpublishedFixtures,
  selectPartialFixtures,
} from "../src/app/devBatch/actions.js";

import { createInitialDevBatchState } from "../src/app/devBatch/state.js";
import { MAX_SELECTION } from "../src/app/devBatch/constants.js";

// ---------------------------------------------------------------------------
// Test context factory
// ---------------------------------------------------------------------------

function makeCtx(overrides = {}) {
  const devBatch = createInitialDevBatchState();
  const state = { devBatch };
  const calls = { toasts: [], renders: 0, persists: 0, syncs: 0 };

  const ctx = {
    state,
    runtime: {
      normalizeRuntimeAppEnvCode: (env) => env,
      getScheduleLeagueViewModels: () => [],
      getScheduleLeagueLabel: (code) => code,
      getScheduleFixtureIdentity: (f) => `game:${f.gameId}`,
      normalizeForSearch: (s) => String(s || "").toLowerCase(),
    },
    ui: {
      showToast: (msg, tone) => calls.toasts.push({ msg, tone }),
      showPublishError: (msg) => calls.toasts.push({ msg, tone: "error" }),
      persistEnvironmentScopedSnapshot: () => { calls.persists++; },
      renderDevBatchConsole: () => { calls.renders++; },
      syncActionState: () => { calls.syncs++; },
      setButtonBusy: () => {},
      els: { devBatchLoadFixturesBtn: null },
    },
    api: {
      fetchUpcomingFixturesForLeague: async () => ({ fixtures: [] }),
      fetchCmsBatchRun: async () => null,
      preflightCmsBatchPublish: async () => ({}),
      publishCmsBatch: async () => ({ run_id: "r1" }),
      stopCmsBatchRun: async () => ({ ok: true }),
    },
    helpers: {
      escapeHtml: (s) => String(s),
      escapeHtmlAttribute: (s) => String(s),
      slugify: (s) => String(s).toLowerCase().replace(/\s+/g, "-"),
      normalizeForSearch: (s) => String(s || "").toLowerCase(),
    },
    selectors: {},
    feature: {
      publishKeySet: new Set(["moneyline|0", "btts|0", "totals|1.5"]),
      publishOptions: [
        { key: "moneyline|0", label: "Moneyline" },
        { key: "btts|0", label: "BTTS" },
        { key: "totals|1.5", label: "Totals 1.5" },
      ],
    },
    _calls: calls,
    ...overrides,
  };

  return ctx;
}

function makeFixture(gameId, leagueCode = "epl") {
  return { gameId, eventName: `Match ${gameId}`, leagueCode, kickoffIso: "2026-05-01T15:00:00Z" };
}

// ---------------------------------------------------------------------------
// toggleFixtureSelection
// ---------------------------------------------------------------------------

test("toggleFixtureSelection adds a fixture to selection", () => {
  const ctx = makeCtx();
  toggleFixtureSelection(ctx, "game:1");
  assert.deepEqual(ctx.state.devBatch.selectedFixtureIds, ["game:1"]);
  assert.equal(ctx._calls.renders, 1);
});

test("toggleFixtureSelection removes fixture when already selected", () => {
  const ctx = makeCtx();
  ctx.state.devBatch.selectedFixtureIds = ["game:1", "game:2"];
  toggleFixtureSelection(ctx, "game:1");
  assert.deepEqual(ctx.state.devBatch.selectedFixtureIds, ["game:2"]);
});

test("toggleFixtureSelection ignores empty fixtureId", () => {
  const ctx = makeCtx();
  toggleFixtureSelection(ctx, "");
  assert.deepEqual(ctx.state.devBatch.selectedFixtureIds, []);
  assert.equal(ctx._calls.renders, 0);
});

test("toggleFixtureSelection shows toast and refuses when MAX_SELECTION reached", () => {
  const ctx = makeCtx();
  // Fill to max
  ctx.state.devBatch.selectedFixtureIds = Array.from({ length: MAX_SELECTION }, (_, i) => `game:${i}`);
  toggleFixtureSelection(ctx, "game:99");
  // Still at max, not added
  assert.equal(ctx.state.devBatch.selectedFixtureIds.length, MAX_SELECTION);
  assert.ok(ctx._calls.toasts.length > 0);
  assert.equal(ctx._calls.renders, 0);
});

test("toggleFixtureSelection clears verification and currentRun on change", () => {
  const ctx = makeCtx();
  ctx.state.devBatch.verification = { fixtures: [] };
  ctx.state.devBatch.currentRun = { run_id: "r1" };
  toggleFixtureSelection(ctx, "game:1");
  assert.equal(ctx.state.devBatch.verification, null);
  assert.equal(ctx.state.devBatch.currentRun, null);
});

// ---------------------------------------------------------------------------
// toggleMarketKey
// ---------------------------------------------------------------------------

test("toggleMarketKey adds a valid key", () => {
  const ctx = makeCtx();
  toggleMarketKey(ctx, "moneyline|0", true);
  assert.ok(ctx.state.devBatch.selectedPublishKeys.includes("moneyline|0"));
});

test("toggleMarketKey removes a key when unchecked", () => {
  const ctx = makeCtx();
  ctx.state.devBatch.selectedPublishKeys = ["moneyline|0", "btts|0"];
  toggleMarketKey(ctx, "moneyline|0", false);
  assert.ok(!ctx.state.devBatch.selectedPublishKeys.includes("moneyline|0"));
  assert.ok(ctx.state.devBatch.selectedPublishKeys.includes("btts|0"));
});

test("toggleMarketKey ignores invalid keys", () => {
  const ctx = makeCtx();
  toggleMarketKey(ctx, "invalid-key", true);
  assert.deepEqual(ctx.state.devBatch.selectedPublishKeys, []);
  assert.equal(ctx._calls.renders, 0);
});

// ---------------------------------------------------------------------------
// setFixtureExcluded
// ---------------------------------------------------------------------------

test("setFixtureExcluded sets excluded_fixture to true", () => {
  const ctx = makeCtx();
  setFixtureExcluded(ctx, "game:1", true);
  assert.equal(ctx.state.devBatch.perFixtureExclusions["game:1"].excluded_fixture, true);
});

test("setFixtureExcluded sets excluded_fixture to false", () => {
  const ctx = makeCtx();
  ctx.state.devBatch.perFixtureExclusions["game:1"] = {
    excluded_fixture: true,
    excluded_publish_keys: [],
  };
  setFixtureExcluded(ctx, "game:1", false);
  assert.equal(ctx.state.devBatch.perFixtureExclusions["game:1"].excluded_fixture, false);
});

test("setFixtureExcluded ignores empty fixtureId", () => {
  const ctx = makeCtx();
  setFixtureExcluded(ctx, "", true);
  assert.deepEqual(ctx.state.devBatch.perFixtureExclusions, {});
});

// ---------------------------------------------------------------------------
// toggleMarketExclusion
// ---------------------------------------------------------------------------

test("toggleMarketExclusion adds key to excluded_publish_keys", () => {
  const ctx = makeCtx();
  toggleMarketExclusion(ctx, "game:1", "moneyline|0", true);
  const exclusion = ctx.state.devBatch.perFixtureExclusions["game:1"];
  assert.ok(exclusion.excluded_publish_keys.includes("moneyline|0"));
});

test("toggleMarketExclusion removes key from excluded_publish_keys", () => {
  const ctx = makeCtx();
  ctx.state.devBatch.perFixtureExclusions["game:1"] = {
    excluded_fixture: false,
    excluded_publish_keys: ["moneyline|0"],
  };
  toggleMarketExclusion(ctx, "game:1", "moneyline|0", false);
  assert.deepEqual(ctx.state.devBatch.perFixtureExclusions["game:1"].excluded_publish_keys, []);
});

test("toggleMarketExclusion ignores invalid market key", () => {
  const ctx = makeCtx();
  toggleMarketExclusion(ctx, "game:1", "bad-key", true);
  assert.deepEqual(ctx.state.devBatch.perFixtureExclusions, {});
  assert.equal(ctx._calls.renders, 0);
});

// ---------------------------------------------------------------------------
// clearSelection
// ---------------------------------------------------------------------------

test("clearSelection empties selectedFixtureIds", () => {
  const ctx = makeCtx();
  ctx.state.devBatch.selectedFixtureIds = ["game:1", "game:2"];
  clearSelection(ctx);
  assert.deepEqual(ctx.state.devBatch.selectedFixtureIds, []);
  assert.equal(ctx._calls.renders, 1);
});

// ---------------------------------------------------------------------------
// confirmSelection (step transition)
// ---------------------------------------------------------------------------

test("confirmSelection moves to config step when fixtures selected", () => {
  const ctx = makeCtx();
  ctx.state.devBatch.selectedFixtureIds = ["game:1"];
  ctx.state.devBatch.fixtures = [makeFixture("1")];
  confirmSelection(ctx);
  assert.equal(ctx.state.devBatch.step, "config");
});

test("confirmSelection does nothing when nothing selected", () => {
  const ctx = makeCtx();
  confirmSelection(ctx);
  assert.equal(ctx.state.devBatch.step, "selection");
  assert.equal(ctx._calls.renders, 0);
});

// ---------------------------------------------------------------------------
// goBack (step transition)
// ---------------------------------------------------------------------------

test("goBack returns to selection step from config", () => {
  const ctx = makeCtx();
  ctx.state.devBatch.step = "config";
  goBack(ctx);
  assert.equal(ctx.state.devBatch.step, "selection");
  assert.equal(ctx._calls.renders, 1);
});

// ---------------------------------------------------------------------------
// toggleExpandResult
// ---------------------------------------------------------------------------

test("toggleExpandResult adds fixtureKey to expandedFixtureKeys", () => {
  const ctx = makeCtx();
  toggleExpandResult(ctx, "game:1");
  assert.ok(ctx.state.devBatch.expandedFixtureKeys.includes("game:1"));
});

test("toggleExpandResult removes fixtureKey when already expanded", () => {
  const ctx = makeCtx();
  ctx.state.devBatch.expandedFixtureKeys = ["game:1"];
  toggleExpandResult(ctx, "game:1");
  assert.ok(!ctx.state.devBatch.expandedFixtureKeys.includes("game:1"));
});

// ---------------------------------------------------------------------------
// toggleExpandExclusion
// ---------------------------------------------------------------------------

test("toggleExpandExclusion adds fixtureId to expandedExclusionIds", () => {
  const ctx = makeCtx();
  toggleExpandExclusion(ctx, "game:1");
  assert.ok(ctx.state.devBatch.expandedExclusionIds.includes("game:1"));
});

test("toggleExpandExclusion collapses already-expanded fixture", () => {
  const ctx = makeCtx();
  ctx.state.devBatch.expandedExclusionIds = ["game:1"];
  toggleExpandExclusion(ctx, "game:1");
  assert.ok(!ctx.state.devBatch.expandedExclusionIds.includes("game:1"));
});

// ---------------------------------------------------------------------------
// selectUnpublishedFixtures
// ---------------------------------------------------------------------------

test("selectUnpublishedFixtures selects fixtures with missing markets (up to MAX)", () => {
  const ctx = makeCtx();
  ctx.state.devBatch.fixtures = [makeFixture("1"), makeFixture("2"), makeFixture("3")];
  ctx.state.devBatch.verification = {
    fixtures: [
      { fixture_key: "game:1", markets: [{ status: "missing" }] },
      { fixture_key: "game:2", markets: [{ status: "existing" }] },
      { fixture_key: "game:3", markets: [{ status: "missing" }] },
    ],
  };
  selectUnpublishedFixtures(ctx);
  const ids = ctx.state.devBatch.selectedFixtureIds;
  assert.ok(ids.includes("game:1"));
  assert.ok(ids.includes("game:3"));
  assert.ok(!ids.includes("game:2"));
});

// ---------------------------------------------------------------------------
// selectPartialFixtures
// ---------------------------------------------------------------------------

test("selectPartialFixtures selects fixtures with partial verification status", () => {
  const ctx = makeCtx();
  ctx.state.devBatch.fixtures = [makeFixture("1"), makeFixture("2")];
  ctx.state.devBatch.verification = {
    fixtures: [
      { fixture_key: "game:1", status: "partial", markets: [] },
      { fixture_key: "game:2", status: "ready", markets: [] },
    ],
  };
  selectPartialFixtures(ctx);
  const ids = ctx.state.devBatch.selectedFixtureIds;
  assert.ok(ids.includes("game:1"));
  assert.ok(!ids.includes("game:2"));
});
