import test from "node:test";
import assert from "node:assert/strict";

import { resolveBatchLeague } from "../server.js";
import { normalizeLeagueRows } from "../src/data/catalog.js";

test("resolveBatchLeague maps schedule league codes onto catalog league aliases", () => {
  const leagues = normalizeLeagueRows([
    {
      league_id: "laliga-1",
      name: "LaLiga",
      alternate_name: "Spanish La Liga",
      association: "Spain",
    },
    {
      league_id: "epl-1",
      name: "Premier League",
      alternate_name: "English Premier League",
      association: "England",
    },
  ]);

  assert.equal(resolveBatchLeague(leagues, "laliga")?.id, "laliga-1");
  assert.equal(resolveBatchLeague(leagues, "la liga")?.id, "laliga-1");
  assert.equal(resolveBatchLeague(leagues, "epl")?.id, "epl-1");
});
