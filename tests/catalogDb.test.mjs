import test from "node:test";
import assert from "node:assert/strict";

import {
  normalizeDbLeagueRows,
  normalizeDbTeamRows,
  resolveCatalogSourcePreference,
} from "../src/backend/catalogDb.js";

test("resolveCatalogSourcePreference accepts db/csv and defaults to auto", () => {
  assert.equal(resolveCatalogSourcePreference({ CATALOG_SOURCE: "db" }), "db");
  assert.equal(resolveCatalogSourcePreference({ CATALOG_SOURCE: "database" }), "db");
  assert.equal(resolveCatalogSourcePreference({ CATALOG_SOURCE: "csv" }), "csv");
  assert.equal(resolveCatalogSourcePreference({ CATALOG_SOURCE: "files" }), "csv");
  assert.equal(resolveCatalogSourcePreference({}), "auto");
});

test("normalizeDbLeagueRows keeps DB league rows in catalog-compatible shape", () => {
  const leagues = normalizeDbLeagueRows(
    [
      {
        league_id: "de1bd252-baf5-4417-89ba-77d635f5f8f0",
        name: "English Premier League",
        alternate_name: "EPL",
        association: "Premier League",
        country: "England",
        sport: "Soccer",
        theme_color: "#123456",
        start: new Date("2025-10-18T00:00:00.000Z"),
        end: new Date("2026-05-20T00:00:00.000Z"),
        match_duration_in_minutes: 90,
        status: "active",
        created_at: new Date("2026-04-09T10:00:00.000Z"),
      },
    ],
    { now: new Date("2026-04-09T10:30:00.000Z") }
  );

  assert.equal(leagues.length, 1);
  assert.equal(leagues[0].league_id, "de1bd252-baf5-4417-89ba-77d635f5f8f0");
  assert.equal(leagues[0].alternate_name, "EPL");
  assert.equal(leagues[0].association, "Premier League");
  assert.equal(leagues[0].match_duration_in_minutes, 90);
  assert.equal(leagues[0].start_adjusted, "1");
  assert.match(String(leagues[0].start || ""), /^2026-04-09 10:31:00\+00$/);
});

test("normalizeDbTeamRows keeps DB team rows in catalog-compatible shape", () => {
  const teams = normalizeDbTeamRows([
    {
      team_id: "11cccd75-3ccd-4b7c-8b85-a9e8f2216c3d",
      league_id: "de1bd252-baf5-4417-89ba-77d635f5f8f0",
      name: "Aston Villa",
      alternate_name: "Aston Villa FC",
      team_location: "Birmingham",
      logo_url: "https://example.com/aston-villa.png",
      theme_color: "#670E36",
      created_at: new Date("2026-04-09T10:00:00.000Z"),
      updated_at: new Date("2026-04-09T11:00:00.000Z"),
    },
  ]);

  assert.deepEqual(teams, [
    {
      team_id: "11cccd75-3ccd-4b7c-8b85-a9e8f2216c3d",
      league_id: "de1bd252-baf5-4417-89ba-77d635f5f8f0",
      name: "Aston Villa",
      alternate_name: "Aston Villa FC",
      team_location: "Birmingham",
      logo_url: "https://example.com/aston-villa.png",
      theme_color: "#670E36",
      created_at: "2026-04-09T10:00:00.000Z",
      updated_at: "2026-04-09T11:00:00.000Z",
    },
  ]);
});
