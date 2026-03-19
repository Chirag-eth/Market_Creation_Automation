import { CATALOG_API_ENDPOINT, FIXTURE_LOGO_URL } from "../shared/constants.js";
import { FALLBACK_TEAMS } from "./fallbackCatalog.js";
import { normalizeForSearch, normalizeHexColor, slugify, generateCodeFromName } from "../shared/util.js";

const FALLBACK_CODE_BY_ALIAS = buildFallbackCodeByAlias();
const SCHEDULE_ALIAS_PRESETS = buildScheduleAliasPresets();

export async function fetchCatalogPayload() {
  const response = await fetch(CATALOG_API_ENDPOINT, { cache: "no-store" });
  if (!response.ok) {
    throw new Error(`Catalog endpoint returned ${response.status}`);
  }
  return response.json();
}

export function normalizeCatalogPayload(payload) {
  const rawLeagues = Array.isArray(payload?.leagues) ? payload.leagues : [];
  const rawTeams = Array.isArray(payload?.teams) ? payload.teams : [];

  const leagues = normalizeLeagueRows(rawLeagues);
  const leagueIdSet = new Set(leagues.map((league) => league.id));
  const teams = normalizeTeamRows(rawTeams).filter((team) => !team.leagueId || leagueIdSet.has(team.leagueId));

  return { leagues, teams };
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

export function normalizeTeamRows(rows) {
  const teams = [];

  for (const row of rows) {
    const id = String(row?.team_id || row?.id || "").trim();
    const leagueId = String(row?.league_id || "").trim();
    const name = String(row?.name || "").trim();
    if (!id || !name) {
      continue;
    }

    const alternateName = String(row?.alternate_name || "").trim();
    const logoUrl = String(row?.logo_url || "").trim();
    const themeColor = normalizeHexColor(row?.theme_color || "#FFFFFF");
    const code = resolveCsvTeamCode(row, name, alternateName);
    const aliases = buildTeamAliases(name, alternateName, code);

    teams.push({
      id,
      leagueId: leagueId || null,
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
