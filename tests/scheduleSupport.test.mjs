import test from "node:test";
import assert from "node:assert/strict";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { createScheduleSupportMetadata } from "../src/backend/scheduleSupport.js";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const SQL_FIXTURE = path.resolve(__dirname, "fixtures/lsports_schedule.sample.sql");

test("createScheduleSupportMetadata merges active lsports-backed leagues into ready schedule support", async () => {
  const pool = {
    async query() {
      return {
        rows: [
          {
            cms_league_id: "b0828767-10ab-4288-b18d-a6f2f481b2e8",
            lsports_league_id: "65",
            default_source: "lsports",
            status: "ACTIVE",
          },
        ],
      };
    },
  };

  const payload = await createScheduleSupportMetadata({
    env: {},
    pool,
    leagues: [
      {
        league_id: "b0828767-10ab-4288-b18d-a6f2f481b2e8",
        name: "Bundesliga",
        alternate_name: "Bundesliga",
        association: "DFL",
      },
    ],
  });

  assert.equal(payload.provider, "auto");
  assert.equal(payload.ready_leagues.includes("bundesliga"), true);
  const bundesliga = payload.leagues.find((league) => league.code === "bundesliga");
  assert.equal(bundesliga?.ready, true);
  assert.equal(bundesliga?.config_source, "lsports-db-default");
});

test("createScheduleSupportMetadata marks sql-backed leagues as ready when the dump is configured", async () => {
  const payload = await createScheduleSupportMetadata({
    env: {
      LSPORTS_SCHEDULE_SQL_PATH: SQL_FIXTURE,
    },
    pool: null,
    leagues: [],
  });

  assert.equal(payload.provider, "auto");
  assert.equal(payload.ready_leagues.includes("laliga"), true);
  assert.equal(payload.ready_leagues.includes("bundesliga"), true);
  const bundesliga = payload.leagues.find((league) => league.code === "bundesliga");
  assert.equal(bundesliga?.ready, true);
  assert.equal(bundesliga?.config_source, "lsports-sql");
});

test("createScheduleSupportMetadata only marks polymarket leagues ready when an explicit slug is configured", async () => {
  const withoutSlug = await createScheduleSupportMetadata({
    env: {
      POLYMARKET_SCHEDULE_ENABLED: "1",
    },
    pool: null,
    leagues: [],
  });

  assert.equal(withoutSlug.ready_leagues.includes("ligue1"), false);
  assert.equal(withoutSlug.ready_leagues.includes("europa"), false);

  const withSlug = await createScheduleSupportMetadata({
    env: {
      POLYMARKET_SCHEDULE_ENABLED: "1",
      POLYMARKET_LIGUE1_LEAGUE_SLUG: "ligue-1",
      POLYMARKET_EUROPA_LEAGUE_SLUG: "europa-league",
    },
    pool: null,
    leagues: [],
  });

  assert.equal(withSlug.ready_leagues.includes("ligue1"), true);
  assert.equal(withSlug.ready_leagues.includes("europa"), true);
  assert.equal(withSlug.leagues.find((league) => league.code === "ligue1")?.config_source, "polymarket");
  assert.equal(withSlug.leagues.find((league) => league.code === "europa")?.config_source, "polymarket");
});
