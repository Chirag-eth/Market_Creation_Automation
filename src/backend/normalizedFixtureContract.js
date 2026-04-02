export const NORMALIZED_FIXTURE_CONTRACT_VERSION = 1;
export const NORMALIZED_FIXTURE_WINDOW_CONTRACT_VERSION = 1;

export function createNormalizedFixtureRecord(input = {}) {
  const kickoffIso = normalizeIsoTimestamp(input.kickoffIso);
  const kickoffDate = kickoffIso ? new Date(kickoffIso) : null;
  const kickoffMs =
    Number.isFinite(input.kickoffMs) && input.kickoffMs > 0
      ? Number(input.kickoffMs)
      : kickoffDate?.getTime() ?? null;
  const eventName = String(input.eventName || "").trim();
  const homeTeamName = String(input.homeTeamName || "").trim();
  const awayTeamName = String(input.awayTeamName || "").trim();
  const gameId = String(
    input.gameId ||
    input.game_id ||
    input.providerFixtureId ||
    ""
  ).trim();

  return {
    contract_version: NORMALIZED_FIXTURE_CONTRACT_VERSION,
    provider: String(input.provider || "").trim().toLowerCase() || null,
    providerFixtureId: String(input.providerFixtureId || gameId || "").trim() || null,
    gameId,
    game_id: gameId,
    roundId: input.roundId ?? null,
    matchDay: normalizePositiveInteger(input.matchDay),
    matchWeek: normalizePositiveInteger(input.matchWeek),
    roundLabel: String(input.roundLabel || "").trim() || null,
    eventName,
    homeTeamName,
    awayTeamName,
    fixtureDate: String(input.fixtureDate || "").trim() || kickoffIso?.slice(0, 10) || "",
    kickoffTimeUtc: String(input.kickoffTimeUtc || "").trim() || kickoffIso?.slice(11, 16) || "",
    kickoffIso: kickoffIso || "",
    kickoffMs,
    status: String(input.status || "").trim() || "Scheduled",
    isClosed: Boolean(input.isClosed),
    optionLabel: String(input.optionLabel || "").trim() || eventName,
    sourceMeta: input.sourceMeta && typeof input.sourceMeta === "object"
      ? input.sourceMeta
      : null,
  };
}

export function toPublicNormalizedFixtureRecord(fixture) {
  const { kickoffMs, ...publicFixture } = fixture || {};
  return publicFixture;
}

export function createNormalizedFixtureWindowPayload({
  league = "",
  source = "",
  fetchedAt = new Date().toISOString(),
  referenceNow = new Date().toISOString(),
  selectedWeek = null,
  selectedWeeks = [],
  selectedLabel = null,
  selectionMode = "none",
  fixtures = [],
} = {}) {
  const normalizedFixtures = (Array.isArray(fixtures) ? fixtures : [])
    .map((fixture) => createNormalizedFixtureRecord(fixture))
    .map((fixture) => toPublicNormalizedFixtureRecord(fixture));

  return {
    contract_version: NORMALIZED_FIXTURE_WINDOW_CONTRACT_VERSION,
    fixture_contract_version: NORMALIZED_FIXTURE_CONTRACT_VERSION,
    league: String(league || "").trim().toLowerCase(),
    source: String(source || "").trim().toLowerCase(),
    fetched_at: normalizeIsoTimestamp(fetchedAt),
    reference_now: normalizeIsoTimestamp(referenceNow),
    selected_week: normalizePositiveInteger(selectedWeek),
    selected_weeks: (Array.isArray(selectedWeeks) ? selectedWeeks : [])
      .map((value) => normalizePositiveInteger(value))
      .filter((value) => Number.isInteger(value)),
    selected_label: String(selectedLabel || "").trim() || null,
    selection_mode: String(selectionMode || "").trim() || "none",
    fixtures: normalizedFixtures,
  };
}

function normalizeIsoTimestamp(value) {
  const parsed = new Date(value);
  if (Number.isNaN(parsed.getTime())) {
    return "";
  }
  return parsed.toISOString();
}

function normalizePositiveInteger(value) {
  const parsed = Number.parseInt(String(value ?? "").trim(), 10);
  return Number.isInteger(parsed) && parsed > 0 ? parsed : null;
}
