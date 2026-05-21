import test from "node:test";
import assert from "node:assert/strict";

import {
  buildFutureCanonicalName,
  buildFutureMarketPayload,
  buildFutureParentMarketPayload,
  buildFuturesRequestBatches,
  buildQuickPublishEnvelope,
  evaluateFutureReadiness,
  findExistingMarketCodes,
  resolveLeagueFutureCatalog,
} from "../src/backend/cmsFuturesExecution.js";
import {
  getFutureRuleTemplate,
  renderTemplate,
  FUTURE_RULE_TEMPLATES,
} from "../src/backend/futureRuleTemplates.js";

function silentPool(rows = []) {
  return {
    queries: [],
    async query(sql, params) {
      this.queries.push({ sql, params });
      return { rows };
    },
  };
}

test("buildFutureCanonicalName composes league/future/season slugs", () => {
  const cname = buildFutureCanonicalName({
    leagueCode: "UCL",
    futureKey: "uefa-champions-league-team-to-reach-final",
    season: "2026",
  });
  assert.equal(cname, "ucl-future-uefa-champions-league-team-to-reach-final-2026");
});

test("buildFutureCanonicalName tolerates messy inputs", () => {
  const cname = buildFutureCanonicalName({
    leagueCode: "EPL",
    futureKey: "English Premier League Winner",
    season: "2025-26",
  });
  assert.equal(cname, "epl-future-english-premier-league-winner-2025-26");
});

test("renderTemplate substitutes team/season/league tokens", () => {
  const rendered = renderTemplate('Resolves to "Long" if {team} win the {season} {league}.', {
    team: "Arsenal",
    season: "2026",
    league: "EPL",
  });
  assert.equal(rendered, 'Resolves to "Long" if Arsenal win the 2026 EPL.');
});

test("renderTemplate leaves unknown tokens intact", () => {
  const rendered = renderTemplate("hello {unknown} {team}", { team: "Bayern" });
  assert.equal(rendered, "hello {unknown} Bayern");
});

test("getFutureRuleTemplate flags fallback for unknown keys", () => {
  const known = getFutureRuleTemplate("english-premier-league-winner");
  assert.equal(known._fallback, false);
  assert.equal(known.title, FUTURE_RULE_TEMPLATES["english-premier-league-winner"].title);

  const fallback = getFutureRuleTemplate("unknown-future-xyz");
  assert.equal(fallback._fallback, true);
  assert.equal(fallback.parent_rules, "");
});

test("resolveLeagueFutureCatalog matches by alias index and surfaces unmatched", () => {
  const catalog = {
    leagues: [
      {
        id: "league-ucl-uuid",
        key: "ucl",
        name: "UCL",
        slug: "ucl",
        alternateName: "UEFA Champions League",
        aliases: ["ucl", "uefa champions league", "champions league"],
      },
    ],
    teams: [],
    teamAliasIdx: [
      {
        alias: "arsenal",
        team: {
          id: "t-arsenal",
          name: "Arsenal",
          leagueId: "league-ucl-uuid",
          logoUrl: "arsenal.png",
        },
      },
      {
        alias: "bayern munchen",
        team: {
          id: "t-bayern",
          name: "Bayern Munich",
          leagueId: "league-ucl-uuid",
          logoUrl: "bayern.png",
        },
      },
      {
        alias: "psg",
        team: { id: "t-psg", name: "PSG", leagueId: "league-ucl-uuid", logoUrl: "psg.png" },
      },
    ],
  };

  const result = resolveLeagueFutureCatalog({
    leagueCode: "ucl",
    outcomeNames: ["Arsenal", "Bayern München", "PSG", "Garbage FC"],
    catalog,
  });

  assert.equal(result.league?.id, "league-ucl-uuid");
  assert.equal(result.matched.length, 3);
  assert.equal(result.unmatched.length, 1);
  assert.equal(result.unmatched[0].name, "Garbage FC");
  // Accent stripped: "Bayern München" → "bayern munchen" matches catalog alias.
  const bayern = result.matched.find((m) => m.name === "Bayern München");
  assert.ok(bayern);
  assert.equal(bayern.team_id, "t-bayern");
});

test("resolveLeagueFutureCatalog returns null league when code unknown", () => {
  const result = resolveLeagueFutureCatalog({
    leagueCode: "fakery",
    outcomeNames: ["Foo"],
    catalog: { leagues: [], teams: [], teamAliasIdx: [] },
  });
  assert.equal(result.league, null);
  assert.equal(result.matched.length, 0);
  assert.equal(result.unmatched.length, 1);
});

test("buildFutureParentMarketPayload includes the required CMS fields", () => {
  const payload = buildFutureParentMarketPayload({
    leagueId: "league-uuid",
    typeReferenceId: "tref-uuid",
    title: "UCL: Team to reach final",
    parentRules: "long rules text",
    marketsOpenTime: "2026-04-30T00:00:00Z",
  });
  assert.equal(payload.league_id, "league-uuid");
  assert.equal(payload.type_reference_id, "tref-uuid");
  assert.equal(payload.parent_market_family, "generic");
  assert.equal(payload.market_line, "0");
  assert.equal(payload.markets_open_time, "2026-04-30T00:00:00Z");
});

test("buildFutureMarketPayload hard-codes tick_size", () => {
  const payload = buildFutureMarketPayload({
    outcome: { name: "Arsenal", team_id: "t-uuid", logo_url: "logo.png" },
    market_code: "Arsenal to reach final (UCL)",
    market_rules: "Resolves Long if Arsenal reach final",
  });
  assert.equal(payload.tick_size, "0.01");
  assert.equal(payload.team_id, "t-uuid");
  assert.equal(payload.logo_url, "logo.png");
  assert.equal(payload.market_code, "Arsenal to reach final (UCL)");
});

test("buildFuturesRequestBatches single-winner returns one batch with all markets", () => {
  const parentMarket = { title: "EPL Winner" };
  const markets = [
    { name: "Man City", market_code: "Man City (EPL)" },
    { name: "Arsenal", market_code: "Arsenal (EPL)" },
  ];
  const batches = buildFuturesRequestBatches({ parentMarket, markets, mode: "single-winner" });
  assert.equal(batches.length, 1);
  assert.equal(batches[0].markets.length, 2);
  assert.equal(batches[0].parent_market, parentMarket);
});

test("buildFuturesRequestBatches multi-winner returns one batch per market", () => {
  const parentMarket = { title: "UCL: Team to reach final" };
  const markets = [
    { name: "Arsenal", market_code: "Arsenal to reach final (UCL)" },
    { name: "PSG", market_code: "PSG to reach final (UCL)" },
    { name: "Bayern", market_code: "Bayern to reach final (UCL)" },
  ];
  const batches = buildFuturesRequestBatches({ parentMarket, markets, mode: "multi-winner" });
  assert.equal(batches.length, 3);
  for (const b of batches) {
    assert.equal(b.markets.length, 1);
    assert.equal(b.parent_market, parentMarket);
  }
});

test("findExistingMarketCodes returns existing codes for dedup", async () => {
  const pool = {
    async query(sql, params) {
      assert.match(String(sql), /parent_markets/);
      assert.equal(params[0], "tref-1");
      assert.deepEqual(params[1], ["Arsenal (EPL)", "Man City (EPL)"]);
      return { rows: [{ market_code: "Arsenal (EPL)" }] };
    },
  };
  const set = await findExistingMarketCodes(pool, "tref-1", ["Arsenal (EPL)", "Man City (EPL)"]);
  assert.equal(set.size, 1);
  assert.ok(set.has("Arsenal (EPL)"));
});

test("findExistingMarketCodes returns empty set on DB failure", async () => {
  const pool = {
    async query() {
      throw new Error("DB unreachable");
    },
  };
  const set = await findExistingMarketCodes(pool, "tref-1", ["x"]);
  assert.equal(set.size, 0);
});

test("findExistingMarketCodes short-circuits when inputs are empty", async () => {
  const set = await findExistingMarketCodes(null, "tref-1", ["x"]);
  assert.equal(set.size, 0);
  const set2 = await findExistingMarketCodes(silentPool(), "tref-1", []);
  assert.equal(set2.size, 0);
});

// ── Readiness + quick-publish envelope ───────────────────────────────────────

function uclCatalogStub() {
  return {
    leagues: [
      {
        id: "league-ucl",
        key: "ucl",
        name: "UCL",
        slug: "ucl",
        alternateName: "UEFA Champions League",
        aliases: ["ucl", "uefa champions league"],
      },
    ],
    teams: [],
    teamAliasIdx: [
      {
        alias: "arsenal",
        team: { id: "t-arsenal", name: "Arsenal", leagueId: "league-ucl", logoUrl: "" },
      },
      { alias: "psg", team: { id: "t-psg", name: "PSG", leagueId: "league-ucl", logoUrl: "" } },
      {
        alias: "bayern munchen",
        team: { id: "t-bayern", name: "Bayern Munich", leagueId: "league-ucl", logoUrl: "" },
      },
      {
        alias: "atletico madrid",
        team: { id: "t-atleti", name: "Atlético Madrid", leagueId: "league-ucl", logoUrl: "" },
      },
    ],
  };
}

test("evaluateFutureReadiness flags can_quick_publish when template + catalog align", () => {
  const future = {
    future_key: "uefa-champions-league-team-to-reach-final",
    outcomes: [
      { name: "Arsenal", polymarket_market_id: "m1" },
      { name: "PSG", polymarket_market_id: "m2" },
    ],
  };
  const r = evaluateFutureReadiness({ future, leagueCode: "ucl", catalog: uclCatalogStub() });
  assert.equal(r.template_available, true);
  assert.deepEqual(r.unmatched_names, []);
  assert.equal(r.can_quick_publish, true);
});

test("evaluateFutureReadiness flags template_available=false for unseeded future_key", () => {
  const future = {
    future_key: "made-up-future",
    outcomes: [{ name: "Arsenal", polymarket_market_id: "m1" }],
  };
  const r = evaluateFutureReadiness({ future, leagueCode: "ucl", catalog: uclCatalogStub() });
  assert.equal(r.template_available, false);
  assert.equal(r.can_quick_publish, false);
});

test("evaluateFutureReadiness surfaces unmatched outcome names", () => {
  const future = {
    future_key: "uefa-champions-league-team-to-reach-final",
    outcomes: [
      { name: "Arsenal", polymarket_market_id: "m1" },
      { name: "Garbage FC", polymarket_market_id: "m2" },
    ],
  };
  const r = evaluateFutureReadiness({ future, leagueCode: "ucl", catalog: uclCatalogStub() });
  assert.equal(r.template_available, true);
  assert.deepEqual(r.unmatched_names, ["Garbage FC"]);
  assert.equal(r.can_quick_publish, false);
});

test("buildQuickPublishEnvelope happy path fills defaults from seeded template", () => {
  const input = {
    environment: "dev",
    league_code: "epl",
    future_key: "english-premier-league-winner",
    polymarket_event_id: "33507",
    end_date: "2026-05-27T00:00:00Z",
    negRisk: true,
    outcomes: [
      { name: "Man City", polymarket_market_id: "m1" },
      { name: "Arsenal", polymarket_market_id: "m2" },
    ],
  };
  const result = buildQuickPublishEnvelope({ input });
  assert.equal(result.ok, true);
  assert.equal(result.envelope.season, "2026");
  assert.equal(result.envelope.mode, "single-winner");
  assert.equal(result.envelope.title, "EPL: League Winner");
  assert.equal(result.envelope.environment, "dev");
  assert.equal(result.envelope.selected_outcomes.length, 2);
  assert.ok(result.envelope.markets_open_time, "defaults markets_open_time to now");
  assert.ok(result.envelope.parent_rules.length > 0, "parent_rules populated from template");
  assert.match(result.envelope.market_code_template, /\{team\}/);
});

test("buildQuickPublishEnvelope auto-derives multi-winner when negRisk=false", () => {
  const input = {
    environment: "dev",
    league_code: "ucl",
    future_key: "uefa-champions-league-team-to-reach-final",
    polymarket_event_id: "100",
    end_date: "2026-05-30T20:00:00Z",
    negRisk: false,
    outcomes: [{ name: "Arsenal", polymarket_market_id: "m1" }],
  };
  const result = buildQuickPublishEnvelope({ input });
  assert.equal(result.ok, true);
  assert.equal(result.envelope.mode, "multi-winner");
});

test("buildQuickPublishEnvelope rejects when template is fallback", () => {
  const input = {
    environment: "dev",
    league_code: "epl",
    future_key: "made-up-future",
    polymarket_event_id: "9",
    end_date: "2026-05-30T00:00:00Z",
    negRisk: true,
    outcomes: [{ name: "Foo", polymarket_market_id: "m1" }],
  };
  const result = buildQuickPublishEnvelope({ input });
  assert.equal(result.ok, false);
  assert.deepEqual(result.issues, ["template_missing"]);
});

test("buildQuickPublishEnvelope rejects when required fields are missing", () => {
  const result = buildQuickPublishEnvelope({ input: { environment: "dev" } });
  assert.equal(result.ok, false);
  assert.ok(result.issues.includes("missing_league_code"));
  assert.ok(result.issues.includes("missing_future_key"));
  assert.ok(result.issues.includes("missing_polymarket_event_id"));
  assert.ok(result.issues.includes("missing_end_date"));
  assert.ok(result.issues.includes("missing_outcomes"));
});

test("buildQuickPublishEnvelope rejects when end_date can't be parsed", () => {
  const input = {
    environment: "dev",
    league_code: "epl",
    future_key: "english-premier-league-winner",
    polymarket_event_id: "1",
    end_date: "not-a-date",
    negRisk: true,
    outcomes: [{ name: "Man City", polymarket_market_id: "m1" }],
  };
  const result = buildQuickPublishEnvelope({ input });
  assert.equal(result.ok, false);
  assert.deepEqual(result.issues, ["invalid_end_date"]);
});

// ── isResolvedOutcome (multi-signal Polymarket resolved detection) ───────────

test("isResolvedOutcome catches closed=true", async () => {
  const { isResolvedOutcome } = await import("../src/backend/fixtureSources/polymarketFutures.js");
  assert.equal(isResolvedOutcome({ closed: true, active: true, accepting_orders: false }), true);
});

test("isResolvedOutcome catches acceptingOrders=false even when closed=false", async () => {
  const { isResolvedOutcome } = await import("../src/backend/fixtureSources/polymarketFutures.js");
  assert.equal(isResolvedOutcome({ closed: false, active: true, accepting_orders: false }), true);
});

test("isResolvedOutcome catches uma_status=resolved even when closed=false", async () => {
  const { isResolvedOutcome } = await import("../src/backend/fixtureSources/polymarketFutures.js");
  assert.equal(
    isResolvedOutcome({
      closed: false,
      active: true,
      accepting_orders: true,
      uma_status: "resolved",
    }),
    true
  );
});

test("isResolvedOutcome catches terminal price 0 *only when gated by another flag*", async () => {
  const { isResolvedOutcome } = await import("../src/backend/fixtureSources/polymarketFutures.js");
  // Terminal price + closed = resolved
  assert.equal(
    isResolvedOutcome({ closed: true, accepting_orders: false, outcome_prices: { yes: 0, no: 1 } }),
    true
  );
  // Terminal price 1 + closed = resolved
  assert.equal(
    isResolvedOutcome({ closed: true, accepting_orders: false, outcome_prices: { yes: 1, no: 0 } }),
    true
  );
  // Terminal price BUT still accepting orders and not closed → still live (don't hide a heavy favorite)
  assert.equal(
    isResolvedOutcome({
      closed: false,
      accepting_orders: true,
      outcome_prices: { yes: 0.9999, no: 0.0001 },
    }),
    false
  );
});

test("isResolvedOutcome leaves heavy favorites alone (Man United at 98%)", async () => {
  const { isResolvedOutcome } = await import("../src/backend/fixtureSources/polymarketFutures.js");
  // Real Polymarket Man United entry: closed=false, accepting_orders=true, uma=null, prices=0.9815
  assert.equal(
    isResolvedOutcome({
      closed: false,
      active: true,
      accepting_orders: true,
      uma_status: null,
      outcome_prices: { yes: 0.9815, no: 0.0185 },
    }),
    false
  );
});

test("isResolvedOutcome leaves longshots alone (Aston Villa at <1%)", async () => {
  const { isResolvedOutcome } = await import("../src/backend/fixtureSources/polymarketFutures.js");
  assert.equal(
    isResolvedOutcome({
      closed: false,
      active: true,
      accepting_orders: true,
      uma_status: null,
      outcome_prices: { yes: 0.0015, no: 0.9985 },
    }),
    false
  );
});

test("isResolvedOutcome returns false for placeholder (active=false, no prices)", async () => {
  const { isResolvedOutcome } = await import("../src/backend/fixtureSources/polymarketFutures.js");
  // Placeholders are NOT resolved — they're pre-launch. They're hidden by the
  // separate `active` filter, not by this helper.
  assert.equal(
    isResolvedOutcome({
      closed: false,
      active: false,
      accepting_orders: true,
      outcome_prices: null,
    }),
    false
  );
});

test("buildQuickPublishEnvelope honors explicit markets_open_time override", () => {
  const explicit = "2027-01-15T12:30:00.000Z";
  const input = {
    environment: "dev",
    league_code: "epl",
    future_key: "english-premier-league-winner",
    polymarket_event_id: "1",
    end_date: "2026-05-27T00:00:00Z",
    negRisk: true,
    markets_open_time: explicit,
    outcomes: [{ name: "Man City", polymarket_market_id: "m1" }],
  };
  const result = buildQuickPublishEnvelope({ input });
  assert.equal(result.ok, true);
  assert.equal(result.envelope.markets_open_time, explicit);
});
