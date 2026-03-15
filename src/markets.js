import { DEFAULT_DRAW_THEME, DRAW_LOGO_URL, FIXTURE_LOGO_URL } from "./constants.js";
import { isValidUuid } from "./util.js";

export function buildParentMarketPayload(meta, typeReferenceId) {
  const { fixtureJson, league, homeTeam, awayTeam, fixtureDateIso, openIso, closeIso, payoutIso } = meta;
  const requiredIssues = collectRequiredMetaIssues(meta);
  if (requiredIssues.length) {
    throw new Error(`Cannot build parent market payload: ${requiredIssues.join(" ")}`);
  }

  const title = fixtureJson.name;
  const normalizedTypeReferenceId = normalizeTypeReferenceId(typeReferenceId);
  const leagueSlug = normalizeSegment(league.slug || "league");
  const homeCode = normalizeTeamCode(homeTeam.code, homeTeam.name);
  const awayCode = normalizeTeamCode(awayTeam.code, awayTeam.name);
  const homeCodeLower = homeCode.toLowerCase();
  const awayCodeLower = awayCode.toLowerCase();
  const fixtureDateCompact = String(fixtureDateIso || "").replace(/-/g, "");
  const fixtureDateForRules = formatFixtureDateForRules(fixtureDateIso);
  const parentMarketCode = `${homeCode}_${awayCode}_${fixtureDateCompact}`.toUpperCase();
  const parentCanonical = `${homeCodeLower}-${awayCodeLower}-${leagueSlug}-${fixtureDateIso}`;
  const openIsoFinal = normalizeIsoSecondPrecision(openIso);
  const closeIsoFinal = normalizeIsoSecondPrecision(closeIso);
  const payoutIsoFinal = normalizeIsoSecondPrecision(payoutIso);

  const parentMarket = {
    league_id: fixtureJson.league_id,
    type_reference_id: normalizedTypeReferenceId,
    title,
    description: `${title} (${fixtureDateIso}). Settles on full-time: ${homeTeam.name} / Draw / ${awayTeam.name}.`,
    market_code: parentMarketCode,
    parent_market_canonical_name: parentCanonical,
    rules: `This market resolves based on the official result of ${title} after 90 minutes of regular play plus stoppage time. Exactly one outcome resolves to "Long" ($1) and the others resolve to "Short" ($0). If the match is postponed, the market remains open until the match has been completed. If the match is canceled entirely with no make-up game, Draw resolves to "Long" ($1) and both teams resolve to "Short" ($0).`,
    markets_open_time: openIsoFinal,
    markets_close_time: closeIsoFinal,
    payout_time: payoutIsoFinal,
    status: "active",
    is_cross_matching_enabled: true,
    time_remaining: closeIsoFinal,
  };

  const buildTeamRules = (teamName) =>
    `In the upcoming game, scheduled for ${fixtureDateForRules}. If ${teamName} wins, this market will resolve to "Long" ($1 for ${teamName}). Otherwise, this market will resolve to "Short" ($0 for ${teamName}). If the game is postponed, this market will remain open until the game has been completed. If the game is canceled entirely, with no make-up game, this market will resolve to "Short" ($0 for ${teamName}).\n\nThis market refers only to the outcome within the first 90 minutes of regular play plus stoppage time.`;

  const drawRules =
    `In the upcoming game, scheduled for ${fixtureDateForRules}. If the game ends in a draw, this market will resolve to "Long" ($1 for Draw). Otherwise, this market will resolve to "Short" ($0 for Draw). If the game is postponed, this market will remain open until the game has been completed. If the game is canceled entirely, with no make-up game, this market will resolve to "Long" ($1 for Draw).\n\nThis market refers only to the outcome within the first 90 minutes of regular play plus stoppage time.`;

  const markets = [
    {
      name: homeTeam.name,
      tick_size: "0.01",
      alternate_name: homeTeam.alternateName || homeTeam.name,
      market_code: homeCode,
      market_canonical_name: `${homeCodeLower}-${awayCodeLower}-win-${leagueSlug}-${fixtureDateIso}`,
      rules: buildTeamRules(homeTeam.name),
      theme_color: homeTeam.themeColor,
      team_id: homeTeam.id,
      logo_url: homeTeam.logoUrl || FIXTURE_LOGO_URL,
      time_remaining: closeIsoFinal,
    },
    {
      name: "Draw",
      tick_size: "0.01",
      alternate_name: "Draw",
      market_code: "DRAW",
      market_canonical_name: `${homeCodeLower}-${awayCodeLower}-draw-${leagueSlug}-${fixtureDateIso}`,
      rules: drawRules,
      theme_color: DEFAULT_DRAW_THEME,
      team_id: null,
      logo_url: DRAW_LOGO_URL,
      time_remaining: closeIsoFinal,
    },
    {
      name: awayTeam.name,
      tick_size: "0.01",
      alternate_name: awayTeam.alternateName || awayTeam.name,
      market_code: awayCode,
      market_canonical_name: `${awayCodeLower}-${homeCodeLower}-win-${leagueSlug}-${fixtureDateIso}`,
      rules: buildTeamRules(awayTeam.name),
      theme_color: awayTeam.themeColor,
      team_id: awayTeam.id,
      logo_url: awayTeam.logoUrl || FIXTURE_LOGO_URL,
      time_remaining: closeIsoFinal,
    },
  ];

  return {
    parent_market: parentMarket,
    markets,
  };
}

function collectRequiredMetaIssues(meta) {
  const issues = [];
  if (!meta || typeof meta !== "object") {
    return ["missing fixture metadata."];
  }
  const fixtureDateIso = String(meta.fixtureDateIso || "").trim();
  const openIso = String(meta.openIso || "").trim();
  const closeIso = String(meta.closeIso || "").trim();
  const payoutIso = String(meta.payoutIso || "").trim();
  const fixtureName = String(meta?.fixtureJson?.name || "").trim();

  if (!fixtureName) issues.push("missing fixture title.");
  if (!fixtureDateIso) issues.push("missing fixture date (UTC).");
  if (!openIso) issues.push("missing markets_open_time.");
  if (!closeIso) issues.push("missing markets_close_time.");
  if (!payoutIso) issues.push("missing payout_time.");
  return issues;
}

function normalizeTypeReferenceId(value) {
  const text = String(value || "").trim();
  if (!text || !isValidUuid(text)) {
    return null;
  }
  return text;
}

function normalizeTeamCode(rawCode, teamName) {
  const text = String(rawCode || "").trim().toUpperCase();
  if (text) {
    return text;
  }
  return normalizeSegment(teamName).slice(0, 4).toUpperCase() || "TEAM";
}

function normalizeSegment(value) {
  return String(value || "")
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "") || "unknown";
}

function normalizeIsoSecondPrecision(value) {
  const parsed = new Date(String(value || "").trim());
  if (!Number.isFinite(parsed.getTime())) {
    throw new Error(`invalid ISO datetime: "${String(value || "")}".`);
  }
  return parsed.toISOString().replace(".000Z", "Z");
}

function formatFixtureDateForRules(fixtureDateIso) {
  const dateText = String(fixtureDateIso || "").trim();
  const parsed = new Date(`${dateText}T00:00:00Z`);
  if (!Number.isFinite(parsed.getTime())) {
    return dateText || "the scheduled date";
  }
  return new Intl.DateTimeFormat("en-US", {
    month: "long",
    day: "numeric",
    year: "numeric",
    timeZone: "UTC",
  }).format(parsed);
}
