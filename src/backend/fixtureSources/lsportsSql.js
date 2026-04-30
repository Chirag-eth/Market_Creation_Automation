import path from "node:path";
import { existsSync, readFileSync, statSync } from "node:fs";

import { resolveLeagueScheduleCode } from "../../shared/leagueRegistry.js";
import { createNormalizedFixtureWindowPayload } from "../normalizedFixtureContract.js";
import { SCHEDULE_SOURCE_LSPORTS_SQL } from "../scheduleSources.js";
import {
  normalizeLsportsDbRows,
  resolveLsportsLeagueMapping,
} from "./lsportsDb.js";

export const LSPORTS_SQL_FIXTURE_SOURCE_KEY = SCHEDULE_SOURCE_LSPORTS_SQL;

let parsedSqlCache = {
  filePath: "",
  mtimeMs: 0,
  size: 0,
  rows: [],
};

const LSPORTS_SQL_ADAPTER = Object.freeze({
  key: LSPORTS_SQL_FIXTURE_SOURCE_KEY,
  label: "Lsports SQL",
  kind: "sql-dump",
  status: "legacy",
  fetchRawRows: fetchLsportsSqlRawRows,
  createFixtureWindowPayload: createLsportsSqlFixtureWindowPayload,
});

export function getLsportsSqlFixtureSourceAdapter() {
  return LSPORTS_SQL_ADAPTER;
}

export async function fetchLsportsSqlRawRows({
  leagueCode = "",
  sqlFilePath = "",
  rootDir = process.cwd(),
  pool = null,
  cmsLeagueId = "",
  now = new Date(),
  limit = 400,
} = {}) {
  const resolvedSqlFilePath = resolveLsportsSqlFilePath(sqlFilePath, rootDir);
  if (!resolvedSqlFilePath || !existsSync(resolvedSqlFilePath)) {
    throw new Error(`The lsports-sql schedule source file is missing: ${sqlFilePath || resolvedSqlFilePath || "<unset>"}.`);
  }

  const parsedRows = loadParsedLsportsSqlRows(resolvedSqlFilePath);
  const mapping = await resolveSqlLeagueMapping({
    pool,
    cmsLeagueId,
    leagueCode,
  });

  const referenceNow = now instanceof Date && !Number.isNaN(now.getTime()) ? now : new Date();
  const lookbackMs = referenceNow.getTime() - 6 * 60 * 60 * 1000;
  const maxRows = Number.isInteger(limit) && limit > 0 ? limit : 400;

  return parsedRows
    .filter((row) => matchesLeague(row, { leagueCode, lsportsLeagueId: mapping.lsportsLeagueId }))
    .filter((row) => {
      const kickoff = new Date(String(row?.start_time || ""));
      return !Number.isNaN(kickoff.getTime()) && kickoff.getTime() >= lookbackMs;
    })
    .sort((left, right) => {
      const leftMs = new Date(String(left?.start_time || "")).getTime();
      const rightMs = new Date(String(right?.start_time || "")).getTime();
      return leftMs - rightMs || String(left?.fixture_id || "").localeCompare(String(right?.fixture_id || ""));
    })
    .slice(0, maxRows)
    .map((row) => ({
      ...row,
      cms_league_id: mapping.cmsLeagueId,
      default_source: mapping.defaultSource,
    }));
}

export function createLsportsSqlFixtureWindowPayload({
  leagueCode = "",
  rawRows,
  now = new Date(),
  fetchedAt = new Date().toISOString(),
} = {}) {
  const referenceNow = now instanceof Date && !Number.isNaN(now.getTime()) ? now : new Date();
  const nowMs = referenceNow.getTime();
  const fixtures = normalizeLsportsSqlRows(rawRows).filter(
    (fixture) => Number.isFinite(fixture.kickoffMs) && fixture.kickoffMs >= nowMs && !fixture.isClosed
  );

  return createNormalizedFixtureWindowPayload({
    league: leagueCode,
    source: LSPORTS_SQL_FIXTURE_SOURCE_KEY,
    fetchedAt,
    referenceNow,
    selectedWeek: null,
    selectedWeeks: [],
    selectedLabel: fixtures.length > 0 ? "Upcoming fixtures" : null,
    selectionMode: fixtures.length > 0 ? "rolling-upcoming" : "none",
    fixtures,
  });
}

export function parseLsportsScheduleSql(raw) {
  const text = String(raw || "");
  if (!text.trim()) {
    return [];
  }

  const statements = text.match(/INSERT INTO\s+"lsports_schedule_fixtures"\s*\([\s\S]*?\)\s*VALUES[\s\S]*?;/gi) || [];
  const rows = [];

  for (const statement of statements) {
    const columns = parseInsertColumns(statement);
    const valuesBlock = extractValuesBlock(statement);
    if (!columns.length || !valuesBlock) {
      continue;
    }

    for (const tuple of parseValuesBlock(valuesBlock)) {
      const row = {};
      for (let index = 0; index < columns.length; index += 1) {
        row[columns[index]] = tuple[index] ?? null;
      }
      rows.push(row);
    }
  }

  return rows;
}

export function normalizeLsportsSqlRows(rows) {
  return normalizeLsportsDbRows(rows).map((fixture) => ({
    ...fixture,
    provider: LSPORTS_SQL_FIXTURE_SOURCE_KEY,
  }));
}

export function readLsportsSqlLeagueCodes({
  sqlFilePath = "",
  rootDir = process.cwd(),
} = {}) {
  const resolvedSqlFilePath = resolveLsportsSqlFilePath(sqlFilePath, rootDir);
  if (!resolvedSqlFilePath || !existsSync(resolvedSqlFilePath)) {
    return [];
  }
  const rows = loadParsedLsportsSqlRows(resolvedSqlFilePath);
  const codes = new Set();
  for (const row of rows) {
    const code = resolveLeagueScheduleCode(row?.league_name);
    if (code) {
      codes.add(code);
    }
  }
  return Array.from(codes);
}

function loadParsedLsportsSqlRows(filePath) {
  const stats = statSync(filePath);
  if (
    parsedSqlCache.filePath === filePath &&
    parsedSqlCache.mtimeMs === stats.mtimeMs &&
    parsedSqlCache.size === stats.size
  ) {
    return parsedSqlCache.rows;
  }

  const rows = parseLsportsScheduleSql(readFileSync(filePath, "utf8"));
  parsedSqlCache = {
    filePath,
    mtimeMs: stats.mtimeMs,
    size: stats.size,
    rows,
  };
  return rows;
}

async function resolveSqlLeagueMapping({ pool = null, cmsLeagueId = "", leagueCode = "" } = {}) {
  const normalizedCmsLeagueId = String(cmsLeagueId || "").trim();
  if (!pool || !normalizedCmsLeagueId) {
    return {
      cmsLeagueId: normalizedCmsLeagueId,
      lsportsLeagueId: "",
      defaultSource: "",
    };
  }

  try {
    const mapping = await resolveLsportsLeagueMapping(pool, { cmsLeagueId: normalizedCmsLeagueId });
    if (mapping?.lsportsLeagueId) {
      return {
        cmsLeagueId: mapping.cmsLeagueId || normalizedCmsLeagueId,
        lsportsLeagueId: mapping.lsportsLeagueId,
        defaultSource: mapping.defaultSource || "",
      };
    }
  } catch {
    // Fall through to league-name matching when DB mappings are unavailable.
  }

  return {
    cmsLeagueId: normalizedCmsLeagueId,
    lsportsLeagueId: "",
    defaultSource: "",
    leagueCode,
  };
}

function matchesLeague(row, { leagueCode = "", lsportsLeagueId = "" } = {}) {
  const normalizedLsportsLeagueId = String(lsportsLeagueId || "").trim();
  if (normalizedLsportsLeagueId) {
    return String(row?.league_id || "").trim() === normalizedLsportsLeagueId;
  }
  return resolveLeagueScheduleCode(row?.league_name) === leagueCode;
}

function resolveLsportsSqlFilePath(filePath, rootDir) {
  const normalized = String(filePath || "").trim();
  if (!normalized) {
    return "";
  }
  if (path.isAbsolute(normalized)) {
    return normalized;
  }
  return path.resolve(rootDir || process.cwd(), normalized);
}

function parseInsertColumns(statement) {
  const match = String(statement || "").match(
    /INSERT INTO\s+"lsports_schedule_fixtures"\s*\(([\s\S]*?)\)\s*VALUES/i
  );
  if (!match) {
    return [];
  }
  return String(match[1] || "")
    .split(",")
    .map((value) => value.replace(/"/g, "").trim())
    .filter(Boolean);
}

function extractValuesBlock(statement) {
  const normalized = String(statement || "");
  const valuesIndex = normalized.search(/\bVALUES\b/i);
  if (valuesIndex < 0) {
    return "";
  }
  const semicolonIndex = normalized.lastIndexOf(";");
  return normalized.slice(valuesIndex + "VALUES".length, semicolonIndex >= 0 ? semicolonIndex : normalized.length);
}

function parseValuesBlock(block) {
  const rows = [];
  let row = null;
  let field = "";
  let inString = false;

  for (let index = 0; index < block.length; index += 1) {
    const char = block[index];

    if (inString) {
      if (char === "'") {
        if (block[index + 1] === "'") {
          field += "'";
          index += 1;
        } else {
          inString = false;
        }
      } else {
        field += char;
      }
      continue;
    }

    if (char === "'") {
      inString = true;
      continue;
    }

    if (char === "(") {
      row = [];
      field = "";
      continue;
    }

    if (char === ")" && row) {
      row.push(parseSqlLiteral(field));
      rows.push(row);
      row = null;
      field = "";
      continue;
    }

    if (char === "," && row) {
      row.push(parseSqlLiteral(field));
      field = "";
      continue;
    }

    if (row) {
      field += char;
    }
  }

  return rows;
}

function parseSqlLiteral(raw) {
  const trimmed = String(raw || "").trim();
  if (!trimmed || /^null$/i.test(trimmed)) {
    return null;
  }
  return trimmed;
}
