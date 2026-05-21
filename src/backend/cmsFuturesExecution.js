import { randomUUID } from "node:crypto";
import { createScopedLogger } from "../shared/serverLogger.js";
import { normalizeLeagueRows, normalizeTeamRows, buildTeamAliasIndex } from "../data/catalog.js";
import { queryCatalogRowsFromDb } from "./catalogDb.js";
import { resolveBatchLeague, resolveBatchTeam } from "../server/services/batchResolutionService.js";
import { postCmsJson, pickUuidLikeValue } from "./cmsBatchExecution.js";
import { createCmsRuntimeConfig } from "./cmsPublisher.js";
import { renderTemplate, getFutureRuleTemplate } from "./futureRuleTemplates.js";

const log = createScopedLogger("futures");

// ── Catalog loading ──────────────────────────────────────────────────────────

// Loads leagues + teams from the active env's DB. Mirrors the loader used by
// the fixture batch executor (cmsBatchExecution.js:373-408) so team/league
// resolution stays consistent across the two flows.
export async function loadFuturesCatalog(envVars, dbPool, fallbackCsvLoader = null) {
  let leagues = null;
  let teams = null;
  if (dbPool) {
    try {
      const dbCatalog = await queryCatalogRowsFromDb(dbPool);
      leagues = normalizeLeagueRows(dbCatalog.leagues || []);
      teams = normalizeTeamRows(dbCatalog.teams || [], leagues);
    } catch (err) {
      log.warn({ err: err.message }, "DB catalog load failed; trying CSV");
    }
  }
  if (!leagues && typeof fallbackCsvLoader === "function") {
    const csv = await fallbackCsvLoader();
    leagues = normalizeLeagueRows(csv.leagues || []);
    teams = normalizeTeamRows(csv.teams || [], leagues);
  }
  if (!leagues || !teams) {
    throw new Error("Futures catalog: no league/team data available");
  }
  return { leagues, teams, teamAliasIdx: buildTeamAliasIndex(teams) };
}

// Resolves league + per-outcome team matches. Used both by the preview endpoint
// (/api/futures/resolve) and the publish executor's first step.
export function resolveLeagueFutureCatalog({ leagueCode, outcomeNames, catalog }) {
  const league = resolveBatchLeague(catalog.leagues, leagueCode);
  if (!league) {
    return { league: null, matched: [], unmatched: (outcomeNames || []).map((n) => ({ name: n })) };
  }
  const matched = [];
  const unmatched = [];
  for (const rawName of outcomeNames || []) {
    const name = String(rawName || "").trim();
    if (!name) continue;
    const team = resolveBatchTeam(catalog.teamAliasIdx, name, league.id);
    if (team && team.id) {
      matched.push({
        name,
        team_id: team.id,
        team_name: team.name,
        alternate_name: team.alternateName,
        logo_url: team.logoUrl || null,
      });
    } else {
      unmatched.push({ name });
    }
  }
  return {
    league: { id: league.id, name: league.name, code: league.key || league.code || leagueCode },
    matched,
    unmatched,
  };
}

// ── Canonical naming + payload building ──────────────────────────────────────

export function buildFutureCanonicalName({ leagueCode, futureKey, season }) {
  const slug = (s) =>
    String(s || "")
      .trim()
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, "-")
      .replace(/^-+|-+$/g, "");
  const parts = [slug(leagueCode), "future", slug(futureKey), slug(season)].filter(Boolean);
  return parts.join("-");
}

export function buildFutureMarketPayload({
  outcome,
  market_code,
  market_rules,
  tickSize = "0.01",
}) {
  return {
    name: outcome.name,
    tick_size: tickSize,
    market_code,
    rules: market_rules,
    team_id: outcome.team_id,
    logo_url: outcome.logo_url || "",
  };
}

export function buildFutureParentMarketPayload({
  leagueId,
  typeReferenceId,
  title,
  parentRules,
  marketsOpenTime,
}) {
  return {
    league_id: leagueId,
    type_reference_id: typeReferenceId,
    title,
    parent_market_family: "generic",
    market_line: "0",
    rules: parentRules,
    markets_open_time: marketsOpenTime,
  };
}

// Splits the rendered markets into one-or-many `parent-and-market` payloads
// depending on the publish mode. Mode is captured directly from the envelope
// (auto-derived from negRisk on the frontend, with operator override).
export function buildFuturesRequestBatches({ parentMarket, markets, mode }) {
  if (mode === "multi-winner") {
    return markets.map((m) => ({ parent_market: parentMarket, markets: [m] }));
  }
  // single-winner default
  return [{ parent_market: parentMarket, markets }];
}

// ── Type-reference upsert ────────────────────────────────────────────────────

export async function upsertFutureTypeReference({
  cmsConfig,
  dbPool,
  canonicalName,
  polymarketEventId,
}) {
  if (dbPool) {
    try {
      const rows = await dbPool.query(
        `SELECT id, type_reference_id FROM type_references
         WHERE type_value = 'generic' AND canonical_name = $1 LIMIT 1`,
        [canonicalName]
      );
      if (rows.rows.length > 0) {
        const id = pickUuidLikeValue(rows.rows[0].type_reference_id, rows.rows[0].id);
        if (id) {
          log.debug({ canonicalName, typeReferenceId: id }, "type-ref found in DB");
          return { type_reference_id: id, created: false };
        }
      }
    } catch (err) {
      log.warn({ err: err.message }, "DB type-ref lookup failed; will POST");
    }
  }
  // Use a deterministic-ish type_value_id derived from polymarket_event_id when
  // available so it stays stable across attempts; fall back to a random UUID.
  const typeValueId = randomUUID();
  const payload = {
    type_value: "generic",
    type_value_id: typeValueId,
    canonical_name: canonicalName,
  };
  log.info({ canonicalName, polymarketEventId }, "POST type-reference");
  let resp;
  try {
    resp = await postCmsJson(cmsConfig, cmsConfig.endpoints.typeReference, payload);
  } catch (err) {
    const text = String(err?.message || "");
    if (/SQLSTATE\s*23505/i.test(text) || /uni_type_references_canonical_name/i.test(text)) {
      // Race condition or stale DB read: another process created it. Re-query.
      if (dbPool) {
        const rows = await dbPool.query(
          `SELECT id, type_reference_id FROM type_references
           WHERE type_value = 'generic' AND canonical_name = $1 LIMIT 1`,
          [canonicalName]
        );
        if (rows.rows.length > 0) {
          const id = pickUuidLikeValue(rows.rows[0].type_reference_id, rows.rows[0].id);
          if (id) return { type_reference_id: id, created: false };
        }
      }
    }
    throw err;
  }
  const id = pickUuidLikeValue(
    resp?.type_reference_id,
    resp?.meta?.type_reference_id,
    resp?.data?.type_reference_id,
    resp?.id,
    resp?.meta?.id,
    resp?.data?.id
  );
  if (!id) {
    throw new Error(`type-reference POST returned no ID: ${JSON.stringify(resp)}`);
  }
  return { type_reference_id: id, created: true };
}

// ── Dedup check ──────────────────────────────────────────────────────────────

// Returns Set<market_code> of codes already in the CMS DB for this type_ref.
// Used to skip parent-and-market POSTs that would duplicate existing markets.
export async function findExistingMarketCodes(dbPool, typeReferenceId, marketCodes) {
  if (!dbPool || !typeReferenceId || !Array.isArray(marketCodes) || marketCodes.length === 0) {
    return new Set();
  }
  try {
    const rows = await dbPool.query(
      `SELECT m.market_code
         FROM markets m
         JOIN parent_markets pm ON pm.parent_market_id = m.parent_market_id
        WHERE pm.type_reference_id = $1
          AND m.market_code = ANY($2::text[])`,
      [typeReferenceId, marketCodes]
    );
    return new Set(rows.rows.map((r) => String(r.market_code || "").trim()).filter(Boolean));
  } catch (err) {
    log.warn({ err: err.message }, "market_code dedup query failed; proceeding");
    return new Set();
  }
}

// ── Render-only step (pure; no I/O once catalog is loaded) ───────────────────

// Resolves outcomes + renders parent/market text via templates. Returns the
// CMS-ready parent_market and markets WITHOUT performing the type-reference
// upsert or dedup query. Used by both the live executor and the dry-run
// preview endpoint so what the operator sees matches what gets POSTed.
//
// Returns either {ok: true, ...} or {ok: false, issues}. Catalog can be loaded
// once by the caller and passed in to avoid duplicate queries when multiple
// renders happen back-to-back.
export function renderFutureFromEnvelope({ envelope, catalog }) {
  const resolution = resolveLeagueFutureCatalog({
    leagueCode: envelope.league_code,
    outcomeNames: envelope.selected_outcomes.map((o) => o.name),
    catalog,
  });
  if (!resolution.league) {
    return { ok: false, issues: [`league_not_in_catalog:${envelope.league_code}`] };
  }

  // Apply operator overrides to outcomes whose names didn't auto-match.
  const overridesByName = new Map(
    envelope.selected_outcomes.filter((o) => o.team_id_override).map((o) => [String(o.name), o])
  );
  const matchedByName = new Map(resolution.matched.map((m) => [m.name, m]));
  const finalOutcomes = [];
  const stillUnmatched = [];
  for (const o of envelope.selected_outcomes) {
    const auto = matchedByName.get(o.name);
    const override = overridesByName.get(String(o.name));
    if (auto) {
      finalOutcomes.push({ ...auto, polymarket_market_id: o.polymarket_market_id });
    } else if (override?.team_id_override) {
      finalOutcomes.push({
        name: o.name,
        team_id: override.team_id_override,
        logo_url: override.logo_url_override || null,
        polymarket_market_id: o.polymarket_market_id,
      });
    } else {
      stillUnmatched.push(o.name);
    }
  }
  if (stillUnmatched.length > 0) {
    return { ok: false, issues: stillUnmatched.map((n) => `unmatched:${n}`) };
  }

  const substitutionsCommon = { season: envelope.season, league: resolution.league.name };
  const renderedMarkets = finalOutcomes.map((o) => {
    const subs = { ...substitutionsCommon, team: o.name };
    const market_code = renderTemplate(envelope.market_code_template, subs).trim();
    const market_rules = renderTemplate(envelope.market_rules_template, subs);
    return buildFutureMarketPayload({ outcome: o, market_code, market_rules });
  });

  const canonical_name = buildFutureCanonicalName({
    leagueCode: envelope.league_code,
    futureKey: envelope.future_key,
    season: envelope.season,
  });

  // Parent payload (without type_reference_id since that's a publish-time side
  // effect). Preview uses a placeholder so the operator can still inspect the
  // overall shape.
  const parent_market = buildFutureParentMarketPayload({
    leagueId: resolution.league.id,
    typeReferenceId: "<assigned-on-publish>",
    title: envelope.title,
    parentRules: renderTemplate(envelope.parent_rules, substitutionsCommon),
    marketsOpenTime: envelope.markets_open_time,
  });

  const batches = buildFuturesRequestBatches({
    parentMarket: parent_market,
    markets: renderedMarkets,
    mode: envelope.mode,
  });

  return {
    ok: true,
    league: resolution.league,
    canonical_name,
    parent_market,
    markets: renderedMarkets,
    batches,
    mode: envelope.mode,
    post_count: batches.length,
  };
}

// ── Top-level orchestrator ───────────────────────────────────────────────────

// Mutates `record` in place (mirrors batchRunStore pattern in cmsBatchExecution.js).
// Caller is responsible for inserting record into the store and serving polls.
export async function executeFuturesPublish({
  envelope,
  record,
  envVars,
  dbPool,
  fallbackCsvLoader = null,
}) {
  record.status = "running";
  record.started_at = record.started_at || new Date().toISOString();
  try {
    const cmsConfig = createCmsRuntimeConfig(envVars);
    if (!cmsConfig.enabled) {
      throw new Error("CMS publishing is not configured for the active environment");
    }
    const catalog = await loadFuturesCatalog(envVars, dbPool, fallbackCsvLoader);
    const rendered = renderFutureFromEnvelope({ envelope, catalog });
    if (!rendered.ok) {
      throw new Error(`render failed: ${(rendered.issues || []).join(", ")}`);
    }
    const renderedMarkets = rendered.markets;

    // Type-reference: create if missing (idempotent by canonical_name).
    const canonicalName = rendered.canonical_name;
    const { type_reference_id } = await upsertFutureTypeReference({
      cmsConfig,
      dbPool,
      canonicalName,
      polymarketEventId: envelope.polymarket_event_id,
    });
    record.type_reference_id = type_reference_id;
    record.canonical_name = canonicalName;

    // Dedup: skip per-market POSTs whose market_code already exists.
    const existingCodes = await findExistingMarketCodes(
      dbPool,
      type_reference_id,
      renderedMarkets.map((m) => m.market_code)
    );

    // Build batches with the real type_reference_id (render gave us a
    // placeholder so it could run without I/O).
    const parentMarket = { ...rendered.parent_market, type_reference_id };
    const batches = buildFuturesRequestBatches({
      parentMarket,
      markets: renderedMarkets,
      mode: envelope.mode,
    });

    record.markets = renderedMarkets.map((m) => ({
      market_code: m.market_code,
      name: m.name,
      status: "pending",
    }));

    let anyFailed = false;
    for (const batch of batches) {
      // If every market in this batch is already in DB, mark existing and skip.
      const allExisting = batch.markets.every((m) => existingCodes.has(m.market_code));
      if (allExisting) {
        for (const m of batch.markets) {
          const slot = record.markets.find((r) => r.market_code === m.market_code);
          if (slot) slot.status = "existing";
        }
        continue;
      }
      try {
        await postCmsJson(cmsConfig, cmsConfig.endpoints.parentMarket, batch);
        for (const m of batch.markets) {
          const slot = record.markets.find((r) => r.market_code === m.market_code);
          if (slot) slot.status = "published";
        }
      } catch (err) {
        anyFailed = true;
        const reason = String(err?.message || err);
        for (const m of batch.markets) {
          const slot = record.markets.find((r) => r.market_code === m.market_code);
          if (slot) {
            slot.status = "failed";
            slot.reason = reason;
          }
        }
        log.error({ err: reason, batch }, "parent-and-market POST failed");
      }
    }

    // Optional traceability: record the publish in league_futures so the
    // dashboard can mark this Polymarket event as already published without
    // scanning type_references by cname pattern.
    if (dbPool) {
      try {
        await dbPool.query(
          `INSERT INTO league_futures
            (league_code, season, future_key, title, polymarket_event_id, cms_type_reference_id, outcomes)
           VALUES ($1, $2, $3, $4, $5, $6, $7::jsonb)
           ON CONFLICT (league_code, season, future_key)
           DO UPDATE SET title = EXCLUDED.title,
                         polymarket_event_id = EXCLUDED.polymarket_event_id,
                         cms_type_reference_id = EXCLUDED.cms_type_reference_id,
                         updated_at = NOW()`,
          [
            envelope.league_code,
            envelope.season,
            envelope.future_key,
            envelope.title,
            envelope.polymarket_event_id || null,
            type_reference_id,
            JSON.stringify(
              renderedMarkets.map((m) => ({
                name: m.name,
                team_id: m.team_id,
                market_code: m.market_code,
              }))
            ),
          ]
        );
      } catch (err) {
        log.warn({ err: err.message }, "league_futures trace write failed (non-fatal)");
      }
    }

    record.status = anyFailed ? "partial" : "completed";
    record.completed_at = new Date().toISOString();
  } catch (err) {
    record.status = "failed";
    record.detail = String(err?.message || err);
    record.completed_at = new Date().toISOString();
    log.error({ err: record.detail }, "futures publish failed");
  }
}

// ── Per-future readiness ─────────────────────────────────────────────────────

// Inspects a future (template availability + catalog match) so the dashboard
// can decide between one-click Publish and Configure. Pure function over the
// already-loaded catalog; cheap enough to run for every future on a league
// fetch when ?with_readiness=1 is set.
export function evaluateFutureReadiness({ future, leagueCode, catalog }) {
  const tpl = getFutureRuleTemplate(future.future_key);
  const templateAvailable = !tpl._fallback;
  const outcomeNames = (future.outcomes || []).map((o) => o.name);
  const resolution = resolveLeagueFutureCatalog({ leagueCode, outcomeNames, catalog });
  const unmatched = (resolution.unmatched || []).map((u) => u.name);
  return {
    template_available: templateAvailable,
    unmatched_names: unmatched,
    can_quick_publish: templateAvailable && unmatched.length === 0,
  };
}

// ── Quick-publish envelope builder ───────────────────────────────────────────

// Given the minimal input from the dashboard's one-click Publish, fills in
// title / rules / mode / season from defaults so the executor receives the
// same shape as the manual Configure path. Returns either {ok: true, envelope}
// or {ok: false, issues: [...]} — the route handler maps those to 202 / 400.
export function buildQuickPublishEnvelope({ input }) {
  const issues = [];
  if (!input || typeof input !== "object") issues.push("invalid_body");
  const requiredKeys = [
    "environment",
    "league_code",
    "future_key",
    "polymarket_event_id",
    "end_date",
  ];
  for (const k of requiredKeys) {
    if (!input?.[k]) issues.push(`missing_${k}`);
  }
  if (!Array.isArray(input?.outcomes) || input.outcomes.length === 0)
    issues.push("missing_outcomes");
  if (issues.length > 0) return { ok: false, issues };

  const tpl = getFutureRuleTemplate(input.future_key);
  if (tpl._fallback) {
    return { ok: false, issues: ["template_missing"] };
  }

  // Season from event endDate year (UTC). Operator can override in Configure.
  const endDateMs = new Date(input.end_date).getTime();
  if (!Number.isFinite(endDateMs)) {
    return { ok: false, issues: ["invalid_end_date"] };
  }
  const season = String(new Date(endDateMs).getUTCFullYear());

  // Mode auto-derived from Polymarket's negRisk flag.
  const mode = input.negRisk ? "single-winner" : "multi-winner";

  // Default markets_open_time is "now" — the operator can override in Configure
  // when they want betting gated until a specific later time.
  const marketsOpenTime = input.markets_open_time || new Date().toISOString();

  const envelope = {
    environment: input.environment,
    league_code: input.league_code,
    future_key: input.future_key,
    polymarket_event_id: input.polymarket_event_id,
    season,
    title: tpl.title,
    parent_rules: tpl.parent_rules,
    market_code_template: tpl.market_code_template,
    market_rules_template: tpl.market_rules_template,
    markets_open_time: marketsOpenTime,
    mode,
    selected_outcomes: input.outcomes.map((o) => ({
      polymarket_market_id: o.polymarket_market_id,
      name: o.name,
    })),
  };
  return { ok: true, envelope };
}
