import { CATALOG_API_ENDPOINT, FIXTURE_LOGO_URL } from "./constants.js";
import { FALLBACK_TEAMS } from "./fallbackCatalog.js";
import { normalizeForSearch, normalizeHexColor, slugify, generateCodeFromName } from "./util.js";

const FALLBACK_CODE_BY_ALIAS = buildFallbackCodeByAlias();

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
  for (const candidate of [name, alternateName]) {
    const raw = String(candidate || "").trim();
    if (!raw) {
      continue;
    }
    out.add(raw);
    out.add(raw.replace(/\b(fc|cf|afc|sc)\b/gi, "").replace(/\s+/g, " ").trim());
    out.add(raw.replace(/\bsl\b/gi, "").replace(/\s+/g, " ").trim());
    out.add(raw.replace(/[\W_]+/g, ""));
  }

  const codeRaw = String(code || "").trim().toUpperCase();
  if (codeRaw) {
    out.add(codeRaw);
  }

  return Array.from(out).filter(Boolean);
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
