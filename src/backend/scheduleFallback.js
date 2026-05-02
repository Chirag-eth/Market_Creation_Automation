export async function resolveSchedulePayloadWithFallback({
  loadSportsData,
  loadLsportsDb,
  loadGammaPolymarket,
  loadPolymarket,
  loadLsportsCsv,
} = {}) {
  // Phase 1: fire both primary sources in parallel — eliminates serial timeout penalty
  const [sdResult, lsResult] = await Promise.allSettled([
    loadSportsData ? loadSportsData() : Promise.resolve(null),
    loadLsportsDb  ? loadLsportsDb()  : Promise.resolve(null),
  ]);

  const sdPayload = sdResult.status === "fulfilled" ? sdResult.value : null;
  const lsPayload = lsResult.status === "fulfilled" ? lsResult.value : null;
  const sdOk = hasSchedulePayload(sdPayload);
  const lsOk = hasSchedulePayload(lsPayload);

  if (sdOk && lsOk) return mergeSchedulePayloads(sdPayload, lsPayload);
  if (sdOk) return sdPayload;
  if (lsOk) return lsPayload;

  // Phase 2: serial fallbacks (gamma → polymarket → csv)
  try {
    const p = await loadGammaPolymarket?.();
    if (hasSchedulePayload(p)) return p;
  } catch {}

  try {
    const p = await loadPolymarket?.();
    if (hasSchedulePayload(p)) return p;
  } catch {}

  const csvPayload = await loadLsportsCsv?.();
  if (hasSchedulePayload(csvPayload)) return csvPayload;

  // All sources exhausted with no data — return empty payload so callers get 200 + [] fixtures
  // (502 is reserved for actual upstream failures, not "no data for this league")
  return { fixtures: [], source: "none", selectionMode: "none", selectedLabel: null };
}

export async function resolveRawScheduleRowsWithFallback({
  loadSportsData,
  loadLsportsDb,
  loadGammaPolymarket,
  loadPolymarket,
  loadLsportsCsv,
} = {}) {
  // Phase 1: fire both primary sources in parallel
  const [sdResult, lsResult] = await Promise.allSettled([
    loadSportsData ? loadSportsData() : Promise.resolve(null),
    loadLsportsDb  ? loadLsportsDb()  : Promise.resolve(null),
  ]);

  const sdRows = sdResult.status === "fulfilled" ? sdResult.value : null;
  const lsRows = lsResult.status === "fulfilled" ? lsResult.value : null;
  const sdOk = hasScheduleRows(sdRows);
  const lsOk = hasScheduleRows(lsRows);

  if (sdOk && lsOk) return mergeRawRows(sdRows, lsRows);
  if (sdOk) return sdRows;
  if (lsOk) return lsRows;

  // Phase 2: serial fallbacks
  try {
    const rows = await loadGammaPolymarket?.();
    if (hasScheduleRows(rows)) return rows;
  } catch {}

  try {
    const rows = await loadPolymarket?.();
    if (hasScheduleRows(rows)) return rows;
  } catch {}

  const csvRows = await loadLsportsCsv?.();
  if (hasScheduleRows(csvRows)) return csvRows;

  return [];
}

// ── Helpers ──────────────────────────────────────────────────────────────────

function hasSchedulePayload(payload) {
  if (!payload) return false;
  if (Array.isArray(payload.fixtures)) return payload.fixtures.length > 0;
  return true;
}

function hasScheduleRows(rows) {
  if (!rows) return false;
  if (Array.isArray(rows)) return rows.length > 0;
  return true;
}

function mergeSchedulePayloads(primary, secondary) {
  const seen = new Map();
  const merged = [];

  for (const f of Array.isArray(primary.fixtures) ? primary.fixtures : []) {
    const key = fixtureDedupeKey(f);
    seen.set(key, f);
    merged.push(f);
  }
  for (const f of Array.isArray(secondary.fixtures) ? secondary.fixtures : []) {
    const key = fixtureDedupeKey(f);
    if (!seen.has(key)) {
      seen.set(key, f);
      merged.push(f);
    } else if (!seen.get(key).gameId && f.gameId) {
      // Upgrade to the copy that has a real gameId (SportsData quality)
      const existing = seen.get(key);
      merged[merged.indexOf(existing)] = f;
      seen.set(key, f);
    }
  }

  merged.sort((a, b) => {
    const aMs = a.kickoffMs ?? (a.kickoffIso ? new Date(a.kickoffIso).getTime() : 0);
    const bMs = b.kickoffMs ?? (b.kickoffIso ? new Date(b.kickoffIso).getTime() : 0);
    return aMs - bMs;
  });

  return { ...primary, source: "merged", fixtures: merged };
}

function mergeRawRows(primary, secondary) {
  const seen = new Set(primary.map(fixtureDedupeKey));
  const merged = [...primary];
  for (const f of secondary) {
    const key = fixtureDedupeKey(f);
    if (!seen.has(key)) {
      seen.add(key);
      merged.push(f);
    }
  }
  return merged;
}

function fixtureDedupeKey(f) {
  const home = String(f.homeTeamName || f.home_team_name || "").toLowerCase().replace(/\s+/g, " ").trim();
  const away = String(f.awayTeamName || f.away_team_name || "").toLowerCase().replace(/\s+/g, " ").trim();
  const date = String(f.fixtureDate || f.fixture_date || f.kickoffIso || f.kickoff_iso || "").slice(0, 10);
  return `${home}|${away}|${date}`;
}
