import test from "node:test";
import assert from "node:assert/strict";

import {
  applyCmsBatchExclusions,
  buildCmsBatchRunSummary,
  getCmsBatchFixtureKey,
  normalizeCmsBatchEnvelope,
  summarizeCmsBatchAggregate,
  validateCmsBatchEnvelope,
} from "../src/backend/cmsBatchPublish.js";

test("cms batch envelope normalizes fixtures, publish keys, and exclusions", () => {
  const envelope = normalizeCmsBatchEnvelope({
    selected_fixtures: [
      {
        game_id: "1001",
        event_name: "Arsenal vs Chelsea",
        fixture_date: "2026-04-15",
        kickoff_time_utc: "17:30",
        league_code: "epl",
      },
      {
        game_id: "1001",
        event_name: "Arsenal vs Chelsea",
        fixture_date: "2026-04-15",
        kickoff_time_utc: "17:30",
        league_code: "epl",
      },
    ],
    selected_publish_keys: ["moneyline|0", "moneyline|0", "btts|0", "bad-key"],
    per_fixture_exclusions: {
      "1001": {
        excluded_fixture: true,
        excluded_publish_keys: ["btts|0", "btts|0", "bad-key"],
      },
    },
    confirmation: {
      operator_name: "Chirag",
      fixture_count: "1",
      confirmed: true,
    },
  });

  assert.equal(envelope.selectedFixtures.length, 1);
  assert.deepEqual(envelope.selectedPublishKeys, ["moneyline|0", "btts|0"]);
  assert.equal(envelope.perFixtureExclusions["1001"].excluded_fixture, true);
  assert.deepEqual(envelope.perFixtureExclusions["1001"].excluded_publish_keys, ["btts|0"]);
  assert.equal(envelope.confirmation.operator_name, "Chirag");
  assert.equal(envelope.confirmation.fixture_count, "1");
  assert.equal(envelope.confirmation.confirmed, true);
});

test("cms batch validation enforces selected fixtures and publish confirmation", () => {
  const base = normalizeCmsBatchEnvelope({
    selected_fixtures: [
      {
        game_id: "1001",
        event_name: "Arsenal vs Chelsea",
        fixture_date: "2026-04-15",
        kickoff_time_utc: "17:30",
        league_code: "epl",
      },
    ],
    selected_publish_keys: ["moneyline|0"],
  });

  assert.deepEqual(validateCmsBatchEnvelope(base), []);

  const publishing = {
    ...base,
    confirmation: {
      operator_name: "Chirag",
      fixture_count: "1",
      confirmed: true,
    },
  };
  assert.deepEqual(validateCmsBatchEnvelope(publishing, { publishing: true }), []);

  const invalidPublishing = {
    ...base,
    confirmation: {
      operator_name: "",
      fixture_count: "2",
      confirmed: false,
    },
  };
  assert.deepEqual(
    validateCmsBatchEnvelope(invalidPublishing, { publishing: true }),
    ["payload.confirmation.operator_name", "payload.confirmation.fixture_count", "payload.confirmation.confirmed"]
  );
});

test("cms batch exclusions preserve global selection while removing excluded keys", () => {
  const fixture = {
    game_id: "1001",
    event_name: "Arsenal vs Chelsea",
    fixture_date: "2026-04-15",
    kickoff_time_utc: "17:30",
    league_code: "epl",
  };

  const applied = applyCmsBatchExclusions(
    ["moneyline|0", "btts|0", "totals|1.5"],
    {
      [getCmsBatchFixtureKey(fixture)]: {
        excluded_fixture: false,
        excluded_publish_keys: ["btts|0"],
      },
    },
    fixture
  );

  assert.equal(applied.excluded_fixture, false);
  assert.deepEqual(applied.excluded_publish_keys, ["btts|0"]);
  assert.deepEqual(applied.publish_keys, ["moneyline|0", "totals|1.5"]);
});

test("cms batch aggregate and summary classify partial and stop-related runs", () => {
  const fixtures = [
    {
      status: "completed",
      markets: [
        { status: "published" },
        { status: "existing" },
      ],
    },
    {
      status: "partial",
      markets: [
        { status: "failed" },
        { status: "missing" },
        { status: "excluded" },
      ],
    },
  ];

  const aggregate = summarizeCmsBatchAggregate(fixtures);
  assert.equal(aggregate.fixtures_total, 2);
  assert.equal(aggregate.fixtures_completed, 1);
  assert.equal(aggregate.fixtures_partial, 1);
  assert.equal(aggregate.markets_published, 1);
  assert.equal(aggregate.markets_existing, 1);
  assert.equal(aggregate.markets_failed, 1);
  assert.equal(aggregate.markets_missing, 1);
  assert.equal(aggregate.markets_excluded, 1);

  const partialSummary = buildCmsBatchRunSummary({ aggregate });
  assert.match(partialSummary.summary, /partially completed/i);
  assert.equal(partialSummary.tone, "warn");

  const stoppedSummary = buildCmsBatchRunSummary({
    status: "stopped",
    stop_requested: true,
    aggregate,
  });
  assert.match(stoppedSummary.summary, /stopped by operator/i);
  assert.equal(stoppedSummary.tone, "warn");
});
