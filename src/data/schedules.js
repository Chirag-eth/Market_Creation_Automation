import { resolveLeagueScheduleCode } from "../shared/leagueRegistry.js";
import { fetchApiJson } from "../shared/apiClient.js";
import {
  normalizeSportsDataRows,
  normalizeSportsDataRow,
  parseSportsDataDateTime,
  selectUpcomingSportsDataWeek,
} from "../shared/sportsdataFixtures.js";

export const SCHEDULE_API_ENDPOINT = "/api/schedules/upcoming";

export function resolveScheduleLeagueCode(league) {
  const candidates = [league?.key, league?.slug, league?.name, league?.alternateName];

  for (const candidate of candidates) {
    const leagueCode = resolveLeagueScheduleCode(candidate);
    if (leagueCode) {
      return leagueCode;
    }
  }

  return null;
}

export async function fetchUpcomingFixturesForLeague(leagueCode, { refresh = true, referenceNowIso = "" } = {}) {
  const code = String(leagueCode || "").trim().toLowerCase();
  if (!code) {
    throw new Error("League code is required to load schedules.");
  }

  const query = new URLSearchParams({ league: code });
  if (refresh) {
    query.set("refresh", "1");
  }
  const referenceNow = String(referenceNowIso || "").trim();
  if (referenceNow) {
    query.set("now", referenceNow);
  }
  return fetchApiJson(`${SCHEDULE_API_ENDPOINT}?${query.toString()}`, {
    cache: "no-store",
    credentials: "same-origin",
    headers: { Accept: "application/json" },
  });
}

export {
  normalizeSportsDataRows,
  normalizeSportsDataRow,
  parseSportsDataDateTime,
  selectUpcomingSportsDataWeek,
};
