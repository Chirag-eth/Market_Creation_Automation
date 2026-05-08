import test from "node:test";
import assert from "node:assert/strict";

import {
  buildPolymarketUrl,
  syncSingleFixtureAfterPublish,
  syncFixturesAfterPublish,
} from "../src/backend/vaultSyncOrchestrator.js";

// Most batch-side wiring lives in executeCmsBatchRun's post-loop hook in
// src/backend/cmsBatchExecution.js. The substantive behavior — concurrency
// capping, mixed-provider skipping, vault-router integration — lives in the
// orchestrator. We unit-test it directly here.

const VAULT_CONFIG_ENABLED = {
  enabled: true,
  host: "https://vault.test",
  endpoint: "https://vault.test/api/v1/polymarket/sync-fixture",
  timeoutMs: 5_000,
  retryCount: 0,
  dryRun: false,
};

function createPoolForRouter(seedRows = []) {
  const rows = seedRows.map((r) => ({ ...r }));
  return {
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
            const [fid, st, candidate] = params;
            rows.push({ fixture_id: fid, game_start_time: st, vault_num: candidate });
            return { rows: [{ vault_num: candidate }] };
          }
          throw new Error(`unexpected SQL in test mock: ${t}`);
        },
        release() {},
      };
    },
    _rows: rows,
  };
}

test("buildPolymarketUrl constructs canonical URL from event id", () => {
  assert.equal(
    buildPolymarketUrl("epl-bournemouth-vs-man-utd-2026-04-25"),
    "https://polymarket.com/market/epl-bournemouth-vs-man-utd-2026-04-25"
  );
});

test("buildPolymarketUrl returns empty for empty/missing input", () => {
  assert.equal(buildPolymarketUrl(""), "");
  assert.equal(buildPolymarketUrl(null), "");
  assert.equal(buildPolymarketUrl(undefined), "");
});

test("buildPolymarketUrl passes through full URL untouched (minus trailing slash)", () => {
  assert.equal(
    buildPolymarketUrl("https://polymarket.com/market/already-a-url/"),
    "https://polymarket.com/market/already-a-url"
  );
});

test("syncSingleFixtureAfterPublish returns disabled when config.enabled is false", async () => {
  const pool = createPoolForRouter();
  const result = await syncSingleFixtureAfterPublish(
    pool,
    {
      fixture_id: "fix-1",
      game_start_time: "2026-05-08T15:00:00Z",
      polymarket_event_id: "abc",
    },
    { enabled: false }
  );
  assert.equal(result.status, "disabled");
  assert.equal(result.vault, null);
});

test("syncSingleFixtureAfterPublish skips when no polymarket coordinates", async () => {
  const pool = createPoolForRouter();
  const result = await syncSingleFixtureAfterPublish(
    pool,
    { fixture_id: "fix-1", game_start_time: "2026-05-08T15:00:00Z" },
    VAULT_CONFIG_ENABLED
  );
  assert.equal(result.status, "skipped");
  assert.match(result.reason, /polymarket/i);
});

test("syncSingleFixtureAfterPublish skips when fixture_id missing", async () => {
  const pool = createPoolForRouter();
  const result = await syncSingleFixtureAfterPublish(
    pool,
    {
      polymarket_event_id: "abc",
      game_start_time: "2026-05-08T15:00:00Z",
    },
    VAULT_CONFIG_ENABLED
  );
  assert.equal(result.status, "skipped");
});

test("syncFixturesAfterPublish caps concurrency to 4 with 12 polymarket fixtures", async () => {
  const fetchCalls = [];
  let inFlight = 0;
  let maxConcurrent = 0;
  const originalFetch = global.fetch;
  global.fetch = async (url, init) => {
    inFlight += 1;
    maxConcurrent = Math.max(maxConcurrent, inFlight);
    fetchCalls.push({ url: String(url), body: JSON.parse(init.body) });
    // Simulate vault sync latency so concurrency is observable.
    await new Promise((r) => setTimeout(r, 5));
    inFlight -= 1;
    return {
      ok: true,
      status: 200,
      headers: new Map(),
      text: async () => JSON.stringify({ sync_posted: 1 }),
    };
  };

  try {
    const fixtures = Array.from({ length: 12 }, (_, i) => ({
      fixture_id: `fix-${i + 1}`,
      game_start_time: "2026-05-08T15:00:00Z",
      polymarket_event_id: `event-${i + 1}`,
    }));
    const pool = createPoolForRouter();
    const results = await syncFixturesAfterPublish(pool, fixtures, VAULT_CONFIG_ENABLED);

    assert.equal(results.length, 12);
    assert.equal(
      results.filter((r) => r.status === "completed").length,
      12,
      "all 12 should complete"
    );
    assert.equal(fetchCalls.length, 12);
    assert.ok(maxConcurrent <= 4, `concurrency should cap at 4, observed ${maxConcurrent}`);
    assert.ok(maxConcurrent >= 2, "should observe at least some concurrency");
  } finally {
    global.fetch = originalFetch;
  }
});

test("syncFixturesAfterPublish only POSTs for fixtures with polymarket data", async () => {
  const postedFixtureIds = [];
  const originalFetch = global.fetch;
  global.fetch = async (url, init) => {
    const body = JSON.parse(init.body);
    postedFixtureIds.push(body.cms_fixture_id);
    return {
      ok: true,
      status: 200,
      headers: new Map(),
      text: async () => JSON.stringify({ sync_posted: 1 }),
    };
  };

  try {
    const fixtures = [
      {
        fixture_id: "fix-pm-1",
        game_start_time: "2026-05-08T15:00:00Z",
        polymarket_event_id: "evt-1",
      },
      {
        // sportsdata fixture — no polymarket fields → must be skipped
        fixture_id: "fix-sd-1",
        game_start_time: "2026-05-08T15:00:00Z",
      },
      {
        fixture_id: "fix-pm-2",
        game_start_time: "2026-05-08T18:00:00Z",
        polymarket_event_id: "evt-2",
      },
      {
        // lsports fixture — no polymarket fields → must be skipped
        fixture_id: "fix-ls-1",
        game_start_time: "2026-05-08T18:00:00Z",
      },
    ];
    const pool = createPoolForRouter();
    const results = await syncFixturesAfterPublish(pool, fixtures, VAULT_CONFIG_ENABLED);

    assert.equal(results.length, 4);
    assert.equal(results[0].status, "completed");
    assert.equal(results[1].status, "skipped");
    assert.equal(results[2].status, "completed");
    assert.equal(results[3].status, "skipped");
    assert.deepEqual([...postedFixtureIds].sort(), ["fix-pm-1", "fix-pm-2"]);
  } finally {
    global.fetch = originalFetch;
  }
});

test("syncFixturesAfterPublish returns 'disabled' shape when config disabled", async () => {
  const fixtures = [
    {
      fixture_id: "fix-1",
      game_start_time: "2026-05-08T15:00:00Z",
      polymarket_event_id: "evt-1",
    },
  ];
  const pool = createPoolForRouter();
  const results = await syncFixturesAfterPublish(pool, fixtures, { enabled: false });
  assert.equal(results.length, 1);
  assert.equal(results[0].status, "disabled");
});

test("syncFixturesAfterPublish handles empty input array", async () => {
  const pool = createPoolForRouter();
  const results = await syncFixturesAfterPublish(pool, [], VAULT_CONFIG_ENABLED);
  assert.deepEqual(results, []);
});

test("vault assignment balances same-start-time fixtures across vaults 1 and 2", async () => {
  const fetchCalls = [];
  const originalFetch = global.fetch;
  global.fetch = async (url, init) => {
    fetchCalls.push({ body: JSON.parse(init.body) });
    return {
      ok: true,
      status: 200,
      headers: new Map(),
      text: async () => JSON.stringify({ sync_posted: 1 }),
    };
  };

  try {
    // 4 fixtures all kicking off at the same time → expect 2-2 split.
    const startTime = "2026-05-08T15:00:00Z";
    const fixtures = [
      { fixture_id: "fix-A", game_start_time: startTime, polymarket_event_id: "a" },
      { fixture_id: "fix-B", game_start_time: startTime, polymarket_event_id: "b" },
      { fixture_id: "fix-C", game_start_time: startTime, polymarket_event_id: "c" },
      { fixture_id: "fix-D", game_start_time: startTime, polymarket_event_id: "d" },
    ];
    const pool = createPoolForRouter();
    // Force serial assignment by using concurrency 1 — otherwise the orchestrator
    // races and several fixtures could read the same "v1=0, v2=0" state.
    const results = await syncFixturesAfterPublish(
      pool,
      fixtures,
      VAULT_CONFIG_ENABLED,
      undefined,
      { concurrency: 1 }
    );
    assert.equal(results.length, 4);
    const vaultNums = results.map((r) => r.vault).sort();
    assert.deepEqual(vaultNums, [1, 1, 2, 2], "split should be 2 on each vault");
  } finally {
    global.fetch = originalFetch;
  }
});
