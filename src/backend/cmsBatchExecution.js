import { createScopedLogger } from "../shared/serverLogger.js";
import { resolveBatchLeague, resolveBatchTeam } from "../server/services/batchResolutionService.js";
import { normalizeLeagueRows, normalizeTeamRows, buildTeamAliasIndex } from "../data/catalog.js";
import { queryCatalogRowsFromDb } from "./catalogDb.js";
import { createCmsRuntimeConfig } from "./cmsPublisher.js";
import {
  buildUatParentPayloads,
  buildUatFixtureAlternateName,
  buildUatCanonicalFixtureName,
} from "../core/uatFormats.js";
import {
  classifyParentStatusFromRows,
  getExpectedMarketCountForPublishKey,
} from "./cmsSelectedPublish.js";

const batchLog = createScopedLogger("batch");
const cmsLog = createScopedLogger("cms");

// ── Public-from-server-perspective utilities ──────────────────────────────────

export async function postCmsJson(cmsConfig, url, payload) {
  const headers = {
    "Content-Type": "application/json",
    Accept: "application/json",
  };
  if (cmsConfig.bearerToken) {
    headers.Authorization = `Bearer ${cmsConfig.bearerToken}`;
  }
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), cmsConfig.timeoutMs || 8000);
  try {
    const response = await fetch(url, {
      method: "POST",
      headers,
      body: JSON.stringify(payload),
      signal: controller.signal,
    });
    const text = await response.text();
    let body;
    try {
      body = JSON.parse(text);
    } catch {
      body = text;
    }
    if (!response.ok) {
      const respHeaders = {};
      for (const [k, v] of response.headers.entries()) respHeaders[k] = v;
      cmsLog.error({ status: response.status, url, respHeaders, body }, "cms post failed");
      throw new Error(
        `HTTP ${response.status} from ${url}: ${typeof body === "string" ? body : JSON.stringify(body)}`
      );
    }
    return body;
  } finally {
    clearTimeout(timeout);
  }
}

export function pickUuidLikeValue(...values) {
  for (const value of values) {
    const normalized = String(value || "").trim();
    if (isUuidLike(normalized)) {
      return normalized;
    }
  }
  return null;
}

function isUuidLike(value) {
  return /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(
    String(value || "").trim()
  );
}

export function deriveBatchFixtureStatusFromMarkets(marketResults = []) {
  const statuses = (Array.isArray(marketResults) ? marketResults : [])
    .map((entry) =>
      String(entry?.status || "")
        .trim()
        .toLowerCase()
    )
    .filter(Boolean);

  if (statuses.some((status) => ["failed", "half_prepared", "blocked"].includes(status))) {
    return "partial";
  }
  if (
    statuses.length > 0 &&
    statuses.every((status) => ["exists", "existing", "skipped"].includes(status))
  ) {
    return "existing";
  }
  return "completed";
}

export function deriveBatchRunStatusFromFixtures(fixtures = [], { anyFailed = false } = {}) {
  const statuses = (Array.isArray(fixtures) ? fixtures : [])
    .map((fixture) =>
      String(fixture?.status || "")
        .trim()
        .toLowerCase()
    )
    .filter(Boolean);

  if (statuses.some((status) => status === "partial")) {
    return "partial";
  }
  if (anyFailed) {
    return statuses.some((status) => ["completed", "existing"].includes(status))
      ? "partial"
      : "failed";
  }
  return "completed";
}

export function classifyExistingBatchParentMarketRows(
  rows = [],
  { publishKey = "", homeTeamId = "", awayTeamId = "" } = {}
) {
  return classifyParentStatusFromRows(rows, {
    selectedFixture: {
      home_team_id: String(homeTeamId || "").trim(),
      away_team_id: String(awayTeamId || "").trim(),
    },
    fixtureRecord: {
      home_team_id: String(homeTeamId || "").trim(),
      away_team_id: String(awayTeamId || "").trim(),
    },
    expectedMarketCount: getExpectedMarketCountForPublishKey(publishKey),
  });
}

// ── New combined fixtures/create endpoint helpers ─────────────────────────────

// Maps a fixture's schedule-provider key to the `source` value the new
// combined CMS endpoint accepts. Returns null when the provider isn't eligible
// for fixtures/create (caller falls through to the legacy 3-step flow).
export function mapProviderToCmsSource(provider) {
  const p = String(provider || "")
    .trim()
    .toLowerCase();
  if (p === "sportsdata") return "sports_data";
  if (p === "lsports-db" || p === "lsports-csv" || p === "lsports-sql") return "lsports";
  return null;
}

export function slugifyForCname(value) {
  return String(value || "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
}

// cname format: "{leagueCode}-{home alt-name slug}-{away alt-name slug}-{YYYY-MM-DD}".
// Prefers each team's catalog alternate_name; falls back to name, then to the
// raw home/away string from the fixture if no team object was resolved.
export function buildFixtureCreateCname(fixture, homeTeam, awayTeam) {
  const date = String(fixture?.kickoff || fixture?.kickoffIso || "").slice(0, 10);
  const home = slugifyForCname(
    homeTeam?.alternateName || homeTeam?.name || fixture?.home || fixture?.homeTeamName || ""
  );
  const away = slugifyForCname(
    awayTeam?.alternateName || awayTeam?.name || fixture?.away || fixture?.awayTeamName || ""
  );
  const league = String(fixture?.leagueCode || "")
    .trim()
    .toLowerCase();
  return [league, home, away, date].filter(Boolean).join("-");
}

// Translates an internal pipe-delimited publish key (e.g. "spreads|1.5|home")
// into the parent_markets[] string that fixtures/create expects.
export function publishKeyToParentMarketKey(publishKey, homeName, awayName) {
  const parts = String(publishKey || "").split("|");
  const family = parts[0] || "";
  const line = parts[1] || "";
  const side = parts[2] || "";
  if (family === "moneyline") return "moneyline";
  if (family === "btts") return "btts";
  if (family === "totals") return line ? `totals_${line}` : null;
  if (family === "spreads") {
    if (!line || !side) return null;
    const team = side === "away" ? awayName : homeName;
    const slug = String(team || "")
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, "-")
      .replace(/^-+|-+$/g, "");
    return slug ? `spreads_${line}_${side}_${slug}` : `spreads_${line}_${side}`;
  }
  return null;
}

export async function postCmsFixtureCreate(cmsConfig, body, log) {
  const url = `${cmsConfig.baseUrl}/api/v1/cms/internal/fixtures/create`;
  const headers = { "Content-Type": "application/json" };
  if (cmsConfig.bearerToken) headers.Authorization = `Bearer ${cmsConfig.bearerToken}`;
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), cmsConfig.timeoutMs);
  let response;
  try {
    response = await fetch(url, {
      method: "POST",
      headers,
      body: JSON.stringify(body),
      signal: controller.signal,
    });
  } finally {
    clearTimeout(timer);
  }
  const text = await response.text();
  let respBody;
  try {
    respBody = text ? JSON.parse(text) : null;
  } catch {
    respBody = text;
  }
  if (!response.ok) {
    log.error({ status: response.status, url, body: respBody }, "fixtures/create failed");
    throw new Error(
      `HTTP ${response.status} from fixtures/create: ${typeof respBody === "string" ? respBody : JSON.stringify(respBody)}`
    );
  }
  return respBody;
}

// ── Legacy 3-step fixture/type-ref/parent-market private helpers ─────────────

async function resolveTeamByLeagueFromDb(pool, teamName, leagueId) {
  try {
    const rows = await pool.query(
      `SELECT team_id, name, alternate_name, league_id FROM teams
       WHERE league_id = $1 AND (name ILIKE $2 OR alternate_name ILIKE $2)
       ORDER BY name LIMIT 1`,
      [leagueId, teamName]
    );
    if (!rows.rows.length) return null;
    const r = rows.rows[0];
    return {
      id: String(r.team_id || "").trim(),
      name: String(r.name || "").trim(),
      alternateName: String(r.alternate_name || r.name || "").trim(),
      leagueId: String(r.league_id || "").trim(),
    };
  } catch {
    return null;
  }
}

// ── Main batch run orchestrator ──────────────────────────────────────────────

export async function executeCmsBatchRun(runId, fixtures, publishKeys, activeProfile, deps = {}) {
  const { runStore, getDbPoolForEnv, getCatalogPayloadCached } = deps;
  if (!runStore || !getDbPoolForEnv || !getCatalogPayloadCached) {
    throw new Error(
      "executeCmsBatchRun: deps must include runStore, getDbPoolForEnv, getCatalogPayloadCached"
    );
  }

  const log = batchLog.child({ runId });
  const record = runStore.get(runId);
  if (!record) {
    log.error("no record found in store, aborting");
    return;
  }

  record.status = "running";
  log.info("status: running");

  const cmsConfig = createCmsRuntimeConfig(activeProfile.env);
  log.info(
    { cmsEnabled: cmsConfig.enabled, baseUrl: cmsConfig.baseUrl || null },
    "cms config resolved"
  );

  if (!cmsConfig.enabled) {
    const detail = `CMS publishing is not configured for ${activeProfile.label}. Set COMP_SERVICE_INTERNAL_HOST.`;
    log.error({ detail }, "batch run failed: cms not configured");
    record.status = "failed";
    record.detail = detail;
    record.completed_at = new Date().toISOString();
    return;
  }

  // Load leagues + teams from DB (authoritative CMS IDs); fall back to CSV if DB not configured
  let batchLeagues, batchTeams;
  const dbPool = getDbPoolForEnv(activeProfile.env);
  let catalogSource = "csv";
  if (dbPool) {
    log.info("loading catalog from DB");
    try {
      const dbCatalog = await queryCatalogRowsFromDb(dbPool);
      batchLeagues = normalizeLeagueRows(dbCatalog.leagues || []);
      batchTeams = normalizeTeamRows(dbCatalog.teams || [], batchLeagues);
      catalogSource = "db";
    } catch (err) {
      log.warn({ err }, "DB catalog query failed, falling back to CSV");
    }
  }
  if (!batchLeagues) {
    log.info("loading catalog from CSV");
    try {
      const catalogPayload = await getCatalogPayloadCached();
      batchLeagues = normalizeLeagueRows(catalogPayload.leagues || []);
      batchTeams = normalizeTeamRows(catalogPayload.teams || [], batchLeagues);
    } catch (err) {
      const detail = `Catalog load failed: ${err.message}`;
      log.error({ err, detail }, "batch run failed: catalog load");
      record.status = "failed";
      record.detail = detail;
      record.completed_at = new Date().toISOString();
      return;
    }
  }

  const teamAliasIdx = buildTeamAliasIndex(batchTeams);
  log.info(
    { leagueCount: batchLeagues.length, teamCount: batchTeams.length, source: catalogSource },
    "catalog loaded"
  );

  const fixtureResults = [];
  let anyFailed = false;

  for (const fixture of fixtures) {
    const homeName = fixture.home || fixture.homeTeamName || "";
    const awayName = fixture.away || fixture.awayTeamName || "";
    const eventName = [homeName, awayName].filter(Boolean).join(" vs ");

    log.info(
      {
        eventName,
        fixtureId: fixture.id,
        leagueCode: fixture.leagueCode,
        kickoff: fixture.kickoff,
      },
      "processing fixture"
    );

    // ── New combined fixtures/create endpoint for sportsdata / lsports ──
    const newSource = mapProviderToCmsSource(fixture.provider || fixture.source);
    if (newSource) {
      const gameId = String(
        fixture.gameId || fixture.game_id || fixture.providerFixtureId || fixture.id || ""
      ).trim();
      // Look up teams in the catalog so the cname can use each team's
      // alternate_name. Resolution failures are non-fatal — cname falls
      // back to fixture.home / fixture.away as raw text.
      const cnameLeague = resolveBatchLeague(batchLeagues, fixture.leagueCode);
      const cnameHomeTeam = cnameLeague
        ? resolveBatchTeam(teamAliasIdx, homeName, cnameLeague.id)
        : null;
      const cnameAwayTeam = cnameLeague
        ? resolveBatchTeam(teamAliasIdx, awayName, cnameLeague.id)
        : null;
      const parentMarkets = [
        ...new Set(
          publishKeys.map((k) => publishKeyToParentMarketKey(k, homeName, awayName)).filter(Boolean)
        ),
      ];
      const cname = buildFixtureCreateCname(fixture, cnameHomeTeam, cnameAwayTeam);

      if (!gameId) {
        anyFailed = true;
        log.error({ eventName }, "fixtures/create skipped: no game_id on fixture");
        fixtureResults.push({
          fixture_key: fixture.id || eventName,
          event_name: eventName,
          status: "failed",
          reason: "Fixture has no game_id; cannot use fixtures/create.",
          markets: publishKeys.map((k) => ({ publish_key: k, status: "failed" })),
        });
        continue;
      }

      log.info(
        { eventName, gameId, source: newSource, cname, parentMarkets },
        "publishing via fixtures/create"
      );

      try {
        const resp = await postCmsFixtureCreate(
          cmsConfig,
          {
            game_id: gameId,
            source: newSource,
            parent_markets: parentMarkets,
            cname,
            appendix: "",
          },
          log
        );
        fixtureResults.push({
          fixture_key: fixture.id || eventName,
          event_name: eventName,
          status: "completed",
          markets: publishKeys.map((k) => ({ publish_key: k, status: "published" })),
          payloads: {
            fixture_create: {
              game_id: gameId,
              source: newSource,
              parent_markets: parentMarkets,
              cname,
              appendix: "",
            },
          },
          response: resp ?? null,
        });
      } catch (err) {
        anyFailed = true;
        log.error({ err, eventName, gameId }, "fixture failed via fixtures/create");
        fixtureResults.push({
          fixture_key: fixture.id || eventName,
          event_name: eventName,
          status: "failed",
          reason: String(err?.message || err),
          markets: publishKeys.map((k) => ({ publish_key: k, status: "failed" })),
        });
      }
      continue;
    }

    // ── Legacy fixture → type-reference → parent-market flow (other providers) ──
    try {
      // ── 1. Resolve league ──────────────────────────────────────────────────
      const league = resolveBatchLeague(batchLeagues, fixture.leagueCode);
      if (!league) throw new Error(`League not found in catalog for code "${fixture.leagueCode}"`);
      log.debug({ leagueName: league.name, leagueId: league.id }, "league resolved");

      // ── 2. Resolve teams ───────────────────────────────────────────────────
      let homeTeam = resolveBatchTeam(teamAliasIdx, homeName, league.id);
      if (!homeTeam) throw new Error(`Home team "${homeName}" not found in catalog`);

      let awayTeam = resolveBatchTeam(teamAliasIdx, awayName, league.id);
      if (!awayTeam) throw new Error(`Away team "${awayName}" not found in catalog`);

      // If a team's leagueId doesn't match the fixture's league, query DB for
      // the correct team entry (teams can have multiple DB rows across leagues).
      if (dbPool && homeTeam.leagueId !== league.id) {
        const fixed = await resolveTeamByLeagueFromDb(dbPool, homeTeam.name, league.id);
        if (fixed) {
          homeTeam = fixed;
          log.debug({ teamName: fixed.name, teamId: fixed.id }, "home team corrected from DB");
        } else
          log.warn(
            { teamName: homeTeam.name, leagueId: league.id },
            "home team has no entry for league in DB"
          );
      }
      if (dbPool && awayTeam.leagueId !== league.id) {
        const fixed = await resolveTeamByLeagueFromDb(dbPool, awayTeam.name, league.id);
        if (fixed) {
          awayTeam = fixed;
          log.debug({ teamName: fixed.name, teamId: fixed.id }, "away team corrected from DB");
        } else
          log.warn(
            { teamName: awayTeam.name, leagueId: league.id },
            "away team has no entry for league in DB"
          );
      }

      log.debug(
        {
          homeName: homeTeam.name,
          homeId: homeTeam.id,
          homeLeagueId: homeTeam.leagueId,
          awayName: awayTeam.name,
          awayId: awayTeam.id,
          awayLeagueId: awayTeam.leagueId,
        },
        "teams resolved"
      );

      // ── 3. Build fixture payload ───────────────────────────────────────────
      const kickoffIso = fixture.kickoff || "";
      const kickoffDate = kickoffIso.split("T")[0] || "";
      const kickoffTime = (kickoffIso.split("T")[1] || "").replace("Z", "").slice(0, 5);
      const now = new Date().toISOString();

      // Use team.name (common ASCII name, no hyphens) rather than alternateName
      // which can contain hyphens (e.g. "Paris Saint-Germain FC") that the API rejects.
      const catalogEventName = `${homeTeam.name || homeTeam.alternateName} vs ${awayTeam.name || awayTeam.alternateName}`;

      const parsedKickoff = kickoffIso ? new Date(kickoffIso) : null;
      const hasValidKickoff =
        parsedKickoff instanceof Date && !Number.isNaN(parsedKickoff.getTime());
      const gameStartTime = hasValidKickoff ? parsedKickoff.toISOString() : kickoffIso;
      const parsedMatchDay = Number.parseInt(
        String(fixture.matchday || fixture.matchDay || "1"),
        10
      );
      const parsedMatchWeek = Number.parseInt(
        String(fixture.matchWeek || fixture.match_week || "0"),
        10
      );

      const fixturePayload = {
        name: catalogEventName,
        league_id: league.id,
        home_team_id: homeTeam.id,
        away_team_id: awayTeam.id,
        format: null,
        logo_url: "https://public-assets.pred.app/market-assets/fixture_128x128.png",
        theme_color: "#FFFFFF",
        match_day: Number.isInteger(parsedMatchDay) && parsedMatchDay > 0 ? parsedMatchDay : 1,
        match_week: Number.isInteger(parsedMatchWeek) && parsedMatchWeek >= 0 ? parsedMatchWeek : 0,
        location: "",
        venue: "",
        game_start_time: gameStartTime,
        alternate_name: buildUatFixtureAlternateName(homeTeam, awayTeam),
      };

      // ── 4. Fixture — DB lookup first, POST only if missing ─────────────────
      let fixtureUuid = null;
      if (dbPool) {
        try {
          const gameDate = gameStartTime.slice(0, 10);
          const exact = await dbPool.query(
            `SELECT fixture_id FROM fixtures
             WHERE league_id = $1 AND home_team_id = $2 AND away_team_id = $3
             ORDER BY created_at DESC NULLS LAST LIMIT 1`,
            [league.id, homeTeam.id, awayTeam.id]
          );
          if (exact.rows.length > 0) {
            fixtureUuid = String(exact.rows[0].fixture_id).trim();
            log.debug({ fixtureUuid, match: "exact" }, "fixture found in DB");
          } else {
            const byHome = await dbPool.query(
              `SELECT fixture_id, away_team_id FROM fixtures
               WHERE league_id = $1 AND home_team_id = $2 AND game_start_time::date = $3::date
               ORDER BY created_at DESC NULLS LAST LIMIT 1`,
              [league.id, homeTeam.id, gameDate]
            );
            if (byHome.rows.length > 0) {
              fixtureUuid = String(byHome.rows[0].fixture_id).trim();
              log.debug(
                { fixtureUuid, match: "home+date", awayUuidInDb: byHome.rows[0].away_team_id },
                "fixture found in DB"
              );
            } else {
              const byAway = await dbPool.query(
                `SELECT fixture_id, home_team_id FROM fixtures
                 WHERE league_id = $1 AND away_team_id = $2 AND game_start_time::date = $3::date
                 ORDER BY created_at DESC NULLS LAST LIMIT 1`,
                [league.id, awayTeam.id, gameDate]
              );
              if (byAway.rows.length > 0) {
                fixtureUuid = String(byAway.rows[0].fixture_id).trim();
                log.debug(
                  { fixtureUuid, match: "away+date", homeUuidInDb: byAway.rows[0].home_team_id },
                  "fixture found in DB"
                );
              } else {
                log.debug({ leagueId: league.id, gameDate }, "no fixture in DB, will POST");
              }
            }
          }
        } catch (e) {
          log.warn({ err: e }, "DB fixture lookup failed, will POST");
        }
      }
      if (!fixtureUuid) {
        log.debug({ payload: fixturePayload }, "POST fixture");
        const fixtureResp = await postCmsJson(
          cmsConfig,
          cmsConfig.endpoints.fixture,
          fixturePayload
        );
        log.debug({ response: fixtureResp }, "fixture POST response");
        fixtureUuid =
          String(
            fixtureResp?.fixture_id ||
              fixtureResp?.data?.fixture_id ||
              fixtureResp?.data?.id ||
              fixtureResp?.id ||
              ""
          ).trim() || null;
        if (!fixtureUuid)
          throw new Error(`Fixture POST returned no ID. Response: ${JSON.stringify(fixtureResp)}`);
        log.info({ fixtureUuid }, "fixture created");
      }

      // ── 5. Type reference — DB lookup first, POST only if missing ──────────
      const typeRefPayload = {
        type_value: "fixture",
        type_value_id: fixtureUuid,
        canonical_name: buildUatCanonicalFixtureName(
          catalogEventName,
          kickoffDate,
          fixture.leagueCode || league.key || league.code || ""
        ),
      };
      let typeRefId = null;
      if (dbPool) {
        try {
          const rows = await dbPool.query(
            `SELECT id, type_reference_id FROM type_references WHERE type_value = 'fixture' AND type_value_id = $1 LIMIT 1`,
            [fixtureUuid]
          );
          if (rows.rows.length > 0) {
            typeRefId = pickUuidLikeValue(rows.rows[0].type_reference_id, rows.rows[0].id);
            log.debug({ typeRefId }, "type-ref found in DB");
          }
        } catch (e) {
          log.warn({ err: e }, "DB type-ref lookup failed, will POST");
        }
      }
      if (!typeRefId) {
        log.debug({ payload: typeRefPayload }, "POST type-ref");
        const typeRefResp = await postCmsJson(
          cmsConfig,
          cmsConfig.endpoints.typeReference,
          typeRefPayload
        );
        log.debug({ response: typeRefResp }, "type-ref POST response");
        typeRefId = pickUuidLikeValue(
          typeRefResp?.type_reference_id ||
            typeRefResp?.meta?.type_reference_id ||
            typeRefResp?.data?.type_reference_id,
          typeRefResp?.id,
          typeRefResp?.meta?.id,
          typeRefResp?.data?.id
        );
        if (!typeRefId) {
          throw new Error(
            `Type reference POST returned no ID. Response: ${JSON.stringify(typeRefResp)}`
          );
        }
        log.info({ typeRefId }, "type-ref created");
      }

      // ── 6. Parent markets — DB lookup first, POST only if missing ──────────
      const marketResults = [];
      const savedParentPayloads = {};

      for (const publishKey of publishKeys) {
        const [family, line, side] = publishKey.split("|");
        log.debug(
          { publishKey, family, line: line || "0", side: side || "-" },
          "processing publishKey"
        );

        const parentPayloads = buildUatParentPayloads({
          fixtureJson: fixturePayload,
          league: league,
          homeTeam: homeTeam,
          awayTeam: awayTeam,
          fixtureDateIso: kickoffDate,
          kickoffTimeUtc: kickoffTime,
          openIso: kickoffIso,
          createdAtIso: now,
          typeReferenceId: typeRefId,
          outputProfile: "uat",
          marketLine: line || "0",
          spreadTeamSide: side || "home",
        });

        const familyPayload = parentPayloads?.[family];
        if (!familyPayload) {
          log.warn({ family }, "no payload built for family, skipping");
          marketResults.push({
            publish_key: publishKey,
            status: "skipped",
            reason: `No UAT payload for family "${family}"`,
          });
          continue;
        }
        savedParentPayloads[publishKey] = familyPayload;

        let existingParentState = null;
        if (dbPool) {
          try {
            const parent = familyPayload?.parent_market || {};
            const rows = await dbPool.query(
              `SELECT
                  pm.parent_market_id,
                  pm.parent_market_family,
                  pm.market_line,
                  pm.type_reference_id,
                  pm.title,
                  m.market_id,
                  m.team_id,
                  m.name AS market_name,
                  m.market_code
                 FROM parent_markets pm
                 LEFT JOIN markets m
                   ON m.parent_market_id = pm.parent_market_id
                WHERE type_reference_id = $1
                  AND parent_market_family = $2
                  AND market_line = $3
                  AND title = $4
                ORDER BY pm.created_at DESC NULLS LAST, m.created_at DESC NULLS LAST`,
              [
                typeRefId,
                String(parent.parent_market_family || "").trim(),
                String(parent.market_line ?? "").trim(),
                String(parent.title || "").trim(),
              ]
            );
            if (rows.rows.length > 0) {
              existingParentState = classifyExistingBatchParentMarketRows(rows.rows, {
                publishKey,
                homeTeamId: homeTeam.id,
                awayTeamId: awayTeam.id,
              });
              log.debug({ publishKey, state: existingParentState.status }, "parent-market state");
            }
          } catch (e) {
            log.warn({ err: e }, "DB parent-market lookup failed, will POST");
          }
        }

        if (existingParentState?.status === "existing") {
          marketResults.push({ publish_key: publishKey, status: "exists" });
          continue;
        }

        if (existingParentState?.status === "half_prepared") {
          marketResults.push({
            publish_key: publishKey,
            status: "half_prepared",
            reason:
              String(existingParentState.warnings?.join(" ") || "").trim() ||
              "Existing parent market is half-prepared.",
          });
          continue;
        }

        log.debug({ payload: familyPayload }, "POST parent-market");
        const pmResp = await postCmsJson(
          cmsConfig,
          cmsConfig.endpoints.parentMarket,
          familyPayload
        );
        log.debug({ response: pmResp }, "parent-market POST response");
        marketResults.push({ publish_key: publishKey, status: "published" });
      }

      fixtureResults.push({
        fixture_key: fixture.id || eventName,
        event_name: eventName,
        fixture_id: fixtureUuid,
        status: deriveBatchFixtureStatusFromMarkets(marketResults),
        markets: marketResults,
        payloads: {
          fixture: fixturePayload,
          type_reference: typeRefPayload,
          parent_markets: savedParentPayloads,
        },
      });
    } catch (err) {
      anyFailed = true;
      log.error({ err, eventName }, "fixture failed");
      fixtureResults.push({
        fixture_key: fixture.id || eventName,
        event_name: eventName,
        status: "failed",
        reason: String(err?.message || err),
        markets: publishKeys.map((key) => ({ publish_key: key, status: "failed" })),
      });
    }
  }

  record.fixtures = fixtureResults;
  record.status = deriveBatchRunStatusFromFixtures(fixtureResults, { anyFailed });
  record.completed_at = new Date().toISOString();
  log.info({ status: record.status, fixtureCount: fixtureResults.length }, "batch run done");
}
