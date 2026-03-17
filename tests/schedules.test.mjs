import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

import {
  fetchUpcomingFixturesForLeague,
  normalizeSportsDataRows,
  normalizeSportsDataRow,
  resolveScheduleLeagueCode,
  selectUpcomingSportsDataWeek,
} from "../src/data/schedules.js";

const __filename = fileURLToPath(import.meta.url);
const WORKSPACE = path.resolve(path.dirname(__filename), "..");
const FIXTURE_PATH = path.join(WORKSPACE, "tests", "fixtures", "epl_schedule.sample.json");

test("resolveScheduleLeagueCode recognizes EPL league metadata", () => {
  assert.equal(
    resolveScheduleLeagueCode({
      key: "epl",
      name: "English Premier League",
      alternateName: "EPL",
    }),
    "epl"
  );

  assert.equal(
    resolveScheduleLeagueCode({
      key: "ucl",
      name: "UEFA Champions League",
    }),
    "ucl"
  );

  assert.equal(
    resolveScheduleLeagueCode({
      key: "laliga",
      name: "La Liga",
    }),
    "laliga"
  );
});

test("normalizeSportsDataRow builds fixture event name and UTC date/time fields", () => {
  const fixture = normalizeSportsDataRow({
    GameId: 123,
    Week: 31,
    DateTime: "2026-03-20T20:00:00",
    Status: "Scheduled",
    HomeTeamName: "AFC Bournemouth",
    AwayTeamName: "Manchester United FC",
  });

  assert.equal(fixture?.eventName, "AFC Bournemouth vs Manchester United FC");
  assert.equal(fixture?.fixtureDate, "2026-03-20");
  assert.equal(fixture?.kickoffTimeUtc, "20:00");
  assert.equal(fixture?.matchDay, 31);
  assert.equal(fixture?.gameId, "123");
  assert.equal(fixture?.game_id, "123");
});

test("selectUpcomingSportsDataWeek returns the next two upcoming matchdays", async () => {
  const raw = JSON.parse(await fs.readFile(FIXTURE_PATH, "utf8"));
  const selection = selectUpcomingSportsDataWeek(raw, {
    now: new Date("2026-03-16T14:00:00Z"),
  });

  assert.equal(selection.selectedWeek, 30);
  assert.deepEqual(selection.selectedWeeks, [30, 31]);
  assert.equal(selection.selectedLabel, "Matchdays 30-31");
  assert.equal(selection.selectionMode, "immediate-two-weeks");
  assert.equal(selection.fixtures.length, 3);
  assert.equal(selection.fixtures[0]?.eventName, "Brentford FC vs Wolverhampton Wanderers FC");
  assert.equal(selection.fixtures[1]?.eventName, "AFC Bournemouth vs Manchester United FC");
  assert.equal(selection.fixtures[2]?.eventName, "Brighton & Hove Albion FC vs Liverpool FC");
});

test("normalizeSportsDataRows supports zip-project round payloads", () => {
  const fixtures = normalizeSportsDataRows([
    {
      CurrentRound: true,
      Name: "Matchday 31",
      Games: [
        {
          GameId: 123,
          DateTime: "2026-03-20T20:00:00",
          HomeTeamName: "AFC Bournemouth",
          AwayTeamName: "Manchester United FC",
        },
      ],
    },
  ]);

  assert.equal(fixtures.length, 1);
  assert.equal(fixtures[0]?.eventName, "AFC Bournemouth vs Manchester United FC");
  assert.equal(fixtures[0]?.matchDay, 31);
  assert.equal(fixtures[0]?.roundLabel, "Matchday 31");
});

test("fetchUpcomingFixturesForLeague requests a fresh same-origin schedule payload with reference time", async () => {
  const originalFetch = globalThis.fetch;
  let capturedUrl = "";
  let capturedInit = null;

  globalThis.fetch = async (url, init) => {
    capturedUrl = String(url || "");
    capturedInit = init || null;
    return {
      ok: true,
      async json() {
        return { fixtures: [] };
      },
    };
  };

  try {
    const payload = await fetchUpcomingFixturesForLeague("epl", {
      referenceNowIso: "2026-03-16T14:00:00.000Z",
    });
    assert.deepEqual(payload, { fixtures: [] });
    assert.match(capturedUrl, /\/api\/schedules\/upcoming\?league=epl&refresh=1&now=2026-03-16T14%3A00%3A00.000Z$/);
    assert.equal(capturedInit?.cache, "no-store");
    assert.equal(capturedInit?.credentials, "same-origin");
    assert.equal(capturedInit?.headers?.Accept, "application/json");
  } finally {
    globalThis.fetch = originalFetch;
  }
});
