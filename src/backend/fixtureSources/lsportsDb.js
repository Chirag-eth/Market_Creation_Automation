import {
  createNormalizedFixtureRecord,
  createNormalizedFixtureWindowPayload,
} from "../normalizedFixtureContract.js";
import {
  SCHEDULE_SOURCE_LSPORTS_DB,
  normalizeMappedScheduleSource,
} from "../scheduleSources.js";

export const LSPORTS_DB_FIXTURE_SOURCE_KEY = SCHEDULE_SOURCE_LSPORTS_DB;
const TERMINAL_STATUSES = new Set(["final", "fulltime", "awarded", "cancelled", "canceled"]);
const MONTHS_SHORT = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
const WEEKDAYS_SHORT = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];

const LSPORTS_DB_ADAPTER = Object.freeze({
  key: LSPORTS_DB_FIXTURE_SOURCE_KEY,
  label: "Lsports DB",
  kind: "database-table",
  status: "active",
  fetchRawRows: fetchLsportsDbRawRows,
  createFixtureWindowPayload: createLsportsDbFixtureWindowPayload,
});

export function getLsportsDbFixtureSourceAdapter() {
  return LSPORTS_DB_ADAPTER;
}

export async function resolveLsportsLeagueMapping(pool, { cmsLeagueId = "" } = {}) {
  if (!pool) {
    throw new Error("Database connection is required for the lsports-db schedule source.");
  }
  const normalizedLeagueId = String(cmsLeagueId || "").trim();
  if (!normalizedLeagueId) {
    return null;
  }

  const result = await pool.query(
    `
      SELECT
        cms_league_id,
        lsports_league_id,
        default_source,
        status
      FROM sports_data_league_mappings
      WHERE cms_league_id = $1
      ORDER BY updated_at DESC NULLS LAST, created_at DESC NULLS LAST, id DESC
      LIMIT 10
    `,
    [normalizedLeagueId]
  );

  for (const row of result.rows || []) {
    const status = String(row?.status || "").trim().toLowerCase();
    if (status && status !== "active") {
      continue;
    }
    const lsportsLeagueId = String(row?.lsports_league_id || "").trim();
    if (!lsportsLeagueId) {
      continue;
    }
    return {
      cmsLeagueId: String(row?.cms_league_id || "").trim(),
      lsportsLeagueId,
      defaultSource: normalizeMappedScheduleSource(row?.default_source),
      status: status || "active",
    };
  }

  return null;
}

export async function fetchLsportsDbRawRows({
  leagueCode = "",
  pool,
  leagueNameLike = "",
  cmsLeagueId = "",
  now = new Date(),
  limit = 400,
} = {}) {
  if (!pool) {
    throw new Error("Database connection is required for the lsports-db schedule source.");
  }

  const referenceNow = now instanceof Date && !Number.isNaN(now.getTime()) ? now : new Date();
  const lookbackIso = new Date(referenceNow.getTime() - 6 * 60 * 60 * 1000).toISOString();
  const maxRows = Number.isInteger(limit) && limit > 0 ? limit : 400;

  // Preferred fallback for configured leagues: match directly on league_name ILIKE.
  // The legacy mapping-table path remains below for flows that still need stable league-id mapping.
  if (leagueNameLike) {
    const result = await pool.query(
      `
        SELECT
          fixture_id::text AS fixture_id,
          league_id::text AS league_id,
          league_name,
          location_name,
          home_team_id::text AS home_team_id,
          home_team_name,
          away_team_id::text AS away_team_id,
          away_team_name,
          start_time,
          status_raw::text AS status_raw,
          status_normalized,
          home_team_score::text AS home_team_score,
          away_team_score::text AS away_team_score,
          source_updated_at,
          created_at,
          updated_at
        FROM lsports_schedule_fixtures
        WHERE league_name ILIKE $1
          AND status_normalized = 'Scheduled'
          AND start_time >= $2::timestamptz
        ORDER BY start_time ASC, fixture_id ASC
        LIMIT $3
      `,
      [leagueNameLike, lookbackIso, maxRows]
    );
    return result.rows;
  }

  // Legacy path: resolve via sports_data_league_mappings
  const mapping = await resolveLsportsLeagueMapping(pool, { cmsLeagueId });
  if (!mapping?.lsportsLeagueId) {
    throw new Error(`No active lsports league mapping is configured for league "${leagueCode}".`);
  }

  const result = await pool.query(
    `
      SELECT
        fixture_id::text AS fixture_id,
        league_id::text AS league_id,
        league_name,
        location_name,
        home_team_id::text AS home_team_id,
        home_team_name,
        away_team_id::text AS away_team_id,
        away_team_name,
        start_time,
        status_raw::text AS status_raw,
        status_normalized,
        home_team_score::text AS home_team_score,
        away_team_score::text AS away_team_score,
        source_updated_at,
        created_at,
        updated_at
      FROM lsports_schedule_fixtures
      WHERE league_id::text = $1
        AND start_time >= $2::timestamptz
      ORDER BY start_time ASC, fixture_id ASC
      LIMIT $3
    `,
    [mapping.lsportsLeagueId, lookbackIso, maxRows]
  );

  return result.rows.map((row) => ({
    ...row,
    cms_league_id: mapping.cmsLeagueId,
    lsports_league_id: mapping.lsportsLeagueId,
    default_source: mapping.defaultSource,
  }));
}

export function normalizeLsportsDbRows(rows) {
  return (Array.isArray(rows) ? rows : [])
    .map((row) => normalizeLsportsDbRow(row))
    .filter(Boolean)
    .sort((a, b) => (a.kickoffMs || 0) - (b.kickoffMs || 0) || a.eventName.localeCompare(b.eventName));
}

export function normalizeLsportsDbRow(row) {
  const fixtureId = String(row?.fixture_id || row?.FixtureId || row?.id || "").trim();
  const homeTeamName = String(row?.home_team_name || row?.HomeTeamName || "").trim();
  const awayTeamName = String(row?.away_team_name || row?.AwayTeamName || "").trim();
  const rawKickoff = row?.start_time || row?.StartTime || row?.fixture_datetime;

  if (!fixtureId || !homeTeamName || !awayTeamName || !rawKickoff) {
    return null;
  }

  const kickoff = rawKickoff instanceof Date ? rawKickoff : new Date(rawKickoff);
  if (Number.isNaN(kickoff.getTime())) {
    return null;
  }

  const kickoffIso = kickoff.toISOString();
  const status = String(row?.status_normalized || row?.Status || row?.status || "").trim() || "Scheduled";
  const isClosed = TERMINAL_STATUSES.has(status.toLowerCase());
  const eventName = `${homeTeamName} vs ${awayTeamName}`;

  return createNormalizedFixtureRecord({
    provider: LSPORTS_DB_FIXTURE_SOURCE_KEY,
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
    optionLabel: buildLsportsOptionLabel(eventName, kickoff),
    sourceMeta: {
      leagueId: String(row?.league_id || "").trim(),
      leagueName: String(row?.league_name || "").trim(),
      locationName: String(row?.location_name || "").trim(),
      cmsLeagueId: String(row?.cms_league_id || "").trim(),
      homeTeamId: String(row?.home_team_id || "").trim(),
      awayTeamId: String(row?.away_team_id || "").trim(),
      defaultSource: String(row?.default_source || "").trim(),
    },
  });
}

export function createLsportsDbFixtureWindowPayload({
  leagueCode = "",
  rawRows,
  now = new Date(),
  fetchedAt = new Date().toISOString(),
} = {}) {
  const referenceNow = now instanceof Date && !Number.isNaN(now.getTime()) ? now : new Date();
  const nowMs = referenceNow.getTime();
  const fixtures = normalizeLsportsDbRows(rawRows).filter(
    (fixture) => Number.isFinite(fixture.kickoffMs) && fixture.kickoffMs >= nowMs && !fixture.isClosed
  );

  return createNormalizedFixtureWindowPayload({
    league: leagueCode,
    source: LSPORTS_DB_FIXTURE_SOURCE_KEY,
    fetchedAt,
    referenceNow,
    selectedWeek: null,
    selectedWeeks: [],
    selectedLabel: fixtures.length > 0 ? "Upcoming fixtures" : null,
    selectionMode: fixtures.length > 0 ? "rolling-upcoming" : "none",
    fixtures,
  });
}

function buildLsportsOptionLabel(eventName, kickoffDate) {
  const weekday = WEEKDAYS_SHORT[kickoffDate.getUTCDay()];
  const month = MONTHS_SHORT[kickoffDate.getUTCMonth()];
  const day = kickoffDate.getUTCDate();
  const hh = String(kickoffDate.getUTCHours()).padStart(2, "0");
  const mm = String(kickoffDate.getUTCMinutes()).padStart(2, "0");
  return `${eventName} · ${weekday}, ${month} ${day} · ${hh}:${mm} UTC · Upcoming fixture`;
}
