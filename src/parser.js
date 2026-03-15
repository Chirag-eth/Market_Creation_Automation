import { DEFAULT_MARKETS_OPEN_LEAD_HOURS, FIXTURE_LOGO_URL } from "./constants.js";
import {
  formatYyyyMmDd,
  generateCodeFromName,
  normalizeForSearch,
  normalizeHexColor,
  normalizeYear,
  slugify,
  toTitleLike,
  tokenOverlapScore,
} from "./util.js";

export function inferFixturesFromOcrArtifacts(ocrArtifacts, { leagues, teams, teamAliasIndex } = {}) {
  const text = String(ocrArtifacts?.text || "");
  const normalizedLines = normalizeArtifactLines(ocrArtifacts?.lines || []);
  const normalizedWords = normalizeArtifactWords(ocrArtifacts?.words || []);
  const synthesizedFromWords = synthesizeLinesFromWords(normalizedWords);
  const geometryLines =
    normalizedLines.length >= 2
      ? normalizedLines
      : synthesizedFromWords.length
        ? synthesizedFromWords
        : normalizedLines;
  const context = {
    leagues: leagues || [],
    teams: teams || [],
    teamAliasIndex: teamAliasIndex || [],
  };

  const fallback = inferFixturesFromText(text, context);
  if (!geometryLines.length) {
    return fallback;
  }

  const baseInference = inferFixtureFromText(text, context);
  const baseKickoffInfo = parseKickoffTimeInfo(text);
  const preferredLeagueId = baseInference?.leagueId || null;
  const baseLeague = resolveLeagueFromInference(baseInference, context.leagues);
  const rowBands = groupOcrLinesIntoRows(geometryLines);

  const pairs = detectFixturePairsFromOcrRows(rowBands, {
    preferredLeagueId,
    teams: context.teams,
    teamAliasIndex: context.teamAliasIndex,
  });

  if (!pairs.length) {
    const notes = Array.isArray(fallback.notes) ? [...fallback.notes] : [];
    notes.unshift("OCR geometry parser found no row-based fixture pairs; using text-only parser.");
    return {
      ...fallback,
      fixtures: (fallback.fixtures || []).map((fixture) => ({
        ...fixture,
        source: {
          ...(fixture?.source || {}),
          kind: "ocr-text-fallback",
        },
      })),
      notes,
    };
  }

  const isMultiFixture = pairs.length > 1;
  const fixtures = pairs.map((pair) => {
    const fixtureNotes = [];
    if (pair.homeTeam && !pair.homeTeam.id) {
      fixtureNotes.push(`Home team "${pair.homeTeam.name}" matched but has no configured team_id in catalog.`);
    }
    if (pair.awayTeam && !pair.awayTeam.id) {
      fixtureNotes.push(`Away team "${pair.awayTeam.name}" matched but has no configured team_id in catalog.`);
    }
    if ((pair.confidence?.overall || 0) < 0.65) {
      fixtureNotes.push(`Low OCR confidence (${Math.round((pair.confidence?.overall || 0) * 100)}%). Review before generating markets.`);
    }
    if (pair.dateAmbiguous) {
      fixtureNotes.push("Multiple date values detected in this OCR row. Review the fixture date.");
    }
    if (pair.timeAmbiguous) {
      fixtureNotes.push("Multiple kickoff times detected in this OCR row. Review the kickoff time.");
    }

    const fixtureDate = pair.dateAmbiguous
      ? null
      : pair.fixtureDate || (!isMultiFixture ? baseInference?.fixtureDate : null) || null;
    const kickoffTimeUtc = pair.timeAmbiguous
      ? null
      : pair.kickoffTimeUtc || (!isMultiFixture ? baseInference?.kickoffTimeUtc : null) || null;
    const timezoneUnverified = Boolean(
      kickoffTimeUtc &&
        !pair.timeAmbiguous &&
        (
          pair.kickoffTimeTimezoneExplicit === false ||
          (pair.kickoffTimeTimezoneExplicit == null && !isMultiFixture && baseKickoffInfo?.timezoneExplicit === false)
        )
    );
    const dateUnverified = Boolean(isMultiFixture && (!pair.fixtureDate || pair.dateAmbiguous));
    const timeUnverified = Boolean(isMultiFixture && (!pair.kickoffTimeUtc || pair.timeAmbiguous));
    if (timezoneUnverified) {
      fixtureNotes.push("Kickoff time was read without an explicit UTC/GMT marker. Confirm/convert it to UTC before generating markets.");
    }
    if (dateUnverified) {
      fixtureNotes.push("Fixture date was not confidently read from this row. Confirm the date before generating markets.");
    }
    if (timeUnverified) {
      fixtureNotes.push("Kickoff time was not confidently read from this row. Confirm the time in UTC before generating markets.");
    }

    const fixtureLeague = resolveLeagueFromTeamPair(pair, context.leagues, baseLeague);

    return {
      leagueSelectValue: fixtureLeague?.key || null,
      leagueId: fixtureLeague?.id || null,
      homeTeamName: pair.homeName || "",
      awayTeamName: pair.awayName || "",
      homeTeamMeta: pair.homeTeam || null,
      awayTeamMeta: pair.awayTeam || null,
      matchDay: baseInference?.matchDay ?? null,
      matchWeek: baseInference?.matchWeek ?? null,
      fixtureDate,
      kickoffTimeUtc,
      location: "",
      venue: "",
      sourceLine: pair.sourceLine || `${pair.homeName} vs ${pair.awayName}`,
      confidence: pair.confidence || null,
      source: {
        kind: "ocr-geometry",
        rowSpan: pair.rowSpan || 1,
        dateUnverified,
        timeUnverified,
        timezoneUnverified,
      },
      notes: fixtureNotes,
    };
  });

  const notes = [];
  notes.push(`Detected ${fixtures.length} fixture(s) from OCR geometry rows.`);
  if (baseInference?.matchDay !== null && baseInference?.matchDay !== undefined) {
    notes.push(`Detected match day: ${baseInference.matchDay}`);
  }
  if (baseInference?.matchWeek !== null && baseInference?.matchWeek !== undefined) {
    notes.push(`Detected match week: ${baseInference.matchWeek}`);
  }
  if (!baseInference?.fixtureDate) {
    notes.push("No fixture date detected. Enter Fixture Date (UTC) in the editor.");
  }
  if (!parseKickoffTime(text)) {
    notes.push("No kickoff time detected. Enter Kickoff Time (UTC) in the editor.");
  }
  if (!baseInference?.leagueId && !baseInference?.leagueSelectValue) {
    const inferredLeagueIds = new Set(fixtures.map((fixture) => String(fixture?.leagueId || "").trim()).filter(Boolean));
    if (inferredLeagueIds.size === 1) {
      notes.push("League inferred from CSV team mapping.");
    } else {
      notes.push("League not confidently detected. Defaulted to the selected league.");
    }
  }

  return { fixtures, notes };
}

export function inferFixturesFromText(rawText, { leagues, teams, teamAliasIndex } = {}) {
  const text = String(rawText || "");
  const lines = text
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter(Boolean);

  const notes = [];
  const explicitLeague = detectLeague(text, leagues || []);
  const inferredLeagueId = explicitLeague
    ? null
    : inferPreferredLeagueIdFromTeamMentions(text, teamAliasIndex || []);
  const inferredLeague = inferredLeagueId
    ? (leagues || []).find((league) => league.id === inferredLeagueId) || null
    : null;
  const league = explicitLeague || inferredLeague || null;
  const preferredLeagueId = league?.id || null;

  const matchDay = parseMatchDay(text);
  const matchWeek = parseMatchWeek(text);
  const fixtureDate = parseFixtureDate(text);
  const kickoffInfo = parseKickoffTimeInfo(text);
  const kickoffTimeUtc = kickoffInfo?.time || null;

  if (matchDay !== null) notes.push(`Detected match day: ${matchDay}`);
  if (matchWeek !== null) notes.push(`Detected match week: ${matchWeek}`);
  if (!fixtureDate) notes.push("No fixture date detected. Enter Fixture Date (UTC) in the editor.");
  if (!parseKickoffTime(text)) notes.push("No kickoff time detected. Enter Kickoff Time (UTC) in the editor.");

  let pairs = detectFixturePairsFromLines(lines, {
    preferredLeagueId,
    teams: teams || [],
    teamAliasIndex: teamAliasIndex || [],
  });
  let usedStackedRowFallback = false;

  if (!pairs.length) {
    pairs = detectFixturePairsFromStackedTextLines(lines, {
      preferredLeagueId,
      teamAliasIndex: teamAliasIndex || [],
    });
    usedStackedRowFallback = pairs.length > 0;
  }

  if (!pairs.length) {
    const fallbackSingle = inferFixtureFromText(text, {
      leagues: leagues || [],
      teams: teams || [],
      teamAliasIndex: teamAliasIndex || [],
      preferredLeagueId,
    });
    if (fallbackSingle.homeTeamName && fallbackSingle.awayTeamName) {
      pairs = [
        {
          homeName: fallbackSingle.homeTeamName,
          awayName: fallbackSingle.awayTeamName,
          homeTeam: fallbackSingle.homeTeamMeta,
          awayTeam: fallbackSingle.awayTeamMeta,
          sourceLine: `${fallbackSingle.homeTeamName} vs ${fallbackSingle.awayTeamName}`,
          sourceKind: "ocr-text-fallback",
        },
      ];
    }
  }

  if (!pairs.length) {
    notes.push("Could not confidently detect any fixtures. Edit OCR text or fill the editor manually.");
    return { fixtures: [], notes };
  }

  const isMultiFixture = pairs.length > 1;
  const fixtures = pairs.map((pair) => {
    const fixtureNotes = [];
    if (pair.homeTeam && !pair.homeTeam.id) {
      fixtureNotes.push(`Home team "${pair.homeTeam.name}" matched but has no configured team_id in catalog.`);
    }
    if (pair.awayTeam && !pair.awayTeam.id) {
      fixtureNotes.push(`Away team "${pair.awayTeam.name}" matched but has no configured team_id in catalog.`);
    }
    if (pair.dateAmbiguous) {
      fixtureNotes.push("Multiple date values detected near this fixture. Review the fixture date.");
    }
    if (pair.timeAmbiguous) {
      fixtureNotes.push("Multiple kickoff times detected near this fixture. Review the kickoff time.");
    }

    const pairFixtureDate = pair.dateAmbiguous ? null : pair.fixtureDate || (!isMultiFixture ? fixtureDate : null) || null;
    const pairKickoffTimeUtc = pair.timeAmbiguous
      ? null
      : pair.kickoffTimeUtc || (!isMultiFixture ? kickoffTimeUtc : null) || null;
    const timezoneUnverified = Boolean(
      pairKickoffTimeUtc &&
        !pair.timeAmbiguous &&
        (
          pair.kickoffTimeTimezoneExplicit === false ||
          (pair.kickoffTimeTimezoneExplicit == null && !isMultiFixture && kickoffInfo?.timezoneExplicit === false)
        )
    );
    const dateUnverified = Boolean(isMultiFixture && (!pair.fixtureDate || pair.dateAmbiguous));
    const timeUnverified = Boolean(isMultiFixture && (!pair.kickoffTimeUtc || pair.timeAmbiguous));
    if (timezoneUnverified) {
      fixtureNotes.push("Kickoff time was read without an explicit UTC/GMT marker. Confirm/convert it to UTC before generating markets.");
    }
    if (dateUnverified) {
      fixtureNotes.push("Fixture date was not confidently read from this row. Confirm the date before generating markets.");
    }
    if (timeUnverified) {
      fixtureNotes.push("Kickoff time was not confidently read from this row. Confirm the time in UTC before generating markets.");
    }

    const fixtureLeague = resolveLeagueFromTeamPair(pair, leagues || [], league || null);

    return {
      leagueSelectValue: fixtureLeague?.key || null,
      leagueId: fixtureLeague?.id || null,
      homeTeamName: pair.homeName || "",
      awayTeamName: pair.awayName || "",
      homeTeamMeta: pair.homeTeam || null,
      awayTeamMeta: pair.awayTeam || null,
      matchDay,
      matchWeek,
      fixtureDate: pairFixtureDate,
      kickoffTimeUtc: pairKickoffTimeUtc,
      location: "",
      venue: "",
      sourceLine: pair.sourceLine || `${pair.homeName} vs ${pair.awayName}`,
      source: {
        kind: pair.sourceKind || "ocr-text",
        dateUnverified,
        timeUnverified,
        timezoneUnverified,
      },
      notes: fixtureNotes,
    };
  });

  if (usedStackedRowFallback) {
    notes.push("Detected fixtures from stacked OCR rows without explicit vs separators.");
  }
  if (!explicitLeague) {
    if (inferredLeague) {
      notes.push(`League inferred from team mentions: ${inferredLeague.name}.`);
    } else {
      const inferredLeagueIds = new Set(fixtures.map((fixture) => String(fixture?.leagueId || "").trim()).filter(Boolean));
      if (inferredLeagueIds.size === 1) {
        notes.push("League inferred from CSV team mapping.");
      } else {
        notes.push("League not confidently detected. Defaulted to the selected league.");
      }
    }
  }
  notes.unshift(`Detected ${fixtures.length} fixture(s) from OCR text.`);
  return { fixtures, notes };
}

export function detectLeague(text, leagues) {
  const haystack = normalizeForSearch(text);
  let best = null;
  let bestScore = -1;

  for (const league of leagues || []) {
    const aliases = Array.isArray(league?.aliases) ? league.aliases : [];
    for (const alias of aliases) {
      const aliasNorm = normalizeForSearch(alias);
      const idx = haystack.indexOf(aliasNorm);
      if (idx === -1) {
        continue;
      }

      const score = aliasNorm.length;
      if (score > bestScore) {
        bestScore = score;
        best = league;
      }
    }
  }

  return best;
}

export function detectFixturePairsFromLines(lines, { preferredLeagueId, teams, teamAliasIndex } = {}) {
  const out = [];
  const seen = new Set();

  // OCR often splits a "fixture row" across multiple lines.
  // We scan 1–3 line windows to catch "A" + "vs" + "B" layouts.
  const windows = [];
  for (let i = 0; i < (lines || []).length; i += 1) {
    const l1 = lines[i];
    windows.push({ snippet: l1, sourceLine: l1 });
    if (i + 1 < lines.length) {
      windows.push({ snippet: `${l1} ${lines[i + 1]}`, sourceLine: `${l1} | ${lines[i + 1]}` });
    }
    if (i + 2 < lines.length) {
      windows.push({ snippet: `${l1} ${lines[i + 1]} ${lines[i + 2]}`, sourceLine: `${l1} | ${lines[i + 1]} | ${lines[i + 2]}` });
    }
  }

  for (const win of windows) {
    const separatorCount = countFixtureSeparators(win.snippet);
    if (separatorCount === 0) {
      continue;
    }
    if (separatorCount > 1) {
      continue;
    }

    const pair = detectTeamPairFromVsSnippet(win.snippet, { preferredLeagueId, teams, teamAliasIndex });
    if (!pair?.homeName || !pair?.awayName) {
      continue;
    }

    const key = `${normalizeForSearch(pair.homeName)}|${normalizeForSearch(pair.awayName)}`;
    const reverseKey = `${normalizeForSearch(pair.awayName)}|${normalizeForSearch(pair.homeName)}`;
    if (seen.has(key) || seen.has(reverseKey)) {
      continue;
    }
    seen.add(key);

    out.push({
      ...pair,
      ...deriveTemporalHintsFromSnippet(win.snippet),
      sourceLine: win.sourceLine,
    });
  }

  return out;
}

function detectFixturePairsFromStackedTextLines(lines, { preferredLeagueId, teamAliasIndex } = {}) {
  const rows = Array.isArray(lines)
    ? lines.map((line) => ({
        line: String(line || "").trim(),
        normalized: normalizeForSearch(line),
        hits: detectOrderedTeamHitsInTextLine(line, { preferredLeagueId, teamAliasIndex }),
      }))
    : [];

  if (rows.length < 2) {
    return [];
  }

  const out = [];
  const seen = new Set();
  let i = 0;
  while (i < rows.length - 1) {
    const top = rows[i];
    if (!top?.line) {
      i += 1;
      continue;
    }
    if (countFixtureSeparators(top.line) > 0) {
      i += 1;
      continue;
    }
    if (!top.hits.length || top.hits.length > 2) {
      i += 1;
      continue;
    }

    let matchedBottomIndex = -1;
    let lanePairs = [];

    for (let lookahead = i + 1; lookahead < Math.min(rows.length, i + 4); lookahead += 1) {
      const candidateBottom = rows[lookahead];
      if (!candidateBottom?.line) {
        continue;
      }
      if (countFixtureSeparators(candidateBottom.line) > 0) {
        break;
      }
      if (!candidateBottom.hits.length) {
        continue;
      }
      if (candidateBottom.hits.length > 2) {
        break;
      }
      if (!areIntermediateStackedRowsSkippable(rows, i + 1, lookahead)) {
        continue;
      }

      lanePairs = alignStackedTeamHits(top, candidateBottom);
      if (!lanePairs.length) {
        continue;
      }

      matchedBottomIndex = lookahead;
      break;
    }

    if (matchedBottomIndex < 0 || !lanePairs.length) {
      i += 1;
      continue;
    }

    const snippet = rows
      .slice(i, matchedBottomIndex + 1)
      .map((row) => row.line)
      .join(" ")
      .trim();
    const sourceLine = rows
      .slice(i, matchedBottomIndex + 1)
      .map((row) => row.line)
      .join(" | ");

    let pairedCurrentWindow = false;
    for (const pair of lanePairs) {
      const homeHit = pair?.homeHit;
      const awayHit = pair?.awayHit;
      if (!homeHit?.team || !awayHit?.team) {
        continue;
      }
      if (normalizeForSearch(homeHit.team.name) === normalizeForSearch(awayHit.team.name)) {
        continue;
      }

      const key = fixturePairKey(homeHit.team.name, awayHit.team.name);
      const reverseKey = fixturePairKey(awayHit.team.name, homeHit.team.name);
      if (seen.has(key) || seen.has(reverseKey)) {
        continue;
      }
      seen.add(key);
      pairedCurrentWindow = true;
      out.push({
        homeName: homeHit.team.name,
        awayName: awayHit.team.name,
        homeTeam: homeHit.team,
        awayTeam: awayHit.team,
        ...deriveTemporalHintsFromSnippet(snippet),
        sourceLine,
        sourceKind: "ocr-text-stacked",
      });
    }

    i = pairedCurrentWindow ? matchedBottomIndex + 1 : i + 1;
  }

  return out;
}

function areIntermediateStackedRowsSkippable(rows, start, endExclusive) {
  for (let idx = start; idx < endExclusive; idx += 1) {
    const row = rows[idx];
    if (!row?.line) {
      continue;
    }
    if (countFixtureSeparators(row.line) > 0) {
      return false;
    }
    const hitCount = Array.isArray(row.hits) ? row.hits.length : 0;
    if (hitCount > 0) {
      return false;
    }
    if (!isLikelyTemporalOrDividerRow(row.line)) {
      return false;
    }
  }
  return true;
}

function isLikelyTemporalOrDividerRow(line) {
  const text = String(line || "").trim();
  if (!text) {
    return true;
  }
  if (countDateMentions(text) > 0 || countTimeMentions(text) > 0) {
    return true;
  }
  if (/^\W+$/.test(text)) {
    return true;
  }
  return /^[0-9:.\sapmutcgmt,/-]+$/i.test(text);
}

function alignStackedTeamHits(topRow, bottomRow) {
  const topHits = Array.isArray(topRow?.hits) ? topRow.hits : [];
  const bottomHits = Array.isArray(bottomRow?.hits) ? bottomRow.hits : [];
  if (!topHits.length || !bottomHits.length) {
    return [];
  }

  if (topHits.length === bottomHits.length) {
    const laneCount = Math.min(2, topHits.length);
    const out = [];
    for (let lane = 0; lane < laneCount; lane += 1) {
      if (!topHits[lane]?.team || !bottomHits[lane]?.team) {
        continue;
      }
      out.push({ homeHit: topHits[lane], awayHit: bottomHits[lane] });
    }
    return out;
  }

  if (Math.abs(topHits.length - bottomHits.length) !== 1) {
    return [];
  }

  if (topHits.length === 1 && bottomHits.length === 2) {
    const bestBottom = pickClosestByRelativePosition(topHits[0], topRow, bottomHits, bottomRow);
    return bestBottom ? [{ homeHit: topHits[0], awayHit: bestBottom }] : [];
  }

  if (topHits.length === 2 && bottomHits.length === 1) {
    const bestTop = pickClosestByRelativePosition(bottomHits[0], bottomRow, topHits, topRow);
    return bestTop ? [{ homeHit: bestTop, awayHit: bottomHits[0] }] : [];
  }

  return [];
}

function pickClosestByRelativePosition(anchorHit, anchorRow, candidateHits, candidateRow) {
  if (!anchorHit || !Array.isArray(candidateHits) || !candidateHits.length) {
    return null;
  }
  const anchorNormLen = Math.max(1, String(anchorRow?.normalized || "").length);
  const candidateNormLen = Math.max(1, String(candidateRow?.normalized || "").length);
  const anchorPos = Math.max(0, Math.min(1, Number(anchorHit.idx || 0) / anchorNormLen));

  let best = null;
  let bestDist = Infinity;
  for (const candidate of candidateHits) {
    const pos = Math.max(0, Math.min(1, Number(candidate?.idx || 0) / candidateNormLen));
    const dist = Math.abs(pos - anchorPos);
    if (dist < bestDist) {
      best = candidate;
      bestDist = dist;
    }
  }
  return best;
}

function detectOrderedTeamHitsInTextLine(rawLine, { preferredLeagueId, teamAliasIndex } = {}) {
  const normalized = normalizeForSearch(rawLine);
  if (!normalized) {
    return [];
  }

  const hits = [];
  for (const entry of teamAliasIndex || []) {
    const alias = String(entry?.alias || "").trim();
    if (!alias) {
      continue;
    }
    let searchFrom = 0;
    while (searchFrom < normalized.length) {
      const idx = normalized.indexOf(alias, searchFrom);
      if (idx === -1) {
        break;
      }
      const boundaryLeft = idx === 0 || normalized[idx - 1] === " ";
      const endIdx = idx + alias.length;
      const boundaryRight = endIdx >= normalized.length || normalized[endIdx] === " ";
      if (!boundaryLeft || !boundaryRight) {
        searchFrom = idx + Math.max(1, alias.length);
        continue;
      }
      let score = alias.length + (boundaryLeft && boundaryRight ? 2 : 0);
      if (preferredLeagueId) {
        score += entry.team?.leagueId === preferredLeagueId ? 6 : -1;
      }

      hits.push({
        idx,
        alias,
        team: entry.team,
        score,
      });
      searchFrom = idx + Math.max(1, alias.length);
    }
  }

  if (hits.length < 1) {
    return [];
  }

  const bestByTeam = new Map();
  for (const hit of hits) {
    const key = String(hit?.team?.id || hit?.team?.name || "");
    if (!key) {
      continue;
    }
    const prev = bestByTeam.get(key);
    if (
      !prev ||
      hit.score > prev.score ||
      (hit.score === prev.score && hit.alias.length > prev.alias.length) ||
      (hit.score === prev.score && hit.alias.length === prev.alias.length && hit.idx < prev.idx)
    ) {
      bestByTeam.set(key, hit);
    }
  }

  const ordered = Array.from(bestByTeam.values()).sort((a, b) => a.idx - b.idx || b.score - a.score);
  const pruned = [];
  for (const hit of ordered) {
    const start = hit.idx;
    const end = hit.idx + hit.alias.length;
    const overlapIndex = pruned.findIndex((existing) => start < existing.end && end > existing.start);
    if (overlapIndex === -1) {
      pruned.push({ ...hit, start, end });
      continue;
    }
    if (hit.score > pruned[overlapIndex].score + 2) {
      pruned[overlapIndex] = { ...hit, start, end };
    }
  }

  return pruned
    .sort((a, b) => a.idx - b.idx || b.score - a.score)
    .slice(0, 4)
    .map((hit) => ({
      team: hit.team,
      idx: hit.idx,
      score: hit.score,
    }));
}

function detectFixturePairsFromOcrRows(rowBands, { preferredLeagueId, teams, teamAliasIndex } = {}) {
  const candidates = [];
  const windows = buildRowWindows(rowBands);

  for (const win of windows) {
    const separatorCount = countFixtureSeparators(win.snippet);
    if (separatorCount === 0 || separatorCount > 1) {
      continue;
    }
    const rowsWithSeparators = win.rows.filter((row) => countFixtureSeparators(row.text) > 0).length;
    if (win.rows.length > 1 && rowsWithSeparators > 1) {
      continue;
    }

    const pair = detectTeamPairFromVsSnippet(win.snippet, { preferredLeagueId, teams, teamAliasIndex });
    if (!pair?.homeName || !pair?.awayName) {
      continue;
    }

    candidates.push({
      ...pair,
      ...deriveTemporalHintsFromSnippet(win.snippet),
      sourceLine: win.sourceLine,
      rowSpan: win.rows.length,
      rowIndices: win.rows.map((row) => row.index),
      confidence: scoreOcrPairCandidate(pair, win),
      sortKey: win.rows[0]?.y0 ?? 0,
    });
  }

  if (!candidates.length) {
    return detectFixturePairsFromOcrGridLanes(rowBands, { preferredLeagueId, teams, teamAliasIndex });
  }

  const bestByFixture = new Map();
  for (const candidate of candidates) {
    const key = fixturePairKey(candidate.homeName, candidate.awayName);
    const reverseKey = fixturePairKey(candidate.awayName, candidate.homeName);
    const existingKey = bestByFixture.has(key) ? key : bestByFixture.has(reverseKey) ? reverseKey : null;
    const existing = existingKey ? bestByFixture.get(existingKey) : null;

    if (!existing) {
      bestByFixture.set(key, candidate);
      continue;
    }

    const existingScore = existing.confidence?.overall || 0;
    const nextScore = candidate.confidence?.overall || 0;
    if (nextScore > existingScore) {
      bestByFixture.set(existingKey, candidate);
    }
  }

  return Array.from(bestByFixture.values()).sort((a, b) => {
    const ay = a.sortKey ?? 0;
    const by = b.sortKey ?? 0;
    if (ay !== by) {
      return ay - by;
    }
    return (b.confidence?.overall || 0) - (a.confidence?.overall || 0);
  });
}

function detectFixturePairsFromOcrGridLanes(rowBands, { preferredLeagueId, teams, teamAliasIndex } = {}) {
  const rows = Array.isArray(rowBands) ? rowBands : [];
  if (!rows.length) {
    return [];
  }

  const rowHits = rows.map((row) => ({
    row,
    hits: detectTeamHitsInOcrRow(row, { preferredLeagueId, teams, teamAliasIndex }),
  }));

  const allHitXs = rowHits.flatMap((entry) => entry.hits.map((hit) => hit.x));
  if (allHitXs.length < 2) {
    return [];
  }

  const laneCenters = clusterLaneCenters(allHitXs, estimateLaneGapThreshold(rows));
  if (!laneCenters.length) {
    return [];
  }

  const laneBounds = buildLaneBounds(laneCenters);
  const laneRows = laneCenters.map(() => []);

  for (const entry of rowHits) {
    const bestHitByLane = new Map();
    for (const hit of entry.hits) {
      const laneIndex = findNearestLaneIndex(hit.x, laneCenters);
      if (laneIndex < 0) {
        continue;
      }
      const existing = bestHitByLane.get(laneIndex);
      if (!existing || hit.score > existing.score) {
        bestHitByLane.set(laneIndex, hit);
      }
    }

    for (const [laneIndex, hit] of bestHitByLane.entries()) {
      const laneText = extractLaneTextFromRow(entry.row, laneBounds, laneIndex);
      laneRows[laneIndex].push({
        row: entry.row,
        hit,
        laneText: laneText || entry.row.text || hit.sourceText || "",
      });
    }
  }

  const candidates = [];
  const seen = new Set();
  for (let laneIndex = 0; laneIndex < laneRows.length; laneIndex += 1) {
    const seq = laneRows[laneIndex].sort((a, b) => a.row.index - b.row.index);
    const used = new Set();

    for (let i = 0; i < seq.length - 1; i += 1) {
      if (used.has(i)) {
        continue;
      }
      const a = seq[i];
      const b = seq[i + 1];
      if (!a || !b) {
        continue;
      }

      const rowIndexGap = b.row.index - a.row.index;
      if (rowIndexGap < 1 || rowIndexGap > 2) {
        continue;
      }
      if (normalizeForSearch(a.hit.team.name) === normalizeForSearch(b.hit.team.name)) {
        continue;
      }

      const laneSnippet = `${a.laneText} ${b.laneText}`.trim();
      if (!laneSnippet) {
        continue;
      }

      const temporalHints = deriveTemporalHintsFromSnippet(laneSnippet);
      const key = fixturePairKey(a.hit.team.name, b.hit.team.name);
      const reverseKey = fixturePairKey(b.hit.team.name, a.hit.team.name);
      if (seen.has(key) || seen.has(reverseKey)) {
        continue;
      }
      seen.add(key);
      used.add(i);
      used.add(i + 1);

      candidates.push({
        homeName: a.hit.team.name,
        awayName: b.hit.team.name,
        homeTeam: a.hit.team,
        awayTeam: b.hit.team,
        ...temporalHints,
        sourceLine: `${a.laneText} | ${b.laneText}`,
        rowSpan: rowIndexGap + 1,
        rowIndices: [a.row.index, b.row.index],
        sortKey: a.row.y0 ?? 0,
        confidence: scoreOcrGridLanePairCandidate(a, b),
      });
    }
  }

  return candidates.sort((a, b) => {
    const ay = a.sortKey ?? 0;
    const by = b.sortKey ?? 0;
    if (ay !== by) {
      return ay - by;
    }
    return (b.confidence?.overall || 0) - (a.confidence?.overall || 0);
  });
}

function detectTeamHitsInOcrRow(row, { preferredLeagueId, teams, teamAliasIndex } = {}) {
  const hits = [];
  const rowLines = Array.isArray(row?.lines) ? row.lines : [];
  for (const line of rowLines) {
    const lineHits = detectTeamHitsInOcrLine(line, { preferredLeagueId, teams, teamAliasIndex });
    for (const hit of lineHits) {
      hits.push(hit);
    }
  }

  // De-dupe same team on the same row; keep the strongest match.
  const bestByTeam = new Map();
  for (const hit of hits) {
    const key = String(hit?.team?.id || hit?.team?.name || "");
    if (!key) {
      continue;
    }
    const prev = bestByTeam.get(key);
    if (!prev || hit.score > prev.score) {
      bestByTeam.set(key, hit);
    }
  }

  return Array.from(bestByTeam.values()).sort((a, b) => a.x - b.x || b.score - a.score);
}

function detectTeamHitsInOcrLine(line, { preferredLeagueId, teams, teamAliasIndex } = {}) {
  const text = String(line?.text || "").trim();
  if (!text) {
    return [];
  }

  const normalized = normalizeForSearch(text);
  if (!normalized) {
    return [];
  }

  const rawHits = [];
  for (const entry of teamAliasIndex || []) {
    const alias = String(entry?.alias || "").trim();
    if (!alias) {
      continue;
    }
    let searchFrom = 0;
    while (searchFrom < normalized.length) {
      const idx = normalized.indexOf(alias, searchFrom);
      if (idx === -1) {
        break;
      }
      let score = alias.length;
      if (normalized === alias) {
        score += 1000;
      }
      if (preferredLeagueId) {
        score += entry.team?.leagueId === preferredLeagueId ? 50 : -5;
      }

      rawHits.push({
        idx,
        alias,
        team: entry.team,
        score,
      });
      searchFrom = idx + Math.max(1, alias.length);
    }
  }

  if (!rawHits.length) {
    return [];
  }

  rawHits.sort((a, b) => {
    if (a.idx !== b.idx) {
      return a.idx - b.idx;
    }
    return b.score - a.score;
  });

  const lineWidth = Math.max(1, Number(line?.x1) - Number(line?.x0) || 1);
  const lineX0 = Number.isFinite(line?.x0) ? Number(line.x0) : 0;
  const normLen = Math.max(1, normalized.length);
  const bestByTeam = new Map();

  for (const hit of rawHits) {
    const key = String(hit.team?.id || hit.team?.name || "");
    if (!key) {
      continue;
    }
    const approxX = lineX0 + (Math.min(normLen - 1, Math.max(0, hit.idx)) / normLen) * lineWidth;
    const next = {
      team: hit.team,
      score: hit.score,
      x: approxX,
      sourceText: text,
    };
    const prev = bestByTeam.get(key);
    if (!prev || next.score > prev.score) {
      bestByTeam.set(key, next);
    }
  }

  return Array.from(bestByTeam.values()).sort((a, b) => a.x - b.x || b.score - a.score);
}

function estimateLaneGapThreshold(rows) {
  const heights = (rows || [])
    .map((row) => Math.max(1, Number(row?.y1 || 0) - Number(row?.y0 || 0)))
    .filter((h) => Number.isFinite(h) && h > 0)
    .sort((a, b) => a - b);
  const median = heights.length ? heights[Math.floor(heights.length / 2)] : 24;
  return Math.max(70, Math.min(220, median * 4));
}

function clusterLaneCenters(xs, gapThreshold) {
  const values = [...(xs || [])]
    .map((x) => Number(x))
    .filter((x) => Number.isFinite(x))
    .sort((a, b) => a - b);
  if (!values.length) {
    return [];
  }

  const clusters = [];
  for (const x of values) {
    const last = clusters[clusters.length - 1];
    if (!last) {
      clusters.push({ values: [x], center: x });
      continue;
    }

    if (Math.abs(x - last.center) <= gapThreshold) {
      last.values.push(x);
      last.center = last.values.reduce((sum, v) => sum + v, 0) / last.values.length;
    } else {
      clusters.push({ values: [x], center: x });
    }
  }

  return clusters
    .filter((cluster) => cluster.values.length >= 2 || clusters.length === 1)
    .map((cluster) => cluster.center)
    .sort((a, b) => a - b);
}

function buildLaneBounds(laneCenters) {
  const centers = [...(laneCenters || [])].sort((a, b) => a - b);
  return centers.map((center, index) => {
    const left = index === 0 ? -Infinity : (centers[index - 1] + center) / 2;
    const right = index === centers.length - 1 ? Infinity : (center + centers[index + 1]) / 2;
    return { left, right, center };
  });
}

function findNearestLaneIndex(x, laneCenters) {
  if (!Array.isArray(laneCenters) || !laneCenters.length || !Number.isFinite(x)) {
    return -1;
  }
  let bestIdx = 0;
  let bestDist = Infinity;
  for (let i = 0; i < laneCenters.length; i += 1) {
    const d = Math.abs(x - laneCenters[i]);
    if (d < bestDist) {
      bestDist = d;
      bestIdx = i;
    }
  }
  return bestIdx;
}

function extractLaneTextFromRow(row, laneBounds, laneIndex) {
  const lane = laneBounds?.[laneIndex];
  if (!lane) {
    return "";
  }
  const lines = (Array.isArray(row?.lines) ? row.lines : [])
    .filter((line) => {
      const cx = ((Number(line?.x0) || 0) + (Number(line?.x1) || 0)) / 2;
      return cx >= lane.left && cx < lane.right;
    })
    .sort((a, b) => (a.x0 ?? 0) - (b.x0 ?? 0))
    .map((line) => String(line?.text || "").trim())
    .filter(Boolean);

  return lines.join(" ").replace(/\s+/g, " ").trim();
}

function scoreOcrGridLanePairCandidate(a, b) {
  const rowConfRaw = [a?.row?.avgConfidence, b?.row?.avgConfidence]
    .map((v) => (Number.isFinite(v) ? Number(v) : 0))
    .reduce((sum, v) => sum + v, 0) / 2;
  const rowConfidence = Math.max(0, Math.min(1, rowConfRaw / 100));
  const adjacencyPenalty = a?.row && b?.row && b.row.index - a.row.index === 1 ? 0 : 0.08;
  const yGapPenalty =
    a?.row && b?.row
      ? Math.max(
          0,
          (((b.row.y0 ?? 0) - (a.row.y1 ?? a.row.y0 ?? 0)) /
            Math.max(10, (a.row.y1 ?? 0) - (a.row.y0 ?? 0))) -
            0.8
        ) * 0.08
      : 0;

  const base = 0.28 + rowConfidence * 0.32 + 0.3 - adjacencyPenalty - yGapPenalty;
  const overall = Math.max(0.25, Math.min(0.85, base));

  return {
    row: rowConfidence,
    teams: 1,
    overall,
  };
}

export function inferFixtureFromText(rawText, { leagues, teams, teamAliasIndex, preferredLeagueId } = {}) {
  const text = String(rawText || "");
  const compactText = normalizeForSearch(text);
  const lines = text
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter(Boolean);

  const notes = [];
  const explicitLeague = detectLeague(text, leagues || []);
  const inferredLeagueId = explicitLeague
    ? null
    : inferPreferredLeagueIdFromTeamMentions(text, teamAliasIndex || []);
  const inferredLeague = inferredLeagueId
    ? (leagues || []).find((league) => league.id === inferredLeagueId) || null
    : null;
  const league = explicitLeague || inferredLeague || null;

  const prefId = preferredLeagueId || league?.id || null;

  let pair = null;
  // Prefer direct "vs" detection.
  for (const line of lines) {
    pair = detectTeamPairFromVsSnippet(line, { preferredLeagueId: prefId, teams, teamAliasIndex });
    if (pair) {
      break;
    }
  }
  if (!pair) {
    for (const line of lines) {
      const normalizedLine = normalizeForSearch(line);
      if (!normalizedLine) {
        continue;
      }
      pair = detectTeamPairByCatalog(normalizedLine, {
        preferredLeagueId: prefId,
        teamAliasIndex,
        maxDistance: 64,
      });
      if (pair) {
        break;
      }
    }
  }
  if (!pair) {
    pair = detectTeamPairByCatalog(compactText, {
      preferredLeagueId: prefId,
      teamAliasIndex,
      maxDistance: 84,
    });
  }

  if (!pair) {
    notes.push("Could not confidently detect a fixture pair. Edit OCR text or fill team names manually.");
  }

  const homeTeamMeta = pair?.homeTeam || null;
  const awayTeamMeta = pair?.awayTeam || null;
  const pairLeague = resolveLeagueFromTeamPair(
    { homeTeam: homeTeamMeta, awayTeam: awayTeamMeta },
    leagues || [],
    league || null
  );
  const homeTeamName = pair?.homeName || "";
  const awayTeamName = pair?.awayName || "";

  if (homeTeamMeta && !homeTeamMeta.id) {
    notes.push(`Home team "${homeTeamMeta.name}" matched the catalog, but team ID is not configured. Add it in Team Mapping Overrides.`);
  }
  if (awayTeamMeta && !awayTeamMeta.id) {
    notes.push(`Away team "${awayTeamMeta.name}" matched the catalog, but team ID is not configured. Add it in Team Mapping Overrides.`);
  }

  const matchDay = parseMatchDay(text);
  const matchWeek = parseMatchWeek(text);
  if (matchDay !== null) notes.push(`Detected match day: ${matchDay}`);
  if (matchWeek !== null) notes.push(`Detected match week: ${matchWeek}`);

  const fixtureDate = parseFixtureDate(text);
  if (!fixtureDate) notes.push("No fixture date detected. Enter Fixture Date (UTC) in the editor.");

  const kickoffInfo = parseKickoffTimeInfo(text);
  const kickoffTimeUtc = kickoffInfo?.time || null;
  if (!kickoffTimeUtc) notes.push("No kickoff time detected. Enter Kickoff Time (UTC) in the editor.");
  if (kickoffInfo?.time && kickoffInfo.timezoneExplicit === false) {
    notes.push("Kickoff time detected without a UTC/GMT marker. Confirm/convert to UTC before market generation.");
  }
  if (!explicitLeague) {
    if (inferredLeague) {
      notes.push(`League inferred from team mentions: ${inferredLeague.name}.`);
    } else if (pairLeague?.id) {
      notes.push(`League inferred from CSV team mapping: ${pairLeague.name}.`);
    } else {
      notes.push("League not confidently detected. Defaulted to the selected league.");
    }
  }

  return {
    leagueSelectValue: pairLeague?.key || null,
    leagueId: pairLeague?.id || null,
    homeTeamName,
    awayTeamName,
    homeTeamMeta,
    awayTeamMeta,
    matchDay,
    matchWeek,
    fixtureDate,
    kickoffTimeUtc,
    kickoffTimeTimezoneExplicit: kickoffInfo?.timezoneExplicit ?? null,
    notes,
  };
}

function inferPreferredLeagueIdFromTeamMentions(rawText, teamAliasIndex) {
  const normalized = normalizeForSearch(rawText);
  if (!normalized) {
    return null;
  }

  const counts = new Map();
  for (const entry of teamAliasIndex || []) {
    const alias = String(entry?.alias || "").trim();
    const leagueId = String(entry?.team?.leagueId || "").trim();
    if (!alias || !leagueId) {
      continue;
    }
    let searchFrom = 0;
    while (searchFrom < normalized.length) {
      const idx = normalized.indexOf(alias, searchFrom);
      if (idx === -1) {
        break;
      }
      const leftOk = idx === 0 || normalized[idx - 1] === " ";
      const rightIdx = idx + alias.length;
      const rightOk = rightIdx >= normalized.length || normalized[rightIdx] === " ";
      if (leftOk && rightOk) {
        counts.set(leagueId, (counts.get(leagueId) || 0) + 1);
      }
      searchFrom = idx + Math.max(1, alias.length);
    }
  }

  let bestLeagueId = null;
  let bestCount = 0;
  for (const [leagueId, count] of counts.entries()) {
    if (count > bestCount) {
      bestCount = count;
      bestLeagueId = leagueId;
    }
  }
  if (bestCount < 2) {
    return null;
  }
  return bestLeagueId;
}

function resolveLeagueFromInference(inference, leagues) {
  const byKey = (leagues || []).find((league) => league.key === inference?.leagueSelectValue);
  if (byKey) {
    return byKey;
  }
  const byId = (leagues || []).find((league) => league.id === inference?.leagueId);
  if (byId) {
    return byId;
  }
  return null;
}

function resolveLeagueFromTeamPair(pair, leagues, fallbackLeague = null) {
  const homeLeagueId = String(pair?.homeTeam?.leagueId || "").trim();
  const awayLeagueId = String(pair?.awayTeam?.leagueId || "").trim();

  let resolvedLeagueId = "";
  if (homeLeagueId && awayLeagueId && homeLeagueId === awayLeagueId) {
    resolvedLeagueId = homeLeagueId;
  } else if (homeLeagueId && !awayLeagueId) {
    resolvedLeagueId = homeLeagueId;
  } else if (!homeLeagueId && awayLeagueId) {
    resolvedLeagueId = awayLeagueId;
  }

  if (resolvedLeagueId) {
    const byId = (leagues || []).find((league) => league.id === resolvedLeagueId);
    if (byId) {
      return byId;
    }
  }

  return fallbackLeague || null;
}

function normalizeArtifactLines(lines) {
  return (Array.isArray(lines) ? lines : [])
    .map((line) => {
      const text = String(line?.text || "").trim();
      const bbox = line?.bbox && Number.isFinite(line.bbox.x0) && Number.isFinite(line.bbox.y0) && Number.isFinite(line.bbox.x1) && Number.isFinite(line.bbox.y1)
        ? line.bbox
        : null;
      const confidence = Number.isFinite(line?.confidence) ? Number(line.confidence) : 0;
      if (!text || !bbox) {
        return null;
      }
      return {
        text,
        bbox,
        confidence,
        x0: bbox.x0,
        y0: bbox.y0,
        x1: bbox.x1,
        y1: bbox.y1,
        yc: (bbox.y0 + bbox.y1) / 2,
        height: Math.max(1, bbox.y1 - bbox.y0),
      };
    })
    .filter(Boolean);
}

function normalizeArtifactWords(words) {
  return (Array.isArray(words) ? words : [])
    .map((word) => {
      const text = String(word?.text || "").trim();
      const bbox = word?.bbox && Number.isFinite(word.bbox.x0) && Number.isFinite(word.bbox.y0) && Number.isFinite(word.bbox.x1) && Number.isFinite(word.bbox.y1)
        ? word.bbox
        : null;
      const confidence = Number.isFinite(word?.confidence) ? Number(word.confidence) : 0;
      if (!text || !bbox) {
        return null;
      }
      return {
        text,
        bbox,
        confidence,
        x0: bbox.x0,
        y0: bbox.y0,
        x1: bbox.x1,
        y1: bbox.y1,
        yc: (bbox.y0 + bbox.y1) / 2,
        height: Math.max(1, bbox.y1 - bbox.y0),
      };
    })
    .filter(Boolean);
}

function synthesizeLinesFromWords(words) {
  const sorted = [...(words || [])].sort((a, b) => a.yc - b.yc || a.x0 - b.x0);
  if (!sorted.length) {
    return [];
  }

  const lines = [];
  for (const word of sorted) {
    const last = lines[lines.length - 1];
    if (!last) {
      lines.push(createSyntheticLine(word));
      continue;
    }

    const lineHeight = Math.max(8, last.y1 - last.y0);
    const center = (last.y0 + last.y1) / 2;
    const centerDelta = Math.abs(word.yc - center);
    const overlap = Math.max(0, Math.min(word.y1, last.y1) - Math.max(word.y0, last.y0));
    const overlapRatio = overlap / Math.max(1, Math.min(word.height, lineHeight));

    if (overlapRatio >= 0.2 || centerDelta <= Math.max(10, lineHeight * 0.7)) {
      mergeWordIntoSyntheticLine(last, word);
    } else {
      lines.push(createSyntheticLine(word));
    }
  }

  return lines
    .map((line) => finalizeSyntheticLine(line))
    .filter((line) => line.text);
}

function createSyntheticLine(word) {
  return {
    words: [word],
    x0: word.x0,
    y0: word.y0,
    x1: word.x1,
    y1: word.y1,
  };
}

function mergeWordIntoSyntheticLine(line, word) {
  line.words.push(word);
  line.x0 = Math.min(line.x0, word.x0);
  line.y0 = Math.min(line.y0, word.y0);
  line.x1 = Math.max(line.x1, word.x1);
  line.y1 = Math.max(line.y1, word.y1);
}

function finalizeSyntheticLine(line) {
  const words = [...(line.words || [])].sort((a, b) => a.x0 - b.x0);
  const text = words.map((word) => word.text).join(" ").replace(/\s+/g, " ").trim();
  const avgConfidence = words.length
    ? words.reduce((sum, word) => sum + (Number.isFinite(word.confidence) ? word.confidence : 0), 0) / words.length
    : 0;

  return {
    text,
    bbox: {
      x0: line.x0,
      y0: line.y0,
      x1: line.x1,
      y1: line.y1,
    },
    confidence: avgConfidence,
    x0: line.x0,
    y0: line.y0,
    x1: line.x1,
    y1: line.y1,
    yc: (line.y0 + line.y1) / 2,
    height: Math.max(1, line.y1 - line.y0),
  };
}

function groupOcrLinesIntoRows(lines) {
  const sorted = [...(lines || [])].sort((a, b) => a.yc - b.yc || a.x0 - b.x0);
  const rows = [];

  for (const line of sorted) {
    const last = rows[rows.length - 1];
    if (!last) {
      rows.push(createRowBand(line, 0));
      continue;
    }

    const overlap = verticalOverlapRatio(line, last);
    const rowHeight = Math.max(8, last.y1 - last.y0);
    const centerDelta = Math.abs(line.yc - (last.y0 + last.y1) / 2);
    const shouldMerge = overlap >= 0.2 || centerDelta <= Math.max(12, rowHeight * 0.7);

    if (shouldMerge) {
      mergeLineIntoRowBand(last, line);
    } else {
      rows.push(createRowBand(line, rows.length));
    }
  }

  for (const row of rows) {
    row.lines.sort((a, b) => a.x0 - b.x0);
    row.text = row.lines.map((line) => line.text).join(" ").replace(/\s+/g, " ").trim();
    row.avgConfidence = row.lines.length
      ? row.lines.reduce((sum, line) => sum + (Number.isFinite(line.confidence) ? line.confidence : 0), 0) / row.lines.length
      : 0;
  }

  return rows.filter((row) => row.text);
}

function createRowBand(line, index) {
  return {
    index,
    lines: [line],
    x0: line.x0,
    y0: line.y0,
    x1: line.x1,
    y1: line.y1,
    text: line.text,
    avgConfidence: Number.isFinite(line.confidence) ? line.confidence : 0,
  };
}

function mergeLineIntoRowBand(row, line) {
  row.lines.push(line);
  row.x0 = Math.min(row.x0, line.x0);
  row.y0 = Math.min(row.y0, line.y0);
  row.x1 = Math.max(row.x1, line.x1);
  row.y1 = Math.max(row.y1, line.y1);
}

function verticalOverlapRatio(line, row) {
  const overlap = Math.max(0, Math.min(line.y1, row.y1) - Math.max(line.y0, row.y0));
  const minHeight = Math.max(1, Math.min(line.y1 - line.y0, row.y1 - row.y0));
  return overlap / minHeight;
}

function buildRowWindows(rowBands) {
  const windows = [];
  for (let i = 0; i < (rowBands || []).length; i += 1) {
    for (let span = 1; span <= 2; span += 1) {
      if (i + span > rowBands.length) {
        break;
      }
      const rows = rowBands.slice(i, i + span);
      const snippet = rows.map((row) => row.text).join(" ");
      const sourceLine = rows.map((row) => row.text).join(" | ");
      if (!snippet.trim()) {
        continue;
      }
      windows.push({ rows, snippet, sourceLine });
    }
  }
  return windows;
}

function scoreOcrPairCandidate(pair, win) {
  const rowConfRaw = win.rows.length
    ? win.rows.reduce((sum, row) => sum + (Number.isFinite(row.avgConfidence) ? row.avgConfidence : 0), 0) / win.rows.length
    : 0;
  const rowConfidence = Math.max(0, Math.min(1, rowConfRaw / 100));
  const separatorBonus = /\s(?:vs\.?|v\.?)\s/i.test(win.snippet) ? 0.15 : /\s[-–—]\s/.test(win.snippet) ? 0.08 : 0;
  const teamMatchScore = (pair.homeTeam ? 0.2 : 0) + (pair.awayTeam ? 0.2 : 0);
  const spanPenalty = win.rows.length === 1 ? 0 : win.rows.length === 2 ? 0.03 : 0.08;
  const tokenPenalty = countTokens(win.snippet) > 18 ? 0.08 : 0;
  const base = 0.35 + rowConfidence * 0.35 + separatorBonus + teamMatchScore - spanPenalty - tokenPenalty;
  const overall = Math.max(0.05, Math.min(0.99, base));

  return {
    row: rowConfidence,
    teams: Math.min(1, teamMatchScore / 0.4),
    overall,
  };
}

function countTokens(text) {
  return String(text || "")
    .trim()
    .split(/\s+/)
    .filter(Boolean).length;
}

function countFixtureSeparators(text) {
  const matches = String(text || "").match(/\s(?:vs\.?|v\.?)\s|\s[-–—]\s/gi);
  return matches ? matches.length : 0;
}

function fixturePairKey(home, away) {
  return `${normalizeForSearch(home)}|${normalizeForSearch(away)}`;
}

function detectTeamPairFromVsSnippet(snippet, options = {}) {
  const separators = ["vs", "vs.", "v", "v.", "-", "–", "—"];
  const cleanedLine = String(snippet || "").replace(/\s+/g, " ").trim();
  if (!cleanedLine) {
    return null;
  }

  const lower = cleanedLine.toLowerCase();
  if (!separators.some((sep) => lower.includes(` ${sep} `))) {
    return null;
  }

  const regex = /(.+?)\s+(?:vs\.?|v\.?|-|–|—)\s+(.+)/i;
  const match = cleanedLine.match(regex);
  if (!match) {
    return null;
  }

  const leftRaw = stripFixtureNoise(match[1]);
  const rightRaw = stripFixtureNoise(match[2]);
  if (!leftRaw || !rightRaw) {
    return null;
  }

  const preferredLeagueId = options?.preferredLeagueId || null;
  const teams = options?.teams || [];

  const leftResolved =
    findExactTeamForLeague(leftRaw, teams, preferredLeagueId) ||
    findExactTeamForLeague(leftRaw, teams, null);
  const rightResolved =
    findExactTeamForLeague(rightRaw, teams, preferredLeagueId) ||
    findExactTeamForLeague(rightRaw, teams, null);

  const homeName = leftResolved?.name || toTitleLike(leftRaw);
  const awayName = rightResolved?.name || toTitleLike(rightRaw);

  return {
    homeName,
    awayName,
    homeTeam: leftResolved || null,
    awayTeam: rightResolved || null,
  };
}

function detectTeamPairByCatalog(normalizedText, options = {}) {
  const preferredLeagueId = options.preferredLeagueId || null;
  const teamAliasIndex = options.teamAliasIndex || [];
  const maxDistance = Number.isFinite(options.maxDistance) ? Number(options.maxDistance) : 84;
  const text = String(normalizedText || "");
  const hits = [];

  if (!text) {
    return null;
  }

  for (const entry of teamAliasIndex) {
    let searchFrom = 0;
    while (searchFrom < text.length) {
      const idx = text.indexOf(entry.alias, searchFrom);
      if (idx === -1) {
        break;
      }
      hits.push({ idx, team: entry.team, alias: entry.alias });
      searchFrom = idx + Math.max(1, entry.alias.length);
    }
  }

  if (hits.length < 2) {
    return null;
  }

  const uniqueHitsByTeam = new Map();
  for (const hit of hits) {
    const key = String(hit?.team?.id || hit?.team?.name || "");
    if (!key) {
      continue;
    }
    const prev = uniqueHitsByTeam.get(key);
    if (!prev || hit.idx < prev.idx || (hit.idx === prev.idx && hit.alias.length > prev.alias.length)) {
      uniqueHitsByTeam.set(key, hit);
    }
  }

  const uniqueHits = Array.from(uniqueHitsByTeam.values()).sort((a, b) => a.idx - b.idx || b.alias.length - a.alias.length);
  if (uniqueHits.length < 2) {
    return null;
  }

  if (uniqueHits.length === 2) {
    const dist = Math.abs(uniqueHits[1].idx - uniqueHits[0].idx);
    if (Number.isFinite(maxDistance) && dist > maxDistance) {
      return null;
    }
    return {
      homeName: uniqueHits[0].team.name,
      awayName: uniqueHits[1].team.name,
      homeTeam: uniqueHits[0].team,
      awayTeam: uniqueHits[1].team,
    };
  }

  const candidates = [];
  for (let i = 0; i < uniqueHits.length - 1; i += 1) {
    for (let j = i + 1; j < Math.min(uniqueHits.length, i + 4); j += 1) {
      const left = uniqueHits[i];
      const right = uniqueHits[j];
      const dist = Math.abs(right.idx - left.idx);
      if (Number.isFinite(maxDistance) && dist > maxDistance) {
        continue;
      }
      const preferredBoost =
        preferredLeagueId && left.team.leagueId === preferredLeagueId && right.team.leagueId === preferredLeagueId ? 14 :
        preferredLeagueId && (left.team.leagueId === preferredLeagueId || right.team.leagueId === preferredLeagueId) ? 6 :
        0;
      const aliasBoost = Math.min(8, (left.alias.length + right.alias.length) * 0.12);
      const score = 100 - dist + preferredBoost + aliasBoost;
      candidates.push({ left, right, score, dist });
    }
  }

  if (!candidates.length) {
    return null;
  }

  candidates.sort((a, b) => b.score - a.score || a.dist - b.dist || a.left.idx - b.left.idx);
  const best = candidates[0];
  const second = candidates[1] || null;
  if (second && best.score - second.score < 6) {
    return null;
  }

  return {
    homeName: best.left.team.name,
    awayName: best.right.team.name,
    homeTeam: best.left.team,
    awayTeam: best.right.team,
  };
}

function resolveTeamByName(rawName, { preferredLeagueId, teams } = {}) {
  const normalized = normalizeForSearch(rawName);
  if (!normalized) {
    return null;
  }

  let best = null;
  let bestScore = -1;

  for (const team of teams || []) {
    const aliases = Array.isArray(team?.aliases) ? team.aliases : [team?.name].filter(Boolean);
    for (const alias of aliases) {
      const aliasNorm = normalizeForSearch(alias);
      let score = -1;

      if (normalized === aliasNorm) {
        score = 1000 + aliasNorm.length;
      } else if (normalized.includes(aliasNorm)) {
        score = 500 + aliasNorm.length;
      } else if (aliasNorm.includes(normalized)) {
        score = 400 + normalized.length;
      } else {
        score = tokenOverlapScore(normalized, aliasNorm);
      }

      if (preferredLeagueId) {
        if (team.leagueId === preferredLeagueId) {
          score += 50;
        } else {
          score -= 5;
        }
      }

      if (score > bestScore) {
        bestScore = score;
        best = team;
      }
    }
  }

  if (bestScore < 2) {
    return null;
  }

  return { team: best, score: bestScore };
}

export function findExactTeamForLeague(rawName, teams, leagueId = null) {
  const normalized = normalizeForSearch(rawName);
  if (!normalized) {
    return null;
  }

  const candidates = (teams || []).filter((team) => !leagueId || team.leagueId === leagueId);
  const matches = [];
  const seen = new Set();

  for (const team of candidates) {
    const aliases = Array.isArray(team?.aliases) && team.aliases.length
      ? team.aliases
      : [team?.name, team?.alternateName].filter(Boolean);

    const hasExact = aliases.some((alias) => normalizeForSearch(alias) === normalized);
    if (!hasExact) {
      continue;
    }

    const key = String(team?.id || `${team?.name || ""}:${team?.leagueId || ""}`);
    if (seen.has(key)) {
      continue;
    }
    seen.add(key);
    matches.push(team);
  }

  if (!matches.length) {
    return null;
  }
  if (matches.length === 1) {
    return matches[0];
  }

  const exactNameMatches = matches.filter((team) => normalizeForSearch(team?.name) === normalized);
  if (exactNameMatches.length === 1) {
    return exactNameMatches[0];
  }

  // Ambiguous exact match across multiple teams/leagues.
  return null;
}

export function findBestTeamForLeague(rawName, teams, leagueId = null) {
  const normalized = normalizeForSearch(rawName);
  if (!normalized) {
    return null;
  }

  const exact = findExactTeamForLeague(rawName, teams, leagueId);
  if (exact) {
    return exact;
  }

  if (leagueId) {
    const resolved = resolveTeamByName(rawName, { preferredLeagueId: leagueId, teams });
    if (resolved?.team?.leagueId === leagueId) {
      return resolved.team;
    }
    return null;
  }

  return resolveTeamByName(rawName, { teams })?.team || null;
}

export function stripFixtureNoise(value) {
  return String(value || "")
    .replace(/\b(?:matchday|md|round|week)\s*\d+\b/gi, "")
    .replace(/\b(?:mon(?:day)?|tue(?:s|sday)?|wed(?:nesday)?|thu(?:r|rs|rsday)?|fri(?:day)?|sat(?:urday)?|sun(?:day)?)\,?\b/gi, "")
    .replace(/\b\d{1,2}[:.]\d{2}\s*(?:am|pm|utc|gmt)?\b/gi, "")
    .replace(
      /\b\d{1,2}\s+(?:jan(?:uary)?|feb(?:ruary)?|mar(?:ch)?|apr(?:il)?|may|jun(?:e)?|jul(?:y)?|aug(?:ust)?|sep(?:t|tember)?|oct(?:ober)?|nov(?:ember)?|dec(?:ember)?)(?:\,?\s+\d{2,4})?\b/gi,
      ""
    )
    .replace(
      /\b(?:jan(?:uary)?|feb(?:ruary)?|mar(?:ch)?|apr(?:il)?|may|jun(?:e)?|jul(?:y)?|aug(?:ust)?|sep(?:t|tember)?|oct(?:ober)?|nov(?:ember)?|dec(?:ember)?)\s+\d{1,2}(?:\,?\s+\d{2,4})?\b/gi,
      ""
    )
    .replace(/\b\d{1,2}[\/.-]\d{1,2}(?:[\/.-]\d{2,4})?\b/g, "")
    .replace(/\([^)]*\)/g, " ")
    .replace(/\[[^\]]*\]/g, " ")
    .replace(/[,|]+/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

export function parseMatchDay(text) {
  const patterns = [/\bmatch\s*day\s*(\d{1,2})\b/i, /\bmatchday\s*(\d{1,2})\b/i, /\bmd\s*(\d{1,2})\b/i];
  for (const pattern of patterns) {
    const match = String(text || "").match(pattern);
    if (match) {
      return Number.parseInt(match[1], 10);
    }
  }
  return null;
}

export function parseMatchWeek(text) {
  const patterns = [/\bmatch\s*week\s*(\d{1,2})\b/i, /\bgameweek\s*(\d{1,2})\b/i, /\bgw\s*(\d{1,2})\b/i];
  for (const pattern of patterns) {
    const match = String(text || "").match(pattern);
    if (match) {
      return Number.parseInt(match[1], 10);
    }
  }
  return null;
}

export function parseFixtureDate(text) {
  const monthMap = {
    jan: 1,
    january: 1,
    feb: 2,
    february: 2,
    mar: 3,
    march: 3,
    apr: 4,
    april: 4,
    may: 5,
    jun: 6,
    june: 6,
    jul: 7,
    july: 7,
    aug: 8,
    august: 8,
    sep: 9,
    sept: 9,
    september: 9,
    oct: 10,
    october: 10,
    nov: 11,
    november: 11,
    dec: 12,
    december: 12,
  };

  const t = String(text || "");

  const isoMatch = t.match(/\b(20\d{2})[\/.-](\d{1,2})[\/.-](\d{1,2})\b/);
  if (isoMatch) {
    return formatYyyyMmDd(Number(isoMatch[1]), Number(isoMatch[2]), Number(isoMatch[3]));
  }

  const monthWordMatch = t.match(
    /\b(\d{1,2})\s+(jan(?:uary)?|feb(?:ruary)?|mar(?:ch)?|apr(?:il)?|may|jun(?:e)?|jul(?:y)?|aug(?:ust)?|sep(?:t|tember)?|oct(?:ober)?|nov(?:ember)?|dec(?:ember)?)\,?\s+(20\d{2}|\d{2})\b/i
  );
  if (monthWordMatch) {
    const day = Number(monthWordMatch[1]);
    const month = monthMap[monthWordMatch[2].toLowerCase()];
    const year = normalizeYear(monthWordMatch[3]);
    return formatYyyyMmDd(year, month, day);
  }

  const monthWordFirstMatch = t.match(
    /\b(jan(?:uary)?|feb(?:ruary)?|mar(?:ch)?|apr(?:il)?|may|jun(?:e)?|jul(?:y)?|aug(?:ust)?|sep(?:t|tember)?|oct(?:ober)?|nov(?:ember)?|dec(?:ember)?)\s+(\d{1,2})\,?\s+(20\d{2}|\d{2})\b/i
  );
  if (monthWordFirstMatch) {
    const month = monthMap[monthWordFirstMatch[1].toLowerCase()];
    const day = Number(monthWordFirstMatch[2]);
    const year = normalizeYear(monthWordFirstMatch[3]);
    return formatYyyyMmDd(year, month, day);
  }

  const dayMonthNoYearMatch = t.match(
    /\b(\d{1,2})\s+(jan(?:uary)?|feb(?:ruary)?|mar(?:ch)?|apr(?:il)?|may|jun(?:e)?|jul(?:y)?|aug(?:ust)?|sep(?:t|tember)?|oct(?:ober)?|nov(?:ember)?|dec(?:ember)?)\b/i
  );
  if (dayMonthNoYearMatch) {
    const day = Number(dayMonthNoYearMatch[1]);
    const month = monthMap[dayMonthNoYearMatch[2].toLowerCase()];
    const year = inferClosestUtcYearForMonthDay(month, day);
    return formatYyyyMmDd(year, month, day);
  }

  const monthDayNoYearMatch = t.match(
    /\b(jan(?:uary)?|feb(?:ruary)?|mar(?:ch)?|apr(?:il)?|may|jun(?:e)?|jul(?:y)?|aug(?:ust)?|sep(?:t|tember)?|oct(?:ober)?|nov(?:ember)?|dec(?:ember)?)\s+(\d{1,2})\b/i
  );
  if (monthDayNoYearMatch) {
    const month = monthMap[monthDayNoYearMatch[1].toLowerCase()];
    const day = Number(monthDayNoYearMatch[2]);
    const year = inferClosestUtcYearForMonthDay(month, day);
    return formatYyyyMmDd(year, month, day);
  }

  const numericMatch = t.match(/\b(\d{1,2})[\/.-](\d{1,2})[\/.-](20\d{2}|\d{2})\b/);
  if (numericMatch) {
    const a = Number(numericMatch[1]);
    const b = Number(numericMatch[2]);
    const year = normalizeYear(numericMatch[3]);
    let month = b;
    let day = a;

    if (a > 12 && b <= 12) {
      day = a;
      month = b;
    } else if (b > 12 && a <= 12) {
      month = a;
      day = b;
    } else {
      day = a;
      month = b;
    }

    return formatYyyyMmDd(year, month, day);
  }

  return null;
}

export function parseKickoffTime(text) {
  return parseKickoffTimeInfo(text)?.time || null;
}

function deriveTemporalHintsFromSnippet(snippet) {
  const text = String(snippet || "");
  const dateMentions = countDateMentions(text);
  const timeMentions = countTimeMentions(text);
  const timeInfo = timeMentions === 1 ? parseKickoffTimeInfo(text) : null;

  return {
    fixtureDate: dateMentions === 1 ? parseFixtureDate(text) : null,
    kickoffTimeUtc: timeInfo?.time || null,
    kickoffTimeTimezoneExplicit: timeInfo ? Boolean(timeInfo.timezoneExplicit) : null,
    dateAmbiguous: dateMentions > 1,
    timeAmbiguous: timeMentions > 1,
  };
}

function countTimeMentions(text) {
  return Array.from(String(text || "").matchAll(/\b(\d{1,2})[:.](\d{2})\s*([AaPp][Mm])?\s*(UTC|GMT)?\b/g)).length;
}

function countDateMentions(text) {
  const matches = String(text || "").match(
    /\b(?:\d{1,2}[\/-]\d{1,2}(?:[\/-]\d{2,4})?|(?:jan(?:uary)?|feb(?:ruary)?|mar(?:ch)?|apr(?:il)?|may|jun(?:e)?|jul(?:y)?|aug(?:ust)?|sep(?:t|tember)?|oct(?:ober)?|nov(?:ember)?|dec(?:ember)?)\s+\d{1,2}(?:,?\s+\d{2,4})?|\d{1,2}\s+(?:jan(?:uary)?|feb(?:ruary)?|mar(?:ch)?|apr(?:il)?|may|jun(?:e)?|jul(?:y)?|aug(?:ust)?|sep(?:t|tember)?|oct(?:ober)?|nov(?:ember)?|dec(?:ember)?)(?:,?\s+\d{2,4})?)\b/gi
  );
  return matches ? matches.length : 0;
}

function inferClosestUtcYearForMonthDay(month, day, referenceDate = new Date()) {
  const ref = new Date(referenceDate);
  const refTime = Date.UTC(ref.getUTCFullYear(), ref.getUTCMonth(), ref.getUTCDate());
  const years = [ref.getUTCFullYear() - 1, ref.getUTCFullYear(), ref.getUTCFullYear() + 1];

  const candidates = years
    .map((year) => {
      const ts = Date.UTC(year, month - 1, day);
      const check = new Date(ts);
      if (check.getUTCFullYear() !== year || check.getUTCMonth() !== month - 1 || check.getUTCDate() !== day) {
        return null;
      }
      return { year, ts };
    })
    .filter(Boolean);

  if (!candidates.length) {
    return ref.getUTCFullYear();
  }

  candidates.sort((a, b) => {
    const da = Math.abs(a.ts - refTime);
    const db = Math.abs(b.ts - refTime);
    if (da !== db) {
      return da - db;
    }
    return a.ts - b.ts;
  });

  return candidates[0].year;
}

function parseKickoffTimeInfo(text) {
  const matches = String(text || "").matchAll(/\b(\d{1,2})[:.](\d{2})\s*([AaPp][Mm])?\s*(UTC|GMT)?\b/g);
  for (const match of matches) {
    let hours = Number(match[1]);
    const minutes = Number(match[2]);
    const meridiem = match[3]?.toLowerCase();
    const timezoneToken = match[4] ? String(match[4]).toUpperCase() : null;

    if (meridiem) {
      if (meridiem === "pm" && hours < 12) {
        hours += 12;
      }
      if (meridiem === "am" && hours === 12) {
        hours = 0;
      }
    }

    if (hours > 23 || minutes > 59) {
      continue;
    }

    return {
      time: `${String(hours).padStart(2, "0")}:${String(minutes).padStart(2, "0")}`,
      timezoneExplicit: Boolean(timezoneToken),
      timezoneToken,
    };
  }
  return null;
}

export function collectFixtureBundleFromInference(inference, { leagues, teams } = {}) {
  const homeName = String(inference?.homeTeamName || "").trim();
  const awayName = String(inference?.awayTeamName || "").trim();
  if (!homeName || !awayName) {
    return null;
  }

  const league = getLeagueMetaFromInference(inference, leagues || []);
  const date = String(inference?.fixtureDate || "").trim() || null;
  const kickoffTimeUtc = String(inference?.kickoffTimeUtc || "").trim() || null;
  const kickoffDate = parseUtcDateTime(date, kickoffTimeUtc);
  const closeDate = kickoffDate;
  const openDate =
    kickoffDate instanceof Date
      ? new Date(kickoffDate.getTime() - DEFAULT_MARKETS_OPEN_LEAD_HOURS * 60 * 60 * 1000)
      : null;

  const homeTeam = collectTeamMetaFromInferenceSide(inference?.homeTeamMeta, homeName, teams || [], league.id || null, "#E0A000");
  const awayTeam = collectTeamMetaFromInferenceSide(inference?.awayTeamMeta, awayName, teams || [], league.id || null, "#E0C020");

  const fixtureJson = {
    name: `${homeName} vs ${awayName}`,
    league_id: league.id || null,
    home_team_id: homeTeam.id || null,
    away_team_id: awayTeam.id || null,
    format: null,
    logo_url: FIXTURE_LOGO_URL,
    theme_color: "#FFFFFF",
    match_day: Number.isInteger(inference?.matchDay) ? inference.matchDay : null,
    match_week: Number.isInteger(inference?.matchWeek) ? inference.matchWeek : null,
    location: String(inference?.location || ""),
    venue: String(inference?.venue || ""),
  };

  const meta = {
    league,
    homeTeam,
    awayTeam,
    fixtureDateIso: date,
    kickoffTimeUtc,
    openIso: openDate ? openDate.toISOString() : null,
    closeIso: closeDate ? closeDate.toISOString() : null,
    payoutIso: closeDate ? closeDate.toISOString() : null,
    createdAtIso: openDate ? openDate.toISOString() : null,
    fixtureJson,
  };

  return { fixtureJson, meta };
}

function getLeagueMetaFromInference(inference, leagues) {
  const byKey = (leagues || []).find((league) => league.key === inference?.leagueSelectValue);
  if (byKey) {
    return { key: byKey.key, id: byKey.id, name: byKey.name, slug: byKey.slug };
  }
  const byId = (leagues || []).find((league) => league.id && league.id === inference?.leagueId);
  if (byId) {
    return { key: byId.key, id: byId.id, name: byId.name, slug: byId.slug };
  }

  const inferredHomeLeagueId = String(inference?.homeTeamMeta?.leagueId || "").trim();
  const inferredAwayLeagueId = String(inference?.awayTeamMeta?.leagueId || "").trim();
  if (inferredHomeLeagueId && inferredAwayLeagueId && inferredHomeLeagueId === inferredAwayLeagueId) {
    const byTeamLeague = (leagues || []).find((league) => league.id === inferredHomeLeagueId);
    if (byTeamLeague) {
      return {
        key: byTeamLeague.key,
        id: byTeamLeague.id,
        name: byTeamLeague.name,
        slug: byTeamLeague.slug,
      };
    }
  }
  if (inferredHomeLeagueId) {
    const byHomeLeague = (leagues || []).find((league) => league.id === inferredHomeLeagueId);
    if (byHomeLeague) {
      return {
        key: byHomeLeague.key,
        id: byHomeLeague.id,
        name: byHomeLeague.name,
        slug: byHomeLeague.slug,
      };
    }
  }
  if (inferredAwayLeagueId) {
    const byAwayLeague = (leagues || []).find((league) => league.id === inferredAwayLeagueId);
    if (byAwayLeague) {
      return {
        key: byAwayLeague.key,
        id: byAwayLeague.id,
        name: byAwayLeague.name,
        slug: byAwayLeague.slug,
      };
    }
  }

  const fallback = (leagues || [])[0];
  return fallback
    ? { key: fallback.key, id: fallback.id, name: fallback.name, slug: fallback.slug }
    : { key: "unknown", id: null, name: "Unknown League", slug: "league" };
}

function collectTeamMetaFromInferenceSide(inferredTeam, fallbackName, teams, leagueId, fallbackColor) {
  const name = String(fallbackName || inferredTeam?.name || "").trim();
  const catalogMatch = findExactTeamForLeague(name, teams || [], leagueId);
  const source = catalogMatch?.id ? "catalog" : "manual";

  return {
    name,
    id: catalogMatch?.id || null,
    alternateName: catalogMatch?.alternateName || name,
    code: (catalogMatch?.code || generateCodeFromName(name)).toUpperCase(),
    themeColor: normalizeHexColor(catalogMatch?.themeColor || fallbackColor),
    logoUrl: catalogMatch?.logoUrl || FIXTURE_LOGO_URL,
    slug: catalogMatch?.slug || slugify(name),
    leagueId: catalogMatch?.leagueId || leagueId || null,
    aliases: Array.isArray(catalogMatch?.aliases) ? catalogMatch.aliases : [],
    source,
  };
}

function parseUtcDateTime(dateYmd, timeHm) {
  if (!dateYmd || !timeHm) {
    return null;
  }
  const parsed = new Date(`${dateYmd}T${timeHm}:00Z`);
  if (Number.isNaN(parsed.getTime())) {
    return null;
  }
  return parsed;
}
