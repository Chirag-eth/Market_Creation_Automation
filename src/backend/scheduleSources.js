export const SCHEDULE_SOURCE_AUTO = "auto";
export const SCHEDULE_SOURCE_PRED_APP = "pred-app";
export const SCHEDULE_SOURCE_POLYMARKET = "polymarket";
export const SCHEDULE_SOURCE_SPORTSDATA = "sportsdata";
export const SCHEDULE_SOURCE_LSPORTS_DB = "lsports-db";
export const SCHEDULE_SOURCE_LSPORTS_SQL = "lsports-sql";
export const SCHEDULE_SOURCE_LSPORTS_CSV = "lsports-csv";

export function normalizeScheduleSource(value, { allowAuto = true } = {}) {
  const normalized = String(value || "").trim().toLowerCase();
  if (!normalized) {
    return allowAuto ? SCHEDULE_SOURCE_AUTO : "";
  }

  if (allowAuto && normalized === SCHEDULE_SOURCE_AUTO) {
    return SCHEDULE_SOURCE_AUTO;
  }
  if (normalized === SCHEDULE_SOURCE_PRED_APP || normalized === "pred_app" || normalized === "predapp") {
    return SCHEDULE_SOURCE_PRED_APP;
  }
  if (normalized === SCHEDULE_SOURCE_POLYMARKET || normalized === "poly" || normalized === "polymarket-us") {
    return SCHEDULE_SOURCE_POLYMARKET;
  }
  if (normalized === SCHEDULE_SOURCE_SPORTSDATA || normalized === "sports-data" || normalized === "sports_data") {
    return SCHEDULE_SOURCE_SPORTSDATA;
  }
  if (
    normalized === SCHEDULE_SOURCE_LSPORTS_DB ||
    normalized === "lsports" ||
    normalized === "lsports-db" ||
    normalized === "lsports_db" ||
    normalized === "db"
  ) {
    return SCHEDULE_SOURCE_LSPORTS_DB;
  }
  if (
    normalized === SCHEDULE_SOURCE_LSPORTS_SQL ||
    normalized === "lsports-sql" ||
    normalized === "lsports_sql" ||
    normalized === "sql" ||
    normalized === "sql-file" ||
    normalized === "sql_file"
  ) {
    return SCHEDULE_SOURCE_LSPORTS_SQL;
  }
  if (
    normalized === SCHEDULE_SOURCE_LSPORTS_CSV ||
    normalized === "lsports-csv" ||
    normalized === "lsports_csv" ||
    normalized === "csv-cache" ||
    normalized === "cached-csv"
  ) {
    return SCHEDULE_SOURCE_LSPORTS_CSV;
  }

  return "";
}

export function normalizeMappedScheduleSource(value) {
  return normalizeScheduleSource(value, { allowAuto: false }) || SCHEDULE_SOURCE_AUTO;
}

export function buildScheduleCacheKey({
  environmentCode = "",
  leagueCode = "",
  source = SCHEDULE_SOURCE_AUTO,
  referenceNowIso = "",
} = {}) {
  const envCode = String(environmentCode || "").trim().toLowerCase() || "mainnet";
  const normalizedLeague = String(leagueCode || "").trim().toLowerCase();
  const normalizedSource = normalizeScheduleSource(source) || SCHEDULE_SOURCE_AUTO;
  const normalizedNow = String(referenceNowIso || "").trim();
  return normalizedNow
    ? `${envCode}::${normalizedSource}::${normalizedLeague}::${normalizedNow}`
    : `${envCode}::${normalizedSource}::${normalizedLeague}`;
}

export function buildAutoScheduleSourceCandidates(preferredSource = "", extraSources = []) {
  const normalizedPreferred = normalizeScheduleSource(preferredSource, { allowAuto: false });
  const ordered = [];

  const push = (value) => {
    const normalized = normalizeScheduleSource(value, { allowAuto: false });
    if (normalized && !ordered.includes(normalized)) {
      ordered.push(normalized);
    }
  };

  push(normalizedPreferred);
  push(SCHEDULE_SOURCE_SPORTSDATA);
  for (const source of Array.isArray(extraSources) ? extraSources : [extraSources]) {
    push(source);
  }
  push(SCHEDULE_SOURCE_LSPORTS_DB);
  push(SCHEDULE_SOURCE_POLYMARKET);
  push(SCHEDULE_SOURCE_LSPORTS_CSV);
  return ordered;
}
