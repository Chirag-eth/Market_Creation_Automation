import {
  getDevBatchFixtureCounts,
  getDevBatchMarketRows,
  getDevBatchFixtureDisplayName,
  getDevBatchRunTone,
} from "../selectors.js";

/**
 * Build a view model for a result row in the status rail.
 */
export function buildResultRowViewModel(fixture, expandedSet) {
  const counts = getDevBatchFixtureCounts(fixture);
  const markets = getDevBatchMarketRows(fixture);
  const fixtureKey = String(
    fixture.fixture_key ||
      fixture.event_name ||
      getDevBatchFixtureDisplayName(fixture) ||
      ""
  ).trim();
  const isExpanded = expandedSet instanceof Set ? expandedSet.has(fixtureKey) : false;
  const leagueCode = String(
    fixture?.fixture?.league_code || fixture?.league_code || ""
  ).trim();
  const badgeTone = fixture.row_tone || getDevBatchRunTone(fixture.status);
  const rowDetail = String(
    fixture.row_detail || fixture.reason || fixture.summary || fixture.detail || ""
  ).trim();

  return {
    fixtureKey,
    isExpanded,
    leagueCode,
    badgeTone,
    rowDetail,
    counts,
    markets,
    displayName: getDevBatchFixtureDisplayName(fixture),
    rowLabel: fixture.row_label || fixture.status || "idle",
  };
}
