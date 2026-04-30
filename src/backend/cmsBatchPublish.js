import { InvalidIntegrationPayloadError } from "./publisherCore.js";
import {
  CMS_SELECTED_PUBLISHABLE_KEYS,
  formatCmsPublishKeyLabel,
  isSupportedCmsPublishKey,
  normalizeCmsSelectedFixture,
} from "./cmsSelectedPublish.js";

export const CMS_BATCH_ALLOWED_ENVIRONMENTS = Object.freeze(["dev", "uat", "testnet", "mainnet"]);
export const CMS_BATCH_FRONTEND_MAX_FIXTURES = 15;
export const CMS_BATCH_BACKEND_MAX_FIXTURES = 30;

export function ensureCmsBatchEnvironmentAllowed(environment = {}, allowedCodes = CMS_BATCH_ALLOWED_ENVIRONMENTS) {
  const code = String(environment?.code || "").trim().toLowerCase();
  const allowlist = Array.isArray(allowedCodes)
    ? allowedCodes.map((value) => String(value || "").trim().toLowerCase()).filter(Boolean)
    : [];
  if (!allowlist.includes(code)) {
    throw new InvalidIntegrationPayloadError(
      `This route is available only for ${allowlist.map((value) => value.toUpperCase()).join(", ")}.`,
      { issues: ["environment"] }
    );
  }
}

export function getCmsBatchFixtureKey(value = {}) {
  const fixture = value && typeof value === "object" ? value : {};
  const gameId = String(fixture.game_id || fixture.gameId || "").trim();
  if (gameId) {
    return gameId;
  }
  const leagueCode = String(fixture.league_code || fixture.leagueCode || "").trim().toLowerCase();
  const fixtureDate = String(fixture.fixture_date || fixture.fixtureDate || "").trim();
  const kickoffTimeUtc = String(fixture.kickoff_time_utc || fixture.kickoffTimeUtc || "").trim();
  const eventName = String(fixture.event_name || fixture.eventName || "").trim().toLowerCase();
  return [leagueCode, fixtureDate, kickoffTimeUtc, eventName].filter(Boolean).join("|");
}

export function normalizeCmsBatchEnvelope(payload = {}) {
  const source = payload && typeof payload === "object" ? payload : {};
  const selectedFixtures = dedupeBatchFixtures(source.selected_fixtures || source.selectedFixtures);
  const selectedPublishKeys = dedupePublishKeys(source.selected_publish_keys || source.selectedPublishKeys);
  const perFixtureExclusions = normalizePerFixtureExclusions(source.per_fixture_exclusions || source.perFixtureExclusions);
  const confirmation = normalizeBatchConfirmation(source.confirmation);
  return {
    selectedFixtures,
    selectedPublishKeys,
    perFixtureExclusions,
    retryFailedOnly:
      source.retry_failed_only === true ||
      String(source.retry_failed_only || source.retryFailedOnly || "").trim().toLowerCase() === "true",
    lastRunId: String(source.last_run_id || source.lastRunId || "").trim(),
    dryRun:
      source.dry_run === true ||
      String(source.dry_run || source.dryRun || "").trim().toLowerCase() === "true",
    confirmation,
  };
}

export function validateCmsBatchEnvelope(envelope = {}, { publishing = false } = {}) {
  const issues = [];
  const fixtureCount = Array.isArray(envelope.selectedFixtures) ? envelope.selectedFixtures.length : 0;
  if (fixtureCount === 0) {
    issues.push("payload.selected_fixtures");
  }
  if (fixtureCount > CMS_BATCH_BACKEND_MAX_FIXTURES) {
    issues.push("payload.selected_fixtures");
  }
  if (!Array.isArray(envelope.selectedPublishKeys) || envelope.selectedPublishKeys.length === 0) {
    issues.push("payload.selected_publish_keys");
  }
  if (publishing) {
    const operatorName = String(envelope.confirmation?.operator_name || "").trim();
    const fixtureCountConfirmed = Number.parseInt(String(envelope.confirmation?.fixture_count || "").trim(), 10);
    if (!operatorName) {
      issues.push("payload.confirmation.operator_name");
    }
    if (!Number.isInteger(fixtureCountConfirmed) || fixtureCountConfirmed !== fixtureCount) {
      issues.push("payload.confirmation.fixture_count");
    }
    if (!envelope.confirmation?.confirmed) {
      issues.push("payload.confirmation.confirmed");
    }
    if (envelope.retryFailedOnly && !String(envelope.lastRunId || "").trim()) {
      issues.push("payload.last_run_id");
    }
  }
  return issues;
}

export function applyCmsBatchExclusions(selectedPublishKeys = [], perFixtureExclusions = {}, fixture = {}) {
  const fixtureKey = getCmsBatchFixtureKey(fixture);
  const exclusion = fixtureKey ? perFixtureExclusions[fixtureKey] || null : null;
  const excludedPublishKeys = new Set(
    Array.isArray(exclusion?.excluded_publish_keys)
      ? exclusion.excluded_publish_keys.map((value) => String(value || "").trim().toLowerCase()).filter(Boolean)
      : []
  );
  const selected = Array.isArray(selectedPublishKeys)
    ? selectedPublishKeys.map((value) => String(value || "").trim().toLowerCase()).filter(Boolean)
    : [];
  const publishKeys = selected.filter((value) => !excludedPublishKeys.has(value));
  return {
    excluded_fixture: Boolean(exclusion?.excluded_fixture),
    excluded_publish_keys: [...excludedPublishKeys],
    publish_keys: publishKeys,
    reason: Boolean(exclusion?.excluded_fixture) ? "Fixture excluded by operator." : "",
  };
}

export function createCmsBatchRunRecord({
  runId = "",
  requestId = "",
  environment = { code: "", label: "" },
  selectedFixtures = [],
  selectedPublishKeys = [],
  operatorName = "",
  retryFailedOnly = false,
  lastRunId = "",
} = {}) {
  return {
    run_id: String(runId || "").trim(),
    request_id: String(requestId || "").trim(),
    environment,
    operator_name: String(operatorName || "").trim(),
    retry_failed_only: Boolean(retryFailedOnly),
    last_run_id: String(lastRunId || "").trim() || null,
    selected_publish_keys: dedupePublishKeys(selectedPublishKeys),
    selected_fixtures: (Array.isArray(selectedFixtures) ? selectedFixtures : []).map((fixture) => ({
      ...normalizeCmsSelectedFixture(fixture),
      fixture_key: getCmsBatchFixtureKey(fixture),
    })),
    started_at: new Date().toISOString(),
    completed_at: null,
    status: "queued",
    stop_requested: false,
    stop_requested_at: null,
    stopped_by: null,
    stopped_at: null,
    aggregate: {
      fixtures_total: Array.isArray(selectedFixtures) ? selectedFixtures.length : 0,
      fixtures_excluded: 0,
      fixtures_failed: 0,
      fixtures_completed: 0,
      fixtures_partial: 0,
      fixtures_existing_only: 0,
      markets_total: 0,
      markets_ready: 0,
      markets_existing: 0,
      markets_missing: 0,
      markets_published: 0,
      markets_failed: 0,
      markets_blocked: 0,
      markets_excluded: 0,
      markets_skipped: 0,
      markets_half_prepared: 0,
    },
    fixtures: [],
    summary: "",
    detail: "",
  };
}

export function summarizeCmsBatchAggregate(fixtures = []) {
  const aggregate = {
    fixtures_total: 0,
    fixtures_excluded: 0,
    fixtures_failed: 0,
    fixtures_completed: 0,
    fixtures_partial: 0,
    fixtures_existing_only: 0,
    markets_total: 0,
    markets_ready: 0,
    markets_existing: 0,
    markets_missing: 0,
    markets_published: 0,
    markets_failed: 0,
    markets_blocked: 0,
    markets_excluded: 0,
    markets_skipped: 0,
    markets_half_prepared: 0,
  };

  for (const fixture of Array.isArray(fixtures) ? fixtures : []) {
    aggregate.fixtures_total += 1;
    const fixtureStatus = String(fixture?.status || "").trim().toLowerCase();
    if (fixtureStatus === "excluded") aggregate.fixtures_excluded += 1;
    else if (fixtureStatus === "failed") aggregate.fixtures_failed += 1;
    else if (fixtureStatus === "partial") aggregate.fixtures_partial += 1;
    else if (fixtureStatus === "existing") aggregate.fixtures_existing_only += 1;
    else if (fixtureStatus === "completed") aggregate.fixtures_completed += 1;

    for (const market of Array.isArray(fixture?.markets) ? fixture.markets : []) {
      aggregate.markets_total += 1;
      const status = String(market?.status || "").trim().toLowerCase();
      if (status === "ready") aggregate.markets_ready += 1;
      else if (status === "existing") aggregate.markets_existing += 1;
      else if (status === "missing") aggregate.markets_missing += 1;
      else if (status === "published" || status === "created") aggregate.markets_published += 1;
      else if (status === "failed" || status === "failed_precheck") aggregate.markets_failed += 1;
      else if (status === "blocked") aggregate.markets_blocked += 1;
      else if (status === "excluded") aggregate.markets_excluded += 1;
      else if (status === "skipped") aggregate.markets_skipped += 1;
      else if (status === "half_prepared") aggregate.markets_half_prepared += 1;
    }
  }
  return aggregate;
}

export function buildCmsBatchRunSummary(runRecord = {}) {
  const isStopRelated = ["stopped", "stopping"].includes(String(runRecord?.status || "").trim().toLowerCase()) || Boolean(runRecord?.stop_requested);
  if (isStopRelated) {
    const fixturesTotal = Number((runRecord?.aggregate || {}).fixtures_total || 0);
    const published = Number((runRecord?.aggregate || {}).markets_published || 0);
    const marketsTotal = Number((runRecord?.aggregate || {}).markets_total || 0);
    return {
      summary: "Batch publish stopped by operator.",
      detail: `Stopped after processing ${fixturesTotal} fixture(s). ${published} of ${marketsTotal} market(s) published before stop.`,
      tone: "warn",
    };
  }
  const aggregate = runRecord?.aggregate || {};
  const fixturesTotal = Number(aggregate.fixtures_total || 0);
  const marketsTotal = Number(aggregate.markets_total || 0);
  const published = Number(aggregate.markets_published || 0);
  const failed = Number(aggregate.markets_failed || 0);
  const blocked = Number(aggregate.markets_blocked || 0);
  const existing = Number(aggregate.markets_existing || 0);
  const excluded = Number(aggregate.markets_excluded || 0);
  const halfPrepared = Number(aggregate.markets_half_prepared || 0);

  if (published === 0 && failed === 0 && blocked === 0 && halfPrepared === 0 && marketsTotal > 0 && existing + excluded === marketsTotal) {
    return {
      summary: "No new markets to publish in DEV.",
      detail: `All ${marketsTotal} selected market slot(s) already existed or were excluded.`,
      tone: "warn",
    };
  }
  if (failed > 0 || blocked > 0 || halfPrepared > 0) {
    return {
      summary: `Batch publish partially completed for ${fixturesTotal} fixture${fixturesTotal === 1 ? "" : "s"}.`,
      detail: `Published ${published} of ${marketsTotal} requested market slot(s). ${failed + blocked + halfPrepared} need attention and ${existing} already existed.`,
      tone: "warn",
    };
  }
  return {
    summary: `Batch publish completed for ${fixturesTotal} fixture${fixturesTotal === 1 ? "" : "s"}.`,
    detail: `Published ${published} market slot(s) in DEV.`,
    tone: "success",
  };
}

export function buildCmsBatchFixtureRowMessage(fixture = {}) {
  const status = String(fixture?.status || "").trim().toLowerCase();
  const fixtureName = String(fixture?.event_name || fixture?.eventName || "Fixture").trim();
  if (status === "failed_precheck") {
    return {
      label: "Blocked",
      detail: fixture?.reason || `${fixtureName} could not be prepared for publish.`,
      tone: "error",
    };
  }
  if (status === "excluded") {
    return {
      label: "Excluded",
      detail: fixture?.reason || `${fixtureName} is excluded from this batch.`,
      tone: "neutral",
    };
  }
  if (status === "existing") {
    return {
      label: "Existing",
      detail: `${fixtureName} already has all selected markets.`,
      tone: "warn",
    };
  }
  if (status === "partial") {
    return {
      label: "Partial",
      detail: `${fixtureName} has a mix of existing, missing, or failed markets.`,
      tone: "warn",
    };
  }
  if (status === "publishing") {
    return {
      label: "Publishing",
      detail: `${fixtureName} is currently being published.`,
      tone: "info",
    };
  }
  if (status === "completed") {
    return {
      label: "Published",
      detail: `${fixtureName} published successfully.`,
      tone: "success",
    };
  }
  if (status === "failed") {
    return {
      label: "Failed",
      detail: fixture?.reason || `${fixtureName} failed to publish.`,
      tone: "error",
    };
  }
  return {
    label: "Pending",
    detail: `${fixtureName} has not been checked yet.`,
    tone: "neutral",
  };
}

function dedupeBatchFixtures(value) {
  const items = Array.isArray(value) ? value : [];
  const seen = new Set();
  const out = [];
  for (const item of items) {
    const normalized = normalizeCmsSelectedFixture(item);
    const fixtureKey = getCmsBatchFixtureKey(normalized);
    if (!fixtureKey || seen.has(fixtureKey)) {
      continue;
    }
    seen.add(fixtureKey);
    out.push(normalized);
  }
  return out;
}

function dedupePublishKeys(value) {
  const items = Array.isArray(value) ? value : [];
  const out = [];
  const seen = new Set();
  for (const item of items) {
    const normalized = String(item || "").trim().toLowerCase();
    if (!normalized || seen.has(normalized) || !isSupportedCmsPublishKey(normalized)) {
      continue;
    }
    seen.add(normalized);
    out.push(normalized);
  }
  return out;
}

function normalizePerFixtureExclusions(value) {
  const source = value && typeof value === "object" ? value : {};
  const out = {};

  if (Array.isArray(source)) {
    for (const item of source) {
      const fixtureKey = getCmsBatchFixtureKey(item);
      if (!fixtureKey) continue;
      out[fixtureKey] = {
        excluded_fixture: Boolean(item?.excluded_fixture || item?.excludedFixture),
        excluded_publish_keys: dedupePublishKeys(item?.excluded_publish_keys || item?.excludedPublishKeys),
      };
    }
    return out;
  }

  for (const [rawKey, rawValue] of Object.entries(source)) {
    const fixtureKey = String(rawKey || "").trim();
    if (!fixtureKey) continue;
    const valueObject = rawValue && typeof rawValue === "object" ? rawValue : {};
    out[fixtureKey] = {
      excluded_fixture: Boolean(valueObject.excluded_fixture || valueObject.excludedFixture),
      excluded_publish_keys: dedupePublishKeys(valueObject.excluded_publish_keys || valueObject.excludedPublishKeys),
    };
  }
  return out;
}

function normalizeBatchConfirmation(value) {
  const source = value && typeof value === "object" ? value : {};
  return {
    operator_name: String(source.operator_name || source.operatorName || "").trim(),
    fixture_count: String(source.fixture_count || source.fixtureCount || "").trim(),
    confirmed:
      source.confirmed === true ||
      String(source.confirmed || "").trim().toLowerCase() === "true",
  };
}

export function buildCmsBatchPublishKeyOptions() {
  return CMS_SELECTED_PUBLISHABLE_KEYS.map((key) => ({
    key,
    label: formatCmsPublishKeyLabel(key),
  }));
}

/**
 * Extracts the publish keys that need retrying from a previous run record.
 * Returns a Map<fixtureKey, publishKey[]> containing only fixtures and keys
 * whose last-run market status was "failed" or "half_prepared".
 */
export function extractRetryKeysFromRunRecord(lastRunRecord = null) {
  const result = new Map();
  if (!lastRunRecord) return result;
  for (const fixture of Array.isArray(lastRunRecord.fixtures) ? lastRunRecord.fixtures : []) {
    const failedKeys = (Array.isArray(fixture?.markets) ? fixture.markets : [])
      .filter((item) => ["failed", "half_prepared"].includes(String(item?.status || "").trim().toLowerCase()))
      .map((item) => String(item?.publish_key || "").trim().toLowerCase())
      .filter(Boolean);
    const fixtureKey = String(fixture.fixture_key || "").trim();
    if (fixtureKey && failedKeys.length) {
      result.set(fixtureKey, failedKeys);
    }
  }
  return result;
}
