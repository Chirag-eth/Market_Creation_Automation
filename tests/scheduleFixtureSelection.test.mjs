import test from "node:test";
import assert from "node:assert/strict";

import { resolveAppliedMatchDayValue } from "../src/shared/scheduleFixtureSelection.js";

test("resolveAppliedMatchDayValue preserves a manual match day when the selected fixture has no numeric matchday", () => {
  assert.equal(
    resolveAppliedMatchDayValue({
      existingMatchDayValue: "1",
      fixtureMatchDay: null,
    }),
    "1"
  );
});

test("resolveAppliedMatchDayValue uses the fixture matchday when it exists", () => {
  assert.equal(
    resolveAppliedMatchDayValue({
      existingMatchDayValue: "1",
      fixtureMatchDay: 31,
    }),
    "31"
  );
});

test("resolveAppliedMatchDayValue returns blank when neither a manual nor fixture matchday is present", () => {
  assert.equal(
    resolveAppliedMatchDayValue({
      existingMatchDayValue: "",
      fixtureMatchDay: null,
    }),
    ""
  );
});
