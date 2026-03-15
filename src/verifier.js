import {
  FIXTURE_LOGO_URL,
  DEFAULT_FIXTURE_THEME,
  DEFAULT_DRAW_THEME,
  DRAW_LOGO_URL,
} from "./constants.js";
import { buildParentMarketPayload } from "./markets.js";
import { collectFixtureBundleFromInference, findExactTeamForLeague } from "./parser.js";
import { validateFixtureJson, validateParentMarketPayload } from "./validation.js";
import { generateCodeFromName, isValidUuid, normalizeForSearch } from "./util.js";

export function parseJsonInput(rawValue, label) {
  const raw = String(rawValue || "").trim();
  if (!raw) {
    return {
      value: null,
      errors: [`${label} is empty.`],
    };
  }

  try {
    const parsed = JSON.parse(raw);
    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
      return {
        value: null,
        errors: [`${label} must be a JSON object.`],
      };
    }
    return {
      value: parsed,
      errors: [],
    };
  } catch (error) {
    return {
      value: null,
      errors: [`${label} is invalid JSON: ${String(error?.message || error)}`],
    };
  }
}

export function verifyFixtureJsonStrict(fixture, catalog) {
  const errors = validateFixtureJson(fixture);
  const warnings = [];
  const info = [];

  if (!fixture || typeof fixture !== "object") {
    return {
      ok: false,
      errors,
      warnings,
      info,
      resolved: null,
    };
  }

  const leagueId = String(fixture.league_id || "").trim();
  const homeTeamId = String(fixture.home_team_id || "").trim();
  const awayTeamId = String(fixture.away_team_id || "").trim();

  const league = findLeagueById(catalog?.leagues || [], leagueId);
  if (!league) {
    errors.push(`league_id \"${leagueId || "(empty)"}\" is not present in leagues.csv.`);
  }

  const homeTeam = findTeamById(catalog?.teams || [], homeTeamId);
  if (!homeTeam) {
    errors.push(`home_team_id \"${homeTeamId || "(empty)"}\" is not present in teams.csv.`);
  }

  const awayTeam = findTeamById(catalog?.teams || [], awayTeamId);
  if (!awayTeam) {
    errors.push(`away_team_id \"${awayTeamId || "(empty)"}\" is not present in teams.csv.`);
  }

  if (homeTeam && league && String(homeTeam.leagueId || "") !== String(league.id || "")) {
    errors.push(`home_team_id \"${homeTeam.id}\" belongs to league_id \"${homeTeam.leagueId}\", not fixture league_id \"${league.id}\".`);
  }

  if (awayTeam && league && String(awayTeam.leagueId || "") !== String(league.id || "")) {
    errors.push(`away_team_id \"${awayTeam.id}\" belongs to league_id \"${awayTeam.leagueId}\", not fixture league_id \"${league.id}\".`);
  }

  if (homeTeam && awayTeam) {
    const expectedName = `${homeTeam.name} vs ${awayTeam.name}`;
    if (normalizeForSearch(fixture.name) !== normalizeForSearch(expectedName)) {
      errors.push(`fixture.name must match CSV teams: expected \"${expectedName}\".`);
    }
  }

  if (fixture.match_week != null && fixture.match_week !== "") {
    const week = Number(fixture.match_week);
    if (!Number.isInteger(week) || week < 1) {
      errors.push("match_week must be null/empty or a positive integer.");
    }
  }

  if (String(fixture.logo_url || "").trim() && String(fixture.logo_url || "").trim() !== FIXTURE_LOGO_URL) {
    warnings.push(`logo_url differs from default fixture logo (${FIXTURE_LOGO_URL}).`);
  }

  if (String(fixture.theme_color || "").trim() && String(fixture.theme_color || "").trim().toUpperCase() !== DEFAULT_FIXTURE_THEME) {
    warnings.push(`theme_color differs from default fixture theme (${DEFAULT_FIXTURE_THEME}).`);
  }

  if (league) {
    info.push(`League verified from CSV: ${league.name} (${league.id}).`);
  }
  if (homeTeam) {
    info.push(`Home team verified from CSV: ${homeTeam.name} (${homeTeam.id}).`);
  }
  if (awayTeam) {
    info.push(`Away team verified from CSV: ${awayTeam.name} (${awayTeam.id}).`);
  }

  return {
    ok: errors.length === 0,
    errors,
    warnings,
    info,
    resolved: {
      league,
      homeTeam,
      awayTeam,
    },
  };
}

export function verifyParentMarketJsonStrict(payload, catalog, { fixture, fixtureResolved, now } = {}) {
  const errors = validateParentMarketPayload(payload);
  const warnings = [];
  const info = [];
  const current = now instanceof Date ? new Date(now.getTime()) : new Date();
  const nowMs = current.getTime();
  const nowIso = current.toISOString();

  if (!payload || typeof payload !== "object") {
    return {
      ok: false,
      errors,
      warnings,
      info,
      resolved: null,
    };
  }

  const parent = payload.parent_market && typeof payload.parent_market === "object" ? payload.parent_market : null;
  const markets = Array.isArray(payload.markets) ? payload.markets : [];
  const league = findLeagueById(catalog?.leagues || [], String(parent?.league_id || "").trim());

  if (!league) {
    errors.push(`parent_market.league_id \"${String(parent?.league_id || "").trim() || "(empty)"}\" is not present in leagues.csv.`);
  }

  if (parent) {
    if (String(parent.status || "").trim().toLowerCase() !== "active") {
      errors.push("parent_market.status must be \"active\".");
    }
    if (parent.is_cross_matching_enabled !== true) {
      errors.push("parent_market.is_cross_matching_enabled must be true.");
    }
  }

  const fixtureCheck = fixtureResolved || (fixture ? verifyFixtureJsonStrict(fixture, catalog) : null);
  const homeTeam = fixtureCheck?.resolved?.homeTeam || inferHomeTeamFromMarkets(markets, catalog?.teams || []);
  const awayTeam = fixtureCheck?.resolved?.awayTeam || inferAwayTeamFromMarkets(markets, catalog?.teams || [], homeTeam?.id || null);

  if (!homeTeam || !awayTeam) {
    errors.push("Could not resolve home/away teams from fixture JSON or parent markets team_id values.");
  }

  if (homeTeam && awayTeam && String(homeTeam.leagueId || "") !== String(awayTeam.leagueId || "")) {
    errors.push("Home and away teams resolve to different leagues in teams.csv.");
  }

  if (homeTeam && league && String(homeTeam.leagueId || "") !== String(league.id || "")) {
    errors.push(`Resolved home team league_id \"${homeTeam.leagueId}\" does not match parent_market.league_id \"${league.id}\".`);
  }

  if (awayTeam && league && String(awayTeam.leagueId || "") !== String(league.id || "")) {
    errors.push(`Resolved away team league_id \"${awayTeam.leagueId}\" does not match parent_market.league_id \"${league.id}\".`);
  }

  if (parent && homeTeam && awayTeam) {
    const expectedTitle = `${homeTeam.name} vs ${awayTeam.name}`;
    if (normalizeForSearch(parent.title) !== normalizeForSearch(expectedTitle)) {
      errors.push(`parent_market.title must match CSV teams: expected \"${expectedTitle}\".`);
    }
    if (!String(parent.description || "").includes(String(parent.title || ""))) {
      warnings.push("parent_market.description should include parent_market.title.");
    }
  }

  if (fixture && parent) {
    if (normalizeForSearch(parent.title) !== normalizeForSearch(fixture.name)) {
      errors.push("parent_market.title must match fixture.name.");
    }
    if (String(parent.league_id || "") !== String(fixture.league_id || "")) {
      errors.push("parent_market.league_id must match fixture.league_id.");
    }
  }

  const drawMarket = markets.find((market) => market && market.team_id == null);
  const homeMarket = homeTeam ? markets.find((market) => String(market?.team_id || "") === String(homeTeam.id)) : null;
  const awayMarket = awayTeam ? markets.find((market) => String(market?.team_id || "") === String(awayTeam.id)) : null;

  if (!drawMarket) {
    errors.push("A draw market with team_id = null is required.");
  }

  if (!homeMarket && homeTeam) {
    errors.push(`No market found for home team_id \"${homeTeam.id}\".`);
  }

  if (!awayMarket && awayTeam) {
    errors.push(`No market found for away team_id \"${awayTeam.id}\".`);
  }

  if (homeMarket && homeTeam) {
    validateTeamMarket(homeMarket, homeTeam, "home", errors, warnings);
  }

  if (awayMarket && awayTeam) {
    validateTeamMarket(awayMarket, awayTeam, "away", errors, warnings);
  }

  if (drawMarket) {
    if (String(drawMarket.market_code || "").trim().toUpperCase() !== "DRAW") {
      errors.push("Draw market market_code must be DRAW.");
    }
    if (normalizeForSearch(drawMarket.name) !== "draw") {
      errors.push("Draw market name must be Draw.");
    }
    if (String(drawMarket.logo_url || "").trim() && String(drawMarket.logo_url || "").trim() !== DRAW_LOGO_URL) {
      warnings.push("Draw market logo_url differs from default Draw logo.");
    }
    if (String(drawMarket.theme_color || "").trim() && String(drawMarket.theme_color || "").trim().toUpperCase() !== DEFAULT_DRAW_THEME) {
      warnings.push(`Draw market theme_color differs from default (${DEFAULT_DRAW_THEME}).`);
    }
  }

  if (parent) {
    const parentTimes = ["markets_open_time", "markets_close_time", "payout_time", "time_remaining"].map((key) => ({
      key,
      value: parseIsoDate(parent[key]),
    }));

    for (const entry of parentTimes) {
      if (!entry.value) {
        continue;
      }
      info.push(`parent_market.${entry.key} parsed successfully: ${entry.value.toISOString()}`);
      if (entry.value.getTime() <= nowMs) {
        errors.push(`parent_market.${entry.key} must be greater than current UTC time (${nowIso}).`);
      }
    }

    const openDate = parentTimes.find((entry) => entry.key === "markets_open_time")?.value || null;
    const closeDate = parentTimes.find((entry) => entry.key === "markets_close_time")?.value || null;
    const payoutDate = parentTimes.find((entry) => entry.key === "payout_time")?.value || null;
    const remainingDate = parentTimes.find((entry) => entry.key === "time_remaining")?.value || null;

    if (openDate && closeDate && openDate.getTime() > closeDate.getTime()) {
      errors.push("parent_market.markets_open_time must be <= parent_market.markets_close_time.");
    }
    if (closeDate && payoutDate && closeDate.getTime() !== payoutDate.getTime()) {
      warnings.push("parent_market.payout_time differs from markets_close_time.");
    }
    if (closeDate && remainingDate && closeDate.getTime() !== remainingDate.getTime()) {
      warnings.push("parent_market.time_remaining differs from markets_close_time.");
    }

    if (homeTeam && awayTeam && league && closeDate) {
      const fixtureDateIso = deriveFixtureDateIsoForExpectedParent(parent, markets, closeDate, warnings);
      const kickoffTimeUtc = closeDate.toISOString().slice(11, 16);
      const fixtureTemplate = fixture || {
        name: `${homeTeam.name} vs ${awayTeam.name}`,
        league_id: league.id,
        home_team_id: homeTeam.id,
        away_team_id: awayTeam.id,
        format: null,
        logo_url: FIXTURE_LOGO_URL,
        theme_color: DEFAULT_FIXTURE_THEME,
        match_day: 1,
        match_week: null,
        location: "",
        venue: "",
      };

      try {
        const expected = buildParentMarketPayload(
          {
            fixtureJson: fixtureTemplate,
            league: {
              key: league.key,
              id: league.id,
              name: league.name,
              slug: league.slug,
            },
            homeTeam,
            awayTeam,
            fixtureDateIso,
            kickoffTimeUtc,
            openIso: String(parent.markets_open_time || ""),
            closeIso: String(parent.markets_close_time || ""),
            payoutIso: String(parent.payout_time || ""),
          },
          String(parent.type_reference_id || "").trim() || null
        );

        if (String(parent.market_code || "").trim().toUpperCase() !== String(expected.parent_market.market_code || "").trim().toUpperCase()) {
          errors.push(`parent_market.market_code mismatch. Expected \"${expected.parent_market.market_code}\".`);
        }
        if (normalizeForSearch(parent.parent_market_canonical_name) !== normalizeForSearch(expected.parent_market.parent_market_canonical_name)) {
          errors.push(`parent_market.parent_market_canonical_name mismatch. Expected \"${expected.parent_market.parent_market_canonical_name}\".`);
        }
      } catch (error) {
        warnings.push(`Could not compute strict parent code/canonical expectation: ${String(error?.message || error)}`);
      }
    }
  }

  if (parent && String(parent.type_reference_id || "").trim() && !isValidUuid(String(parent.type_reference_id || "").trim())) {
    errors.push("parent_market.type_reference_id must be a valid UUID or null.");
  }

  return {
    ok: errors.length === 0,
    errors,
    warnings,
    info,
    resolved: {
      league,
      homeTeam,
      awayTeam,
      drawMarket,
      homeMarket,
      awayMarket,
    },
  };
}

export function verifyBundleConsistency(fixture, parentPayload, catalog) {
  const errors = [];
  const warnings = [];
  const info = [];

  if (!fixture || !parentPayload) {
    return {
      ok: false,
      errors: ["Both fixture JSON and parent market JSON are required for bundle consistency verification."],
      warnings,
      info,
    };
  }

  const fixtureCheck = verifyFixtureJsonStrict(fixture, catalog);
  const parentCheck = verifyParentMarketJsonStrict(parentPayload, catalog, {
    fixture,
    fixtureResolved: fixtureCheck,
  });

  if (!fixtureCheck.ok) {
    errors.push("Fixture JSON failed strict verification; bundle consistency cannot be guaranteed.");
  }
  if (!parentCheck.ok) {
    errors.push("Parent market JSON failed strict verification; bundle consistency cannot be guaranteed.");
  }

  if (fixtureCheck.ok && parentCheck.ok) {
    info.push("Fixture and parent market payloads are consistent with CSV source of truth.");
  }

  return {
    ok: errors.length === 0,
    errors,
    warnings,
    info,
    fixtureCheck,
    parentCheck,
  };
}

export function generateFromEventInput(input, catalog) {
  const errors = [];
  const warnings = [];
  const info = [];

  const eventName = String(input?.eventName || "").trim();
  const leagueSelection = String(input?.leagueSelection || "").trim();
  const fixtureDate = String(input?.fixtureDate || "").trim();
  const kickoffTimeUtc = String(input?.kickoffTimeUtc || "").trim();
  const matchDayRaw = String(input?.matchDay || "").trim();
  const matchWeekRaw = String(input?.matchWeek || "").trim();
  const location = String(input?.location || "");
  const venue = String(input?.venue || "");
  const typeReferenceId = String(input?.typeReferenceId || "").trim();

  const parsedEvent = parseEventName(eventName);
  if (!parsedEvent) {
    errors.push("Event Name must follow 'Home Team vs Away Team' format.");
  }

  if (!fixtureDate || !/^\d{4}-\d{2}-\d{2}$/.test(fixtureDate)) {
    errors.push("Fixture Date (UTC) is required in YYYY-MM-DD format.");
  }

  if (!kickoffTimeUtc || !/^\d{2}:\d{2}$/.test(kickoffTimeUtc)) {
    errors.push("Kickoff Time (UTC) is required in HH:MM format.");
  }

  const matchDay = Number.parseInt(matchDayRaw, 10);
  if (!Number.isInteger(matchDay) || matchDay < 1) {
    errors.push("Match Day is required and must be a positive integer.");
  }

  let matchWeek = null;
  if (matchWeekRaw) {
    const parsedWeek = Number.parseInt(matchWeekRaw, 10);
    if (!Number.isInteger(parsedWeek) || parsedWeek < 1) {
      errors.push("Match Week must be empty or a positive integer.");
    } else {
      matchWeek = parsedWeek;
    }
  }

  if (typeReferenceId && !isValidUuid(typeReferenceId)) {
    errors.push("Type Reference ID must be a valid UUID or empty.");
  }

  const selectedLeague = resolveLeagueSelection(catalog?.leagues || [], leagueSelection);
  if (leagueSelection && !selectedLeague) {
    errors.push(`Selected league \"${leagueSelection}\" is not present in leagues.csv.`);
  }

  if (errors.length > 0) {
    return {
      ok: false,
      errors,
      warnings,
      info,
      fixtureJson: null,
      parentPayload: null,
    };
  }

  let homeTeam = resolveEventTeam(parsedEvent.homeRaw, catalog?.teams || [], selectedLeague?.id || null);
  let awayTeam = resolveEventTeam(parsedEvent.awayRaw, catalog?.teams || [], selectedLeague?.id || null);
  let league = selectedLeague;

  if (!league) {
    const inferredPair = inferEventTeamPairAndLeague(
      parsedEvent.homeRaw,
      parsedEvent.awayRaw,
      catalog?.teams || [],
      catalog?.leagues || []
    );

    if (inferredPair.ambiguous) {
      errors.push(
        `League auto-detect is ambiguous for "${parsedEvent.homeRaw} vs ${parsedEvent.awayRaw}". Select league explicitly.`
      );
    } else if (inferredPair.homeTeam && inferredPair.awayTeam && inferredPair.league) {
      if (!homeTeam.team) {
        homeTeam = { team: inferredPair.homeTeam, error: null };
      }
      if (!awayTeam.team) {
        awayTeam = { team: inferredPair.awayTeam, error: null };
      }
      league = inferredPair.league;
      info.push(`Auto-detected league from teams: ${league.name} (${league.key}).`);
    }
  }

  if (!homeTeam.team) {
    errors.push(homeTeam.error || `Home team \"${parsedEvent.homeRaw}\" is not found in teams.csv.`);
  }

  if (!awayTeam.team) {
    errors.push(awayTeam.error || `Away team \"${parsedEvent.awayRaw}\" is not found in teams.csv.`);
  }

  if (homeTeam.team && awayTeam.team && String(homeTeam.team.id) === String(awayTeam.team.id)) {
    errors.push("Home and away teams cannot be the same.");
  }

  if (!league && homeTeam.team && awayTeam.team) {
    if (String(homeTeam.team.leagueId || "") !== String(awayTeam.team.leagueId || "")) {
      errors.push(
        `Teams belong to different leagues (${homeTeam.team.leagueId} vs ${awayTeam.team.leagueId}). Select league explicitly.`
      );
    } else {
      league = findLeagueById(catalog?.leagues || [], String(homeTeam.team.leagueId || ""));
      if (!league) {
        errors.push(`League \"${homeTeam.team.leagueId}\" for event teams is not present in leagues.csv.`);
      }
    }
  }

  if (!league) {
    errors.push("League could not be resolved. Select a league from the dropdown.");
  }

  if (errors.length > 0) {
    return {
      ok: false,
      errors,
      warnings,
      info,
      fixtureJson: null,
      parentPayload: null,
    };
  }

  const inference = {
    leagueSelectValue: league.key,
    leagueId: league.id,
    homeTeamName: homeTeam.team.name,
    awayTeamName: awayTeam.team.name,
    homeTeamMeta: homeTeam.team,
    awayTeamMeta: awayTeam.team,
    fixtureDate,
    kickoffTimeUtc,
    matchDay,
    matchWeek,
    location,
    venue,
  };

  const bundle = collectFixtureBundleFromInference(inference, {
    leagues: catalog?.leagues || [],
    teams: catalog?.teams || [],
  });

  if (!bundle || !bundle.fixtureJson || !bundle.meta) {
    return {
      ok: false,
      errors: ["Failed to build fixture bundle from event input."],
      warnings,
      info,
      fixtureJson: null,
      parentPayload: null,
    };
  }

  let parentPayload;
  try {
    parentPayload = buildParentMarketPayload(bundle.meta, typeReferenceId || null);
  } catch (error) {
    return {
      ok: false,
      errors: [`Failed to build parent market payload: ${String(error?.message || error)}`],
      warnings,
      info,
      fixtureJson: bundle.fixtureJson,
      parentPayload: null,
    };
  }

  const current = input?.now instanceof Date ? input.now : null;
  const fixtureCheck = verifyFixtureJsonStrict(bundle.fixtureJson, catalog);
  const parentCheck = verifyParentMarketJsonStrict(parentPayload, catalog, {
    fixture: bundle.fixtureJson,
    fixtureResolved: fixtureCheck,
    now: current,
  });

  errors.push(...fixtureCheck.errors, ...parentCheck.errors);
  warnings.push(...fixtureCheck.warnings, ...parentCheck.warnings);
  info.push(...fixtureCheck.info, ...parentCheck.info);

  if (errors.length === 0) {
    info.unshift("Generated fixture and parent market JSON passed strict CSV verification.");
  }

  return {
    ok: errors.length === 0,
    errors,
    warnings,
    info,
    fixtureJson: bundle.fixtureJson,
    parentPayload,
    fixtureCheck,
    parentCheck,
  };
}

export function generateVaultPayloadFromInput(input, catalog) {
  const errors = [];
  const warnings = [];
  const info = [];

  const rawFixtureName = String(input?.fixtureName || "").trim();
  const explicitPrefix = String(input?.marketPrefix || "").trim();
  const explicitMarketIdRaw = String(input?.marketId || "").trim();
  const selectedLeagueCode = normalizeVaultSegment(String(input?.leagueCode || "").trim());
  const yesTokenId = normalizeVaultTokenId(input?.yesTokenId);
  const noTokenId = normalizeVaultTokenId(input?.noTokenId);
  const parsedMarketId = normalizeVaultMarketId(explicitMarketIdRaw);

  if (!yesTokenId) {
    errors.push("YES token ID is required and must be a numeric string.");
  }
  if (!noTokenId) {
    errors.push("NO token ID is required and must be a numeric string.");
  }
  if (yesTokenId && noTokenId && yesTokenId === noTokenId) {
    errors.push("YES and NO token IDs must be different.");
  }
  if (!selectedLeagueCode) {
    errors.push("League code is required for vault naming format.");
  }
  if (parsedMarketId.error) {
    errors.push(parsedMarketId.error);
  }

  const parsedFixture = parseVaultFixtureAndPrefix(rawFixtureName);
  if (!parsedFixture) {
    errors.push("Fixture Name must include a match in 'Home Team vs Away Team' format.");
  }

  if (errors.length > 0) {
    return {
      ok: false,
      errors,
      warnings,
      info,
      payload: null,
    };
  }

  const year = extractYearFromText(rawFixtureName) || new Date().getUTCFullYear();
  const homeCode = deriveVaultTeamCode(parsedFixture.homeRaw);
  const awayCode = deriveVaultTeamCode(parsedFixture.awayRaw);
  const prefix = normalizeVaultSegment(explicitPrefix || parsedFixture.prefix || homeCode);
  const allowedPrefixes = new Set([homeCode, awayCode, "DRAW"]);

  if (!allowedPrefixes.has(prefix)) {
    errors.push(`Name Prefix must be one of: ${homeCode}, ${awayCode}, DRAW.`);
    return {
      ok: false,
      errors,
      warnings,
      info,
      payload: null,
    };
  }

  const marketName = `${prefix}_${homeCode}_vs_${awayCode}_${selectedLeagueCode}_${year}`;
  const marketId = parsedMarketId.value || deriveVaultMarketId(marketName, yesTokenId, noTokenId);

  const payload = {
    market_name: marketName,
    market: {
      question: marketName,
      status: "active",
      outcomes: {
        YES: { token_id: yesTokenId },
        NO: { token_id: noTokenId },
      },
      pred_mapping: {
        market_id: marketId,
      },
    },
  };

  info.push(`Vault name generated: ${marketName}`);
  if (parsedMarketId.value) {
    info.push("Using user-provided market_id override.");
  } else {
    info.push("market_id was not provided; generated deterministic fallback market_id.");
  }
  info.push("Vault formatter uses raw fixture text and selected league code (no CSV validation).");

  return {
    ok: true,
    errors,
    warnings,
    info,
    payload,
  };
}

export function generateBulkVaultPayloadsFromInput(input, catalog) {
  const errors = [];
  const warnings = [];
  const info = [];

  const parsed = parseVaultBulkRows(input?.rowsText || "");
  errors.push(...parsed.errors);
  info.push(...parsed.info);
  applyVaultSupplementalMappings(parsed.rows, input?.mappingText || "", errors, warnings, info);

  if (errors.length > 0) {
    return {
      ok: false,
      errors,
      warnings,
      info,
      payloads: [],
    };
  }

  const payloads = [];

  for (const row of parsed.rows) {
    if (row.sourceFormat === "vault-api-json") {
      if (!row.fixtureName || !row.leagueCode) {
        errors.push(
          `Row ${row.rowNumber} (${row.parentMarketId || row.marketId || "Vault Market"}): vault API JSON does not include fixture_name or league_code. Add a supplemental mapping table keyed by market_id.`
        );
        continue;
      }
      if (!row.marketPrefix) {
        errors.push(
          `Row ${row.rowNumber} (${row.parentMarketId || row.marketId || "Vault Market"}): vault API JSON requires market_prefix in the supplemental mapping so each market name is generated accurately.`
        );
        continue;
      }
    }

    const result = generateVaultPayloadFromInput(
      {
        fixtureName: row.fixtureName,
        yesTokenId: row.yesTokenId,
        noTokenId: row.noTokenId,
        leagueCode: row.leagueCode,
        marketId: row.marketId,
        marketPrefix: row.marketPrefix,
      },
      catalog
    );

    if (!result.ok || !result.payload) {
      for (const line of result.errors) {
        errors.push(`Row ${row.rowNumber} (${row.fixtureName || "Vault Row"}): ${line}`);
      }
      warnings.push(...result.warnings.map((line) => `Row ${row.rowNumber} (${row.fixtureName || "Vault Row"}): ${line}`));
      continue;
    }

    payloads.push(result.payload);
    warnings.push(...result.warnings.map((line) => `Row ${row.rowNumber} (${row.fixtureName}): ${line}`));
    info.push(...result.info.map((line) => `Row ${row.rowNumber} (${row.fixtureName}): ${line}`));
  }

  if (payloads.length > 0) {
    info.unshift(`Generated ${payloads.length} vault payload(s) from bulk input.`);
  }

  return {
    ok: errors.length === 0 && payloads.length > 0,
    errors: uniqueStrings(errors),
    warnings: uniqueStrings(warnings),
    info: uniqueStrings(info),
    payloads,
  };
}

function applyVaultSupplementalMappings(rows, rawMappingText, errors, warnings, info) {
  const text = String(rawMappingText || "").trim();
  if (!text) {
    return;
  }

  const parsed = parseVaultSupplementalRows(text);
  if (parsed.errors.length > 0) {
    errors.push(...parsed.errors.map((line) => `Vault Mapping File: ${line}`));
    return;
  }

  info.push(...parsed.info.map((line) => `Vault Mapping File: ${line}`));

  const rowsByMarketId = new Map();
  for (const row of rows || []) {
    const marketId = String(row?.marketId || "").trim().toLowerCase();
    if (!marketId) {
      continue;
    }
    rowsByMarketId.set(marketId, row);
  }

  let applied = 0;
  const unmatched = [];
  for (const mappingRow of parsed.rows) {
    const marketId = String(mappingRow.marketId || "").trim().toLowerCase();
    const target = rowsByMarketId.get(marketId);
    if (!target) {
      unmatched.push(mappingRow.marketId);
      continue;
    }

    if (!target.fixtureName && mappingRow.fixtureName) {
      target.fixtureName = mappingRow.fixtureName;
    }
    if (!target.leagueCode && mappingRow.leagueCode) {
      target.leagueCode = mappingRow.leagueCode;
    }
    if (!target.marketPrefix && mappingRow.marketPrefix) {
      target.marketPrefix = mappingRow.marketPrefix;
    }
    if (!target.parentMarketId && mappingRow.parentMarketId) {
      target.parentMarketId = mappingRow.parentMarketId;
    }
    applied += 1;
  }

  info.push(`Applied ${applied} vault mapping row(s) by market_id.`);

  for (const marketId of unmatched) {
    errors.push(`Vault Mapping File: market_id "${marketId}" did not match any vault bulk row.`);
  }

  const stillMissing = (rows || []).filter((row) => row.sourceFormat === "vault-api-json" && (!row.fixtureName || !row.leagueCode || !row.marketPrefix));
  if (stillMissing.length > 0) {
    warnings.push(
      `Vault Mapping File: ${stillMissing.length} vault API row(s) still need fixture_name, league_code, or market_prefix after mapping.`
    );
  }
}

function validateTeamMarket(market, team, sideLabel, errors, warnings) {
  if (normalizeForSearch(market.name) !== normalizeForSearch(team.name)) {
    errors.push(`${sideLabel} market name must be \"${team.name}\".`);
  }

  const expectedCode = String(team.code || "").trim().toUpperCase();
  const marketCode = String(market.market_code || "").trim().toUpperCase();
  if (expectedCode && marketCode !== expectedCode) {
    errors.push(`${sideLabel} market_code must be \"${expectedCode}\".`);
  }

  const expectedAlt = String(team.alternateName || team.name || "").trim();
  if (String(market.alternate_name || "").trim() && normalizeForSearch(market.alternate_name) !== normalizeForSearch(expectedAlt)) {
    warnings.push(`${sideLabel} market alternate_name differs from CSV alternate_name \"${expectedAlt}\".`);
  }

  if (String(market.logo_url || "").trim() && String(team.logoUrl || "").trim() && String(market.logo_url || "").trim() !== String(team.logoUrl || "").trim()) {
    warnings.push(`${sideLabel} market logo_url differs from teams.csv logo_url.`);
  }

  if (String(market.theme_color || "").trim() && String(team.themeColor || "").trim()) {
    if (String(market.theme_color || "").trim().toUpperCase() !== String(team.themeColor || "").trim().toUpperCase()) {
      warnings.push(`${sideLabel} market theme_color differs from teams.csv theme_color.`);
    }
  }
}

function findLeagueById(leagues, id) {
  const target = String(id || "").trim();
  if (!target) {
    return null;
  }
  return (leagues || []).find((league) => String(league?.id || "").trim() === target) || null;
}

function resolveLeagueSelection(leagues, selection) {
  const value = String(selection || "").trim();
  if (!value) {
    return null;
  }

  const byId = (leagues || []).find((league) => String(league?.id || "").trim() === value);
  if (byId) {
    return byId;
  }

  const normalized = normalizeForSearch(value);
  if (!normalized) {
    return null;
  }

  return (
    (leagues || []).find((league) => normalizeForSearch(league?.key) === normalized) ||
    (leagues || []).find((league) => normalizeForSearch(league?.name) === normalized) ||
    null
  );
}

function findTeamById(teams, id) {
  const target = String(id || "").trim();
  if (!target) {
    return null;
  }
  return (teams || []).find((team) => String(team?.id || "").trim() === target) || null;
}

function inferHomeTeamFromMarkets(markets, teams) {
  const teamIds = (markets || [])
    .map((market) => String(market?.team_id || "").trim())
    .filter(Boolean);

  if (!teamIds.length) {
    return null;
  }

  const firstId = teamIds[0];
  return findTeamById(teams, firstId);
}

function inferAwayTeamFromMarkets(markets, teams, homeTeamId) {
  const teamIds = (markets || [])
    .map((market) => String(market?.team_id || "").trim())
    .filter(Boolean);

  const candidateId = teamIds.find((id) => id !== String(homeTeamId || ""));
  if (!candidateId) {
    return null;
  }
  return findTeamById(teams, candidateId);
}

function parseIsoDate(value) {
  const text = String(value || "").trim();
  if (!text) {
    return null;
  }
  const parsed = new Date(text);
  if (Number.isNaN(parsed.getTime())) {
    return null;
  }
  return parsed;
}

function deriveFixtureDateIsoForExpectedParent(parent, markets, closeDate, warnings) {
  const byDescription = extractFixtureDateFromDescription(parent?.description);
  const byParentCanonical = extractTrailingIsoDate(parent?.parent_market_canonical_name);
  const byMarketCanonical = collectMarketCanonicalDates(markets);

  if (byDescription) {
    return byDescription;
  }
  if (byParentCanonical) {
    return byParentCanonical;
  }
  if (byMarketCanonical.primary) {
    if (byMarketCanonical.values.length > 1) {
      warnings.push(
        `Multiple fixture dates found in market_canonical_name values (${byMarketCanonical.values.join(", ")}). Using "${byMarketCanonical.primary}".`
      );
    }
    return byMarketCanonical.primary;
  }

  const fallback = closeDate.toISOString().slice(0, 10);
  warnings.push(`Could not infer fixture date from parent payload text/canonical fields. Falling back to ${fallback}.`);
  return fallback;
}

function extractFixtureDateFromDescription(description) {
  const text = String(description || "");
  const match = text.match(/\((\d{4}-\d{2}-\d{2})\)/);
  if (!match) {
    return null;
  }
  return isIsoCalendarDate(match[1]) ? match[1] : null;
}

function extractTrailingIsoDate(value) {
  const text = String(value || "").trim();
  const match = text.match(/(\d{4}-\d{2}-\d{2})$/);
  if (!match) {
    return null;
  }
  return isIsoCalendarDate(match[1]) ? match[1] : null;
}

function collectMarketCanonicalDates(markets) {
  const values = [];
  const seen = new Set();

  for (const market of markets || []) {
    const date = extractTrailingIsoDate(market?.market_canonical_name);
    if (!date || seen.has(date)) {
      continue;
    }
    seen.add(date);
    values.push(date);
  }

  return {
    primary: values[0] || null,
    values,
  };
}

function isIsoCalendarDate(value) {
  return /^\d{4}-\d{2}-\d{2}$/.test(String(value || "").trim());
}

function parseEventName(eventName) {
  const text = String(eventName || "").trim().replace(/\s+/g, " ");
  if (!text) {
    return null;
  }

  const match = text.match(/^(.+?)\s+(?:vs\.?|v\.?|\-|–|—)\s+(.+)$/i);
  if (!match) {
    return null;
  }

  return {
    homeRaw: String(match[1] || "").trim(),
    awayRaw: String(match[2] || "").trim(),
  };
}

function parseVaultBulkRows(rawInput) {
  const errors = [];
  const info = [];
  const apiPayloadRows = parseVaultApiJsonRows(rawInput);
  if (apiPayloadRows) {
    info.push(`Parsed ${apiPayloadRows.rows.length} vault market row(s) from JSON response payload.`);
    return {
      rows: apiPayloadRows.rows,
      errors,
      info,
    };
  }

  const lines = String(rawInput || "")
    .split(/\r?\n/)
    .map((line) => line.replace(/\uFEFF/g, ""))
    .filter((line) => line.trim().length > 0);

  if (!lines.length) {
    errors.push("Vault bulk input is empty.");
    return { rows: [], errors, info };
  }

  const format = detectBulkTableFormat(lines);
  const table = lines
    .map((line) => parseBulkTableLine(line, format))
    .filter((cells) => Array.isArray(cells) && cells.some((cell) => String(cell || "").trim()));

  if (format === "pipe") {
    while (table.length > 1 && isPipeDividerRow(table[1])) {
      table.splice(1, 1);
    }
  }

  if (table.length < 2) {
    errors.push("Vault bulk input must include a header row and at least one data row.");
    return { rows: [], errors, info };
  }

  const headers = table[0].map((cell) => normalizeVaultBulkHeader(cell));
  const required = ["fixtureName", "yesTokenId", "noTokenId", "leagueCode"];
  for (const key of required) {
    if (!headers.includes(key)) {
      errors.push(`Vault bulk input is missing required column "${key}".`);
    }
  }
  if (errors.length > 0) {
    return { rows: [], errors, info };
  }

  const rows = [];
  for (let index = 1; index < table.length; index += 1) {
    const cells = table[index];
    if (isPipeDividerRow(cells)) {
      continue;
    }
    const record = {};
    for (let cellIndex = 0; cellIndex < headers.length; cellIndex += 1) {
      record[headers[cellIndex]] = String(cells[cellIndex] || "").trim();
    }
    rows.push({
      rowNumber: index + 1,
      fixtureName: String(record.fixtureName || "").trim(),
      yesTokenId: String(record.yesTokenId || "").trim(),
      noTokenId: String(record.noTokenId || "").trim(),
      leagueCode: String(record.leagueCode || "").trim(),
      marketId: String(record.marketId || "").trim(),
      marketPrefix: String(record.marketPrefix || "").trim(),
      parentMarketId: String(record.parentMarketId || "").trim(),
      sourceFormat: "tabular",
    });
  }

  info.push(`Parsed ${rows.length} vault bulk row(s) from ${format.toUpperCase()} input.`);
  return { rows, errors, info };
}

function normalizeVaultBulkHeader(value) {
  const raw = String(value || "").trim().toLowerCase();
  const key = raw.replace(/[^a-z0-9]+/g, "");
  const aliases = {
    fixtureName: ["fixturename", "fixture", "name", "eventname", "fixture_name"],
    yesTokenId: ["yestokenid", "yes", "yesid", "yestoken"],
    noTokenId: ["notokenid", "no", "noid", "notoken"],
    leagueCode: ["leaguecode", "league", "league_key"],
    marketId: ["marketid", "market_id"],
    parentMarketId: ["parentmarketid", "parent_market_id"],
    marketPrefix: ["marketprefix", "prefix", "nameprefix", "name_prefix"],
  };

  for (const [canonical, keys] of Object.entries(aliases)) {
    if (keys.includes(key)) {
      return canonical;
    }
  }

  return key || raw;
}

function parseVaultApiJsonRows(rawInput) {
  const text = String(rawInput || "").trim();
  if (!text.startsWith("{")) {
    return null;
  }

  try {
    const parsed = JSON.parse(text);
    const markets = Array.isArray(parsed?.data?.markets) ? parsed.data.markets : null;
    if (!markets) {
      return null;
    }

    return {
      rows: markets.map((item, index) => ({
        rowNumber: index + 1,
        fixtureName: "",
        yesTokenId: String(item?.PolyTokenID || "").trim(),
        noTokenId: String(item?.PolyNoTokenID || "").trim(),
        leagueCode: "",
        marketId: String(item?.MarketID || "").trim(),
        parentMarketId: String(item?.ParentMarketID || "").trim(),
        marketPrefix: "",
        sourceFormat: "vault-api-json",
      })),
    };
  } catch {
    return null;
  }
}

function parseVaultSupplementalRows(rawInput) {
  const errors = [];
  const info = [];
  const lines = String(rawInput || "")
    .split(/\r?\n/)
    .map((line) => line.replace(/\uFEFF/g, ""))
    .filter((line) => line.trim().length > 0);

  if (!lines.length) {
    return { rows: [], errors, info };
  }

  const format = detectBulkTableFormat(lines);
  const table = lines
    .map((line) => parseBulkTableLine(line, format))
    .filter((cells) => Array.isArray(cells) && cells.some((cell) => String(cell || "").trim()));

  if (format === "pipe") {
    while (table.length > 1 && isPipeDividerRow(table[1])) {
      table.splice(1, 1);
    }
  }

  if (table.length < 2) {
    errors.push("Vault mapping input must include a header row and at least one data row.");
    return { rows: [], errors, info };
  }

  const headers = table[0].map((cell) => normalizeVaultBulkHeader(cell));
  for (const required of ["marketId", "fixtureName", "leagueCode", "marketPrefix"]) {
    if (!headers.includes(required)) {
      errors.push(`Vault mapping input is missing required column "${required}".`);
    }
  }
  if (errors.length > 0) {
    return { rows: [], errors, info };
  }

  const seenMarketIds = new Map();
  const rows = [];
  for (let index = 1; index < table.length; index += 1) {
    const cells = table[index];
    if (isPipeDividerRow(cells)) {
      continue;
    }

    const record = {};
    for (let cellIndex = 0; cellIndex < headers.length; cellIndex += 1) {
      record[headers[cellIndex]] = String(cells[cellIndex] || "").trim();
    }

    const marketId = String(record.marketId || "").trim();
    if (!marketId) {
      errors.push(`Vault mapping row ${index + 1}: market_id is required.`);
      continue;
    }
    const duplicateRow = seenMarketIds.get(marketId.toLowerCase());
    if (duplicateRow) {
      errors.push(`Vault mapping row ${index + 1}: market_id "${marketId}" duplicates row ${duplicateRow}.`);
      continue;
    }
    seenMarketIds.set(marketId.toLowerCase(), index + 1);

    rows.push({
      rowNumber: index + 1,
      marketId,
      parentMarketId: String(record.parentMarketId || "").trim(),
      fixtureName: String(record.fixtureName || "").trim(),
      leagueCode: String(record.leagueCode || "").trim(),
      marketPrefix: String(record.marketPrefix || "").trim(),
    });
  }

  info.push(`Parsed ${rows.length} vault mapping row(s) from ${format.toUpperCase()} input.`);
  return { rows, errors, info };
}

function detectBulkTableFormat(lines) {
  const first = String(lines[0] || "");
  if (first.includes("\t")) {
    return "tsv";
  }
  if (first.includes("|")) {
    return "pipe";
  }
  return "csv";
}

function parseBulkTableLine(line, format) {
  const text = String(line || "");
  if (format === "tsv") {
    return text.split("\t").map((cell) => cell.trim());
  }
  if (format === "pipe") {
    const trimmed = text.trim().replace(/^\|/, "").replace(/\|$/, "");
    return trimmed.split("|").map((cell) => cell.trim());
  }
  return parseCsvCells(text);
}

function parseCsvCells(line) {
  const cells = [];
  let current = "";
  let inQuotes = false;

  for (let index = 0; index < line.length; index += 1) {
    const ch = line[index];
    if (ch === '"') {
      const next = line[index + 1];
      if (inQuotes && next === '"') {
        current += '"';
        index += 1;
        continue;
      }
      inQuotes = !inQuotes;
      continue;
    }
    if (ch === "," && !inQuotes) {
      cells.push(current.trim());
      current = "";
      continue;
    }
    current += ch;
  }

  cells.push(current.trim());
  return cells;
}

function isPipeDividerRow(cells) {
  return (cells || []).every((cell) => /^:?-{3,}:?$/.test(String(cell || "").trim()));
}

function uniqueStrings(items) {
  return Array.from(new Set((items || []).filter(Boolean)));
}

function parseVaultFixtureAndPrefix(rawFixtureName) {
  const text = String(rawFixtureName || "").trim();
  if (!text) {
    return null;
  }

  const withPrefix = text.match(/^([a-z0-9]+)\s*[:|]\s*(.+)$/i);
  if (withPrefix) {
    const parsed = parseEventName(withPrefix[2]);
    if (!parsed) {
      return null;
    }
    return {
      ...parsed,
      prefix: withPrefix[1],
    };
  }

  const parsed = parseEventName(text);
  if (!parsed) {
    return null;
  }
  return {
    ...parsed,
    prefix: null,
  };
}

function normalizeVaultTokenId(value) {
  const token = String(value || "").trim();
  if (!/^\d{8,120}$/.test(token)) {
    return "";
  }
  return token;
}

function normalizeVaultMarketId(value) {
  const raw = String(value || "").trim();
  if (!raw) {
    return { value: "", error: null };
  }
  if (!/^0x[0-9a-fA-F]{64}$/.test(raw)) {
    return {
      value: "",
      error: "Market ID must be a 0x-prefixed 64-hex string when provided.",
    };
  }
  return { value: `0x${raw.slice(2).toLowerCase()}`, error: null };
}

function extractYearFromText(value) {
  const match = String(value || "").match(/\b(19|20)\d{2}\b/);
  if (!match) {
    return null;
  }
  return Number.parseInt(match[0], 10);
}

function normalizeVaultSegment(value) {
  return String(value || "")
    .trim()
    .toUpperCase()
    .replace(/[^A-Z0-9]+/g, "_")
    .replace(/^_+|_+$/g, "") || "NA";
}

function deriveVaultMarketId(marketName, yesTokenId, noTokenId) {
  const seed = `${marketName}|${yesTokenId}|${noTokenId}`;
  let h1 = 0x811c9dc5;
  let h2 = 0x9e3779b9;
  let h3 = 0x85ebca6b;
  let h4 = 0xc2b2ae35;

  for (let i = 0; i < seed.length; i += 1) {
    const code = seed.charCodeAt(i);
    h1 = Math.imul(h1 ^ code, 16777619);
    h2 = Math.imul(h2 ^ code, 2246822519);
    h3 = Math.imul(h3 ^ code, 3266489917);
    h4 = Math.imul(h4 ^ code, 668265263);
  }

  const hexPart = (n) => (n >>> 0).toString(16).padStart(8, "0");
  let hex = `${hexPart(h1)}${hexPart(h2)}${hexPart(h3)}${hexPart(h4)}`;

  while (hex.length < 64) {
    h1 = Math.imul(h1 ^ h4, 1597334677);
    h2 = Math.imul(h2 ^ h1, 3812015801);
    h3 = Math.imul(h3 ^ h2, 3266489917);
    h4 = Math.imul(h4 ^ h3, 668265263);
    hex += `${hexPart(h1)}${hexPart(h2)}${hexPart(h3)}${hexPart(h4)}`;
  }

  return `0x${hex.slice(0, 64)}`;
}

function deriveVaultTeamCode(rawName) {
  const raw = String(rawName || "").trim();
  if (!raw) {
    return "TEAM";
  }

  const compact = raw.toUpperCase().replace(/[^A-Z0-9]/g, "");
  if (/^[A-Z0-9]{2,6}$/.test(compact) && !/\s/.test(raw)) {
    return compact;
  }

  return normalizeVaultSegment(generateCodeFromName(raw));
}

function resolveEventTeam(rawName, teams, leagueId) {
  const scoped = findExactTeamForLeague(rawName, teams || [], leagueId || null);
  if (scoped) {
    return { team: scoped, error: null };
  }

  const scopedByCode = findTeamByExactCode(rawName, teams || [], leagueId || null);
  if (scopedByCode.ambiguous) {
    return {
      team: null,
      error: `Team code "${String(rawName || "").trim()}" maps to multiple teams. Enter full team name or select league explicitly.`,
    };
  }
  if (scopedByCode.team) {
    return { team: scopedByCode.team, error: null };
  }

  if (leagueId) {
    return {
      team: null,
      error: `Team \"${rawName}\" is not mapped in teams.csv for selected league_id \"${leagueId}\".`,
    };
  }

  const global = findExactTeamForLeague(rawName, teams || [], null);
  if (global) {
    return { team: global, error: null };
  }

  const globalByCode = findTeamByExactCode(rawName, teams || [], null);
  if (globalByCode.ambiguous) {
    return {
      team: null,
      error: `Team code "${String(rawName || "").trim()}" maps to multiple teams across leagues. Use full team name.`,
    };
  }
  if (globalByCode.team) {
    return { team: globalByCode.team, error: null };
  }

  return {
    team: null,
    error: `Team \"${rawName}\" is not mapped in teams.csv.`,
  };
}

function inferEventTeamPairAndLeague(homeRawName, awayRawName, teams, leagues) {
  const homeCandidates = collectEventTeamCandidates(homeRawName, teams || []);
  const awayCandidates = collectEventTeamCandidates(awayRawName, teams || []);

  if (!homeCandidates.length || !awayCandidates.length) {
    return {
      homeTeam: null,
      awayTeam: null,
      league: null,
      ambiguous: false,
    };
  }

  const pairs = [];
  const seen = new Set();

  for (const homeTeam of homeCandidates) {
    for (const awayTeam of awayCandidates) {
      if (String(homeTeam?.id || "") === String(awayTeam?.id || "")) {
        continue;
      }

      const homeLeagueId = String(homeTeam?.leagueId || "").trim();
      const awayLeagueId = String(awayTeam?.leagueId || "").trim();
      if (!homeLeagueId || homeLeagueId !== awayLeagueId) {
        continue;
      }

      const league = findLeagueById(leagues || [], homeLeagueId);
      if (!league) {
        continue;
      }

      const key = `${homeTeam.id}|${awayTeam.id}|${league.id}`;
      if (seen.has(key)) {
        continue;
      }
      seen.add(key);

      const score =
        getTeamCandidateMatchScore(homeRawName, homeTeam) +
        getTeamCandidateMatchScore(awayRawName, awayTeam);

      pairs.push({
        homeTeam,
        awayTeam,
        league,
        score,
      });
    }
  }

  if (!pairs.length) {
    return {
      homeTeam: null,
      awayTeam: null,
      league: null,
      ambiguous: false,
    };
  }

  pairs.sort((a, b) => {
    if (b.score !== a.score) {
      return b.score - a.score;
    }
    const aKey = `${a.homeTeam.id}|${a.awayTeam.id}|${a.league.id}`;
    const bKey = `${b.homeTeam.id}|${b.awayTeam.id}|${b.league.id}`;
    return aKey.localeCompare(bKey);
  });

  const bestScore = pairs[0].score;
  const bestPairs = pairs.filter((pair) => pair.score === bestScore);
  if (bestPairs.length === 1) {
    return {
      homeTeam: bestPairs[0].homeTeam,
      awayTeam: bestPairs[0].awayTeam,
      league: bestPairs[0].league,
      ambiguous: false,
    };
  }

  const uniqueLeagues = new Set(bestPairs.map((pair) => pair.league.id));
  if (uniqueLeagues.size === 1) {
    return {
      homeTeam: bestPairs[0].homeTeam,
      awayTeam: bestPairs[0].awayTeam,
      league: bestPairs[0].league,
      ambiguous: false,
    };
  }

  return {
    homeTeam: null,
    awayTeam: null,
    league: null,
    ambiguous: true,
  };
}

function collectEventTeamCandidates(rawName, teams) {
  const normalized = normalizeForSearch(rawName);
  const normalizedCode = normalizeCode(rawName);
  if (!normalized && !normalizedCode) {
    return [];
  }

  const out = [];
  const seen = new Set();

  for (const team of teams || []) {
    const aliases = Array.isArray(team?.aliases) && team.aliases.length
      ? team.aliases
      : [team?.name, team?.alternateName].filter(Boolean);

    const aliasMatch = normalized
      ? aliases.some((alias) => normalizeForSearch(alias) === normalized)
      : false;
    const codeMatch = normalizedCode && normalizeCode(team?.code) === normalizedCode;

    if (!aliasMatch && !codeMatch) {
      continue;
    }

    const key = String(team?.id || `${team?.name || ""}:${team?.leagueId || ""}`);
    if (seen.has(key)) {
      continue;
    }
    seen.add(key);
    out.push(team);
  }

  return out;
}

function getTeamCandidateMatchScore(rawName, team) {
  const normalized = normalizeForSearch(rawName);
  const teamNameNorm = normalizeForSearch(team?.name);
  if (normalized && teamNameNorm && normalized === teamNameNorm) {
    return 3;
  }

  const rawCode = normalizeCode(rawName);
  const teamCode = normalizeCode(team?.code);
  if (rawCode && teamCode && rawCode === teamCode) {
    return 2;
  }

  const aliases = Array.isArray(team?.aliases) && team.aliases.length
    ? team.aliases
    : [team?.name, team?.alternateName].filter(Boolean);
  const aliasExact = aliases.some((alias) => normalizeForSearch(alias) === normalized);
  if (aliasExact) {
    return 1;
  }

  return 0;
}

function findTeamByExactCode(rawName, teams, leagueId = null) {
  const normalized = normalizeCode(rawName);
  if (!normalized) {
    return { team: null, ambiguous: false };
  }

  const candidates = (teams || []).filter((team) => !leagueId || String(team?.leagueId || "") === String(leagueId || ""));
  const matches = candidates.filter((team) => normalizeCode(team?.code) === normalized);

  if (!matches.length) {
    return { team: null, ambiguous: false };
  }
  if (matches.length === 1) {
    return { team: matches[0], ambiguous: false };
  }
  return { team: null, ambiguous: true };
}

function normalizeCode(value) {
  return String(value || "")
    .trim()
    .toUpperCase()
    .replace(/[^A-Z0-9]/g, "");
}
