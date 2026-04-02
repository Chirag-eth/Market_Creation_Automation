import { createNormalizedFixtureRecord } from "../normalizedFixtureContract.js";

export const LSPORTS_CSV_FIXTURE_SOURCE_KEY = "lsports_csv";

export const DEFAULT_LSPORTS_CSV_COLUMN_MAP = Object.freeze({
  providerFixtureId: "fixture_id",
  leagueCode: "league_code",
  eventName: "event_name",
  homeTeamName: "home_team_name",
  awayTeamName: "away_team_name",
  fixtureDate: "fixture_date",
  kickoffTimeUtc: "kickoff_time_utc",
  fixtureDateTime: "fixture_datetime",
  matchDay: "match_day",
  matchWeek: "match_week",
  status: "status",
});

const LSPORTS_CSV_ADAPTER = Object.freeze({
  key: LSPORTS_CSV_FIXTURE_SOURCE_KEY,
  label: "Lsports CSV",
  kind: "csv-import",
  status: "planned",
  normalizeRows: normalizeLsportsCsvRows,
});

export function getLsportsCsvFixtureSourceAdapter() {
  return LSPORTS_CSV_ADAPTER;
}

export function createLsportsCsvColumnMap(overrides = {}) {
  return Object.freeze({
    ...DEFAULT_LSPORTS_CSV_COLUMN_MAP,
    ...(overrides && typeof overrides === "object" ? overrides : {}),
  });
}

export function normalizeLsportsCsvRows(rows, { columnMap = DEFAULT_LSPORTS_CSV_COLUMN_MAP } = {}) {
  return (Array.isArray(rows) ? rows : [])
    .map((row) => normalizeLsportsCsvRow(row, { columnMap }))
    .filter(Boolean);
}

export function normalizeLsportsCsvRow(row, { columnMap = DEFAULT_LSPORTS_CSV_COLUMN_MAP } = {}) {
  const map = createLsportsCsvColumnMap(columnMap);
  const eventName = readMappedValue(row, map.eventName);
  const homeTeamName = readMappedValue(row, map.homeTeamName);
  const awayTeamName = readMappedValue(row, map.awayTeamName);

  let fixtureDate = readMappedValue(row, map.fixtureDate);
  let kickoffTimeUtc = readMappedValue(row, map.kickoffTimeUtc);
  let kickoffIso = "";

  const fixtureDateTime = readMappedValue(row, map.fixtureDateTime);
  if ((!fixtureDate || !kickoffTimeUtc) && fixtureDateTime) {
    const parsed = new Date(fixtureDateTime.includes("T") ? fixtureDateTime : `${fixtureDateTime.replace(" ", "T")}Z`);
    if (!Number.isNaN(parsed.getTime())) {
      kickoffIso = parsed.toISOString();
      fixtureDate = fixtureDate || kickoffIso.slice(0, 10);
      kickoffTimeUtc = kickoffTimeUtc || kickoffIso.slice(11, 16);
    }
  }

  if ((!eventName && !(homeTeamName && awayTeamName)) || !fixtureDate || !kickoffTimeUtc) {
    return null;
  }

  const normalizedEventName = eventName || `${homeTeamName} vs ${awayTeamName}`;
  const resolvedHome = homeTeamName || normalizedEventName.split(/\s+vs\s+/i)[0] || "";
  const resolvedAway = awayTeamName || normalizedEventName.split(/\s+vs\s+/i)[1] || "";
  const providerFixtureId = readMappedValue(row, map.providerFixtureId);

  return createNormalizedFixtureRecord({
    provider: LSPORTS_CSV_FIXTURE_SOURCE_KEY,
    providerFixtureId,
    gameId: providerFixtureId,
    eventName: normalizedEventName,
    homeTeamName: resolvedHome,
    awayTeamName: resolvedAway,
    fixtureDate,
    kickoffTimeUtc,
    kickoffIso: kickoffIso || `${fixtureDate}T${kickoffTimeUtc}:00.000Z`,
    matchDay: readMappedValue(row, map.matchDay),
    matchWeek: readMappedValue(row, map.matchWeek),
    status: readMappedValue(row, map.status) || "Scheduled",
    sourceMeta: {
      leagueCode: readMappedValue(row, map.leagueCode),
    },
  });
}

function readMappedValue(row, columnName) {
  return String(row?.[columnName] || "").trim();
}
