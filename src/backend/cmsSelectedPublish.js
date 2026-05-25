import { InvalidIntegrationPayloadError, redactSecrets } from "./publisherCore.js";
import { getSportDefinition, getDefaultSportCode } from "../shared/sportRegistry.js";

export const CMS_SELECTED_PUBLISHABLE_KEYS = Object.freeze([
  "moneyline|0",
  "btts|0",
  "totals|0.5",
  "totals|1.5",
  "totals|2.5",
  "totals|3.5",
  "totals|4.5",
  "totals|5.5",
  "spreads|1.5|home",
  "spreads|1.5|away",
  "spreads|2.5|home",
  "spreads|2.5|away",
]);

const CMS_SELECTED_PUBLISHABLE_KEY_SET = new Set(CMS_SELECTED_PUBLISHABLE_KEYS);
const CMS_PARENT_MARKET_EXPECTED_COUNTS = Object.freeze({
  "moneyline|0": 3,
  "btts|0": 1,
  "totals|0.5": 1,
  "totals|1.5": 1,
  "totals|2.5": 1,
  "totals|3.5": 1,
  "totals|4.5": 1,
  "totals|5.5": 1,
  "spreads|1.5|home": 1,
  "spreads|1.5|away": 1,
  "spreads|2.5|home": 1,
  "spreads|2.5|away": 1,
});

// Shape regex for sports with operator-picked lines (NBA/NFL). Matches
// moneyline|0, totals|<num>, spreads|<num>|home, spreads|<num>|away.
// Number may be an integer or decimal (e.g. 216, 11.5, 222.5).
const CUSTOM_LINE_PUBLISH_KEY_RE =
  /^(moneyline\|0|totals\|\d+(?:\.\d+)?|spreads\|\d+(?:\.\d+)?\|(?:home|away))$/;

/**
 * Validates a publish key. Soccer (and the legacy default) uses a strict
 * whitelist of 10 keys. Custom-line sports (NBA/NFL) accept any (family, line,
 * side?) tuple that matches the canonical shape.
 *
 * Backwards-compatible: callers that don't pass `sport` get the legacy
 * whitelist check.
 */
export function isSupportedCmsPublishKey(value, { sport } = {}) {
  const normalized = String(value || "")
    .trim()
    .toLowerCase();
  if (!normalized) return false;
  const sportCode =
    String(sport || "")
      .trim()
      .toLowerCase() || getDefaultSportCode();
  const sportDef = getSportDefinition(sportCode);
  if (sportDef?.submarketCatalog?.customLines) {
    return CUSTOM_LINE_PUBLISH_KEY_RE.test(normalized);
  }
  return CMS_SELECTED_PUBLISHABLE_KEY_SET.has(normalized);
}

export function normalizeCmsSelectedFixture(value = {}) {
  const source = value && typeof value === "object" ? value : {};
  return {
    game_id: String(source.game_id || source.gameId || "").trim(),
    event_name: String(source.event_name || source.eventName || "").trim(),
    fixture_date: String(source.fixture_date || source.fixtureDate || "").trim(),
    kickoff_time_utc: String(source.kickoff_time_utc || source.kickoffTimeUtc || "").trim(),
    league_code: String(source.league_code || source.leagueCode || "")
      .trim()
      .toLowerCase(),
    // Schedule-provider key (e.g. "sportsdata", "lsports-db", "polymarket"). Optional.
    // When set to a value that mapProviderToCmsSource recognizes, executeCmsSelectedPublish
    // collapses the legacy 3-step + 2-poll publish flow into a single fixtures/create call.
    provider: String(source.provider || source.source || "")
      .trim()
      .toLowerCase(),
    // Polymarket coordinates for the post-publish vault sync hook. The
    // orchestrator builds polymarket_url from polymarket_event_id when the
    // URL isn't supplied. Both empty for non-Polymarket fixtures (vault sync
    // skipped).
    polymarket_url: String(source.polymarket_url || source.polymarketUrl || "").trim(),
    polymarket_event_id: String(
      source.polymarket_event_id || source.polymarketEventId || ""
    ).trim(),
  };
}

export function normalizeCmsSelectedPublishEnvelope(payload = {}) {
  const data = payload && typeof payload === "object" ? payload : {};
  const selectedFixture = normalizeCmsSelectedFixture(data.selected_fixture);
  const manualQuery = String(data.manual_query || data.manualQuery || "").trim();
  const providedTypeReferenceId = String(
    data.type_reference_id || data.typeReferenceId || ""
  ).trim();
  const fixturePayload = normalizeObject(data.fixture_payload || data.fixturePayload);
  const typeReferencePayload = normalizeObject(
    data.type_reference_payload || data.typeReferencePayload
  );
  const forceRepublish =
    data.force_republish === true ||
    String(data.force_republish || "")
      .trim()
      .toLowerCase() === "true";
  const sport = String(data.sport || selectedFixture.sport || "")
    .trim()
    .toLowerCase();
  const selectedPublishItems = normalizeSelectedPublishItems(
    data.selected_publish_items || data.selectedPublishItems,
    { selectedFixture, fixturePayload, sport }
  );

  return {
    selectedFixture,
    manualQuery,
    providedTypeReferenceId,
    fixturePayload,
    typeReferencePayload,
    selectedPublishItems,
    forceRepublish,
    sport,
  };
}

export function normalizeSelectedPublishItems(
  value,
  { selectedFixture = {}, fixturePayload = null, sport = "" } = {}
) {
  const items = Array.isArray(value) ? value : [];
  const out = [];
  for (const item of items) {
    const normalizedItem = item && typeof item === "object" ? item : {};
    const parentMarketPayload = normalizeObject(
      normalizedItem.parent_market_payload || normalizedItem.parentMarketPayload
    );
    const publishKey =
      String(normalizedItem.publish_key || normalizedItem.publishKey || "")
        .trim()
        .toLowerCase() ||
      deriveCmsPublishKeyFromParentPayload(parentMarketPayload, {
        selectedFixture,
        fixturePayload,
      });
    if (!publishKey || !isSupportedCmsPublishKey(publishKey, { sport }) || !parentMarketPayload) {
      continue;
    }
    out.push({
      publish_key: publishKey,
      parent_market_payload: redactSecrets(parentMarketPayload),
    });
  }
  return dedupeSelectedPublishItems(out);
}

export function dedupeSelectedPublishItems(items = []) {
  const seen = new Set();
  const out = [];
  for (const item of Array.isArray(items) ? items : []) {
    const key = String(item?.publish_key || "")
      .trim()
      .toLowerCase();
    if (!key || seen.has(key)) continue;
    seen.add(key);
    out.push(item);
  }
  return out;
}

export function deriveCmsPublishKeyFromParentPayload(
  parentMarketPayload,
  { selectedFixture = {}, fixturePayload = null } = {}
) {
  const payload = normalizeObject(parentMarketPayload);
  const parentMarket = normalizeObject(payload?.parent_market);
  if (!parentMarket) {
    return "";
  }
  const family = String(parentMarket.parent_market_family || "")
    .trim()
    .toLowerCase();
  const line = normalizeMarketLine(parentMarket.market_line);
  if (family === "moneyline") {
    return "moneyline|0";
  }
  if (family === "btts") {
    return "btts|0";
  }
  if (family === "totals" && line) {
    return `totals|${line}`;
  }
  if (family === "spreads" && line) {
    const side = inferSpreadSideFromParentPayload(payload, {
      selectedFixture,
      fixturePayload,
    });
    return side ? `spreads|${line}|${side}` : "";
  }
  return "";
}

export function inferSpreadSideFromParentPayload(
  parentMarketPayload,
  { selectedFixture = {}, fixturePayload = null } = {}
) {
  const payload = normalizeObject(parentMarketPayload);
  const markets = Array.isArray(payload?.markets) ? payload.markets : [];
  const spreadMarket = normalizeObject(markets[0]);
  const marketTeamId = String(spreadMarket?.team_id || "").trim();
  const homeTeamId = String(
    selectedFixture.home_team_id || fixturePayload?.home_team_id || ""
  ).trim();
  const awayTeamId = String(
    selectedFixture.away_team_id || fixturePayload?.away_team_id || ""
  ).trim();
  if (marketTeamId && homeTeamId && marketTeamId === homeTeamId) {
    return "home";
  }
  if (marketTeamId && awayTeamId && marketTeamId === awayTeamId) {
    return "away";
  }

  const eventName = String(selectedFixture.event_name || fixturePayload?.name || "").trim();
  const [homeName, awayName] = splitEventName(eventName);

  const marketTitle = String(spreadMarket?.name || "").trim();
  const extractedTeamName = extractTeamNameFromSpreadTitle(marketTitle);

  if (extractedTeamName && homeName && matchesTeamName(extractedTeamName, homeName)) {
    return "home";
  }
  if (extractedTeamName && awayName && matchesTeamName(extractedTeamName, awayName)) {
    return "away";
  }

  const marketName = normalizeForCompare(marketTitle);
  if (marketName && homeName && marketName.includes(normalizeForCompare(homeName))) {
    return "home";
  }
  if (marketName && awayName && marketName.includes(normalizeForCompare(awayName))) {
    return "away";
  }
  return "";
}

export function buildExistingPublishKeyFromRows(
  rows = [],
  { selectedFixture = {}, fixtureRecord = null } = {}
) {
  const groupRows = Array.isArray(rows) ? rows : [];
  if (!groupRows.length) {
    return "";
  }
  const head = groupRows[0] || {};
  const family = String(head.parent_market_family || "")
    .trim()
    .toLowerCase();
  const line = normalizeMarketLine(head.market_line);
  if (family === "moneyline") {
    return "moneyline|0";
  }
  if (family === "btts") {
    return "btts|0";
  }
  if (family === "totals" && line) {
    return `totals|${line}`;
  }
  if (family === "spreads" && line) {
    const homeTeamId = String(
      selectedFixture.home_team_id || fixtureRecord?.home_team_id || ""
    ).trim();
    const awayTeamId = String(
      selectedFixture.away_team_id || fixtureRecord?.away_team_id || ""
    ).trim();
    const teamId = String(groupRows.find((row) => row?.team_id)?.team_id || "").trim();
    if (teamId && homeTeamId && teamId === homeTeamId) return `spreads|${line}|home`;
    if (teamId && awayTeamId && teamId === awayTeamId) return `spreads|${line}|away`;

    const marketName = String(head.market_name || "").trim();
    const extractedTeamName = extractTeamNameFromSpreadTitle(marketName);
    const [homeName, awayName] = splitEventName(
      selectedFixture.event_name || fixtureRecord?.event_name || ""
    );

    if (extractedTeamName && homeName && matchesTeamName(extractedTeamName, homeName)) {
      return `spreads|${line}|home`;
    }
    if (extractedTeamName && awayName && matchesTeamName(extractedTeamName, awayName)) {
      return `spreads|${line}|away`;
    }
  }
  return "";
}

export function reconstructParentMarketPayloadFromRows(rows = []) {
  const groupRows = Array.isArray(rows) ? rows : [];
  if (!groupRows.length) {
    return null;
  }
  const head = groupRows[0];
  const markets = groupRows
    .filter((row) => row && row.market_id != null)
    .map((row) => ({
      name: row.market_name,
      tick_size: row.tick_size,
      market_code: row.market_code,
      rules: row.market_rules,
      ...(String(row.team_id || "").trim() ? { team_id: row.team_id } : {}),
    }));

  return {
    parent_market: removeUndefinedFields({
      league_id: head.league_id,
      type_reference_id: head.type_reference_id,
      title: head.title,
      parent_market_family: head.parent_market_family,
      market_line: String(head.market_line ?? ""),
      rules: head.parent_rules,
      is_cross_matching_enabled:
        typeof head.is_cross_matching_enabled === "boolean"
          ? head.is_cross_matching_enabled
          : undefined,
      order_delay_enabled:
        typeof head.order_delay_enabled === "boolean" ? head.order_delay_enabled : undefined,
      markets_open_time: head.markets_open_time,
    }),
    markets,
  };
}

export function getExpectedMarketCountForPublishKey(publishKey = "") {
  const normalized = String(publishKey || "")
    .trim()
    .toLowerCase();
  return CMS_PARENT_MARKET_EXPECTED_COUNTS[normalized] || 0;
}

export function getExpectedMarketCountFromPayload(parentMarketPayload) {
  const markets = Array.isArray(parentMarketPayload?.markets) ? parentMarketPayload.markets : [];
  return markets.filter((row) => row && typeof row === "object").length;
}

export function canonicalizeJson(value) {
  return JSON.stringify(sortJson(removeUndefinedFields(value)));
}

export function canonicalizeParentMarketComparisonPayload(value) {
  const normalized = removeUndefinedFields(value);
  if (normalized?.parent_market && typeof normalized.parent_market === "object") {
    normalized.parent_market = {
      ...normalized.parent_market,
      type_reference_id: "",
    };
  }
  return canonicalizeJson(normalized);
}

export function createPublishRunRecord({
  runId,
  requestId,
  environment,
  selectedFixture,
  selectedPublishItems,
} = {}) {
  return {
    run_id: String(runId || "").trim(),
    request_id: String(requestId || "").trim(),
    environment: environment || { code: "", label: "" },
    fixture: redactSecrets(selectedFixture || {}),
    selected_publish_keys: selectedPublishItems.map((item) => item.publish_key),
    selected_publish_items: selectedPublishItems.map((item) => ({
      publish_key: item.publish_key,
      parent_market_payload: redactSecrets(item.parent_market_payload),
    })),
    started_at: new Date().toISOString(),
    completed_at: null,
    status: "running",
    skipped_steps: [],
    step_results: {
      fixture: null,
      type_reference: null,
    },
    parent_market_results: {},
    aggregate: {
      total: selectedPublishItems.length,
      published: 0,
      existing: 0,
      failed: 0,
      half_prepared: 0,
      blocked: 0,
      skipped: 0,
    },
    summary: "",
    detail: "",
  };
}

export function summarizeParentPublishCounts(parentResults = {}) {
  const aggregate = {
    total: 0,
    published: 0,
    existing: 0,
    failed: 0,
    half_prepared: 0,
    blocked: 0,
    skipped: 0,
  };
  for (const entry of Object.values(parentResults || {})) {
    aggregate.total += 1;
    const status = String(entry?.status || "")
      .trim()
      .toLowerCase();
    if (status && Object.prototype.hasOwnProperty.call(aggregate, status)) {
      aggregate[status] += 1;
    }
  }
  return aggregate;
}

export function validateCmsSelectedPublishEnvelope(envelope = {}) {
  const issues = [];
  if (!envelope?.selectedFixture?.game_id && !envelope?.manualQuery) {
    issues.push("payload.selected_fixture.game_id");
  }
  if (
    !Array.isArray(envelope?.selectedPublishItems) ||
    envelope.selectedPublishItems.length === 0
  ) {
    issues.push("payload.selected_publish_items");
  }
  if (!envelope?.fixturePayload) {
    issues.push("payload.fixture_payload");
  }
  if (!envelope?.typeReferencePayload) {
    issues.push("payload.type_reference_payload");
  }
  return issues;
}

export function classifyParentStatusFromRows(
  rows = [],
  { selectedFixture = {}, fixtureRecord = null, expectedMarketCount = 0 } = {}
) {
  const groupRows = Array.isArray(rows) ? rows : [];
  if (!groupRows.length) {
    return { status: "missing", warnings: [] };
  }
  const publishKey = buildExistingPublishKeyFromRows(groupRows, { selectedFixture, fixtureRecord });
  const parentIds = new Set(
    groupRows.map((row) => String(row.parent_market_id || "").trim()).filter(Boolean)
  );
  const marketIds = new Set(
    groupRows.map((row) => String(row.market_id || "").trim()).filter(Boolean)
  );
  const expectedCount =
    Number(expectedMarketCount || 0) || getExpectedMarketCountForPublishKey(publishKey);
  const warnings = [];
  let status = "existing";
  if (!publishKey) {
    status = "half_prepared";
    warnings.push("Could not classify existing parent market rows into a supported publish key.");
  } else if (parentIds.size !== 1) {
    status = "half_prepared";
    warnings.push("Multiple parent market records matched the same publish slot.");
  } else if (marketIds.size === 0) {
    status = "half_prepared";
    warnings.push("Parent market exists without any market rows.");
  } else if (expectedCount > 0 && marketIds.size < expectedCount) {
    status = "half_prepared";
    warnings.push(
      `Parent market is missing expected child market rows (${marketIds.size}/${expectedCount}).`
    );
  }
  return {
    status,
    warnings,
    publishKey,
    expected_count: expectedCount,
    confirmed_count: marketIds.size,
  };
}

export function ensureUatOnly(environment = {}) {
  if (
    String(environment?.code || "")
      .trim()
      .toLowerCase() !== "uat"
  ) {
    throw new InvalidIntegrationPayloadError("This route is available only for UAT.", {
      issues: ["environment"],
    });
  }
}

export function formatCmsPublishKeyLabel(publishKey = "") {
  const normalized = String(publishKey || "")
    .trim()
    .toLowerCase();
  if (!normalized) return "Unknown market";
  if (normalized === "moneyline|0") return "Moneyline";
  if (normalized === "btts|0") return "BTTS";
  const [family, line = "0", side = ""] = normalized.split("|");
  if (family === "totals") {
    return `Totals ${line}`;
  }
  if (family === "spreads") {
    return `Spreads ${line} ${side === "away" ? "Away" : "Home"}`;
  }
  return normalized;
}

export function buildCmsParentResultMessage(
  status = "",
  publishKey = "",
  { warnings = [], error = "" } = {}
) {
  const normalized = String(status || "")
    .trim()
    .toLowerCase();
  const chipLabel = formatCmsPublishKeyLabel(publishKey);
  switch (normalized) {
    case "selectable":
    case "idle":
      return { label: "Ready", detail: `${chipLabel} is ready to publish.`, tone: "success" };
    case "publishing":
      return { label: "Publishing", detail: `Publishing ${chipLabel}.`, tone: "working" };
    case "waiting_for_db":
      return {
        label: "Waiting For DB",
        detail: `${chipLabel} publish succeeded. Waiting for DB confirmation.`,
        tone: "working",
      };
    case "published":
      return {
        label: "Created",
        detail: `${chipLabel} created and confirmed in DB.`,
        tone: "success",
      };
    case "existing":
      return {
        label: "Already Exists",
        detail: `${chipLabel} already exists and is skipped by default.`,
        tone: "warn",
      };
    case "skipped":
      return { label: "Skipped", detail: `${chipLabel} was skipped.`, tone: "neutral" };
    case "half_prepared":
      return {
        label: "Half-prepared",
        detail: `${chipLabel} has a parent market record but is missing expected child market rows.`,
        tone: "warn",
      };
    case "blocked":
      if (
        Array.isArray(warnings) &&
        warnings.some((value) => /matches the existing/i.test(String(value || "")))
      ) {
        return {
          label: "Blocked",
          detail: `${chipLabel} matches the existing market JSON. Update the parent market JSON before republishing.`,
          tone: "error",
        };
      }
      return { label: "Blocked", detail: `${chipLabel} is invalid for publish.`, tone: "error" };
    case "failed":
      return {
        label: "Failed",
        detail: `${chipLabel} failed to publish.${error ? ` ${String(error).trim()}` : ""}`.trim(),
        tone: "error",
      };
    default:
      return { label: "Pending", detail: `${chipLabel} has not started yet.`, tone: "neutral" };
  }
}

export function buildCmsStepResultMessage(
  kind = "",
  status = "",
  fixtureName = "",
  { providedTypeReference = false } = {}
) {
  const normalizedKind = String(kind || "")
    .trim()
    .toLowerCase();
  const normalizedStatus = String(status || "")
    .trim()
    .toLowerCase();
  if (normalizedKind === "fixture") {
    switch (normalizedStatus) {
      case "publishing":
        return { label: "Publishing", detail: "Publishing fixture JSON to CMS.", tone: "working" };
      case "waiting_for_db":
        return {
          label: "Waiting For DB",
          detail: "Fixture publish succeeded. Waiting for fixture row to appear in DB.",
          tone: "working",
        };
      case "created":
      case "existing":
        return {
          label: "Created",
          detail: "Fixture created and confirmed in DB.",
          tone: "success",
        };
      case "skipped":
        return {
          label: "Skipped",
          detail: "Fixture publish skipped because an existing type reference was provided.",
          tone: "neutral",
        };
      case "failed":
        return {
          label: "Failed",
          detail: "Fixture publish failed or fixture row was not confirmed in DB.",
          tone: "error",
        };
      default:
        return { label: "Pending", detail: "Fixture publish has not started.", tone: "neutral" };
    }
  }
  if (normalizedKind === "type_reference") {
    switch (normalizedStatus) {
      case "publishing":
        return {
          label: "Publishing",
          detail: "Publishing type reference JSON to CMS.",
          tone: "working",
        };
      case "waiting_for_db":
        return {
          label: "Waiting For DB",
          detail:
            "Type reference publish succeeded. Waiting for type reference row to appear in DB.",
          tone: "working",
        };
      case "created":
      case "existing":
        return {
          label: "Created",
          detail: "Type reference created and confirmed in DB.",
          tone: "success",
        };
      case "skipped":
        return {
          label: "Skipped",
          detail: "Type reference publish skipped because an existing type reference was provided.",
          tone: "neutral",
        };
      case "blocked":
        return {
          label: "Blocked",
          detail: "The entered type reference does not belong to the selected fixture.",
          tone: "error",
        };
      case "failed":
        return {
          label: "Failed",
          detail: "Type reference publish failed or type reference row was not confirmed in DB.",
          tone: "error",
        };
      default:
        return {
          label: "Pending",
          detail: "Type reference publish has not started.",
          tone: "neutral",
        };
    }
  }
  return { label: "Pending", detail: `${fixtureName || "Step"} has not started.`, tone: "neutral" };
}

export function buildCmsPublishRunSummary(runRecord = {}) {
  const fixtureName = String(
    runRecord?.fixture?.event_name || runRecord?.fixture?.name || "selected fixture"
  ).trim();
  const aggregate = runRecord?.aggregate || {};
  const published = Number(aggregate.published || 0);
  const existing = Number(aggregate.existing || 0);
  const failed = Number(aggregate.failed || 0);
  const halfPrepared = Number(aggregate.half_prepared || 0);
  const requested = Number(aggregate.total || 0);
  const typeRefSkipped =
    Array.isArray(runRecord?.skipped_steps) && runRecord.skipped_steps.includes("type_reference");
  if (
    requested > 0 &&
    published === 0 &&
    existing === requested &&
    failed === 0 &&
    halfPrepared === 0
  ) {
    return {
      summary: `No new markets to publish for ${fixtureName}.`,
      detail: "All selected markets already exist in UAT.",
      tone: "warn",
    };
  }
  if (runRecord?.status === "blocked") {
    return {
      summary: `Publish blocked for ${fixtureName}.`,
      detail: "Selected publish items are blocked.",
      tone: "error",
    };
  }
  if (failed > 0 || halfPrepared > 0) {
    return {
      summary: `Publish partially completed for ${fixtureName}.`,
      detail: `Created ${published} of ${requested} selected market(s). ${failed + halfPrepared} failed and ${existing} already existed.`,
      tone: "warn",
    };
  }
  if (published > 0 && typeRefSkipped) {
    return {
      summary: `Publish completed for ${fixtureName}.`,
      detail: `Used existing type reference and created ${published} selected market(s) in UAT.`,
      tone: "success",
    };
  }
  if (published > 0) {
    return {
      summary: `Publish completed for ${fixtureName}.`,
      detail: `Created fixture, type reference, and ${published} selected market(s) in UAT.`,
      tone: "success",
    };
  }
  return {
    summary: `Publish failed for ${fixtureName}.`,
    detail: "No publishable markets were confirmed in DB.",
    tone: "error",
  };
}

export function buildCmsFixtureHistorySummary({
  fixtureName = "",
  publishedFamilies = [],
  halfPreparedFamilies = [],
  failedFamilies = [],
} = {}) {
  const name = String(fixtureName || "selected fixture").trim();
  const published = Array.isArray(publishedFamilies) ? publishedFamilies : [];
  const halfPrepared = Array.isArray(halfPreparedFamilies) ? halfPreparedFamilies : [];
  const failed = Array.isArray(failedFamilies) ? failedFamilies : [];
  if (published.length) {
    return {
      summary: `Published markets found for ${name}.`,
      detail: `Previously published: ${published.map((key) => formatCmsPublishKeyLabel(key)).join(", ")}.`,
      tone: "success",
    };
  }
  if (failed.length) {
    return {
      summary: `Previous failures found for ${name}.`,
      detail: `Failed previously: ${failed.map((key) => formatCmsPublishKeyLabel(key)).join(", ")}.`,
      tone: "error",
    };
  }
  if (halfPrepared.length) {
    return {
      summary: `Half-prepared markets found for ${name}.`,
      detail: `Needs review: ${halfPrepared.map((key) => formatCmsPublishKeyLabel(key)).join(", ")}.`,
      tone: "warn",
    };
  }
  return {
    summary: `No prior CMS market state found for ${name}.`,
    detail: "This fixture has no confirmed parent markets in DB yet.",
    tone: "neutral",
  };
}

export function buildCmsDbResultSnapshot({
  fixtureRecord = null,
  typeReferenceRecord = null,
  parentRows = [],
  selectedPublishItems = [],
  selectedFixture = {},
} = {}) {
  const grouped = groupRowsByParentMarketId(parentRows);
  const publishedByFamily = {
    moneyline: [],
    totals: [],
    btts: [],
    spreads: [],
  };
  const halfPreparedMarkets = [];
  const selectedKeys = new Set(
    (Array.isArray(selectedPublishItems) ? selectedPublishItems : [])
      .map((item) =>
        String(item?.publish_key || "")
          .trim()
          .toLowerCase()
      )
      .filter(Boolean)
  );
  const seenKeys = new Set();

  for (const rows of grouped.values()) {
    const classification = classifyParentStatusFromRows(rows, {
      selectedFixture,
      fixtureRecord,
    });
    const publishKey = String(classification.publishKey || "")
      .trim()
      .toLowerCase();
    if (!publishKey) {
      continue;
    }
    seenKeys.add(publishKey);
    const head = rows[0] || {};
    const [family = ""] = publishKey.split("|");
    const entry = {
      publish_key: publishKey,
      label: formatCmsPublishKeyLabel(publishKey),
      parent_market_id: String(head.parent_market_id || "").trim() || null,
      title: String(head.title || "").trim() || null,
      parent_market_family:
        String(head.parent_market_family || "")
          .trim()
          .toLowerCase() || null,
      market_line: normalizeMarketLine(head.market_line),
      market_ids: rows.map((row) => String(row.market_id || "").trim()).filter(Boolean),
      markets: rows
        .filter((row) => String(row.market_id || "").trim())
        .map((row) => ({
          market_id: String(row.market_id || "").trim(),
          name: String(row.market_name || "").trim(),
          market_code: String(row.market_code || "").trim(),
          team_id: String(row.team_id || "").trim() || null,
        })),
      expected_count: classification.expected_count,
      confirmed_count: classification.confirmed_count,
    };

    if (classification.status === "half_prepared") {
      halfPreparedMarkets.push(entry);
      continue;
    }

    if (Object.prototype.hasOwnProperty.call(publishedByFamily, family)) {
      publishedByFamily[family].push(entry);
    }
  }

  const unpreparedMarkets = [];
  for (const publishKey of selectedKeys) {
    if (seenKeys.has(publishKey)) {
      continue;
    }
    unpreparedMarkets.push({
      publish_key: publishKey,
      label: formatCmsPublishKeyLabel(publishKey),
    });
  }

  return {
    fixture: fixtureRecord
      ? {
          fixture_id: String(fixtureRecord.fixture_id || "").trim() || null,
          name: String(fixtureRecord.name || selectedFixture.event_name || "").trim() || null,
        }
      : null,
    type_reference_id: String(typeReferenceRecord?.type_reference_id || "").trim() || null,
    published_markets: publishedByFamily,
    half_prepared_markets: halfPreparedMarkets,
    unprepared_markets: unpreparedMarkets,
  };
}

function groupRowsByParentMarketId(rows = []) {
  const grouped = new Map();
  for (const row of Array.isArray(rows) ? rows : []) {
    const parentMarketId = String(row?.parent_market_id || "").trim();
    if (!parentMarketId) {
      continue;
    }
    if (!grouped.has(parentMarketId)) {
      grouped.set(parentMarketId, []);
    }
    grouped.get(parentMarketId).push(row);
  }
  return grouped;
}

function extractTeamNameFromSpreadTitle(marketTitle) {
  const title = String(marketTitle || "").trim();
  if (!title) return "";
  const match = title.match(/^(.+?)\s+[+-]\d+(?:\.\d+)?(?:\s|$)/);
  if (match && match[1]) {
    return match[1].trim();
  }
  return "";
}

function matchesTeamName(extractedName, fullTeamName) {
  if (!extractedName || !fullTeamName) return false;
  const normalizedExtracted = normalizeForCompare(extractedName);
  const normalizedFull = normalizeForCompare(fullTeamName);
  if (normalizedExtracted === normalizedFull) return true;
  if (normalizedFull.includes(normalizedExtracted)) return true;
  if (normalizedExtracted.includes(normalizedFull)) return true;
  return false;
}

function normalizeObject(value) {
  return value && typeof value === "object" && !Array.isArray(value) ? value : null;
}

function normalizeMarketLine(value) {
  const raw = String(value ?? "").trim();
  if (!raw) return "";
  return raw.replace(/^-/, "");
}

function normalizeForCompare(value) {
  return String(value || "")
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function splitEventName(value = "") {
  const parts = String(value || "")
    .trim()
    .split(/\s+vs\s+/i);
  if (parts.length >= 2) {
    return [parts[0].trim(), parts.slice(1).join(" vs ").trim()];
  }
  return [String(value || "").trim(), ""];
}

function removeUndefinedFields(value) {
  if (Array.isArray(value)) {
    return value.map((item) => removeUndefinedFields(item));
  }
  if (!value || typeof value !== "object") {
    return value;
  }
  const next = {};
  for (const [key, child] of Object.entries(value)) {
    if (child === undefined) {
      continue;
    }
    next[key] = removeUndefinedFields(child);
  }
  return next;
}

function sortJson(value) {
  if (Array.isArray(value)) {
    return value.map((item) => sortJson(item));
  }
  if (!value || typeof value !== "object") {
    return value;
  }
  const out = {};
  for (const key of Object.keys(value).sort()) {
    out[key] = sortJson(value[key]);
  }
  return out;
}
