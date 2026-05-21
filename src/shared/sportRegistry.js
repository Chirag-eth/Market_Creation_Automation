import { normalizeForSearch } from "./util.js";

const SPORT_REGISTRY = Object.freeze([
  Object.freeze({
    code: "soccer",
    label: "Soccer",
    icon: "⚽",
    csvName: "Football",
    csvAliases: ["football", "soccer", "association football"],
    regulationPhrase: "90 minutes of regular play plus stoppage time",
    scoringNoun: "goals",
    titleScoringWord: "Goals",
    defaultResolutionSourceDomain: "official league site",
    submarketCatalog: Object.freeze({
      families: Object.freeze(["moneyline", "spreads", "totals", "btts"]),
      drawSupported: true,
      bttsSupported: true,
      customLines: false,
      defaultTotalsLines: Object.freeze(["0.5", "1.5", "2.5", "3.5", "4.5", "5.5"]),
      defaultSpreadsLines: Object.freeze(["1.5", "2.5"]),
    }),
    defaultTickSize: "0.01",
  }),
  Object.freeze({
    code: "nba",
    label: "NBA",
    icon: "🏀",
    csvName: "Basketball",
    csvAliases: ["basketball", "nba"],
    regulationPhrase: "including any overtime",
    scoringNoun: "points",
    titleScoringWord: "Points",
    defaultResolutionSourceDomain: "nba.com",
    submarketCatalog: Object.freeze({
      families: Object.freeze(["moneyline", "spreads", "totals"]),
      drawSupported: false,
      bttsSupported: false,
      customLines: true,
      defaultTotalsLines: Object.freeze([]),
      defaultSpreadsLines: Object.freeze([]),
    }),
    defaultTickSize: "0.01",
  }),
  Object.freeze({
    code: "nfl",
    label: "NFL",
    icon: "🏈",
    csvName: "American Football",
    csvAliases: ["american football", "nfl", "american-football"],
    regulationPhrase: "four quarters plus any overtime",
    scoringNoun: "points",
    titleScoringWord: "Points",
    defaultResolutionSourceDomain: "nfl.com",
    submarketCatalog: Object.freeze({
      families: Object.freeze(["moneyline", "spreads", "totals"]),
      drawSupported: false,
      bttsSupported: false,
      customLines: true,
      defaultTotalsLines: Object.freeze([]),
      defaultSpreadsLines: Object.freeze([]),
    }),
    defaultTickSize: "0.01",
  }),
]);

const SPORT_BY_CODE = new Map(SPORT_REGISTRY.map((entry) => [entry.code, entry]));

const SPORT_CSV_ALIAS_MAP = buildSportCsvAliasMap(SPORT_REGISTRY);

const DEFAULT_SPORT_CODE = "soccer";

export function getSportDefinitions() {
  return SPORT_REGISTRY.slice();
}

export function getSportDefinition(code) {
  const normalizedCode = String(code || "")
    .trim()
    .toLowerCase();
  return SPORT_BY_CODE.get(normalizedCode) || null;
}

export function getDefaultSportCode() {
  return DEFAULT_SPORT_CODE;
}

export function getDefaultSportDefinition() {
  return SPORT_BY_CODE.get(DEFAULT_SPORT_CODE);
}

export function resolveSportFromCsvName(value) {
  const normalized = normalizeForSearch(value);
  if (!normalized) {
    return "";
  }
  return SPORT_CSV_ALIAS_MAP.get(normalized) || "";
}

function buildSportCsvAliasMap(entries) {
  const aliasMap = new Map();
  for (const entry of entries) {
    const aliases = new Set([entry.code, entry.csvName, ...(entry.csvAliases || [])]);
    for (const alias of aliases) {
      const normalized = normalizeForSearch(alias);
      if (!normalized || aliasMap.has(normalized)) continue;
      aliasMap.set(normalized, entry.code);
    }
  }
  return aliasMap;
}
