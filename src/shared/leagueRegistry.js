import { normalizeForSearch } from "./util.js";

const LEAGUE_SCHEDULE_REGISTRY = Object.freeze([
  {
    code: "epl",
    label: "EPL",
    icon: "⚽",
    activeIconUrl: "https://public-assets.pred.app/market-assets/League_Logos/League_Logos_3X/EPL_Active_48x48.png",
    inactiveIconUrl: "https://public-assets.pred.app/market-assets/League_Logos/League_Logos_3X/EPL_Inactive_48x48.png",
    aliases: [
      "epl",
      "english premier league",
      "premier league",
      "english-premier-league",
    ],
    defaultCompetitionId: 1,
    competitionIdEnvName: "SPORTSDATA_EPL_COMPETITION_ID",
    fixturePathEnvName: "SPORTSDATA_EPL_SCHEDULE_FIXTURE_PATH",
    polymarketLeagueSlugEnvName: "POLYMARKET_EPL_LEAGUE_SLUG",
    gammaTagSlugs: ["EPL", "premier-league"],
  },
  {
    code: "ucl",
    label: "UCL",
    icon: "✦",
    activeIconUrl: "https://public-assets.pred.app/market-assets/League_Logos/League_Logos_3X/UCL_Active_128x128.png",
    inactiveIconUrl: "https://public-assets.pred.app/market-assets/League_Logos/League_Logos_3X/UCL_Inactive_128x128.png",
    aliases: [
      "ucl",
      "uefa champions league",
      "champions league",
      "uefa-champions-league",
    ],
    defaultCompetitionId: 3,
    competitionIdEnvName: "SPORTSDATA_UCL_COMPETITION_ID",
    fixturePathEnvName: "SPORTSDATA_UCL_SCHEDULE_FIXTURE_PATH",
    polymarketLeagueSlugEnvName: "POLYMARKET_UCL_LEAGUE_SLUG",
    gammaTagSlugs: ["ucl", "champions-league", "uefa-champions-league"],
  },
  {
    code: "laliga",
    label: "La Liga",
    icon: "◢",
    activeIconUrl: "https://public-assets.pred.app/market-assets/League_Logos/League_Logos_3X/LaLiga_Active_128x128.png",
    inactiveIconUrl: "https://public-assets.pred.app/market-assets/League_Logos/League_Logos_3X/LaLiga_Inactive_128x128.png",
    aliases: [
      "laliga",
      "la liga",
      "la-liga",
      "spanish la liga",
      "spanish league",
    ],
    defaultCompetitionId: 4,
    competitionIdEnvName: "SPORTSDATA_LALIGA_COMPETITION_ID",
    fixturePathEnvName: "SPORTSDATA_LALIGA_SCHEDULE_FIXTURE_PATH",
    polymarketLeagueSlugEnvName: "POLYMARKET_LALIGA_LEAGUE_SLUG",
    lsportsLeagueNameLike: "%LaLiga%",
    gammaTagSlugs: ["la-liga"],
  },
  {
    code: "seriea",
    label: "Serie A",
    icon: "◣",
    aliases: [
      "serie a",
      "seriea",
      "italian serie a",
      "italy serie a",
      "lega serie a",
    ],
    defaultCompetitionId: null,
    competitionIdEnvName: "SPORTSDATA_SERIEA_COMPETITION_ID",
    fixturePathEnvName: "SPORTSDATA_SERIEA_SCHEDULE_FIXTURE_PATH",
    polymarketLeagueSlugEnvName: "POLYMARKET_SERIEA_LEAGUE_SLUG",
    lsportsLeagueNameLike: "%Serie A%",
    gammaTagSlugs: ["serie-a"],
  },
  {
    code: "bundesliga",
    label: "Bundesliga",
    icon: "◇",
    aliases: [
      "bundesliga",
      "german bundesliga",
      "bundes liga",
      "1. bundesliga",
      "germany bundesliga",
    ],
    defaultCompetitionId: null,
    competitionIdEnvName: "SPORTSDATA_BUNDESLIGA_COMPETITION_ID",
    fixturePathEnvName: "SPORTSDATA_BUNDESLIGA_SCHEDULE_FIXTURE_PATH",
    polymarketLeagueSlugEnvName: "POLYMARKET_BUNDESLIGA_LEAGUE_SLUG",
    lsportsLeagueNameLike: "%Bundesliga%",
    gammaTagSlugs: ["bundesliga"],
  },
  {
    code: "ligue1",
    label: "Ligue 1",
    icon: "△",
    aliases: [
      "ligue 1",
      "ligue1",
      "french ligue 1",
      "france ligue 1",
      "ligue-1",
    ],
    defaultCompetitionId: null,
    competitionIdEnvName: "SPORTSDATA_LIGUE1_COMPETITION_ID",
    fixturePathEnvName: "SPORTSDATA_LIGUE1_SCHEDULE_FIXTURE_PATH",
    polymarketLeagueSlugEnvName: "POLYMARKET_LIGUE1_LEAGUE_SLUG",
    lsportsLeagueNameLike: "%Ligue 1%",
    gammaTagSlugs: ["ligue-1"],
  },
  {
    code: "europa",
    label: "Europa League",
    icon: "⬢",
    aliases: [
      "europa",
      "uel",
      "europa league",
      "uefa europa league",
      "uefa europa",
    ],
    defaultCompetitionId: null,
    competitionIdEnvName: "SPORTSDATA_EUROPA_COMPETITION_ID",
    fixturePathEnvName: "SPORTSDATA_EUROPA_SCHEDULE_FIXTURE_PATH",
    polymarketLeagueSlugEnvName: "POLYMARKET_EUROPA_LEAGUE_SLUG",
    lsportsLeagueNameLike: "%Europa League%",
    gammaTagSlugs: ["uel", "europa-league", "uefa-europa-league"],
  },
  {
    code: "uecl",
    label: "Conference League",
    icon: "⬡",
    aliases: [
      "uecl",
      "conference league",
      "conference",
      "uefa conference league",
      "uefa europa conference league",
      "europa conference league",
      "ecl",
    ],
    defaultCompetitionId: null,
    competitionIdEnvName: "SPORTSDATA_UECL_COMPETITION_ID",
    fixturePathEnvName: "SPORTSDATA_UECL_SCHEDULE_FIXTURE_PATH",
    polymarketLeagueSlugEnvName: "POLYMARKET_UECL_LEAGUE_SLUG",
    lsportsLeagueNameLike: "%Conference League%",
    gammaTagSlugs: ["uecl", "europa-conference-league", "uefa-conference-league"],
  },
  {
    code: "fifa-worldcup",
    label: "FIFA WC",
    icon: "◎",
    aliases: [
      "fifa world cup",
      "world cup",
      "fifa-world-cup",
      "fifa worldcup",
      "fifa-worldcup",
      "fifa wc",
      "fifawc",
    ],
    defaultCompetitionId: null,
    competitionIdEnvName: "SPORTSDATA_FIFA_WORLD_CUP_COMPETITION_ID",
    fixturePathEnvName: "SPORTSDATA_FIFA_WORLD_CUP_SCHEDULE_FIXTURE_PATH",
    polymarketLeagueSlugEnvName: "POLYMARKET_FIFA_WORLD_CUP_LEAGUE_SLUG",
    gammaTagSlugs: ["fifa-world-cup", "2026-fifa-world-cup"],
  },
  {
    code: "fifa-friendlies",
    label: "FIFA Friendlies",
    icon: "◌",
    activeIconUrl: "https://public-assets.pred.app/market-assets/FIFA/FIFA-League/Fifa%20Active%202_128x128.png",
    inactiveIconUrl: "https://public-assets.pred.app/market-assets/FIFA/FIFA-League/Inative%202_128x128.png",
    aliases: [
      "fifa friendlies",
      "friendlies",
      "international friendlies",
      "intl friendlies",
      "fifa-friendlies",
      "fifa friendlies men",
    ],
    defaultCompetitionId: null,
    competitionIdEnvName: "SPORTSDATA_FIFA_FRIENDLIES_COMPETITION_ID",
    fixturePathEnvName: "SPORTSDATA_FIFA_FRIENDLIES_SCHEDULE_FIXTURE_PATH",
    polymarketLeagueSlugEnvName: "POLYMARKET_FIFA_FRIENDLIES_LEAGUE_SLUG",
    gammaTagSlugs: [],
  },
]);

const LEAGUE_SCHEDULE_BY_CODE = new Map(
  LEAGUE_SCHEDULE_REGISTRY.map((entry) => [entry.code, Object.freeze({ ...entry })])
);

const LEAGUE_SCHEDULE_ALIAS_MAP = buildLeagueScheduleAliasMap(LEAGUE_SCHEDULE_REGISTRY);

export function getLeagueScheduleDefinitions() {
  return LEAGUE_SCHEDULE_REGISTRY.slice();
}

export function getLeagueScheduleDefinition(code) {
  const normalizedCode = String(code || "").trim().toLowerCase();
  return LEAGUE_SCHEDULE_BY_CODE.get(normalizedCode) || null;
}

export function resolveLeagueScheduleCode(value) {
  const normalized = normalizeForSearch(value);
  if (!normalized) {
    return "";
  }
  return LEAGUE_SCHEDULE_ALIAS_MAP.get(normalized) || "";
}

function buildLeagueScheduleAliasMap(entries) {
  const aliasMap = new Map();

  for (const entry of entries) {
    const allAliases = new Set([
      entry.code,
      entry.label,
      ...(Array.isArray(entry.aliases) ? entry.aliases : []),
    ]);

    for (const alias of allAliases) {
      const normalized = normalizeForSearch(alias);
      if (!normalized || aliasMap.has(normalized)) {
        continue;
      }
      aliasMap.set(normalized, entry.code);
    }
  }

  return aliasMap;
}
