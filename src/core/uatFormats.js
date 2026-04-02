import { DEFAULT_FIXTURE_THEME, FIXTURE_LOGO_URL } from "../shared/constants.js";
import { normalizeForSearch } from "../shared/util.js";

const OUTPUT_PROFILE_UAT = "uat";
const UAT_TOTAL_LINES = Object.freeze([
  { key: "over_1_5", line: "1.5", threshold: 2 },
  { key: "over_2_5", line: "2.5", threshold: 3 },
  { key: "over_3_5", line: "3.5", threshold: 4 },
  { key: "over_4_5", line: "4.5", threshold: 5 },
]);
export const UAT_MARKET_LINE_OPTIONS = Object.freeze(
  UAT_TOTAL_LINES.map((entry) => Object.freeze({ key: entry.line, label: entry.line }))
);
export const UAT_SPREAD_MARKET_LINE_OPTIONS = Object.freeze(UAT_MARKET_LINE_OPTIONS.slice(0, 2));
export const DEFAULT_UAT_MARKET_LINE = UAT_MARKET_LINE_OPTIONS[0]?.key || "1.5";

export function buildUatTypeReferencePayloads({ fixtureName = "", fixtureDateIso = "", typeReferenceId = "", outputProfile = "" } = {}) {
  if (String(outputProfile || "").trim().toLowerCase() !== OUTPUT_PROFILE_UAT) {
    return null;
  }

  if (!String(typeReferenceId || "").trim()) {
    return null;
  }

  const fixtureCanonicalName = buildUatCanonicalFixtureName(fixtureName, fixtureDateIso);
  const genericCanonicalName = buildUatGenericCanonicalName(fixtureName, fixtureDateIso);
  if (!fixtureCanonicalName || !genericCanonicalName) {
    return null;
  }

  return {
    fixture: {
      type_value: "fixture",
      type_value_id: String(typeReferenceId || "").trim(),
      canonical_name: fixtureCanonicalName,
    },
    generic: {
      type_value: "generic",
      type_value_id: String(typeReferenceId || "").trim(),
      canonical_name: genericCanonicalName,
    },
  };
}

export function buildUatParentPayloads({
  fixtureJson,
  league,
  homeTeam,
  awayTeam,
  fixtureDateIso = "",
  kickoffTimeUtc = "",
  openIso = "",
  createdAtIso = "",
  typeReferenceId = "",
  outputProfile = "",
  marketLine = "",
  spreadTeamSide = "",
} = {}) {
  if (String(outputProfile || "").trim().toLowerCase() !== OUTPUT_PROFILE_UAT) {
    return null;
  }

  const fixtureTitle = formatUatFixtureTitle(String(fixtureJson?.name || ""));
  const fixtureName = formatUatFixtureName(String(fixtureJson?.name || ""));
  const marketsOpenTime = normalizeIsoSecondPrecision(openIso) || normalizeKickoffIso(fixtureDateIso, kickoffTimeUtc);
  const selectedTotalsLine = getUatLineDefinition(marketLine);
  const selectedSpreadLine = getUatSpreadLineDefinition(marketLine);
  if (!fixtureTitle || !fixtureName || !league?.id || !fixtureDateIso || !marketsOpenTime) {
    return null;
  }

  const creationDate = formatUatUtcMomentFromIso(createdAtIso || marketsOpenTime);
  const homeCode = normalizeTeamCode(homeTeam);
  const awayCode = normalizeTeamCode(awayTeam);
  const spreadTeam = String(spreadTeamSide || "").trim().toLowerCase() === "away" ? awayTeam : homeTeam;
  const nonSpreadTeam = String(spreadTeamSide || "").trim().toLowerCase() === "away" ? homeTeam : awayTeam;
  const ruleLeagueLabel = getUatRuleLeagueLabel(league);
  const resolutionSourceDomain = getUatResolutionSourceDomain(league);
  const fixtureScheduleEt = formatUatFixtureKickoffForEtRules(fixtureDateIso, kickoffTimeUtc);

  return {
    moneyline: {
      parent_market: {
        league_id: league.id,
        type_reference_id: String(typeReferenceId || "").trim() || null,
        title: fixtureTitle,
        parent_market_family: "moneyline",
        market_line: "0",
        rules: buildUatParentRules({
          familyLabel: "Moneyline",
          marketLine: "0",
          fixtureName,
          fixtureDateIso,
          kickoffTimeUtc,
          creationDate,
        }),
        is_cross_matching_enabled: true,
        markets_open_time: marketsOpenTime,
      },
      markets: [
        {
          name: homeTeam.name,
          tick_size: "0.01",
          market_code: homeCode,
          rules: buildUatMoneylineTeamRule({
            fixtureName,
            fixtureTitle,
            fixtureDateIso,
            teamName: homeTeam.name,
            creationDate,
          }),
          team_id: homeTeam.id,
        },
        {
          name: awayTeam.name,
          tick_size: "0.01",
          market_code: awayCode,
          rules: buildUatMoneylineTeamRule({
            fixtureName,
            fixtureTitle,
            fixtureDateIso,
            teamName: awayTeam.name,
            creationDate,
          }),
          team_id: awayTeam.id,
        },
        {
          name: "Draw",
          tick_size: "0.01",
          market_code: "DRAW",
          rules: buildUatMoneylineDrawRule({
            fixtureTitle,
            fixtureName,
            fixtureDateIso,
            creationDate,
          }),
        },
      ],
    },
    spreads: {
      parent_market: {
        league_id: league.id,
        type_reference_id: String(typeReferenceId || "").trim() || null,
        title: `${spreadTeam.name} Over ${selectedSpreadLine.line} Goals`,
        parent_market_family: "spreads",
        market_line: `-${selectedSpreadLine.line}`,
        rules: buildUatLegacyParentRules({ fixtureName, fixtureDateIso, kickoffTimeUtc, creationDate }),
        markets_open_time: marketsOpenTime,
      },
      markets: [
        {
          name: `${spreadTeam.name} Over ${selectedSpreadLine.line} Goals`,
          tick_size: "0.01",
          market_code: `Over ${selectedSpreadLine.line}`,
          rules: buildUatSpreadsMarketRule({
            leagueLabel: ruleLeagueLabel,
            fixtureScheduleEt,
            selectedTeamName: spreadTeam.name,
            otherTeamName: nonSpreadTeam?.name || "",
            threshold: selectedSpreadLine.threshold,
            sourceDomain: resolutionSourceDomain,
            creationDate,
          }),
          team_id: spreadTeam.id,
        },
      ],
    },
    totals: buildUatTotalsPayload({
      leagueId: league.id,
      typeReferenceId,
      leagueLabel: ruleLeagueLabel,
      sourceDomain: resolutionSourceDomain,
      homeTeamName: homeTeam.name,
      awayTeamName: awayTeam.name,
      fixtureDateIso,
      kickoffTimeUtc,
      marketsOpenTime,
      creationDate,
      line: selectedTotalsLine,
    }),
    btts: {
      parent_market: {
        league_id: league.id,
        type_reference_id: String(typeReferenceId || "").trim() || null,
        title: "Both Teams To Score",
        parent_market_family: "btts",
        market_line: "0",
        rules: buildUatParentRules({
          familyLabel: "BTTS",
          marketLine: "0",
          fixtureName,
          fixtureDateIso,
          kickoffTimeUtc,
          creationDate,
        }),
        markets_open_time: marketsOpenTime,
      },
      markets: [
        {
          name: "Both Teams To Score",
          tick_size: "0.01",
          market_code: "Both Teams To Score",
          rules: buildUatBttsMarketRule({
            leagueLabel: ruleLeagueLabel,
            fixtureScheduleEt,
            homeTeamName: homeTeam.name,
            awayTeamName: awayTeam.name,
            sourceDomain: resolutionSourceDomain,
            creationDate,
          }),
        },
      ],
    },
  };
}

export function buildUatCanonicalFixtureName(fixtureName, fixtureDateIso) {
  const normalizedFixture = normalizeFixtureNameToSlug(fixtureName);
  const normalizedDate = String(fixtureDateIso || "").trim();
  if (!normalizedFixture || !normalizedDate) {
    return "";
  }
  return `${normalizedFixture}-${normalizedDate}`;
}

export function formatUatFixtureTitle(value) {
  return String(value || "").trim().replace(/\s+vs\s+/gi, " vs ");
}

export function formatUatFixtureName(value) {
  return String(value || "").trim().replace(/\s+vs\s+/gi, " vs ");
}

export function buildUatFixtureAlternateName(homeTeam, awayTeam) {
  const homeCode = clampThreeLetterCode(normalizeTeamCode(homeTeam));
  const awayCode = clampThreeLetterCode(normalizeTeamCode(awayTeam));
  if (!homeCode || !awayCode) {
    return "";
  }
  return `${homeCode} vs ${awayCode}`;
}

function buildUatGenericCanonicalName(fixtureName, fixtureDateIso) {
  const normalizedFixture = normalizeFixtureNameToSlug(fixtureName);
  const year = String(fixtureDateIso || "").trim().slice(0, 4);
  if (!normalizedFixture || !year) {
    return "";
  }
  return `${normalizedFixture}-${year}`;
}

function normalizeFixtureNameToSlug(value) {
  return String(value || "")
    .trim()
    .toLowerCase()
    .replace(/\s+vs\s+/gi, "-vs-")
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
}

function normalizeKickoffIso(fixtureDateIso, kickoffTimeUtc) {
  const date = String(fixtureDateIso || "").trim();
  const time = String(kickoffTimeUtc || "").trim();
  if (!date || !time) {
    return "";
  }
  const parsed = new Date(`${date}T${time}:00Z`);
  return Number.isFinite(parsed.getTime()) ? parsed.toISOString().replace(".000Z", "Z") : "";
}

function normalizeIsoSecondPrecision(value) {
  const parsed = new Date(String(value || "").trim());
  return Number.isFinite(parsed.getTime()) ? parsed.toISOString().replace(".000Z", "Z") : "";
}

function buildUatParentRules({ familyLabel, marketLine, fixtureName, fixtureDateIso, kickoffTimeUtc, creationDate }) {
  const fixtureMoment = formatUatFixtureKickoffForRules(fixtureDateIso, kickoffTimeUtc);
  const normalizedLine = String(marketLine ?? "").trim();
  const familySegment =
    String(familyLabel || "").trim().toLowerCase() === "moneyline" && normalizedLine === "0"
      ? `${familyLabel}`
      : normalizedLine
        ? `${familyLabel} (${normalizedLine})`
        : `${familyLabel}`;
  return `This ${familySegment} market resolves based on the official result of ${fixtureName} scheduled on ${fixtureMoment} after 90 minutes of regular play plus stoppage time. It either resolves to "Long" ($1) or "Short" ($0). If the match is postponed, the market remains open until the match has been completed. If the match is canceled entirely with no make-up game, Draw in moneyline resolves to "Long" ($1) and all the other markets resolve to "Short" ($0). ${buildCreationSentence(creationDate)}`;
}

function buildUatLegacyParentRules({ fixtureName, fixtureDateIso, kickoffTimeUtc, creationDate }) {
  const fixtureMoment = formatUatFixtureKickoffForRules(fixtureDateIso, kickoffTimeUtc);
  return `This market resolves based on the official result of ${fixtureName} scheduled on ${fixtureMoment} after 90 minutes of regular play plus stoppage time. It either resolves to "Long" ($1) or "Short" ($0). If the match is postponed, the market remains open until the match has been completed. If the match is canceled entirely with no make-up game, Draw resolves to "Long" ($1) and both teams resolve to "Short" ($0). Whichever market wins takes it all. ${buildCreationSentence(creationDate)}`;
}

function buildUatTotalsPayload({
  leagueId = "",
  typeReferenceId = "",
  leagueLabel = "",
  sourceDomain = "",
  homeTeamName = "",
  awayTeamName = "",
  fixtureDateIso = "",
  kickoffTimeUtc = "",
  marketsOpenTime = "",
  creationDate = "",
  line = null,
} = {}) {
  const normalizedTypeReferenceId = String(typeReferenceId || "").trim() || null;
  const fixtureName = formatUatFixtureName(`${homeTeamName} vs ${awayTeamName}`);
  const parentRules = buildUatParentRules({
    familyLabel: "Totals",
    marketLine: getUatLineDefinition(line?.line || line).line,
    fixtureName,
    fixtureDateIso,
    kickoffTimeUtc,
    creationDate,
  });
  const selectedLine = getUatLineDefinition(line?.line || line);

  return {
    parent_market: {
      league_id: leagueId,
      type_reference_id: normalizedTypeReferenceId,
      title: `Total Over ${selectedLine.line} Goals`,
      parent_market_family: "totals",
      market_line: selectedLine.line,
      rules: parentRules,
      markets_open_time: marketsOpenTime,
    },
    markets: [
        {
          name: `Over ${selectedLine.line} Goals`,
          tick_size: "0.01",
          market_code: `Over ${selectedLine.line}`,
          rules: buildUatTotalsMarketRule({
            leagueLabel,
            fixtureScheduleEt: formatUatFixtureKickoffForEtRules(fixtureDateIso, kickoffTimeUtc),
            homeTeamName,
            awayTeamName,
            threshold: selectedLine.threshold,
            sourceDomain,
            creationDate,
          }),
        },
      ],
    };
}

function getUatLineDefinition(value) {
  const normalized = String(value || "").trim();
  return UAT_TOTAL_LINES.find((entry) => entry.line === normalized) || UAT_TOTAL_LINES[0];
}

function getUatSpreadLineDefinition(value) {
  const normalized = String(value || "").trim();
  return UAT_TOTAL_LINES.slice(0, 2).find((entry) => entry.line === normalized) || UAT_TOTAL_LINES[0];
}

function buildUatMoneylineTeamRule({ fixtureName, fixtureTitle, fixtureDateIso, teamName, creationDate }) {
  const formattedDate = formatUatLongDate(fixtureDateIso);
  const name = String(teamName || "").trim();
  return `In the ${fixtureName} game scheduled for ${formattedDate}, if ${name} wins, this market will resolve to "Long" ($1 for ${name}). Otherwise, this market will resolve to "Short" ($0 for ${name}). If the game is postponed, this market will remain open until the game has been completed. If the game is canceled entirely, with no make-up game, this market will resolve to "Short" ($0 for ${name}). This market refers only to the outcome within the first 90 minutes of regular play plus stoppage time. ${buildCreationSentence(creationDate)}`;
}

function buildUatMoneylineDrawRule({ fixtureTitle, fixtureName, fixtureDateIso, creationDate }) {
  const formattedDate = formatUatLongDate(fixtureDateIso);
  return `In the ${fixtureName} game scheduled for ${formattedDate}, if the game ends in a draw, this market will resolve to "Long" ($1 for Draw). Otherwise, this market will resolve to "Short" ($0 for Draw). If the game is postponed, this market will remain open until the game has been completed. If the game is canceled entirely, with no make-up game, this market will resolve to "Long" ($1 for Draw). This market refers only to the outcome within the first 90 minutes of regular play plus stoppage time. ${buildCreationSentence(creationDate)}`;
}

function buildUatSpreadsMarketRule({
  leagueLabel = "",
  fixtureScheduleEt = "",
  selectedTeamName = "",
  otherTeamName = "",
  threshold = 2,
  sourceDomain = "",
  creationDate = "",
}) {
  return `In the upcoming ${leagueLabel} game, scheduled for ${fixtureScheduleEt}: This market will resolve to "${selectedTeamName}" if ${selectedTeamName} win the game by ${threshold} or more goals. Otherwise, this market will resolve to "${otherTeamName}". If the game is postponed, this market will remain open until the game has been completed. If the game is canceled entirely, with no make-up game, this market will resolve 50-50. This market will resolve according to the official final score published on ${sourceDomain}. This market refers only to the outcome within the first 90 minutes of regular play plus stoppage time. The primary resolution source for this market is the official statistics of the event as recognized by the governing body or event organizers. ${buildCreationSentence(creationDate)}`;
}

function buildUatTotalsMarketRule({
  leagueLabel = "",
  fixtureScheduleEt = "",
  homeTeamName = "",
  awayTeamName = "",
  threshold = 2,
  sourceDomain = "",
  creationDate = "",
}) {
  return `In the upcoming ${leagueLabel} game between ${homeTeamName} and ${awayTeamName}, scheduled for ${fixtureScheduleEt}: This market will resolve to "Over" if ${homeTeamName} and ${awayTeamName} combine to score ${threshold} or more goals in this game. If the combined total is less than ${threshold}, this market will resolve to "Under". If the game is postponed, this market will remain open until the game has been completed. If the game is canceled entirely, with no make-up game, this market will resolve 50-50. If the game is started but not completed, this market will resolve according to the official final score published on ${sourceDomain}. This market refers only to the outcome within the first 90 minutes of regular play plus stoppage time. The primary resolution source for this market is the official statistics of the event as recognized by the governing body or event organizers. ${buildCreationSentence(creationDate)}`;
}

function buildUatBttsMarketRule({
  leagueLabel = "",
  fixtureScheduleEt = "",
  homeTeamName = "",
  awayTeamName = "",
  sourceDomain = "",
  creationDate = "",
}) {
  return `In the upcoming ${leagueLabel} game between ${homeTeamName} and ${awayTeamName}, scheduled for ${fixtureScheduleEt}: This market will resolve to "Yes" if both ${homeTeamName} and ${awayTeamName} each score at least one goal during the game. This market will resolve to "No" if either team fails to score (i.e., if one or both teams finish with zero goals). If the game is postponed, this market will remain open until the game has been completed. If the game is canceled entirely, with no make-up game, this market will resolve 50-50. If the game is started but not completed, this market will resolve according to the official final score published on ${sourceDomain}. This market refers only to the outcome within the first 90 minutes of regular play plus stoppage time. The primary resolution source for this market is the official statistics of the event as recognized by the governing body or event organizers. ${buildCreationSentence(creationDate)}`;
}

function buildCreationSentence(creationDate) {
  return `This market was created on ${creationDate}.`;
}

function getUatRuleLeagueLabel(league) {
  const key = String(league?.key || "").trim().toLowerCase();
  switch (key) {
    case "epl":
      return "Premier League";
    case "laliga":
      return "La Liga";
    case "ucl":
      return "UEFA Champions League";
    case "fifa-friendlies":
      return "FIFA Friendlies";
    case "fifa-worldcup":
      return "FIFA World Cup";
    default:
      return String(league?.alternateName || league?.name || "soccer").trim();
  }
}

function getUatResolutionSourceDomain(league) {
  const key = String(league?.key || "").trim().toLowerCase();
  switch (key) {
    case "epl":
      return "premierleague.com";
    case "laliga":
      return "laliga.com";
    case "ucl":
      return "uefa.com";
    case "fifa-friendlies":
    case "fifa-worldcup":
      return "fifa.com";
    default:
      return "official league site";
  }
}

function formatUatFixtureKickoffForEtRules(fixtureDateIso, kickoffTimeUtc) {
  const iso = normalizeKickoffIso(fixtureDateIso, kickoffTimeUtc);
  const parsed = iso ? new Date(iso) : null;
  if (!parsed || !Number.isFinite(parsed.getTime())) {
    return `${formatUatLongDate(fixtureDateIso)} at ${String(kickoffTimeUtc || "").trim()} ET`.trim();
  }

  const dateText = new Intl.DateTimeFormat("en-US", {
    month: "long",
    day: "numeric",
    timeZone: "America/New_York",
  }).format(parsed);
  const timeText = new Intl.DateTimeFormat("en-US", {
    hour: "numeric",
    minute: "2-digit",
    hour12: true,
    timeZone: "America/New_York",
  }).format(parsed);
  return `${dateText} at ${timeText} ET`;
}

function formatUatFixtureKickoffForRules(fixtureDateIso, kickoffTimeUtc) {
  const iso = normalizeKickoffIso(fixtureDateIso, kickoffTimeUtc);
  const parsed = iso ? new Date(iso) : null;
  if (!parsed || !Number.isFinite(parsed.getTime())) {
    return `${fixtureDateIso} ${kickoffTimeUtc} UTC`.trim();
  }
  const dateText = new Intl.DateTimeFormat("en-US", {
    month: "long",
    day: "numeric",
    year: "numeric",
    timeZone: "UTC",
  }).format(parsed);
  const timeText = new Intl.DateTimeFormat("en-US", {
    hour: "numeric",
    minute: parsed.getUTCMinutes() === 0 ? undefined : "2-digit",
    hour12: true,
    timeZone: "UTC",
  }).format(parsed);
  return `${dateText} at ${timeText} UTC`;
}

function formatUatShortDate(fixtureDateIso) {
  const parsed = new Date(`${String(fixtureDateIso || "").trim()}T00:00:00Z`);
  if (!Number.isFinite(parsed.getTime())) {
    return String(fixtureDateIso || "").trim();
  }
  return new Intl.DateTimeFormat("en-US", {
    month: "short",
    day: "numeric",
    year: "numeric",
    timeZone: "UTC",
  }).format(parsed);
}

function formatUatLongDate(fixtureDateIso) {
  const parsed = new Date(`${String(fixtureDateIso || "").trim()}T00:00:00Z`);
  if (!Number.isFinite(parsed.getTime())) {
    return String(fixtureDateIso || "").trim();
  }
  return new Intl.DateTimeFormat("en-US", {
    month: "long",
    day: "numeric",
    year: "numeric",
    timeZone: "UTC",
  }).format(parsed);
}

function formatUatUtcMomentFromIso(value) {
  const parsed = new Date(String(value || "").trim());
  if (!Number.isFinite(parsed.getTime())) {
    return String(value || "").trim();
  }
  const dateText = new Intl.DateTimeFormat("en-US", {
    month: "long",
    day: "numeric",
    year: "numeric",
    timeZone: "UTC",
  }).format(parsed);
  const timeText = new Intl.DateTimeFormat("en-US", {
    hour: "numeric",
    minute: parsed.getUTCMinutes() === 0 ? undefined : "2-digit",
    hour12: true,
    timeZone: "UTC",
  }).format(parsed);
  return `${dateText} at ${timeText} UTC`;
}

function normalizeTeamCode(team) {
  const explicitCode = String(team?.code || "").trim().toUpperCase().replace(/[^A-Z0-9]/g, "");
  if (explicitCode.length === 3) {
    return explicitCode;
  }

  for (const candidate of [team?.name, team?.alternateName]) {
    const derived = deriveThreeLetterTeamCode(candidate);
    if (derived) {
      return derived;
    }
  }

  if (explicitCode) {
    return explicitCode.slice(0, 3).padEnd(3, "X");
  }
  return "TBD";
}

function clampThreeLetterCode(value) {
  const normalized = String(value || "")
    .trim()
    .toUpperCase()
    .replace(/[^A-Z0-9]/g, "");
  if (!normalized) {
    return "TBD";
  }
  return normalized.slice(0, 3).padEnd(3, "X");
}

function deriveThreeLetterTeamCode(rawName) {
  const normalized = normalizeForSearch(rawName)
    .replace(/\b(fc|cf|afc|sc|sk|sl|rc|rcd|ca|cd|sd|ud|fk|kv|club|deportivo)\b/g, " ")
    .replace(/\b(and|the|de|of)\b/g, " ")
    .trim()
    .replace(/\s+/g, " ");
  if (!normalized) {
    return "";
  }

  const parts = normalized.split(" ").filter(Boolean);
  if (parts.length >= 2) {
    const first = parts[0].charAt(0);
    const last = parts[parts.length - 1].slice(0, 2);
    const combined = `${first}${last}`.replace(/[^a-z0-9]/g, "").toUpperCase();
    if (combined.length === 3) {
      return combined;
    }
  }

  const compact = normalized.replace(/[^a-z0-9]/g, "").toUpperCase();
  return compact.slice(0, 3).padEnd(3, "X");
}
