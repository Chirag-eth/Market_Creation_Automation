import test from "node:test";
import assert from "node:assert/strict";

import {
  normalizePredAppRow,
  normalizePredAppRows,
  createPredAppFixtureWindowPayload,
} from "../src/backend/fixtureSources/predApp.js";

// ─── normalizePredAppRow ───────────────────────────────────────────────────────

test("normalizePredAppRow handles flat field names (home_team_name, away_team_name, home_team_id)", () => {
  const row = {
    id: "fixture-001",
    home_team_name: "Manchester City",
    away_team_name: "Arsenal",
    home_team_id: "cms-uuid-home",
    away_team_id: "cms-uuid-away",
    start_time: "2099-05-10T15:00:00Z",
    status: "Scheduled",
  };

  const result = normalizePredAppRow(row);

  assert.ok(result !== null, "should not return null for a valid row");
  assert.equal(result.gameId, "fixture-001");
  assert.equal(result.homeTeamName, "Manchester City");
  assert.equal(result.awayTeamName, "Arsenal");
  assert.equal(result.eventName, "Manchester City vs Arsenal");
  assert.equal(result.sourceMeta?.homeTeamId, "cms-uuid-home");
  assert.equal(result.sourceMeta?.awayTeamId, "cms-uuid-away");
  assert.equal(result.isClosed, false);
  assert.equal(result.kickoffIso, "2099-05-10T15:00:00.000Z");
  assert.equal(result.fixtureDate, "2099-05-10");
  assert.equal(result.kickoffTimeUtc, "15:00");
});

test("normalizePredAppRow handles nested home_team / away_team objects", () => {
  const row = {
    id: "fixture-002",
    home_team: { name: "Tottenham Hotspur", id: "cms-uuid-spurs" },
    away_team: { name: "Chelsea", id: "cms-uuid-chelsea" },
    kickoff_time: "2099-06-01T12:30:00Z",
  };

  const result = normalizePredAppRow(row);

  assert.ok(result !== null);
  assert.equal(result.homeTeamName, "Tottenham Hotspur");
  assert.equal(result.awayTeamName, "Chelsea");
  assert.equal(result.sourceMeta?.homeTeamId, "cms-uuid-spurs");
  assert.equal(result.sourceMeta?.awayTeamId, "cms-uuid-chelsea");
});

test("normalizePredAppRow handles camelCase field names (homeTeamName, awayTeamName, homeTeamId)", () => {
  const row = {
    fixture_id: "fixture-003",
    homeTeamName: "Liverpool",
    awayTeamName: "Everton",
    homeTeamId: "cms-uuid-liverpool",
    awayTeamId: "cms-uuid-everton",
    match_date: "2099-04-20T19:45:00.000Z",
    status: "Scheduled",
  };

  const result = normalizePredAppRow(row);

  assert.ok(result !== null);
  assert.equal(result.gameId, "fixture-003");
  assert.equal(result.homeTeamName, "Liverpool");
  assert.equal(result.sourceMeta?.homeTeamId, "cms-uuid-liverpool");
});

test("normalizePredAppRow uses match_id as fixture id fallback", () => {
  const row = {
    match_id: "fixture-via-match-id",
    home_team_name: "Fulham",
    away_team_name: "Brentford",
    scheduled_at: "2099-08-15T14:00:00Z",
  };

  const result = normalizePredAppRow(row);
  assert.equal(result?.gameId, "fixture-via-match-id");
});

test("normalizePredAppRow stores leagueId in sourceMeta when present", () => {
  const row = {
    id: "fixture-004",
    home_team_name: "Man City",
    away_team_name: "Man Utd",
    start_time: "2099-09-01T17:30:00Z",
    league_id: "de1bd252-baf5-4417-89ba-77d635f5f8f0",
  };

  const result = normalizePredAppRow(row);
  assert.equal(result?.sourceMeta?.leagueId, "de1bd252-baf5-4417-89ba-77d635f5f8f0");
});

test("normalizePredAppRow marks terminal statuses as closed", () => {
  for (const status of ["final", "fulltime", "awarded", "cancelled", "canceled", "Final", "FULLTIME"]) {
    const row = {
      id: `fixture-closed-${status}`,
      home_team_name: "Team A",
      away_team_name: "Team B",
      start_time: "2099-01-01T12:00:00Z",
      status,
    };
    const result = normalizePredAppRow(row);
    assert.equal(result?.isClosed, true, `status "${status}" should be closed`);
  }
});

test("normalizePredAppRow returns null when required fields are missing", () => {
  // Missing fixture id
  assert.equal(normalizePredAppRow({ home_team_name: "A", away_team_name: "B", start_time: "2099-01-01T12:00:00Z" }), null);

  // Missing home team name
  assert.equal(normalizePredAppRow({ id: "x", away_team_name: "B", start_time: "2099-01-01T12:00:00Z" }), null);

  // Missing away team name
  assert.equal(normalizePredAppRow({ id: "x", home_team_name: "A", start_time: "2099-01-01T12:00:00Z" }), null);

  // Missing kickoff time
  assert.equal(normalizePredAppRow({ id: "x", home_team_name: "A", away_team_name: "B" }), null);

  // Invalid date
  assert.equal(normalizePredAppRow({ id: "x", home_team_name: "A", away_team_name: "B", start_time: "not-a-date" }), null);

  // Null/undefined input
  assert.equal(normalizePredAppRow(null), null);
  assert.equal(normalizePredAppRow(undefined), null);
  assert.equal(normalizePredAppRow("string"), null);
});

// ─── normalizePredAppRows ──────────────────────────────────────────────────────

test("normalizePredAppRows filters invalid rows and sorts by kickoff time", () => {
  const rows = [
    {
      id: "later",
      home_team_name: "Arsenal",
      away_team_name: "Chelsea",
      start_time: "2099-05-20T15:00:00Z",
    },
    null,
    { id: "bad" /* missing teams/kickoff */ },
    {
      id: "earlier",
      home_team_name: "Liverpool",
      away_team_name: "Everton",
      start_time: "2099-05-10T12:00:00Z",
    },
  ];

  const result = normalizePredAppRows(rows);

  assert.equal(result.length, 2);
  assert.equal(result[0].gameId, "earlier", "earlier kickoff should come first");
  assert.equal(result[1].gameId, "later");
});

test("normalizePredAppRows returns empty array for non-array input", () => {
  assert.deepEqual(normalizePredAppRows(null), []);
  assert.deepEqual(normalizePredAppRows(undefined), []);
  assert.deepEqual(normalizePredAppRows("bad"), []);
  assert.deepEqual(normalizePredAppRows([]), []);
});

// ─── createPredAppFixtureWindowPayload ────────────────────────────────────────

test("createPredAppFixtureWindowPayload keeps only upcoming non-closed fixtures", () => {
  const now = new Date("2099-04-15T10:00:00Z");
  const rawRows = [
    {
      id: "past",
      home_team_name: "A",
      away_team_name: "B",
      start_time: "2099-04-14T20:00:00Z", // before now
    },
    {
      id: "upcoming-1",
      home_team_name: "Manchester City",
      away_team_name: "Arsenal",
      start_time: "2099-04-20T15:00:00Z",
    },
    {
      id: "upcoming-2-closed",
      home_team_name: "C",
      away_team_name: "D",
      start_time: "2099-04-25T12:00:00Z",
      status: "final",
    },
    {
      id: "upcoming-3",
      home_team_name: "Liverpool",
      away_team_name: "Everton",
      start_time: "2099-04-30T19:45:00Z",
    },
  ];

  const payload = createPredAppFixtureWindowPayload({
    leagueCode: "epl",
    rawRows,
    now,
    fetchedAt: now.toISOString(),
  });

  assert.equal(payload.league, "epl");
  assert.equal(payload.source, "pred-app");
  assert.equal(payload.fixtures.length, 2, "only 2 upcoming non-closed fixtures");
  assert.equal(payload.fixtures[0].gameId, "upcoming-1");
  assert.equal(payload.fixtures[1].gameId, "upcoming-3");
  assert.equal(payload.selection_mode, "rolling-upcoming");
});

test("createPredAppFixtureWindowPayload returns selection_mode=none when all fixtures are past/closed", () => {
  const now = new Date("2099-06-01T00:00:00Z");
  const rawRows = [
    { id: "x", home_team_name: "A", away_team_name: "B", start_time: "2099-05-01T12:00:00Z" },
  ];

  const payload = createPredAppFixtureWindowPayload({ leagueCode: "epl", rawRows, now });

  assert.equal(payload.fixtures.length, 0);
  assert.equal(payload.selection_mode, "none");
  assert.equal(payload.selected_label, null);
});

test("createPredAppFixtureWindowPayload preserves homeTeamName/awayTeamName and sourceMeta on each fixture", () => {
  const now = new Date("2099-04-01T00:00:00Z");
  const rawRows = [
    {
      id: "fx-99",
      home_team_id: "cms-home-uuid",
      away_team_id: "cms-away-uuid",
      home_team_name: "Nottingham Forest",
      away_team_name: "Wolverhampton Wanderers",
      start_time: "2099-04-10T19:45:00Z",
      league_id: "de1bd252-baf5-4417-89ba-77d635f5f8f0",
    },
  ];

  const payload = createPredAppFixtureWindowPayload({ leagueCode: "epl", rawRows, now });

  assert.equal(payload.fixtures.length, 1);
  const fx = payload.fixtures[0];
  assert.equal(fx.homeTeamName, "Nottingham Forest");
  assert.equal(fx.awayTeamName, "Wolverhampton Wanderers");
  assert.equal(fx.sourceMeta?.homeTeamId, "cms-home-uuid");
  assert.equal(fx.sourceMeta?.awayTeamId, "cms-away-uuid");
  assert.equal(fx.sourceMeta?.leagueId, "de1bd252-baf5-4417-89ba-77d635f5f8f0");
});
