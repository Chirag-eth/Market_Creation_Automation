import test from "node:test";
import assert from "node:assert/strict";

import { buildParentMarketPayload } from "../src/core/markets.js";
import { validateParentMarketPayload } from "../src/core/validation.js";

const baseMeta = {
  fixtureJson: {
    name: "Real Madrid vs Benfica",
    league_id: "cc0d8029-3294-417f-b04f-bdc4d7fb8675",
    home_team_id: "5a263d1e-b4c6-4355-9eed-9304c891b3f1",
    away_team_id: "cc3dadbb-972d-4e0d-8f90-85bacee8e366",
    format: null,
    logo_url: "https://public-assets.pred.app/market-assets/fixture_128x128.png",
    theme_color: "#FFFFFF",
    match_day: 2,
    match_week: null,
    location: "",
    venue: "",
  },
  league: {
    key: "ucl",
    id: "cc0d8029-3294-417f-b04f-bdc4d7fb8675",
    name: "UEFA Champions League",
    slug: "ucl",
  },
  homeTeam: {
    id: "5a263d1e-b4c6-4355-9eed-9304c891b3f1",
    name: "Real Madrid",
    alternateName: "Real Madrid CF",
    code: "RMA",
    slug: "real-madrid",
    themeColor: "#E0A000",
    logoUrl: "https://public-assets.pred.app/market-assets/UCL/Real-madrid_128x128.png",
  },
  awayTeam: {
    id: "cc3dadbb-972d-4e0d-8f90-85bacee8e366",
    name: "Benfica",
    alternateName: "SL Benfica",
    code: "BEN",
    slug: "benfica",
    themeColor: "#E0C020",
    logoUrl: "https://public-assets.pred.app/market-assets/UCL/Benfica_128x128.png",
  },
  fixtureDateIso: "2026-02-26",
  kickoffTimeUtc: "20:00",
  openIso: "2026-02-25T20:00:00.000Z",
  closeIso: "2026-02-25T22:00:00.000Z",
  payoutIso: "2026-02-25T22:00:00.000Z",
  createdAtIso: "2026-02-25T20:00:00.000Z",
};

test("buildParentMarketPayload uses team codes + fixture datetime for market codes/canonicals", () => {
  const typeReferenceId = "872329ce-4891-4a9c-b203-4e71ff20d4d3";
  const payload = buildParentMarketPayload(baseMeta, typeReferenceId);

  assert.equal(payload.parent_market.type_reference_id, typeReferenceId);
  assert.equal(payload.parent_market.market_code, "RMA_BEN_20260226");
  assert.equal(payload.parent_market.parent_market_canonical_name, "rma-ben-ucl-2026-02-26");
  assert.equal(payload.markets[0].market_canonical_name, "rma-ben-win-ucl-2026-02-26");
  assert.equal(payload.markets[1].market_canonical_name, "rma-ben-draw-ucl-2026-02-26");
  assert.equal(payload.markets[2].market_canonical_name, "ben-rma-win-ucl-2026-02-26");
});

test("buildParentMarketPayload returns valid parent market shape", () => {
  const payload = buildParentMarketPayload(baseMeta, "872329ce-4891-4a9c-b203-4e71ff20d4d3");
  const errors = validateParentMarketPayload(payload);
  assert.deepEqual(errors, []);
  assert.equal(payload.markets.length, 3);
});

test("buildParentMarketPayload supports null type_reference_id without changing code/canonical shape", () => {
  const payload = buildParentMarketPayload(baseMeta, null);
  const errors = validateParentMarketPayload(payload);
  assert.deepEqual(errors, []);
  assert.equal(payload.parent_market.type_reference_id, null);
  assert.equal(payload.parent_market.market_code, "RMA_BEN_20260226");
  assert.equal(payload.parent_market.parent_market_canonical_name, "rma-ben-ucl-2026-02-26");
});

test("buildParentMarketPayload uses Long/Short team and draw rules format", () => {
  const payload = buildParentMarketPayload(baseMeta, "872329ce-4891-4a9c-b203-4e71ff20d4d3");
  const homeRules = payload.markets[0].rules;
  const drawRules = payload.markets[1].rules;
  const awayRules = payload.markets[2].rules;
  const parentRules = payload.parent_market.rules;
  const fixtureDate = "February 26, 2026";
  const expectedTeamRules = (teamName) =>
    `In the upcoming game, scheduled for ${fixtureDate}. If ${teamName} wins, this market will resolve to "Long" ($1 for ${teamName}). Otherwise, this market will resolve to "Short" ($0 for ${teamName}). If the game is postponed, this market will remain open until the game has been completed. If the game is canceled entirely, with no make-up game, this market will resolve to "Short" ($0 for ${teamName}).\n\nThis market refers only to the outcome within the first 90 minutes of regular play plus stoppage time.`;
  const expectedDrawRules =
    `In the upcoming game, scheduled for ${fixtureDate}. If the game ends in a draw, this market will resolve to "Long" ($1 for Draw). Otherwise, this market will resolve to "Short" ($0 for Draw). If the game is postponed, this market will remain open until the game has been completed. If the game is canceled entirely, with no make-up game, this market will resolve to "Long" ($1 for Draw).\n\nThis market refers only to the outcome within the first 90 minutes of regular play plus stoppage time.`;

  assert.ok(parentRules.includes('resolves to "Long" ($1) and the others resolve to "Short" ($0)'));
  assert.ok(parentRules.includes("after 90 minutes of regular play plus stoppage time"));
  assert.ok(parentRules.includes('Draw resolves to "Long" ($1) and both teams resolve to "Short" ($0)'));
  assert.equal(homeRules, expectedTeamRules("Real Madrid"));
  assert.equal(drawRules, expectedDrawRules);
  assert.equal(awayRules, expectedTeamRules("Benfica"));
});
