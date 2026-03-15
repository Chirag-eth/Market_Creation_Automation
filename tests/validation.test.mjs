import test from "node:test";
import assert from "node:assert/strict";

import { validateFixtureJson, validateParentMarketPayload } from "../src/validation.js";

test("validateFixtureJson requires CSV IDs", () => {
  const errors = validateFixtureJson({
    name: "Wolves vs Aston Villa",
    league_id: null,
    home_team_id: null,
    away_team_id: null,
  });

  assert.ok(errors.some((err) => err.includes("league_id is required")));
  assert.ok(errors.some((err) => err.includes("home_team_id is required")));
  assert.ok(errors.some((err) => err.includes("away_team_id is required")));
});

test("validateParentMarketPayload requires parent datetime fields", () => {
  const errors = validateParentMarketPayload({
    parent_market: {
      league_id: "de1bd252-baf5-4417-89ba-77d635f5f8f0",
      type_reference_id: null,
      title: "Wolves vs Aston Villa",
      description: "desc",
      market_code: "WOL_AVL_20260226",
      parent_market_canonical_name: "wol-avl-epl-2026-02-26",
      rules: "rules",
      markets_open_time: null,
      markets_close_time: null,
      payout_time: null,
      status: "active",
      is_cross_matching_enabled: true,
      time_remaining: null,
    },
    markets: [
      { market_code: "WOL", team_id: "072e6726-3524-4550-b2bc-dd0cabba6e2d", time_remaining: "2026-02-26T20:00:00.000Z" },
      { market_code: "DRAW", team_id: null, time_remaining: "2026-02-26T20:00:00.000Z" },
      { market_code: "AVL", team_id: "11cccd75-3ccd-4b7c-8b85-a9e8f22f6c3d", time_remaining: "2026-02-26T20:00:00.000Z" },
    ],
  });

  assert.ok(errors.some((err) => err.includes("parent_market.markets_open_time is required")));
  assert.ok(errors.some((err) => err.includes("parent_market.markets_close_time is required")));
  assert.ok(errors.some((err) => err.includes("parent_market.payout_time is required")));
  assert.ok(errors.some((err) => err.includes("parent_market.time_remaining is required")));
});
