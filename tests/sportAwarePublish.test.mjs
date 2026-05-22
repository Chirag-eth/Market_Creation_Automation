import { test } from "node:test";
import assert from "node:assert/strict";

import {
  SUBMARKET_TO_PUBLISH_KEYS,
  expandSelectedPublishKeys,
  normalizeCmsBatchEnvelope,
} from "../src/backend/cmsBatchPublish.js";
import {
  CMS_SELECTED_PUBLISHABLE_KEYS,
  isSupportedCmsPublishKey,
} from "../src/backend/cmsSelectedPublish.js";
import {
  mapProviderToCmsSource,
  publishKeyToParentMarketKey,
  buildFixtureCreateCname,
} from "../src/backend/cmsBatchExecution.js";
import { buildUatParentPayloads } from "../src/core/uatFormats.js";

test("expandSelectedPublishKeys: soccer behaves like the legacy SUBMARKET_TO_PUBLISH_KEYS flatMap", () => {
  const selection = ["moneyline", "btts", "totals", "spreads"];
  const legacy = [...new Set(selection.flatMap((id) => SUBMARKET_TO_PUBLISH_KEYS[id] || []))];
  const fresh = expandSelectedPublishKeys({ sport: "soccer", submarketIds: selection });
  assert.deepEqual(fresh, legacy, "soccer expansion must be byte-identical to legacy map");
});

test("expandSelectedPublishKeys: nba consults perFixtureLines and emits arbitrary-line keys", () => {
  const out = expandSelectedPublishKeys({
    sport: "nba",
    submarketIds: ["moneyline", "totals", "spreads"],
    perFixtureLines: {
      "nba-knicks-lakers": {
        totals: ["216.5", "220.5"],
        spreads: [
          { line: "11.5", side: "home" },
          { line: "11.5", side: "away" },
        ],
      },
    },
    fixtureKey: "nba-knicks-lakers",
  });
  assert.deepEqual(out, [
    "moneyline|0",
    "totals|216.5",
    "totals|220.5",
    "spreads|11.5|home",
    "spreads|11.5|away",
  ]);
});

test("expandSelectedPublishKeys: nba without perFixtureLines yields only moneyline (no fixed catalog)", () => {
  const out = expandSelectedPublishKeys({
    sport: "nba",
    submarketIds: ["moneyline", "totals", "spreads"],
    perFixtureLines: {},
    fixtureKey: "missing",
  });
  assert.deepEqual(out, ["moneyline|0"]);
});

test("expandSelectedPublishKeys: nba ignores soccer-shaped line-specific ids like ou_1_5", () => {
  const out = expandSelectedPublishKeys({
    sport: "nba",
    submarketIds: ["ou_1_5", "home_2_5", "moneyline"],
    perFixtureLines: {},
    fixtureKey: "x",
  });
  assert.deepEqual(out, ["moneyline|0"]);
});

test("isSupportedCmsPublishKey: soccer enforces the historical 10-key whitelist", () => {
  for (const key of CMS_SELECTED_PUBLISHABLE_KEYS) {
    assert.equal(isSupportedCmsPublishKey(key), true, `${key} must be accepted for soccer`);
  }
  assert.equal(
    isSupportedCmsPublishKey("totals|216.5"),
    false,
    "NBA-shaped key rejected for soccer default"
  );
  assert.equal(isSupportedCmsPublishKey("spreads|11.5|home"), false);
});

test("isSupportedCmsPublishKey: nba accepts arbitrary-line totals/spreads", () => {
  assert.equal(isSupportedCmsPublishKey("totals|216.5", { sport: "nba" }), true);
  assert.equal(isSupportedCmsPublishKey("totals|220", { sport: "nba" }), true);
  assert.equal(isSupportedCmsPublishKey("spreads|11.5|home", { sport: "nba" }), true);
  assert.equal(isSupportedCmsPublishKey("spreads|7.5|away", { sport: "nba" }), true);
  assert.equal(isSupportedCmsPublishKey("moneyline|0", { sport: "nba" }), true);
  // Still rejects malformed / unsupported families
  assert.equal(
    isSupportedCmsPublishKey("btts|0", { sport: "nba" }),
    false,
    "NBA does not support BTTS"
  );
  assert.equal(
    isSupportedCmsPublishKey("spreads|11.5|teama", { sport: "nba" }),
    false,
    "side must be home|away"
  );
});

test("mapProviderToCmsSource: polymarket and gamma-polymarket map to polymarket", () => {
  assert.equal(mapProviderToCmsSource("polymarket"), "polymarket");
  assert.equal(mapProviderToCmsSource("gamma-polymarket"), "polymarket");
  assert.equal(mapProviderToCmsSource("sportsdata"), "sports_data");
  assert.equal(mapProviderToCmsSource("lsports-db"), "lsports");
  assert.equal(mapProviderToCmsSource(""), null);
});

test("normalizeCmsBatchEnvelope: nba sport surfaces per_fixture_lines and accepts NBA-shaped publish keys", () => {
  const envelope = normalizeCmsBatchEnvelope({
    sport: "nba",
    selected_fixtures: [
      {
        game_id: "nba-cle-nyk",
        league_code: "nba",
        event_name: "Cavaliers vs Knicks",
      },
    ],
    selected_publish_keys: ["moneyline|0", "totals|216.5", "spreads|11.5|home", "btts|0"],
    per_fixture_lines: {
      "nba-cle-nyk": { totals: ["216.5"], spreads: [{ line: "11.5", side: "home" }] },
    },
  });
  assert.equal(envelope.sport, "nba");
  assert.deepEqual(envelope.selectedPublishKeys, [
    "moneyline|0",
    "totals|216.5",
    "spreads|11.5|home",
  ]); // btts dropped (nba doesn't support it)
  assert.equal(envelope.selectedFixtures.length, 1);
  assert.equal(envelope.perFixtureLines["nba-cle-nyk"].totals[0], "216.5");
});

test("normalizeCmsBatchEnvelope: soccer envelope unchanged (backwards compat)", () => {
  const envelope = normalizeCmsBatchEnvelope({
    selected_fixtures: [{ game_id: "epl-1", league_code: "epl", event_name: "Arsenal vs Chelsea" }],
    selected_publish_keys: [
      "moneyline|0",
      "totals|1.5",
      "spreads|2.5|home",
      "totals|216.5", // NBA-shaped → must be filtered out for soccer
    ],
  });
  assert.equal(envelope.sport, "");
  assert.deepEqual(envelope.selectedPublishKeys, ["moneyline|0", "totals|1.5", "spreads|2.5|home"]);
});

test("publishKeyToParentMarketKey accepts arbitrary NBA-shaped lines (already family-aware)", () => {
  // Goal: confirm the family-aware mapper produces correct CMS strings for
  // operator-picked lines, since the same mapper handles all sports.
  assert.equal(publishKeyToParentMarketKey("moneyline|0", "Knicks", "Lakers"), "moneyline");
  assert.equal(publishKeyToParentMarketKey("totals|216.5", "", ""), "totals_216.5");
  assert.equal(publishKeyToParentMarketKey("totals|220", "", ""), "totals_220");
  assert.equal(
    publishKeyToParentMarketKey("spreads|11.5|home", "Knicks", "Lakers"),
    "spreads_11.5_teama"
  );
  assert.equal(
    publishKeyToParentMarketKey("spreads|11.5|away", "Knicks", "Lakers"),
    "spreads_11.5_teamb"
  );
});

test("buildFixtureCreateCname uses the new short shape for NBA fixtures too", () => {
  const cname = buildFixtureCreateCname(
    {
      home: "Knicks",
      away: "Lakers",
      kickoff: "2026-05-20T00:30:00Z",
      leagueCode: "nba",
    },
    { code: "NYK" },
    { code: "LAL" }
  );
  assert.equal(cname, "nba-nyk-lal-2026-05-20");
});

test("buildUatParentPayloads: NBA produces overtime + nba.com rules + Points titles", () => {
  const payloads = buildUatParentPayloads({
    fixtureJson: { name: "Cavaliers vs Knicks" },
    league: { id: "nba-league", key: "nba", sport: "nba", alternateName: "NBA", name: "NBA" },
    homeTeam: { id: "h", name: "Cavaliers", code: "CLE" },
    awayTeam: { id: "a", name: "Knicks", code: "NYK" },
    fixtureDateIso: "2026-05-20",
    kickoffTimeUtc: "00:30",
    openIso: "2026-05-19T20:00:00Z",
    createdAtIso: "2026-05-19T18:00:00Z",
    typeReferenceId: "tr-1",
    outputProfile: "uat",
    marketLine: "216.5",
  });

  // BTTS must be absent for NBA — bttsSupported=false.
  assert.equal(payloads.btts, null, "NBA must not produce a BTTS payload");

  // Moneyline must have exactly 2 markets (no Draw).
  assert.equal(payloads.moneyline.markets.length, 2);
  assert.ok(
    payloads.moneyline.markets.every((m) => m.name !== "Draw"),
    "NBA moneyline must not include a Draw market"
  );

  // Rules text must use "including any overtime" and reference nba.com.
  const totalsRules = payloads.totals.markets[0].rules;
  assert.match(totalsRules, /including any overtime/i, "NBA totals rule must mention overtime");
  assert.match(totalsRules, /nba\.com/, "NBA totals rule must reference nba.com");

  // Titles must read "Total Over 216.5 Points" not "Goals".
  assert.equal(payloads.totals.parent_market.title, "Total Over 216.5 Points");
  assert.equal(payloads.totals.markets[0].name, "Over 216.5 Points");
});

test("buildUatParentPayloads: NFL produces 'four quarters plus any overtime' + nfl.com", () => {
  const payloads = buildUatParentPayloads({
    fixtureJson: { name: "Chiefs vs Bills" },
    league: { id: "nfl-league", key: "nfl", sport: "nfl", alternateName: "NFL", name: "NFL" },
    homeTeam: { id: "h", name: "Chiefs", code: "KC" },
    awayTeam: { id: "a", name: "Bills", code: "BUF" },
    fixtureDateIso: "2026-09-20",
    kickoffTimeUtc: "17:00",
    openIso: "2026-09-19T20:00:00Z",
    createdAtIso: "2026-09-19T18:00:00Z",
    typeReferenceId: "tr-2",
    outputProfile: "uat",
    marketLine: "48.5",
  });
  assert.equal(payloads.btts, null);
  assert.equal(payloads.moneyline.markets.length, 2);
  const totalsRules = payloads.totals.markets[0].rules;
  assert.match(totalsRules, /four quarters plus any overtime/i);
  assert.match(totalsRules, /nfl\.com/);
  assert.equal(payloads.totals.parent_market.title, "Total Over 48.5 Points");
});

test("buildUatParentPayloads: soccer remains byte-identical (Draw market + BTTS payload + goals phrasing)", () => {
  const payloads = buildUatParentPayloads({
    fixtureJson: { name: "Arsenal vs Chelsea" },
    league: { id: "epl-league", key: "epl", sport: "soccer", alternateName: "EPL", name: "EPL" },
    homeTeam: { id: "h", name: "Arsenal", code: "ARS" },
    awayTeam: { id: "a", name: "Chelsea", code: "CHE" },
    fixtureDateIso: "2026-05-20",
    kickoffTimeUtc: "15:00",
    openIso: "2026-05-19T08:00:00Z",
    createdAtIso: "2026-05-19T07:00:00Z",
    typeReferenceId: "tr-3",
    outputProfile: "uat",
    marketLine: "2.5",
  });
  // Soccer keeps Draw + BTTS.
  assert.ok(payloads.btts, "soccer must still produce a BTTS payload");
  assert.equal(payloads.moneyline.markets.length, 3);
  assert.ok(payloads.moneyline.markets.find((m) => m.name === "Draw"));
  // Goals phrasing intact.
  assert.match(payloads.totals.markets[0].rules, /90 minutes of regular play plus stoppage time/i);
  assert.match(payloads.totals.markets[0].rules, /goals/);
  assert.equal(payloads.totals.parent_market.title, "Total Over 2.5 Goals");
});

test("isSupportedCmsPublishKey: soccer accepts the new totals|0.5 and totals|5.5 entries", () => {
  // Anti-regression for the May 2026 whitelist extension. These two lines
  // weren't part of the original 10-key set but were added once the underlying
  // rule generator was confirmed to handle arbitrary numeric lines.
  assert.equal(isSupportedCmsPublishKey("totals|0.5"), true);
  assert.equal(isSupportedCmsPublishKey("totals|5.5"), true);
  // Lines outside the whitelist still rejected for the default soccer path.
  assert.equal(isSupportedCmsPublishKey("totals|6.5"), false, "6.5 not whitelisted");
  assert.equal(isSupportedCmsPublishKey("totals|0"), false, "integer line not whitelisted");
});

test("buildUatParentPayloads: soccer totals 0.5 produces threshold=1 + 'Total Over 0.5 Goals' title", () => {
  const payloads = buildUatParentPayloads({
    fixtureJson: { name: "Arsenal vs Chelsea" },
    league: { id: "epl-league", key: "epl", sport: "soccer", alternateName: "EPL", name: "EPL" },
    homeTeam: { id: "h", name: "Arsenal", code: "ARS" },
    awayTeam: { id: "a", name: "Chelsea", code: "CHE" },
    fixtureDateIso: "2026-05-20",
    kickoffTimeUtc: "15:00",
    openIso: "2026-05-19T08:00:00Z",
    createdAtIso: "2026-05-19T07:00:00Z",
    typeReferenceId: "tr-4",
    outputProfile: "uat",
    marketLine: "0.5",
  });
  assert.equal(payloads.totals.parent_market.title, "Total Over 0.5 Goals");
  assert.equal(payloads.totals.parent_market.market_line, "0.5");
  // threshold = ceil(0.5) = 1 — Over 0.5 resolves Long iff at least one goal scored.
  assert.match(
    payloads.totals.markets[0].rules,
    /combine to score 1 or more goals/i,
    "0.5 totals rule must reference a threshold of 1 goal"
  );
  assert.equal(payloads.totals.markets[0].market_code, "Over 0.5");
});

test("buildUatParentPayloads: soccer totals 5.5 produces threshold=6 + 'Total Over 5.5 Goals' title", () => {
  const payloads = buildUatParentPayloads({
    fixtureJson: { name: "Arsenal vs Chelsea" },
    league: { id: "epl-league", key: "epl", sport: "soccer", alternateName: "EPL", name: "EPL" },
    homeTeam: { id: "h", name: "Arsenal", code: "ARS" },
    awayTeam: { id: "a", name: "Chelsea", code: "CHE" },
    fixtureDateIso: "2026-05-20",
    kickoffTimeUtc: "15:00",
    openIso: "2026-05-19T08:00:00Z",
    createdAtIso: "2026-05-19T07:00:00Z",
    typeReferenceId: "tr-5",
    outputProfile: "uat",
    marketLine: "5.5",
  });
  assert.equal(payloads.totals.parent_market.title, "Total Over 5.5 Goals");
  assert.equal(payloads.totals.parent_market.market_line, "5.5");
  assert.match(
    payloads.totals.markets[0].rules,
    /combine to score 6 or more goals/i,
    "5.5 totals rule must reference a threshold of 6 goals"
  );
  assert.equal(payloads.totals.markets[0].market_code, "Over 5.5");
});
