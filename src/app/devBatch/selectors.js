import { MAX_SELECTION, MARKET_OPTIONS } from "./constants.js";

// ---------------------------------------------------------------------------
// Low-level data accessors
// ---------------------------------------------------------------------------

export function getDevBatchMarketRows(fixture = {}) {
  return Array.isArray(fixture?.markets)
    ? fixture.markets
    : Array.isArray(fixture?.market_results)
      ? fixture.market_results
      : [];
}

export function getDevBatchFixtureCounts(fixture = {}) {
  const markets = getDevBatchMarketRows(fixture);
  return {
    existing: Number(fixture?.existing_market_count ?? markets.filter((row) => row.status === "existing").length),
    missing: Number(
      fixture?.missing_market_count ??
        markets.filter((row) =>
          ["missing", "ready"].includes(String(row?.status || "").trim().toLowerCase())
        ).length
    ),
    published: markets.filter((row) =>
      ["published", "created"].includes(String(row?.status || "").trim().toLowerCase())
    ).length,
    failed: markets.filter((row) =>
      String(row?.status || "").trim().toLowerCase() === "failed"
    ).length,
    halfPrepared: Number(
      fixture?.half_prepared_market_count ??
        markets.filter((row) =>
          String(row?.status || "").trim().toLowerCase() === "half_prepared"
        ).length
    ),
    blocked: Number(
      fixture?.blocked_market_count ??
        markets.filter((row) =>
          String(row?.status || "").trim().toLowerCase() === "blocked"
        ).length
    ),
  };
}

export function getDevBatchFixtureDisplayName(fixture = {}) {
  return String(
    fixture?.fixture?.event_name ||
      fixture?.fixture?.eventName ||
      fixture?.event_name ||
      fixture?.eventName ||
      "Fixture"
  ).trim();
}

export function getDevBatchRunTone(status = "") {
  const normalized = String(status || "").trim().toLowerCase();
  if (["completed", "ready", "existing"].includes(normalized)) return "success";
  if (
    ["partial", "publishing", "queued", "running", "stopping", "stopped"].includes(normalized)
  )
    return "warn";
  if (["failed", "failed_precheck", "blocked"].includes(normalized)) return "error";
  return "neutral";
}

export function getDevBatchAggregateStatusCards(source = null) {
  const aggregate = source?.aggregate || {};
  const fixtures = Array.isArray(source?.fixtures) ? source.fixtures : [];
  const allMarkets = fixtures.flatMap((fixture) => getDevBatchMarketRows(fixture));
  return [
    {
      label: "Queued",
      value:
        allMarkets.filter((market) =>
          ["missing", "ready", "queued"].includes(
            String(market?.status || "").trim().toLowerCase()
          )
        ).length || Number(aggregate.markets_ready || aggregate.markets_missing || 0),
      tone: "neutral",
    },
    {
      label: "Publishing",
      value: allMarkets.filter(
        (market) =>
          String(market?.status || "").trim().toLowerCase() === "publishing"
      ).length,
      tone: "warn",
    },
    {
      label: "Completed",
      value:
        allMarkets.filter((market) =>
          ["published", "created", "existing", "skipped"].includes(
            String(market?.status || "").trim().toLowerCase()
          )
        ).length || Number(aggregate.markets_published || 0),
      tone: "success",
    },
    {
      label: "Failed",
      value: Number(aggregate.markets_failed || 0),
      tone: "error",
    },
  ];
}

// ---------------------------------------------------------------------------
// Selectors — all take batchState as first argument
// ---------------------------------------------------------------------------

export function selectSelectedIds(batchState) {
  return Array.isArray(batchState?.selectedFixtureIds) ? batchState.selectedFixtureIds : [];
}

/**
 * Returns fixtures from batchState.fixtures that are in the selection.
 * Accepts optional deps object with getScheduleFixtureIdentity.
 */
export function selectSelectedFixtures(batchState, deps = {}) {
  const getIdentity =
    deps.getScheduleFixtureIdentity || defaultGetScheduleFixtureIdentity;
  const selected = new Set(selectSelectedIds(batchState));
  const fixtures = Array.isArray(batchState?.fixtures) ? batchState.fixtures : [];
  return fixtures.filter((fixture) => selected.has(getIdentity(fixture)));
}

/** Map<fixtureId, verificationFixture> */
export function selectVerificationByFixture(batchState) {
  const fixtures = Array.isArray(batchState?.verification?.fixtures)
    ? batchState.verification.fixtures
    : [];
  const map = new Map();
  for (const fixture of fixtures) {
    const rawKey = String(fixture?.fixture_key || "").trim();
    if (!rawKey) continue;
    map.set(rawKey, fixture);
    map.set(`game:${rawKey}`, fixture);
  }
  return map;
}

// Alias for backwards compatibility with existing code
export const getDevBatchVerificationByFixture = selectVerificationByFixture;

/** Filtered fixtures per current filter state. */
export function selectVisibleFixtures(batchState, deps = {}) {
  const getIdentity =
    deps.getScheduleFixtureIdentity || defaultGetScheduleFixtureIdentity;
  const normalizeSearch =
    deps.normalizeForSearch || ((s) => String(s || "").toLowerCase().trim());

  const fixtures = Array.isArray(batchState?.fixtures) ? batchState.fixtures : [];
  const search = normalizeSearch(batchState?.filters?.search || "");
  const leagueFilter = String(batchState?.filters?.leagueFilter || "").trim().toLowerCase();
  const selectedOnly = Boolean(batchState?.filters?.selectedOnly);
  const unpublishedOnly = Boolean(batchState?.filters?.unpublishedOnly);
  const partialOnly = Boolean(batchState?.filters?.partialOnly);
  const selectedIdSet = new Set(selectSelectedIds(batchState));
  const verificationByFixture = selectVerificationByFixture(batchState);

  return fixtures.filter((fixture) => {
    const fixtureId = getIdentity(fixture);
    if (leagueFilter && String(fixture?.leagueCode || "").trim().toLowerCase() !== leagueFilter)
      return false;
    if (selectedOnly && !selectedIdSet.has(fixtureId)) return false;
    const verification = verificationByFixture.get(fixtureId);
    const marketResults = getDevBatchMarketRows(verification);
    if (
      unpublishedOnly &&
      marketResults.length > 0 &&
      !marketResults.some(
        (row) => String(row?.status || "").trim().toLowerCase() === "missing"
      )
    )
      return false;
    if (
      partialOnly &&
      verification &&
      String(verification.status || "").trim().toLowerCase() !== "partial"
    )
      return false;
    if (!search) return true;
    const haystack = normalizeSearch(
      [
        fixture?.eventName,
        fixture?.leagueLabel,
        fixture?.fixtureDate,
        fixture?.kickoffTimeUtc,
        fixture?.gameId,
      ]
        .filter(Boolean)
        .join(" ")
    );
    return haystack.includes(search);
  });
}

// Alias for backwards compatibility
export const getVisibleDevBatchFixtures = (appState, deps = {}) =>
  selectVisibleFixtures(appState?.devBatch || appState, deps);

/** Selected AND visible fixtures (pinned group). */
export function selectPinnedFixtures(batchState, deps = {}) {
  const getIdentity =
    deps.getScheduleFixtureIdentity || defaultGetScheduleFixtureIdentity;
  const visible = selectVisibleFixtures(batchState, deps);
  const selectedIdSet = new Set(selectSelectedIds(batchState));
  return visible.filter((fixture) => selectedIdSet.has(getIdentity(fixture)));
}

/** Visible AND NOT selected fixtures. */
export function selectUnselectedFixtures(batchState, deps = {}) {
  const getIdentity =
    deps.getScheduleFixtureIdentity || defaultGetScheduleFixtureIdentity;
  const visible = selectVisibleFixtures(batchState, deps);
  const selectedIdSet = new Set(selectSelectedIds(batchState));
  return visible.filter((fixture) => !selectedIdSet.has(getIdentity(fixture)));
}

export function selectFocusedFixture(batchState, deps = {}) {
  const getIdentity =
    deps.getScheduleFixtureIdentity || defaultGetScheduleFixtureIdentity;
  const focusedId = String(batchState?.focusedFixtureId || "").trim();
  const fixtures = Array.isArray(batchState?.fixtures) ? batchState.fixtures : [];
  return fixtures.find((fixture) => getIdentity(fixture) === focusedId) || null;
}

// Alias for backwards compatibility
export const getFocusedDevBatchFixture = (appState, deps = {}) =>
  selectFocusedFixture(appState?.devBatch || appState, deps);

/** Unique leagues from batchState.fixtures */
export function selectLeagueOptions(batchState) {
  const fixtures = Array.isArray(batchState?.fixtures) ? batchState.fixtures : [];
  return [
    ...new Map(
      fixtures
        .filter((f) => String(f?.leagueCode || "").trim())
        .map((f) => [
          String(f.leagueCode || "").trim().toLowerCase(),
          {
            code: String(f.leagueCode || "").trim().toLowerCase(),
            label: String(f.leagueLabel || f.leagueCode || "").trim(),
          },
        ])
    ).values(),
  ].sort((a, b) => a.label.localeCompare(b.label));
}

/** { count, leagues, text } */
export function selectSelectionSummary(batchState, deps = {}) {
  const selectedFixtures = selectSelectedFixtures(batchState, deps);
  const count = selectedFixtures.length;
  const leagues = [
    ...new Set(
      selectedFixtures.map((f) => String(f?.leagueLabel || f?.leagueCode || "")).filter(Boolean)
    ),
  ];
  return {
    count,
    leagues,
    text:
      count === 0
        ? "0 fixtures selected"
        : `${count} fixture${count === 1 ? "" : "s"} selected · ${leagues.join(", ")}`,
    selectionMeta: count === 0 ? "0 selected" : `${count}/10 selected`,
    configMeta: `${count} fixture${count === 1 ? "" : "s"} · ${
      Array.isArray(batchState?.selectedPublishKeys) ? batchState.selectedPublishKeys.length : 0
    } market key${
      Array.isArray(batchState?.selectedPublishKeys) && batchState.selectedPublishKeys.length === 1 ? "" : "s"
    }`,
    selectionCount: `${count} selected`,
  };
}

// Alias to match original helper name
export const getDevBatchSelectionSummary = (appState, deps = {}) =>
  selectSelectionSummary(appState?.devBatch || appState, deps);

// Alias to match original helper name
export const getSelectedDevBatchFixtures = (appState, deps = {}) =>
  selectSelectedFixtures(appState?.devBatch || appState, deps);

export function selectCanConfirm(batchState) {
  return (
    Array.isArray(batchState?.selectedFixtureIds) &&
    batchState.selectedFixtureIds.length > 0
  );
}

// Alias for backwards compat
export const canConfirmDevBatchSelection = (appState, deps = {}) =>
  selectCanConfirm(appState?.devBatch || appState);

export function selectCanPublish(batchState) {
  return (
    Boolean(batchState?.verification) &&
    !Boolean(batchState?.isPublishing) &&
    !Boolean(batchState?.isLoadingFixtures)
  );
}

// Alias
export const canPublishDevBatch = (appState) =>
  selectCanPublish(appState?.devBatch || appState);

export function selectPublishBlockReason(batchState) {
  if (!batchState?.verification) return "Run Verify Batch before publishing.";
  if (batchState?.isPublishing) return "Publish already in progress.";
  if (batchState?.isLoadingFixtures) return "Fixtures are loading.";
  return null;
}

export function selectCanStop(batchState) {
  const runStatus = String(batchState?.currentRun?.status || "").trim().toLowerCase();
  return (
    ["queued", "running"].includes(runStatus) &&
    !Boolean(batchState?.currentRun?.stop_requested)
  );
}

// Alias
export const canStopDevBatch = (appState) =>
  selectCanStop(appState?.devBatch || appState);

export function selectCanRetryFailed(batchState) {
  const lastRunFixtures = Array.isArray(batchState?.lastRun?.fixtures)
    ? batchState.lastRun.fixtures
    : [];
  return lastRunFixtures.some((fixture) =>
    getDevBatchMarketRows(fixture).some(
      (row) => String(row?.status || "").trim().toLowerCase() === "failed"
    )
  );
}

/** Aggregate count data (queued/publishing/completed/failed) */
export function selectMarketCounts(batchState) {
  return getDevBatchAggregateStatusCards(
    batchState?.currentRun || batchState?.verification || null
  );
}

export function getDevBatchRunSummary(batchState) {
  const bs = batchState?.devBatch || batchState;
  const source = bs?.currentRun || bs?.verification || null;
  return {
    source,
    summary: source?.aggregate
      ? `${String(source.summary || "").trim()}${source.detail ? ` \u00b7 ${String(source.detail || "").trim()}` : ""}`
      : "Verify Batch to classify existing vs missing markets before publish.",
    tone: source?.aggregate
      ? source?.tone || getDevBatchRunTone(source?.status)
      : "neutral",
  };
}

// ---------------------------------------------------------------------------
// Fallback identity helper (mirrors ui.js logic, no deps required in tests)
// ---------------------------------------------------------------------------

function defaultGetScheduleFixtureIdentity(fixture) {
  const gameId = String(fixture?.gameId || fixture?.game_id || "").trim();
  if (gameId) return `game:${gameId}`;
  const kickoffIso = String(fixture?.kickoffIso || "").trim();
  const eventName = String(fixture?.eventName || "")
    .toLowerCase()
    .trim()
    .replace(/\s+/g, " ");
  if (kickoffIso && eventName) return `fixture:${kickoffIso}:${eventName}`;
  return eventName ? `event:${eventName}` : "";
}
