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
