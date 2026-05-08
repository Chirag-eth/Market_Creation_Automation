import test from "node:test";
import assert from "node:assert/strict";

import {
  buildCmsDbResultSnapshot,
  canonicalizeJson,
  classifyParentStatusFromRows,
  deriveCmsPublishKeyFromParentPayload,
  ensureUatOnly,
} from "../src/backend/cmsSelectedPublish.js";
import { InvalidIntegrationPayloadError } from "../src/backend/publisherCore.js";
import { buildCmsSelectedPreflight, executeCmsSelectedPublish, pollUntil } from "../server.js";

const SELECTED_FIXTURE = {
  game_id: "900003",
  event_name: "AFC Bournemouth vs Manchester United FC",
  fixture_date: "2026-04-25",
  kickoff_time_utc: "15:00",
  league_code: "epl",
};

const FIXTURE_PAYLOAD = {
  league_id: "epl-1",
  name: "Bournemouth vs Man Utd",
  home_team_id: "home-1",
  away_team_id: "away-1",
  game_start_time: "2026-04-25T15:00:00.000Z",
};

const TYPE_REFERENCE_PAYLOAD = {
  canonical_name: "bournemouth-vs-man-utd-2026-04-25",
};

function createMoneylinePayload() {
  return {
    parent_market: {
      league_id: "epl-1",
      type_reference_id: "",
      title: "Bournemouth vs Man Utd",
      parent_market_family: "moneyline",
      market_line: "0",
      rules: "Win market",
      is_cross_matching_enabled: false,
      markets_open_time: "2026-04-25T14:00:00.000Z",
    },
    markets: [
      {
        name: "Bournemouth",
        tick_size: 1,
        market_code: "moneyline-home",
        rules: "Home selection",
        team_id: "home-1",
      },
      {
        name: "Man Utd",
        tick_size: 1,
        market_code: "moneyline-away",
        rules: "Away selection",
        team_id: "away-1",
      },
    ],
  };
}

function createBttsPayload() {
  return {
    parent_market: {
      title: "Bournemouth vs Man Utd",
      parent_market_family: "btts",
      market_line: "0",
    },
    markets: [
      { name: "Yes", market_code: "btts-yes", tick_size: 1 },
      { name: "No", market_code: "btts-no", tick_size: 1 },
    ],
  };
}

function createTotalsPayload(line = "2.5") {
  return {
    parent_market: {
      league_id: "epl-1",
      type_reference_id: "",
      title: "Bournemouth vs Man Utd",
      parent_market_family: "totals",
      market_line: String(line),
      rules: "Totals market",
      is_cross_matching_enabled: false,
      markets_open_time: "2026-04-25T14:00:00.000Z",
    },
    markets: [
      {
        name: `Over ${line} Goals`,
        tick_size: 1,
        market_code: `totals-over-${line}`,
        rules: "Over selection",
      },
      {
        name: `Under ${line} Goals`,
        tick_size: 1,
        market_code: `totals-under-${line}`,
        rules: "Under selection",
      },
    ],
  };
}

function createSpreadsPayload({ line = "1.5", side = "home" } = {}) {
  return {
    parent_market: {
      league_id: "epl-1",
      type_reference_id: "",
      title: "Bournemouth vs Man Utd",
      parent_market_family: "spreads",
      market_line: `-${line}`,
      rules: "Spread market",
      is_cross_matching_enabled: false,
      markets_open_time: "2026-04-25T14:00:00.000Z",
    },
    markets: [
      {
        name: side === "home" ? `Bournemouth Over ${line} Goals` : `Man Utd Over ${line} Goals`,
        tick_size: 1,
        market_code: `spreads-${side}-${line}`,
        rules: "Spread selection",
        team_id: side === "home" ? "home-1" : "away-1",
      },
    ],
  };
}

function createEnvelope({
  selectedPublishItems = [],
  providedTypeReferenceId = "",
  manualQuery = "",
  forceRepublish = false,
} = {}) {
  return {
    requestedAt: "2026-04-09T12:00:00.000Z",
    body: {
      request_id: "req-1",
    },
    dryRun: false,
    mockResponses: null,
    environment: { code: "uat", label: "UAT" },
    environmentRecord: {
      profile: { code: "uat" },
    },
    payload: {
      selected_fixture: manualQuery ? {} : SELECTED_FIXTURE,
      manual_query: manualQuery,
      type_reference_id: providedTypeReferenceId,
      fixture_payload: FIXTURE_PAYLOAD,
      type_reference_payload: TYPE_REFERENCE_PAYLOAD,
      selected_publish_items: selectedPublishItems.map((item) => ({
        publish_key: item.publish_key,
        parent_market_payload: item.parent_market_payload,
      })),
      force_republish: forceRepublish,
    },
  };
}

function createPool(queryImpl) {
  return {
    async query(sql, params) {
      return queryImpl(String(sql || ""), Array.isArray(params) ? params : []);
    },
  };
}

function createPoolWithVaultRouter(queryImpl, vaultRows = []) {
  const rows = vaultRows.map((r) => ({ ...r }));
  return {
    async query(sql, params) {
      return queryImpl(String(sql || ""), Array.isArray(params) ? params : []);
    },
    async connect() {
      return {
        async query(sql, params = []) {
          const t = String(sql || "").trim();
          if (/^BEGIN/i.test(t) || /^COMMIT/i.test(t) || /^ROLLBACK/i.test(t)) {
            return { rows: [] };
          }
          if (t.includes("pg_advisory_xact_lock")) return { rows: [] };
          if (
            t.includes("SELECT vault_num FROM fixture_vault_assignments") &&
            t.includes("WHERE fixture_id = $1")
          ) {
            const found = rows.find((r) => r.fixture_id === params[0]);
            return { rows: found ? [{ vault_num: found.vault_num }] : [] };
          }
          if (t.includes("SELECT vault_num, COUNT(*)")) {
            const counts = new Map();
            for (const r of rows) {
              if (r.game_start_time === params[0]) {
                counts.set(r.vault_num, (counts.get(r.vault_num) || 0) + 1);
              }
            }
            return {
              rows: [...counts.entries()].map(([vault_num, c]) => ({ vault_num, c })),
            };
          }
          if (t.startsWith("INSERT INTO fixture_vault_assignments")) {
            const [fid, startTime, candidate] = params;
            rows.push({
              fixture_id: fid,
              game_start_time: startTime,
              vault_num: candidate,
            });
            return { rows: [{ vault_num: candidate }] };
          }
          throw new Error(`mock vault client: unexpected SQL: ${t}`);
        },
        release() {},
      };
    },
    _vaultRows: rows,
  };
}

function createParentMarketRows({
  payload,
  parentMarketId = "pm-1",
  typeReferenceId = "tr-1",
} = {}) {
  const normalized = payload || createMoneylinePayload();
  return (Array.isArray(normalized.markets) ? normalized.markets : []).map((market, index) => ({
    parent_market_id: parentMarketId,
    type_reference_id: typeReferenceId,
    title: normalized.parent_market?.title || "Fixture",
    parent_market_family: normalized.parent_market?.parent_market_family || "",
    market_line: normalized.parent_market?.market_line || "0",
    parent_rules: normalized.parent_market?.rules || "",
    is_cross_matching_enabled: Boolean(normalized.parent_market?.is_cross_matching_enabled),
    markets_open_time: normalized.parent_market?.markets_open_time || "",
    league_id: normalized.parent_market?.league_id || "",
    market_id: `${parentMarketId}-m${index + 1}`,
    market_name: market.name,
    tick_size: market.tick_size,
    market_code: market.market_code,
    market_rules: market.rules || "",
    team_id: market.team_id || "",
  }));
}

function createResolvedFixture() {
  return {
    gameId: SELECTED_FIXTURE.game_id,
    game_id: SELECTED_FIXTURE.game_id,
    eventName: SELECTED_FIXTURE.event_name,
    fixtureDate: SELECTED_FIXTURE.fixture_date,
    kickoffTimeUtc: SELECTED_FIXTURE.kickoff_time_utc,
    league_code: SELECTED_FIXTURE.league_code,
  };
}

const FIXTURE_RECORD = {
  fixture_id: "fixture-1",
  name: FIXTURE_PAYLOAD.name,
  league_id: FIXTURE_PAYLOAD.league_id,
  home_team_id: FIXTURE_PAYLOAD.home_team_id,
  away_team_id: FIXTURE_PAYLOAD.away_team_id,
  game_start_time: FIXTURE_PAYLOAD.game_start_time,
};

const TYPE_REFERENCE_RECORD = {
  type_reference_id: "tr-1",
  type_value_id: FIXTURE_RECORD.fixture_id,
  canonical_name: TYPE_REFERENCE_PAYLOAD.canonical_name,
};

test("selected publish keys derive exact moneyline, btts, totals, and spreads variants", () => {
  assert.equal(
    deriveCmsPublishKeyFromParentPayload(createMoneylinePayload(), {
      selectedFixture: FIXTURE_PAYLOAD,
    }),
    "moneyline|0"
  );
  assert.equal(
    deriveCmsPublishKeyFromParentPayload(createBttsPayload(), {
      selectedFixture: FIXTURE_PAYLOAD,
    }),
    "btts|0"
  );
  assert.equal(
    deriveCmsPublishKeyFromParentPayload(createTotalsPayload("2.5"), {
      selectedFixture: FIXTURE_PAYLOAD,
    }),
    "totals|2.5"
  );
  assert.equal(
    deriveCmsPublishKeyFromParentPayload(createSpreadsPayload({ line: "1.5", side: "home" }), {
      selectedFixture: FIXTURE_PAYLOAD,
      fixturePayload: FIXTURE_PAYLOAD,
    }),
    "spreads|1.5|home"
  );
  assert.equal(
    deriveCmsPublishKeyFromParentPayload(createSpreadsPayload({ line: "2.5", side: "away" }), {
      selectedFixture: FIXTURE_PAYLOAD,
      fixturePayload: FIXTURE_PAYLOAD,
    }),
    "spreads|2.5|away"
  );
});

test("canonical JSON comparison ignores key order but still detects real payload changes", () => {
  const base = {
    parent_market: {
      title: "Fixture",
      parent_market_family: "totals",
      market_line: "2.5",
      rules: "Totals",
    },
    markets: [
      { market_code: "over", name: "Over 2.5 Goals", tick_size: 1 },
      { market_code: "under", name: "Under 2.5 Goals", tick_size: 1 },
    ],
  };
  const reordered = {
    markets: [
      { tick_size: 1, name: "Over 2.5 Goals", market_code: "over" },
      { tick_size: 1, name: "Under 2.5 Goals", market_code: "under" },
    ],
    parent_market: {
      rules: "Totals",
      market_line: "2.5",
      title: "Fixture",
      parent_market_family: "totals",
      ignored: undefined,
    },
  };
  const changed = {
    ...base,
    markets: [
      { market_code: "over", name: "Over 3.5 Goals", tick_size: 1 },
      { market_code: "under", name: "Under 3.5 Goals", tick_size: 1 },
    ],
  };

  assert.equal(canonicalizeJson(base), canonicalizeJson(reordered));
  assert.notEqual(canonicalizeJson(base), canonicalizeJson(changed));
});

test("pollUntil succeeds after delayed visibility and returns null on timeout", async () => {
  let attempts = 0;
  const found = await pollUntil({
    attempts: 4,
    delayMs: 0,
    fn: async () => {
      attempts += 1;
      return attempts >= 3 ? { id: "visible" } : null;
    },
  });
  assert.deepEqual(found, { id: "visible" });
  assert.equal(attempts, 3);

  let missAttempts = 0;
  const missing = await pollUntil({
    attempts: 3,
    delayMs: 0,
    fn: async () => {
      missAttempts += 1;
      return null;
    },
  });
  assert.equal(missing, null);
  assert.equal(missAttempts, 3);
});

test("preflight classifies selectable, existing, half-prepared, and blocked publish slots", async () => {
  const resolveFixtureCandidate = async () => createResolvedFixture();
  const baseQuery = (parentRows = []) =>
    createPool(async (sql, params) => {
      if (sql.includes("FROM fixtures")) {
        return { rows: [FIXTURE_RECORD] };
      }
      if (sql.includes("FROM type_references") && sql.includes("WHERE type_value_id")) {
        return { rows: [TYPE_REFERENCE_RECORD] };
      }
      if (sql.includes("FROM parent_markets pm")) {
        assert.equal(params[0], TYPE_REFERENCE_RECORD.type_reference_id);
        return { rows: parentRows };
      }
      return { rows: [] };
    });

  const selectablePreflight = await buildCmsSelectedPreflight({
    envelope: createEnvelope({
      selectedPublishItems: [
        { publish_key: "moneyline|0", parent_market_payload: createMoneylinePayload() },
      ],
    }),
    config: {},
    pool: baseQuery([]),
    resolveFixtureCandidate,
  });
  assert.equal(selectablePreflight.preflightItems[0]?.status, "selectable");

  const existingRows = createParentMarketRows({
    payload: createMoneylinePayload(),
  });
  const existingPreflight = await buildCmsSelectedPreflight({
    envelope: createEnvelope({
      selectedPublishItems: [
        { publish_key: "moneyline|0", parent_market_payload: createMoneylinePayload() },
      ],
    }),
    config: {},
    pool: baseQuery(existingRows),
    resolveFixtureCandidate,
  });
  assert.equal(existingPreflight.preflightItems[0]?.status, "existing");

  const halfPreparedRows = [
    {
      ...existingRows[0],
      market_id: null,
    },
  ];
  const halfPreparedPreflight = await buildCmsSelectedPreflight({
    envelope: createEnvelope({
      selectedPublishItems: [
        { publish_key: "moneyline|0", parent_market_payload: createMoneylinePayload() },
      ],
    }),
    config: {},
    pool: baseQuery(halfPreparedRows),
    resolveFixtureCandidate,
  });
  assert.equal(halfPreparedPreflight.preflightItems[0]?.status, "half_prepared");

  const blockedPreflight = await buildCmsSelectedPreflight({
    envelope: createEnvelope({
      forceRepublish: true,
      selectedPublishItems: [
        { publish_key: "moneyline|0", parent_market_payload: createMoneylinePayload() },
      ],
    }),
    config: {},
    pool: baseQuery(existingRows),
    resolveFixtureCandidate,
  });
  assert.equal(blockedPreflight.preflightItems[0]?.status, "blocked");
});

test("preflight rejects skip mode when the provided type reference belongs to another fixture", async () => {
  const pool = createPool(async (sql) => {
    if (sql.includes("FROM fixtures")) {
      return { rows: [FIXTURE_RECORD] };
    }
    if (sql.includes("WHERE type_reference_id = $1 LIMIT 5")) {
      return {
        rows: [
          {
            type_reference_id: "tr-other",
            type_value_id: "fixture-2",
            canonical_name: TYPE_REFERENCE_PAYLOAD.canonical_name,
          },
        ],
      };
    }
    return { rows: [] };
  });

  await assert.rejects(
    () =>
      buildCmsSelectedPreflight({
        envelope: createEnvelope({
          providedTypeReferenceId: "tr-other",
          selectedPublishItems: [
            { publish_key: "moneyline|0", parent_market_payload: createMoneylinePayload() },
          ],
        }),
        config: {},
        pool,
        resolveFixtureCandidate: async () => createResolvedFixture(),
      }),
    (error) => {
      assert.ok(error instanceof InvalidIntegrationPayloadError);
      assert.match(String(error.message || ""), /does not belong to the selected fixture/i);
      assert.deepEqual(error.issues, ["payload.type_reference_id"]);
      return true;
    }
  );
});

test("executeCmsSelectedPublish runs full publish from scratch in sequence and waits for DB visibility", async () => {
  let fixtureLookupCount = 0;
  let typeReferenceLookupCount = 0;
  let publishedParentCount = 0;
  const parentPayloads = [];
  const steps = [];
  const moneylineRows = createParentMarketRows({
    payload: createMoneylinePayload(),
    parentMarketId: "pm-moneyline",
    typeReferenceId: TYPE_REFERENCE_RECORD.type_reference_id,
  });
  const totalsRows = createParentMarketRows({
    payload: createTotalsPayload("2.5"),
    parentMarketId: "pm-totals",
    typeReferenceId: TYPE_REFERENCE_RECORD.type_reference_id,
  });

  const pool = createPool(async (sql) => {
    if (sql.includes("FROM fixtures")) {
      fixtureLookupCount += 1;
      return { rows: fixtureLookupCount >= 2 ? [FIXTURE_RECORD] : [] };
    }
    if (sql.includes("FROM type_references") && sql.includes("WHERE type_value_id")) {
      typeReferenceLookupCount += 1;
      return { rows: typeReferenceLookupCount >= 2 ? [TYPE_REFERENCE_RECORD] : [] };
    }
    if (sql.includes("FROM parent_markets pm")) {
      if (publishedParentCount <= 0) {
        return { rows: [] };
      }
      if (publishedParentCount === 1) {
        return { rows: moneylineRows };
      }
      return { rows: [...moneylineRows, ...totalsRows] };
    }
    return { rows: [] };
  });

  const result = await executeCmsSelectedPublish({
    envelope: createEnvelope({
      selectedPublishItems: [
        { publish_key: "moneyline|0", parent_market_payload: createMoneylinePayload() },
        { publish_key: "totals|2.5", parent_market_payload: createTotalsPayload("2.5") },
      ],
    }),
    config: {},
    pool,
    pollUntilFn: ({ fn, attempts }) => pollUntil({ fn, attempts, delayMs: 0 }),
    createRunIdFn: () => "run-full-flow",
    publishFixtureFn: async ({ fixturePayload }) => {
      steps.push(`fixture:${fixturePayload.name}`);
      return { ok: true, steps: [{ key: "fixture" }] };
    },
    publishTypeReferenceFn: async ({ typeReferencePayload }) => {
      steps.push(`type_ref:${typeReferencePayload.canonical_name}`);
      return { ok: true, steps: [{ key: "type_reference" }] };
    },
    publishParentMarketFn: async ({ parentMarketPayload }) => {
      publishedParentCount += 1;
      parentPayloads.push(parentMarketPayload);
      steps.push(
        `parent:${parentMarketPayload.parent_market.parent_market_family}:${parentMarketPayload.parent_market.market_line}`
      );
      return { ok: true, steps: [{ key: "parent_market" }] };
    },
    runStore: new Map(),
    preflight: await buildCmsSelectedPreflight({
      envelope: createEnvelope({
        selectedPublishItems: [
          { publish_key: "moneyline|0", parent_market_payload: createMoneylinePayload() },
          { publish_key: "totals|2.5", parent_market_payload: createTotalsPayload("2.5") },
        ],
      }),
      config: {},
      pool,
      resolveFixtureCandidate: async () => createResolvedFixture(),
    }),
  });

  assert.equal(result.runRecord.status, "completed");
  assert.deepEqual(steps, [
    "fixture:Bournemouth vs Man Utd",
    "type_ref:bournemouth-vs-man-utd-2026-04-25",
    "parent:moneyline:0",
    "parent:totals:2.5",
  ]);
  assert.deepEqual(
    parentPayloads.map((payload) => String(payload?.parent_market?.type_reference_id || "")),
    [TYPE_REFERENCE_RECORD.type_reference_id, TYPE_REFERENCE_RECORD.type_reference_id]
  );
  assert.equal(result.runRecord.aggregate.published, 2);
  assert.equal(result.runRecord.step_results.fixture?.status, "created");
  assert.equal(result.runRecord.step_results.type_reference?.status, "created");
  assert.equal(result.runRecord.parent_market_results["moneyline|0"]?.status, "published");
  assert.equal(result.runRecord.parent_market_results["totals|2.5"]?.status, "published");
  assert.match(String(result.runRecord.summary || ""), /Publish completed/i);
  assert.match(
    String(result.runRecord.detail || ""),
    /Created fixture, type reference, and 2 selected market/i
  );
});

test("executeCmsSelectedPublish skips fixture and type-reference publishes when type_reference_id is provided", async () => {
  const publishCalls = [];
  let publishedRows = [];
  const pool = createPool(async (sql) => {
    if (sql.includes("FROM fixtures")) {
      return { rows: [FIXTURE_RECORD] };
    }
    if (sql.includes("WHERE type_reference_id = $1 LIMIT 5")) {
      return { rows: [TYPE_REFERENCE_RECORD] };
    }
    if (sql.includes("FROM parent_markets pm")) {
      return { rows: publishedRows };
    }
    return { rows: [] };
  });

  const result = await executeCmsSelectedPublish({
    envelope: createEnvelope({
      providedTypeReferenceId: TYPE_REFERENCE_RECORD.type_reference_id,
      selectedPublishItems: [
        { publish_key: "moneyline|0", parent_market_payload: createMoneylinePayload() },
      ],
    }),
    config: {},
    pool,
    pollUntilFn: ({ fn, attempts }) => pollUntil({ fn, attempts, delayMs: 0 }),
    createRunIdFn: () => "run-skip-flow",
    publishFixtureFn: async () => {
      publishCalls.push("fixture");
      return { ok: true, steps: [{ key: "fixture" }] };
    },
    publishTypeReferenceFn: async () => {
      publishCalls.push("type_reference");
      return { ok: true, steps: [{ key: "type_reference" }] };
    },
    publishParentMarketFn: async ({ parentMarketPayload }) => {
      publishCalls.push(parentMarketPayload.parent_market.parent_market_family);
      publishedRows = createParentMarketRows({
        payload: parentMarketPayload,
        parentMarketId: "pm-skip-flow",
        typeReferenceId: TYPE_REFERENCE_RECORD.type_reference_id,
      });
      return { ok: true, steps: [{ key: "parent_market" }] };
    },
    runStore: new Map(),
    preflight: await buildCmsSelectedPreflight({
      envelope: createEnvelope({
        providedTypeReferenceId: TYPE_REFERENCE_RECORD.type_reference_id,
        selectedPublishItems: [
          { publish_key: "moneyline|0", parent_market_payload: createMoneylinePayload() },
        ],
      }),
      config: {},
      pool,
      resolveFixtureCandidate: async () => createResolvedFixture(),
    }),
  });

  assert.deepEqual(publishCalls, ["moneyline"]);
  assert.equal(result.runRecord.step_results.fixture?.status, "skipped");
  assert.equal(result.runRecord.step_results.type_reference?.status, "skipped");
  assert.equal(result.runRecord.parent_market_results["moneyline|0"]?.status, "published");
  assert.match(String(result.runRecord.detail || ""), /Used existing type reference/i);
});

test("executeCmsSelectedPublish blocks unchanged force republish and allows changed payloads", async () => {
  const existingRows = createParentMarketRows({
    payload: createMoneylinePayload(),
    parentMarketId: "pm-existing",
    typeReferenceId: TYPE_REFERENCE_RECORD.type_reference_id,
  });
  const changedMoneylinePayload = {
    ...createMoneylinePayload(),
    parent_market: {
      ...createMoneylinePayload().parent_market,
      rules: "Updated moneyline rules",
    },
  };
  const publishes = [];
  const pool = createPool(async (sql) => {
    if (sql.includes("FROM fixtures")) {
      return { rows: [FIXTURE_RECORD] };
    }
    if (sql.includes("FROM type_references") && sql.includes("WHERE type_value_id")) {
      return { rows: [TYPE_REFERENCE_RECORD] };
    }
    if (sql.includes("FROM parent_markets pm")) {
      return { rows: existingRows };
    }
    return { rows: [] };
  });

  // UAT republish stubs: fixture exists in DB so the republish path re-POSTs with match_day+1.
  // FIXTURE_RECORD has no match_day so uatRepublishMatchDay = 0 + 1 = 1.
  const stubFixtureFn = async () => ({
    ok: true,
    steps: [{ key: "fixture", response: { fixture_id: "fixture-republish" } }],
  });
  const stubTypeRefFn = async () => ({
    ok: true,
    steps: [{ key: "type_reference", response: { type_reference_id: "tr-republish" } }],
  });

  const unchangedResult = await executeCmsSelectedPublish({
    envelope: createEnvelope({
      forceRepublish: true,
      selectedPublishItems: [
        { publish_key: "moneyline|0", parent_market_payload: createMoneylinePayload() },
      ],
    }),
    config: {},
    pool,
    publishFixtureFn: stubFixtureFn,
    publishTypeReferenceFn: stubTypeRefFn,
    publishParentMarketFn: async () => {
      publishes.push("unchanged");
      return { ok: true, steps: [{ key: "parent_market" }] };
    },
    runStore: new Map(),
    preflight: await buildCmsSelectedPreflight({
      envelope: createEnvelope({
        forceRepublish: true,
        selectedPublishItems: [
          { publish_key: "moneyline|0", parent_market_payload: createMoneylinePayload() },
        ],
      }),
      config: {},
      pool,
      resolveFixtureCandidate: async () => createResolvedFixture(),
    }),
  });

  assert.equal(unchangedResult.runRecord.parent_market_results["moneyline|0"]?.status, "blocked");
  assert.deepEqual(publishes, []);

  const changedResult = await executeCmsSelectedPublish({
    envelope: createEnvelope({
      forceRepublish: true,
      selectedPublishItems: [
        { publish_key: "moneyline|0", parent_market_payload: changedMoneylinePayload },
      ],
    }),
    config: {},
    pool,
    pollUntilFn: async () => existingRows,
    publishFixtureFn: stubFixtureFn,
    publishTypeReferenceFn: stubTypeRefFn,
    publishParentMarketFn: async ({ parentMarketPayload }) => {
      publishes.push(String(parentMarketPayload.parent_market.rules || ""));
      return { ok: true, steps: [{ key: "parent_market" }] };
    },
    runStore: new Map(),
    preflight: await buildCmsSelectedPreflight({
      envelope: createEnvelope({
        forceRepublish: true,
        selectedPublishItems: [
          { publish_key: "moneyline|0", parent_market_payload: changedMoneylinePayload },
        ],
      }),
      config: {},
      pool,
      resolveFixtureCandidate: async () => createResolvedFixture(),
    }),
  });

  // UAT republish appends [Match Day 1] to parent market rules (match_day 0→1 from DB record).
  assert.deepEqual(publishes, ["Updated moneyline rules [Match Day 1]"]);
  assert.equal(changedResult.runRecord.parent_market_results["moneyline|0"]?.status, "published");
});

test("executeCmsSelectedPublish keeps publishing later parent markets after an intermediate failure", async () => {
  let publishCount = 0;
  let successfulRows = [];
  const moneylineRows = createParentMarketRows({
    payload: createMoneylinePayload(),
    parentMarketId: "pm-moneyline",
    typeReferenceId: TYPE_REFERENCE_RECORD.type_reference_id,
  });
  const totalsRows = createParentMarketRows({
    payload: createTotalsPayload("3.5"),
    parentMarketId: "pm-totals-35",
    typeReferenceId: TYPE_REFERENCE_RECORD.type_reference_id,
  });
  const callOrder = [];
  const pool = createPool(async (sql) => {
    if (sql.includes("FROM fixtures")) {
      return { rows: [FIXTURE_RECORD] };
    }
    if (sql.includes("WHERE type_reference_id = $1 LIMIT 5")) {
      return { rows: [TYPE_REFERENCE_RECORD] };
    }
    if (sql.includes("FROM parent_markets pm")) {
      return { rows: successfulRows };
    }
    return { rows: [] };
  });

  const result = await executeCmsSelectedPublish({
    envelope: createEnvelope({
      providedTypeReferenceId: TYPE_REFERENCE_RECORD.type_reference_id,
      selectedPublishItems: [
        { publish_key: "moneyline|0", parent_market_payload: createMoneylinePayload() },
        { publish_key: "totals|2.5", parent_market_payload: createTotalsPayload("2.5") },
        { publish_key: "totals|3.5", parent_market_payload: createTotalsPayload("3.5") },
      ],
    }),
    config: {},
    pool,
    pollUntilFn: ({ fn, attempts }) => pollUntil({ fn, attempts, delayMs: 0 }),
    createRunIdFn: () => "run-partial",
    publishParentMarketFn: async ({ parentMarketPayload }) => {
      publishCount += 1;
      const key = `${parentMarketPayload.parent_market.parent_market_family}|${String(parentMarketPayload.parent_market.market_line || "0").replace(/^-/, "")}`;
      callOrder.push(key);
      if (publishCount === 1) {
        successfulRows = moneylineRows;
        return { ok: true, steps: [{ key: "parent_market" }] };
      }
      if (publishCount === 2) {
        throw new Error("Parent market 2 failed");
      }
      successfulRows = [...moneylineRows, ...totalsRows];
      return { ok: true, steps: [{ key: "parent_market" }] };
    },
    runStore: new Map(),
    preflight: await buildCmsSelectedPreflight({
      envelope: createEnvelope({
        providedTypeReferenceId: TYPE_REFERENCE_RECORD.type_reference_id,
        selectedPublishItems: [
          { publish_key: "moneyline|0", parent_market_payload: createMoneylinePayload() },
          { publish_key: "totals|2.5", parent_market_payload: createTotalsPayload("2.5") },
          { publish_key: "totals|3.5", parent_market_payload: createTotalsPayload("3.5") },
        ],
      }),
      config: {},
      pool,
      resolveFixtureCandidate: async () => createResolvedFixture(),
    }),
  });

  assert.deepEqual(callOrder, ["moneyline|0", "totals|2.5", "totals|3.5"]);
  assert.equal(result.runRecord.status, "partial");
  assert.equal(result.runRecord.parent_market_results["moneyline|0"]?.status, "published");
  assert.equal(result.runRecord.parent_market_results["totals|2.5"]?.status, "failed");
  assert.equal(result.runRecord.parent_market_results["totals|3.5"]?.status, "published");
  assert.equal(result.runRecord.aggregate.published, 2);
  assert.equal(result.runRecord.aggregate.failed, 1);
  assert.match(String(result.runRecord.summary || ""), /Publish partially completed/i);
});

test("executeCmsSelectedPublish waits through transient half-prepared parent-market rows before marking publish complete", async () => {
  let parentQueryReads = 0;
  const finalRows = createParentMarketRows({
    payload: createMoneylinePayload(),
    parentMarketId: "pm-stable",
    typeReferenceId: TYPE_REFERENCE_RECORD.type_reference_id,
  });
  const transientRows = finalRows.map((row) => ({
    ...row,
    market_id: null,
  }));

  const pool = createPool(async (sql) => {
    if (sql.includes("FROM fixtures")) {
      return { rows: [FIXTURE_RECORD] };
    }
    if (sql.includes("WHERE type_reference_id = $1 LIMIT 5")) {
      return { rows: [TYPE_REFERENCE_RECORD] };
    }
    if (sql.includes("FROM parent_markets pm")) {
      parentQueryReads += 1;
      if (parentQueryReads === 1) {
        return { rows: [] };
      }
      return { rows: parentQueryReads < 3 ? transientRows : finalRows };
    }
    return { rows: [] };
  });

  const result = await executeCmsSelectedPublish({
    envelope: createEnvelope({
      providedTypeReferenceId: TYPE_REFERENCE_RECORD.type_reference_id,
      selectedPublishItems: [
        { publish_key: "moneyline|0", parent_market_payload: createMoneylinePayload() },
      ],
    }),
    config: {},
    pool,
    pollUntilFn: ({ fn, attempts }) => pollUntil({ fn, attempts, delayMs: 0 }),
    publishParentMarketFn: async () => ({ ok: true, steps: [{ key: "parent_market" }] }),
    runStore: new Map(),
    preflight: await buildCmsSelectedPreflight({
      envelope: createEnvelope({
        providedTypeReferenceId: TYPE_REFERENCE_RECORD.type_reference_id,
        selectedPublishItems: [
          { publish_key: "moneyline|0", parent_market_payload: createMoneylinePayload() },
        ],
      }),
      config: {},
      pool,
      resolveFixtureCandidate: async () => createResolvedFixture(),
    }),
  });

  assert.ok(parentQueryReads >= 3);
  assert.equal(result.runRecord.parent_market_results["moneyline|0"]?.status, "published");
});

test("executeCmsSelectedPublish takes the fixtures/create shortcut when provider maps to a CMS source", async () => {
  const fetchCalls = [];
  const originalFetch = global.fetch;
  global.fetch = async (url, init) => {
    fetchCalls.push({ url: String(url), init });
    return {
      ok: true,
      status: 200,
      headers: new Map(),
      text: async () => JSON.stringify({ fixture_id: "fx-shortcut" }),
    };
  };

  try {
    const baseEnvelope = createEnvelope({
      selectedPublishItems: [
        { publish_key: "moneyline|0", parent_market_payload: createMoneylinePayload() },
        { publish_key: "totals|2.5", parent_market_payload: createTotalsPayload("2.5") },
      ],
    });
    const envelope = {
      ...baseEnvelope,
      payload: {
        ...baseEnvelope.payload,
        selected_fixture: { ...SELECTED_FIXTURE, provider: "sportsdata" },
      },
    };

    const result = await executeCmsSelectedPublish({
      envelope,
      config: {
        baseUrl: "https://cms.test",
        bearerToken: "tok-123",
        timeoutMs: 5000,
      },
      runStore: new Map(),
      createRunIdFn: () => "run-shortcut",
      preflight: {
        preflightItems: [
          {
            publish_key: "moneyline|0",
            status: "selectable",
            parent_market_payload: createMoneylinePayload(),
          },
          {
            publish_key: "totals|2.5",
            status: "selectable",
            parent_market_payload: createTotalsPayload("2.5"),
          },
        ],
      },
    });

    assert.equal(fetchCalls.length, 1);
    const call = fetchCalls[0];
    assert.equal(call.url, "https://cms.test/api/v1/cms/internal/fixtures/create");
    assert.equal(call.init.method, "POST");
    assert.equal(call.init.headers.Authorization, "Bearer tok-123");
    assert.equal(call.init.headers["Content-Type"], "application/json");

    const body = JSON.parse(call.init.body);
    assert.equal(body.game_id, "900003");
    assert.equal(body.source, "sports_data");
    assert.deepEqual([...body.parent_markets].sort(), ["moneyline", "totals_2.5"]);
    assert.equal(body.cname, "epl-afc-bournemouth-manchester-united-fc-2026-04-25");
    assert.equal(body.appendix, "");

    assert.equal(result.runRecord.status, "completed");
    assert.equal(result.runRecord.step_results.fixture?.status, "skipped");
    assert.equal(result.runRecord.step_results.type_reference?.status, "skipped");
    assert.equal(result.runRecord.parent_market_results["moneyline|0"]?.status, "published");
    assert.equal(result.runRecord.parent_market_results["totals|2.5"]?.status, "published");
    assert.equal(result.runRecord.aggregate.published, 2);
    assert.equal(result.runRecord.aggregate.failed, 0);
    assert.match(String(result.runRecord.detail || ""), /via fixtures\/create/i);
    assert.deepEqual(result.runRecord.response, { fixture_id: "fx-shortcut" });
  } finally {
    global.fetch = originalFetch;
  }
});

test("executeCmsSelectedPublish marks all selectable items failed when fixtures/create errors", async () => {
  const originalFetch = global.fetch;
  global.fetch = async () => ({
    ok: false,
    status: 500,
    headers: new Map(),
    text: async () => JSON.stringify({ error: "boom" }),
  });

  try {
    const baseEnvelope = createEnvelope({
      selectedPublishItems: [
        { publish_key: "moneyline|0", parent_market_payload: createMoneylinePayload() },
      ],
    });
    const envelope = {
      ...baseEnvelope,
      payload: {
        ...baseEnvelope.payload,
        selected_fixture: { ...SELECTED_FIXTURE, provider: "lsports-db" },
      },
    };

    const result = await executeCmsSelectedPublish({
      envelope,
      config: { baseUrl: "https://cms.test", bearerToken: "tok", timeoutMs: 5000 },
      runStore: new Map(),
      createRunIdFn: () => "run-shortcut-fail",
      preflight: {
        preflightItems: [
          {
            publish_key: "moneyline|0",
            status: "selectable",
            parent_market_payload: createMoneylinePayload(),
          },
        ],
      },
    });

    assert.equal(result.runRecord.status, "failed");
    assert.equal(result.runRecord.step_results.fixture?.status, "skipped");
    assert.equal(result.runRecord.step_results.type_reference?.status, "skipped");
    assert.equal(result.runRecord.parent_market_results["moneyline|0"]?.status, "failed");
    assert.equal(result.runRecord.aggregate.failed, 1);
    assert.equal(result.runRecord.aggregate.published, 0);
  } finally {
    global.fetch = originalFetch;
  }
});

const VAULT_CONFIG_ENABLED = {
  enabled: true,
  host: "https://vault.test",
  endpoint: "https://vault.test/api/v1/polymarket/sync-fixture",
  timeoutMs: 5_000,
  retryCount: 0,
  dryRun: false,
};

test("vault sync runs after a successful legacy publish when polymarket fields are present", async () => {
  const fetchCalls = [];
  const originalFetch = global.fetch;
  global.fetch = async (url, init) => {
    fetchCalls.push({ url: String(url), init });
    return {
      ok: true,
      status: 200,
      headers: new Map(),
      text: async () =>
        JSON.stringify({ status: "matched", sync_posted: 2, sync_already_exists: 0 }),
    };
  };

  const moneylineRows = createParentMarketRows({
    payload: createMoneylinePayload(),
    parentMarketId: "pm-moneyline",
    typeReferenceId: TYPE_REFERENCE_RECORD.type_reference_id,
  });

  let fixtureLookupCount = 0;
  let typeRefLookupCount = 0;
  let parentRowsServed = false;
  const pool = createPoolWithVaultRouter(async (sql) => {
    if (sql.includes("FROM fixtures")) {
      fixtureLookupCount += 1;
      return { rows: fixtureLookupCount >= 2 ? [FIXTURE_RECORD] : [] };
    }
    if (sql.includes("FROM type_references") && sql.includes("WHERE type_value_id")) {
      typeRefLookupCount += 1;
      return { rows: typeRefLookupCount >= 2 ? [TYPE_REFERENCE_RECORD] : [] };
    }
    if (sql.includes("FROM parent_markets pm")) {
      parentRowsServed = true;
      return { rows: parentRowsServed ? moneylineRows : [] };
    }
    return { rows: [] };
  });

  try {
    const baseEnvelope = createEnvelope({
      selectedPublishItems: [
        { publish_key: "moneyline|0", parent_market_payload: createMoneylinePayload() },
      ],
    });
    const envelope = {
      ...baseEnvelope,
      payload: {
        ...baseEnvelope.payload,
        selected_fixture: {
          ...SELECTED_FIXTURE,
          polymarket_event_id: "epl-bournemouth-vs-man-utd-2026-04-25",
        },
      },
    };

    const result = await executeCmsSelectedPublish({
      envelope,
      config: {},
      vaultConfig: VAULT_CONFIG_ENABLED,
      pool,
      pollUntilFn: ({ fn, attempts }) => pollUntil({ fn, attempts, delayMs: 0 }),
      createRunIdFn: () => "run-vault-success",
      publishFixtureFn: async () => ({ ok: true }),
      publishTypeReferenceFn: async () => ({ ok: true }),
      publishParentMarketFn: async () => ({ ok: true }),
      runStore: new Map(),
      preflight: await buildCmsSelectedPreflight({
        envelope: createEnvelope({
          selectedPublishItems: [
            { publish_key: "moneyline|0", parent_market_payload: createMoneylinePayload() },
          ],
        }),
        config: {},
        pool,
        resolveFixtureCandidate: async () => createResolvedFixture(),
      }),
    });

    assert.equal(result.runRecord.status, "completed");
    assert.equal(result.runRecord.aggregate.published, 1);
    // Vault sync was triggered against the configured endpoint.
    const vaultCall = fetchCalls.find((c) => c.url.includes("/api/v1/polymarket/sync-fixture"));
    assert.ok(vaultCall, "vault sync POST happened");
    const body = JSON.parse(vaultCall.init.body);
    assert.equal(
      body.polymarket_url,
      `https://polymarket.com/market/${encodeURIComponent("epl-bournemouth-vs-man-utd-2026-04-25")}`
    );
    assert.equal(body.cms_fixture_id, FIXTURE_RECORD.fixture_id);
    assert.equal(body.vault, 1); // empty bucket → vault 1
    assert.equal(body.dry_run, false);
    // Run record reflects the vault sync result.
    assert.equal(result.runRecord.vault_sync?.status, "completed");
    assert.equal(result.runRecord.vault_sync?.vault, 1);
    assert.equal(result.runRecord.vault_sync?.sync_posted, 2);
  } finally {
    global.fetch = originalFetch;
  }
});

test("vault sync is skipped when no polymarket coordinates are present", async () => {
  const fetchCalls = [];
  const originalFetch = global.fetch;
  global.fetch = async (url, init) => {
    fetchCalls.push({ url: String(url), init });
    return { ok: true, status: 200, headers: new Map(), text: async () => "{}" };
  };

  let fixtureLookupCount = 0;
  let typeRefLookupCount = 0;
  const moneylineRows = createParentMarketRows({
    payload: createMoneylinePayload(),
    parentMarketId: "pm-moneyline",
    typeReferenceId: TYPE_REFERENCE_RECORD.type_reference_id,
  });
  const pool = createPoolWithVaultRouter(async (sql) => {
    if (sql.includes("FROM fixtures")) {
      fixtureLookupCount += 1;
      return { rows: fixtureLookupCount >= 2 ? [FIXTURE_RECORD] : [] };
    }
    if (sql.includes("FROM type_references") && sql.includes("WHERE type_value_id")) {
      typeRefLookupCount += 1;
      return { rows: typeRefLookupCount >= 2 ? [TYPE_REFERENCE_RECORD] : [] };
    }
    if (sql.includes("FROM parent_markets pm")) return { rows: moneylineRows };
    return { rows: [] };
  });

  try {
    const result = await executeCmsSelectedPublish({
      envelope: createEnvelope({
        selectedPublishItems: [
          { publish_key: "moneyline|0", parent_market_payload: createMoneylinePayload() },
        ],
      }),
      config: {},
      vaultConfig: VAULT_CONFIG_ENABLED,
      pool,
      pollUntilFn: ({ fn, attempts }) => pollUntil({ fn, attempts, delayMs: 0 }),
      createRunIdFn: () => "run-vault-skipped",
      publishFixtureFn: async () => ({ ok: true }),
      publishTypeReferenceFn: async () => ({ ok: true }),
      publishParentMarketFn: async () => ({ ok: true }),
      runStore: new Map(),
      preflight: await buildCmsSelectedPreflight({
        envelope: createEnvelope({
          selectedPublishItems: [
            { publish_key: "moneyline|0", parent_market_payload: createMoneylinePayload() },
          ],
        }),
        config: {},
        pool,
        resolveFixtureCandidate: async () => createResolvedFixture(),
      }),
    });

    assert.equal(result.runRecord.status, "completed");
    assert.equal(result.runRecord.vault_sync?.status, "skipped");
    assert.match(result.runRecord.vault_sync?.reason || "", /polymarket/i);
    // No vault sync POST happened.
    assert.equal(
      fetchCalls.filter((c) => c.url.includes("/api/v1/polymarket/sync-fixture")).length,
      0
    );
  } finally {
    global.fetch = originalFetch;
  }
});

test("vault sync failure does NOT demote publish status", async () => {
  const originalFetch = global.fetch;
  global.fetch = async () => ({
    ok: false,
    status: 503,
    headers: new Map(),
    text: async () => JSON.stringify({ error: "vault host unreachable" }),
  });

  const moneylineRows = createParentMarketRows({
    payload: createMoneylinePayload(),
    parentMarketId: "pm-moneyline",
    typeReferenceId: TYPE_REFERENCE_RECORD.type_reference_id,
  });
  let fixtureLookupCount = 0;
  let typeRefLookupCount = 0;
  const pool = createPoolWithVaultRouter(async (sql) => {
    if (sql.includes("FROM fixtures")) {
      fixtureLookupCount += 1;
      return { rows: fixtureLookupCount >= 2 ? [FIXTURE_RECORD] : [] };
    }
    if (sql.includes("FROM type_references") && sql.includes("WHERE type_value_id")) {
      typeRefLookupCount += 1;
      return { rows: typeRefLookupCount >= 2 ? [TYPE_REFERENCE_RECORD] : [] };
    }
    if (sql.includes("FROM parent_markets pm")) return { rows: moneylineRows };
    return { rows: [] };
  });

  try {
    const baseEnvelope = createEnvelope({
      selectedPublishItems: [
        { publish_key: "moneyline|0", parent_market_payload: createMoneylinePayload() },
      ],
    });
    const envelope = {
      ...baseEnvelope,
      payload: {
        ...baseEnvelope.payload,
        selected_fixture: {
          ...SELECTED_FIXTURE,
          polymarket_event_id: "abc-123",
        },
      },
    };

    const result = await executeCmsSelectedPublish({
      envelope,
      config: {},
      vaultConfig: VAULT_CONFIG_ENABLED,
      pool,
      pollUntilFn: ({ fn, attempts }) => pollUntil({ fn, attempts, delayMs: 0 }),
      createRunIdFn: () => "run-vault-fail",
      publishFixtureFn: async () => ({ ok: true }),
      publishTypeReferenceFn: async () => ({ ok: true }),
      publishParentMarketFn: async () => ({ ok: true }),
      runStore: new Map(),
      preflight: await buildCmsSelectedPreflight({
        envelope: createEnvelope({
          selectedPublishItems: [
            { publish_key: "moneyline|0", parent_market_payload: createMoneylinePayload() },
          ],
        }),
        config: {},
        pool,
        resolveFixtureCandidate: async () => createResolvedFixture(),
      }),
    });

    assert.equal(result.runRecord.status, "completed");
    assert.equal(result.runRecord.aggregate.published, 1);
    assert.equal(result.runRecord.vault_sync?.status, "failed");
    assert.match(result.runRecord.vault_sync?.error || "", /vault sync failed/i);
  } finally {
    global.fetch = originalFetch;
  }
});

test("manual-query preflight uses the resolved schedule fixture and surfaces missing lookups", async () => {
  const seenManualQueries = [];
  const pool = createPool(async (sql) => {
    if (sql.includes("FROM fixtures")) {
      return { rows: [] };
    }
    if (sql.includes("FROM type_references")) {
      return { rows: [] };
    }
    if (sql.includes("FROM parent_markets pm")) {
      return { rows: [] };
    }
    return { rows: [] };
  });

  const resolvedPreflight = await buildCmsSelectedPreflight({
    envelope: createEnvelope({
      manualQuery: "Bournemouth vs Man Utd",
      selectedPublishItems: [
        { publish_key: "moneyline|0", parent_market_payload: createMoneylinePayload() },
      ],
    }),
    config: {},
    pool,
    resolveFixtureCandidate: async (payload) => {
      seenManualQueries.push(String(payload.manual_query || ""));
      return createResolvedFixture();
    },
  });

  assert.deepEqual(seenManualQueries, ["Bournemouth vs Man Utd"]);
  assert.equal(resolvedPreflight.resolvedFixture?.gameId, SELECTED_FIXTURE.game_id);

  await assert.rejects(
    () =>
      buildCmsSelectedPreflight({
        envelope: createEnvelope({
          manualQuery: "Unknown Fixture",
          selectedPublishItems: [
            { publish_key: "moneyline|0", parent_market_payload: createMoneylinePayload() },
          ],
        }),
        config: {},
        pool,
        resolveFixtureCandidate: async () => {
          throw new InvalidIntegrationPayloadError(
            "Fixture not found in the current schedule sources.",
            {
              issues: ["payload.manual_query"],
            }
          );
        },
      }),
    (error) => {
      assert.ok(error instanceof InvalidIntegrationPayloadError);
      assert.deepEqual(error.issues, ["payload.manual_query"]);
      return true;
    }
  );
});

test("UAT-only guard rejects non-UAT environments", () => {
  ensureUatOnly({ code: "uat" });
  assert.throws(() => ensureUatOnly({ code: "mainnet" }), /available only for UAT/i);
});

test("parent status classification marks half-prepared rows when markets are missing", () => {
  const halfPrepared = classifyParentStatusFromRows(
    [
      {
        parent_market_id: "pm-1",
        parent_market_family: "moneyline",
        market_line: "0",
        market_id: null,
      },
    ],
    {
      selectedFixture: FIXTURE_PAYLOAD,
      fixtureRecord: FIXTURE_RECORD,
    }
  );
  assert.equal(halfPrepared.status, "half_prepared");
  assert.match(String(halfPrepared.warnings[0] || ""), /without any market rows/i);
});

test("moneyline classification marks parent as half-prepared when expected child markets are missing", () => {
  const rows = createParentMarketRows({
    payload: createMoneylinePayload(),
    parentMarketId: "pm-short",
    typeReferenceId: TYPE_REFERENCE_RECORD.type_reference_id,
  }).slice(0, 2);
  const classification = classifyParentStatusFromRows(rows, {
    selectedFixture: FIXTURE_PAYLOAD,
    fixtureRecord: FIXTURE_RECORD,
  });
  assert.equal(classification.status, "half_prepared");
  assert.match(String(classification.warnings[0] || ""), /missing expected child market rows/i);
});

test("DB result snapshot groups published, half-prepared, and unprepared markets", () => {
  const moneylineRows = [
    ...createParentMarketRows({
      payload: {
        ...createMoneylinePayload(),
        markets: [
          ...createMoneylinePayload().markets,
          {
            name: "Draw",
            tick_size: 1,
            market_code: "draw",
            rules: "Draw selection",
          },
        ],
      },
      parentMarketId: "pm-moneyline",
      typeReferenceId: TYPE_REFERENCE_RECORD.type_reference_id,
    }),
  ];
  const totalsRows = createParentMarketRows({
    payload: {
      ...createTotalsPayload("1.5"),
      markets: [
        {
          name: "Over 1.5 Goals",
          tick_size: 1,
          market_code: "totals-over-1.5",
          rules: "Over selection",
        },
      ],
    },
    parentMarketId: "pm-totals-15",
    typeReferenceId: TYPE_REFERENCE_RECORD.type_reference_id,
  });
  const spreadsHalfPreparedRows = [
    {
      ...createParentMarketRows({
        payload: createSpreadsPayload({ line: "1.5", side: "home" }),
        parentMarketId: "pm-spreads-15-home",
        typeReferenceId: TYPE_REFERENCE_RECORD.type_reference_id,
      })[0],
      market_id: null,
    },
  ];

  const snapshot = buildCmsDbResultSnapshot({
    fixtureRecord: FIXTURE_RECORD,
    typeReferenceRecord: TYPE_REFERENCE_RECORD,
    parentRows: [...moneylineRows, ...totalsRows, ...spreadsHalfPreparedRows],
    selectedPublishItems: [
      { publish_key: "moneyline|0" },
      { publish_key: "totals|1.5" },
      { publish_key: "spreads|1.5|home" },
      { publish_key: "btts|0" },
    ],
    selectedFixture: FIXTURE_PAYLOAD,
  });

  assert.deepEqual(snapshot.fixture, {
    fixture_id: FIXTURE_RECORD.fixture_id,
    name: FIXTURE_RECORD.name,
  });
  assert.equal(snapshot.type_reference_id, TYPE_REFERENCE_RECORD.type_reference_id);
  assert.equal(snapshot.published_markets.moneyline.length, 1);
  assert.equal(snapshot.published_markets.totals.length, 1);
  assert.equal(snapshot.half_prepared_markets.length, 1);
  assert.equal(snapshot.half_prepared_markets[0]?.publish_key, "spreads|1.5|home");
  assert.deepEqual(
    snapshot.unprepared_markets.map((entry) => entry.publish_key),
    ["btts|0"]
  );
});
