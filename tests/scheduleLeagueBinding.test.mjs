import test from "node:test";
import assert from "node:assert/strict";

import { resolveCatalogLeagueScheduleCode } from "../src/shared/scheduleLeagueBinding.js";

test("resolveCatalogLeagueScheduleCode binds a generic FIFA catalog league to the single ready FIFA schedule lane", () => {
  const scheduleCode = resolveCatalogLeagueScheduleCode(
    {
      key: "fifa",
      slug: "fifa",
      name: "International Federation of Association Football",
      alternateName: "FIFA",
      aliases: ["International Federation of Association Football", "FIFA"],
    },
    { readyLeagueCodes: ["fifa-friendlies"] }
  );

  assert.equal(scheduleCode, "fifa-friendlies");
});

test("resolveCatalogLeagueScheduleCode stays unresolved for a generic FIFA catalog league when multiple FIFA lanes are ready", () => {
  const scheduleCode = resolveCatalogLeagueScheduleCode(
    {
      key: "fifa",
      slug: "fifa",
      name: "International Federation of Association Football",
      alternateName: "FIFA",
      aliases: ["International Federation of Association Football", "FIFA"],
    },
    { readyLeagueCodes: ["fifa-friendlies", "fifa-worldcup"] }
  );

  assert.equal(scheduleCode, "");
});

test("resolveCatalogLeagueScheduleCode still resolves direct non-FIFA matches without readiness hints", () => {
  const scheduleCode = resolveCatalogLeagueScheduleCode({
    key: "ucl",
    slug: "ucl",
    name: "UEFA Champions League",
    alternateName: "UCL",
    aliases: ["UEFA Champions League", "UCL"],
  });

  assert.equal(scheduleCode, "ucl");
});
