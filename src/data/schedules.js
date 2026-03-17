import { normalizeForSearch } from "../shared/util.js";

export const SCHEDULE_API_ENDPOINT = "/api/schedules/upcoming";

const MONTHS_SHORT = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
const WEEKDAYS_SHORT = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];
const LEAGUE_ALIASES = {
  epl: new Set(["epl", "english premier league", "premier league"]),
  ucl: new Set(["ucl", "uefa champions league", "champions league"]),
  laliga: new Set(["laliga", "la liga", "spanish la liga"]),
};
const TERMINAL_STATUSES = new Set(["final", "fulltime", "awarded", "cancelled", "canceled"]);

export function resolveScheduleLeagueCode(league) {
  const candidates = [league?.key, league?.slug, league?.name, league?.alternateName];

  for (const candidate of candidates) {
    const normalized = normalizeForSearch(candidate);
    if (!normalized) {
      continue;
    }
    for (const [leagueCode, aliases] of Object.entries(LEAGUE_ALIASES)) {
      if (aliases.has(normalized)) {
        return leagueCode;
      }
    }
  }

  return null;
}

export async function fetchUpcomingFixturesForLeague(leagueCode, { refresh = true, referenceNowIso = "" } = {}) {
  const code = String(leagueCode || "").trim().toLowerCase();
  if (!code) {
    throw new Error("League code is required to load schedules.");
  }

  const query = new URLSearchParams({ league: code });
  if (refresh) {
    query.set("refresh", "1");
  }
  const referenceNow = String(referenceNowIso || "").trim();
  if (referenceNow) {
    query.set("now", referenceNow);
  }
  const response = await fetch(`${SCHEDULE_API_ENDPOINT}?${query.toString()}`, {
    cache: "no-store",
    credentials: "same-origin",
    headers: {
      Accept: "application/json",
    },
  });

  let payload = null;
  try {
    payload = await response.json();
  } catch {
    payload = null;
  }

  if (!response.ok) {
    const detail = String(payload?.detail || payload?.error || `Schedule endpoint returned ${response.status}`);
    throw new Error(detail);
  }

  return payload;
}

export function selectUpcomingSportsDataWeek(rows, { now = new Date() } = {}) {
  const nowDate = normalizeDate(now) || new Date();
  const nowMs = nowDate.getTime();
  const games = normalizeSportsDataRows(rows);
  const grouped = groupByBucket(games);
  const orderedWeeks = Array.from(grouped.entries())
    .map(([bucketKey, fixtures]) => ({
      bucketKey,
      selectedWeek: fixtures[0]?.matchDay ?? null,
      selectedLabel: buildBucketLabel(fixtures[0]),
      fixtures: fixtures.slice().sort((a, b) => a.kickoffMs - b.kickoffMs || a.eventName.localeCompare(b.eventName)),
    }))
    .sort((a, b) => a.fixtures[0].kickoffMs - b.fixtures[0].kickoffMs || String(a.bucketKey).localeCompare(String(b.bucketKey)));

  const upcomingWeeks = orderedWeeks
    .map((entry) => ({
      ...entry,
      fixtures: entry.fixtures.filter(
        (fixture) => fixture.kickoffMs >= nowMs && !isTerminalScheduleStatus(fixture.status, fixture.isClosed)
      ),
    }))
    .filter((entry) => entry.fixtures.length > 0);

  const selectedWeeks = upcomingWeeks.slice(0, 2);
  if (selectedWeeks.length > 0) {
    return {
      selectedWeek: selectedWeeks[0].selectedWeek,
      selectedWeeks: selectedWeeks.map((entry) => entry.selectedWeek).filter((value) => Number.isInteger(value)),
      selectedLabel: buildSelectionWindowLabel(selectedWeeks),
      selectionMode: "immediate-two-weeks",
      fixtures: selectedWeeks
        .flatMap((entry) => entry.fixtures)
        .map(stripInternalFixtureFields),
    };
  }

  return {
    selectedWeek: null,
    selectedWeeks: [],
    selectedLabel: null,
    selectionMode: "none",
    fixtures: [],
  };
}

export function normalizeSportsDataRows(rows) {
  if (!Array.isArray(rows)) {
    return [];
  }

  const normalized = [];
  for (const row of flattenSportsDataRows(rows)) {
    const fixture = normalizeSportsDataRow(row);
    if (fixture) {
      normalized.push(fixture);
    }
  }

  return normalized.sort((a, b) => a.kickoffMs - b.kickoffMs || a.eventName.localeCompare(b.eventName));
}

export function normalizeSportsDataRow(row) {
  const homeTeamName = String(row?.HomeTeamName || row?.homeTeamName || "").trim();
  const awayTeamName = String(row?.AwayTeamName || row?.awayTeamName || "").trim();
  const roundLabel = String(
    row?.RoundLabel ||
      row?.roundLabel ||
      row?.Name ||
      row?.name ||
      row?.RoundName ||
      row?.roundName ||
      ""
  ).trim();
  const matchDay = parseSportsDataMatchDay(row, roundLabel);
  const kickoffDate = parseSportsDataDateTime(row?.DateTime || row?.dateTime || row?.date_time);

  if (!homeTeamName || !awayTeamName || !kickoffDate) {
    return null;
  }

  const eventName = `${homeTeamName} vs ${awayTeamName}`;
  const kickoffIso = kickoffDate.toISOString();
  const gameId = extractSportsDataGameId(row, eventName);
  return {
    gameId,
    game_id: gameId,
    roundId: row?.RoundId ?? row?.roundId ?? null,
    matchDay,
    roundLabel: roundLabel || null,
    eventName,
    homeTeamName,
    awayTeamName,
    fixtureDate: kickoffIso.slice(0, 10),
    kickoffTimeUtc: kickoffIso.slice(11, 16),
    kickoffIso,
    kickoffMs: kickoffDate.getTime(),
    status: String(row?.Status || row?.status || "").trim() || "Scheduled",
    isClosed: Boolean(row?.IsClosed),
    optionLabel: buildFixtureOptionLabel(eventName, kickoffDate, matchDay, roundLabel),
  };
}

export function parseSportsDataDateTime(value) {
  const raw = String(value || "").trim();
  if (!raw) {
    return null;
  }

  const withZone = /(?:z|[+-]\d{2}:\d{2})$/i.test(raw) ? raw : `${raw}Z`;
  const parsed = new Date(withZone);
  return Number.isNaN(parsed.getTime()) ? null : parsed;
}

function flattenSportsDataRows(rows) {
  const flattened = [];

  for (const row of rows) {
    if (Array.isArray(row?.Games)) {
      const roundLabel = String(row?.Name || row?.name || row?.RoundName || row?.roundName || "").trim();
      const roundWeek = parseSportsDataMatchDay(row, roundLabel);
      for (const game of row.Games) {
        flattened.push({
          ...game,
          RoundLabel: game?.RoundLabel || roundLabel || null,
          Week: game?.Week ?? game?.week ?? roundWeek ?? null,
        });
      }
      continue;
    }
    flattened.push(row);
  }

  return flattened;
}

function groupByBucket(games) {
  const grouped = new Map();
  for (const game of games) {
    const bucketKey = buildBucketKey(game);
    const bucket = grouped.get(bucketKey);
    if (bucket) {
      bucket.push(game);
    } else {
      grouped.set(bucketKey, [game]);
    }
  }
  return grouped;
}

function buildFixtureOptionLabel(eventName, kickoffDate, matchDay, roundLabel = "") {
  const weekday = WEEKDAYS_SHORT[kickoffDate.getUTCDay()];
  const month = MONTHS_SHORT[kickoffDate.getUTCMonth()];
  const day = kickoffDate.getUTCDate();
  const hh = String(kickoffDate.getUTCHours()).padStart(2, "0");
  const mm = String(kickoffDate.getUTCMinutes()).padStart(2, "0");
  const bucketLabel = matchDay ? `Matchday ${matchDay}` : roundLabel || "Upcoming round";
  return `${eventName} · ${weekday}, ${month} ${day} · ${hh}:${mm} UTC · ${bucketLabel}`;
}

function extractSportsDataGameId(row, fallbackValue) {
  const candidates = [
    row?.GameId,
    row?.gameId,
    row?.GameID,
    row?.gameID,
    row?.GlobalGameId,
    row?.globalGameId,
    row?.GlobalGameID,
    row?.globalGameID,
  ];

  for (const candidate of candidates) {
    const normalized = String(candidate ?? "").trim();
    if (normalized) {
      return normalized;
    }
  }

  return String(fallbackValue || "").trim();
}

function stripInternalFixtureFields(fixture) {
  const { kickoffMs, ...publicFixture } = fixture;
  return publicFixture;
}

function normalizeDate(value) {
  if (value instanceof Date && !Number.isNaN(value.getTime())) {
    return value;
  }
  const parsed = new Date(value);
  return Number.isNaN(parsed.getTime()) ? null : parsed;
}

function parseSportsDataMatchDay(row, roundLabel = "") {
  const direct = Number.parseInt(
    row?.Week ??
      row?.week ??
      row?.MatchDay ??
      row?.matchDay ??
      row?.RoundNumber ??
      row?.roundNumber ??
      "",
    10
  );
  if (Number.isInteger(direct) && direct > 0) {
    return direct;
  }

  const roundMatch = String(roundLabel || "").match(/(\d{1,3})/);
  if (roundMatch) {
    const parsed = Number.parseInt(roundMatch[1], 10);
    if (Number.isInteger(parsed) && parsed > 0) {
      return parsed;
    }
  }

  return null;
}

function buildBucketKey(fixture) {
  if (Number.isInteger(fixture?.matchDay) && fixture.matchDay > 0) {
    return `matchday:${fixture.matchDay}`;
  }
  const roundLabel = normalizeForSearch(fixture?.roundLabel);
  if (roundLabel) {
    return `round:${roundLabel}`;
  }
  return `date:${String(fixture?.fixtureDate || "")}`;
}

function buildBucketLabel(fixture) {
  if (Number.isInteger(fixture?.matchDay) && fixture.matchDay > 0) {
    return `Matchday ${fixture.matchDay}`;
  }
  return String(fixture?.roundLabel || fixture?.fixtureDate || "Upcoming fixtures");
}

function buildSelectionWindowLabel(entries) {
  const list = Array.isArray(entries) ? entries : [];
  if (list.length === 0) {
    return null;
  }
  if (list.length === 1) {
    return list[0]?.selectedLabel || null;
  }

  const weekNumbers = list
    .map((entry) => entry?.selectedWeek)
    .filter((value) => Number.isInteger(value));

  if (weekNumbers.length === list.length) {
    return `Matchdays ${weekNumbers[0]}-${weekNumbers[weekNumbers.length - 1]}`;
  }

  const labels = list
    .map((entry) => String(entry?.selectedLabel || "").trim())
    .filter(Boolean);

  if (labels.length > 0) {
    return labels.join(" + ");
  }

  return "Upcoming fixtures";
}

function isTerminalScheduleStatus(status, isClosed = false) {
  if (isClosed) {
    return true;
  }
  return TERMINAL_STATUSES.has(normalizeForSearch(status).replace(/\s+/g, ""));
}
