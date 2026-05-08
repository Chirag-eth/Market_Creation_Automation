import { createScopedLogger } from "../shared/serverLogger.js";
import { resolveSchedulePayloadWithFallback } from "./scheduleFallback.js";
import { getBackendFixtureSourceAdapter } from "./fixtureSources/index.js";
import {
  getLeagueScheduleDefinition,
  getLeagueScheduleDefinitions,
} from "../shared/leagueRegistry.js";

const schedLog = createScopedLogger("schedule");

// Per-league schedule cache. Records: { payload, version, fetchedAt, fixtureIds:Set }.
const scheduleCache = new Map();

/**
 * Returns the cached upcoming-schedule payload for a league code, fetching and
 * caching from upstream sources if missing or stale.
 *
 * @param {string} leagueCode
 * @param {object} opts
 * @param {boolean} [opts.refresh=false] Force a refetch.
 * @param {Date|null} [opts.now=null]   Override "now" for testing — bypasses cache writes.
 * @param {ScheduleContext} ctx         Server-bound context (env helpers, paths, csv resolver).
 */
export async function getUpcomingSchedulePayload(leagueCode, opts = {}, ctx = {}) {
  const {
    rootDir,
    csvPath,
    resolveNow,
    resolveTimeoutMs,
    resolveSportsDataBaseUrl,
    resolveSportsDataSeason,
    getActiveRuntimeEnvVars,
    getDbPoolForEnv,
    fetchLsportsCsvFixturesForLeague,
  } = ctx;

  const refresh = Boolean(opts.refresh);
  const customNow = opts.now;
  const hasCustomNow = customNow instanceof Date && !Number.isNaN(customNow.getTime());
  const resolvedNow = hasCustomNow ? new Date(customNow.getTime()) : resolveNow();
  const cacheKey = String(leagueCode || "")
    .trim()
    .toLowerCase();

  if (!refresh && !hasCustomNow) {
    const cacheRecord = scheduleCache.get(cacheKey);
    if (cacheRecord) return cacheRecord.payload;
  }

  const payload = await resolveSchedulePayloadWithFallback({
    loadSportsData: async () => {
      const adapter = getBackendFixtureSourceAdapter("sportsdata");
      const rawRows = await adapter.fetchRawRows({
        leagueCode,
        env: getActiveRuntimeEnvVars(),
        rootDir,
        timeoutMs: resolveTimeoutMs(),
        baseUrl: resolveSportsDataBaseUrl(),
        season: resolveSportsDataSeason(),
      });
      return adapter.createFixtureWindowPayload({
        leagueCode,
        rawRows,
        now: resolvedNow,
        fetchedAt: new Date().toISOString(),
      });
    },
    loadLsportsDb: async () => {
      const dbPool = getDbPoolForEnv(getActiveRuntimeEnvVars());
      const leagueDef = getLeagueScheduleDefinition(leagueCode);
      const leagueNameLike = leagueDef?.lsportsLeagueNameLike || "";
      if (!dbPool || !leagueNameLike) return null;
      const adapter = getBackendFixtureSourceAdapter("lsports-db");
      const rawRows = await adapter.fetchRawRows({
        leagueCode,
        pool: dbPool,
        leagueNameLike,
        now: resolvedNow,
      });
      return adapter.createFixtureWindowPayload({
        leagueCode,
        rawRows,
        now: resolvedNow,
        fetchedAt: new Date().toISOString(),
      });
    },
    loadGammaPolymarket: async () => {
      const adapter = getBackendFixtureSourceAdapter("gamma-polymarket");
      if (!adapter) return null;
      const rawRows = await adapter.fetchRawRows({
        leagueCode,
        env: getActiveRuntimeEnvVars(),
        timeoutMs: resolveTimeoutMs(),
        fetchImpl: fetch,
      });
      return adapter.createFixtureWindowPayload({
        leagueCode,
        rawRows,
        now: resolvedNow,
        fetchedAt: new Date().toISOString(),
      });
    },
    loadPolymarket: async () => {
      const adapter = getBackendFixtureSourceAdapter("polymarket");
      if (!adapter) return null;
      const rawRows = await adapter.fetchRawRows({
        leagueCode,
        env: getActiveRuntimeEnvVars(),
        timeoutMs: resolveTimeoutMs(),
        fetchImpl: fetch,
      });
      return adapter.createFixtureWindowPayload({
        leagueCode,
        rawRows,
        now: resolvedNow,
        fetchedAt: new Date().toISOString(),
      });
    },
    loadLsportsCsv: async () => {
      if (!csvPath || typeof fetchLsportsCsvFixturesForLeague !== "function") return null;
      return fetchLsportsCsvFixturesForLeague({
        csvFilePath: csvPath,
        leagueCode,
        now: resolvedNow,
      });
    },
  });

  // Compute version: bump only when genuinely new fixture IDs appear.
  const newIds = new Set((payload?.fixtures || []).map((f) => f.providerFixtureId).filter(Boolean));
  const existing = scheduleCache.get(cacheKey);
  const hasNewFixtures = !existing || [...newIds].some((id) => !existing.fixtureIds?.has(id));
  const version = (existing?.version ?? 0) + (hasNewFixtures ? 1 : 0);

  if (!hasCustomNow) {
    const enriched = payload ? { ...payload, version } : null;
    scheduleCache.set(cacheKey, {
      payload: enriched,
      version,
      fetchedAt: new Date().toISOString(),
      fixtureIds: newIds,
    });
    return enriched;
  }

  return payload;
}

export async function backgroundRefreshAllSchedules(ctx = {}) {
  const codes = [...scheduleCache.keys()];
  if (!codes.length) return;
  schedLog.info({ count: codes.length, leagues: codes }, "background refresh starting");
  await Promise.allSettled(
    codes.map(async (code) => {
      try {
        await getUpcomingSchedulePayload(code, { refresh: true }, ctx);
        const r = scheduleCache.get(code);
        schedLog.debug(
          { code, version: r?.version, fixtureCount: r?.payload?.fixtures?.length ?? 0 },
          "league refreshed"
        );
      } catch (err) {
        schedLog.warn({ code, err }, "background refresh failed for league");
      }
    })
  );
}

/**
 * Snapshot of the cache for /api/schedules/status. Strips internal fixtureIds Set.
 */
export function getScheduleCacheSnapshot() {
  const out = {};
  for (const [code, record] of scheduleCache.entries()) {
    out[code] = {
      version: record.version,
      fetchedAt: record.fetchedAt,
      count: record.payload?.fixtures?.length ?? 0,
    };
  }
  return out;
}

/**
 * Loads payloads for every registered league in parallel.
 * Used by /api/schedules/all.
 */
export async function getAllSchedulesPayload(ctx = {}) {
  const definitions = getLeagueScheduleDefinitions();
  const results = await Promise.allSettled(
    definitions.map((def) => getUpcomingSchedulePayload(def.code, {}, ctx))
  );
  const schedules = {};
  const leagues = [];
  results.forEach((r, i) => {
    const def = definitions[i];
    const payload = r.status === "fulfilled" ? r.value : null;
    schedules[def.code] = payload ?? { fixtures: [], source: "none" };
    leagues.push({ code: def.code, label: def.label, version: payload?.version ?? 0 });
  });
  return { leagues, schedules };
}

/**
 * Returns a list of cached league codes (used during warmup logging in server.js).
 */
export function getCachedLeagueCodes() {
  return [...scheduleCache.keys()];
}

/**
 * Test-only: clears the cache.
 */
export function clearScheduleCache() {
  scheduleCache.clear();
}
