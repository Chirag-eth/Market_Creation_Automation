import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

import {
  buildSportsDataScheduleProbeUrl,
  summarizeSportsDataScheduleProbe,
} from "../src/data/scheduleProbe.js";

const __filename = fileURLToPath(import.meta.url);
const WORKSPACE = path.resolve(path.dirname(__filename), "..");
const EPL_FIXTURE_PATH = path.join(WORKSPACE, "tests", "fixtures", "epl_schedule.sample.json");

test("buildSportsDataScheduleProbeUrl builds the provider URL with competition, season, and key", () => {
  const url = buildSportsDataScheduleProbeUrl({
    baseUrl: "https://api.sportsdata.io/v4/soccer/scores/json/Schedule",
    competitionId: 1,
    season: 2026,
    apiKey: "test-key",
  });

  assert.equal(
    url,
    "https://api.sportsdata.io/v4/soccer/scores/json/Schedule/1/2026?key=test-key"
  );
});

test("summarizeSportsDataScheduleProbe returns a compact normalized probe summary", async () => {
  const rows = JSON.parse(await fs.readFile(EPL_FIXTURE_PATH, "utf8"));
  const summary = summarizeSportsDataScheduleProbe(rows, {
    leagueCode: "epl",
    leagueLabel: "EPL",
    url: "https://api.sportsdata.io/example",
    status: 200,
    durationMs: 137,
    referenceNow: new Date("2026-03-16T14:00:00Z"),
  });

  assert.equal(summary.league, "epl");
  assert.equal(summary.league_label, "EPL");
  assert.equal(summary.status, 200);
  assert.equal(summary.duration_ms, 137);
  assert.equal(summary.raw_row_count, 4);
  assert.equal(summary.normalized_fixture_count, 4);
  assert.equal(summary.selected_week, 30);
  assert.deepEqual(summary.selected_weeks, [30, 31]);
  assert.equal(summary.selected_label, "Matchdays 30-31");
  assert.equal(summary.selection_mode, "immediate-six-weeks");
  assert.equal(summary.selected_fixture_count, 3);
  assert.deepEqual(summary.preview_fixtures, [
    {
      eventName: "Brentford FC vs Wolverhampton Wanderers FC",
      gameId: "900002",
      fixtureDate: "2026-03-16",
      kickoffTimeUtc: "20:00",
      matchDay: 30,
    },
    {
      eventName: "AFC Bournemouth vs Manchester United FC",
      gameId: "900003",
      fixtureDate: "2026-03-20",
      kickoffTimeUtc: "20:00",
      matchDay: 31,
    },
    {
      eventName: "Brighton & Hove Albion FC vs Liverpool FC",
      gameId: "900004",
      fixtureDate: "2026-03-21",
      kickoffTimeUtc: "12:30",
      matchDay: 31,
    },
  ]);
});
