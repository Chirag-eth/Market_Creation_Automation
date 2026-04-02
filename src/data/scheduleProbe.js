import {
  buildSportsDataScheduleUrl,
  normalizeSportsDataRows,
  parseCompetitionId,
  selectUpcomingSportsDataWeek,
} from "../shared/sportsdataFixtures.js";
import { getLeagueScheduleDefinitions } from "../shared/leagueRegistry.js";

export const SPORTS_DATA_SCHEDULE_LEAGUES = Object.freeze([
  { code: "epl", label: "EPL", competitionId: 1 },
  { code: "laliga", label: "La Liga", competitionId: 4 },
  { code: "ucl", label: "UCL", competitionId: 3 },
]);

export function resolveSportsDataScheduleProbeLeagues(env = process.env) {
  return getLeagueScheduleDefinitions()
    .map((definition) => {
      const configuredCompetitionId = parseCompetitionId(
        env?.[definition.competitionIdEnvName],
        definition.defaultCompetitionId
      );
      if (!configuredCompetitionId) {
        return null;
      }
      return {
        code: definition.code,
        label: definition.label,
        competitionId: configuredCompetitionId,
      };
    })
    .filter(Boolean);
}

export function buildSportsDataScheduleProbeUrl({
  baseUrl,
  competitionId,
  season,
  apiKey,
} = {}) {
  return buildSportsDataScheduleUrl({ baseUrl, competitionId, season, apiKey });
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
