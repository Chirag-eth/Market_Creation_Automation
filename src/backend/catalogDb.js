import { formatCatalogTimestamp, normalizeLeagueStartWindows } from "./catalogTimeWindows.js";

export function resolveCatalogSourcePreference(env = {}) {
  const normalized = String(env?.CATALOG_SOURCE || "").trim().toLowerCase();
  if (normalized === "db" || normalized === "database") {
    return "db";
  }
  if (normalized === "csv" || normalized === "files") {
    return "csv";
  }
  return "auto";
}

export function normalizeDbLeagueRows(rows, { now = new Date() } = {}) {
  const normalizedRows = (Array.isArray(rows) ? rows : [])
    .map((row) => mapDbLeagueRow(row))
    .filter(Boolean);
  return normalizeLeagueStartWindows(normalizedRows, { now });
}

export function normalizeDbTeamRows(rows) {
  return (Array.isArray(rows) ? rows : [])
    .map((row) => mapDbTeamRow(row))
    .filter(Boolean);
}

export async function queryCatalogRowsFromDb(pool, { now = new Date() } = {}) {
  if (!pool) {
    throw new Error("Database catalog source is not configured for this environment.");
  }

  const [leagueResult, teamResult] = await Promise.all([
    pool.query(`
      SELECT
        league_id,
        name,
        alternate_name,
        active_logo_url,
        inactive_logo_url,
        theme_color,
        country,
        sport,
        association,
        start,
        "end",
        match_duration_in_minutes,
        status,
        created_at
      FROM leagues
      ORDER BY lower(name), league_id
    `),
    pool.query(`
      SELECT
        team_id,
        league_id,
        name,
        alternate_name,
        team_location,
        logo_url,
        theme_color,
        created_at,
        updated_at
      FROM teams
      ORDER BY lower(name), team_id
    `),
  ]);

  return {
    leagues: normalizeDbLeagueRows(leagueResult.rows, { now }),
    teams: normalizeDbTeamRows(teamResult.rows),
  };
}

function mapDbLeagueRow(row) {
  const leagueId = String(row?.league_id || "").trim();
  const name = String(row?.name || "").trim();
  if (!leagueId || !name) {
    return null;
  }

  return {
    league_id: leagueId,
    name,
    alternate_name: String(row?.alternate_name || "").trim(),
    active_logo_url: String(row?.active_logo_url || "").trim(),
    inactive_logo_url: String(row?.inactive_logo_url || "").trim(),
    theme_color: String(row?.theme_color || "").trim(),
    country: String(row?.country || "").trim(),
    sport: String(row?.sport || "").trim(),
    association: String(row?.association || "").trim(),
    start: normalizeCatalogDbTimestamp(row?.start),
    end: normalizeCatalogDbTimestamp(row?.end),
    match_duration_in_minutes: normalizeInteger(row?.match_duration_in_minutes),
    status: String(row?.status || "").trim(),
    created_at: normalizeIsoTimestamp(row?.created_at),
  };
}

function mapDbTeamRow(row) {
  const teamId = String(row?.team_id || "").trim();
  const name = String(row?.name || "").trim();
  if (!teamId || !name) {
    return null;
  }

  return {
    team_id: teamId,
    league_id: String(row?.league_id || "").trim(),
    name,
    alternate_name: String(row?.alternate_name || "").trim(),
    team_location: String(row?.team_location || "").trim(),
    logo_url: String(row?.logo_url || "").trim(),
    theme_color: String(row?.theme_color || "").trim(),
    created_at: normalizeIsoTimestamp(row?.created_at),
    updated_at: normalizeIsoTimestamp(row?.updated_at),
  };
}

function normalizeCatalogDbTimestamp(value) {
  if (!value) {
    return "";
  }
  const parsed = value instanceof Date ? value : new Date(value);
  if (Number.isNaN(parsed.getTime())) {
    return String(value || "").trim();
  }
  return formatCatalogTimestamp(parsed);
}

function normalizeIsoTimestamp(value) {
  if (!value) {
    return "";
  }
  const parsed = value instanceof Date ? value : new Date(value);
  if (Number.isNaN(parsed.getTime())) {
    return String(value || "").trim();
  }
  return parsed.toISOString();
}

function normalizeInteger(value) {
  const parsed = Number.parseInt(String(value ?? "").trim(), 10);
  return Number.isInteger(parsed) ? parsed : null;
}
