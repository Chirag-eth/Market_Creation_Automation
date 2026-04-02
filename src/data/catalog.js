import { CATALOG_API_ENDPOINT, FIXTURE_LOGO_URL } from "../shared/constants.js";
import { fetchApiJson } from "../shared/apiClient.js";
import { FALLBACK_TEAMS } from "./fallbackCatalog.js";
import { normalizeForSearch, normalizeHexColor, slugify, generateCodeFromName } from "../shared/util.js";

const FALLBACK_CODE_BY_ALIAS = buildFallbackCodeByAlias();
const SCHEDULE_ALIAS_PRESETS = buildScheduleAliasPresets();

export async function fetchCatalogPayload() {
  return fetchApiJson(CATALOG_API_ENDPOINT, { cache: "no-store" });
}

export function normalizeCatalogPayload(payload) {
  const rawLeagues = Array.isArray(payload?.leagues) ? payload.leagues : [];
  const rawTeams = Array.isArray(payload?.teams) ? payload.teams : [];

  const leagues = normalizeLeagueRows(rawLeagues);
  const leagueIdSet = new Set(leagues.map((league) => league.id));
  const teams = normalizeTeamRows(rawTeams, leagues).filter((team) => !team.leagueId || leagueIdSet.has(team.leagueId));

  return { leagues, teams };
}

export function extractScheduleReadyLeagueCodes(payload) {
  const scheduleSupport = payload?.schedule_support;
  const rawCodes = normalizeScheduleReadyLeagueCodes(scheduleSupport?.ready_leagues);
  if (rawCodes) {
    return rawCodes;
  }

  const leagues = Array.isArray(scheduleSupport?.leagues) ? scheduleSupport.leagues : null;
  if (!leagues) {
    return null;
  }

  return normalizeScheduleReadyLeagueCodes(
    leagues
      .filter((league) => league?.ready)
      .map((league) => league?.code)
  );
}

export function normalizeLeagueRows(rows) {
  const seenKeys = new Set();
  const leagues = [];

  for (const row of rows) {
    const id = String(row?.league_id || row?.id || "").trim();
    const name = String(row?.name || "").trim();
    if (!id || !name) {
      continue;
    }

    const alternateName = String(row?.alternate_name || "").trim();
    const association = String(row?.association || "").trim();
    const rawSlug = alternateName || name;
    const baseSlug = slugify(rawSlug || name) || "league";
    let key = baseSlug;
    let suffix = 2;
    while (seenKeys.has(key)) {
      key = `${baseSlug}-${suffix}`;
      suffix += 1;
    }
    seenKeys.add(key);

    const aliases = new Set([name, alternateName, association, `${name} ${alternateName}`].filter(Boolean));
    if (alternateName) {
      aliases.add(expandLeagueAlias(alternateName));
    }

    leagues.push({
      key,
      id,
      name,
      slug: baseSlug,
      alternateName,
      aliases: Array.from(aliases)
        .map((alias) => String(alias || "").trim())
        .filter(Boolean),
    });
  }

  return leagues;
}

export function normalizeTeamRows(rows, leagues = []) {
  const teams = [];
  const leagueAliasMap = buildLeagueAliasMap(leagues);
  const leagueIdSet = new Set((Array.isArray(leagues) ? leagues : []).map((league) => String(league?.id || "").trim()).filter(Boolean));

  for (const row of rows) {
    const id = String(row?.team_id || row?.id || "").trim();
    const leagueId = String(row?.league_id || "").trim();
    const name = String(row?.name || "").trim();
    if (!id || !name) {
      continue;
    }

    const alternateName = String(row?.alternate_name || "").trim();
    const resolvedLeagueId = resolveTeamLeagueId({ leagueId, name, alternateName }, leagueIdSet, leagueAliasMap);
    const logoUrl = String(row?.logo_url || "").trim();
    const themeColor = normalizeHexColor(row?.theme_color || "#FFFFFF");
    const code = resolveCsvTeamCode(row, name, alternateName);
    const aliases = buildTeamAliases(name, alternateName, code);

    teams.push({
      id,
      leagueId: resolvedLeagueId || null,
      sourceLeagueId: leagueId || null,
      name,
      alternateName: alternateName || name,
      code,
      slug: slugify(name),
      themeColor,
      logoUrl: logoUrl || FIXTURE_LOGO_URL,
      aliases,
    });
  }

  return teams;
}

function resolveTeamLeagueId({ leagueId, name, alternateName }, leagueIdSet, leagueAliasMap) {
  const normalizedLeagueId = String(leagueId || "").trim();
  if (!normalizedLeagueId) {
    return "";
  }
  if (leagueIdSet.has(normalizedLeagueId)) {
    return normalizedLeagueId;
  }

  const candidates = buildTeamLeagueAliasCandidates(name, alternateName);
  for (const candidate of candidates) {
    const normalized = normalizeForSearch(candidate);
    if (!normalized) {
      continue;
    }
    const mappedLeagueId = leagueAliasMap.get(normalized);
    if (mappedLeagueId) {
      return mappedLeagueId;
    }
  }

  return normalizedLeagueId;
}

function buildTeamLeagueAliasCandidates(name, alternateName) {
  const candidates = new Set();
  for (const raw of [alternateName, name]) {
    const text = String(raw || "").trim();
    if (!text) {
      continue;
    }
    candidates.add(text);
    if (text.includes("_")) {
      const parts = text.split("_").map((part) => String(part || "").trim()).filter(Boolean);
      if (parts.length > 1) {
        candidates.add(parts.slice(1).join(" "));
        candidates.add(parts.slice(1).join("_"));
      }
      for (const part of parts) {
        candidates.add(part);
      }
    }
  }
  return Array.from(candidates);
}

function buildLeagueAliasMap(leagues) {
  const map = new Map();
  for (const league of Array.isArray(leagues) ? leagues : []) {
    const leagueId = String(league?.id || "").trim();
    if (!leagueId) {
      continue;
    }
    const aliases = new Set([
      league?.name,
      league?.alternateName,
      league?.slug,
      ...(Array.isArray(league?.aliases) ? league.aliases : []),
    ]);
    for (const alias of aliases) {
      const normalized = normalizeForSearch(alias);
      if (!normalized || map.has(normalized)) {
        continue;
      }
      map.set(normalized, leagueId);
    }
  }
  return map;
}

function resolveCsvTeamCode(row, name, alternateName) {
  const explicitCode = String(row?.market_code || row?.team_code || row?.code || "").trim().toUpperCase();
  if (explicitCode) {
    return explicitCode;
  }

  const fallbackCode = lookupFallbackCode(name, alternateName);
  if (fallbackCode) {
    return fallbackCode;
  }

  return generateCodeFromName(name);
}

function lookupFallbackCode(name, alternateName) {
  for (const candidate of [name, alternateName]) {
    const key = normalizeForSearch(candidate);
    if (!key) {
      continue;
    }
    const code = FALLBACK_CODE_BY_ALIAS.get(key);
    if (code) {
      return code;
    }
  }
  return null;
}

function normalizeScheduleReadyLeagueCodes(values) {
  if (!Array.isArray(values)) {
    return null;
  }

  return Array.from(
    new Set(
      values
        .map((value) => String(value || "").trim().toLowerCase())
        .filter(Boolean)
    )
  );
}

function buildFallbackCodeByAlias() {
  const map = new Map();

  for (const team of FALLBACK_TEAMS) {
    const code = String(team?.code || "").trim().toUpperCase();
    if (!code) {
      continue;
    }

    const aliases = new Set([
      team?.name,
      team?.alternateName,
      ...(Array.isArray(team?.aliases) ? team.aliases : []),
    ]);

    for (const alias of aliases) {
      const normalized = normalizeForSearch(alias);
      if (!normalized || map.has(normalized)) {
        continue;
      }
      map.set(normalized, code);
    }
  }

  return map;
}

export function expandLeagueAlias(value) {
  const normalized = normalizeForSearch(value);
  if (normalized === "epl") {
    return "english premier league";
  }
  if (normalized === "ucl") {
    return "uefa champions league champions league";
  }
  if (normalized === "uel") {
    return "uefa europa league europa league";
  }
  return value;
}

export function buildTeamAliases(name, alternateName, code = "") {
  const out = new Set();
  const queue = [name, alternateName]
    .map((candidate) => String(candidate || "").trim())
    .filter(Boolean);
  const seen = new Set();

  while (queue.length > 0) {
    const raw = String(queue.shift() || "").trim();
    const normalized = normalizeForSearch(raw);
    if (!raw || seen.has(normalized)) {
      continue;
    }
    seen.add(normalized);

    for (const variant of deriveTeamAliasVariants(raw)) {
      const alias = String(variant || "").trim();
      if (!alias) {
        continue;
      }
      out.add(alias);

      const presetVariants = SCHEDULE_ALIAS_PRESETS.get(normalizeForSearch(alias)) || [];
      for (const preset of presetVariants) {
        const presetAlias = String(preset || "").trim();
        if (!presetAlias) {
          continue;
        }
        out.add(presetAlias);
        const presetNormalized = normalizeForSearch(presetAlias);
        if (presetNormalized && !seen.has(presetNormalized)) {
          queue.push(presetAlias);
        }
      }
    }
  }

  const codeRaw = String(code || "").trim().toUpperCase();
  if (codeRaw) {
    out.add(codeRaw);
  }

  return Array.from(out).filter(Boolean);
}

function deriveTeamAliasVariants(raw) {
  const out = new Set();
  const trimmed = String(raw || "").trim();
  if (!trimmed) {
    return out;
  }

  out.add(trimmed);
  out.add(trimmed.replace(/\b(fc|cf|afc|sc)\b/gi, "").replace(/\s+/g, " ").trim());
  out.add(trimmed.replace(/^\s*(?:afc|fc|cf|sc)\s+/i, "").replace(/\s+/g, " ").trim());
  out.add(
    trimmed
      .replace(/\b(fc|cf|afc|sc|sk|sl|rc|rcd|ca|cd|sd|ud|fk|kv|club|deportivo)\b/gi, "")
      .replace(/\s+/g, " ")
      .trim()
  );
  out.add(trimmed.replace(/\bsl\b/gi, "").replace(/\s+/g, " ").trim());
  out.add(trimmed.replace(/\s*&\s*/g, " and ").replace(/\s+/g, " ").trim());
  out.add(trimmed.replace(/\band\b/gi, "&").replace(/\s+/g, " ").trim());
  out.add(trimmed.replace(/[\W_]+/g, ""));

  return out;
}

function buildScheduleAliasPresets() {
  const presets = new Map();
  const seed = [
    [["bournemouth"], ["AFC Bournemouth"]],
    [["man utd", "man united"], ["Manchester United", "Manchester United FC"]],
    [["man city"], ["Manchester City", "Manchester City FC"]],
    [["brighton"], ["Brighton & Hove Albion", "Brighton & Hove Albion FC", "Brighton and Hove Albion", "Brighton and Hove Albion FC"]],
    [["spurs", "tottenham"], ["Tottenham Hotspur", "Tottenham Hotspur FC"]],
    [["forest", "nottm forest"], ["Nottingham Forest", "Nottingham Forest FC"]],
    [["newcastle"], ["Newcastle United", "Newcastle United FC"]],
    [["west ham"], ["West Ham United", "West Ham United FC"]],
    [["wolves", "wolverhampton", "wolverhampton wanderers"], ["Wolverhampton Wanderers", "Wolverhampton Wanderers FC"]],
    [["sunderland"], ["Sunderland AFC"]],
    [["leeds"], ["Leeds United", "Leeds United FC"]],
    [["villa", "aston villa"], ["Aston Villa FC"]],
    [["athletic"], ["Athletic Club"]],
    [["sociedad"], ["Real Sociedad", "Real Sociedad de Futbol"]],
    [["betis"], ["Real Betis", "Real Betis Balompie"]],
    [["atletico madrid", "atletico de madrid", "club atletico de madrid"], ["Atletico de Madrid"]],
    [["rayo vallecano de madrid", "rayo vallecano"], ["Rayo Vallecano"]],
    [["celta de vigo", "rc celta de vigo"], ["Celta Vigo"]],
    [["alaves", "deportivo alaves"], ["Deportivo Alaves"]],
    [["osasuna", "ca osasuna"], ["Osasuna"]],
    [["mallorca", "rcd mallorca"], ["Mallorca"]],
  ];

  for (const [keys, values] of seed) {
    for (const key of keys) {
      const normalizedKey = normalizeForSearch(key);
      if (!normalizedKey) {
        continue;
      }
      const existing = presets.get(normalizedKey) || [];
      presets.set(normalizedKey, Array.from(new Set([...existing, ...values])));
    }
  }

  return presets;
}

export function buildTeamAliasIndex(teams) {
  const out = [];
  for (const team of teams) {
    const seen = new Set();
    const aliases = Array.isArray(team?.aliases) ? team.aliases : [team?.name].filter(Boolean);
    for (const alias of aliases) {
      const normalized = normalizeForSearch(alias);
      if (normalized.length < 2 || seen.has(normalized)) {
        continue;
      }
      seen.add(normalized);
      out.push({ alias: normalized, team });
    }
  }
  return out;
}
