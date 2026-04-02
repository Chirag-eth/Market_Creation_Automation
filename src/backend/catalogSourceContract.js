export const CATALOG_SOURCE_CONTRACT_VERSION = 1;

export function createCatalogSourceMetadata({
  label = "CSV files",
  sourceKind = "csv-files",
  leaguesFile = "",
  teamsFile = "",
  supplementalLeaguesFiles = [],
  supplementalTeamsFiles = [],
  environment = null,
} = {}) {
  return {
    kind: "csv-files",
    contract_version: CATALOG_SOURCE_CONTRACT_VERSION,
    label: String(label || "").trim() || "CSV files",
    source_kind: String(sourceKind || "").trim() || "csv-files",
    leagues_file: String(leaguesFile || "").trim(),
    teams_file: String(teamsFile || "").trim(),
    supplemental_leagues_files: normalizeStringList(supplementalLeaguesFiles),
    supplemental_teams_files: normalizeStringList(supplementalTeamsFiles),
    environment:
      environment && typeof environment === "object"
        ? {
            app_env: String(environment.appEnv || "").trim(),
            app_env_label: String(environment.appEnvLabel || "").trim(),
            env_file: String(environment.envFile || "").trim(),
          }
        : null,
  };
}

export function createCatalogSourcePayload({
  source,
  leagues = [],
  teams = [],
  loadedAt = new Date().toISOString(),
  cache = null,
  scheduleSupport = null,
} = {}) {
  const normalizedLeagues = Array.isArray(leagues) ? leagues.slice() : [];
  const normalizedTeams = Array.isArray(teams) ? teams.slice() : [];

  return {
    contract_version: CATALOG_SOURCE_CONTRACT_VERSION,
    source: source && typeof source === "object"
      ? source
      : createCatalogSourceMetadata(),
    counts: {
      leagues: normalizedLeagues.length,
      teams: normalizedTeams.length,
    },
    loaded_at: normalizeIsoTimestamp(loadedAt),
    cache: cache && typeof cache === "object" ? cache : null,
    schedule_support:
      scheduleSupport && typeof scheduleSupport === "object"
        ? scheduleSupport
        : null,
    leagues: normalizedLeagues,
    teams: normalizedTeams,
  };
}

export function mergeCatalogRowCollections(rowCollections, idKeys) {
  const merged = new Map();

  for (const rows of Array.isArray(rowCollections) ? rowCollections : []) {
    for (const row of Array.isArray(rows) ? rows : []) {
      const key = resolveCatalogRowKey(row, idKeys);
      if (!key) {
        continue;
      }
      merged.set(key, row);
    }
  }

  return Array.from(merged.values());
}

export function resolveCatalogRowKey(row, idKeys) {
  for (const key of Array.isArray(idKeys) ? idKeys : []) {
    const value = String(row?.[key] || "").trim();
    if (value) {
      return value;
    }
  }
  return "";
}

function normalizeIsoTimestamp(value) {
  const parsed = new Date(value);
  if (!Number.isNaN(parsed.getTime())) {
    return parsed.toISOString();
  }
  return new Date().toISOString();
}

function normalizeStringList(values) {
  return (Array.isArray(values) ? values : [])
    .map((value) => String(value || "").trim())
    .filter(Boolean);
}
