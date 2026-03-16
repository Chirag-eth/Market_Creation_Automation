import test from "node:test";
import assert from "node:assert/strict";

import { buildTeamAliasIndex } from "../src/data/catalog.js";
import {
  collectFixtureBundleFromInference,
  findExactTeamForLeague,
  inferFixtureFromText,
  inferFixturesFromOcrArtifacts,
  inferFixturesFromText,
  parseFixtureDate,
} from "../src/core/parser.js";

const leagues = [
  {
    key: "epl",
    id: "de1bd252-baf5-4417-89ba-77d635f5f8f0",
    name: "English Premier League",
    slug: "epl",
    aliases: ["english premier league", "epl", "premier league"],
  },
];

const teams = [
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
    aliases: ["aston villa", "villa", "aston villa fc"],
  },
  {
    id: "55f6ca19-24ab-44ce-b4fc-d98d6be1754a",
    leagueId: "de1bd252-baf5-4417-89ba-77d635f5f8f0",
    name: "Bournemouth",
    alternateName: "AFC Bournemouth",
    code: "BOU",
    slug: "bournemouth",
    themeColor: "#D71920",
    logoUrl: "https://example.com/bournemouth.png",
    aliases: ["bournemouth", "afc bournemouth"],
  },
  {
    id: "0de94b28-5cf6-4fd9-a514-b36eb95ccbc2",
    leagueId: "de1bd252-baf5-4417-89ba-77d635f5f8f0",
    name: "Sunderland",
    alternateName: "Sunderland AFC",
    code: "SUN",
    slug: "sunderland",
    themeColor: "#EB172B",
    logoUrl: "https://example.com/sunderland.png",
    aliases: ["sunderland", "sunderland afc"],
  },
];

const teamAliasIndex = buildTeamAliasIndex(teams);
const context = { leagues, teams, teamAliasIndex };

test("parseFixtureDate supports day-month without year", () => {
  assert.equal(parseFixtureDate("Sat, 28 Feb"), "2026-02-28");
  assert.equal(parseFixtureDate("Feb 28"), "2026-02-28");
});

test("inferFixtureFromText does not guess a pair from multi-team noise without separators", () => {
  const text = [
    "Matchday 28",
    "Wolves",
    "Aston Villa",
    "Bournemouth",
  ].join("\n");

  const single = inferFixtureFromText(text, context);
  assert.equal(single.homeTeamName, "");
  assert.equal(single.awayTeamName, "");
  assert.ok(single.notes.some((note) => note.includes("Could not confidently detect a fixture pair")));
});

test("inferFixtureFromText can recover a close unambiguous pair from noisy text", () => {
  const text = "Preview: Wolves Aston Villa pre-match analysis and long form context about Bournemouth standings table.";
  const single = inferFixtureFromText(text, context);
  assert.equal(single.homeTeamName, "Wolves");
  assert.equal(single.awayTeamName, "Aston Villa");
});

test("inferFixturesFromText preserves row-level date/time in multi-fixture input", () => {
  const text = [
    "Matchday 28",
    "Wolves vs Aston Villa Sat, 28 Feb 1:30 pm",
    "Bournemouth vs Sunderland Sat, 28 Feb 6:00 pm",
  ].join("\n");

  const result = inferFixturesFromText(text, context);
  assert.equal(result.fixtures.length, 2);

  const wolves = result.fixtures.find((fixture) => fixture.homeTeamName === "Wolves");
  const bournemouth = result.fixtures.find((fixture) => fixture.homeTeamName === "Bournemouth");

  assert.ok(wolves);
  assert.equal(wolves.fixtureDate, "2026-02-28");
  assert.equal(wolves.kickoffTimeUtc, "13:30");
  assert.equal(wolves.source.dateUnverified, false);
  assert.equal(wolves.source.timeUnverified, false);
  assert.equal(wolves.source.timezoneUnverified, true);

  assert.ok(bournemouth);
  assert.equal(bournemouth.fixtureDate, "2026-02-28");
  assert.equal(bournemouth.kickoffTimeUtc, "18:00");
  assert.equal(bournemouth.source.dateUnverified, false);
  assert.equal(bournemouth.source.timeUnverified, false);
  assert.equal(bournemouth.source.timezoneUnverified, true);
});

test("inferFixturesFromText detects stacked multi-fixture rows without vs separators", () => {
  const text = [
    "Matchday 28 of 38",
    "Wolves Sat, 28 Feb Bournemouth Sat, 28 Feb",
    "Aston Villa 1:30 pm Sunderland 6:00 pm",
  ].join("\n");

  const result = inferFixturesFromText(text, context);
  const names = result.fixtures.map((fixture) => `${fixture.homeTeamName} vs ${fixture.awayTeamName}`);

  assert.equal(result.fixtures.length, 2);
  assert.ok(names.includes("Wolves vs Aston Villa"));
  assert.ok(names.includes("Bournemouth vs Sunderland"));
  assert.ok(result.fixtures.every((fixture) => fixture.source.kind === "ocr-text-stacked"));
  assert.ok(result.notes.some((note) => note.includes("stacked OCR rows")));
});

test("inferFixturesFromText recovers at least one fixture from noisy stacked OCR lines", () => {
  const text = [
    "Matchday 28 of 38",
    "Wolves Sat, 28 Feb SolimeMmouth Sat, 28 Feb",
    "Aston Villa am ad Sunderland a",
  ].join("\n");

  const result = inferFixturesFromText(text, context);
  const names = result.fixtures.map((fixture) => `${fixture.homeTeamName} vs ${fixture.awayTeamName}`);

  assert.ok(result.fixtures.length >= 1);
  assert.ok(names.includes("Wolves vs Aston Villa"));
});

test("inferFixturesFromText handles stacked rows with interleaved time-only lines", () => {
  const text = [
    "Matchday 28 of 38",
    "Wolves Sat, 28 Feb Bournemouth Sat, 28 Feb",
    "1:30 pm 6:00 pm",
    "Aston Villa Sunderland",
  ].join("\n");

  const result = inferFixturesFromText(text, context);
  const names = result.fixtures.map((fixture) => `${fixture.homeTeamName} vs ${fixture.awayTeamName}`);

  assert.equal(result.fixtures.length, 2);
  assert.ok(names.includes("Wolves vs Aston Villa"));
  assert.ok(names.includes("Bournemouth vs Sunderland"));
});

test("inferFixturesFromText does not chain-pair across non-temporal interlines", () => {
  const text = [
    "Matchday 28 of 38",
    "Wolves Bournemouth",
    "Liverpool Newcastle",
    "Aston Villa Sunderland",
  ].join("\n");

  const result = inferFixturesFromText(text, context);
  const names = result.fixtures.map((fixture) => `${fixture.homeTeamName} vs ${fixture.awayTeamName}`);

  assert.equal(result.fixtures.length, 1);
  assert.deepEqual(names, ["Wolves vs Bournemouth"]);
  assert.ok(!names.includes("Wolves vs Aston Villa"));
  assert.ok(!names.includes("Bournemouth vs Sunderland"));
});

test("inferFixturesFromOcrArtifacts detects grid lanes without vs separators", () => {
  const ocrArtifacts = {
    text: [
      "Matchday 28",
      "Wolves Sat, 28 Feb",
      "Aston Villa 1:30 pm",
      "Bournemouth Sat, 28 Feb",
      "Sunderland 6:00 pm",
    ].join("\n"),
    lines: [
      {
        text: "Wolves Sat, 28 Feb",
        confidence: 91,
        bbox: { x0: 100, y0: 20, x1: 280, y1: 40 },
      },
      {
        text: "Bournemouth Sat, 28 Feb",
        confidence: 89,
        bbox: { x0: 520, y0: 20, x1: 760, y1: 40 },
      },
      {
        text: "Aston Villa 1:30 pm",
        confidence: 90,
        bbox: { x0: 100, y0: 55, x1: 300, y1: 75 },
      },
      {
        text: "Sunderland 6:00 pm",
        confidence: 90,
        bbox: { x0: 520, y0: 55, x1: 730, y1: 75 },
      },
    ],
  };

  const result = inferFixturesFromOcrArtifacts(ocrArtifacts, context);
  assert.equal(result.fixtures.length, 2);

  const names = result.fixtures.map((fixture) => `${fixture.homeTeamName} vs ${fixture.awayTeamName}`);
  assert.ok(names.includes("Wolves vs Aston Villa"));
  assert.ok(names.includes("Bournemouth vs Sunderland"));

  for (const fixture of result.fixtures) {
    assert.equal(fixture.source.kind, "ocr-geometry");
    assert.equal(fixture.source.dateUnverified, false);
    assert.equal(fixture.source.timeUnverified, false);
    assert.equal(fixture.source.timezoneUnverified, true);
  }
});

test("inferFixturesFromOcrArtifacts marks parser fallback source kind", () => {
  const ocrArtifacts = {
    text: "Wolves vs Aston Villa",
    lines: [
      {
        text: "Noise line",
        confidence: 88,
        bbox: { x0: 10, y0: 10, x1: 120, y1: 30 },
      },
    ],
  };

  const result = inferFixturesFromOcrArtifacts(ocrArtifacts, context);
  assert.equal(result.fixtures.length, 1);
  assert.equal(result.fixtures[0].source.kind, "ocr-text-fallback");
  assert.ok(result.notes.some((note) => note.includes("OCR geometry parser found no row-based fixture pairs")));
});

test("inferFixturesFromOcrArtifacts can recover geometry rows from word boxes when line boxes are missing", () => {
  const ocrArtifacts = {
    text: [
      "Wolves Sat, 28 Feb",
      "Aston Villa 1:30 pm",
      "Bournemouth Sat, 28 Feb",
      "Sunderland 6:00 pm",
    ].join("\n"),
    lines: [],
    words: [
      { text: "Wolves", confidence: 91, bbox: { x0: 100, y0: 20, x1: 170, y1: 40 } },
      { text: "Sat,", confidence: 90, bbox: { x0: 178, y0: 20, x1: 214, y1: 40 } },
      { text: "28", confidence: 90, bbox: { x0: 220, y0: 20, x1: 242, y1: 40 } },
      { text: "Feb", confidence: 90, bbox: { x0: 246, y0: 20, x1: 284, y1: 40 } },

      { text: "Bournemouth", confidence: 89, bbox: { x0: 520, y0: 20, x1: 660, y1: 40 } },
      { text: "Sat,", confidence: 88, bbox: { x0: 668, y0: 20, x1: 704, y1: 40 } },
      { text: "28", confidence: 88, bbox: { x0: 710, y0: 20, x1: 732, y1: 40 } },
      { text: "Feb", confidence: 88, bbox: { x0: 736, y0: 20, x1: 772, y1: 40 } },

      { text: "Aston", confidence: 90, bbox: { x0: 100, y0: 55, x1: 170, y1: 75 } },
      { text: "Villa", confidence: 90, bbox: { x0: 176, y0: 55, x1: 232, y1: 75 } },
      { text: "1:30", confidence: 90, bbox: { x0: 238, y0: 55, x1: 280, y1: 75 } },
      { text: "pm", confidence: 90, bbox: { x0: 286, y0: 55, x1: 312, y1: 75 } },

      { text: "Sunderland", confidence: 90, bbox: { x0: 520, y0: 55, x1: 638, y1: 75 } },
      { text: "6:00", confidence: 90, bbox: { x0: 644, y0: 55, x1: 686, y1: 75 } },
      { text: "pm", confidence: 90, bbox: { x0: 692, y0: 55, x1: 718, y1: 75 } },
    ],
  };

  const result = inferFixturesFromOcrArtifacts(ocrArtifacts, context);
  assert.equal(result.fixtures.length, 2);
  const names = result.fixtures.map((fixture) => `${fixture.homeTeamName} vs ${fixture.awayTeamName}`);
  assert.ok(names.includes("Wolves vs Aston Villa"));
  assert.ok(names.includes("Bournemouth vs Sunderland"));
});

test("collectFixtureBundleFromInference prefers inferred team league over first-league fallback", () => {
  const multiLeague = [
    {
      key: "ucl",
      id: "cc0d8029-3294-417f-b04f-bdc4d7fb8675",
      name: "UEFA Champions League",
      slug: "ucl",
      aliases: ["ucl", "champions league"],
    },
    ...leagues,
  ];

  const inference = {
    homeTeamName: "Wolves",
    awayTeamName: "Aston Villa",
    homeTeamMeta: { leagueId: "de1bd252-baf5-4417-89ba-77d635f5f8f0" },
    awayTeamMeta: { leagueId: "de1bd252-baf5-4417-89ba-77d635f5f8f0" },
    fixtureDate: "2026-02-27",
    kickoffTimeUtc: "20:00",
    matchDay: 28,
  };

  const bundle = collectFixtureBundleFromInference(inference, {
    leagues: multiLeague,
    teams,
  });

  assert.ok(bundle);
  assert.equal(bundle.meta.league.id, "de1bd252-baf5-4417-89ba-77d635f5f8f0");
  assert.equal(bundle.fixtureJson.league_id, "de1bd252-baf5-4417-89ba-77d635f5f8f0");
  assert.equal(bundle.fixtureJson.name, "Wolves vs Aston Villa");
});

test("findExactTeamForLeague uses exact CSV alias matching only", () => {
  const exact = findExactTeamForLeague("Aston Villa", teams, "de1bd252-baf5-4417-89ba-77d635f5f8f0");
  assert.ok(exact);
  assert.equal(exact.name, "Aston Villa");

  const fuzzyShouldFail = findExactTeamForLeague("Aston Vill", teams, "de1bd252-baf5-4417-89ba-77d635f5f8f0");
  assert.equal(fuzzyShouldFail, null);
});

test("inferFixturesFromText stacked fallback avoids cross-row chain pairing", () => {
  const text = [
    "Matchday 1",
    "Wolves Bournemouth",
    "Aston Villa Sunderland",
    "Bournemouth Wolves",
    "Sunderland Aston Villa",
  ].join("\n");

  const result = inferFixturesFromText(text, context);
  const names = result.fixtures.map((fixture) => `${fixture.homeTeamName} vs ${fixture.awayTeamName}`);

  assert.equal(result.fixtures.length, 2);
  assert.ok(names.includes("Wolves vs Aston Villa"));
  assert.ok(names.includes("Bournemouth vs Sunderland"));
  assert.ok(!names.includes("Aston Villa vs Bournemouth"));
  assert.ok(!names.includes("Sunderland vs Wolves"));
  assert.ok(result.notes.some((note) => note.includes("League inferred from team mentions")));
});
