import fs from "node:fs/promises";
import path from "node:path";

import { createNormalizedFixtureWindowPayload } from "../normalizedFixtureContract.js";
import { getLeagueScheduleDefinition, getLeagueScheduleDefinitions } from "../../shared/leagueRegistry.js";
import {
  buildSportsDataScheduleUrl,
  parseCompetitionId,
  selectUpcomingSportsDataWeek,
} from "../../shared/sportsdataFixtures.js";

export const SPORTSDATA_FIXTURE_SOURCE_KEY = "sportsdata";
const CSV_FIXTURE_PATH_ALLOWED_LEAGUES = new Set(["fifa-friendlies"]);

const SPORTSDATA_FIXTURE_SOURCE = Object.freeze({
  key: SPORTSDATA_FIXTURE_SOURCE_KEY,
  label: "SportsData",
  kind: "live-api",
  status: "active",
  fetchRawRows: fetchSportsDataRawRows,
  createFixtureWindowPayload: createSportsDataFixtureWindowPayload,
});

export function getSportsDataFixtureSourceAdapter() {
  return SPORTSDATA_FIXTURE_SOURCE;
}

export { buildSportsDataScheduleUrl, parseCompetitionId };

export function createSportsDataScheduleSupportMetadata({ env = process.env } = {}) {
  const leagues = getLeagueScheduleDefinitions().map((definition) => {
    const runtimeConfig = buildSportsDataRuntimeConfig({
      leagueCode: definition.code,
      env,
    });
    const explicitCompetitionId = String(env?.[definition.competitionIdEnvName] || "").trim();
    const fixturePath = String(runtimeConfig?.fixturePath || "").trim();
    const ready = Boolean(runtimeConfig?.competitionId || fixturePath);

    let configSource = "unconfigured";
    if (fixturePath) {
      configSource = "fixture-path";
    } else if (explicitCompetitionId) {
      configSource = "env-competition-id";
    } else if (runtimeConfig?.competitionId) {
      configSource = "default-competition-id";
    }

    return {
      code: definition.code,
      label: definition.label,
      ready,
      config_source: configSource,
    };
  });

  return {
    provider: SPORTSDATA_FIXTURE_SOURCE_KEY,
    ready_leagues: leagues.filter((league) => league.ready).map((league) => league.code),
    leagues,
  };
}

export function buildSportsDataRuntimeConfig({
  leagueCode,
  env = process.env,
  baseUrl = "",
  season = 2026,
} = {}) {
  const definition = getLeagueScheduleDefinition(leagueCode);
  if (!definition) {
    return null;
  }

  return {
    competitionId: parseCompetitionId(
      env?.[definition.competitionIdEnvName],
      definition.defaultCompetitionId
    ),
    fixturePath: String(env?.[definition.fixturePathEnvName] || "").trim(),
    fixtureEnvName: definition.fixturePathEnvName,
    competitionEnvName: definition.competitionIdEnvName,
    label: definition.label,
    apiKey: String(env?.SPORTSDATA_API_KEY || "").trim(),
    baseUrl: String(baseUrl || env?.SPORTSDATA_SCHEDULE_BASE_URL || "").trim(),
    season: resolveSportsDataSeason(season, env?.SPORTSDATA_SCHEDULE_SEASON),
  };
}

export async function fetchSportsDataRawRows({
  leagueCode,
  env = process.env,
  rootDir = process.cwd(),
  timeoutMs = 8000,
  baseUrl = "",
  season = 2026,
  fetchImpl = fetch,
} = {}) {
  const runtimeConfig = buildSportsDataRuntimeConfig({
    leagueCode,
    env,
    baseUrl,
    season,
  });

  if (!runtimeConfig) {
    throw new Error(`Schedule provider is not configured for league "${leagueCode}".`);
  }

  if (runtimeConfig.fixturePath) {
    const raw = await fs.readFile(path.resolve(rootDir, runtimeConfig.fixturePath), "utf8");
    if (runtimeConfig.fixturePath.toLowerCase().endsWith(".csv")) {
      if (!CSV_FIXTURE_PATH_ALLOWED_LEAGUES.has(String(leagueCode || "").trim().toLowerCase())) {
        throw new Error(
          `${runtimeConfig.fixtureEnvName} must point to a JSON array for league "${leagueCode}". CSV fixture paths are only supported for fifa-friendlies.`
        );
      }
      return parseFixturePathCsv(raw);
    }
    const parsed = JSON.parse(raw);
    if (!Array.isArray(parsed)) {
      throw new Error(`${runtimeConfig.fixtureEnvName} must point to a JSON array.`);
    }
    return parsed;
  }

  if (!runtimeConfig.competitionId) {
    throw new Error(
      `Schedule provider is not configured for league "${leagueCode}". Set ${runtimeConfig.competitionEnvName} or ${runtimeConfig.fixtureEnvName}.`
    );
  }

  if (!runtimeConfig.apiKey) {
    throw new Error("SPORTSDATA_API_KEY is not configured on the server.");
  }

  const requestUrl = buildSportsDataScheduleUrl({
    baseUrl: runtimeConfig.baseUrl,
    competitionId: runtimeConfig.competitionId,
    season: runtimeConfig.season,
    apiKey: runtimeConfig.apiKey,
  });

  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), timeoutMs);

  try {
    const response = await fetchImpl(requestUrl, {
      signal: controller.signal,
      headers: {
        Accept: "application/json",
      },
    });

    if (!response.ok) {
      throw new Error(`SportsData returned ${response.status}.`);
    }

    const parsed = await response.json();
    if (!Array.isArray(parsed)) {
      throw new Error("SportsData schedule response must be a JSON array.");
    }

    return parsed;
  } catch (error) {
    if (error?.name === "AbortError") {
      throw new Error(`SportsData request timed out after ${timeoutMs}ms.`);
    }
    throw error;
  } finally {
    clearTimeout(timeoutId);
  }
}

export function createSportsDataFixtureWindowPayload({
  leagueCode,
  rawRows,
  now = new Date(),
  fetchedAt = new Date().toISOString(),
} = {}) {
  const selection = selectUpcomingSportsDataWeek(rawRows, { now });
  return createNormalizedFixtureWindowPayload({
    league: leagueCode,
    source: SPORTSDATA_FIXTURE_SOURCE_KEY,
    fetchedAt,
    referenceNow: now,
    selectedWeek: selection.selectedWeek,
    selectedWeeks: selection.selectedWeeks,
    selectedLabel: selection.selectedLabel,
    selectionMode: selection.selectionMode,
    fixtures: selection.fixtures,
  });
}

function resolveSportsDataSeason(preferredSeason, envSeason) {
  const explicitSeason = parseCompetitionId(preferredSeason);
  if (explicitSeason) {
    return explicitSeason;
  }
  return parseCompetitionId(envSeason, 2026);
}

function parseFixturePathCsv(input) {
  return parseDelimitedCsv(input, ",")
    .map((row) => normalizeFixturePathCsvRow(row))
    .filter(Boolean);
}

function normalizeFixturePathCsvRow(row) {
  const rawStart = String(row?.["Start Date"] || "").replace(/\s+/g, " ").trim();
  const rawFixtureId = String(row?.["Fixture ID"] || "").trim().replace(/^#/, "");
  const rawLeague = String(row?.League || "").trim();
  const rawStatus = String(row?.Status || "").trim();
  const participants = String(row?.["Home / Away"] || "")
    .split(/\r?\n/)
    .map((value) => String(value || "").trim())
    .filter(Boolean);
  const [homeTeamName = "", awayTeamName = ""] = participants;

  if (!rawStart || !homeTeamName || !awayTeamName) {
    return null;
  }

  const kickoff = new Date(`${rawStart} UTC`);
  if (Number.isNaN(kickoff.getTime())) {
    return null;
  }

  return {
    GameId: rawFixtureId,
    Name: rawLeague || null,
    DateTime: kickoff.toISOString(),
    Status: normalizeFixturePathStatus(rawStatus),
    IsClosed: false,
    HomeTeamName: homeTeamName,
    AwayTeamName: awayTeamName,
  };
}

function normalizeFixturePathStatus(value) {
  const normalized = String(value || "").trim().toUpperCase();
  if (!normalized) {
    return "Scheduled";
  }
  if (normalized === "NSY") {
    return "Scheduled";
  }
  return normalized;
}

function parseDelimitedCsv(input, delimiter = ",") {
  const rows = [];
  let row = [];
  let field = "";
  let i = 0;
  let inQuotes = false;
  const text = stripBom(String(input || ""));

  while (i < text.length) {
    const ch = text[i];

    if (inQuotes) {
      if (ch === "\"") {
        if (text[i + 1] === "\"") {
          field += "\"";
          i += 2;
          continue;
        }
        inQuotes = false;
        i += 1;
        continue;
      }
      field += ch;
      i += 1;
      continue;
    }

    if (ch === "\"") {
      inQuotes = true;
      i += 1;
      continue;
    }

    if (ch === delimiter) {
      row.push(field);
      field = "";
      i += 1;
      continue;
    }

    if (ch === "\n") {
      row.push(field);
      rows.push(row);
      row = [];
      field = "";
      i += 1;
      continue;
    }

    if (ch === "\r") {
      i += 1;
      continue;
    }

    field += ch;
    i += 1;
  }

  if (field.length > 0 || row.length > 0) {
    row.push(field);
    rows.push(row);
  }

  if (!rows.length) {
    return [];
  }

  const headers = rows[0].map((header) => String(header || "").trim());
  return rows.slice(1)
    .filter((values) => Array.isArray(values) && values.some((value) => String(value || "").trim() !== ""))
    .map((values) => {
      const record = {};
      for (let index = 0; index < headers.length; index += 1) {
        record[headers[index]] = values[index] ?? "";
      }
      return record;
    });
}

function stripBom(value) {
  return value.charCodeAt(0) === 0xfeff ? value.slice(1) : value;
}
