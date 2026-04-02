import test from "node:test";
import assert from "node:assert/strict";

import { extractScheduleReadyLeagueCodes, normalizeCatalogPayload } from "../src/data/catalog.js";
import { generateFromEventInput } from "../src/core/verifier.js";

const rawCatalog = {
  leagues: [
    {
      league_id: "de1bd252-baf5-4417-89ba-77d635f5f8f0",
      name: "English Premier League",
      alternate_name: "EPL",
    },
  ],
  teams: [
    {
      team_id: "11111111-1111-4111-8111-111111111111",
      league_id: "de1bd252-baf5-4417-89ba-77d635f5f8f0",
      name: "Bournemouth",
      alternate_name: "Bournemouth",
      logo_url: "https://example.com/bournemouth.png",
      theme_color: "#FFFFFF",
    },
    {
      team_id: "22222222-2222-4222-8222-222222222222",
      league_id: "de1bd252-baf5-4417-89ba-77d635f5f8f0",
      name: "Man Utd",
      alternate_name: "Man United",
      logo_url: "https://example.com/man-utd.png",
      theme_color: "#FFFFFF",
    },
    {
      team_id: "33333333-3333-4333-8333-333333333333",
      league_id: "de1bd252-baf5-4417-89ba-77d635f5f8f0",
      name: "Brighton",
      alternate_name: "Brighton",
      logo_url: "https://example.com/brighton.png",
      theme_color: "#FFFFFF",
    },
    {
      team_id: "44444444-4444-4444-8444-444444444444",
      league_id: "de1bd252-baf5-4417-89ba-77d635f5f8f0",
      name: "Spurs",
      alternate_name: "Tottenham",
      logo_url: "https://example.com/spurs.png",
      theme_color: "#FFFFFF",
    },
    {
      team_id: "55555555-5555-4555-8555-555555555555",
      league_id: "de1bd252-baf5-4417-89ba-77d635f5f8f0",
      name: "Fulham",
      alternate_name: "Fulham",
      logo_url: "https://example.com/fulham.png",
      theme_color: "#FFFFFF",
    },
    {
      team_id: "66666666-6666-4666-8666-666666666666",
      league_id: "de1bd252-baf5-4417-89ba-77d635f5f8f0",
      name: "Burnley",
      alternate_name: "Burnley",
      logo_url: "https://example.com/burnley.png",
      theme_color: "#FFFFFF",
    },
  ],
};

test("normalizeCatalogPayload adds SportsData-friendly aliases for CSV teams", () => {
  const catalog = normalizeCatalogPayload(rawCatalog);

  const bournemouth = catalog.teams.find((team) => team.name === "Bournemouth");
  const manUtd = catalog.teams.find((team) => team.name === "Man Utd");
  const brighton = catalog.teams.find((team) => team.name === "Brighton");
  const spurs = catalog.teams.find((team) => team.name === "Spurs");
  const fulham = catalog.teams.find((team) => team.name === "Fulham");
  const burnley = catalog.teams.find((team) => team.name === "Burnley");

  assert.ok(bournemouth?.aliases.includes("AFC Bournemouth"));
  assert.ok(manUtd?.aliases.includes("Manchester United FC"));
  assert.ok(brighton?.aliases.includes("Brighton & Hove Albion FC"));
  assert.ok(spurs?.aliases.includes("Tottenham Hotspur FC"));
  assert.ok(fulham?.aliases.includes("Fulham"));
  assert.ok(burnley?.aliases.includes("Burnley"));
});

test("generateFromEventInput accepts SportsData fixture names and converts them to CSV team names", () => {
  const catalog = normalizeCatalogPayload(rawCatalog);

  const result = generateFromEventInput(
    {
      eventName: "AFC Bournemouth vs Manchester United FC",
      leagueSelection: "de1bd252-baf5-4417-89ba-77d635f5f8f0",
      fixtureDate: "2099-03-20",
      kickoffTimeUtc: "20:00",
      matchDay: "31",
      matchWeek: "",
      location: "",
      venue: "",
      typeReferenceId: "",
      now: new Date("2099-03-01T00:00:00Z"),
    },
    catalog
  );

  assert.equal(result.ok, true);
  assert.equal(result.fixtureJson?.name, "Bournemouth vs Man Utd");
});

test("generateFromEventInput supports other long-form SportsData club names from the same league", () => {
  const catalog = normalizeCatalogPayload(rawCatalog);

  const result = generateFromEventInput(
    {
      eventName: "Brighton & Hove Albion FC vs Tottenham Hotspur FC",
      leagueSelection: "de1bd252-baf5-4417-89ba-77d635f5f8f0",
      fixtureDate: "2099-03-21",
      kickoffTimeUtc: "12:30",
      matchDay: "31",
      matchWeek: "",
      location: "",
      venue: "",
      typeReferenceId: "",
      now: new Date("2099-03-01T00:00:00Z"),
    },
    catalog
  );

  assert.equal(result.ok, true);
  assert.equal(result.fixtureJson?.name, "Brighton vs Spurs");
});

test("generateFromEventInput accepts common SportsData FC suffix names without explicit presets", () => {
  const catalog = normalizeCatalogPayload(rawCatalog);

  const result = generateFromEventInput(
    {
      eventName: "Fulham FC vs Burnley FC",
      leagueSelection: "de1bd252-baf5-4417-89ba-77d635f5f8f0",
      fixtureDate: "2099-03-21",
      kickoffTimeUtc: "15:00",
      matchDay: "31",
      matchWeek: "",
      location: "",
      venue: "",
      typeReferenceId: "",
      now: new Date("2099-03-01T00:00:00Z"),
    },
    catalog
  );

  assert.equal(result.ok, true);
  assert.equal(result.fixtureJson?.name, "Fulham vs Burnley");
});

test("generateFromEventInput accepts common long-form La Liga provider names", () => {
  const catalog = normalizeCatalogPayload({
    leagues: [
      {
        league_id: "30c19a6e-da71-4fef-942c-f7cf01fd42e4",
        name: "La Liga",
        alternate_name: "La Liga",
      },
    ],
    teams: [
      {
        team_id: "11111111-1111-4111-8111-111111111111",
        league_id: "30c19a6e-da71-4fef-942c-f7cf01fd42e4",
        name: "Atletico",
        alternate_name: "Atletico de Madrid",
        logo_url: "https://example.com/atletico.png",
        theme_color: "#FFFFFF",
      },
      {
        team_id: "22222222-2222-4222-8222-222222222222",
        league_id: "30c19a6e-da71-4fef-942c-f7cf01fd42e4",
        name: "Barcelona",
        alternate_name: "FC Barcelona",
        logo_url: "https://example.com/barcelona.png",
        theme_color: "#FFFFFF",
      },
      {
        team_id: "33333333-3333-4333-8333-333333333333",
        league_id: "30c19a6e-da71-4fef-942c-f7cf01fd42e4",
        name: "Rayo",
        alternate_name: "Rayo Vallecano",
        logo_url: "https://example.com/rayo.png",
        theme_color: "#FFFFFF",
      },
      {
        team_id: "44444444-4444-4444-8444-444444444444",
        league_id: "30c19a6e-da71-4fef-942c-f7cf01fd42e4",
        name: "Celta",
        alternate_name: "Celta Vigo",
        logo_url: "https://example.com/celta.png",
        theme_color: "#FFFFFF",
      },
    ],
  });

  const atleticoResult = generateFromEventInput(
    {
      eventName: "Club Atlético de Madrid vs FC Barcelona",
      leagueSelection: "30c19a6e-da71-4fef-942c-f7cf01fd42e4",
      fixtureDate: "2099-04-04",
      kickoffTimeUtc: "19:00",
      matchDay: "30",
      matchWeek: "",
      location: "",
      venue: "",
      typeReferenceId: "",
      now: new Date("2099-03-01T00:00:00Z"),
    },
    catalog
  );

  const rayoResult = generateFromEventInput(
    {
      eventName: "Rayo Vallecano de Madrid vs RC Celta de Vigo",
      leagueSelection: "30c19a6e-da71-4fef-942c-f7cf01fd42e4",
      fixtureDate: "2099-04-05",
      kickoffTimeUtc: "19:00",
      matchDay: "31",
      matchWeek: "",
      location: "",
      venue: "",
      typeReferenceId: "",
      now: new Date("2099-03-01T00:00:00Z"),
    },
    catalog
  );

  assert.equal(atleticoResult.ok, true);
  assert.equal(atleticoResult.fixtureJson?.name, "Atletico vs Barcelona");
  assert.equal(rayoResult.ok, true);
  assert.equal(rayoResult.fixtureJson?.name, "Rayo vs Celta");
});

test("normalizeCatalogPayload remaps orphan FIFA team league ids through league aliases", () => {
  const catalog = normalizeCatalogPayload({
    leagues: [
      {
        league_id: "b6e39e21-8fdf-44ee-9fd0-abe8578854a6",
        name: "International Federation of Association Football",
        alternate_name: "FIFA Friendlies",
        association: "FIFA",
      },
    ],
    teams: [
      {
        team_id: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa",
        league_id: "f2146aa7-1d02-4df3-8a28-34638de9a3e8",
        name: "Australia",
        alternate_name: "Australia_FIFA_Friendlies",
        logo_url: "https://example.com/australia.png",
        theme_color: "#FFFFFF",
      },
      {
        team_id: "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb",
        league_id: "f2146aa7-1d02-4df3-8a28-34638de9a3e8",
        name: "Cameroon",
        alternate_name: "Cameroon_FIFA_Friendlies",
        logo_url: "https://example.com/cameroon.png",
        theme_color: "#FFFFFF",
      },
    ],
  });

  const australia = catalog.teams.find((team) => team.name === "Australia");
  const cameroon = catalog.teams.find((team) => team.name === "Cameroon");

  assert.equal(australia?.leagueId, "b6e39e21-8fdf-44ee-9fd0-abe8578854a6");
  assert.equal(cameroon?.leagueId, "b6e39e21-8fdf-44ee-9fd0-abe8578854a6");
});

test("extractScheduleReadyLeagueCodes derives backend-ready leagues from per-league metadata", () => {
  const readyCodes = extractScheduleReadyLeagueCodes({
    schedule_support: {
      provider: "sportsdata",
      leagues: [
        { code: "epl", ready: true, config_source: "default-competition-id" },
        { code: "fifa-friendlies", ready: true, config_source: "fixture-path" },
        { code: "fifa-worldcup", ready: false, config_source: "unconfigured" },
      ],
    },
  });

  assert.deepEqual(readyCodes, ["epl", "fifa-friendlies"]);
});

test("extractScheduleReadyLeagueCodes preserves explicit empty backend readiness", () => {
  const readyCodes = extractScheduleReadyLeagueCodes({
    schedule_support: {
      provider: "sportsdata",
      leagues: [
        { code: "epl", ready: false, config_source: "unconfigured" },
        { code: "fifa-friendlies", ready: false, config_source: "unconfigured" },
      ],
    },
  });

  assert.deepEqual(readyCodes, []);
});
