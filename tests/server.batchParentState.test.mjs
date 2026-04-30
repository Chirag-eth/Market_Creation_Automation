import test from "node:test";
import assert from "node:assert/strict";

import {
  classifyExistingBatchParentMarketRows,
  deriveBatchFixtureStatusFromMarkets,
  deriveBatchRunStatusFromFixtures,
} from "../server.js";

test("batch existing-parent classifier marks totals row as half_prepared when child market ids are missing", () => {
  const rows = [
    {
      parent_market_id: "d9b269b9-ea68-40de-891a-fbbaac55e75a",
      type_reference_id: "74c76cda-a826-417a-b45f-6f1052df5405",
      title: "Total Over 2.5 Goals",
      parent_market_family: "totals",
      market_line: "2.5",
      market_id: null,
      team_id: "",
      market_name: "",
      market_code: "",
    },
  ];

  const classification = classifyExistingBatchParentMarketRows(rows, {
    publishKey: "totals|2.5",
  });

  assert.equal(classification.status, "half_prepared");
  assert.match(String(classification.warnings[0] || ""), /without any market rows/i);
});

test("batch existing-parent classifier marks totals row as existing when expected child market id exists", () => {
  const rows = [
    {
      parent_market_id: "d9b269b9-ea68-40de-891a-fbbaac55e75a",
      type_reference_id: "74c76cda-a826-417a-b45f-6f1052df5405",
      title: "Total Over 2.5 Goals",
      parent_market_family: "totals",
      market_line: "2.5",
      market_id: "0xab886cbc63ebc715054086d646cd365f04244b5e6da75e5532007492fe365000",
      team_id: "",
      market_name: "Over 2.5 Goals",
      market_code: "Over 2.5",
    },
  ];

  const classification = classifyExistingBatchParentMarketRows(rows, {
    publishKey: "totals|2.5",
  });

  assert.equal(classification.status, "existing");
  assert.equal(classification.confirmed_count, 1);
});

test("batch fixture status becomes partial when any market is half_prepared", () => {
  const status = deriveBatchFixtureStatusFromMarkets([
    { publish_key: "moneyline|0", status: "published" },
    { publish_key: "totals|2.5", status: "half_prepared" },
  ]);

  assert.equal(status, "partial");
});

test("batch run status becomes partial when a fixture is partial", () => {
  const status = deriveBatchRunStatusFromFixtures([
    { fixture_key: "fix-1", status: "completed" },
    { fixture_key: "fix-2", status: "partial" },
  ]);

  assert.equal(status, "partial");
});
