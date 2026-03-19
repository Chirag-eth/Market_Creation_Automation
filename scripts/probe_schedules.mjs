import { existsSync, readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

import {
  buildSportsDataScheduleProbeUrl,
  SPORTS_DATA_SCHEDULE_LEAGUES,
  summarizeSportsDataScheduleProbe,
} from "../src/data/scheduleProbe.js";

const __filename = fileURLToPath(import.meta.url);
const ROOT_DIR = path.resolve(path.dirname(__filename), "..");

loadDotEnv(path.resolve(ROOT_DIR, ".env"));

const SPORTSDATA_API_KEY = String(process.env.SPORTSDATA_API_KEY || "").trim();
const SPORTSDATA_SCHEDULE_BASE_URL = String(
  process.env.SPORTSDATA_SCHEDULE_BASE_URL || "https://api.sportsdata.io/v4/soccer/scores/json/Schedule"
).trim();
const SPORTSDATA_SCHEDULE_SEASON = Number.parseInt(String(process.env.SPORTSDATA_SCHEDULE_SEASON || "2026").trim(), 10);
const SCHEDULE_FETCH_TIMEOUT_MS = Number.parseInt(String(process.env.SCHEDULE_FETCH_TIMEOUT_MS || "8000").trim(), 10);
const SCHEDULE_NOW_ISO = String(process.env.SCHEDULE_NOW_ISO || "").trim();
const OUTPUT_JSON = process.argv.includes("--json");

const referenceNow = resolveReferenceNow();

if (!SPORTSDATA_API_KEY) {
  console.error("SPORTSDATA_API_KEY is not configured. Set it in .env or your shell before running probe:schedules.");
  process.exit(1);
}

let failed = false;
const summaries = [];

for (const league of SPORTS_DATA_SCHEDULE_LEAGUES) {
  try {
    const url = buildSportsDataScheduleProbeUrl({
      baseUrl: SPORTSDATA_SCHEDULE_BASE_URL,
      competitionId: league.competitionId,
      season: SPORTSDATA_SCHEDULE_SEASON,
      apiKey: SPORTSDATA_API_KEY,
    });
    const { rows, durationMs } = await fetchScheduleRows(url);
    const summary = summarizeSportsDataScheduleProbe(rows, {
      leagueCode: league.code,
      leagueLabel: league.label,
      url,
      status: 200,
      durationMs,
      referenceNow,
    });
    summaries.push(summary);
  } catch (error) {
    failed = true;
    summaries.push({
      league: league.code,
      league_label: league.label,
      status: 0,
      duration_ms: 0,
      reference_now: referenceNow.toISOString(),
      error: String(error?.message || error),
      raw_row_count: 0,
      normalized_fixture_count: 0,
      selected_week: null,
      selected_weeks: [],
      selected_label: null,
      selection_mode: "error",
      selected_fixture_count: 0,
      preview_fixtures: [],
    });
  }
}

if (OUTPUT_JSON) {
  console.log(JSON.stringify({
    generated_at: new Date().toISOString(),
    reference_now: referenceNow.toISOString(),
    results: summaries,
  }, null, 2));
} else {
  printHumanReport(summaries);
}

process.exit(failed ? 1 : 0);

async function fetchScheduleRows(url) {
  const controller = new AbortController();
  const startedAt = Date.now();
  const timeoutMs = Number.isFinite(SCHEDULE_FETCH_TIMEOUT_MS) && SCHEDULE_FETCH_TIMEOUT_MS > 0
    ? SCHEDULE_FETCH_TIMEOUT_MS
    : 8000;
  const timeoutId = setTimeout(() => controller.abort(), timeoutMs);

  try {
    const response = await fetch(url, {
      headers: {
        Accept: "application/json",
      },
      signal: controller.signal,
    });
    if (!response.ok) {
      throw new Error(`SportsData returned ${response.status} for ${url}.`);
    }
    const parsed = await response.json();
    if (!Array.isArray(parsed)) {
      throw new Error(`SportsData returned a non-array payload for ${url}.`);
    }
    return {
      rows: parsed,
      durationMs: Date.now() - startedAt,
    };
  } catch (error) {
    if (error?.name === "AbortError") {
      throw new Error(`SportsData request timed out after ${timeoutMs}ms for ${url}.`);
    }
    throw error;
  } finally {
    clearTimeout(timeoutId);
  }
}

function printHumanReport(summaries) {
  const lines = [];
  lines.push("Live SportsData schedule probe");
  lines.push(`Reference UTC: ${referenceNow.toISOString()}`);
  lines.push("");

  for (const summary of summaries) {
    if (summary.error) {
      lines.push(`[${String(summary.league_label || summary.league || "").toUpperCase()}] FAILED`);
      lines.push(`  Error: ${summary.error}`);
      lines.push("");
      continue;
    }

    lines.push(
      `[${String(summary.league_label || summary.league || "").toUpperCase()}] OK · ${summary.status} · ${summary.duration_ms}ms`
    );
    lines.push(`  Raw rows: ${summary.raw_row_count}`);
    lines.push(`  Normalized fixtures: ${summary.normalized_fixture_count}`);
    lines.push(
      `  Selected window: ${summary.selected_label || "none"} (${summary.selected_weeks.length ? summary.selected_weeks.join(", ") : "no weeks"})`
    );
    lines.push(`  Selected fixture count: ${summary.selected_fixture_count}`);
    if (summary.preview_fixtures.length > 0) {
      lines.push("  Preview:");
      for (const fixture of summary.preview_fixtures) {
        lines.push(
          `    - ${fixture.eventName} | Game ID ${fixture.gameId || "n/a"} | ${fixture.fixtureDate} ${fixture.kickoffTimeUtc} UTC | Matchday ${fixture.matchDay ?? "n/a"}`
        );
      }
    }
    lines.push("");
  }

  process.stdout.write(`${lines.join("\n").trimEnd()}\n`);
}

function resolveReferenceNow() {
  if (SCHEDULE_NOW_ISO) {
    const parsed = new Date(SCHEDULE_NOW_ISO);
    if (!Number.isNaN(parsed.getTime())) {
      return parsed;
    }
  }
  return new Date();
}

function loadDotEnv(filePath) {
  if (!existsSync(filePath)) {
    return;
  }

  let raw;
  try {
    raw = readFileSync(filePath, "utf8");
  } catch {
    return;
  }

  const lines = String(raw || "").split(/\r?\n/);
  for (const line of lines) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith("#")) {
      continue;
    }
    const eq = trimmed.indexOf("=");
    if (eq <= 0) {
      continue;
    }
    const key = trimmed.slice(0, eq).trim();
    if (!key || process.env[key] != null) {
      continue;
    }
    let value = trimmed.slice(eq + 1).trim();
    if (
      (value.startsWith("\"") && value.endsWith("\"")) ||
      (value.startsWith("'") && value.endsWith("'"))
    ) {
      value = value.slice(1, -1);
    }
    process.env[key] = value;
  }
}
