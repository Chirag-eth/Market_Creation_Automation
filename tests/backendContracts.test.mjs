import test from "node:test";
import assert from "node:assert/strict";

import {
  createCatalogSourceMetadata,
  createCatalogSourcePayload,
  mergeCatalogRowCollections,
} from "../src/backend/catalogSourceContract.js";
import { normalizeLeagueStartWindows } from "../src/backend/catalogTimeWindows.js";
import {
  createNormalizedFixtureRecord,
  createNormalizedFixtureWindowPayload,
} from "../src/backend/normalizedFixtureContract.js";
import {
  getBackendFixtureSourceAdapter,
  getBackendFixtureSourceAdapters,
} from "../src/backend/fixtureSources/index.js";
import {
  createLsportsCsvColumnMap,
  normalizeLsportsCsvRows,
} from "../src/backend/fixtureSources/lsportsCsv.js";
import {
  createPolymarketFixtureWindowPayload,
  discoverPolymarketLeagueSlug,
  fetchPolymarketRawRows,
  normalizePolymarketRow,
} from "../src/backend/fixtureSources/polymarket.js";
import { fetchSportsDataRawRows } from "../src/backend/fixtureSources/sportsdata.js";

test("catalog source contract builds stable payload metadata and counts", () => {
  const source = createCatalogSourceMetadata({
    label: "Workspace catalog CSV files + supplemental CSV files",
    sourceKind: "workspace-catalog",
    leaguesFile: "leagues.csv",
    teamsFile: "teams.csv",
    supplementalLeaguesFiles: ["downloads-leagues.csv"],
    supplementalTeamsFiles: ["fifa_teams.csv"],
  });

  const payload = createCatalogSourcePayload({
    source,
    leagues: [{ league_id: "league-1" }, { league_id: "league-2" }],
    teams: [{ team_id: "team-1" }],
    loadedAt: "2026-03-26T09:00:00.000Z",
    cache: { hit: false, key: "catalog-key" },
    scheduleSupport: {
      provider: "sportsdata",
      ready_leagues: ["epl", "laliga"],
    },
  });

  assert.equal(payload.contract_version, 1);
  assert.equal(payload.source.contract_version, 1);
  assert.equal(payload.source.source_kind, "workspace-catalog");
  assert.deepEqual(payload.source.supplemental_teams_files, ["fifa_teams.csv"]);
  assert.deepEqual(payload.counts, { leagues: 2, teams: 1 });
  assert.deepEqual(payload.schedule_support?.ready_leagues, ["epl", "laliga"]);
});

test("mergeCatalogRowCollections dedupes later rows by configured ids", () => {
  const merged = mergeCatalogRowCollections(
    [
      [{ league_id: "abc", name: "Old Name" }],
      [{ league_id: "abc", name: "New Name" }, { league_id: "def", name: "Another" }],
    ],
    ["league_id", "id"]
  );

  assert.equal(merged.length, 2);
  assert.equal(merged[0].name, "New Name");
  assert.equal(merged[1].name, "Another");
});

test("league start windows are normalized so start stays in the future", () => {
  const normalized = normalizeLeagueStartWindows(
    [
      {
        league_id: "epl",
        name: "English Premier League",
        start: "2025-10-18 00:00:00+00",
      },
      {
        league_id: "future",
        name: "Future League",
        start: "2026-04-30 13:30:00+00",
      },
    ],
    { now: new Date("2026-03-27T06:45:00.000Z") }
  );

  assert.equal(normalized[0].source_start, "2025-10-18 00:00:00+00");
  assert.equal(normalized[0].start_adjusted, "1");
  assert.match(String(normalized[0].start || ""), /^2026-03-27 06:46:00\+00$/);
  assert.equal(normalized[1].source_start, undefined);
  assert.equal(normalized[1].start_adjusted, undefined);
  assert.equal(normalized[1].start, "2026-04-30 13:30:00+00");
});

test("normalized fixture contract preserves provider identity and strips internal kickoffMs from windows", () => {
  const fixture = createNormalizedFixtureRecord({
    provider: "sportsdata",
    providerFixtureId: "900002",
    eventName: "AFC Bournemouth vs Manchester United FC",
    homeTeamName: "AFC Bournemouth",
    awayTeamName: "Manchester United FC",
    fixtureDate: "2026-03-20",
    kickoffTimeUtc: "20:00",
    kickoffIso: "2026-03-20T20:00:00.000Z",
    kickoffMs: 1774036800000,
    matchDay: 31,
  });

  const payload = createNormalizedFixtureWindowPayload({
    league: "epl",
    source: "sportsdata",
    referenceNow: "2026-03-16T14:00:00.000Z",
    selectedWeek: 31,
    selectedWeeks: [31, 32, 33, 34, 35, 36],
    selectedLabel: "Matchdays 31-36",
    selectionMode: "immediate-six-weeks",
    fixtures: [fixture],
  });

  assert.equal(payload.contract_version, 1);
  assert.equal(payload.fixture_contract_version, 1);
  assert.equal(payload.fixtures[0].provider, "sportsdata");
  assert.equal(payload.fixtures[0].providerFixtureId, "900002");
  assert.equal("kickoffMs" in payload.fixtures[0], false);
});

test("backend fixture adapter registry exposes sportsdata, polymarket, and lsports lanes", () => {
  const adapters = getBackendFixtureSourceAdapters();
  assert.ok(adapters.some((adapter) => adapter.key === "sportsdata" && adapter.status === "active"));
  assert.ok(adapters.some((adapter) => adapter.key === "polymarket" && adapter.status === "experimental"));
  assert.ok(adapters.some((adapter) => adapter.key === "lsports_csv" && adapter.status === "planned"));
  assert.equal(getBackendFixtureSourceAdapter("sportsdata")?.label, "SportsData");
  assert.equal(getBackendFixtureSourceAdapter("polymarket")?.label, "Polymarket Sports");
});

test("lsports csv adapter normalizes future DB-export rows into the shared fixture contract", () => {
  const fixtures = normalizeLsportsCsvRows(
    [
      {
        fixture_id: "ls-001",
        league_code: "fifa-friendlies",
        home_team_name: "France",
        away_team_name: "Brazil",
        fixture_datetime: "2026-04-05 18:45",
        match_day: "1",
      },
    ],
    {
      columnMap: createLsportsCsvColumnMap(),
    }
  );

  assert.equal(fixtures.length, 1);
  assert.equal(fixtures[0].provider, "lsports_csv");
  assert.equal(fixtures[0].providerFixtureId, "ls-001");
  assert.equal(fixtures[0].eventName, "France vs Brazil");
  assert.equal(fixtures[0].fixtureDate, "2026-04-05");
  assert.equal(fixtures[0].kickoffTimeUtc, "18:45");
});

test("sportsdata fixture path accepts fifa friendlies csv exports", async () => {
  const rows = await fetchSportsDataRawRows({
    leagueCode: "fifa-friendlies",
    env: {
      SPORTSDATA_FIFA_FRIENDLIES_SCHEDULE_FIXTURE_PATH: "./tests/fixtures/fifa_friendlies_schedule.sample.csv",
    },
    rootDir: process.cwd(),
  });

  assert.equal(rows.length, 2);
  assert.equal(rows[0].GameId, "18420548");
  assert.equal(rows[0].HomeTeamName, "Mexico");
  assert.equal(rows[0].AwayTeamName, "Belgium");
  assert.equal(rows[0].Status, "Scheduled");
  assert.equal(rows[1].HomeTeamName, "Brazil");
  assert.equal(rows[1].AwayTeamName, "Croatia");
});

test("sportsdata fixture path rejects csv exports for non-fifa-friendlies leagues", async () => {
  await assert.rejects(
    () =>
      fetchSportsDataRawRows({
        leagueCode: "epl",
        env: {
          SPORTSDATA_EPL_SCHEDULE_FIXTURE_PATH: "./tests/fixtures/fifa_friendlies_schedule.sample.csv",
        },
        rootDir: process.cwd(),
      }),
    /CSV fixture paths are only supported for fifa-friendlies/i
  );
});

test("polymarket league discovery matches configured league aliases", async () => {
  const slug = await discoverPolymarketLeagueSlug({
    leagueCode: "epl",
    baseUrl: "https://gateway.polymarket.us",
    fetchImpl: async () => ({
      ok: true,
      async json() {
        return {
          leagues: [
            { slug: "la-liga", name: "La Liga" },
            { slug: "premier-league", name: "Premier League" },
          ],
        };
      },
    }),
  });

  assert.equal(slug, "premier-league");
});

test("polymarket adapter fetches league events after discovery", async () => {
  const requestedUrls = [];
  const rows = await fetchPolymarketRawRows({
    leagueCode: "epl",
    env: {},
    fetchImpl: async (url) => {
      requestedUrls.push(String(url));
      if (String(url).includes("/v2/leagues?")) {
        return {
          ok: true,
          async json() {
            return {
              leagues: [{ slug: "premier-league", name: "Premier League" }],
            };
          },
        };
      }
      return {
        ok: true,
        async json() {
          return {
            events: [
              {
                id: "pm-1",
                gameId: "109999",
                title: "Arsenal vs Chelsea",
                startDate: "2026-05-01T19:00:00Z",
                active: true,
                closed: false,
                participants: [{ name: "Arsenal" }, { name: "Chelsea" }],
              },
            ],
          };
        },
      };
    },
  });

  assert.equal(rows.length, 1);
  assert.match(requestedUrls[0], /\/v2\/leagues\?/);
  assert.match(requestedUrls[1], /\/v2\/leagues\/premier-league\/events\?/);
});

test("polymarket rows normalize into the shared fixture contract", () => {
  const fixture = normalizePolymarketRow({
    id: "pm-1",
    gameId: "109999",
    title: "Arsenal vs Chelsea",
    startDate: "2026-05-01T19:00:00Z",
    active: true,
    closed: false,
    participants: [{ name: "Arsenal" }, { name: "Chelsea" }],
    slug: "arsenal-vs-chelsea",
  });

  assert.equal(fixture.provider, "polymarket");
  assert.equal(fixture.gameId, "109999");
  assert.equal(fixture.eventName, "Arsenal vs Chelsea");
  assert.equal(fixture.homeTeamName, "Arsenal");
  assert.equal(fixture.awayTeamName, "Chelsea");
});

test("polymarket fixture payload produces rolling upcoming windows", () => {
  const payload = createPolymarketFixtureWindowPayload({
    leagueCode: "epl",
    now: new Date("2026-04-28T00:00:00Z"),
    rawRows: [
      {
        id: "pm-1",
        gameId: "109999",
        title: "Arsenal vs Chelsea",
        startDate: "2026-05-01T19:00:00Z",
        active: true,
        closed: false,
        participants: [{ name: "Arsenal" }, { name: "Chelsea" }],
      },
    ],
  });

  assert.equal(payload.source, "polymarket");
  assert.equal(payload.selection_mode, "rolling-upcoming");
  assert.equal(payload.fixtures.length, 1);
});
