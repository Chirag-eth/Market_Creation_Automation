import test from "node:test";
import assert from "node:assert/strict";

import {
  buildAutoScheduleSourceCandidates,
  buildScheduleCacheKey,
  normalizeMappedScheduleSource,
  normalizeScheduleSource,
  SCHEDULE_SOURCE_AUTO,
  SCHEDULE_SOURCE_LSPORTS_CSV,
  SCHEDULE_SOURCE_LSPORTS_DB,
  SCHEDULE_SOURCE_LSPORTS_SQL,
  SCHEDULE_SOURCE_POLYMARKET,
  SCHEDULE_SOURCE_PRED_APP,
  SCHEDULE_SOURCE_SPORTSDATA,
} from "../src/backend/scheduleSources.js";

test("normalizeScheduleSource supports auto, pred-app, sportsdata, lsports-db, and lsports-sql aliases", () => {
  assert.equal(normalizeScheduleSource(""), SCHEDULE_SOURCE_AUTO);
  assert.equal(normalizeScheduleSource("auto"), SCHEDULE_SOURCE_AUTO);
  assert.equal(normalizeScheduleSource("pred-app"), SCHEDULE_SOURCE_PRED_APP);
  assert.equal(normalizeScheduleSource("pred_app"), SCHEDULE_SOURCE_PRED_APP);
  assert.equal(normalizeScheduleSource("predapp"), SCHEDULE_SOURCE_PRED_APP);
  assert.equal(normalizeScheduleSource("sportsdata"), SCHEDULE_SOURCE_SPORTSDATA);
  assert.equal(normalizeScheduleSource("sports-data"), SCHEDULE_SOURCE_SPORTSDATA);
  assert.equal(normalizeScheduleSource("lsports-db"), SCHEDULE_SOURCE_LSPORTS_DB);
  assert.equal(normalizeScheduleSource("lsports"), SCHEDULE_SOURCE_LSPORTS_DB);
  assert.equal(normalizeScheduleSource("db"), SCHEDULE_SOURCE_LSPORTS_DB);
  assert.equal(normalizeScheduleSource("lsports-sql"), SCHEDULE_SOURCE_LSPORTS_SQL);
  assert.equal(normalizeScheduleSource("sql"), SCHEDULE_SOURCE_LSPORTS_SQL);
});

test("normalizeMappedScheduleSource falls back to auto when no supported mapping exists", () => {
  assert.equal(normalizeMappedScheduleSource("sportsdata"), SCHEDULE_SOURCE_SPORTSDATA);
  assert.equal(normalizeMappedScheduleSource("lsports_db"), SCHEDULE_SOURCE_LSPORTS_DB);
  assert.equal(normalizeMappedScheduleSource("unknown"), SCHEDULE_SOURCE_AUTO);
});

test("buildScheduleCacheKey separates environment, source, league, and explicit reference times", () => {
  assert.equal(
    buildScheduleCacheKey({ environmentCode: "mainnet", leagueCode: "laliga", source: "sportsdata" }),
    "mainnet::sportsdata::laliga"
  );
  assert.equal(
    buildScheduleCacheKey({
      environmentCode: "uat",
      leagueCode: "epl",
      source: "lsports-db",
      referenceNowIso: "2026-04-09T07:00:00.000Z",
    }),
    "uat::lsports-db::epl::2026-04-09T07:00:00.000Z"
  );
});

test("buildAutoScheduleSourceCandidates uses sportsdata, lsports-db, polymarket, then lsports-csv", () => {
  assert.deepEqual(buildAutoScheduleSourceCandidates(), [
    SCHEDULE_SOURCE_SPORTSDATA,
    SCHEDULE_SOURCE_LSPORTS_DB,
    SCHEDULE_SOURCE_POLYMARKET,
    SCHEDULE_SOURCE_LSPORTS_CSV,
  ]);
  assert.deepEqual(buildAutoScheduleSourceCandidates("sportsdata"), [
    SCHEDULE_SOURCE_SPORTSDATA,
    SCHEDULE_SOURCE_LSPORTS_DB,
    SCHEDULE_SOURCE_POLYMARKET,
    SCHEDULE_SOURCE_LSPORTS_CSV,
  ]);
  assert.deepEqual(buildAutoScheduleSourceCandidates("pred-app"), [
    SCHEDULE_SOURCE_PRED_APP,
    SCHEDULE_SOURCE_SPORTSDATA,
    SCHEDULE_SOURCE_LSPORTS_DB,
    SCHEDULE_SOURCE_POLYMARKET,
    SCHEDULE_SOURCE_LSPORTS_CSV,
  ]);
  assert.deepEqual(buildAutoScheduleSourceCandidates("lsports-db"), [
    SCHEDULE_SOURCE_LSPORTS_DB,
    SCHEDULE_SOURCE_SPORTSDATA,
    SCHEDULE_SOURCE_POLYMARKET,
    SCHEDULE_SOURCE_LSPORTS_CSV,
  ]);
  assert.deepEqual(buildAutoScheduleSourceCandidates("sportsdata", ["lsports-sql"]), [
    SCHEDULE_SOURCE_SPORTSDATA,
    SCHEDULE_SOURCE_LSPORTS_SQL,
    SCHEDULE_SOURCE_LSPORTS_DB,
    SCHEDULE_SOURCE_POLYMARKET,
    SCHEDULE_SOURCE_LSPORTS_CSV,
  ]);
});
