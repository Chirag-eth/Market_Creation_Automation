import test from "node:test";
import assert from "node:assert/strict";

import {
  findExistingFixtureUuid,
  postCmsFixtureCreate,
  publishKeyToParentMarketKey,
} from "../src/backend/cmsBatchExecution.js";

function silentLogger() {
  return { info: () => {}, warn: () => {}, error: () => {}, debug: () => {} };
}

test("findExistingFixtureUuid requires the scheduled date for exact home-away matches", async () => {
  const calls = [];
  const pool = {
    async query(sql, params) {
      calls.push({ sql: String(sql || ""), params: [...params] });
      if (calls.length === 1) {
        return { rows: [] };
      }
      if (calls.length === 2) {
        return {
          rows: [
            {
              fixture_id: "fixture-home-date",
              away_team_id: "away-1",
            },
          ],
        };
      }
      return { rows: [] };
    },
  };

  const result = await findExistingFixtureUuid(pool, {
    leagueId: "league-1",
    homeTeamId: "home-1",
    awayTeamId: "away-1",
    gameDate: "2026-05-10",
  });

  assert.equal(result.fixtureUuid, "fixture-home-date");
  assert.equal(result.match, "home+date");
  assert.deepEqual(calls[0].params, ["league-1", "home-1", "away-1", "2026-05-10"]);
  assert.match(calls[0].sql, /game_start_time::date = \$4::date/i);
});

test("findExistingFixtureUuid returns the exact same-day fixture when present", async () => {
  const pool = {
    async query() {
      return {
        rows: [{ fixture_id: "fixture-exact-same-day" }],
      };
    },
  };

  const result = await findExistingFixtureUuid(pool, {
    leagueId: "league-1",
    homeTeamId: "home-1",
    awayTeamId: "away-1",
    gameDate: "2026-05-10",
  });

  assert.equal(result.fixtureUuid, "fixture-exact-same-day");
  assert.equal(result.match, "exact+date");
});

test("publishKeyToParentMarketKey: spreads emit teama/teamb (not <side>_<team-slug>)", () => {
  assert.equal(
    publishKeyToParentMarketKey("spreads|1.5|home", "West Ham FC", "Leeds"),
    "spreads_1.5_teama"
  );
  assert.equal(
    publishKeyToParentMarketKey("spreads|1.5|away", "West Ham FC", "Leeds"),
    "spreads_1.5_teamb"
  );
  assert.equal(publishKeyToParentMarketKey("spreads|2.5|home"), "spreads_2.5_teama");
  assert.equal(publishKeyToParentMarketKey("moneyline|0"), "moneyline");
  assert.equal(publishKeyToParentMarketKey("totals|2.5"), "totals_2.5");
  assert.equal(publishKeyToParentMarketKey("btts|0"), "btts");
});

test("postCmsFixtureCreate: HTTP 500 with uni_type_references_canonical_name signals duplicate, not failure", async () => {
  // Pin the CMS-server quirk we saw on UAT: re-publishing an already-created
  // fixture returns HTTP 500 with a Postgres unique-constraint violation
  // instead of a graceful "already exists, skipped". We turn that specific
  // shape into a tagged error so the caller can record the fixture as
  // "existing" (non-fatal) instead of "failed".
  const originalFetch = global.fetch;
  global.fetch = async () =>
    new Response(
      JSON.stringify({
        error: {
          status_code: 500,
          error_code: "INTERNAL_SERVER_ERROR",
          message:
            'ERROR: duplicate key value violates unique constraint "uni_type_references_canonical_name" (SQLSTATE 23505)',
        },
      }),
      { status: 500, headers: { "Content-Type": "application/json" } }
    );
  try {
    await assert.rejects(
      postCmsFixtureCreate(
        { baseUrl: "http://example.test", timeoutMs: 1000 },
        {
          game_id: "91369",
          source: "sports_data",
          parent_markets: ["moneyline"],
          cname: "epl-tot-eve-2026-05-24",
          appendix: "",
        },
        silentLogger()
      ),
      (err) => {
        assert.equal(err.cmsCode, "duplicate_canonical_name");
        assert.ok(err.cmsBody, "duplicate-key error should carry cmsBody for diagnostics");
        return true;
      }
    );
  } finally {
    global.fetch = originalFetch;
  }
});

test("postCmsFixtureCreate: HTTP 500 with a non-duplicate body throws a plain error (no cmsCode)", async () => {
  const originalFetch = global.fetch;
  global.fetch = async () =>
    new Response(JSON.stringify({ error: { message: "something else broke" } }), {
      status: 500,
      headers: { "Content-Type": "application/json" },
    });
  try {
    await assert.rejects(
      postCmsFixtureCreate(
        { baseUrl: "http://example.test", timeoutMs: 1000 },
        { game_id: "x", source: "sports_data", parent_markets: [], cname: "", appendix: "" },
        silentLogger()
      ),
      (err) => {
        assert.equal(err.cmsCode, undefined);
        assert.match(err.message, /HTTP 500 from fixtures\/create/);
        return true;
      }
    );
  } finally {
    global.fetch = originalFetch;
  }
});
