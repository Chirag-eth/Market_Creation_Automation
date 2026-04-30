import { getDevBatchFixtureCounts, getDevBatchRunTone } from "../selectors.js";

/**
 * Build a view model for a fixture row (explorer or selected list).
 */
export function buildFixtureRowViewModel(fixture, { fixtureId, isSelected, verification, runFixture, deps = {} } = {}) {
  const getLeagueLabel = deps.getScheduleLeagueLabel || ((code) => String(code || "").toUpperCase());
  const counts = getDevBatchFixtureCounts(verification);
  const verTone = verification?.row_tone || getDevBatchRunTone(verification?.status);
  const verLabel = verification?.row_label || verification?.status || "unverified";
  const runStatus = String(runFixture?.status || "").trim().toLowerCase();

  return {
    fixtureId,
    isSelected,
    eventName: String(fixture?.eventName || "").trim(),
    leagueLabel: String(fixture?.leagueLabel || getLeagueLabel(fixture?.leagueCode || "")),
    fixtureDate: String(fixture?.fixtureDate || "").trim(),
    kickoffTimeUtc: String(fixture?.kickoffTimeUtc || "").trim(),
    gameId: String(fixture?.gameId || "").trim(),
    counts,
    verTone,
    verLabel,
    runStatus,
    isPublishing: runStatus === "publishing",
    isCompleted: ["completed", "partial"].includes(runStatus),
    isFailed: ["failed", "failed_precheck"].includes(runStatus),
  };
}
