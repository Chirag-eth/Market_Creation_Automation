import test from "node:test";
import assert from "node:assert/strict";

import { normalizeForSearch } from "../src/shared/util.js";
import {
  resolveBatchLeague,
  resolveBatchTeam,
} from "../src/server/services/batchResolutionService.js";

function aliasEntry(alias, teamName, leagueId) {
  return {
    alias: normalizeForSearch(alias),
    team: {
      id: `${teamName}-${leagueId}`,
      name: teamName,
      leagueId,
    },
  };
}

test("resolveBatchLeague matches canonical schedule aliases", () => {
  const leagues = [
    { id: "1", key: "fifa", name: "FIFA", slug: "fifa", alternateName: "", aliases: ["world cup"] },
    {
      id: "2",
      key: "epl",
      name: "English Premier League",
      slug: "english-premier-league",
      alternateName: "EPL",
      aliases: [],
    },
  ];

  const found = resolveBatchLeague(leagues, "epl");
  assert.ok(found);
  assert.equal(found.id, "2");
});

test("resolveBatchTeam prefers longer partial aliases over short team-code fragments", () => {
  const idx = [
    aliasEntry("hei", "1. FC Heidenheim", "L1"),
    aliasEntry("hoffenheim", "TSG Hoffenheim", "L1"),
    aliasEntry("hof", "TSG Hoffenheim", "L1"),
  ];

  const resolved = resolveBatchTeam(idx, "Hoffenheim", "L1");
  assert.ok(resolved);
  assert.equal(resolved.name, "TSG Hoffenheim");
});

test("resolveBatchTeam excludes aliases <= 4 chars from partial matching", () => {
  const idx = [
    aliasEntry("hei", "1. FC Heidenheim", "L1"),
    aliasEntry("hof", "TSG Hoffenheim", "L1"),
  ];

  const resolved = resolveBatchTeam(idx, "Hoffenheim", "L1");
  assert.equal(resolved, null);
});

test("resolveBatchTeam still allows exact matches for short aliases", () => {
  const idx = [
    aliasEntry("hei", "1. FC Heidenheim", "L1"),
    aliasEntry("hof", "TSG Hoffenheim", "L1"),
  ];

  const resolved = resolveBatchTeam(idx, "HEI", "L1");
  assert.ok(resolved);
  assert.equal(resolved.name, "1. FC Heidenheim");
});
