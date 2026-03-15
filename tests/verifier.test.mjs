import test from "node:test";
import assert from "node:assert/strict";

import { buildParentMarketPayload } from "../src/markets.js";
import { collectFixtureBundleFromInference } from "../src/parser.js";
import {
  generateBulkVaultPayloadsFromInput,
  generateFromEventInput,
  generateVaultPayloadFromInput,
  verifyBundleConsistency,
  verifyFixtureJsonStrict,
  verifyParentMarketJsonStrict,
} from "../src/verifier.js";

const catalog = {
  leagues: [
    {
      key: "epl",
      id: "de1bd252-baf5-4417-89ba-77d635f5f8f0",
      name: "English Premier League",
      slug: "epl",
      aliases: ["english premier league", "epl"],
    },
  ],
  teams: [
    {
      id: "072e6726-3524-4550-b2bc-dd0cabba6e2d",
      leagueId: "de1bd252-baf5-4417-89ba-77d635f5f8f0",
      name: "Wolves",
      alternateName: "Wolverhampton Wanderers",
      code: "WOL",
      slug: "wolves",
      themeColor: "#FDB913",
      logoUrl: "https://example.com/wolves.png",
      aliases: ["wolves", "wolverhampton", "wolverhampton wanderers"],
    },
    {
      id: "11cccd75-3ccd-4b7c-8b85-a9e8f2216c3d",
      leagueId: "de1bd252-baf5-4417-89ba-77d635f5f8f0",
      name: "Aston Villa",
      alternateName: "Aston Villa FC",
      code: "AVL",
      slug: "aston-villa",
      themeColor: "#670E36",
      logoUrl: "https://example.com/aston-villa.png",
      aliases: ["aston villa", "aston villa fc", "villa"],
    },
  ],
};

function buildFixtureAndParent() {
  const baseDate = "2099-03-15";
  const bundle = collectFixtureBundleFromInference(
    {
      leagueSelectValue: "epl",
      leagueId: "de1bd252-baf5-4417-89ba-77d635f5f8f0",
      homeTeamName: "Wolves",
      awayTeamName: "Aston Villa",
      homeTeamMeta: catalog.teams[0],
      awayTeamMeta: catalog.teams[1],
      fixtureDate: baseDate,
      kickoffTimeUtc: "14:00",
      matchDay: 29,
      matchWeek: null,
      location: "",
      venue: "",
    },
    catalog
  );

  const parent = buildParentMarketPayload(
    bundle.meta,
    "4b57bb5d-c292-4d3d-ab05-9f19e2b77aaf"
  );

  return {
    fixture: bundle.fixtureJson,
    parent,
  };
}

test("verifyFixtureJsonStrict passes for CSV-aligned fixture payload", () => {
  const { fixture } = buildFixtureAndParent();
  const result = verifyFixtureJsonStrict(fixture, catalog);

  assert.equal(result.ok, true);
  assert.equal(result.errors.length, 0);
  assert.ok(result.info.some((line) => line.includes("League verified from CSV")));
});

test("verifyFixtureJsonStrict rejects mismatched fixture name", () => {
  const { fixture } = buildFixtureAndParent();
  const tampered = {
    ...fixture,
    name: "Wolves vs Benfica",
  };

  const result = verifyFixtureJsonStrict(tampered, catalog);
  assert.equal(result.ok, false);
  assert.ok(result.errors.some((line) => line.includes("fixture.name must match CSV teams")));
});

test("verifyParentMarketJsonStrict passes for generated parent payload", () => {
  const { fixture, parent } = buildFixtureAndParent();
  const result = verifyParentMarketJsonStrict(parent, catalog, { fixture });

  assert.equal(result.ok, true);
  assert.equal(result.errors.length, 0);
});

test("verifyParentMarketJsonStrict supports fixture-date canonical when close time is previous UTC date", () => {
  const { fixture, parent } = buildFixtureAndParent();
  const shifted = {
    ...parent,
    parent_market: {
      ...parent.parent_market,
      markets_open_time: "2099-03-14T18:00:00Z",
      markets_close_time: "2099-03-14T20:00:00Z",
      payout_time: "2099-03-14T20:00:00Z",
      time_remaining: "2099-03-14T20:00:00Z",
    },
    markets: parent.markets.map((market) => ({
      ...market,
      time_remaining: "2099-03-14T20:00:00Z",
    })),
  };

  const result = verifyParentMarketJsonStrict(shifted, catalog, { fixture });
  assert.equal(result.ok, true);
  assert.equal(result.errors.length, 0);
});

test("verifyParentMarketJsonStrict flags market code mismatch", () => {
  const { fixture, parent } = buildFixtureAndParent();
  const tampered = {
    ...parent,
    markets: parent.markets.map((market, idx) => {
      if (idx !== 0) {
        return market;
      }
      return {
        ...market,
        market_code: "BAD",
      };
    }),
  };

  const result = verifyParentMarketJsonStrict(tampered, catalog, { fixture });
  assert.equal(result.ok, false);
  assert.ok(result.errors.some((line) => line.includes("home market_code")));
});

test("verifyParentMarketJsonStrict rejects non-future parent times and status flags", () => {
  const { fixture, parent } = buildFixtureAndParent();
  const pastIso = new Date(Date.now() - 5 * 60 * 1000).toISOString();
  const tampered = {
    ...parent,
    parent_market: {
      ...parent.parent_market,
      markets_open_time: pastIso,
      markets_close_time: pastIso,
      payout_time: pastIso,
      time_remaining: pastIso,
      status: "paused",
      is_cross_matching_enabled: false,
    },
  };

  const result = verifyParentMarketJsonStrict(tampered, catalog, { fixture });
  assert.equal(result.ok, false);
  assert.ok(result.errors.some((line) => line.includes("markets_open_time must be greater than current UTC time")));
  assert.ok(result.errors.some((line) => line.includes("markets_close_time must be greater than current UTC time")));
  assert.ok(result.errors.some((line) => line.includes("payout_time must be greater than current UTC time")));
  assert.ok(result.errors.some((line) => line.includes("time_remaining must be greater than current UTC time")));
  assert.ok(result.errors.some((line) => line.includes("parent_market.status must be \"active\"")));
  assert.ok(result.errors.some((line) => line.includes("parent_market.is_cross_matching_enabled must be true")));
});

test("verifyBundleConsistency passes for generated fixture + parent payload", () => {
  const { fixture, parent } = buildFixtureAndParent();
  const result = verifyBundleConsistency(fixture, parent, catalog);

  assert.equal(result.ok, true);
  assert.equal(result.errors.length, 0);
});

test("generateFromEventInput builds strict-valid payloads", () => {
  const result = generateFromEventInput(
    {
      eventName: "Wolves vs Aston Villa",
      leagueSelection: "de1bd252-baf5-4417-89ba-77d635f5f8f0",
      fixtureDate: "2099-03-15",
      kickoffTimeUtc: "14:00",
      matchDay: "29",
      matchWeek: "",
      location: "",
      venue: "",
      typeReferenceId: "4b57bb5d-c292-4d3d-ab05-9f19e2b77aaf",
    },
    catalog
  );

  assert.equal(result.ok, true);
  assert.ok(result.fixtureJson);
  assert.ok(result.parentPayload);
  assert.equal(result.fixtureJson.home_team_id, catalog.teams[0].id);
  assert.equal(result.fixtureJson.away_team_id, catalog.teams[1].id);
});

test("generateFromEventInput fails when event team is not in CSV", () => {
  const result = generateFromEventInput(
    {
      eventName: "Wolves vs Benfica",
      leagueSelection: "de1bd252-baf5-4417-89ba-77d635f5f8f0",
      fixtureDate: "2099-03-15",
      kickoffTimeUtc: "14:00",
      matchDay: "29",
      matchWeek: "",
      location: "",
      venue: "",
      typeReferenceId: "",
    },
    catalog
  );

  assert.equal(result.ok, false);
  assert.ok(result.errors.some((line) => line.includes("is not mapped in teams.csv")));
});

test("generateFromEventInput supports short team codes in event name", () => {
  const result = generateFromEventInput(
    {
      eventName: "WOL vs AVL",
      leagueSelection: "de1bd252-baf5-4417-89ba-77d635f5f8f0",
      fixtureDate: "2099-03-15",
      kickoffTimeUtc: "14:00",
      matchDay: "29",
      matchWeek: "",
      location: "",
      venue: "",
      typeReferenceId: "4b57bb5d-c292-4d3d-ab05-9f19e2b77aaf",
    },
    catalog
  );

  assert.equal(result.ok, true);
  assert.equal(result.fixtureJson.name, "Wolves vs Aston Villa");
});

test("generateFromEventInput auto-detects league from a valid home-away pair when names are multi-league ambiguous", () => {
  const multiLeagueCatalog = {
    leagues: [
      {
        key: "epl",
        id: "11111111-1111-4111-8111-111111111111",
        name: "English Premier League",
        slug: "epl",
        aliases: ["epl", "premier league"],
      },
      {
        key: "ucl",
        id: "22222222-2222-4222-8222-222222222222",
        name: "UEFA Champions League",
        slug: "ucl",
        aliases: ["ucl", "champions league"],
      },
      {
        key: "laliga",
        id: "33333333-3333-4333-8333-333333333333",
        name: "La Liga",
        slug: "laliga",
        aliases: ["laliga", "la liga"],
      },
    ],
    teams: [
      {
        id: "44444444-4444-4444-8444-444444444444",
        leagueId: "22222222-2222-4222-8222-222222222222",
        name: "Barcelona",
        alternateName: "FC Barcelona",
        code: "BAR",
        slug: "barcelona",
        themeColor: "#C0A000",
        logoUrl: "https://example.com/bar-ucl.png",
        aliases: ["barcelona", "fc barcelona", "bar"],
      },
      {
        id: "55555555-5555-4555-8555-555555555555",
        leagueId: "33333333-3333-4333-8333-333333333333",
        name: "Barcelona",
        alternateName: "FC Barcelona",
        code: "BAR",
        slug: "barcelona",
        themeColor: "#C0A000",
        logoUrl: "https://example.com/bar-laliga.png",
        aliases: ["barcelona", "fc barcelona", "bar"],
      },
      {
        id: "66666666-6666-4666-8666-666666666666",
        leagueId: "22222222-2222-4222-8222-222222222222",
        name: "Newcastle",
        alternateName: "Newcastle United FC",
        code: "NEW",
        slug: "newcastle",
        themeColor: "#2CA2C9",
        logoUrl: "https://example.com/new-ucl.png",
        aliases: ["newcastle", "newcastle united", "new"],
      },
      {
        id: "77777777-7777-4777-8777-777777777777",
        leagueId: "11111111-1111-4111-8111-111111111111",
        name: "Newcastle",
        alternateName: "Newcastle United FC",
        code: "NEW",
        slug: "newcastle",
        themeColor: "#2CA2C9",
        logoUrl: "https://example.com/new-epl.png",
        aliases: ["newcastle", "newcastle united", "new"],
      },
    ],
  };

  const result = generateFromEventInput(
    {
      eventName: "Barcelona vs Newcastle",
      leagueSelection: "",
      fixtureDate: "2099-03-15",
      kickoffTimeUtc: "14:00",
      matchDay: "29",
      matchWeek: "",
      location: "",
      venue: "",
      typeReferenceId: "",
    },
    multiLeagueCatalog
  );

  assert.equal(result.ok, true);
  assert.equal(result.fixtureJson.league_id, "22222222-2222-4222-8222-222222222222");
  assert.equal(result.fixtureJson.home_team_id, "44444444-4444-4444-8444-444444444444");
  assert.equal(result.fixtureJson.away_team_id, "66666666-6666-4666-8666-666666666666");
  assert.ok(result.info.some((line) => line.includes("Auto-detected league from teams")));
});

test("generateVaultPayloadFromInput builds naming format and payload shape", () => {
  const year = new Date().getUTCFullYear();
  const result = generateVaultPayloadFromInput(
    {
      fixtureName: "DRAW: GAL vs LIV",
      yesTokenId: "72390989656394092723709285047039935596255450081364429237891273051103304153527",
      noTokenId: "8975346952598897262687996252702979373792093357160517170366933722560510069626",
      leagueCode: "UCL",
      marketPrefix: "",
    },
    {}
  );

  assert.equal(result.ok, true);
  assert.ok(result.payload);
  assert.equal(result.payload.market_name, `DRAW_GAL_vs_LIV_UCL_${year}`);
  assert.equal(result.payload.market.question, `DRAW_GAL_vs_LIV_UCL_${year}`);
  assert.equal(result.payload.market.outcomes.YES.token_id, "72390989656394092723709285047039935596255450081364429237891273051103304153527");
  assert.equal(result.payload.market.outcomes.NO.token_id, "8975346952598897262687996252702979373792093357160517170366933722560510069626");
  assert.ok(/^0x[0-9a-f]{64}$/i.test(result.payload.market.pred_mapping.market_id));
});

test("generateVaultPayloadFromInput uses optional provided market id override", () => {
  const year = new Date().getUTCFullYear();
  const explicitMarketId = "0xaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa";
  const result = generateVaultPayloadFromInput(
    {
      fixtureName: "DRAW: GAL vs LIV",
      yesTokenId: "72390989656394092723709285047039935596255450081364429237891273051103304153527",
      noTokenId: "8975346952598897262687996252702979373792093357160517170366933722560510069626",
      leagueCode: "UCL",
      marketId: explicitMarketId,
      marketPrefix: "",
    },
    {}
  );

  assert.equal(result.ok, true);
  assert.equal(result.payload.market_name, `DRAW_GAL_vs_LIV_UCL_${year}`);
  assert.equal(result.payload.market.pred_mapping.market_id, explicitMarketId);
});

test("generateVaultPayloadFromInput rejects invalid token ids", () => {
  const result = generateVaultPayloadFromInput(
    {
      fixtureName: "Wolves vs Aston Villa",
      yesTokenId: "abc",
      noTokenId: "123",
      leagueCode: "EPL",
      marketPrefix: "DRAW",
    },
    catalog
  );

  assert.equal(result.ok, false);
  assert.ok(result.errors.some((line) => line.includes("YES token ID")));
  assert.ok(result.errors.some((line) => line.includes("NO token ID")));
});

test("generateVaultPayloadFromInput rejects invalid optional market id", () => {
  const result = generateVaultPayloadFromInput(
    {
      fixtureName: "Wolves vs Aston Villa",
      yesTokenId: "72390989656394092723709285047039935596255450081364429237891273051103304153527",
      noTokenId: "8975346952598897262687996252702979373792093357160517170366933722560510069626",
      leagueCode: "EPL",
      marketId: "not-a-market-id",
      marketPrefix: "DRAW",
    },
    catalog
  );

  assert.equal(result.ok, false);
  assert.ok(result.errors.some((line) => line.includes("Market ID must be a 0x-prefixed 64-hex string")));
});

test("generateVaultPayloadFromInput supports short team codes in fixture name", () => {
  const year = new Date().getUTCFullYear();
  const result = generateVaultPayloadFromInput(
    {
      fixtureName: "DRAW: NEW vs FCB",
      yesTokenId: "72390989656394092723709285047039935596255450081364429237891273051103304153527",
      noTokenId: "8975346952598897262687996252702979373792093357160517170366933722560510069626",
      leagueCode: "LALIGA",
      marketPrefix: "",
    },
    {}
  );

  assert.equal(result.ok, true);
  assert.equal(result.payload.market_name, `DRAW_NEW_vs_FCB_LALIGA_${year}`);
});

test("generateVaultPayloadFromInput accepts explicit prefix matching one fixture team code", () => {
  const year = new Date().getUTCFullYear();
  const result = generateVaultPayloadFromInput(
    {
      fixtureName: "NEW vs FCB",
      yesTokenId: "72390989656394092723709285047039935596255450081364429237891273051103304153527",
      noTokenId: "8975346952598897262687996252702979373792093357160517170366933722560510069626",
      leagueCode: "UCL",
      marketPrefix: "FCB",
    },
    {}
  );

  assert.equal(result.ok, true);
  assert.equal(result.payload.market_name, `FCB_NEW_vs_FCB_UCL_${year}`);
});

test("generateVaultPayloadFromInput rejects prefix outside fixture team codes and DRAW", () => {
  const result = generateVaultPayloadFromInput(
    {
      fixtureName: "NEW vs FCB",
      yesTokenId: "72390989656394092723709285047039935596255450081364429237891273051103304153527",
      noTokenId: "8975346952598897262687996252702979373792093357160517170366933722560510069626",
      leagueCode: "UCL",
      marketPrefix: "EPL",
    },
    {}
  );

  assert.equal(result.ok, false);
  assert.ok(result.errors.some((line) => line.includes("Name Prefix must be one of")));
});

test("generateBulkVaultPayloadsFromInput parses CSV rows and generates payload array", () => {
  const result = generateBulkVaultPayloadsFromInput(
    {
      rowsText: [
        "fixture_name,yes_token_id,no_token_id,league_code,market_id,market_prefix",
        "NEW vs FCB,72390989656394092723709285047039935596255450081364429237891273051103304153527,8975346952598897262687996252702979373792093357160517170366933722560510069626,UCL,,DRAW",
      ].join("\n"),
    },
    {}
  );

  assert.equal(result.ok, true);
  assert.equal(result.errors.length, 0);
  assert.equal(result.payloads.length, 1);
  assert.match(result.payloads[0].market_name, /^DRAW_NEW_vs_FCB_UCL_/);
});

test("generateBulkVaultPayloadsFromInput reports row-level errors for invalid token rows", () => {
  const result = generateBulkVaultPayloadsFromInput(
    {
      rowsText: [
        "fixture_name,yes_token_id,no_token_id,league_code",
        "NEW vs FCB,abc,123,UCL",
      ].join("\n"),
    },
    {}
  );

  assert.equal(result.ok, false);
  assert.ok(result.errors.some((line) => line.includes("Row 2 (NEW vs FCB): YES token ID is required")));
});

test("generateBulkVaultPayloadsFromInput recognizes vault API JSON shape and explains missing naming fields", () => {
  const result = generateBulkVaultPayloadsFromInput(
    {
      rowsText: JSON.stringify({
        data: {
          count: 1,
          market_ids: ["0xabc"],
          markets: [
            {
              MarketID: "0xabc",
              ParentMarketID: "0xparent",
              PolyTokenID: "72390989656394092723709285047039935596255450081364429237891273051103304153527",
              PolyNoTokenID: "8975346952598897262687996252702979373792093357160517170366933722560510069626",
            },
          ],
        },
      }),
    },
    {}
  );

  assert.equal(result.ok, false);
  assert.ok(result.info.some((line) => line.includes("JSON response payload")));
  assert.ok(result.errors.some((line) => line.includes("does not include fixture_name or league_code")));
});

test("generateBulkVaultPayloadsFromInput applies supplemental market_id mapping to vault API JSON rows", () => {
  const currentYear = new Date().getUTCFullYear();
  const marketId = "0x1111111111111111111111111111111111111111111111111111111111111111";
  const result = generateBulkVaultPayloadsFromInput(
    {
      rowsText: JSON.stringify({
        data: {
          count: 1,
          market_ids: [marketId],
          markets: [
            {
              MarketID: marketId,
              ParentMarketID: marketId,
              PolyTokenID: "72390989656394092723709285047039935596255450081364429237891273051103304153527",
              PolyNoTokenID: "8975346952598897262687996252702979373792093357160517170366933722560510069626",
            },
          ],
        },
      }),
      mappingText: [
        "market_id,fixture_name,league_code,market_prefix",
        `${marketId},NEW vs FCB,UCL,DRAW`,
      ].join("\n"),
    },
    {}
  );

  assert.equal(result.ok, true);
  assert.equal(result.errors.length, 0);
  assert.equal(result.payloads.length, 1);
  assert.equal(result.payloads[0].market_name, `DRAW_NEW_vs_FCB_UCL_${currentYear}`);
  assert.ok(result.info.some((line) => line.includes("Applied 1 vault mapping row")));
});

test("generateBulkVaultPayloadsFromInput rejects unmatched supplemental vault mapping rows", () => {
  const result = generateBulkVaultPayloadsFromInput(
    {
      rowsText: JSON.stringify({
        data: {
          count: 1,
          market_ids: ["0xabc"],
          markets: [
            {
              MarketID: "0xabc",
              ParentMarketID: "0xparent",
              PolyTokenID: "72390989656394092723709285047039935596255450081364429237891273051103304153527",
              PolyNoTokenID: "8975346952598897262687996252702979373792093357160517170366933722560510069626",
            },
          ],
        },
      }),
      mappingText: [
        "market_id,fixture_name,league_code,market_prefix",
        "0xdef,NEW vs FCB,UCL,DRAW",
      ].join("\n"),
    },
    {}
  );

  assert.equal(result.ok, false);
  assert.ok(result.errors.some((line) => line.includes('market_id "0xdef" did not match any vault bulk row')));
});
