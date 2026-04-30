import {
  createNormalizedFixtureRecord,
  createNormalizedFixtureWindowPayload,
} from "../normalizedFixtureContract.js";
import { SCHEDULE_SOURCE_POLYMARKET } from "../scheduleSources.js";
import { getLeagueScheduleDefinition } from "../../shared/leagueRegistry.js";
import { normalizeForSearch } from "../../shared/util.js";

export const POLYMARKET_FIXTURE_SOURCE_KEY = SCHEDULE_SOURCE_POLYMARKET;
const DEFAULT_POLYMARKET_BASE_URL = "https://gateway.polymarket.us";

const POLYMARKET_FIXTURE_SOURCE = Object.freeze({
  key: POLYMARKET_FIXTURE_SOURCE_KEY,
  label: "Polymarket Sports",
  kind: "public-api",
  status: "experimental",
  fetchRawRows: fetchPolymarketRawRows,
  createFixtureWindowPayload: createPolymarketFixtureWindowPayload,
});

export function getPolymarketFixtureSourceAdapter() {
  return POLYMARKET_FIXTURE_SOURCE;
}

export function buildPolymarketRuntimeConfig({ leagueCode, env = process.env, baseUrl = "" } = {}) {
  const definition = getLeagueScheduleDefinition(leagueCode);
  if (!definition) {
    return null;
  }

  const explicitSlug = String(env?.[definition.polymarketLeagueSlugEnvName || ""] || "").trim();
  return {
    label: definition.label,
    baseUrl: String(baseUrl || env?.POLYMARKET_SCHEDULE_BASE_URL || DEFAULT_POLYMARKET_BASE_URL).trim(),
    leagueSlug: explicitSlug,
    leagueSlugEnvName: definition.polymarketLeagueSlugEnvName || "",
    enabled: String(env?.POLYMARKET_SCHEDULE_ENABLED || "1").trim().toLowerCase() !== "0",
    discoveryLimit: parsePositiveInteger(env?.POLYMARKET_SCHEDULE_LEAGUES_LIMIT, 100),
  };
}

export async function fetchPolymarketRawRows({
  leagueCode,
  env = process.env,
  timeoutMs = 8000,
  baseUrl = "",
  fetchImpl = fetch,
} = {}) {
  const runtimeConfig = buildPolymarketRuntimeConfig({ leagueCode, env, baseUrl });
  if (!runtimeConfig || !runtimeConfig.enabled) {
    throw new Error(`Polymarket schedule source is disabled for league "${leagueCode}".`);
  }
  if (!runtimeConfig.baseUrl) {
    throw new Error("POLYMARKET_SCHEDULE_BASE_URL is not configured.");
  }

  const leagueSlug =
    runtimeConfig.leagueSlug ||
    (await discoverPolymarketLeagueSlug({
      leagueCode,
      baseUrl: runtimeConfig.baseUrl,
      limit: runtimeConfig.discoveryLimit,
      timeoutMs,
      fetchImpl,
    }));

  if (!leagueSlug) {
    throw new Error(
      `Polymarket league slug could not be resolved for "${leagueCode}".` +
        (runtimeConfig.leagueSlugEnvName
          ? ` Set ${runtimeConfig.leagueSlugEnvName} to override discovery.`
          : "")
    );
  }

  const requestUrl = new URL(
    `${runtimeConfig.baseUrl.replace(/\/+$/, "")}/v2/leagues/${encodeURIComponent(leagueSlug)}/events`
  );
  requestUrl.searchParams.set("active", "true");
  requestUrl.searchParams.set("closed", "false");
  requestUrl.searchParams.set("limit", "200");

  const payload = await fetchPolymarketJson(requestUrl.toString(), { timeoutMs, fetchImpl });
  return Array.isArray(payload?.events) ? payload.events : [];
}

export async function discoverPolymarketLeagueSlug({
  leagueCode,
  baseUrl = DEFAULT_POLYMARKET_BASE_URL,
  limit = 100,
  timeoutMs = 8000,
  fetchImpl = fetch,
} = {}) {
  const definition = getLeagueScheduleDefinition(leagueCode);
  if (!definition) {
    return "";
  }

  const requestUrl = new URL(`${String(baseUrl || DEFAULT_POLYMARKET_BASE_URL).replace(/\/+$/, "")}/v2/leagues`);
  requestUrl.searchParams.set("limit", String(parsePositiveInteger(limit, 100)));

  const payload = await fetchPolymarketJson(requestUrl.toString(), { timeoutMs, fetchImpl });
  const leagues = Array.isArray(payload?.leagues) ? payload.leagues : [];
  const aliases = buildLeagueAliases(definition);

  for (const league of leagues) {
    const slug = String(league?.slug || "").trim();
    const name = String(league?.name || "").trim();
    const candidates = [slug, name].map((value) => normalizeForSearch(value)).filter(Boolean);
    if (candidates.some((value) => aliases.has(value))) {
      return slug;
    }
  }

  return "";
}

export function createPolymarketFixtureWindowPayload({
  leagueCode,
  rawRows = [],
  now = new Date(),
  fetchedAt = new Date().toISOString(),
} = {}) {
  const referenceNow = now instanceof Date && !Number.isNaN(now.getTime()) ? now : new Date();
  const nowMs = referenceNow.getTime();
  const fixtures = normalizePolymarketRows(rawRows).filter(
    (fixture) => Number.isFinite(fixture.kickoffMs) && fixture.kickoffMs >= nowMs && !fixture.isClosed
  );

  return createNormalizedFixtureWindowPayload({
    league: leagueCode,
    source: POLYMARKET_FIXTURE_SOURCE_KEY,
    fetchedAt,
    referenceNow,
    selectedWeek: null,
    selectedWeeks: [],
    selectedLabel: fixtures.length > 0 ? "Upcoming fixtures" : null,
    selectionMode: fixtures.length > 0 ? "rolling-upcoming" : "none",
    fixtures,
  });
}

export function normalizePolymarketRows(rows) {
  return (Array.isArray(rows) ? rows : [])
    .map((row) => normalizePolymarketRow(row))
    .filter(Boolean)
    .sort(
      (a, b) =>
        (a.kickoffMs || Number.MAX_SAFE_INTEGER) - (b.kickoffMs || Number.MAX_SAFE_INTEGER) ||
        String(a.eventName || "").localeCompare(String(b.eventName || ""))
    );
}

export function normalizePolymarketRow(row) {
  if (!row || typeof row !== "object") {
    return null;
  }

  const title = String(row.title || row.name || "").trim();
  const startDate = String(
    row.startDate || row.start_date || row.start_time || row.startTime || row.creationDate || ""
  ).trim();
  if (!title || !startDate) {
    return null;
  }

  const kickoff = new Date(startDate);
  if (Number.isNaN(kickoff.getTime())) {
    return null;
  }

  const participants = extractParticipants(row, title);
  if (!participants.homeTeamName || !participants.awayTeamName) {
    return null;
  }

  const kickoffIso = kickoff.toISOString();
  const gameId = String(
    row.gameId ||
      row.game_id ||
      row.metadata?.gameState?.gameId ||
      row.metadata?.gameState?.sportradarGameId ||
      row.id ||
      ""
  ).trim();
  const live = Boolean(row.live || row.metadata?.gameState?.live);
  const ended = Boolean(row.ended || row.closed || row.archived);
  const status = ended ? "Final" : live ? "Live" : "Scheduled";

  return createNormalizedFixtureRecord({
    provider: POLYMARKET_FIXTURE_SOURCE_KEY,
    providerFixtureId: String(row.id || gameId || "").trim(),
    gameId,
    eventName: title,
    homeTeamName: participants.homeTeamName,
    awayTeamName: participants.awayTeamName,
    fixtureDate: kickoffIso.slice(0, 10),
    kickoffTimeUtc: kickoffIso.slice(11, 16),
    kickoffIso,
    status,
    isClosed: ended,
    optionLabel: buildPolymarketOptionLabel(title, kickoff),
    sourceMeta: {
      slug: String(row.slug || "").trim() || null,
      league: String(row.league || row.sport?.name || "").trim() || null,
      polymarketEventId: String(row.id || "").trim() || null,
    },
  });
}

async function fetchPolymarketJson(url, { timeoutMs = 8000, fetchImpl = fetch } = {}) {
  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const response = await fetchImpl(url, {
      signal: controller.signal,
      headers: {
        Accept: "application/json",
      },
    });
    if (!response.ok) {
      throw new Error(`Polymarket returned ${response.status} for ${url}.`);
    }
    return await response.json();
  } catch (error) {
    if (error?.name === "AbortError") {
      throw new Error(`Polymarket request timed out after ${timeoutMs}ms.`);
    }
    throw error;
  } finally {
    clearTimeout(timeoutId);
  }
}

function extractParticipants(row, fallbackTitle = "") {
  const teams = Array.isArray(row.teams) ? row.teams : [];
  if (teams.length >= 2) {
    return {
      homeTeamName: String(teams[0]?.name || "").trim(),
      awayTeamName: String(teams[1]?.name || "").trim(),
    };
  }

  const participants = Array.isArray(row.participants) ? row.participants : [];
  if (participants.length >= 2) {
    return {
      homeTeamName: String(participants[0]?.name || participants[0] || "").trim(),
      awayTeamName: String(participants[1]?.name || participants[1] || "").trim(),
    };
  }

  return splitEventTitle(fallbackTitle);
}

function splitEventTitle(title) {
  const normalized = String(title || "").trim();
  const parts = normalized.split(/\s+vs\.?\s+|\s+v\s+/i).map((value) => String(value || "").trim()).filter(Boolean);
  if (parts.length >= 2) {
    return {
      homeTeamName: parts[0],
      awayTeamName: parts.slice(1).join(" vs "),
    };
  }
  return { homeTeamName: "", awayTeamName: "" };
}

function buildLeagueAliases(definition) {
  const aliases = new Set();
  const values = [definition?.code, definition?.label, ...(Array.isArray(definition?.aliases) ? definition.aliases : [])];
  for (const value of values) {
    const normalized = normalizeForSearch(value);
    if (normalized) {
      aliases.add(normalized);
      aliases.add(normalized.replace(/\s+/g, "-"));
    }
  }
  return aliases;
}

function buildPolymarketOptionLabel(eventName, kickoffDate) {
  const weekday = kickoffDate.toLocaleDateString("en-GB", { weekday: "short", timeZone: "UTC" });
  const month = kickoffDate.toLocaleDateString("en-GB", { month: "short", timeZone: "UTC" });
  const day = kickoffDate.toLocaleDateString("en-GB", { day: "numeric", timeZone: "UTC" });
  const time = kickoffDate.toLocaleTimeString("en-GB", {
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
    timeZone: "UTC",
  });
  return `${eventName} · ${weekday}, ${month} ${day} · ${time} UTC · Polymarket`;
}

function parsePositiveInteger(value, fallback) {
  const parsed = Number.parseInt(String(value || "").trim(), 10);
  return Number.isInteger(parsed) && parsed > 0 ? parsed : fallback;
}
