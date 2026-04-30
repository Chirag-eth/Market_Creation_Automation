import { getLeagueScheduleDefinitions, resolveLeagueScheduleCode } from "../shared/leagueRegistry.js";
import { buildPolymarketRuntimeConfig } from "./fixtureSources/polymarket.js";
import { createSportsDataScheduleSupportMetadata } from "./fixtureSources/sportsdata.js";
import { readLsportsSqlLeagueCodes } from "./fixtureSources/lsportsSql.js";
import { readLsportsCsvLeagueCodes } from "./fixtureSources/lsportsCsv.js";
import {
  normalizeMappedScheduleSource,
  SCHEDULE_SOURCE_LSPORTS_CSV,
  SCHEDULE_SOURCE_LSPORTS_DB,
  SCHEDULE_SOURCE_LSPORTS_SQL,
} from "./scheduleSources.js";

export async function createScheduleSupportMetadata({
  env = process.env,
  pool = null,
  leagues = [],
  csvFilePath = "",
} = {}) {
  const base = createSportsDataScheduleSupportMetadata({ env });
  const polymarketReadyCodes = new Set(
    getLeagueScheduleDefinitions()
      .map((definition) => {
        const config = buildPolymarketRuntimeConfig({ leagueCode: definition.code, env });
        return config?.enabled && config?.leagueSlug ? definition.code : "";
      })
      .filter(Boolean)
  );
  const sqlLeagueCodes = readLsportsSqlLeagueCodes({
    sqlFilePath: String(
      env?.LSPORTS_SCHEDULE_SQL_PATH ||
      env?.LSPORTS_SCHEDULE_FIXTURE_SQL_PATH ||
      env?.SPORTSDATA_LSPORTS_SCHEDULE_SQL_PATH ||
      ""
    ).trim(),
  });
  const csvLeagueCodes = readLsportsCsvLeagueCodes({ csvFilePath: String(csvFilePath || "").trim() });
  const sqlLeagueCodeSet = new Set([...sqlLeagueCodes, ...csvLeagueCodes]);

  if (!pool) {
    if (!sqlLeagueCodeSet.size) {
      return mergePolymarketScheduleSupport(base, polymarketReadyCodes);
    }
    return mergePolymarketScheduleSupport(
      mergeSqlScheduleSupport(base, sqlLeagueCodeSet, csvFilePath),
      polymarketReadyCodes
    );
  }

  let activeMappings = [];
  try {
    activeMappings = await queryActiveLeagueSourceMappings(pool);
  } catch {
    const merged = sqlLeagueCodeSet.size ? mergeSqlScheduleSupport(base, sqlLeagueCodeSet) : base;
    return mergePolymarketScheduleSupport(merged, polymarketReadyCodes);
  }
  if (!activeMappings.length) {
    const merged = sqlLeagueCodeSet.size ? mergeSqlScheduleSupport(base, sqlLeagueCodeSet) : base;
    return mergePolymarketScheduleSupport(merged, polymarketReadyCodes);
  }

  const definitions = getLeagueScheduleDefinitions();
  const entriesByCode = new Map(
    definitions.map((definition) => [
      definition.code,
      {
        code: definition.code,
        label: definition.label,
        ready: false,
        config_source: "unconfigured",
      },
    ])
  );

  for (const league of Array.isArray(base?.leagues) ? base.leagues : []) {
    const code = String(league?.code || "").trim().toLowerCase();
    if (!code || !entriesByCode.has(code)) {
      continue;
    }
    entriesByCode.set(code, {
      code,
      label: String(league?.label || entriesByCode.get(code)?.label || code).trim(),
      ready: Boolean(league?.ready),
      config_source: String(league?.config_source || "unconfigured").trim() || "unconfigured",
    });
  }

  const leagueCodeById = buildCatalogLeagueCodeMap(leagues);
  for (const mapping of activeMappings) {
    const code = leagueCodeById.get(String(mapping.cms_league_id || "").trim());
    if (!code || !entriesByCode.has(code)) {
      continue;
    }

    const current = entriesByCode.get(code);
    const defaultSource = normalizeMappedScheduleSource(mapping.default_source);
    const prefersLsports = defaultSource === SCHEDULE_SOURCE_LSPORTS_DB;
    entriesByCode.set(code, {
      ...current,
      ready: true,
      config_source:
        current.ready && !prefersLsports
          ? current.config_source
          : prefersLsports
            ? "lsports-db-default"
            : "lsports-db-mapping",
    });
  }

  const csvCodeSet = new Set(csvLeagueCodes);
  for (const code of sqlLeagueCodeSet) {
    if (!code || !entriesByCode.has(code)) {
      continue;
    }
    const current = entriesByCode.get(code);
    const fallbackSource = csvCodeSet.has(code) ? SCHEDULE_SOURCE_LSPORTS_CSV : SCHEDULE_SOURCE_LSPORTS_SQL;
    entriesByCode.set(code, {
      ...current,
      ready: true,
      config_source:
        current.ready && current.config_source && current.config_source !== "unconfigured"
          ? current.config_source
          : fallbackSource,
    });
  }

  const leaguesMeta = definitions.map((definition) => entriesByCode.get(definition.code) || {
    code: definition.code,
    label: definition.label,
    ready: false,
    config_source: "unconfigured",
  });

  return mergePolymarketScheduleSupport({
    provider: "auto",
    ready_leagues: leaguesMeta.filter((league) => league.ready).map((league) => league.code),
    leagues: leaguesMeta,
  }, polymarketReadyCodes);
}

function mergeSqlScheduleSupport(base, sqlLeagueCodeSet, csvFilePath = "") {
  const csvLeagueCodes = readLsportsCsvLeagueCodes({ csvFilePath: String(csvFilePath || "").trim() });
  const csvCodeSet = new Set(csvLeagueCodes);

  const definitions = getLeagueScheduleDefinitions();
  const entriesByCode = new Map(
    definitions.map((definition) => [
      definition.code,
      {
        code: definition.code,
        label: definition.label,
        ready: false,
        config_source: "unconfigured",
      },
    ])
  );

  for (const league of Array.isArray(base?.leagues) ? base.leagues : []) {
    const code = String(league?.code || "").trim().toLowerCase();
    if (!code || !entriesByCode.has(code)) continue;
    entriesByCode.set(code, {
      code,
      label: String(league?.label || entriesByCode.get(code)?.label || code).trim(),
      ready: Boolean(league?.ready),
      config_source: String(league?.config_source || "unconfigured").trim() || "unconfigured",
    });
  }

  for (const code of sqlLeagueCodeSet) {
    if (!entriesByCode.has(code)) continue;
    const current = entriesByCode.get(code);
    const fallbackSource = csvCodeSet.has(code) ? SCHEDULE_SOURCE_LSPORTS_CSV : SCHEDULE_SOURCE_LSPORTS_SQL;
    entriesByCode.set(code, {
      ...current,
      ready: true,
      config_source:
        current.ready && current.config_source && current.config_source !== "unconfigured"
          ? current.config_source
          : fallbackSource,
    });
  }

  const leaguesMeta = definitions.map((definition) => entriesByCode.get(definition.code) || {
    code: definition.code,
    label: definition.label,
    ready: false,
    config_source: "unconfigured",
  });

  return {
    provider: "auto",
    ready_leagues: leaguesMeta.filter((league) => league.ready).map((league) => league.code),
    leagues: leaguesMeta,
  };
}

function mergePolymarketScheduleSupport(base, polymarketReadyCodes) {
  const readyCodes = new Set(Array.isArray(base?.ready_leagues) ? base.ready_leagues : []);
  const leagues = Array.isArray(base?.leagues) ? base.leagues : [];
  const nextLeagues = leagues.map((league) => {
    const code = String(league?.code || "").trim().toLowerCase();
    if (!code || !polymarketReadyCodes.has(code) || Boolean(league?.ready)) {
      return league;
    }
    readyCodes.add(code);
    return {
      ...league,
      ready: true,
      config_source: "polymarket",
    };
  });
  return {
    ...base,
    ready_leagues: Array.from(readyCodes),
    leagues: nextLeagues,
  };
}

async function queryActiveLeagueSourceMappings(pool) {
  const result = await pool.query(`
    SELECT
      cms_league_id,
      lsports_league_id,
      default_source,
      status
    FROM sports_data_league_mappings
    ORDER BY updated_at DESC NULLS LAST, created_at DESC NULLS LAST, id DESC
  `);

  const latestByLeagueId = new Map();
  for (const row of result.rows || []) {
    const cmsLeagueId = String(row?.cms_league_id || "").trim();
    const status = String(row?.status || "").trim().toLowerCase();
    const lsportsLeagueId = String(row?.lsports_league_id || "").trim();
    if (!cmsLeagueId || latestByLeagueId.has(cmsLeagueId)) {
      continue;
    }
    if (status && status !== "active") {
      continue;
    }
    if (!lsportsLeagueId) {
      continue;
    }
    latestByLeagueId.set(cmsLeagueId, {
      cms_league_id: cmsLeagueId,
      lsports_league_id: lsportsLeagueId,
      default_source: String(row?.default_source || "").trim(),
    });
  }

  return Array.from(latestByLeagueId.values());
}

function buildCatalogLeagueCodeMap(leagues) {
  const map = new Map();
  for (const league of Array.isArray(leagues) ? leagues : []) {
    const leagueId = String(league?.league_id || league?.id || "").trim();
    if (!leagueId || map.has(leagueId)) {
      continue;
    }

    const candidates = [
      league?.league_id,
      league?.name,
      league?.alternate_name,
      league?.alternateName,
      league?.association,
    ];
    const code = candidates
      .map((candidate) => resolveLeagueScheduleCode(candidate))
      .find(Boolean);
    if (code) {
      map.set(leagueId, code);
    }
  }
  return map;
}
