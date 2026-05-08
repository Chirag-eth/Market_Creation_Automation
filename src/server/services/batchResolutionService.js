import {
  resolveLeagueScheduleCode,
  getLeagueScheduleDefinition,
} from "../../shared/leagueRegistry.js";
import { normalizeForSearch } from "../../shared/util.js";

export function resolveBatchLeague(normalizedLeagues, leagueCode) {
  if (!leagueCode) return null;
  const normalizedScheduleCode =
    resolveLeagueScheduleCode(leagueCode) ||
    String(leagueCode || "")
      .trim()
      .toLowerCase();
  const leagueDef = getLeagueScheduleDefinition(normalizedScheduleCode);
  const needles = new Set([
    normalizeForSearch(leagueCode),
    normalizeForSearch(normalizedScheduleCode),
    normalizeForSearch(leagueDef?.label),
    ...(Array.isArray(leagueDef?.aliases) ? leagueDef.aliases : []).map((alias) =>
      normalizeForSearch(alias)
    ),
  ]);
  return (
    normalizedLeagues.find((league) => {
      const haystack = new Set([
        normalizeForSearch(league.key),
        normalizeForSearch(league.name),
        normalizeForSearch(league.slug),
        normalizeForSearch(league.alternateName),
        ...(Array.isArray(league.aliases) ? league.aliases : []).map((alias) =>
          normalizeForSearch(alias)
        ),
      ]);
      for (const needle of needles) {
        if (needle && haystack.has(needle)) {
          return true;
        }
      }
      return false;
    }) || null
  );
}

export function resolveBatchTeam(teamAliasIdx, teamName, leagueId) {
  if (!teamName) return null;
  const needle = normalizeForSearch(teamName);
  // Prefer exact alias match within the same league
  const candidates = teamAliasIdx.filter((entry) => entry.alias === needle);
  if (candidates.length === 1) return candidates[0].team;
  const sameLeague = candidates.find((entry) => entry.team.leagueId === leagueId);
  if (sameLeague) return sameLeague.team;
  if (candidates.length > 0) return candidates[0].team;
  // Fallback: substring match.
  // Exclude aliases <= 4 chars (team-code fragments like "hei", "hof") — they only
  // participate in exact matching above, never in substring matching.
  // Sort by alias length descending so the most specific match wins.
  const partials = teamAliasIdx
    .filter(
      (entry) =>
        entry.alias.length > 4 && (entry.alias.includes(needle) || needle.includes(entry.alias))
    )
    .sort((a, b) => b.alias.length - a.alias.length);
  if (partials.length === 1) return partials[0].team;
  const sameLeaguePartial = partials.find((entry) => entry.team.leagueId === leagueId);
  return sameLeaguePartial?.team || partials[0]?.team || null;
}
