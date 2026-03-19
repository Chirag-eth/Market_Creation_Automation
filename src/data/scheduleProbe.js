import { normalizeSportsDataRows, selectUpcomingSportsDataWeek } from "./schedules.js";

export const SPORTS_DATA_SCHEDULE_LEAGUES = Object.freeze([
  { code: "epl", label: "EPL", competitionId: 1 },
  { code: "laliga", label: "La Liga", competitionId: 4 },
  { code: "ucl", label: "UCL", competitionId: 3 },
]);

export function buildSportsDataScheduleProbeUrl({
  baseUrl,
  competitionId,
  season,
  apiKey,
} = {}) {
  const normalizedBaseUrl = String(baseUrl || "").trim().replace(/\/+$/, "");
  const normalizedApiKey = String(apiKey || "").trim();
  const normalizedSeason = Number.parseInt(String(season || "").trim(), 10);
  const normalizedCompetitionId = Number.parseInt(String(competitionId || "").trim(), 10);

  if (!normalizedBaseUrl) {
    throw new Error("SPORTSDATA_SCHEDULE_BASE_URL is required.");
  }
  if (!normalizedApiKey) {
    throw new Error("SPORTSDATA_API_KEY is required.");
  }
  if (!Number.isFinite(normalizedSeason) || normalizedSeason < 2000) {
    throw new Error("SPORTSDATA_SCHEDULE_SEASON must be a valid year.");
  }
  if (!Number.isFinite(normalizedCompetitionId) || normalizedCompetitionId <= 0) {
    throw new Error("competitionId must be a positive integer.");
  }

  const url = new URL(`${normalizedBaseUrl}/${normalizedCompetitionId}/${normalizedSeason}`);
  url.searchParams.set("key", normalizedApiKey);
  return url.toString();
}

export function summarizeSportsDataScheduleProbe(rows, {
  leagueCode = "",
  leagueLabel = "",
  url = "",
  status = 0,
  durationMs = 0,
  referenceNow = new Date(),
} = {}) {
  const referenceNowDate =
    referenceNow instanceof Date && !Number.isNaN(referenceNow.getTime())
      ? new Date(referenceNow.getTime())
      : new Date();
  const rawRows = Array.isArray(rows) ? rows : [];
  const normalizedRows = normalizeSportsDataRows(rawRows);
  const selection = selectUpcomingSportsDataWeek(rawRows, { now: referenceNowDate });

  return {
    league: String(leagueCode || "").trim().toLowerCase(),
    league_label: String(leagueLabel || "").trim(),
    url: String(url || "").trim(),
    status: Number.isFinite(status) ? status : 0,
    duration_ms: Number.isFinite(durationMs) ? Math.max(0, Math.round(durationMs)) : 0,
    reference_now: referenceNowDate.toISOString(),
    raw_row_count: rawRows.length,
    normalized_fixture_count: normalizedRows.length,
    selected_week: selection.selectedWeek,
    selected_weeks: Array.isArray(selection.selectedWeeks) ? selection.selectedWeeks : [],
    selected_label: selection.selectedLabel,
    selection_mode: selection.selectionMode,
    selected_fixture_count: Array.isArray(selection.fixtures) ? selection.fixtures.length : 0,
    preview_fixtures: Array.isArray(selection.fixtures)
      ? selection.fixtures.slice(0, 5).map((fixture) => ({
          eventName: String(fixture?.eventName || "").trim(),
          gameId: String(fixture?.gameId || fixture?.game_id || "").trim(),
          fixtureDate: String(fixture?.fixtureDate || "").trim(),
          kickoffTimeUtc: String(fixture?.kickoffTimeUtc || "").trim(),
          matchDay: Number.isInteger(fixture?.matchDay) ? fixture.matchDay : null,
        }))
      : [],
  };
}
