import test from "node:test";
import assert from "node:assert/strict";

import { assignTypeRefsToFixtures, parseTypeRefLines } from "../src/typeRefs.js";

function makeFixture(name) {
  return {
    bundle: {
      fixtureJson: { name },
    },
    homeTeamName: name.split(" vs ")[0],
    awayTeamName: name.split(" vs ")[1],
    sourceLine: name,
    typeReferenceId: "",
  };
}

test("parseTypeRefLines supports ordered and mapped lines", () => {
  const raw = [
    "872329ce-4891-4a9c-b203-4e71ff20d4d3",
    "Real Madrid vs Benfica,11111111-1111-4111-8111-111111111111",
  ].join("\n");

  const parsed = parseTypeRefLines(raw);
  assert.equal(parsed.errors.length, 0);
  assert.equal(parsed.entries.length, 2);
  assert.equal(parsed.entries[0].mode, "ordered");
  assert.equal(parsed.entries[1].mode, "mapped");
});

test("assignTypeRefsToFixtures applies mapped first then ordered", () => {
  const fixtures = [
    makeFixture("Real Madrid vs Benfica"),
    makeFixture("Wolves vs Aston Villa"),
  ];

  const parsed = parseTypeRefLines([
    "Wolves vs Aston Villa,22222222-2222-4222-8222-222222222222",
    "33333333-3333-4333-8333-333333333333",
  ].join("\n"));

  const report = assignTypeRefsToFixtures(fixtures, parsed.entries);
  assert.equal(report.applied, 2);
  assert.equal(report.mappedApplied, 1);
  assert.equal(report.orderedApplied, 1);

  assert.equal(fixtures[1].typeReferenceId, "22222222-2222-4222-8222-222222222222");
  assert.equal(fixtures[0].typeReferenceId, "33333333-3333-4333-8333-333333333333");
});

test("parseTypeRefLines supports quoted fixture labels containing commas", () => {
  const raw = "\"Wolves, FC vs Aston Villa\",44444444-4444-4444-8444-444444444444";
  const parsed = parseTypeRefLines(raw);
  assert.equal(parsed.errors.length, 0);
  assert.equal(parsed.entries.length, 1);
  assert.equal(parsed.entries[0].mode, "mapped");
  assert.equal(parsed.entries[0].fixtureLabel, "Wolves, FC vs Aston Villa");
  assert.equal(parsed.entries[0].typeReferenceId, "44444444-4444-4444-8444-444444444444");
});
