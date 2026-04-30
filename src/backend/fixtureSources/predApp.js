import {
  createNormalizedFixtureRecord,
  createNormalizedFixtureWindowPayload,
} from "../normalizedFixtureContract.js";
import { SCHEDULE_SOURCE_PRED_APP } from "../scheduleSources.js";

export const PRED_APP_FIXTURE_SOURCE_KEY = SCHEDULE_SOURCE_PRED_APP;

const TERMINAL_STATUSES = new Set(["final", "fulltime", "awarded", "cancelled", "canceled"]);
const MONTHS_SHORT = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
const WEEKDAYS_SHORT = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];

const PRED_APP_ADAPTER = Object.freeze({
  key: PRED_APP_FIXTURE_SOURCE_KEY,
  label: "Pred App API",
  kind: "live-api",
  status: "legacy",
  fetchRawRows: fetchPredAppRawRows,
  createFixtureWindowPayload: createPredAppFixtureWindowPayload,
});

export function getPredAppFixtureSourceAdapter() {
  return PRED_APP_ADAPTER;
}

export async function fetchPredAppRawRows({
  leagueId = "",
  baseUrl = "",
  bearerToken = "",
  timeoutMs = 8000,
  fetchImpl = globalThis.fetch,
} = {}) {
  const normalizedBase = String(baseUrl || "").trim().replace(/\/+$/, "");
  const normalizedLeagueId = String(leagueId || "").trim();
  if (!normalizedBase) {
    throw new Error("A base URL is required for the pred-app schedule source (set COMP_SERVICE_INTERNAL_HOST).");
  }
  if (!normalizedLeagueId) {
    throw new Error("A league_id is required for the pred-app schedule source.");
  }

  const url = `${normalizedBase}/api/v1/sports-data/matches?league_id=${encodeURIComponent(normalizedLeagueId)}&all_upcoming=true`;
  const headers = { Accept: "application/json" };
  if (bearerToken) {
    headers["Authorization"] = `Bearer ${bearerToken}`;
  }

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  let response;
  try {
    response = await fetchImpl(url, { headers, signal: controller.signal });
  } finally {
    clearTimeout(timer);
  }

  if (!response.ok) {
    throw new Error(`Pred App schedule request failed: HTTP ${response.status} for league_id=${normalizedLeagueId}`);
  }

  const json = await response.json();
  // Accept either a bare array or { data: [...] } / { matches: [...] } envelope.
  const rows = Array.isArray(json)
    ? json
    : Array.isArray(json?.data)
    ? json.data
    : Array.isArray(json?.matches)
    ? json.matches
    : [];
  return rows;
}

export function normalizePredAppRow(row) {
  if (!row || typeof row !== "object") return null;

  const fixtureId = String(row.id || row.fixture_id || row.match_id || "").trim();
  const homeTeamName = String(
    row.home_team_name || row.home_team?.name || row.homeTeamName || ""
  ).trim();
  const awayTeamName = String(
    row.away_team_name || row.away_team?.name || row.awayTeamName || ""
  ).trim();
  const rawKickoff = row.start_time || row.kickoff_time || row.match_date || row.scheduled_at;

  if (!fixtureId || !homeTeamName || !awayTeamName || !rawKickoff) {
    return null;
  }

  const kickoff = rawKickoff instanceof Date ? rawKickoff : new Date(rawKickoff);
  if (Number.isNaN(kickoff.getTime())) return null;

  const kickoffIso = kickoff.toISOString();
  const status = String(
    row.status_normalized || row.status || "Scheduled"
  ).trim();
  const isClosed = TERMINAL_STATUSES.has(status.toLowerCase());
  const eventName = `${homeTeamName} vs ${awayTeamName}`;

  const homeTeamId = String(
    row.home_team_id || row.home_team?.id || row.homeTeamId || ""
  ).trim();
  const awayTeamId = String(
    row.away_team_id || row.away_team?.id || row.awayTeamId || ""
  ).trim();

  return createNormalizedFixtureRecord({
    provider: PRED_APP_FIXTURE_SOURCE_KEY,
    providerFixtureId: fixtureId,
    gameId: fixtureId,
    eventName,
    homeTeamName,
    awayTeamName,
    fixtureDate: kickoffIso.slice(0, 10),
    kickoffTimeUtc: kickoffIso.slice(11, 16),
    kickoffIso,
    status,
    isClosed,
    optionLabel: buildPredAppOptionLabel(eventName, kickoff),
    sourceMeta: {
      leagueId: String(row.league_id || "").trim(),
      homeTeamId,
      awayTeamId,
    },
  });
}

export function normalizePredAppRows(rows) {
  return (Array.isArray(rows) ? rows : [])
    .map((row) => normalizePredAppRow(row))
    .filter(Boolean)
    .sort((a, b) => (a.kickoffMs || 0) - (b.kickoffMs || 0) || a.eventName.localeCompare(b.eventName));
}

export function createPredAppFixtureWindowPayload({
  leagueCode = "",
  rawRows = [],
  now = new Date(),
  fetchedAt = new Date().toISOString(),
} = {}) {
  const referenceNow = now instanceof Date && !Number.isNaN(now.getTime()) ? now : new Date();
  const nowMs = referenceNow.getTime();
  const fixtures = normalizePredAppRows(rawRows).filter(
    (fixture) => Number.isFinite(fixture.kickoffMs) && fixture.kickoffMs >= nowMs && !fixture.isClosed
  );

  return createNormalizedFixtureWindowPayload({
    league: leagueCode,
    source: PRED_APP_FIXTURE_SOURCE_KEY,
    fetchedAt,
    referenceNow,
    selectedWeek: null,
    selectedWeeks: [],
    selectedLabel: fixtures.length > 0 ? "Upcoming fixtures" : null,
    selectionMode: fixtures.length > 0 ? "rolling-upcoming" : "none",
    fixtures,
  });
}

function buildPredAppOptionLabel(eventName, kickoffDate) {
  const weekday = WEEKDAYS_SHORT[kickoffDate.getUTCDay()];
  const month = MONTHS_SHORT[kickoffDate.getUTCMonth()];
  const day = kickoffDate.getUTCDate();
  const hh = String(kickoffDate.getUTCHours()).padStart(2, "0");
  const mm = String(kickoffDate.getUTCMinutes()).padStart(2, "0");
  return `${eventName} · ${weekday}, ${month} ${day} · ${hh}:${mm} UTC · Upcoming fixture`;
}
