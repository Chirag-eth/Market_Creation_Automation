import test from "node:test";
import assert from "node:assert/strict";

import {
  validateFixtureJson,
  validateParentMarketPayload,
  validateUatParentMarketFamilyPayload,
  validateUatTypeReferencePayloads,
} from "../src/core/validation.js";

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

test("validateUatTypeReferencePayloads accepts fixture + generic payloads", () => {
  const errors = validateUatTypeReferencePayloads({
    fixture: {
      type_value: "fixture",
      type_value_id: "8b09bc68-077c-4c07-9673-df79f1e24453",
      canonical_name: "hungary-vs-greece-2099-03-31",
    },
    generic: {
      type_value: "generic",
      type_value_id: "8b09bc68-077c-4c07-9673-df79f1e24453",
      canonical_name: "hungary-vs-greece-2099",
    },
  });

  assert.deepEqual(errors, []);
});

test("validateUatParentMarketFamilyPayload accepts a UAT market-family payload", () => {
  const errors = validateUatParentMarketFamilyPayload(
    {
      parent_market: {
        league_id: "b6e39e21-8fdf-44ee-9fd0-abe8578854a6",
        type_reference_id: "8b09bc68-077c-4c07-9673-df79f1e24453",
        title: "Hungary Vs Greece",
        parent_market_family: "moneyline",
        market_line: "0",
        rules: "Rules",
        markets_open_time: "2099-03-31T17:00:00Z",
      },
      markets: [
        {
          name: "Hungary",
          market_code: "HUN",
          rules: "Rules",
          team_id: "fd30f168-fbd9-4956-8dd8-9f763d9fae88",
        },
        {
          name: "Greece",
          market_code: "GRE",
          rules: "Rules",
          team_id: "98571e85-7646-499c-b6bd-6cb55fbefbf7",
        },
        {
          name: "Draw",
          market_code: "DRAW",
          rules: "Rules",
        },
      ],
    },
    { family: "moneyline" }
  );

  assert.deepEqual(errors, []);
});
