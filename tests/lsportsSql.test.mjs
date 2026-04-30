import test from "node:test";
import assert from "node:assert/strict";
import path from "node:path";
import { fileURLToPath } from "node:url";

import {
  createLsportsSqlFixtureWindowPayload,
  fetchLsportsSqlRawRows,
  normalizeLsportsSqlRows,
  parseLsportsScheduleSql,
  readLsportsSqlLeagueCodes,
} from "../src/backend/fixtureSources/lsportsSql.js";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const SQL_FIXTURE = path.resolve(__dirname, "fixtures/lsports_schedule.sample.sql");

test("lsports sql parser reads fixture rows from a postgres insert dump", () => {
  const rows = parseLsportsScheduleSql(`
    INSERT INTO "lsports_schedule_fixtures" ("id", "fixture_id", "league_id", "league_name", "home_team_name", "away_team_name", "start_time", "status_normalized") VALUES
    (1, 16086295, 8363, 'LaLiga', 'Getafe', 'Barcelona FC', '2026-04-25 14:15:00+00', 'Scheduled');
  `);

  assert.equal(rows.length, 1);
  assert.equal(rows[0].fixture_id, "16086295");
  assert.equal(rows[0].league_name, "LaLiga");
  assert.equal(rows[0].home_team_name, "Getafe");
});

test("lsports sql adapter can filter laliga rows without a database mapping", async () => {
  const rows = await fetchLsportsSqlRawRows({
    leagueCode: "laliga",
    sqlFilePath: SQL_FIXTURE,
    now: new Date("2026-04-10T00:00:00.000Z"),
  });

  assert.equal(rows.length, 1);
  assert.equal(rows[0].league_name, "LaLiga");
  assert.equal(rows[0].home_team_name, "Getafe");
  assert.equal(rows[0].away_team_name, "Barcelona FC");
});

test("lsports sql payload normalizes into rolling upcoming fixtures", () => {
  const fixtures = normalizeLsportsSqlRows([
    {
      fixture_id: "16045061",
      league_id: "65",
      league_name: "Bundesliga",
      home_team_id: "813",
      home_team_name: "1. FC Koln",
      away_team_id: "823",
      away_team_name: "SV Werder Bremen",
      start_time: "2026-04-12 13:30:00+00",
      status_normalized: "Scheduled",
    },
  ]);

  assert.equal(fixtures.length, 1);
  assert.equal(fixtures[0].provider, "lsports-sql");
  assert.equal(fixtures[0].eventName, "1. FC Koln vs SV Werder Bremen");

  const payload = createLsportsSqlFixtureWindowPayload({
    leagueCode: "bundesliga",
    rawRows: [
      {
        fixture_id: "16045061",
        league_id: "65",
        league_name: "Bundesliga",
        home_team_id: "813",
        home_team_name: "1. FC Koln",
        away_team_id: "823",
        away_team_name: "SV Werder Bremen",
        start_time: "2026-04-12 13:30:00+00",
        status_normalized: "Scheduled",
      },
    ],
    now: new Date("2026-04-11T00:00:00.000Z"),
    fetchedAt: "2026-04-11T00:05:00.000Z",
  });

  assert.equal(payload.source, "lsports-sql");
  assert.equal(payload.selection_mode, "rolling-upcoming");
  assert.equal(payload.fixtures.length, 1);
  assert.equal(payload.fixtures[0].provider, "lsports-sql");
});

test("lsports sql source exposes supported league codes from the dump", () => {
  const codes = readLsportsSqlLeagueCodes({
    sqlFilePath: SQL_FIXTURE,
  });

  assert.equal(Array.isArray(codes), true);
  assert.equal(codes.includes("laliga"), true);
  assert.equal(codes.includes("bundesliga"), true);
});
