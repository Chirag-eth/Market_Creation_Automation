import { isValidUuid } from "../shared/util.js";

const UUID_LIKE_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export function isUuidLike(value) {
  return UUID_LIKE_RE.test(String(value || "").trim());
}

export function isIsoDateTimeLike(value) {
  const text = String(value || "").trim();
  if (!text || !text.includes("T")) {
    return false;
  }
  const parsed = new Date(text);
  return Number.isFinite(parsed.getTime());
}

export function validateFixtureJson(fixture) {
  const errors = [];
  if (!fixture || typeof fixture !== "object") {
    return ["Fixture JSON is missing."];
  }

  if (!String(fixture.name || "").trim()) {
    errors.push("Fixture name is required.");
  }
  if (!String(fixture.league_id || "").trim()) {
    errors.push("league_id is required from CSV league catalog.");
  } else if (!isUuidLike(fixture.league_id)) {
    errors.push("league_id must be a UUID-like string.");
  }
  if (!String(fixture.home_team_id || "").trim()) {
    errors.push("home_team_id is required from CSV team catalog.");
  } else if (!isUuidLike(fixture.home_team_id)) {
    errors.push("home_team_id must be a UUID-like string.");
  }
  if (!String(fixture.away_team_id || "").trim()) {
    errors.push("away_team_id is required from CSV team catalog.");
  } else if (!isUuidLike(fixture.away_team_id)) {
    errors.push("away_team_id must be a UUID-like string.");
  }
  if (fixture.home_team_id && fixture.away_team_id && String(fixture.home_team_id) === String(fixture.away_team_id)) {
    errors.push("home_team_id and away_team_id cannot be the same.");
  }
  if (!Number.isInteger(fixture.match_day) || fixture.match_day < 1) {
    errors.push("match_day is required and must be a positive integer.");
  }
  if (
    fixture.match_week != null &&
    fixture.match_week !== "" &&
    (!Number.isInteger(fixture.match_week) || fixture.match_week < 0)
  ) {
    errors.push("match_week must be null/empty or a non-negative integer.");
  }
  if (Object.prototype.hasOwnProperty.call(fixture, "game_start_time") && !isIsoDateTimeLike(fixture.game_start_time)) {
    errors.push("game_start_time must be an ISO datetime string when provided.");
  }

  return errors;
}

export function validateParentMarketPayload(payload) {
  const errors = [];
  if (!payload || typeof payload !== "object") {
    return ["Parent market payload is missing."];
  }

  const parent = payload.parent_market;
  const markets = payload.markets;

  if (!parent || typeof parent !== "object") {
    errors.push("parent_market is required.");
  } else {
    if (parent.type_reference_id && !isValidUuid(parent.type_reference_id)) {
      errors.push("parent_market.type_reference_id must be a valid UUID.");
    }
    if (!parent.league_id) {
      errors.push("parent_market.league_id is required.");
    } else if (!isUuidLike(parent.league_id)) {
      errors.push("parent_market.league_id must be a UUID-like string.");
    }
    for (const key of ["markets_open_time", "markets_close_time", "payout_time", "time_remaining"]) {
      if (!parent[key]) {
        errors.push(`parent_market.${key} is required.`);
      } else if (!isIsoDateTimeLike(parent[key])) {
        errors.push(`parent_market.${key} must be an ISO datetime string.`);
      }
    }
  }

  if (!Array.isArray(markets) || markets.length !== 3) {
    errors.push("markets must contain exactly 3 items.");
  } else {
    const marketCodes = new Set();
    for (let i = 0; i < markets.length; i += 1) {
      const market = markets[i];
      if (!market || typeof market !== "object") {
        errors.push(`markets[${i}] is invalid.`);
        continue;
      }
      const code = String(market.market_code || "").trim().toUpperCase();
      if (!code) {
        errors.push(`markets[${i}].market_code is required.`);
      } else if (marketCodes.has(code)) {
        errors.push(`Duplicate market_code "${code}" in markets.`);
      } else {
        marketCodes.add(code);
      }
      if (market.team_id != null && String(market.team_id).trim() && !isUuidLike(market.team_id)) {
        errors.push(`markets[${i}].team_id must be a UUID-like string or null.`);
      }
      if (market.time_remaining && !isIsoDateTimeLike(market.time_remaining)) {
        errors.push(`markets[${i}].time_remaining must be an ISO datetime string.`);
      }
    }
  }

  return errors;
}

export function validateUatTypeReferencePayloads(payload) {
  const errors = [];
  const entries = payload && typeof payload === "object" ? payload : null;

  if (!entries) {
    return ["Type reference payloads are missing."];
  }

  const expectedKeys = ["fixture", "generic"];
  for (const key of expectedKeys) {
    const entry = entries[key];
    if (!entry || typeof entry !== "object") {
      errors.push(`type_reference.${key} payload is required.`);
      continue;
    }

    const typeValue = String(entry.type_value || "").trim();
    const expectedTypeValue = key;
    if (!typeValue) {
      errors.push(`type_reference.${key}.type_value is required.`);
    } else if (typeValue !== expectedTypeValue) {
      errors.push(`type_reference.${key}.type_value must be "${expectedTypeValue}".`);
    }

    if (!String(entry.type_value_id || "").trim()) {
      errors.push(`type_reference.${key}.type_value_id is required.`);
    } else if (!isValidUuid(entry.type_value_id)) {
      errors.push(`type_reference.${key}.type_value_id must be a valid UUID.`);
    }

    if (!String(entry.canonical_name || "").trim()) {
      errors.push(`type_reference.${key}.canonical_name is required.`);
    }
  }

  return errors;
}

export function validateUatParentMarketFamilyPayload(payload, { family = "" } = {}) {
  const errors = [];
  if (!payload || typeof payload !== "object") {
    return ["UAT parent-market family payload is missing."];
  }

  const parent = payload.parent_market;
  const markets = payload.markets;

  if (!parent || typeof parent !== "object") {
    errors.push("parent_market is required.");
  } else {
    if (!String(parent.league_id || "").trim()) {
      errors.push("parent_market.league_id is required.");
    } else if (!isUuidLike(parent.league_id)) {
      errors.push("parent_market.league_id must be a UUID-like string.");
    }

    if (!String(parent.title || "").trim()) {
      errors.push("parent_market.title is required.");
    }

    if (!String(parent.parent_market_family || "").trim()) {
      errors.push("parent_market.parent_market_family is required.");
    } else if (String(family || "").trim() && String(parent.parent_market_family || "").trim() !== String(family || "").trim()) {
      errors.push(`parent_market.parent_market_family must be "${String(family || "").trim()}".`);
    }

    if (!String(parent.market_line ?? "").trim() && parent.market_line !== 0) {
      errors.push("parent_market.market_line is required.");
    }

    if (!parent.rules) {
      errors.push("parent_market.rules is required.");
    }

    if (!parent.markets_open_time) {
      errors.push("parent_market.markets_open_time is required.");
    } else if (!isIsoDateTimeLike(parent.markets_open_time)) {
      errors.push("parent_market.markets_open_time must be an ISO datetime string.");
    }

    if (parent.type_reference_id && !isValidUuid(parent.type_reference_id)) {
      errors.push("parent_market.type_reference_id must be a valid UUID when provided.");
    }
  }

  if (!Array.isArray(markets) || markets.length === 0) {
    errors.push("markets must contain at least 1 item.");
  } else {
    const marketCodes = new Set();
    for (let i = 0; i < markets.length; i += 1) {
      const market = markets[i];
      if (!market || typeof market !== "object") {
        errors.push(`markets[${i}] is invalid.`);
        continue;
      }

      const code = String(market.market_code || "").trim();
      if (!code) {
        errors.push(`markets[${i}].market_code is required.`);
      } else if (marketCodes.has(code.toUpperCase())) {
        errors.push(`Duplicate market_code "${code}" in markets.`);
      } else {
        marketCodes.add(code.toUpperCase());
      }

      if (!String(market.name || "").trim()) {
        errors.push(`markets[${i}].name is required.`);
      }

      if (!String(market.rules || "").trim()) {
        errors.push(`markets[${i}].rules is required.`);
      }

      if (market.team_id != null && String(market.team_id).trim() && !isUuidLike(market.team_id)) {
        errors.push(`markets[${i}].team_id must be a UUID-like string or blank.`);
      }
    }
  }

  return errors;
}
