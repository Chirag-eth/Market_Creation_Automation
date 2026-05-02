import { createNormalizedFixtureRecord, createNormalizedFixtureWindowPayload } from "../normalizedFixtureContract.js";
import { getLeagueScheduleDefinition } from "../../shared/leagueRegistry.js";

export const GAMMA_POLYMARKET_SOURCE_KEY = "gamma-polymarket";

const GAMMA_BASE_URL = "https://gamma-api.polymarket.com";
const CACHE_TTL_MS = 5 * 60 * 1000; // 5 min per slug

// Per-slug cache: slug → { events: [], time: number }
const _slugCache = new Map();

const GAMMA_POLYMARKET_SOURCE = Object.freeze({
  key: GAMMA_POLYMARKET_SOURCE_KEY,
  label: "Gamma Polymarket",
  kind: "public-api",
  status: "experimental",
  fetchRawRows: fetchGammaPolymarketRawRows,
  createFixtureWindowPayload: createGammaFixtureWindowPayload,
});

export function getGammaPolymarketFixtureSourceAdapter() {
  return GAMMA_POLYMARKET_SOURCE;
}

export async function fetchGammaPolymarketRawRows({
  leagueCode,
  env = process.env,
  timeoutMs = 10000,
  fetchImpl = fetch,
} = {}) {
  if (String(env?.GAMMA_POLYMARKET_ENABLED ?? "1").trim() === "0") {
    throw new Error(`Gamma Polymarket schedule source is disabled.`);
  }

  const definition = getLeagueScheduleDefinition(leagueCode);
  if (!definition) {
    throw new Error(`No league definition for "${leagueCode}".`);
  }

  const tagSlugs = definition.gammaTagSlugs;
  if (!Array.isArray(tagSlugs) || !tagSlugs.length) {
    throw new Error(`No gamma tag slugs configured for league "${leagueCode}".`);
  }

  // Fetch each slug in parallel and merge by event ID — avoids pagination issues
  // with the global soccer dump (which has 2000+ events spread across many pages)
  const results = await Promise.allSettled(
    tagSlugs.map((slug) => fetchEventsBySlug(slug, { timeoutMs, fetchImpl }))
  );

  const seen = new Set();
  const events = [];
  for (const result of results) {
    if (result.status !== "fulfilled") continue;
    for (const event of result.value) {
      const id = String(event.id || "");
      if (!id || seen.has(id)) continue;
      seen.add(id);
      events.push(event);
    }
  }

  return events;
}

export function createGammaFixtureWindowPayload({
  leagueCode,
  rawRows = [],
  now = new Date(),
  fetchedAt = new Date().toISOString(),
} = {}) {
  const referenceNow = now instanceof Date && !Number.isNaN(now.getTime()) ? now : new Date();
  const nowMs = referenceNow.getTime();
  const fixtures = normalizeGammaRows(rawRows).filter(
    (f) => Number.isFinite(f.kickoffMs) && f.kickoffMs >= nowMs && !f.isClosed
  );

  return createNormalizedFixtureWindowPayload({
    league: leagueCode,
    source: GAMMA_POLYMARKET_SOURCE_KEY,
    fetchedAt,
    referenceNow,
    selectedWeek: null,
    selectedWeeks: [],
    selectedLabel: fixtures.length > 0 ? "Upcoming fixtures" : null,
    selectionMode: fixtures.length > 0 ? "rolling-upcoming" : "none",
    fixtures,
  });
}

export function normalizeGammaRows(rows) {
  return (Array.isArray(rows) ? rows : [])
    .map(normalizeGammaRow)
    .filter(Boolean)
    .sort(
      (a, b) =>
        (a.kickoffMs || Number.MAX_SAFE_INTEGER) - (b.kickoffMs || Number.MAX_SAFE_INTEGER) ||
        String(a.eventName || "").localeCompare(String(b.eventName || ""))
    );
}

export function normalizeGammaRow(row) {
  if (!row || typeof row !== "object") return null;

  let title = String(row.title || "").trim();
  if (!/\bvs\.?\s/i.test(title) && !/\bvs\.?$/i.test(title)) return null;

  // Strip league prefix: "EPL: Arsenal vs Tottenham" → "Arsenal vs Tottenham"
  const colonIdx = title.indexOf(":");
  if (colonIdx !== -1 && colonIdx < 35) {
    title = title.slice(colonIdx + 1).trim();
  }

  // Skip sub-market variants: "Arsenal vs Tottenham - Exact Score", "- Halftime Result", etc.
  if (title.includes(" - ")) return null;

  const { homeTeamName, awayTeamName } = splitTitle(title);
  if (!homeTeamName || !awayTeamName) return null;

  // gameStartTime from first market is the actual kickoff time
  const markets = Array.isArray(row.markets) ? row.markets : [];
  let kickoffIso = "";
  for (const m of markets) {
    const raw = String(m.gameStartTime || "").trim();
    if (!raw) continue;
    // Format: "2025-08-16 14:00:00+00" or "2025-08-16 14:00:00"
    const d = new Date(raw.replace(" ", "T").replace(/\+00$/, "Z"));
    if (!Number.isNaN(d.getTime())) {
      kickoffIso = d.toISOString();
      break;
    }
  }
  if (!kickoffIso) {
    // Fallback: endDate of the event
    const d = new Date(String(row.endDate || ""));
    if (!Number.isNaN(d.getTime())) kickoffIso = d.toISOString();
  }
  if (!kickoffIso) return null;

  const kickoff = new Date(kickoffIso);
  const ended = Boolean(row.closed || row.archived);
  const eventName = `${homeTeamName} vs ${awayTeamName}`;

  return createNormalizedFixtureRecord({
    provider: GAMMA_POLYMARKET_SOURCE_KEY,
    providerFixtureId: String(row.id || "").trim(),
    gameId: "",
    eventName,
    homeTeamName,
    awayTeamName,
    fixtureDate: kickoffIso.slice(0, 10),
    kickoffTimeUtc: kickoffIso.slice(11, 16),
    kickoffIso,
    status: ended ? "Final" : "Scheduled",
    isClosed: ended,
    optionLabel: buildOptionLabel(eventName, kickoff),
    sourceMeta: {
      slug: String(row.slug || "").trim() || null,
      polymarketEventId: String(row.id || "").trim() || null,
    },
  });
}

async function fetchEventsBySlug(slug, { timeoutMs = 10000, fetchImpl = fetch } = {}) {
  const now = Date.now();
  const cached = _slugCache.get(slug);
  if (cached && now - cached.time < CACHE_TTL_MS) {
    return cached.events;
  }

  const url = new URL(`${GAMMA_BASE_URL}/events`);
  url.searchParams.set("tag_slug", slug);
  url.searchParams.set("closed", "false");
  url.searchParams.set("limit", "500");

  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const response = await fetchImpl(url.toString(), {
      signal: controller.signal,
      headers: { Accept: "application/json" },
    });
    if (!response.ok) {
      throw new Error(`Gamma API returned ${response.status}`);
    }
    const data = await response.json();
    const events = Array.isArray(data) ? data : [];
    _slugCache.set(slug, { events, time: now });
    return events;
  } catch (err) {
    if (err?.name === "AbortError") {
      throw new Error(`Gamma API timed out after ${timeoutMs}ms`);
    }
    throw err;
  } finally {
    clearTimeout(timeoutId);
  }
}

function splitTitle(title) {
  const parts = title
    .split(/\s+vs\.?\s+/i)
    .map((s) => s.trim())
    .filter(Boolean);
  if (parts.length >= 2) {
    return { homeTeamName: parts[0], awayTeamName: parts.slice(1).join(" vs ") };
  }
  return { homeTeamName: "", awayTeamName: "" };
}

function buildOptionLabel(eventName, kickoffDate) {
  const weekday = kickoffDate.toLocaleDateString("en-GB", { weekday: "short", timeZone: "UTC" });
  const month = kickoffDate.toLocaleDateString("en-GB", { month: "short", timeZone: "UTC" });
  const day = kickoffDate.toLocaleDateString("en-GB", { day: "numeric", timeZone: "UTC" });
  const time = kickoffDate.toLocaleTimeString("en-GB", {
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
    timeZone: "UTC",
  });
  return `${eventName} · ${weekday}, ${month} ${day} · ${time} UTC · Gamma/Polymarket`;
}
