import { createScopedLogger } from "../shared/serverLogger.js";
import { createCmsRuntimeConfig } from "./cmsPublisher.js";
import { postCmsJson, pickUuidLikeValue } from "./cmsBatchExecution.js";
import { buildUatFixtureAlternateName, buildUatCanonicalFixtureName } from "../core/uatFormats.js";
import { validateFixtureJson } from "../core/validation.js";

const jsonPubLog = createScopedLogger("json-publish");

/**
 * Server-bound context passed by the route layer.
 * @typedef {object} JsonPublishContext
 * @property {() => {code:string,label:string,env:object}} getActiveRuntimeEnvironmentProfile
 * @property {() => object} getActiveRuntimeEnvVars
 * @property {(env: object) => any|null} getDbPoolForEnv
 * @property {(req: any, opts?: any) => Promise<any>} readJsonRequestBody
 * @property {(res: any, status: number, body: any, headers?: object) => void} sendJson
 * @property {(pool: any, args: object) => Promise<{id:string,name:string,alternateName:string}>} resolveTeamRecordFromDb
 * @property {(pool: any, args: object) => Promise<{id:string,name:string,slug:string}>} resolveLeagueRecordFromDb
 */

export async function handleJsonPublishFixtureRequest(req, res, ctx) {
  const {
    getActiveRuntimeEnvironmentProfile,
    getActiveRuntimeEnvVars,
    getDbPoolForEnv,
    readJsonRequestBody,
    sendJson,
    resolveTeamRecordFromDb,
  } = ctx;

  const activeProfile = getActiveRuntimeEnvironmentProfile();
  const cmsConfig = createCmsRuntimeConfig(activeProfile.env);
  if (!cmsConfig.enabled) {
    sendJson(res, 503, { error: "CMS is not configured for this environment" });
    return;
  }
  const pool = getDbPoolForEnv(getActiveRuntimeEnvVars());
  if (!pool) {
    sendJson(res, 503, { error: "DB not configured for active environment" });
    return;
  }

  let body;
  try {
    body = await readJsonRequestBody(req);
  } catch {
    sendJson(res, 400, { error: "Invalid JSON body" });
    return;
  }

  const fixtureName = String(body?.fixture_name || "").trim();
  if (!fixtureName) {
    sendJson(res, 400, { error: "fixture_name is required" });
    return;
  }
  const leagueId = String(body?.league_id || "").trim();

  try {
    const params = [`%${fixtureName}%`];
    if (leagueId) params.push(leagueId);
    const r = await pool.query(
      `SELECT
         f.fixture_id, f.name, f.league_id, f.home_team_id, f.away_team_id, f.game_start_time,
         l.name AS league_name, l.alternate_name AS league_alternate_name,
         ht.name  AS home_team_name,  ht.alternate_name AS home_team_alternate,
         at2.name AS away_team_name, at2.alternate_name AS away_team_alternate
       FROM fixtures f
       LEFT JOIN leagues l  ON l.league_id  = f.league_id
       LEFT JOIN teams ht   ON ht.team_id   = f.home_team_id
       LEFT JOIN teams at2  ON at2.team_id  = f.away_team_id
       WHERE (f.name ILIKE $1 OR f.alternate_name ILIKE $1)
         ${leagueId ? "AND f.league_id = $2" : ""}
       ORDER BY f.game_start_time DESC NULLS LAST
       LIMIT 5`,
      params
    );

    if (!r.rows.length) {
      sendJson(res, 404, { error: `No fixture found matching "${fixtureName}"` });
      return;
    }

    const row = r.rows[0];
    const kickoffIso = row.game_start_time ? new Date(row.game_start_time).toISOString() : "";
    const kickoffDate = kickoffIso.slice(0, 10);

    const [resolvedHomeTeam, resolvedAwayTeam] = await Promise.all([
      resolveTeamRecordFromDb(pool, {
        teamId: String(row.home_team_id || "").trim(),
        teamName: String(row.home_team_name || "").trim(),
        leagueId: String(row.league_id || "").trim(),
      }),
      resolveTeamRecordFromDb(pool, {
        teamId: String(row.away_team_id || "").trim(),
        teamName: String(row.away_team_name || "").trim(),
        leagueId: String(row.league_id || "").trim(),
      }),
    ]);
    const homeTeam = {
      id: resolvedHomeTeam.id,
      name: resolvedHomeTeam.name || String(row.home_team_name || "").trim(),
      alternateName:
        resolvedHomeTeam.alternateName ||
        String(row.home_team_alternate || row.home_team_name || "").trim(),
    };
    const awayTeam = {
      id: resolvedAwayTeam.id,
      name: resolvedAwayTeam.name || String(row.away_team_name || "").trim(),
      alternateName:
        resolvedAwayTeam.alternateName ||
        String(row.away_team_alternate || row.away_team_name || "").trim(),
    };
    const leagueName = String(row.league_name || "").trim();
    const league = {
      id: String(row.league_id || "").trim(),
      name: leagueName,
      slug:
        leagueName
          .toLowerCase()
          .replace(/[^a-z0-9]+/g, "-")
          .replace(/^-+|-+$/g, "") || "league",
    };

    const fixturePayload = {
      name: String(row.name || "").trim(),
      league_id: league.id,
      home_team_id: homeTeam.id,
      away_team_id: awayTeam.id,
      format: null,
      logo_url: "https://public-assets.pred.app/market-assets/fixture_128x128.png",
      theme_color: "#FFFFFF",
      match_day: 1,
      match_week: 0,
      location: "",
      venue: "",
      game_start_time: kickoffIso || null,
      alternate_name: buildUatFixtureAlternateName(homeTeam, awayTeam),
    };

    const fixtureValidationErrors = validateFixtureJson(fixturePayload);
    if (fixtureValidationErrors.length > 0) {
      sendJson(res, 400, {
        error: "Resolved fixture payload is invalid",
        detail: fixtureValidationErrors,
        fixture_name: String(row.name || "").trim(),
      });
      return;
    }

    let fixtureUuid = String(row.fixture_id || "").trim() || null;
    const fixtureAlreadyExisted = Boolean(fixtureUuid);

    if (!fixtureUuid) {
      const fixtureResp = await postCmsJson(cmsConfig, cmsConfig.endpoints.fixture, fixturePayload);
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
    }

    const canonicalName = buildUatCanonicalFixtureName(
      String(row.name || "").trim(),
      kickoffDate,
      league.slug
    );
    const typeRefPayload = {
      type_value: "fixture",
      type_value_id: fixtureUuid,
      canonical_name: canonicalName,
    };

    let typeRefId = null;
    let typeRefAlreadyExisted = false;
    try {
      const typeRefRows = await pool.query(
        `SELECT id, type_reference_id FROM type_references WHERE type_value = 'fixture' AND type_value_id = $1 LIMIT 1`,
        [fixtureUuid]
      );
      if (typeRefRows.rows.length > 0) {
        typeRefId = pickUuidLikeValue(
          typeRefRows.rows[0].type_reference_id,
          typeRefRows.rows[0].id
        );
        typeRefAlreadyExisted = Boolean(typeRefId);
      }
    } catch (e) {
      jsonPubLog.warn({ err: e, op: "publish-fixture" }, "DB type-ref lookup failed, will POST");
    }

    if (!typeRefId) {
      const typeRefResp = await postCmsJson(
        cmsConfig,
        cmsConfig.endpoints.typeReference,
        typeRefPayload
      );
      typeRefId = pickUuidLikeValue(
        typeRefResp?.type_reference_id,
        typeRefResp?.meta?.type_reference_id,
        typeRefResp?.data?.type_reference_id,
        typeRefResp?.id,
        typeRefResp?.meta?.id,
        typeRefResp?.data?.id
      );
      if (!typeRefId)
        throw new Error(
          `Type reference POST returned no ID. Response: ${JSON.stringify(typeRefResp)}`
        );
    }

    sendJson(res, 200, {
      fixture_id: fixtureUuid,
      fixture_existed: fixtureAlreadyExisted,
      type_reference_id: typeRefId,
      type_ref_existed: typeRefAlreadyExisted,
      fixture_payload: fixturePayload,
      type_ref_payload: typeRefPayload,
      fixture_db_name: String(row.name || "").trim(),
    });
  } catch (err) {
    jsonPubLog.error({ err, op: "publish-fixture" }, "json publish-fixture failed");
    sendJson(res, 500, { error: err.message });
  }
}

export async function handleJsonPublishParentMarketRequest(req, res, ctx) {
  const { getActiveRuntimeEnvironmentProfile, readJsonRequestBody, sendJson } = ctx;

  const activeProfile = getActiveRuntimeEnvironmentProfile();
  const cmsConfig = createCmsRuntimeConfig(activeProfile.env);
  if (!cmsConfig.enabled) {
    sendJson(res, 503, { error: "CMS is not configured for this environment" });
    return;
  }

  let body;
  try {
    body = await readJsonRequestBody(req);
  } catch {
    sendJson(res, 400, { error: "Invalid JSON body" });
    return;
  }

  const payload = body?.payload;
  if (!payload || typeof payload !== "object" || Array.isArray(payload)) {
    sendJson(res, 400, { error: "payload (object) is required" });
    return;
  }

  try {
    const pmResp = await postCmsJson(cmsConfig, cmsConfig.endpoints.parentMarket, payload);
    sendJson(res, 200, { success: true, response: pmResp });
  } catch (err) {
    jsonPubLog.error({ err, op: "publish-parent-market" }, "json publish-parent-market failed");
    sendJson(res, 500, { error: err.message });
  }
}

export async function handleJsonPreparePublishRequest(req, res, ctx) {
  const {
    getActiveRuntimeEnvironmentProfile,
    getActiveRuntimeEnvVars,
    getDbPoolForEnv,
    readJsonRequestBody,
    sendJson,
    resolveTeamRecordFromDb,
    resolveLeagueRecordFromDb,
  } = ctx;

  const activeProfile = getActiveRuntimeEnvironmentProfile();
  const cmsConfig = createCmsRuntimeConfig(activeProfile.env);
  if (!cmsConfig.enabled) {
    sendJson(res, 503, { error: "CMS is not configured for this environment" });
    return;
  }
  const pool = getDbPoolForEnv(getActiveRuntimeEnvVars());

  let body;
  try {
    body = await readJsonRequestBody(req);
  } catch {
    sendJson(res, 400, { error: "Invalid JSON body" });
    return;
  }

  const rawFixturePayload = body?.fixture_payload;
  if (
    !rawFixturePayload ||
    typeof rawFixturePayload !== "object" ||
    Array.isArray(rawFixturePayload)
  ) {
    sendJson(res, 400, { error: "fixture_payload (object) is required" });
    return;
  }
  const leagueSlug = String(body?.league_slug || "").trim();
  const homeTeamName = String(body?.home_team_name || "").trim();
  const awayTeamName = String(body?.away_team_name || "").trim();

  try {
    const fixturePayload = { ...rawFixturePayload };
    const resolvedLeague = await resolveLeagueRecordFromDb(pool, {
      leagueId: String(fixturePayload.league_id || "").trim(),
      leagueSlug,
      leagueName: "",
    });
    if (!String(fixturePayload.league_id || "").trim() && resolvedLeague.id) {
      fixturePayload.league_id = resolvedLeague.id;
    }

    const [resolvedHomeTeam, resolvedAwayTeam] = await Promise.all([
      resolveTeamRecordFromDb(pool, {
        teamId: String(fixturePayload.home_team_id || "").trim(),
        teamName: homeTeamName,
        leagueId: resolvedLeague.id || String(fixturePayload.league_id || "").trim(),
      }),
      resolveTeamRecordFromDb(pool, {
        teamId: String(fixturePayload.away_team_id || "").trim(),
        teamName: awayTeamName,
        leagueId: resolvedLeague.id || String(fixturePayload.league_id || "").trim(),
      }),
    ]);
    if (!String(fixturePayload.home_team_id || "").trim() && resolvedHomeTeam.id) {
      fixturePayload.home_team_id = resolvedHomeTeam.id;
    }
    if (!String(fixturePayload.away_team_id || "").trim() && resolvedAwayTeam.id) {
      fixturePayload.away_team_id = resolvedAwayTeam.id;
    }

    const fixtureValidationErrors = validateFixtureJson(fixturePayload);
    if (fixtureValidationErrors.length > 0) {
      sendJson(res, 400, {
        error: "Resolved fixture payload is invalid",
        detail: fixtureValidationErrors,
      });
      return;
    }

    const fixtureResp = await postCmsJson(cmsConfig, cmsConfig.endpoints.fixture, fixturePayload);
    const fixtureUuid = String(
      fixtureResp?.fixture_id ||
        fixtureResp?.data?.fixture_id ||
        fixtureResp?.data?.id ||
        fixtureResp?.id ||
        ""
    ).trim();
    if (!fixtureUuid)
      throw new Error(`Fixture POST returned no ID: ${JSON.stringify(fixtureResp)}`);

    let typeRefId = null;
    if (pool) {
      try {
        const typeRefRows = await pool.query(
          `SELECT id, type_reference_id FROM type_references WHERE type_value = 'fixture' AND type_value_id = $1 LIMIT 1`,
          [fixtureUuid]
        );
        if (typeRefRows.rows.length > 0) {
          typeRefId = pickUuidLikeValue(
            typeRefRows.rows[0].type_reference_id,
            typeRefRows.rows[0].id
          );
        }
      } catch (e) {
        jsonPubLog.warn({ err: e, op: "prepare-publish" }, "DB type-ref lookup failed");
      }
    }

    if (!typeRefId) {
      const kickoffDate = String(fixturePayload.game_start_time || "").slice(0, 10);
      const canonicalName = buildUatCanonicalFixtureName(
        String(fixturePayload.name || "").trim(),
        kickoffDate,
        leagueSlug
      );
      const typeRefPayload = {
        type_value: "fixture",
        type_value_id: fixtureUuid,
        canonical_name: canonicalName,
      };
      const typeRefResp = await postCmsJson(
        cmsConfig,
        cmsConfig.endpoints.typeReference,
        typeRefPayload
      );
      typeRefId = pickUuidLikeValue(
        typeRefResp?.type_reference_id,
        typeRefResp?.meta?.type_reference_id,
        typeRefResp?.data?.type_reference_id,
        typeRefResp?.id,
        typeRefResp?.meta?.id,
        typeRefResp?.data?.id
      );
      if (!typeRefId)
        throw new Error(`Type reference POST returned no ID: ${JSON.stringify(typeRefResp)}`);
    }

    sendJson(res, 200, { fixture_id: fixtureUuid, type_reference_id: typeRefId });
  } catch (err) {
    jsonPubLog.error({ err, op: "prepare-publish" }, "json prepare-publish failed");
    sendJson(res, 500, { error: err.message });
  }
}
