import test from "node:test";
import assert from "node:assert/strict";

import {
  resolveRawScheduleRowsWithFallback,
  resolveSchedulePayloadWithFallback,
} from "../src/backend/scheduleFallback.js";

test("schedule fallback uses lsports-db immediately after sportsdata failure", async () => {
  const order = [];

  const payload = await resolveSchedulePayloadWithFallback({
    loadSportsData: async () => {
      order.push("sportsdata");
      throw new Error("SPORTSDATA_API_KEY is not configured on the server.");
    },
    loadLsportsDb: async () => {
      order.push("lsports-db");
      return { source: "lsports-db", fixtures: [{ gameId: "db-1" }] };
    },
    loadPolymarket: async () => {
      order.push("polymarket");
      return { source: "polymarket", fixtures: [{ gameId: "poly-1" }] };
    },
    loadLsportsCsv: async () => {
      order.push("lsports-csv");
      return { source: "lsports-csv", fixtures: [{ gameId: "csv-1" }] };
    },
  });

  assert.deepEqual(order, ["sportsdata", "lsports-db"]);
  assert.equal(payload?.source, "lsports-db");
  assert.equal(payload?.fixtures?.[0]?.gameId, "db-1");
});

test("schedule fallback uses polymarket before lsports-csv when lsports-db returns nothing", async () => {
  const order = [];

  const payload = await resolveSchedulePayloadWithFallback({
    loadSportsData: async () => {
      order.push("sportsdata");
      throw new Error("sportsdata failed");
    },
    loadLsportsDb: async () => {
      order.push("lsports-db");
      return null;
    },
    loadPolymarket: async () => {
      order.push("polymarket");
      return { source: "polymarket", fixtures: [{ gameId: "poly-1" }] };
    },
    loadLsportsCsv: async () => {
      order.push("lsports-csv");
      return { source: "lsports-csv", fixtures: [{ gameId: "csv-1" }] };
    },
  });

  assert.deepEqual(order, ["sportsdata", "lsports-db", "polymarket"]);
  assert.equal(payload?.source, "polymarket");
});

test("schedule raw-row fallback preserves the same source order and only reaches csv last", async () => {
  const order = [];

  const rows = await resolveRawScheduleRowsWithFallback({
    loadSportsData: async () => {
      order.push("sportsdata");
      throw new Error("sportsdata failed");
    },
    loadLsportsDb: async () => {
      order.push("lsports-db");
      return [];
    },
    loadPolymarket: async () => {
      order.push("polymarket");
      throw new Error("polymarket failed");
    },
    loadLsportsCsv: async () => {
      order.push("lsports-csv");
      return [{ provider: "lsports-csv", gameId: "csv-1" }];
    },
  });

  assert.deepEqual(order, ["sportsdata", "lsports-db", "polymarket", "lsports-csv"]);
  assert.deepEqual(rows, [{ provider: "lsports-csv", gameId: "csv-1" }]);
});

test("schedule fallback rethrows the original sportsdata failure when every fallback is empty", async () => {
  const sportsDataError = new Error("SPORTSDATA_API_KEY is not configured on the server.");

  await assert.rejects(
    () =>
      resolveSchedulePayloadWithFallback({
        loadSportsData: async () => {
          throw sportsDataError;
        },
        loadLsportsDb: async () => null,
        loadPolymarket: async () => null,
        loadLsportsCsv: async () => null,
      }),
    (error) => {
      assert.equal(error, sportsDataError);
      return true;
    }
  );
});
