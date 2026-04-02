import { resolveLeagueScheduleCode } from "./leagueRegistry.js";
import { normalizeForSearch } from "./util.js";

export function resolveCatalogLeagueScheduleCode(league, { readyLeagueCodes = [] } = {}) {
  const directMatch = resolveDirectScheduleLeagueCode(league);
  if (directMatch) {
    return directMatch;
  }

  if (!isGenericFifaLeague(league)) {
    return "";
  }

  const readyFifaCodes = Array.from(
    new Set(
      (Array.isArray(readyLeagueCodes) ? readyLeagueCodes : [])
        .map((code) => String(code || "").trim().toLowerCase())
        .filter((code) => code.startsWith("fifa-"))
    )
  );

  return readyFifaCodes.length === 1 ? readyFifaCodes[0] : "";
}

function resolveDirectScheduleLeagueCode(league) {
  for (const candidate of getLeagueCandidates(league)) {
    const leagueCode = resolveLeagueScheduleCode(candidate);
    if (leagueCode) {
      return leagueCode;
    }
  }

  return "";
}

function getLeagueCandidates(league) {
  const candidates = [
    league?.key,
    league?.slug,
    league?.name,
    league?.alternateName,
    ...(Array.isArray(league?.aliases) ? league.aliases : []),
  ];

  return Array.from(
    new Set(
      candidates
        .map((candidate) => String(candidate || "").trim())
        .filter(Boolean)
    )
  );
}

function isGenericFifaLeague(league) {
  const normalizedCandidates = getLeagueCandidates(league)
    .map((candidate) => normalizeForSearch(candidate))
    .filter(Boolean);

  return normalizedCandidates.includes("fifa") ||
    normalizedCandidates.includes("international federation of association football");
}
