import { isValidUuid, normalizeForSearch } from "../shared/util.js";

export function parseTypeRefLines(rawInput) {
  const entries = [];
  const errors = [];

  const lines = String(rawInput || "").split(/\r?\n/);
  for (let idx = 0; idx < lines.length; idx += 1) {
    const raw = lines[idx];
    const line = String(raw || "").trim();
    if (!line) {
      continue;
    }

    const parsed = parseTypeRefLine(line, idx + 1);
    if (parsed.error) {
      errors.push(parsed.error);
      continue;
    }
    entries.push(parsed.entry);
  }

  return { entries, errors };
}

export function assignTypeRefsToFixtures(fixtures, parsedEntries) {
  const safeFixtures = Array.isArray(fixtures) ? fixtures : [];
  const entries = Array.isArray(parsedEntries) ? parsedEntries : [];

  const report = {
    applied: 0,
    mappedApplied: 0,
    orderedApplied: 0,
    unmatchedMappings: [],
    ambiguousMappings: [],
    unusedOrderedEntries: 0,
    warnings: [],
    fixtureAssignments: [],
  };

  const indexedFixtures = safeFixtures.map((fixture, index) => ({
    fixture,
    index,
    keys: buildFixtureKeys(fixture, index),
  }));

  const assignedIndices = new Set();
  const mappedEntries = entries.filter((e) => e.mode === "mapped");
  const orderedEntries = entries.filter((e) => e.mode === "ordered");

  for (const entry of mappedEntries) {
    const matches = indexedFixtures.filter((item) => item.keys.has(entry.fixtureKey));
    if (!matches.length) {
      report.unmatchedMappings.push({
        lineNumber: entry.lineNumber,
        fixtureLabel: entry.fixtureLabel,
        typeReferenceId: entry.typeReferenceId,
      });
      continue;
    }

    const preferred = matches.find((item) => !assignedIndices.has(item.index)) || matches[0];
    if (matches.length > 1) {
      report.ambiguousMappings.push({
        lineNumber: entry.lineNumber,
        fixtureLabel: entry.fixtureLabel,
        matchedFixtureCount: matches.length,
        chosenFixtureIndex: preferred.index,
      });
    }

    preferred.fixture.typeReferenceId = entry.typeReferenceId;
    assignedIndices.add(preferred.index);
    report.applied += 1;
    report.mappedApplied += 1;
    report.fixtureAssignments.push({
      fixtureIndex: preferred.index,
      fixtureName: getFixtureDisplayName(preferred.fixture, preferred.index),
      typeReferenceId: entry.typeReferenceId,
      source: `mapped line ${entry.lineNumber}`,
    });
  }

  const remainingFixtures = indexedFixtures.filter((item) => !assignedIndices.has(item.index));
  for (let i = 0; i < orderedEntries.length; i += 1) {
    const entry = orderedEntries[i];
    const target = remainingFixtures[i];
    if (!target) {
      report.unusedOrderedEntries += 1;
      continue;
    }

    target.fixture.typeReferenceId = entry.typeReferenceId;
    assignedIndices.add(target.index);
    report.applied += 1;
    report.orderedApplied += 1;
    report.fixtureAssignments.push({
      fixtureIndex: target.index,
      fixtureName: getFixtureDisplayName(target.fixture, target.index),
      typeReferenceId: entry.typeReferenceId,
      source: `ordered line ${entry.lineNumber}`,
    });
  }

  if (report.ambiguousMappings.length) {
    report.warnings.push(
      `${report.ambiguousMappings.length} mapped line(s) matched multiple fixtures and were assigned to the first unassigned match.`
    );
  }

  return report;
}

function parseTypeRefLine(line, lineNumber) {
  const directUuid = line.trim();
  if (isValidUuid(directUuid)) {
    return {
      entry: {
        mode: "ordered",
        typeReferenceId: directUuid,
        lineNumber,
        raw: line,
      },
    };
  }

  const split = splitMappedLine(line);
  if (!split) {
    return {
      error: `Line ${lineNumber}: expected a UUID or "fixture name, UUID" format.`,
    };
  }

  const fixtureLabel = split.left.trim();
  const typeReferenceId = split.right.trim();
  if (!fixtureLabel) {
    return { error: `Line ${lineNumber}: fixture name is empty.` };
  }
  if (!isValidUuid(typeReferenceId)) {
    return { error: `Line ${lineNumber}: invalid UUID "${typeReferenceId}".` };
  }

  return {
    entry: {
      mode: "mapped",
      lineNumber,
      raw: line,
      fixtureLabel,
      fixtureKey: normalizeForSearch(fixtureLabel),
      typeReferenceId,
    },
  };
}

function splitMappedLine(line) {
  for (const sep of ["\t", "=>", "|"]) {
    const idx = line.indexOf(sep);
    if (idx === -1) {
      continue;
    }
    return {
      left: line.slice(0, idx),
      right: line.slice(idx + sep.length),
    };
  }

  return splitMappedCsvLine(line);
}

function splitMappedCsvLine(line) {
  const text = String(line || "");
  let inQuotes = false;
  let lastCommaIndex = -1;

  for (let i = 0; i < text.length; i += 1) {
    const ch = text[i];
    if (ch === '"') {
      const next = text[i + 1];
      if (inQuotes && next === '"') {
        i += 1;
        continue;
      }
      inQuotes = !inQuotes;
      continue;
    }
    if (ch === "," && !inQuotes) {
      lastCommaIndex = i;
    }
  }

  if (lastCommaIndex === -1) {
    return null;
  }

  return {
    left: unwrapCsvQuotedValue(text.slice(0, lastCommaIndex)),
    right: text.slice(lastCommaIndex + 1),
  };
}

function unwrapCsvQuotedValue(rawValue) {
  const value = String(rawValue || "").trim();
  if (value.length >= 2 && value.startsWith('"') && value.endsWith('"')) {
    return value.slice(1, -1).replace(/""/g, '"');
  }
  return value;
}

function buildFixtureKeys(fixture, index) {
  const keys = new Set();
  const fixtureName = String(fixture?.bundle?.fixtureJson?.name || "").trim();
  const home = String(fixture?.homeTeamName || fixture?.bundle?.meta?.homeTeam?.name || "").trim();
  const away = String(fixture?.awayTeamName || fixture?.bundle?.meta?.awayTeam?.name || "").trim();
  const sourceLine = String(fixture?.sourceLine || "").trim();

  for (const candidate of [
    fixtureName,
    sourceLine,
    home && away ? `${home} vs ${away}` : "",
    home && away ? `${home} v ${away}` : "",
    home && away ? `${away} vs ${home}` : "",
    String(index + 1),
    `#${index + 1}`,
    `fixture ${index + 1}`,
  ]) {
    const normalized = normalizeForSearch(candidate);
    if (normalized) {
      keys.add(normalized);
    }
  }

  return keys;
}

function getFixtureDisplayName(fixture, index) {
  return (
    String(fixture?.bundle?.fixtureJson?.name || "").trim() ||
    String(fixture?.sourceLine || "").trim() ||
    `Fixture ${index + 1}`
  );
}
