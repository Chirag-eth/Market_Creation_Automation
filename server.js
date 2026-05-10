import http from "node:http";
import { randomUUID, timingSafeEqual } from "node:crypto";
import { existsSync, readFileSync } from "node:fs";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

import {
  createCatalogSourceMetadata,
  createCatalogSourcePayload,
  mergeCatalogRowCollections,
} from "./src/backend/catalogSourceContract.js";
import { normalizeLeagueStartWindows } from "./src/backend/catalogTimeWindows.js";
import { getBackendFixtureSourceAdapter } from "./src/backend/fixtureSources/index.js";
import {
  buildSportsDataRuntimeConfig,
  createSportsDataScheduleSupportMetadata,
} from "./src/backend/fixtureSources/sportsdata.js";
import { createScheduleSupportMetadata } from "./src/backend/scheduleSupport.js";
import {
  readLsportsCsvLeagueCodes,
  fetchLsportsCsvFixturesForLeague,
} from "./src/backend/fixtureSources/lsportsCsv.js";
import {
  createCmsRuntimeConfig,
  publishCmsBundle,
  resolveCmsPublishBundle,
} from "./src/backend/cmsPublisher.js";
import {
  createCmsBatchRunRecord,
  SUBMARKET_TO_PUBLISH_KEYS,
} from "./src/backend/cmsBatchPublish.js";
import { createDbPool, discoverSchema } from "./src/backend/dbClient.js";
import { queryCatalogRowsFromDb } from "./src/backend/catalogDb.js";
import {
  resolveRawScheduleRowsWithFallback,
  resolveSchedulePayloadWithFallback,
} from "./src/backend/scheduleFallback.js";
import {
  resolveLeagueScheduleCode,
  getLeagueScheduleDefinition,
  getLeagueScheduleDefinitions,
} from "./src/shared/leagueRegistry.js";
import {
  resolveBatchLeague,
  resolveBatchTeam,
} from "./src/server/services/batchResolutionService.js";
import { handleDocsRoutes } from "./src/server/routes/docsRoutes.js";
import { normalizeLeagueRows, normalizeTeamRows, buildTeamAliasIndex } from "./src/data/catalog.js";
import {
  buildUatParentPayloads,
  buildUatFixtureAlternateName,
  buildUatCanonicalFixtureName,
} from "./src/core/uatFormats.js";
import {
  classifyParentStatusFromRows,
  getExpectedMarketCountForPublishKey,
  buildExistingPublishKeyFromRows,
  reconstructParentMarketPayloadFromRows,
  canonicalizeParentMarketComparisonPayload,
} from "./src/backend/cmsSelectedPublish.js";
import { validateFixtureJson } from "./src/core/validation.js";
import { InvalidIntegrationPayloadError } from "./src/backend/publisherCore.js";
import {
  executeCmsBatchRun,
  postCmsJson,
  pickUuidLikeValue,
  classifyExistingBatchParentMarketRows,
  deriveBatchFixtureStatusFromMarkets,
  deriveBatchRunStatusFromFixtures,
  mapProviderToCmsSource,
  publishKeyToParentMarketKey,
  buildFixtureCreateCname,
  postCmsFixtureCreate,
} from "./src/backend/cmsBatchExecution.js";
import { createVaultAutomationConfig } from "./src/backend/vaultAutomationConfig.js";
import { syncSingleFixtureAfterPublish } from "./src/backend/vaultSyncOrchestrator.js";
import {
  insertScheduledJob,
  getScheduledJob,
  listScheduledJobs,
  cancelJob as cancelScheduledJobInRepo,
  rescheduleJob as rescheduleScheduledJobInRepo,
} from "./src/backend/cmsScheduledJobsRepo.js";
import { createCmsScheduler } from "./src/backend/cmsScheduler.js";
import {
  getUpcomingSchedulePayload,
  backgroundRefreshAllSchedules,
  getScheduleCacheSnapshot,
  getAllSchedulesPayload,
  getCachedLeagueCodes,
  clearScheduleCache,
} from "./src/backend/scheduleCache.js";
import {
  handleJsonPublishFixtureRequest,
  handleJsonPublishParentMarketRequest,
  handleJsonPreparePublishRequest,
} from "./src/backend/cmsJsonPublishHandlers.js";
import { normalizeForSearch } from "./src/shared/util.js";
import {
  createSession,
  getSession,
  deleteSession,
  parseSessionCookie,
  buildSessionCookie,
  buildClearSessionCookie,
  createOAuthState,
  validateOAuthState,
  exchangeGoogleCode,
  verifyGoogleIdToken,
  isOrgEmail,
  buildGoogleAuthUrl,
  deriveInitials,
  purgeExpiredSessions,
} from "./src/backend/auth.js";
import { logger, httpLogger, createScopedLogger } from "./src/shared/serverLogger.js";

const serverLog = createScopedLogger("server");
const authLog = createScopedLogger("auth");
const schedLog = createScopedLogger("schedule");
const batchLog = createScopedLogger("batch");
const cmsLog = createScopedLogger("cms");
const vaultLog = createScopedLogger("vault");
const schedulerLog = createScopedLogger("scheduler");

const STARTUP_ENV = { ...process.env };
const ROOT_DIR = path.resolve(process.cwd());
for (const envFile of resolveDotEnvFiles(ROOT_DIR, process.env)) {
  loadDotEnv(envFile);
}

// Keys that must come exclusively from a profile's .env file and must not
// bleed in from the process startup environment when profiles are built.
//
// A few keys are intentionally NOT bound here so that a value supplied via the
// startup environment (test harness, operator override, or shell export) wins
// over the per-profile .env. This is the deterministic test/ops override path:
//   - COMP_SERVICE_INTERNAL_HOST / _BEARER_TOKEN — point CMS at a stub or
//     ad-hoc host without editing .env files.
//   - SPORTSDATA_API_KEY — let tests run with the upstream provider disabled
//     even when a real key exists in .env.
const PROFILE_BOUND_KEYS = new Set([
  "DB_HOST",
  "DB_PORT",
  "DB_USER",
  "DB_PASSWORD",
  "DB_NAME",
  "DB_SSL",
  "COMP_SERVICE_HOST",
  "MARKET_MAKING_HOST",
  "ORDER_SERVICE_HOST",
  "LSPORTS_HOST",
  "PUBLIC_HOST",
  "ACCESS_TOKEN",
  "POLYMARKET_BEARER_TOKEN",
  "POLYMARKET_AUTH_HEADER_NAME",
  "POLYMARKET_AUTH_HEADER_VALUE",
  "POLYMARKET_CLOB_BASE_URL",
  "POLYMARKET_DISCOVERY_BASE_URL",
  "SPORTSDATA_SCHEDULE_BASE_URL",
  "SPORTSDATA_SCHEDULE_SEASON",
  "ENABLED_INTEGRATIONS_CATALOG_ADMIN",
  "ENABLED_INTEGRATIONS_CMS",
  "ENABLED_INTEGRATIONS_REDEMPTION",
  "ENABLED_INTEGRATIONS_SPORTSINFO",
  "ENABLED_INTEGRATIONS_VAULT",
  "DEV_ALLOW_MOCK_DOWNSTREAM",
  "VAULT_AUTOMATION_HOST",
  "VAULT_AUTOMATION_TIMEOUT_MS",
  "VAULT_AUTOMATION_RETRY_COUNT",
  "VAULT_AUTOMATION_DRY_RUN",
]);

const RUNTIME_ENV_PROFILES = createRuntimeEnvironmentProfiles(ROOT_DIR, STARTUP_ENV);
let activeRuntimeEnvCode = resolveRuntimeEnvironmentCode(process.env);

// Per-environment DB pool cache — keyed by "host:port:user:database"
const _dbPoolCache = new Map();
function getDbPoolForEnv(envVars = {}) {
  // Test escape hatch: when DISABLE_DB=1 is set, return null regardless of
  // host/user/database config. Avoids the situation where a developer's local
  // .env DB credentials leak into a test that wants to assert no-DB behavior.
  if (String(envVars.DISABLE_DB || process.env.DISABLE_DB || "").trim() === "1") {
    return null;
  }
  const host = String(envVars.DB_HOST || "").trim();
  const port = String(envVars.DB_PORT || "5432").trim();
  const user = String(envVars.DB_USER || "").trim();
  const database = String(envVars.DB_NAME || "").trim();
  if (!host || !user || !database) return null;
  const key = `${host}:${port}:${user}:${database}`;
  if (!_dbPoolCache.has(key)) {
    const pool = createDbPool(envVars);
    if (pool) _dbPoolCache.set(key, pool);
  }
  return _dbPoolCache.get(key) || null;
}
if (!RUNTIME_ENV_PROFILES[activeRuntimeEnvCode]) {
  activeRuntimeEnvCode = "uat";
}

const PORT = parsePositiveIntegerEnv(process.env.PORT, 2020, { min: 1 });
const PUBLIC_DIR = path.join(ROOT_DIR, "public");
const CATALOG_DIR = path.join(ROOT_DIR, "catalog");
const OPENAPI_JSON_PATH = path.join(ROOT_DIR, "docs", "openapi.json");
const OPENAPI_YAML_PATH = path.join(ROOT_DIR, "docs", "openapi.yaml");
const DEFAULT_DOWNLOADS_LEAGUES_CSV_PATH = path.join(os.homedir(), "Downloads", "leagues.csv");
const DEFAULT_DOWNLOADS_TEAMS_CSV_PATH = path.join(os.homedir(), "Downloads", "teams.csv");
// Candidate pairs are tried in order; both files in a pair must exist so leagues
// and teams always come from the same catalog generation.
const DEFAULT_LOCAL_CATALOG_CANDIDATE_PAIRS = [
  {
    leagues: path.join(CATALOG_DIR, "leagues.csv"),
    teams: path.join(CATALOG_DIR, "teams.csv"),
  },
  {
    leagues: path.join(CATALOG_DIR, "leagues-main.csv"),
    teams: path.join(CATALOG_DIR, "teams-main.csv"),
  },
];
const ALLOW_DOWNLOADS_CSV_FALLBACK =
  String(process.env.ALLOW_DOWNLOADS_CSV_FALLBACK || "").trim() === "1";
const EXTRA_LEAGUES_CSV_PATHS = parseCsvPathListEnv(process.env.EXTRA_LEAGUES_CSV_PATHS || "");
const EXTRA_TEAMS_CSV_PATHS = parseCsvPathListEnv(process.env.EXTRA_TEAMS_CSV_PATHS || "");
const TRUST_PROXY = String(process.env.TRUST_PROXY || "").trim() === "1";
const API_BEARER_TOKEN = String(process.env.API_BEARER_TOKEN || "").trim();
const APP_BASIC_AUTH_USER = String(process.env.APP_BASIC_AUTH_USER || "").trim();
const APP_BASIC_AUTH_PASS = String(process.env.APP_BASIC_AUTH_PASS || "").trim();
const GOOGLE_CLIENT_ID = String(process.env.GOOGLE_CLIENT_ID || "").trim();
const GOOGLE_CLIENT_SECRET = String(process.env.GOOGLE_CLIENT_SECRET || "").trim();
const PUBLIC_BASE_URL = String(process.env.PUBLIC_BASE_URL || "").trim();
const AUTH_ORG_DOMAIN = String(process.env.AUTH_ORG_DOMAIN || "pred.app").trim();
const AUTH_SESSION_TTL_MS = parsePositiveIntegerEnv(process.env.AUTH_SESSION_TTL_MS, 86_400_000, {
  min: 60_000,
});
const GOOGLE_OAUTH_ENABLED = Boolean(GOOGLE_CLIENT_ID && GOOGLE_CLIENT_SECRET && PUBLIC_BASE_URL);
const API_RATE_WINDOW_MS = parsePositiveIntegerEnv(process.env.API_RATE_WINDOW_MS, 60_000, {
  min: 1_000,
});
const API_RATE_MAX_REQUESTS = parsePositiveIntegerEnv(process.env.API_RATE_MAX_REQUESTS, 180, {
  min: 1,
});
const SCHEDULE_CACHE_TTL_MS = parsePositiveIntegerEnv(process.env.SCHEDULE_CACHE_TTL_MS, 300_000, {
  min: 1_000,
});
const SCHEDULE_FETCH_TIMEOUT_MS = parsePositiveIntegerEnv(
  process.env.SCHEDULE_FETCH_TIMEOUT_MS,
  8_000,
  { min: 1_000 }
);
const SPORTSDATA_API_KEY = String(process.env.SPORTSDATA_API_KEY || "").trim();
const SPORTSDATA_SCHEDULE_BASE_URL = String(
  process.env.SPORTSDATA_SCHEDULE_BASE_URL ||
    "https://api.sportsdata.io/v4/soccer/scores/json/Schedule"
).trim();
const SPORTSDATA_SCHEDULE_SEASON = parsePositiveIntegerEnv(
  process.env.SPORTSDATA_SCHEDULE_SEASON,
  2026,
  { min: 2000 }
);
const SCHEDULE_NOW_ISO = String(process.env.SCHEDULE_NOW_ISO || "").trim();
const LSPORTS_SCHEDULE_CSV_PATH = resolveLsportsScheduleCsvPath();

validateRuntimeConfig();

const MIME_TYPES = {
  ".html": "text/html; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".js": "application/javascript; charset=utf-8",
  ".json": "application/json; charset=utf-8",
  ".png": "image/png",
  ".jpg": "image/jpeg",
  ".jpeg": "image/jpeg",
  ".svg": "image/svg+xml",
  ".ico": "image/x-icon",
  ".wasm": "application/wasm",
  ".gz": "application/gzip",
};

const SECURITY_HEADERS = {
  "X-Content-Type-Options": "nosniff",
  "X-Frame-Options": "DENY",
  "Referrer-Policy": "no-referrer",
  "Cross-Origin-Resource-Policy": "same-origin",
  "Permissions-Policy": "camera=(), microphone=(), geolocation=()",
  "Content-Security-Policy":
    "default-src 'self'; " +
    "script-src 'self' 'wasm-unsafe-eval' 'unsafe-eval' blob: https://cdn.jsdelivr.net; " +
    "worker-src 'self' blob: https://cdn.jsdelivr.net; " +
    "child-src 'self' blob: https://cdn.jsdelivr.net; " +
    "style-src 'self' https://fonts.googleapis.com 'unsafe-inline'; " +
    "font-src 'self' https://fonts.gstatic.com data:; " +
    "img-src 'self' data: blob: https:; " +
    "connect-src 'self' https://cdn.jsdelivr.net https://tessdata.projectnaptha.com https://accounts.google.com; " +
    "form-action 'self' https://accounts.google.com; " +
    "object-src 'none'; base-uri 'self'; frame-ancestors 'none'",
};

let catalogCache = null;
const apiRateCounters = new Map();
const batchRunStore = new Map();
let OPENAPI_SPEC = null;
let OPENAPI_YAML = null;

if (existsSync(OPENAPI_JSON_PATH)) {
  try {
    OPENAPI_SPEC = JSON.parse(readFileSync(OPENAPI_JSON_PATH, "utf8"));
  } catch (err) {
    console.warn(`[openapi] Failed to parse ${OPENAPI_JSON_PATH}: ${err.message}`);
  }
}

if (existsSync(OPENAPI_YAML_PATH)) {
  try {
    OPENAPI_YAML = readFileSync(OPENAPI_YAML_PATH, "utf8");
  } catch (err) {
    console.warn(`[openapi] Failed to read ${OPENAPI_YAML_PATH}: ${err.message}`);
  }
}

const server = http.createServer(async (req, res) => {
  httpLogger(req, res);
  try {
    const requestUrl = new URL(req.url || "/", `http://${req.headers.host || "localhost"}`);

    if (requestUrl.pathname === "/api/healthz") {
      sendJson(res, 200, {
        status: "ok",
        uptime_seconds: Math.floor(process.uptime()),
        timestamp: new Date().toISOString(),
      });
      return;
    }

    if (requestUrl.pathname === "/api/readyz") {
      await handleReadyRequest(res);
      return;
    }

    if (
      handleDocsRoutes({
        pathname: requestUrl.pathname,
        res,
        openApiSpec: OPENAPI_SPEC,
        openApiYaml: OPENAPI_YAML,
        sendJson,
        sendText,
      })
    ) {
      return;
    }

    // ── Google OAuth routes (exempt from auth) ────────────────────────────────
    if (requestUrl.pathname === "/auth/google") {
      if (!GOOGLE_OAUTH_ENABLED) {
        sendText(res, 503, "Google OAuth is not configured on this server.");
        return;
      }
      const state = createOAuthState();
      const redirectUri = `${PUBLIC_BASE_URL}/auth/google/callback`;
      res.writeHead(302, {
        Location: buildGoogleAuthUrl(GOOGLE_CLIENT_ID, redirectUri, state),
        "Cache-Control": "no-store",
      });
      res.end();
      return;
    }

    if (requestUrl.pathname === "/auth/google/callback") {
      const code = requestUrl.searchParams.get("code");
      const state = requestUrl.searchParams.get("state");
      const error = requestUrl.searchParams.get("error");
      // Always consume state first — prevents replay even when error/code is absent
      const stateValid = state ? validateOAuthState(state) : false;
      if (error || !code || !stateValid) {
        sendText(
          res,
          400,
          `OAuth error: ${error || "invalid or expired state — please try again."}`
        );
        return;
      }
      try {
        const redirectUri = `${PUBLIC_BASE_URL}/auth/google/callback`;
        const tokens = await exchangeGoogleCode(
          code,
          redirectUri,
          GOOGLE_CLIENT_ID,
          GOOGLE_CLIENT_SECRET
        );
        const profile = await verifyGoogleIdToken(tokens.id_token, GOOGLE_CLIENT_ID);
        if (!isOrgEmail(profile.email, AUTH_ORG_DOMAIN)) {
          sendText(
            res,
            403,
            `Access restricted to @${AUTH_ORG_DOMAIN} accounts. You signed in as ${profile.email}.`
          );
          return;
        }
        const userData = {
          email: profile.email,
          name: profile.name || profile.email.split("@")[0],
          initials: deriveInitials(profile.name || profile.email.split("@")[0]),
        };
        const sessionId = createSession(userData, AUTH_SESSION_TTL_MS);
        const isSecure = TRUST_PROXY || PUBLIC_BASE_URL.startsWith("https://");
        const cookie = buildSessionCookie(sessionId, {
          secure: isSecure,
          ttlSeconds: Math.floor(AUTH_SESSION_TTL_MS / 1000),
        });
        res.writeHead(302, { Location: "/", "Set-Cookie": cookie, "Cache-Control": "no-store" });
        res.end();
      } catch (err) {
        authLog.error({ err, reqId: req.id }, "google callback failed");
        sendText(res, 500, "Authentication failed. Please try again.");
      }
      return;
    }

    if (requestUrl.pathname === "/auth/logout") {
      const sessionId = parseSessionCookie(req);
      if (sessionId) deleteSession(sessionId);
      res.writeHead(302, {
        Location: "/",
        "Set-Cookie": buildClearSessionCookie(),
        "Cache-Control": "no-store",
      });
      res.end();
      return;
    }

    if (requestUrl.pathname === "/auth/me") {
      if (!GOOGLE_OAUTH_ENABLED) {
        sendJson(res, 200, { name: "Local Dev", email: "dev@localhost", initials: "LD" });
        return;
      }
      const sessionId = parseSessionCookie(req);
      const user = sessionId ? getSession(sessionId) : null;
      if (!user) {
        sendJson(res, 401, { error: "Not authenticated" });
        return;
      }
      sendJson(res, 200, { name: user.name, email: user.email, initials: user.initials });
      return;
    }
    // ─────────────────────────────────────────────────────────────────────────

    if (requestUrl.pathname.startsWith("/api/")) {
      if (!isAuthorizedApiRequest(req)) {
        sendJson(
          res,
          401,
          { error: "Unauthorized", detail: "Missing or invalid API bearer token." },
          { "WWW-Authenticate": 'Bearer realm="Fixture OCR API"' }
        );
        return;
      }
      const rate = allowApiRequest(req);
      if (!rate.ok) {
        sendJson(
          res,
          429,
          {
            error: "Rate limit exceeded",
            detail: `Too many API requests from this client. Retry in ${rate.retryAfterSeconds}s.`,
          },
          { "Retry-After": String(rate.retryAfterSeconds) }
        );
        return;
      }
    }
    if (!requestUrl.pathname.startsWith("/api/")) {
      if (GOOGLE_OAUTH_ENABLED) {
        const sessionId = parseSessionCookie(req);
        if (!sessionId || !getSession(sessionId)) {
          res.writeHead(302, { Location: "/auth/google", "Cache-Control": "no-store" });
          res.end();
          return;
        }
      } else if (!isAuthorizedStaticRequest(req)) {
        sendText(res, 401, "Unauthorized", {
          "WWW-Authenticate": 'Basic realm="Fixture OCR Dashboard"',
        });
        return;
      }
    }

    if (requestUrl.pathname === "/api/catalog") {
      await handleCatalogRequest(res);
      return;
    }

    if (requestUrl.pathname === "/api/runtime/environment") {
      await handleRuntimeEnvironmentRequest(req, res);
      return;
    }

    if (requestUrl.pathname === "/api/cms/publish") {
      await handleCmsPublishRequest(req, res);
      return;
    }

    if (requestUrl.pathname === "/api/cms/batch-publish") {
      await handleCmsBatchPublishRequest(req, res);
      return;
    }

    if (requestUrl.pathname.startsWith("/api/cms/batch-runs/")) {
      const runId = requestUrl.pathname.slice("/api/cms/batch-runs/".length);
      handleCmsBatchRunRequest(runId, res);
      return;
    }

    if (requestUrl.pathname.startsWith("/api/integrations/cms/")) {
      await handleIntegrationsCmsRequest(req, res, requestUrl);
      return;
    }

    if (requestUrl.pathname === "/api/catalog/meta") {
      await handleCatalogMetaRequest(res);
      return;
    }

    if (requestUrl.pathname === "/api/schedules/leagues") {
      await handleScheduleLeaguesRequest(res);
      return;
    }

    if (requestUrl.pathname === "/api/schedules/status") {
      handleScheduleStatusRequest(res);
      return;
    }

    if (requestUrl.pathname === "/api/schedules/all") {
      await handleAllSchedulesRequest(res);
      return;
    }

    if (requestUrl.pathname === "/api/schedules/upcoming") {
      await handleUpcomingScheduleRequest(requestUrl, res);
      return;
    }

    if (requestUrl.pathname === "/api/debug/db") {
      await handleDebugDbRequest(res);
      return;
    }

    if (requestUrl.pathname === "/api/db/verify/fixture" && req.method === "POST") {
      await handleDbVerifyFixtureRequest(req, res);
      return;
    }

    if (requestUrl.pathname === "/api/db/verify/type-reference" && req.method === "POST") {
      await handleDbVerifyTypeReferenceRequest(req, res);
      return;
    }

    if (requestUrl.pathname === "/api/db/verify/parent-market" && req.method === "POST") {
      await handleDbVerifyParentMarketRequest(req, res);
      return;
    }

    if (requestUrl.pathname === "/api/json/build-outputs" && req.method === "POST") {
      await handleJsonBuildOutputsRequest(req, res);
      return;
    }

    if (requestUrl.pathname === "/api/json/generate-parent-market" && req.method === "POST") {
      await handleJsonGenerateParentMarketRequest(req, res);
      return;
    }

    if (requestUrl.pathname === "/api/json/leagues" && req.method === "GET") {
      await handleJsonLeaguesRequest(res);
      return;
    }

    if (requestUrl.pathname === "/api/json/teams" && req.method === "GET") {
      await handleJsonTeamsRequest(res, requestUrl);
      return;
    }

    if (requestUrl.pathname === "/api/json/publish-fixture" && req.method === "POST") {
      await handleJsonPublishFixtureRequest(req, res, jsonPublishCtx);
      return;
    }

    if (requestUrl.pathname === "/api/json/publish-parent-market" && req.method === "POST") {
      await handleJsonPublishParentMarketRequest(req, res, jsonPublishCtx);
      return;
    }

    if (requestUrl.pathname === "/api/json/prepare-publish" && req.method === "POST") {
      await handleJsonPreparePublishRequest(req, res, jsonPublishCtx);
      return;
    }

    if (requestUrl.pathname === "/api/cms/fixture-create" && req.method === "POST") {
      await handleCmsFixtureCreateRequest(req, res);
      return;
    }

    if (requestUrl.pathname.startsWith("/api/")) {
      sendJson(res, 404, {
        error: "Not Found",
        detail: `No API route matches ${requestUrl.pathname}.`,
        path: requestUrl.pathname,
      });
      return;
    }

    await serveStaticFile(requestUrl.pathname, res);
  } catch (error) {
    (req.log || logger).error({ err: error }, "unhandled request error");
    sendJson(res, 500, { error: "Internal server error", detail: String(error?.message || error) });
  }
});

function loadDotEnv(filePath) {
  if (!existsSync(filePath)) {
    return;
  }

  let raw;
  try {
    raw = readFileSync(filePath, "utf8");
  } catch {
    return;
  }

  const lines = String(raw || "").split(/\r?\n/);
  for (const line of lines) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith("#")) {
      continue;
    }
    const eq = trimmed.indexOf("=");
    if (eq <= 0) {
      continue;
    }
    const key = trimmed.slice(0, eq).trim();
    if (!key || process.env[key] != null) {
      continue;
    }
    let value = trimmed.slice(eq + 1).trim();
    if (
      (value.startsWith('"') && value.endsWith('"')) ||
      (value.startsWith("'") && value.endsWith("'"))
    ) {
      value = value.slice(1, -1);
    }
    process.env[key] = value;
  }
}

function readDotEnvValues(filePath) {
  if (!existsSync(filePath)) {
    return {};
  }

  let raw;
  try {
    raw = readFileSync(filePath, "utf8");
  } catch {
    return {};
  }

  return parseDotEnvText(raw);
}

function parseDotEnvText(raw) {
  const out = {};
  const lines = String(raw || "").split(/\r?\n/);
  for (const line of lines) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith("#")) {
      continue;
    }
    const eq = trimmed.indexOf("=");
    if (eq <= 0) {
      continue;
    }
    const key = trimmed.slice(0, eq).trim();
    if (!key) {
      continue;
    }
    let value = trimmed.slice(eq + 1).trim();
    if (
      (value.startsWith('"') && value.endsWith('"')) ||
      (value.startsWith("'") && value.endsWith("'"))
    ) {
      value = value.slice(1, -1);
    }
    out[key] = value;
  }
  return out;
}

export function resolveDotEnvFiles(rootDir, env = process.env) {
  const resolvedRoot = path.resolve(rootDir || process.cwd());
  const files = [];
  const explicitEnvFile = String(env?.ENV_FILE || "").trim();
  const appEnv = String(env?.APP_ENV || "")
    .trim()
    .toLowerCase();

  if (explicitEnvFile) {
    const resolvedExplicitEnvFile = path.isAbsolute(explicitEnvFile)
      ? explicitEnvFile
      : path.resolve(resolvedRoot, explicitEnvFile);
    files.push(resolvedExplicitEnvFile);
    files.push(`${resolvedExplicitEnvFile}.local`);
  } else if (appEnv) {
    files.push(path.resolve(resolvedRoot, `.env.${appEnv}`));
    files.push(path.resolve(resolvedRoot, `.env.${appEnv}.local`));
  }

  files.push(path.resolve(resolvedRoot, ".env"));
  files.push(path.resolve(resolvedRoot, ".env.local"));

  return Array.from(new Set(files));
}

export function resolveRuntimeEnvironment(env = process.env) {
  const appEnv = resolveRuntimeEnvironmentCode(env);
  return {
    appEnv,
    appEnvLabel: formatRuntimeEnvironmentLabel(appEnv),
    envFile: String(env?.ENV_FILE || "").trim(),
  };
}

function resolveRuntimeEnvironmentCode(env = process.env) {
  const raw = String(env?.APP_ENV || "")
    .trim()
    .toLowerCase();
  // Unset / unknown values default to mainnet — the safest production-leaning
  // choice. Pre-existing aliases ("local") also resolve to mainnet so they
  // don't silently route through the UAT profile.
  if (!raw || raw === "mainnet" || raw === "local") return "mainnet";
  if (raw === "uat") return "uat";
  if (raw === "dev" || raw === "development") return "dev";
  if (raw === "testnet") return "testnet";
  return raw;
}

function formatRuntimeEnvironmentLabel(appEnv) {
  if (appEnv === "uat") {
    return "UAT";
  }
  if (appEnv === "mainnet") {
    return "Mainnet";
  }
  return String(appEnv || "Mainnet")
    .trim()
    .replace(/[-_]+/g, " ")
    .replace(/\b\w/g, (match) => match.toUpperCase());
}

function createRuntimeEnvironmentProfiles(rootDir, startupEnv = {}) {
  const resolvedRoot = path.resolve(rootDir || process.cwd());
  const mainnetEnvFile = path.resolve(resolvedRoot, ".env");
  const mainnetLocalFile = path.resolve(resolvedRoot, ".env.mainnet.local");
  const uatEnvFile = path.resolve(resolvedRoot, ".env.uat");
  const uatLocalFile = path.resolve(resolvedRoot, ".env.uat.local");
  const devEnvFile = path.resolve(resolvedRoot, ".env.dev");
  const devLocalFile = path.resolve(resolvedRoot, ".env.dev.local");
  const testnetEnvFile = path.resolve(resolvedRoot, ".env.testnet");
  const testnetLocalFile = path.resolve(resolvedRoot, ".env.testnet.local");
  const sharedLocalFile = path.resolve(resolvedRoot, ".env.local");
  const sanitizedStartupEnv = sanitizeRuntimeStartupEnv(startupEnv);

  const mainnetValues = readDotEnvValues(mainnetEnvFile);
  const mainnetLocal = readDotEnvValues(mainnetLocalFile);
  const uatValues = readDotEnvValues(uatEnvFile);
  const uatLocal = readDotEnvValues(uatLocalFile);
  const devValues = readDotEnvValues(devEnvFile);
  const devLocal = readDotEnvValues(devLocalFile);
  const testnetValues = readDotEnvValues(testnetEnvFile);
  const testnetLocal = readDotEnvValues(testnetLocalFile);
  const sharedLocal = readDotEnvValues(sharedLocalFile);

  return {
    mainnet: {
      code: "mainnet",
      label: "Mainnet",
      envFile: mainnetEnvFile,
      available: true,
      env: {
        ...mainnetValues,
        ...sharedLocal,
        ...mainnetLocal,
        ...sanitizedStartupEnv,
        APP_ENV: "mainnet",
        ENV_FILE: mainnetEnvFile,
      },
    },
    uat: {
      code: "uat",
      label: "UAT",
      envFile: uatEnvFile,
      available: true,
      env: {
        ...mainnetValues,
        ...uatValues,
        ...sharedLocal,
        ...uatLocal,
        ...sanitizedStartupEnv,
        APP_ENV: "uat",
        ENV_FILE: uatEnvFile,
      },
    },
    dev: {
      code: "dev",
      label: "Dev",
      envFile: devEnvFile,
      available: true,
      env: {
        ...mainnetValues,
        ...devValues,
        ...sharedLocal,
        ...devLocal,
        ...sanitizedStartupEnv,
        APP_ENV: "dev",
        ENV_FILE: devEnvFile,
      },
    },
    testnet: {
      code: "testnet",
      label: "Testnet",
      envFile: testnetEnvFile,
      available: true,
      env: {
        ...mainnetValues,
        ...testnetValues,
        ...sharedLocal,
        ...testnetLocal,
        ...sanitizedStartupEnv,
        APP_ENV: "testnet",
        ENV_FILE: testnetEnvFile,
      },
    },
  };
}

function sanitizeRuntimeStartupEnv(startupEnv = {}) {
  const next = { ...(startupEnv && typeof startupEnv === "object" ? startupEnv : {}) };
  delete next.APP_ENV;
  delete next.ENV_FILE;
  for (const key of PROFILE_BOUND_KEYS) delete next[key];
  return next;
}

function getRuntimeEnvironmentProfile(code = activeRuntimeEnvCode) {
  const normalized = resolveRuntimeEnvironmentCode({ APP_ENV: code });
  return RUNTIME_ENV_PROFILES[normalized] || RUNTIME_ENV_PROFILES.uat;
}

function getActiveRuntimeEnvironmentProfile() {
  return getRuntimeEnvironmentProfile(activeRuntimeEnvCode);
}

function getActiveRuntimeEnvVars() {
  return getActiveRuntimeEnvironmentProfile().env;
}

function createRuntimeEnvironmentPayload() {
  const activeProfile = getActiveRuntimeEnvironmentProfile();
  return {
    active_env: {
      code: activeProfile.code,
      label: activeProfile.label,
    },
    environments: Object.values(RUNTIME_ENV_PROFILES).map((profile) => ({
      code: profile.code,
      label: profile.label,
      available: Boolean(profile.available),
      env_file: path.basename(profile.envFile),
      cms_enabled: createCmsRuntimeConfig(profile.env).enabled,
    })),
  };
}

function setActiveRuntimeEnvironment(nextCode) {
  const profile = getRuntimeEnvironmentProfile(nextCode);
  activeRuntimeEnvCode = profile.code;
  catalogCache = null;
  clearScheduleCache();
  return createRuntimeEnvironmentPayload();
}

function parsePositiveIntegerEnv(rawValue, fallback, { min = 1 } = {}) {
  const text = String(rawValue ?? "").trim();
  if (!text) {
    return fallback;
  }
  const parsed = Number.parseInt(text, 10);
  if (!Number.isFinite(parsed) || parsed < min) {
    return fallback;
  }
  return parsed;
}

function parseCsvPathListEnv(rawValue) {
  return String(rawValue || "")
    .split(/[\n,]+/)
    .map((value) => String(value || "").trim())
    .filter(Boolean);
}

function resolveScheduleFetchTimeoutMs(runtimeEnv = getActiveRuntimeEnvVars()) {
  return parsePositiveIntegerEnv(runtimeEnv?.SCHEDULE_FETCH_TIMEOUT_MS, SCHEDULE_FETCH_TIMEOUT_MS, {
    min: 1_000,
  });
}

function resolveScheduleCacheTtlMs(runtimeEnv = getActiveRuntimeEnvVars()) {
  return parsePositiveIntegerEnv(runtimeEnv?.SCHEDULE_CACHE_TTL_MS, SCHEDULE_CACHE_TTL_MS, {
    min: 1_000,
  });
}

function resolveSportsDataScheduleBaseUrl(runtimeEnv = getActiveRuntimeEnvVars()) {
  return String(
    runtimeEnv?.SPORTSDATA_SCHEDULE_BASE_URL || SPORTSDATA_SCHEDULE_BASE_URL || ""
  ).trim();
}

function resolveSportsDataScheduleSeason(runtimeEnv = getActiveRuntimeEnvVars()) {
  return parsePositiveIntegerEnv(
    runtimeEnv?.SPORTSDATA_SCHEDULE_SEASON,
    SPORTSDATA_SCHEDULE_SEASON,
    { min: 2000 }
  );
}

// Bound context passed into scheduleCache.js so it can call back into server-
// scoped helpers without importing from server.js (which would be circular).
const schedCtx = {
  rootDir: ROOT_DIR,
  csvPath: LSPORTS_SCHEDULE_CSV_PATH,
  resolveNow: resolveScheduleNow,
  resolveTimeoutMs: resolveScheduleFetchTimeoutMs,
  resolveSportsDataBaseUrl: resolveSportsDataScheduleBaseUrl,
  resolveSportsDataSeason: resolveSportsDataScheduleSeason,
  getActiveRuntimeEnvVars,
  getDbPoolForEnv,
  fetchLsportsCsvFixturesForLeague,
};

// Bound context passed into cmsJsonPublishHandlers.js for the same reason.
const jsonPublishCtx = {
  getActiveRuntimeEnvironmentProfile,
  getActiveRuntimeEnvVars,
  getDbPoolForEnv,
  readJsonRequestBody,
  sendJson,
  resolveTeamRecordFromDb,
  resolveLeagueRecordFromDb,
};

function validateRuntimeConfig() {
  const hasBasicUser = Boolean(APP_BASIC_AUTH_USER);
  const hasBasicPass = Boolean(APP_BASIC_AUTH_PASS);
  if (hasBasicUser !== hasBasicPass) {
    throw new Error("APP_BASIC_AUTH_USER and APP_BASIC_AUTH_PASS must both be set together.");
  }
}

const IS_MAIN = (() => {
  const invokedPath = process.argv?.[1];
  if (!invokedPath) {
    return false;
  }
  const currentFile = fileURLToPath(import.meta.url);
  return path.resolve(invokedPath) === currentFile;
})();

if (IS_MAIN) {
  setInterval(() => purgeExpiredSessions(), 10 * 60 * 1000).unref();

  // CMS scheduler — DB-backed worker that fires due cms_scheduled_jobs.
  // Disabled when SCHEDULER_ENABLED=0 (used by some tests to avoid background timers).
  if (String(process.env.SCHEDULER_ENABLED || "1").trim() !== "0") {
    cmsScheduler.start();
  }

  server.listen(PORT, () => {
    serverLog.info({ port: PORT, url: `http://localhost:${PORT}` }, "server listening");
    void (async () => {
      try {
        const paths = await resolveCatalogPaths();
        serverLog.info({ leagues: paths.leagues, teams: paths.teams }, "csv sources resolved");
      } catch (error) {
        serverLog.warn({ err: error }, "csv source resolution failed");
      }
    })();

    // Warm up schedule cache for all leagues so the first request is instant
    void Promise.allSettled(
      getLeagueScheduleDefinitions().map((def) =>
        getUpcomingSchedulePayload(def.code, {}, schedCtx).catch((err) =>
          schedLog.warn({ code: def.code, err }, "warmup failed for league")
        )
      )
    ).then(() => {
      const warm = getCachedLeagueCodes();
      schedLog.info({ count: warm.length, leagues: warm }, "warmup complete");
    });

    // Background schedule refresh — runs every SCHEDULE_CACHE_TTL_MS (default 5 min)
    const bgIntervalMs = SCHEDULE_CACHE_TTL_MS;
    setInterval(() => {
      backgroundRefreshAllSchedules(schedCtx).catch((err) =>
        schedLog.warn({ err }, "background refresh interval error")
      );
    }, bgIntervalMs).unref();
    schedLog.info({ intervalSec: bgIntervalMs / 1000 }, "background refresh scheduled");
  });

  const shutdown = (signal) => {
    serverLog.info({ signal }, "shutting down");
    server.close(() => {
      process.exit(0);
    });
    setTimeout(() => process.exit(1), 3000).unref();
  };

  process.on("SIGINT", () => shutdown("SIGINT"));
  process.on("SIGTERM", () => shutdown("SIGTERM"));
}

async function readJsonRequestBody(req, { maxBytes = 64 * 1024 } = {}) {
  const chunks = [];
  let total = 0;

  for await (const chunk of req) {
    const buffer = Buffer.isBuffer(chunk) ? chunk : Buffer.from(String(chunk || ""));
    total += buffer.length;
    if (total > maxBytes) {
      throw new Error(`Request body exceeded ${maxBytes} bytes.`);
    }
    chunks.push(buffer);
  }

  const raw = Buffer.concat(chunks).toString("utf8").trim();
  if (!raw) {
    return {};
  }
  return JSON.parse(raw);
}

async function handleCatalogRequest(res) {
  try {
    const payload = await getCatalogPayloadCached();
    sendJson(res, 200, payload);
  } catch (error) {
    const sourceMeta = await getCatalogSourceMetaSafe();
    sendJson(res, 500, {
      error: "Failed to read CSV source files",
      detail: String(error?.message || error),
      source: sourceMeta,
    });
  }
}

async function handleRuntimeEnvironmentRequest(req, res) {
  if (req.method === "GET") {
    sendJson(res, 200, createRuntimeEnvironmentPayload());
    return;
  }

  if (req.method !== "POST") {
    sendJson(
      res,
      405,
      { error: "Method not allowed", detail: "Use GET or POST." },
      { Allow: "GET, POST" }
    );
    return;
  }

  let payload;
  try {
    payload = await readJsonRequestBody(req);
  } catch (error) {
    sendJson(res, 400, { error: "Invalid JSON body", detail: String(error?.message || error) });
    return;
  }

  const requestedEnv = resolveRuntimeEnvironmentCode({ APP_ENV: payload?.app_env });
  if (!RUNTIME_ENV_PROFILES[requestedEnv]) {
    sendJson(res, 400, {
      error: "Unsupported environment",
      detail:
        'Pass {"app_env":"mainnet"}, {"app_env":"uat"}, {"app_env":"dev"}, or {"app_env":"testnet"}.',
    });
    return;
  }

  const result = setActiveRuntimeEnvironment(requestedEnv);
  sendJson(res, 200, {
    ...result,
    switched: true,
  });
}

async function handleCmsPublishRequest(req, res) {
  if (req.method !== "POST") {
    sendJson(res, 405, { error: "Method not allowed", detail: "Use POST." }, { Allow: "POST" });
    return;
  }

  let payload;
  try {
    payload = await readJsonRequestBody(req, { maxBytes: 512 * 1024 });
  } catch (error) {
    sendJson(res, 400, { error: "Invalid JSON body", detail: String(error?.message || error) });
    return;
  }

  const activeProfile = getActiveRuntimeEnvironmentProfile();
  const cmsConfig = createCmsRuntimeConfig(activeProfile.env);
  if (!cmsConfig.enabled) {
    sendJson(res, 503, {
      error: "CMS publishing is not configured",
      detail: `Set COMP_SERVICE_INTERNAL_HOST for the active ${activeProfile.label} environment.`,
      environment: {
        code: activeProfile.code,
        label: activeProfile.label,
      },
    });
    return;
  }

  const bundle = resolveCmsPublishBundle(payload);
  if (!bundle.fixturePayload || !bundle.typeReferencePayload || !bundle.parentMarketPayload) {
    sendJson(res, 400, {
      error: "Missing CMS payloads",
      detail:
        "Provide fixture_payload, type_reference_payload, and parent_market_payload directly, or pass fixture_json plus type_reference_payloads and uat_parent_payloads with parent_market_family.",
    });
    return;
  }

  const fixtureValidationErrors = validateFixtureJson(bundle.fixturePayload);
  if (fixtureValidationErrors.length > 0) {
    sendJson(res, 400, {
      error: "Invalid fixture payload",
      detail: fixtureValidationErrors,
    });
    return;
  }

  const result = await publishCmsBundle({
    config: cmsConfig,
    fixturePayload: bundle.fixturePayload,
    typeReferencePayload: bundle.typeReferencePayload,
    parentMarketPayload: bundle.parentMarketPayload,
  });

  const responsePayload = {
    ok: result.ok,
    failed_step: result.failedStep,
    requested_family: bundle.requestedFamily || null,
    environment: {
      code: activeProfile.code,
      label: activeProfile.label,
    },
    steps: result.steps,
  };

  if (!result.ok) {
    sendJson(res, 502, responsePayload);
    return;
  }

  sendJson(res, 200, responsePayload);
}

async function handleCmsFixtureCreateRequest(req, res) {
  let payload;
  try {
    payload = await readJsonRequestBody(req, { maxBytes: 64 * 1024 });
  } catch (err) {
    sendJson(res, 400, { error: "Invalid JSON body", detail: String(err?.message || err) });
    return;
  }

  const gameId = String(payload?.game_id || "").trim();
  const source = String(payload?.source || "").trim();
  const parentMarkets = Array.isArray(payload?.parent_markets) ? payload.parent_markets : [];
  const cname = String(payload?.cname || "").trim();
  const appendix = String(payload?.appendix ?? "");

  if (!gameId) {
    sendJson(res, 400, { error: "game_id is required" });
    return;
  }
  if (!source) {
    sendJson(res, 400, { error: "source is required" });
    return;
  }
  if (!parentMarkets.length) {
    sendJson(res, 400, { error: "parent_markets must be a non-empty array" });
    return;
  }

  const activeProfile = getActiveRuntimeEnvironmentProfile();
  const cmsConfig = createCmsRuntimeConfig(activeProfile.env);
  if (!cmsConfig.enabled) {
    sendJson(res, 503, {
      error: "CMS not configured",
      detail: `Set COMP_SERVICE_INTERNAL_HOST for the active ${activeProfile.label} environment.`,
    });
    return;
  }

  const url = `${cmsConfig.baseUrl}/api/v1/cms/internal/fixtures/create`;
  const headers = { "Content-Type": "application/json" };
  if (cmsConfig.bearerToken) headers.Authorization = `Bearer ${cmsConfig.bearerToken}`;

  let upstream;
  try {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), cmsConfig.timeoutMs);
    try {
      upstream = await fetch(url, {
        method: "POST",
        headers,
        body: JSON.stringify({
          game_id: gameId,
          source,
          parent_markets: parentMarkets,
          cname,
          appendix,
        }),
        signal: controller.signal,
      });
    } finally {
      clearTimeout(timer);
    }
  } catch (err) {
    sendJson(res, 502, { error: "Upstream request failed", detail: String(err?.message || err) });
    return;
  }

  let body;
  try {
    const text = await upstream.text();
    body = text ? JSON.parse(text) : null;
  } catch {
    body = null;
  }

  sendJson(res, upstream.status, body ?? {});
}

async function handleCmsBatchPublishRequest(req, res) {
  if (req.method !== "POST") {
    sendJson(res, 405, { error: "Method not allowed" }, { Allow: "POST" });
    return;
  }

  let payload;
  try {
    payload = await readJsonRequestBody(req, { maxBytes: 512 * 1024 });
  } catch (err) {
    sendJson(res, 400, { error: "Invalid JSON body", detail: String(err?.message || err) });
    return;
  }

  const fixtures = Array.isArray(payload?.fixtures) ? payload.fixtures : [];
  const submarkets = Array.isArray(payload?.submarkets) ? payload.submarkets : [];

  batchLog.info(
    {
      fixtureCount: fixtures.length,
      submarketCount: submarkets.length,
      fixtures: fixtures.map((f) => ({
        id: f.id,
        home: f.home,
        away: f.away,
        league: f.leagueCode,
      })),
      submarkets,
    },
    "publish request received"
  );

  if (!fixtures.length) {
    batchLog.warn("publish rejected: no fixtures");
    sendJson(res, 400, { error: "No fixtures provided." });
    return;
  }
  if (!submarkets.length) {
    batchLog.warn("publish rejected: no submarkets");
    sendJson(res, 400, { error: "No submarkets provided." });
    return;
  }

  const publishKeys = [...new Set(submarkets.flatMap((s) => SUBMARKET_TO_PUBLISH_KEYS[s] || []))];
  if (!publishKeys.length) {
    batchLog.warn({ submarkets }, "no publish keys mapped from submarkets");
    sendJson(res, 400, { error: "None of the provided submarkets map to known CMS publish keys." });
    return;
  }

  const requestedEnvCode = String(payload?.environment || "").trim();
  const activeProfile = requestedEnvCode
    ? getRuntimeEnvironmentProfile(requestedEnvCode)
    : getActiveRuntimeEnvironmentProfile();
  const runId = `run_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;

  batchLog.info(
    {
      runId,
      env: { code: activeProfile.code, label: activeProfile.label },
      fixtures: fixtures.map((f) => f.id || `${f.home} vs ${f.away}`),
      submarkets,
      publishKeys,
    },
    "publish run started"
  );

  const runRecord = createCmsBatchRunRecord({
    runId,
    requestId: runId,
    environment: { code: activeProfile.code, label: activeProfile.label },
    selectedFixtures: fixtures,
    selectedPublishKeys: publishKeys,
    operatorName: "operator",
  });
  batchRunStore.set(runId, runRecord);

  // Kick off async without blocking the response
  executeCmsBatchRun(runId, fixtures, publishKeys, activeProfile, {
    runStore: batchRunStore,
    getDbPoolForEnv,
    getCatalogPayloadCached,
  }).catch((err) => {
    const record = batchRunStore.get(runId);
    if (record) {
      record.status = "failed";
      record.detail = String(err?.message || err);
      record.completed_at = new Date().toISOString();
    }
    batchLog.error({ runId, err }, "unhandled top-level error in batch run");
  });

  sendJson(res, 202, { run_id: runId, status: "queued" });
}

function handleCmsBatchRunRequest(runId, res) {
  if (!runId) {
    sendJson(res, 400, { error: "Missing run ID." });
    return;
  }
  const record = batchRunStore.get(runId);
  if (!record) {
    sendJson(res, 404, { error: "Run not found.", run_id: runId });
    return;
  }
  sendJson(res, 200, record);
}

// Worker entry point — translates a saved integrations envelope into a batch
// run and awaits its completion so the scheduler can record the outcome.
// Throws on empty/invalid payload; the worker turns thrown errors into
// markFailed(jobId, ...).
async function fireScheduledJob(job, { environment } = {}) {
  const envelope = job?.payload || {};
  const payload = envelope?.payload || {};
  const fixtures = Array.isArray(payload.selected_fixtures) ? payload.selected_fixtures : [];
  const publishKeys = Array.isArray(payload.selected_publish_keys)
    ? payload.selected_publish_keys
    : [];

  if (fixtures.length === 0) throw new Error("scheduled job has no selected_fixtures");
  if (publishKeys.length === 0) throw new Error("scheduled job has no selected_publish_keys");

  const targetEnv = String(environment || job?.environment || "").trim() || undefined;
  const activeProfile = targetEnv
    ? getRuntimeEnvironmentProfile(targetEnv)
    : getActiveRuntimeEnvironmentProfile();
  const runId = `run_sched_${(job?.job_id || "").slice(0, 8)}_${Date.now()}`;

  schedulerLog.info(
    {
      jobId: job?.job_id,
      runId,
      env: { code: activeProfile.code, label: activeProfile.label },
      fixtureCount: fixtures.length,
      publishKeyCount: publishKeys.length,
    },
    "firing scheduled job"
  );

  const runRecord = createCmsBatchRunRecord({
    runId,
    requestId: envelope?.request_id || job?.request_id || runId,
    environment: { code: activeProfile.code, label: activeProfile.label },
    selectedFixtures: fixtures,
    selectedPublishKeys: publishKeys,
    operatorName: envelope?.requested_by || job?.created_by || "scheduler",
  });
  batchRunStore.set(runId, runRecord);

  await executeCmsBatchRun(runId, fixtures, publishKeys, activeProfile, {
    runStore: batchRunStore,
    getDbPoolForEnv,
    getCatalogPayloadCached,
  });

  const finalRecord = batchRunStore.get(runId);
  if (finalRecord && finalRecord.status === "failed") {
    throw new Error(
      `scheduled batch run failed: ${finalRecord.detail || finalRecord.summary || "unknown"}`
    );
  }
  return { runId };
}

const cmsScheduler = createCmsScheduler({
  getActiveEnvCode: () => getActiveRuntimeEnvironmentProfile().code,
  getDbPoolForEnv,
  getActiveRuntimeEnvVars,
  fireScheduledJob,
  log: schedulerLog,
  tickIntervalMs: parsePositiveIntegerEnv(process.env.SCHEDULER_TICK_INTERVAL_MS, 60_000, {
    min: 5_000,
  }),
  batchSize: parsePositiveIntegerEnv(process.env.SCHEDULER_BATCH_SIZE, 5, { min: 1 }),
});

// ─── /api/integrations/cms/* — envelope-style batch routes ───────────────────
//
// Wraps the legacy /api/cms/batch-* surface in the operator envelope contract:
//   { environment, action, request_id, requested_by, payload }
// The integrations envelope adds two guarantees the legacy routes never had:
//   1. Confirmation gate — `payload.confirmation.confirmed === true` is required
//      before a batch-publish can run, surfaced as a 400 with `extras.issues`.
//   2. Method gate — `/batch-runs/:id/stop` is POST-only; GET returns 405.
//
// Mainnet/UAT/DEV all pass the env gate; only an unknown environment string is
// reported as the "environment" issue.

const INTEGRATIONS_BATCH_ENV_ALLOWLIST = new Set(["mainnet", "uat", "dev", "testnet"]);

async function handleIntegrationsCmsRequest(req, res, requestUrl) {
  const pathname = requestUrl.pathname;

  if (pathname === "/api/integrations/cms/batch-preflight") {
    if (req.method !== "POST") {
      sendJson(res, 405, { ok: false, error: "Method not allowed" }, { Allow: "POST" });
      return;
    }
    await handleIntegrationsBatchEnvelope(req, res, { kind: "preflight" });
    return;
  }

  if (pathname === "/api/integrations/cms/batch-publish") {
    if (req.method !== "POST") {
      sendJson(res, 405, { ok: false, error: "Method not allowed" }, { Allow: "POST" });
      return;
    }
    await handleIntegrationsBatchEnvelope(req, res, { kind: "publish" });
    return;
  }

  const stopMatch = pathname.match(/^\/api\/integrations\/cms\/batch-runs\/([^/]+)\/stop$/);
  if (stopMatch) {
    if (req.method !== "POST") {
      sendJson(res, 405, { ok: false, error: "Method not allowed" }, { Allow: "POST" });
      return;
    }
    handleIntegrationsBatchStop(stopMatch[1], res);
    return;
  }

  if (pathname === "/api/integrations/cms/schedule-publish") {
    if (req.method !== "POST") {
      sendJson(res, 405, { ok: false, error: "Method not allowed" }, { Allow: "POST" });
      return;
    }
    await handleIntegrationsSchedulePublish(req, res);
    return;
  }

  if (pathname === "/api/integrations/cms/scheduled-jobs") {
    if (req.method !== "GET") {
      sendJson(res, 405, { ok: false, error: "Method not allowed" }, { Allow: "GET" });
      return;
    }
    await handleIntegrationsListScheduledJobs(req, res, requestUrl);
    return;
  }

  const scheduledJobMatch = pathname.match(
    /^\/api\/integrations\/cms\/scheduled-jobs\/([^/]+)(?:\/(cancel|reschedule))?$/
  );
  if (scheduledJobMatch) {
    const jobId = scheduledJobMatch[1];
    const action = scheduledJobMatch[2] || null;
    if (action === null) {
      if (req.method !== "GET") {
        sendJson(res, 405, { ok: false, error: "Method not allowed" }, { Allow: "GET" });
        return;
      }
      await handleIntegrationsGetScheduledJob(jobId, res);
      return;
    }
    if (action === "cancel") {
      if (req.method !== "POST") {
        sendJson(res, 405, { ok: false, error: "Method not allowed" }, { Allow: "POST" });
        return;
      }
      await handleIntegrationsCancelScheduledJob(jobId, res);
      return;
    }
    if (action === "reschedule") {
      if (req.method !== "POST") {
        sendJson(res, 405, { ok: false, error: "Method not allowed" }, { Allow: "POST" });
        return;
      }
      await handleIntegrationsRescheduleScheduledJob(jobId, req, res);
      return;
    }
  }

  sendJson(res, 404, { ok: false, error: "Unknown integrations route", path: pathname });
}

async function handleIntegrationsBatchEnvelope(req, res, { kind }) {
  let envelope;
  try {
    envelope = await readJsonRequestBody(req, { maxBytes: 512 * 1024 });
  } catch (err) {
    sendJson(res, 400, {
      ok: false,
      extras: { issues: ["body.invalid_json"], detail: String(err?.message || err) },
    });
    return;
  }

  const issues = [];
  const env = String(envelope?.environment || "")
    .trim()
    .toLowerCase();
  if (!INTEGRATIONS_BATCH_ENV_ALLOWLIST.has(env)) issues.push("environment");

  const payload = envelope?.payload || {};
  const selectedFixtures = Array.isArray(payload.selected_fixtures)
    ? payload.selected_fixtures
    : [];
  const selectedPublishKeys = Array.isArray(payload.selected_publish_keys)
    ? payload.selected_publish_keys
    : [];
  if (selectedFixtures.length === 0) issues.push("payload.selected_fixtures.empty");
  if (selectedPublishKeys.length === 0) issues.push("payload.selected_publish_keys.empty");

  if (kind === "publish") {
    const confirmation = payload.confirmation || {};
    if (confirmation.confirmed !== true) {
      issues.push("payload.confirmation.confirmed");
    }
  }

  if (issues.length > 0) {
    sendJson(res, 400, { ok: false, extras: { issues } });
    return;
  }

  if (kind === "preflight") {
    sendJson(res, 200, {
      ok: true,
      action: envelope?.action || "batch-preflight",
      request_id: envelope?.request_id,
      environment: env,
      extras: { issues: [] },
    });
    return;
  }

  const runId = `run_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
  const runRecord = {
    runId,
    request_id: envelope?.request_id,
    requested_by: envelope?.requested_by,
    environment: { code: env, label: formatRuntimeEnvironmentLabel(env) },
    status: "queued",
    started_at: new Date().toISOString(),
    selected_fixtures: selectedFixtures,
    selected_publish_keys: selectedPublishKeys,
  };
  batchRunStore.set(runId, runRecord);
  sendJson(res, 202, {
    ok: true,
    run_id: runId,
    status: "queued",
    request_id: envelope?.request_id,
    environment: env,
  });
}

function handleIntegrationsBatchStop(runId, res) {
  const record = batchRunStore.get(runId);
  if (!record) {
    sendJson(res, 404, { ok: false, error: "Run not found.", run_id: runId });
    return;
  }
  record.status = "stopped";
  record.stopped_at = new Date().toISOString();
  record.completed_at = record.completed_at || record.stopped_at;
  sendJson(res, 200, { ok: true, run_id: runId, status: "stopped" });
}

// ─── /api/integrations/cms/schedule-publish — DB-backed scheduler ────────────
//
// Persists the publish envelope into cms_scheduled_jobs. The in-process
// cmsScheduler worker (see startCmsScheduler below) polls the table every
// SCHEDULER_TICK_INTERVAL_MS and fires due jobs through executeCmsBatchRun.
//
// Envelope contract is the same as batch-publish, with one extra required
// field: payload.scheduled_at (ISO 8601 UTC). All envelope validations from
// batch-publish apply here too — including confirmation.confirmed === true.

async function handleIntegrationsSchedulePublish(req, res) {
  let envelope;
  try {
    envelope = await readJsonRequestBody(req, { maxBytes: 512 * 1024 });
  } catch (err) {
    sendJson(res, 400, {
      ok: false,
      extras: { issues: ["body.invalid_json"], detail: String(err?.message || err) },
    });
    return;
  }

  const issues = [];
  const env = String(envelope?.environment || "")
    .trim()
    .toLowerCase();
  if (!INTEGRATIONS_BATCH_ENV_ALLOWLIST.has(env)) issues.push("environment");

  const payload = envelope?.payload || {};
  const selectedFixtures = Array.isArray(payload.selected_fixtures)
    ? payload.selected_fixtures
    : [];
  const selectedPublishKeys = Array.isArray(payload.selected_publish_keys)
    ? payload.selected_publish_keys
    : [];
  if (selectedFixtures.length === 0) issues.push("payload.selected_fixtures.empty");
  if (selectedPublishKeys.length === 0) issues.push("payload.selected_publish_keys.empty");

  const confirmation = payload.confirmation || {};
  if (confirmation.confirmed !== true) {
    issues.push("payload.confirmation.confirmed");
  }

  const scheduledAtRaw = String(payload.scheduled_at || "").trim();
  let scheduledAt = null;
  if (!scheduledAtRaw) {
    issues.push("payload.scheduled_at.required");
  } else {
    const parsed = new Date(scheduledAtRaw);
    if (Number.isNaN(parsed.getTime())) {
      issues.push("payload.scheduled_at.invalid");
    } else if (parsed.getTime() <= Date.now()) {
      issues.push("payload.scheduled_at.in_past");
    } else {
      scheduledAt = parsed;
    }
  }

  if (issues.length > 0) {
    sendJson(res, 400, { ok: false, extras: { issues } });
    return;
  }

  const profile = getRuntimeEnvironmentProfile(env);
  const pool = getDbPoolForEnv(profile.env);
  if (!pool) {
    sendJson(res, 503, {
      ok: false,
      error: "DB not configured for environment",
      detail: `Set DB_HOST/DB_USER/DB_NAME for ${profile.label}.`,
    });
    return;
  }

  let job;
  try {
    job = await insertScheduledJob(pool, {
      environment: env,
      scheduledAt,
      payload: envelope,
      requestId: envelope?.request_id || null,
      createdBy: envelope?.requested_by || null,
    });
  } catch (err) {
    schedulerLog.error(
      { err: String(err?.message || err), env, requestId: envelope?.request_id },
      "schedule-publish insert failed"
    );
    sendJson(res, 500, {
      ok: false,
      error: "Failed to persist scheduled job",
      detail: String(err?.message || err),
    });
    return;
  }

  schedulerLog.info(
    { jobId: job.job_id, env, scheduledAt: job.scheduled_at, requestId: envelope?.request_id },
    "scheduled-job created"
  );
  sendJson(res, 202, {
    ok: true,
    job_id: job.job_id,
    status: job.status,
    scheduled_at: job.scheduled_at,
    environment: env,
    request_id: envelope?.request_id || null,
  });
}

async function handleIntegrationsListScheduledJobs(req, res, requestUrl) {
  const env = String(requestUrl.searchParams.get("environment") || "")
    .trim()
    .toLowerCase();
  const status = String(requestUrl.searchParams.get("status") || "")
    .trim()
    .toLowerCase();
  const limit = Number(requestUrl.searchParams.get("limit") || 100);

  const targetEnv = env || getActiveRuntimeEnvironmentProfile().code;
  if (env && !INTEGRATIONS_BATCH_ENV_ALLOWLIST.has(env)) {
    sendJson(res, 400, { ok: false, extras: { issues: ["environment"] } });
    return;
  }

  const profile = getRuntimeEnvironmentProfile(targetEnv);
  const pool = getDbPoolForEnv(profile.env);
  if (!pool) {
    sendJson(res, 200, { ok: true, jobs: [], environment: targetEnv, db_configured: false });
    return;
  }

  try {
    const jobs = await listScheduledJobs(pool, {
      environment: targetEnv,
      status: status || null,
      limit: Number.isFinite(limit) ? limit : 100,
    });
    sendJson(res, 200, { ok: true, jobs, environment: targetEnv, db_configured: true });
  } catch (err) {
    sendJson(res, 500, {
      ok: false,
      error: "Failed to list scheduled jobs",
      detail: String(err?.message || err),
    });
  }
}

async function handleIntegrationsGetScheduledJob(jobId, res) {
  const profile = getActiveRuntimeEnvironmentProfile();
  const pool = getDbPoolForEnv(profile.env);
  if (!pool) {
    sendJson(res, 503, { ok: false, error: "DB not configured for active environment" });
    return;
  }
  try {
    const job = await getScheduledJob(pool, jobId);
    if (!job) {
      sendJson(res, 404, { ok: false, error: "Scheduled job not found", job_id: jobId });
      return;
    }
    sendJson(res, 200, { ok: true, job });
  } catch (err) {
    sendJson(res, 500, {
      ok: false,
      error: "Failed to load scheduled job",
      detail: String(err?.message || err),
    });
  }
}

async function handleIntegrationsCancelScheduledJob(jobId, res) {
  const profile = getActiveRuntimeEnvironmentProfile();
  const pool = getDbPoolForEnv(profile.env);
  if (!pool) {
    sendJson(res, 503, { ok: false, error: "DB not configured for active environment" });
    return;
  }
  try {
    const job = await cancelScheduledJobInRepo(pool, jobId);
    if (!job) {
      sendJson(res, 409, {
        ok: false,
        error: "Job not cancellable",
        detail: "Job missing or no longer pending.",
        job_id: jobId,
      });
      return;
    }
    schedulerLog.info({ jobId }, "scheduled-job cancelled");
    sendJson(res, 200, { ok: true, job });
  } catch (err) {
    sendJson(res, 500, {
      ok: false,
      error: "Failed to cancel scheduled job",
      detail: String(err?.message || err),
    });
  }
}

async function handleIntegrationsRescheduleScheduledJob(jobId, req, res) {
  let body;
  try {
    body = await readJsonRequestBody(req, { maxBytes: 16 * 1024 });
  } catch (err) {
    sendJson(res, 400, {
      ok: false,
      extras: { issues: ["body.invalid_json"], detail: String(err?.message || err) },
    });
    return;
  }
  const raw = String(body?.scheduled_at || "").trim();
  if (!raw) {
    sendJson(res, 400, { ok: false, extras: { issues: ["scheduled_at.required"] } });
    return;
  }
  const parsed = new Date(raw);
  if (Number.isNaN(parsed.getTime())) {
    sendJson(res, 400, { ok: false, extras: { issues: ["scheduled_at.invalid"] } });
    return;
  }
  if (parsed.getTime() <= Date.now()) {
    sendJson(res, 400, { ok: false, extras: { issues: ["scheduled_at.in_past"] } });
    return;
  }

  const profile = getActiveRuntimeEnvironmentProfile();
  const pool = getDbPoolForEnv(profile.env);
  if (!pool) {
    sendJson(res, 503, { ok: false, error: "DB not configured for active environment" });
    return;
  }
  try {
    const job = await rescheduleScheduledJobInRepo(pool, jobId, parsed);
    if (!job) {
      sendJson(res, 409, {
        ok: false,
        error: "Job not reschedulable",
        detail: "Job missing or no longer pending.",
        job_id: jobId,
      });
      return;
    }
    schedulerLog.info({ jobId, scheduledAt: job.scheduled_at }, "scheduled-job rescheduled");
    sendJson(res, 200, { ok: true, job });
  } catch (err) {
    sendJson(res, 500, {
      ok: false,
      error: "Failed to reschedule job",
      detail: String(err?.message || err),
    });
  }
}

async function handleDebugDbRequest(res) {
  const pool = getDbPoolForEnv(getActiveRuntimeEnvVars());
  if (!pool) {
    sendJson(res, 503, { error: "DB not configured for active environment" });
    return;
  }
  try {
    const schema = await discoverSchema(pool);
    const relevantTables = [
      "fixtures",
      "type_references",
      "parent_markets",
      "markets",
      "leagues",
      "teams",
    ];
    const samples = {};
    for (const table of relevantTables) {
      if (!schema[table]) continue;
      try {
        const r = await pool.query(
          `SELECT * FROM ${table} ORDER BY created_at DESC NULLS LAST LIMIT 3`
        );
        samples[table] = { columns: schema[table], rows: r.rows };
      } catch (e) {
        samples[table] = { columns: schema[table], error: e.message };
      }
    }
    sendJson(res, 200, {
      schema: Object.fromEntries(
        relevantTables.filter((t) => schema[t]).map((t) => [t, schema[t]])
      ),
      samples,
    });
  } catch (err) {
    sendJson(res, 500, { error: err.message });
  }
}

async function handleDbVerifyFixtureRequest(req, res) {
  const pool = getDbPoolForEnv(getActiveRuntimeEnvVars());
  if (!pool) {
    sendJson(res, 503, { error: "DB not configured for active environment" });
    return;
  }
  let body;
  try {
    body = await readJsonRequestBody(req);
  } catch {
    sendJson(res, 400, { error: "Invalid JSON body" });
    return;
  }
  const query = String(body?.event_name || body?.fixture_id || "").trim();
  if (!query) {
    sendJson(res, 400, { error: "event_name or fixture_id required" });
    return;
  }
  try {
    let fixtureRows;
    // If it looks like a UUID, do exact lookup; otherwise name search
    if (/^[0-9a-f-]{32,36}$/i.test(query)) {
      const r = await pool.query(
        `SELECT f.*, l.name AS league_name FROM fixtures f
         LEFT JOIN leagues l ON l.league_id = f.league_id
         WHERE f.fixture_id = $1 LIMIT 1`,
        [query]
      );
      fixtureRows = r.rows;
    } else {
      const r = await pool.query(
        `SELECT f.*, l.name AS league_name FROM fixtures f
         LEFT JOIN leagues l ON l.league_id = f.league_id
         WHERE f.name ILIKE $1 OR f.alternate_name ILIKE $1
         ORDER BY f.game_start_time DESC NULLS LAST LIMIT 10`,
        [`%${query}%`]
      );
      fixtureRows = r.rows;
    }

    const result = await Promise.all(
      fixtureRows.map(async (fixture) => {
        const fid = fixture.fixture_id;
        const typeRefRes = await pool.query(
          `SELECT * FROM type_references WHERE type_value = 'fixture' AND type_value_id = $1 ORDER BY created_at DESC NULLS LAST`,
          [fid]
        );
        const typeRefs = typeRefRes.rows;
        const typeRefIds = typeRefs.map((r) => r.type_reference_id || r.id).filter(Boolean);
        let parentMarkets = [];
        if (typeRefIds.length > 0) {
          const pmRes = await pool.query(
            `SELECT * FROM parent_markets WHERE type_reference_id = ANY($1) ORDER BY created_at DESC NULLS LAST`,
            [typeRefIds]
          );
          parentMarkets = pmRes.rows;
        }
        return {
          fixture,
          type_references: typeRefs,
          parent_markets: parentMarkets,
        };
      })
    );

    sendJson(res, 200, { results: result, count: result.length });
  } catch (err) {
    sendJson(res, 500, { error: err.message });
  }
}

async function handleDbVerifyTypeReferenceRequest(req, res) {
  const pool = getDbPoolForEnv(getActiveRuntimeEnvVars());
  if (!pool) {
    sendJson(res, 503, { error: "DB not configured for active environment" });
    return;
  }
  let body;
  try {
    body = await readJsonRequestBody(req);
  } catch {
    sendJson(res, 400, { error: "Invalid JSON body" });
    return;
  }

  const typeValueId = normalizeDbLookupValue(body?.type_value_id || body?.typeValueId);
  if (!typeValueId) {
    sendJson(res, 400, { error: "type_value_id required" });
    return;
  }

  try {
    const typeRefRes = await pool.query(
      `SELECT *
         FROM type_references
        WHERE type_value = 'fixture' AND type_value_id = $1
        ORDER BY created_at DESC NULLS LAST`,
      [typeValueId]
    );

    const typeRefs = typeRefRes.rows;
    const typeRefIds = typeRefs.map((row) => row.type_reference_id).filter(Boolean);

    let parentMarkets = [];
    if (typeRefIds.length > 0) {
      const parentMarketRes = await pool.query(
        `SELECT *
           FROM parent_markets
          WHERE type_reference_id = ANY($1)
          ORDER BY created_at DESC NULLS LAST`,
        [typeRefIds]
      );
      parentMarkets = parentMarketRes.rows;
    }

    sendJson(res, 200, {
      type_value_id: typeValueId,
      type_references: typeRefs,
      parent_markets: parentMarkets,
      count: typeRefs.length,
    });
  } catch (err) {
    sendJson(res, 500, { error: err.message });
  }
}

async function handleDbVerifyParentMarketRequest(req, res) {
  const pool = getDbPoolForEnv(getActiveRuntimeEnvVars());
  if (!pool) {
    sendJson(res, 503, { error: "DB not configured for active environment" });
    return;
  }
  let body;
  try {
    body = await readJsonRequestBody(req);
  } catch {
    sendJson(res, 400, { error: "Invalid JSON body" });
    return;
  }

  const typeReferenceId = normalizeDbLookupValue(body?.type_reference_id || body?.typeReferenceId);
  if (!typeReferenceId) {
    sendJson(res, 400, { error: "type_reference_id required" });
    return;
  }

  try {
    const parentMarketRes = await pool.query(
      `SELECT *
         FROM parent_markets
        WHERE type_reference_id = $1
        ORDER BY created_at DESC NULLS LAST`,
      [typeReferenceId]
    );

    const parentMarkets = parentMarketRes.rows;
    const parentMarketIds = parentMarkets.map((row) => row.parent_market_id).filter(Boolean);

    let markets = [];
    if (parentMarketIds.length > 0) {
      const marketsRes = await pool.query(
        `SELECT *
           FROM markets
          WHERE parent_market_id = ANY($1)
          ORDER BY created_at DESC NULLS LAST`,
        [parentMarketIds]
      );
      markets = marketsRes.rows;
    }

    sendJson(res, 200, {
      type_reference_id: typeReferenceId,
      parent_markets: parentMarkets,
      markets,
      count: parentMarkets.length,
    });
  } catch (err) {
    sendJson(res, 500, { error: err.message });
  }
}

async function handleJsonBuildOutputsRequest(req, res) {
  let body;
  try {
    body = await readJsonRequestBody(req);
  } catch {
    sendJson(res, 400, { error: "Invalid JSON body" });
    return;
  }

  const fixtureName = String(body?.fixture_name || "").trim();
  const homeTeamName = String(body?.home_team || "").trim();
  const homeTeamId = String(body?.home_team_id || "").trim();
  const homeTeamAlt = String(body?.home_team_alt || homeTeamName).trim();
  const awayTeamName = String(body?.away_team || "").trim();
  const awayTeamId = String(body?.away_team_id || "").trim();
  const awayTeamAlt = String(body?.away_team_alt || awayTeamName).trim();
  const leagueName = String(body?.league_name || "").trim();
  const leagueId = String(body?.league_id || "").trim();
  const kickoffIso = String(body?.kickoff_iso || "").trim();
  const typeRefId = String(body?.type_reference_id || "").trim() || randomUUID();
  const leaves = Array.isArray(body?.leaves) ? body.leaves : [];

  if (!fixtureName) {
    sendJson(res, 400, { error: "fixture_name is required" });
    return;
  }
  if (!kickoffIso) {
    sendJson(res, 400, { error: "kickoff_iso is required" });
    return;
  }

  const kickoffDate = kickoffIso.slice(0, 10);
  const kickoffTime = kickoffIso.slice(11, 16);
  const pool = getDbPoolForEnv(getActiveRuntimeEnvVars());
  const fallbackLeagueSlug = slugifyLookupValue(leagueName) || "league";
  const league = await resolveLeagueRecordFromDb(pool, {
    leagueId,
    leagueName,
    leagueSlug: fallbackLeagueSlug,
  });
  const [homeTeamRecord, awayTeamRecord] = await Promise.all([
    resolveTeamRecordFromDb(pool, {
      teamId: homeTeamId,
      teamName: homeTeamName,
      leagueId: league.id,
    }),
    resolveTeamRecordFromDb(pool, {
      teamId: awayTeamId,
      teamName: awayTeamName,
      leagueId: league.id,
    }),
  ]);

  const homeTeam = {
    id: homeTeamRecord.id,
    name: homeTeamRecord.name || homeTeamName,
    alternateName: homeTeamRecord.alternateName || homeTeamAlt,
  };
  const awayTeam = {
    id: awayTeamRecord.id,
    name: awayTeamRecord.name || awayTeamName,
    alternateName: awayTeamRecord.alternateName || awayTeamAlt,
  };

  const fixturePayload = {
    name: fixtureName,
    league_id: league.id,
    home_team_id: homeTeam.id || null,
    away_team_id: awayTeam.id || null,
    format: null,
    logo_url: "https://public-assets.pred.app/market-assets/fixture_128x128.png",
    theme_color: "#FFFFFF",
    match_day: 1,
    match_week: 0,
    location: "",
    venue: "",
    game_start_time: kickoffIso || null,
    alternate_name: buildUatFixtureAlternateName(homeTeam, awayTeam),
  };

  const parentPayloads = [];
  for (const leaf of leaves) {
    const marketFamily = String(leaf?.market_family || "")
      .trim()
      .toLowerCase();
    const marketLine = String(leaf?.market_line || "1.5").trim();
    const spreadTeamSide = String(leaf?.spread_team_side || "home")
      .trim()
      .toLowerCase();
    const leafId = String(leaf?.id || "").trim();
    const validFamilies = ["moneyline", "spreads", "totals", "btts"];
    if (!validFamilies.includes(marketFamily)) continue;

    const payloads = buildUatParentPayloads({
      fixtureJson: { name: fixtureName, league_id: league.id },
      league,
      homeTeam,
      awayTeam,
      fixtureDateIso: kickoffDate,
      kickoffTimeUtc: kickoffTime,
      openIso: kickoffIso,
      createdAtIso: new Date().toISOString(),
      typeReferenceId: typeRefId,
      outputProfile: "uat",
      marketLine,
      spreadTeamSide,
    });

    if (payloads && payloads[marketFamily]) {
      parentPayloads.push({ id: leafId, payload: payloads[marketFamily] });
    }
  }

  sendJson(res, 200, {
    type_reference_id: typeRefId,
    fixture_payload: fixturePayload,
    parent_payloads: parentPayloads,
    teams_resolved: Boolean(homeTeam.id && awayTeam.id),
    league_resolved: Boolean(league.id),
  });
}

async function handleJsonGenerateParentMarketRequest(req, res) {
  const pool = getDbPoolForEnv(getActiveRuntimeEnvVars());
  if (!pool) {
    sendJson(res, 503, { error: "DB not configured for active environment" });
    return;
  }
  let body;
  try {
    body = await readJsonRequestBody(req);
  } catch {
    sendJson(res, 400, { error: "Invalid JSON body" });
    return;
  }

  const fixtureName = String(body?.fixture_name || "").trim();
  const typeRefId = String(body?.type_reference_id || "").trim();
  const marketFamily = String(body?.market_family || "")
    .trim()
    .toLowerCase();
  const marketLine = String(body?.market_line || "1.5").trim();
  const spreadTeamSide = String(body?.spread_team_side || "home")
    .trim()
    .toLowerCase();

  const validFamilies = ["moneyline", "spreads", "totals", "btts"];
  if (!fixtureName) {
    sendJson(res, 400, { error: "fixture_name is required" });
    return;
  }
  if (!validFamilies.includes(marketFamily)) {
    sendJson(res, 400, { error: `market_family must be one of: ${validFamilies.join(", ")}` });
    return;
  }

  try {
    const r = await pool.query(
      `SELECT
         f.fixture_id, f.name, f.league_id, f.home_team_id, f.away_team_id, f.game_start_time,
         l.name AS league_name, l.alternate_name AS league_alternate_name,
         ht.name  AS home_team_name,  ht.alternate_name AS home_team_alternate,
         at2.name AS away_team_name, at2.alternate_name AS away_team_alternate
       FROM fixtures f
       LEFT JOIN leagues l  ON l.league_id  = f.league_id
       LEFT JOIN teams ht   ON ht.team_id   = f.home_team_id
       LEFT JOIN teams at2  ON at2.team_id  = f.away_team_id
       WHERE f.name ILIKE $1 OR f.alternate_name ILIKE $1
       ORDER BY f.game_start_time DESC NULLS LAST
       LIMIT 5`,
      [`%${fixtureName}%`]
    );

    if (!r.rows.length) {
      sendJson(res, 404, { error: `No fixture found matching "${fixtureName}"` });
      return;
    }

    const row = r.rows[0];
    const kickoffIso = row.game_start_time ? new Date(row.game_start_time).toISOString() : "";
    const kickoffDate = kickoffIso.slice(0, 10);
    const kickoffTime = kickoffIso.slice(11, 16);

    const leagueName = String(row.league_name || "").trim();
    const leagueSlug =
      leagueName
        .toLowerCase()
        .replace(/[^a-z0-9]+/g, "-")
        .replace(/^-+|-+$/g, "") || "league";

    const league = { id: String(row.league_id || "").trim(), name: leagueName, slug: leagueSlug };
    const homeTeam = {
      id: String(row.home_team_id || "").trim(),
      name: String(row.home_team_name || "").trim(),
      alternateName: String(row.home_team_alternate || row.home_team_name || "").trim(),
    };
    const awayTeam = {
      id: String(row.away_team_id || "").trim(),
      name: String(row.away_team_name || "").trim(),
      alternateName: String(row.away_team_alternate || row.away_team_name || "").trim(),
    };
    const fixtureJson = { name: String(row.name || "").trim(), league_id: league.id };

    const parentPayloads = buildUatParentPayloads({
      fixtureJson,
      league,
      homeTeam,
      awayTeam,
      fixtureDateIso: kickoffDate,
      kickoffTimeUtc: kickoffTime,
      openIso: kickoffIso,
      createdAtIso: new Date().toISOString(),
      typeReferenceId: typeRefId,
      outputProfile: "uat",
      marketLine,
      spreadTeamSide,
    });

    if (!parentPayloads) {
      sendJson(res, 422, { error: "Failed to build parent market payload — check fixture data" });
      return;
    }

    const familyPayload = parentPayloads[marketFamily];
    if (!familyPayload) {
      sendJson(res, 422, { error: `No payload generated for family "${marketFamily}"` });
      return;
    }

    sendJson(res, 200, {
      family: marketFamily,
      fixture: { id: row.fixture_id, name: row.name, game_start_time: row.game_start_time },
      payload: familyPayload,
    });
  } catch (err) {
    sendJson(res, 500, { error: err.message });
  }
}

async function handleJsonLeaguesRequest(res) {
  const pool = getDbPoolForEnv(getActiveRuntimeEnvVars());
  if (!pool) {
    sendJson(res, 503, { error: "DB not configured for active environment" });
    return;
  }
  try {
    const result = await pool.query(
      `SELECT league_id, name, alternate_name, active_logo_url, theme_color
       FROM leagues ORDER BY lower(name)`
    );
    sendJson(res, 200, { leagues: result.rows });
  } catch (err) {
    sendJson(res, 500, { error: err.message });
  }
}

async function handleJsonTeamsRequest(res, requestUrl) {
  const pool = getDbPoolForEnv(getActiveRuntimeEnvVars());
  if (!pool) {
    sendJson(res, 200, { teams: [] });
    return;
  }
  const q = String(requestUrl.searchParams.get("q") || "").trim();
  if (q.length < 2) {
    sendJson(res, 200, { teams: [] });
    return;
  }
  try {
    const r = await pool.query(
      `SELECT team_id, name, alternate_name, logo_url
       FROM teams
       WHERE name ILIKE $1 OR alternate_name ILIKE $1
       ORDER BY name LIMIT 12`,
      [`%${q}%`]
    );
    sendJson(res, 200, { teams: r.rows });
  } catch (err) {
    sendJson(res, 500, { error: err.message });
  }
}

async function handleReadyRequest(res) {
  try {
    const paths = await resolveCatalogPaths();
    await Promise.all([fs.stat(paths.leagues), fs.stat(paths.teams)]);
    sendJson(res, 200, {
      status: "ready",
      timestamp: new Date().toISOString(),
      source_kind: paths.sourceKind,
    });
  } catch (error) {
    sendJson(res, 503, {
      status: "not_ready",
      timestamp: new Date().toISOString(),
      detail: String(error?.message || error),
    });
  }
}

async function handleCatalogMetaRequest(res) {
  try {
    const payload = await getCatalogPayloadCached();
    sendJson(res, 200, {
      source: payload.source,
      counts: payload.counts,
      loaded_at: payload.loaded_at,
      cache: payload.cache || null,
      schedule_support: payload.schedule_support || null,
    });
  } catch (error) {
    const sourceMeta = await getCatalogSourceMetaSafe();
    sendJson(res, 500, {
      error: "Failed to read CSV source files",
      detail: String(error?.message || error),
      source: sourceMeta,
    });
  }
}

async function handleUpcomingScheduleRequest(requestUrl, res) {
  const requestedLeague = String(requestUrl.searchParams.get("league") || "")
    .trim()
    .toLowerCase();
  const leagueCode = normalizeScheduleLeagueCode(requestedLeague);
  const requestedNow = String(requestUrl.searchParams.get("now") || "").trim();
  if (!leagueCode) {
    const supportedLeagues = getLeagueScheduleDefinitions().map(
      (definition) => `?league=${definition.code}`
    );
    const supportedLeagueDetail =
      supportedLeagues.length > 1
        ? `${supportedLeagues.slice(0, -1).join(", ")}, or ${supportedLeagues.at(-1)}`
        : supportedLeagues[0] || "?league=<code>";
    sendJson(res, 400, {
      error: "Unsupported league",
      detail: `Pass ${supportedLeagueDetail} for the wired schedule provider.`,
    });
    return;
  }

  let referenceNow = null;
  if (requestedNow) {
    const parsed = new Date(requestedNow);
    if (Number.isNaN(parsed.getTime())) {
      sendJson(res, 400, {
        error: "Invalid now parameter",
        detail: "Pass ?now as a valid ISO-8601 UTC timestamp.",
      });
      return;
    }
    referenceNow = parsed;
  }

  try {
    const payload = await getUpcomingSchedulePayload(
      leagueCode,
      {
        refresh: requestUrl.searchParams.get("refresh") === "1",
        now: referenceNow,
      },
      schedCtx
    );
    sendJson(res, 200, payload, {
      "Cache-Control": "no-store",
    });
  } catch (error) {
    sendJson(res, 502, {
      error: "Failed to load schedule data",
      detail: String(error?.message || error),
      league: leagueCode,
    });
  }
}

function handleScheduleStatusRequest(res) {
  sendJson(res, 200, { leagues: getScheduleCacheSnapshot() });
}

async function handleAllSchedulesRequest(res) {
  const payload = await getAllSchedulesPayload(schedCtx);
  sendJson(res, 200, payload);
}

async function fetchRawScheduleRows(leagueCode) {
  return await resolveRawScheduleRowsWithFallback({
    loadSportsData: async () => {
      const sportsDataAdapter = getBackendFixtureSourceAdapter("sportsdata");
      return await sportsDataAdapter.fetchRawRows({
        leagueCode,
        env: getActiveRuntimeEnvVars(),
        rootDir: ROOT_DIR,
        timeoutMs: resolveScheduleFetchTimeoutMs(),
        baseUrl: resolveSportsDataScheduleBaseUrl(),
        season: resolveSportsDataScheduleSeason(),
      });
    },
    loadLsportsDb: async () => {
      const dbPool = getDbPoolForEnv(getActiveRuntimeEnvVars());
      const leagueDef = getLeagueScheduleDefinition(leagueCode);
      const leagueNameLike = leagueDef?.lsportsLeagueNameLike || "";
      if (!dbPool || !leagueNameLike) {
        return null;
      }
      const lsportsDbAdapter = getBackendFixtureSourceAdapter("lsports-db");
      return await lsportsDbAdapter.fetchRawRows({
        leagueCode,
        pool: dbPool,
        leagueNameLike,
        now: resolveScheduleNow(),
      });
    },
    loadGammaPolymarket: async () => {
      const gammaAdapter = getBackendFixtureSourceAdapter("gamma-polymarket");
      if (!gammaAdapter) {
        return null;
      }
      return await gammaAdapter.fetchRawRows({
        leagueCode,
        env: getActiveRuntimeEnvVars(),
        timeoutMs: resolveScheduleFetchTimeoutMs(),
        fetchImpl: fetch,
      });
    },
    loadPolymarket: async () => {
      const polymarketAdapter = getBackendFixtureSourceAdapter("polymarket");
      if (!polymarketAdapter) {
        return null;
      }
      return await polymarketAdapter.fetchRawRows({
        leagueCode,
        env: getActiveRuntimeEnvVars(),
        timeoutMs: resolveScheduleFetchTimeoutMs(),
        fetchImpl: fetch,
      });
    },
    loadLsportsCsv: async () => {
      const csvPath = LSPORTS_SCHEDULE_CSV_PATH;
      if (!csvPath) {
        return null;
      }
      const csvPayload = fetchLsportsCsvFixturesForLeague({
        csvFilePath: csvPath,
        leagueCode,
        now: resolveScheduleNow(),
      });
      if (!csvPayload?.fixtures?.length) {
        return null;
      }
      return csvPayload.fixtures.map((fixture) => ({
        gameId: fixture.gameId,
        game_id: fixture.game_id,
        eventName: fixture.eventName,
        event_name: fixture.event_name,
        homeTeamName: fixture.homeTeamName,
        home_team_name: fixture.home_team_name,
        awayTeamName: fixture.awayTeamName,
        away_team_name: fixture.away_team_name,
        fixtureDate: fixture.fixtureDate,
        fixture_date: fixture.fixture_date,
        kickoffTimeUtc: fixture.kickoffTimeUtc,
        kickoff_time_utc: fixture.kickoff_time_utc,
        kickoffIso: fixture.kickoffIso,
        kickoff_iso: fixture.kickoff_iso,
        status: fixture.status,
        provider: fixture.provider,
      }));
    },
  });
}

function normalizeScheduleLeagueCode(value) {
  return resolveLeagueScheduleCode(value);
}

async function handleScheduleLeaguesRequest(res) {
  const env = getActiveRuntimeEnvVars();
  const pool = getDbPoolForEnv(env);

  let support;
  try {
    let catalogLeagues = [];
    if (pool) {
      try {
        const dbCatalog = await queryCatalogRowsFromDb(pool);
        catalogLeagues = dbCatalog.leagues || [];
      } catch {
        const catalogPayload = await getCatalogPayloadCached();
        catalogLeagues = normalizeLeagueRows(catalogPayload.leagues || []);
      }
    }
    support = await createScheduleSupportMetadata({
      env,
      pool,
      leagues: catalogLeagues,
      csvFilePath: LSPORTS_SCHEDULE_CSV_PATH,
    });
  } catch {
    // Fallback to simple SportsData-only check on any error
    support = createSportsDataScheduleSupportMetadata({ env });
  }

  const supportLeagueMap = new Map((support.leagues || []).map((l) => [l.code, l]));
  const leagues = getLeagueScheduleDefinitions().map((def) => ({
    code: def.code,
    label: def.label,
    source: supportLeagueMap.get(def.code)?.config_source || "gamma-polymarket",
  }));

  sendJson(res, 200, { leagues });
}

function resolveLsportsScheduleCsvPath() {
  const fromEnv = String(process.env.LSPORTS_SCHEDULE_CSV_PATH || "").trim();
  if (fromEnv) {
    const resolved = path.isAbsolute(fromEnv) ? fromEnv : path.join(ROOT_DIR, fromEnv);
    return existsSync(resolved) ? resolved : "";
  }
  const defaultPath = path.join(ROOT_DIR, "catalog", "lsports_schedule_fixtures.csv");
  return existsSync(defaultPath) ? defaultPath : "";
}

function getSportsDataScheduleConfig(leagueCode) {
  return buildSportsDataRuntimeConfig({
    leagueCode,
    env: getActiveRuntimeEnvVars(),
    baseUrl: resolveSportsDataScheduleBaseUrl(),
    season: resolveSportsDataScheduleSeason(),
  });
}

function resolveScheduleNow() {
  const scheduleNowIso = String(
    getActiveRuntimeEnvVars()?.SCHEDULE_NOW_ISO || SCHEDULE_NOW_ISO || ""
  ).trim();
  if (scheduleNowIso) {
    const parsed = new Date(scheduleNowIso);
    if (!Number.isNaN(parsed.getTime())) {
      return parsed;
    }
  }
  return new Date();
}

async function serveStaticFile(urlPathname, res) {
  let pathname = decodeURIComponent(urlPathname);
  if (pathname === "/") {
    pathname = "/index.html";
  }

  const vendorPath = resolveVendorAssetPath(pathname);
  let safePath = vendorPath;
  if (!safePath) {
    const candidates = [];

    const publicPath = resolveSafeStaticPath(PUBLIC_DIR, pathname);
    if (publicPath) {
      candidates.push(publicPath);
    }

    if (pathname.startsWith("/src/")) {
      const sourcePath = resolveSafeStaticPath(ROOT_DIR, pathname);
      if (sourcePath) {
        candidates.push(sourcePath);
      }
    }

    for (const candidate of candidates) {
      try {
        await fs.stat(candidate);
        safePath = candidate;
        break;
      } catch {
        // Try the next candidate.
      }
    }

    if (!safePath) {
      sendText(res, 404, "Not Found");
      return;
    }
  }

  let stat;
  try {
    stat = await fs.stat(safePath);
  } catch {
    sendText(res, 404, "Not Found");
    return;
  }

  if (stat.isDirectory()) {
    const indexPath = path.join(safePath, "index.html");
    try {
      const fileBuffer = await fs.readFile(indexPath);
      const ext = path.extname(indexPath).toLowerCase();
      res.writeHead(
        200,
        buildResponseHeaders(
          MIME_TYPES[ext] || "application/octet-stream",
          fileBuffer.length,
          {},
          { cacheControl: resolveStaticCacheControl(ext) }
        )
      );
      res.end(fileBuffer);
      return;
    } catch {
      sendText(res, 404, "Not Found");
      return;
    }
  }

  const ext = path.extname(safePath).toLowerCase();
  const contentType = MIME_TYPES[ext] || "application/octet-stream";
  const fileBuffer = await fs.readFile(safePath);
  res.writeHead(
    200,
    buildResponseHeaders(
      contentType,
      fileBuffer.length,
      {},
      { cacheControl: resolveStaticCacheControl(ext) }
    )
  );
  res.end(fileBuffer);
}

function resolveSafeStaticPath(baseDir, pathname) {
  const safePath = path.resolve(baseDir, `.${pathname}`);
  const relativePath = path.relative(baseDir, safePath);
  if (relativePath.startsWith("..") || path.isAbsolute(relativePath)) {
    return null;
  }
  return safePath;
}

function resolveVendorAssetPath(pathname) {
  const normalized = String(pathname || "").replace(/\/{2,}/g, "/");
  if (!normalized.startsWith("/vendor/ocr/")) {
    return null;
  }

  const relative = normalized.slice("/vendor/ocr/".length);
  if (!isSafeVendorRelativePath(relative)) {
    return null;
  }

  if (relative === "tesseract.min.js") {
    return path.join(ROOT_DIR, "node_modules", "tesseract.js", "dist", "tesseract.min.js");
  }
  if (relative === "worker.min.js") {
    return path.join(ROOT_DIR, "node_modules", "tesseract.js", "dist", "worker.min.js");
  }

  if (relative.startsWith("tesseract-core/")) {
    return path.join(
      ROOT_DIR,
      "node_modules",
      "tesseract.js-core",
      relative.slice("tesseract-core/".length)
    );
  }

  if (relative.startsWith("tessdata/eng/4.0.0/")) {
    return path.join(
      ROOT_DIR,
      "node_modules",
      "@tesseract.js-data",
      "eng",
      "4.0.0",
      relative.slice("tessdata/eng/4.0.0/".length)
    );
  }

  if (relative.startsWith("tessdata/eng/4.0.0_best_int/")) {
    return path.join(
      ROOT_DIR,
      "node_modules",
      "@tesseract.js-data",
      "eng",
      "4.0.0_best_int",
      relative.slice("tessdata/eng/4.0.0_best_int/".length)
    );
  }

  return null;
}

function isSafeVendorRelativePath(relative) {
  if (!relative || typeof relative !== "string") {
    return false;
  }
  if (relative.includes("\0")) {
    return false;
  }
  const normalized = path.posix.normalize(relative);
  if (normalized.startsWith("../") || normalized === "..") {
    return false;
  }
  return !path.isAbsolute(normalized);
}

function resolveStaticCacheControl(ext) {
  if (ext === ".html" || ext === ".js" || ext === ".css") {
    return "no-cache";
  }
  return "public, max-age=300";
}

function allowApiRequest(req) {
  const now = Date.now();
  const ip = resolveClientIp(req);

  const record = apiRateCounters.get(ip);
  if (!record || now - record.windowStart >= API_RATE_WINDOW_MS) {
    apiRateCounters.set(ip, { windowStart: now, count: 1 });
    trimOldRateCounters(now);
    return { ok: true };
  }

  if (record.count >= API_RATE_MAX_REQUESTS) {
    const retryAfterSeconds = Math.max(
      1,
      Math.ceil((API_RATE_WINDOW_MS - (now - record.windowStart)) / 1000)
    );
    return { ok: false, retryAfterSeconds };
  }

  record.count += 1;
  return { ok: true };
}

function resolveClientIp(req, { trustProxy = TRUST_PROXY } = {}) {
  if (trustProxy) {
    const forwarded = String(req.headers["x-forwarded-for"] || "");
    const firstForwarded = (forwarded.split(",")[0] || "").trim();
    if (firstForwarded) {
      return firstForwarded;
    }
  }
  const remote = String(req.socket?.remoteAddress || "").trim();
  return remote || "unknown";
}

function isAuthorizedApiRequest(req) {
  // Bearer token gate applies regardless of OAuth mode: if a token is
  // configured, every API call must present it (sessions still pass below).
  if (API_BEARER_TOKEN) {
    if (hasValidBearerAuth(req)) return true;
    if (GOOGLE_OAUTH_ENABLED) {
      const sessionId = parseSessionCookie(req);
      if (sessionId && getSession(sessionId)) return true;
    }
    return false;
  }
  // No bearer configured: fall back to OAuth/session, or open access in local dev.
  if (!GOOGLE_OAUTH_ENABLED) return true;
  const sessionId = parseSessionCookie(req);
  if (sessionId && getSession(sessionId)) return true;
  return false;
}

function isAuthorizedStaticRequest(req) {
  if (!isBasicAuthEnabled()) {
    return true;
  }
  return hasValidBasicAuth(req);
}

function isBasicAuthEnabled() {
  return Boolean(APP_BASIC_AUTH_USER && APP_BASIC_AUTH_PASS);
}

function hasValidBearerAuth(req) {
  if (!API_BEARER_TOKEN) return false;
  const auth = String(req.headers.authorization || "").trim();
  if (!auth.startsWith("Bearer ")) {
    return false;
  }
  const token = auth.slice("Bearer ".length).trim();
  const a = Buffer.from(token);
  const b = Buffer.from(API_BEARER_TOKEN);
  if (a.length !== b.length) return false;
  return timingSafeEqual(a, b);
}

function hasValidBasicAuth(req) {
  if (!isBasicAuthEnabled()) {
    return true;
  }
  const auth = String(req.headers.authorization || "").trim();
  if (!auth.startsWith("Basic ")) {
    return false;
  }
  const encoded = auth.slice("Basic ".length).trim();
  let decoded;
  try {
    decoded = Buffer.from(encoded, "base64").toString("utf8");
  } catch {
    return false;
  }
  const separator = decoded.indexOf(":");
  if (separator <= -1) {
    return false;
  }
  const user = decoded.slice(0, separator);
  const pass = decoded.slice(separator + 1);
  return user === APP_BASIC_AUTH_USER && pass === APP_BASIC_AUTH_PASS;
}

function trimOldRateCounters(now = Date.now()) {
  if (apiRateCounters.size < 512) {
    return;
  }
  for (const [ip, record] of apiRateCounters.entries()) {
    if (now - record.windowStart > API_RATE_WINDOW_MS * 3) {
      apiRateCounters.delete(ip);
    }
  }
}

async function resolveCatalogPaths() {
  const runtimeEnv = getActiveRuntimeEnvVars();
  const envLeagues = String(runtimeEnv.LEAGUES_CSV_PATH || "").trim();
  const envTeams = String(runtimeEnv.TEAMS_CSV_PATH || "").trim();
  if (envLeagues || envTeams) {
    if (!envLeagues || !envTeams) {
      throw new Error("Set both LEAGUES_CSV_PATH and TEAMS_CSV_PATH when using env CSV overrides.");
    }
    const primary = { leagues: envLeagues, teams: envTeams, sourceKind: "env" };
    const supplemental = await resolveSupplementalCatalogPaths(primary, runtimeEnv);
    return { ...primary, ...supplemental };
  }

  const localPaths = await resolvePreferredLocalCatalogPaths();
  if (localPaths) {
    const supplemental = await resolveSupplementalCatalogPaths(localPaths, runtimeEnv);
    return { ...localPaths, ...supplemental };
  }

  const allowDownloadsCsvFallback =
    String(runtimeEnv.ALLOW_DOWNLOADS_CSV_FALLBACK || ALLOW_DOWNLOADS_CSV_FALLBACK || "").trim() ===
    "1";
  if (allowDownloadsCsvFallback) {
    const downloadPaths = {
      leagues: DEFAULT_DOWNLOADS_LEAGUES_CSV_PATH,
      teams: DEFAULT_DOWNLOADS_TEAMS_CSV_PATH,
      sourceKind: "downloads",
    };
    if (await pathsExist(downloadPaths.leagues, downloadPaths.teams)) {
      const supplemental = await resolveSupplementalCatalogPaths(downloadPaths, runtimeEnv);
      return { ...downloadPaths, ...supplemental };
    }
  }

  throw new Error(
    `Could not locate a valid leagues/teams CSV pair (checked env and catalog/).` +
      `${
        allowDownloadsCsvFallback
          ? " Downloads fallback was enabled but files were not found."
          : " Set ALLOW_DOWNLOADS_CSV_FALLBACK=1 to also check ~/Downloads."
      }`
  );
}

async function resolvePreferredLocalCatalogPaths() {
  for (const { leagues, teams } of DEFAULT_LOCAL_CATALOG_CANDIDATE_PAIRS) {
    if (await pathsExist(leagues, teams)) {
      return { leagues, teams, sourceKind: "workspace-catalog" };
    }
  }
  return null;
}

async function resolveSupplementalCatalogPaths(
  primaryPaths,
  runtimeEnv = getActiveRuntimeEnvVars()
) {
  const requestedExtraLeagues = dedupePaths(
    parseCsvPathListEnv(runtimeEnv.EXTRA_LEAGUES_CSV_PATHS || EXTRA_LEAGUES_CSV_PATHS.join(","))
  );
  const requestedExtraTeams = dedupePaths(
    parseCsvPathListEnv(runtimeEnv.EXTRA_TEAMS_CSV_PATHS || EXTRA_TEAMS_CSV_PATHS.join(","))
  );

  const extraLeagues = [];
  for (const filePath of requestedExtraLeagues) {
    if (!filePath || path.resolve(filePath) === path.resolve(primaryPaths.leagues)) {
      continue;
    }
    if (await pathsExist(filePath)) {
      extraLeagues.push(filePath);
    }
  }

  const extraTeams = [];
  for (const filePath of requestedExtraTeams) {
    if (!filePath || path.resolve(filePath) === path.resolve(primaryPaths.teams)) {
      continue;
    }
    if (await pathsExist(filePath)) {
      extraTeams.push(filePath);
    }
  }

  return { extraLeagues, extraTeams };
}

function dedupePaths(pathsToCheck) {
  const seen = new Set();
  const out = [];
  for (const candidate of pathsToCheck) {
    const normalized = String(candidate || "").trim();
    if (!normalized) {
      continue;
    }
    const resolved = path.resolve(normalized);
    if (seen.has(resolved)) {
      continue;
    }
    seen.add(resolved);
    out.push(normalized);
  }
  return out;
}

async function pathsExist(...pathsToCheck) {
  try {
    await Promise.all(pathsToCheck.map((p) => fs.stat(p)));
    return true;
  } catch {
    return false;
  }
}

async function getCatalogPayloadCached() {
  const runtimeProfile = getActiveRuntimeEnvironmentProfile();
  const runtimeEnv = runtimeProfile.env;
  const paths = await resolveCatalogPaths();
  const leagueFiles = [
    paths.leagues,
    ...(Array.isArray(paths.extraLeagues) ? paths.extraLeagues : []),
  ];
  const teamFiles = [paths.teams, ...(Array.isArray(paths.extraTeams) ? paths.extraTeams : [])];
  const allFiles = [...leagueFiles, ...teamFiles];
  const allStats = await Promise.all(allFiles.map((filePath) => fs.stat(filePath)));
  const cacheKey = [
    runtimeProfile.code,
    ...allFiles.map((filePath, index) => `${filePath}:${allStats[index]?.mtimeMs || 0}`),
  ].join("|");
  if (catalogCache && catalogCache.key === cacheKey) {
    // Re-normalize with the current time on every hit — normalizeLeagueStartWindows is
    // time-sensitive (it advances past start dates), so the cached raw leagues must be
    // re-evaluated rather than serving the frozen normalized slice.
    const normalizedLeagues = normalizeLeagueStartWindows(catalogCache.rawLeagues, {
      now: new Date(),
    });
    return {
      ...catalogCache.payload,
      leagues: normalizedLeagues,
      cache: { hit: true, key: cacheKey, loaded_at: catalogCache.payload.loaded_at },
    };
  }

  const [leagueCsvs, teamCsvs] = await Promise.all([
    Promise.all(leagueFiles.map((filePath) => fs.readFile(filePath, "utf8"))),
    Promise.all(teamFiles.map((filePath) => fs.readFile(filePath, "utf8"))),
  ]);

  const rawLeagues = mergeCatalogRows(
    leagueCsvs.map((csv) => parseSemicolonCsv(csv)),
    ["league_id", "id"]
  );
  const normalizedLeagues = normalizeLeagueStartWindows(rawLeagues, { now: new Date() });
  const teams = mergeCatalogRows(
    teamCsvs.map((csv) => parseSemicolonCsv(csv)),
    ["team_id", "id"]
  );
  const payload = createCatalogSourcePayload({
    source: createCatalogSourceMetadata({
      label: describeCatalogSourceLabel(paths),
      sourceKind: paths.sourceKind,
      leaguesFile: path.basename(paths.leagues),
      teamsFile: path.basename(paths.teams),
      supplementalLeaguesFiles: leagueFiles.slice(1).map((filePath) => path.basename(filePath)),
      supplementalTeamsFiles: teamFiles.slice(1).map((filePath) => path.basename(filePath)),
      environment: resolveRuntimeEnvironment(runtimeEnv),
    }),
    loadedAt: new Date().toISOString(),
    cache: { hit: false, key: cacheKey },
    scheduleSupport: createSportsDataScheduleSupportMetadata({ env: runtimeEnv }),
    leagues: normalizedLeagues,
    teams,
  });

  catalogCache = {
    key: cacheKey,
    rawLeagues,
    payload,
  };

  return payload;
}

function describeCatalogSourceLabel(sourceKind) {
  const baseKind =
    typeof sourceKind === "string" ? sourceKind : String(sourceKind?.sourceKind || "");
  const hasSupplemental =
    (Array.isArray(sourceKind?.extraLeagues) && sourceKind.extraLeagues.length > 0) ||
    (Array.isArray(sourceKind?.extraTeams) && sourceKind.extraTeams.length > 0);
  let label = "Downloads CSV files";
  if (baseKind === "env") {
    label = "CSV files (env override)";
  } else if (baseKind === "workspace-catalog") {
    label = "Workspace catalog CSV files";
  }
  return hasSupplemental ? `${label} + supplemental CSV files` : label;
}

async function getCatalogSourceMetaSafe() {
  try {
    const runtimeEnv = getActiveRuntimeEnvVars();
    const paths = await resolveCatalogPaths();
    return {
      kind: "csv-files",
      label: describeCatalogSourceLabel(paths),
      source_kind: paths.sourceKind,
      leagues_file: path.basename(paths.leagues),
      teams_file: path.basename(paths.teams),
      supplemental_leagues_files: (paths.extraLeagues || []).map((filePath) =>
        path.basename(filePath)
      ),
      supplemental_teams_files: (paths.extraTeams || []).map((filePath) => path.basename(filePath)),
      environment: resolveRuntimeEnvironment(runtimeEnv),
    };
  } catch {
    return { kind: "csv-files", label: "Unavailable" };
  }
}

function sendJson(res, statusCode, payload, extraHeaders = {}) {
  const body = JSON.stringify(payload);
  res.writeHead(
    statusCode,
    buildResponseHeaders("application/json; charset=utf-8", Buffer.byteLength(body), extraHeaders)
  );
  res.end(body);
}

function sendText(res, statusCode, text, extraHeaders = {}) {
  res.writeHead(
    statusCode,
    buildResponseHeaders("text/plain; charset=utf-8", Buffer.byteLength(text), extraHeaders)
  );
  res.end(text);
}

function normalizeDbLookupValue(value) {
  const text = String(value ?? "").trim();
  if (
    (text.startsWith('"') && text.endsWith('"')) ||
    (text.startsWith("'") && text.endsWith("'"))
  ) {
    return text.slice(1, -1).trim();
  }
  return text;
}

function slugifyLookupValue(value) {
  return String(value || "")
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
}

async function resolveLeagueRecordFromDb(
  pool,
  { leagueId = "", leagueName = "", leagueSlug = "" } = {}
) {
  const fallbackSlug = slugifyLookupValue(leagueSlug || leagueName) || "league";
  const fallback = {
    id: String(leagueId || "").trim(),
    name: String(leagueName || "").trim(),
    alternateName: "",
    slug: fallbackSlug,
  };
  if (!pool) {
    return fallback;
  }

  const normalizedLeagueId = String(leagueId || "").trim();
  if (normalizedLeagueId) {
    const exact = await pool.query(
      `SELECT league_id, name, alternate_name
         FROM leagues
        WHERE league_id = $1
        LIMIT 1`,
      [normalizedLeagueId]
    );
    if (exact.rows[0]) {
      const row = exact.rows[0];
      return {
        id: String(row.league_id || "").trim(),
        name: String(row.name || "").trim(),
        alternateName: String(row.alternate_name || "").trim(),
        slug: slugifyLookupValue(row.alternate_name || row.name) || fallbackSlug,
      };
    }
  }

  const normalizedSlug = slugifyLookupValue(leagueSlug || leagueName);
  const normalizedName = String(leagueName || "").trim();
  if (!normalizedSlug && !normalizedName) {
    return fallback;
  }

  const query = await pool.query(
    `SELECT league_id, name, alternate_name
       FROM leagues
      WHERE (
        regexp_replace(lower(coalesce(alternate_name, name)), '[^a-z0-9]+', '-', 'g') = $1
        OR regexp_replace(lower(name), '[^a-z0-9]+', '-', 'g') = $1
        OR name ILIKE $2
        OR alternate_name ILIKE $2
      )
      ORDER BY
        CASE
          WHEN regexp_replace(lower(coalesce(alternate_name, name)), '[^a-z0-9]+', '-', 'g') = $1 THEN 0
          WHEN regexp_replace(lower(name), '[^a-z0-9]+', '-', 'g') = $1 THEN 1
          WHEN lower(name) = lower($3) THEN 2
          WHEN lower(alternate_name) = lower($3) THEN 3
          ELSE 4
        END,
        lower(name)
      LIMIT 1`,
    [normalizedSlug || fallbackSlug, `%${normalizedName || leagueSlug}%`, normalizedName]
  );

  if (!query.rows[0]) {
    return fallback;
  }

  const row = query.rows[0];
  return {
    id: String(row.league_id || "").trim(),
    name: String(row.name || "").trim(),
    alternateName: String(row.alternate_name || "").trim(),
    slug: slugifyLookupValue(row.alternate_name || row.name) || fallbackSlug,
  };
}

async function resolveTeamRecordFromDb(pool, { teamId = "", teamName = "", leagueId = "" } = {}) {
  const fallback = {
    id: String(teamId || "").trim(),
    name: String(teamName || "").trim(),
    alternateName: String(teamName || "").trim(),
  };
  if (!pool) {
    return fallback;
  }

  const normalizedTeamId = String(teamId || "").trim();
  if (normalizedTeamId) {
    const exact = await pool.query(
      `SELECT team_id, name, alternate_name
         FROM teams
        WHERE team_id = $1
        LIMIT 1`,
      [normalizedTeamId]
    );
    if (exact.rows[0]) {
      const row = exact.rows[0];
      return {
        id: String(row.team_id || "").trim(),
        name: String(row.name || "").trim(),
        alternateName: String(row.alternate_name || row.name || "").trim(),
      };
    }
  }

  const normalizedTeamName = String(teamName || "").trim();
  if (!normalizedTeamName) {
    return fallback;
  }

  const params = [normalizedTeamName, `%${normalizedTeamName}%`];
  let sql = `SELECT team_id, name, alternate_name
       FROM teams
      WHERE (name ILIKE $2 OR alternate_name ILIKE $2)`;
  if (String(leagueId || "").trim()) {
    params.push(String(leagueId || "").trim());
    sql += ` AND league_id = $3`;
  }
  sql += `
      ORDER BY
        CASE
          WHEN lower(name) = lower($1) THEN 0
          WHEN lower(alternate_name) = lower($1) THEN 1
          ELSE 2
        END,
        lower(name)
      LIMIT 1`;

  const query = await pool.query(sql, params);
  if (!query.rows[0]) {
    return fallback;
  }

  const row = query.rows[0];
  return {
    id: String(row.team_id || "").trim(),
    name: String(row.name || "").trim(),
    alternateName: String(row.alternate_name || row.name || "").trim(),
  };
}

function buildResponseHeaders(
  contentType,
  contentLength,
  extraHeaders = {},
  { cacheControl = "no-store" } = {}
) {
  const headers = {
    ...SECURITY_HEADERS,
    "Content-Type": contentType,
    "Cache-Control": cacheControl,
    ...extraHeaders,
  };
  if (Number.isFinite(contentLength)) {
    headers["Content-Length"] = contentLength;
  }
  return headers;
}

function parseSemicolonCsv(input) {
  const rows = [];
  let row = [];
  let field = "";
  let i = 0;
  let inQuotes = false;

  const text = stripBom(String(input || ""));

  while (i < text.length) {
    const ch = text[i];

    if (inQuotes) {
      if (ch === '"') {
        if (text[i + 1] === '"') {
          field += '"';
          i += 2;
          continue;
        }
        inQuotes = false;
        i += 1;
        continue;
      }
      field += ch;
      i += 1;
      continue;
    }

    if (ch === '"') {
      inQuotes = true;
      i += 1;
      continue;
    }

    if (ch === ";") {
      row.push(field);
      field = "";
      i += 1;
      continue;
    }

    if (ch === "\n") {
      row.push(field);
      rows.push(row);
      row = [];
      field = "";
      i += 1;
      continue;
    }

    if (ch === "\r") {
      i += 1;
      continue;
    }

    field += ch;
    i += 1;
  }

  if (field.length > 0 || row.length > 0) {
    row.push(field);
    rows.push(row);
  }

  if (!rows.length) {
    return [];
  }

  const headers = rows[0].map((h) => String(h || "").trim());
  const data = [];

  for (let r = 1; r < rows.length; r += 1) {
    const values = rows[r];
    if (!values || values.every((value) => String(value || "").trim() === "")) {
      continue;
    }

    const record = {};
    for (let c = 0; c < headers.length; c += 1) {
      record[headers[c]] = values[c] ?? "";
    }
    data.push(record);
  }

  return data;
}

function mergeCatalogRows(rowCollections, idKeys) {
  return mergeCatalogRowCollections(rowCollections, idKeys);
}

function stripBom(value) {
  return value.charCodeAt(0) === 0xfeff ? value.slice(1) : value;
}

function sortCmsBatchFixturesByKickoff(fixtures) {
  if (!Array.isArray(fixtures) || !fixtures.length) return [];
  return [...fixtures].sort((a, b) => {
    const aKey = `${String(a?.fixture_date || "")} ${String(a?.kickoff_time_utc || "")}`;
    const bKey = `${String(b?.fixture_date || "")} ${String(b?.kickoff_time_utc || "")}`;
    if (aKey !== bKey) return aKey < bKey ? -1 : 1;
    return String(a?.event_name || "").localeCompare(String(b?.event_name || ""));
  });
}

async function pollUntil({ fn, attempts = 5, delayMs = 500 } = {}) {
  for (let i = 0; i < attempts; i++) {
    if (i > 0 && delayMs > 0) await new Promise((r) => setTimeout(r, delayMs));
    const result = await fn();
    if (result) return result;
  }
  return null;
}

function _matchRowsToPublishKey(allRows, publishKey) {
  const parts = String(publishKey || "").split("|");
  const family = parts[0] || "";
  const line = String(parts[1] || "0").replace(/^-/, "");
  const byId = new Map();
  for (const row of allRows) {
    const pmId = String(row.parent_market_id || "");
    if (!pmId) continue;
    if (!byId.has(pmId)) byId.set(pmId, []);
    byId.get(pmId).push(row);
  }
  for (const [, rows] of byId) {
    const head = rows[0] || {};
    const rowFamily = String(head.parent_market_family || "").toLowerCase();
    const rowLine = String(head.market_line || "").replace(/^-/, "");
    if (rowFamily === family && rowLine === line) return rows;
  }
  return null;
}

async function buildCmsSelectedPreflight({ envelope, config = {}, pool, resolveFixtureCandidate }) {
  const payload = envelope?.payload || {};
  const providedTypeReferenceId = String(payload.type_reference_id || "").trim();
  const selectedPublishItems = Array.isArray(payload.selected_publish_items)
    ? payload.selected_publish_items
    : [];
  const forceRepublish = Boolean(payload.force_republish);

  const resolvedFixture = await resolveFixtureCandidate(payload);

  let fixtureRecord = null;
  const gameId = String(resolvedFixture?.game_id || resolvedFixture?.gameId || "").trim();
  if (pool && gameId) {
    const result = await pool.query(
      `SELECT fixture_id, name, league_id, home_team_id, away_team_id, game_start_time, match_day FROM fixtures WHERE game_id = $1 LIMIT 1`,
      [gameId]
    );
    fixtureRecord = result.rows[0] || null;
  }

  let typeReferenceRecord = null;
  if (pool) {
    if (providedTypeReferenceId) {
      const result = await pool.query(
        `SELECT type_reference_id, type_value_id, canonical_name FROM type_references WHERE type_reference_id = $1 LIMIT 5`,
        [providedTypeReferenceId]
      );
      const found = result.rows[0] || null;
      if (found && fixtureRecord && found.type_value_id !== fixtureRecord.fixture_id) {
        throw new InvalidIntegrationPayloadError(
          "The provided type_reference_id does not belong to the selected fixture.",
          { issues: ["payload.type_reference_id"] }
        );
      }
      typeReferenceRecord = found || null;
    } else if (fixtureRecord) {
      const result = await pool.query(
        `SELECT type_reference_id, type_value_id, canonical_name FROM type_references WHERE type_value_id = $1 LIMIT 1`,
        [fixtureRecord.fixture_id]
      );
      typeReferenceRecord = result.rows[0] || null;
    }
  }

  let existingParentRows = [];
  const resolvedTypeRefId = typeReferenceRecord?.type_reference_id || "";
  if (pool && resolvedTypeRefId) {
    const result = await pool.query(
      `SELECT pm.parent_market_id, pm.type_reference_id, pm.title, pm.parent_market_family, pm.market_line, pm.rules AS parent_rules, pm.is_cross_matching_enabled, pm.markets_open_time, pm.league_id, m.market_id, m.name AS market_name, m.tick_size, m.market_code, m.rules AS market_rules, m.team_id FROM parent_markets pm LEFT JOIN markets m ON m.parent_market_id = pm.parent_market_id WHERE pm.type_reference_id = $1`,
      [resolvedTypeRefId]
    );
    existingParentRows = result.rows || [];
  }

  const rowsByPublishKey = new Map();
  const byParentId = new Map();
  for (const row of existingParentRows) {
    const pmId = String(row.parent_market_id || "");
    if (!pmId) continue;
    if (!byParentId.has(pmId)) byParentId.set(pmId, []);
    byParentId.get(pmId).push(row);
  }
  for (const [, rows] of byParentId) {
    const key = buildExistingPublishKeyFromRows(rows, {
      selectedFixture: payload.fixture_payload || {},
      fixtureRecord,
    });
    if (!key) continue;
    if (!rowsByPublishKey.has(key)) rowsByPublishKey.set(key, rows);
    else rowsByPublishKey.get(key).push(...rows);
  }

  const preflightItems = selectedPublishItems.map((item) => {
    const publishKey = String(item?.publish_key || "").trim();
    const parentMarketPayload = item?.parent_market_payload || null;
    const matchingRows = rowsByPublishKey.get(publishKey) || [];

    if (!matchingRows.length) {
      return {
        publish_key: publishKey,
        parent_market_payload: parentMarketPayload,
        status: "selectable",
      };
    }
    if (matchingRows.some((r) => r.market_id == null)) {
      return {
        publish_key: publishKey,
        parent_market_payload: parentMarketPayload,
        status: "half_prepared",
        existingRows: matchingRows,
      };
    }
    if (forceRepublish) {
      return {
        publish_key: publishKey,
        parent_market_payload: parentMarketPayload,
        status: "blocked",
        existingRows: matchingRows,
      };
    }
    return {
      publish_key: publishKey,
      parent_market_payload: parentMarketPayload,
      status: "existing",
      existingRows: matchingRows,
    };
  });

  return {
    preflightItems,
    fixtureRecord,
    typeReferenceRecord,
    resolvedFixture,
    resolvedTypeRefId,
    forceRepublish,
    providedTypeReferenceId,
    fixturePayload: payload.fixture_payload || {},
    typeReferencePayload: payload.type_reference_payload || {},
    selectedPublishItems,
  };
}

async function executeCmsSelectedPublish({
  envelope,
  config = {},
  vaultConfig = { enabled: false },
  pool,
  pollUntilFn,
  createRunIdFn,
  publishFixtureFn,
  publishTypeReferenceFn,
  publishParentMarketFn,
  runStore,
  preflight,
}) {
  const payload = envelope?.payload || {};
  const providedTypeReferenceId = String(payload.type_reference_id || "").trim();
  const fixturePayload = payload.fixture_payload || {};
  const typeReferencePayload = payload.type_reference_payload || {};

  const runId =
    (typeof createRunIdFn === "function" ? createRunIdFn() : null) ||
    `run_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;

  const runRecord = {
    run_id: runId,
    status: "running",
    step_results: {},
    parent_market_results: {},
    aggregate: { published: 0, failed: 0, blocked: 0, existing: 0 },
    summary: "",
    detail: "",
    started_at: new Date().toISOString(),
    completed_at: null,
  };
  if (runStore) runStore.set(runId, runRecord);

  const preflightItems = preflight?.preflightItems || [];
  let resolvedFixtureRecord = preflight?.fixtureRecord || null;

  async function runVaultSyncIfApplicable() {
    if (!vaultConfig?.enabled) return;
    if (runRecord.status === "failed") return;
    const sel = envelope?.payload?.selected_fixture || {};
    runRecord.vault_sync = await syncSingleFixtureAfterPublish(
      pool,
      {
        fixture_id: resolvedFixtureRecord?.fixture_id,
        game_start_time:
          resolvedFixtureRecord?.game_start_time ||
          fixturePayload?.game_start_time ||
          deriveStartTimeFromSelectedFixture(sel),
        polymarket_url: sel.polymarket_url || sel.polymarketUrl,
        polymarket_event_id: sel.polymarket_event_id || sel.polymarketEventId,
      },
      vaultConfig,
      vaultLog.child({ runId })
    );
  }

  // ── New combined fixtures/create endpoint shortcut ──────────────────────────
  // When the schedule provider is sportsdata or lsports, collapse the legacy
  // fixture → type-ref → parent-market flow into a single fixtures/create call.
  const selectedFixtureForShortcut = envelope?.payload?.selected_fixture || {};
  const newCmsSource = mapProviderToCmsSource(
    selectedFixtureForShortcut.provider || selectedFixtureForShortcut.source
  );
  if (newCmsSource) {
    const gameId = String(
      selectedFixtureForShortcut.game_id || selectedFixtureForShortcut.gameId || ""
    ).trim();
    const eventName = String(selectedFixtureForShortcut.event_name || "").trim();
    const [homeNameRaw = "", awayNameRaw = ""] = eventName.split(/\s+vs\s+/i);
    const homeName = homeNameRaw.trim();
    const awayName = awayNameRaw.trim();
    const leagueCode = String(selectedFixtureForShortcut.league_code || "")
      .trim()
      .toLowerCase();
    const fixtureLike = {
      home: homeName,
      away: awayName,
      kickoff: String(selectedFixtureForShortcut.fixture_date || "").trim(),
      leagueCode,
    };
    const cname = buildFixtureCreateCname(fixtureLike, null, null);
    const parentMarkets = [
      ...new Set(
        preflightItems
          .filter((item) => String(item?.status || "") !== "existing")
          .map((item) =>
            publishKeyToParentMarketKey(String(item?.publish_key || ""), homeName, awayName)
          )
          .filter(Boolean)
      ),
    ];

    runRecord.step_results.fixture = { status: "skipped" };
    runRecord.step_results.type_reference = { status: "skipped" };

    if (!gameId) {
      runRecord.status = "failed";
      runRecord.summary = "Publish failed.";
      runRecord.detail = "Fixture has no game_id; cannot use fixtures/create.";
      runRecord.completed_at = new Date().toISOString();
      return { runRecord };
    }

    const log = cmsLog.child({ runId, source: newCmsSource });
    log.info(
      { gameId, eventName, cname, parentMarkets },
      "publishing via fixtures/create shortcut"
    );

    try {
      const resp = await postCmsFixtureCreate(
        config,
        {
          game_id: gameId,
          source: newCmsSource,
          parent_markets: parentMarkets,
          cname,
          appendix: "",
        },
        log
      );
      for (const item of preflightItems) {
        const publishKey = String(item?.publish_key || "").trim();
        if (String(item?.status || "") === "existing") {
          runRecord.parent_market_results[publishKey] = { status: "existing" };
          runRecord.aggregate.existing++;
        } else {
          runRecord.parent_market_results[publishKey] = { status: "published" };
          runRecord.aggregate.published++;
        }
      }
      runRecord.response = resp ?? null;
      runRecord.status = "completed";
      runRecord.summary = "Publish completed.";
      runRecord.detail = `Created fixture, type reference, and ${runRecord.aggregate.published} selected market${runRecord.aggregate.published !== 1 ? "s" : ""} via fixtures/create.`;
    } catch (err) {
      const errorMessage = String(err?.message || err);
      for (const item of preflightItems) {
        const publishKey = String(item?.publish_key || "").trim();
        if (String(item?.status || "") === "existing") {
          runRecord.parent_market_results[publishKey] = { status: "existing" };
          runRecord.aggregate.existing++;
        } else {
          runRecord.parent_market_results[publishKey] = {
            status: "failed",
            error: errorMessage,
          };
          runRecord.aggregate.failed++;
        }
      }
      runRecord.status = "failed";
      runRecord.summary = "Publish failed.";
      runRecord.detail = errorMessage;
    }
    await runVaultSyncIfApplicable();
    runRecord.completed_at = new Date().toISOString();
    return { runRecord };
  }

  const skipFixtureAndTypeRef = Boolean(providedTypeReferenceId);
  let resolvedTypeRefId = providedTypeReferenceId || preflight?.resolvedTypeRefId || "";

  if (skipFixtureAndTypeRef) {
    runRecord.step_results.fixture = { status: "skipped" };
    runRecord.step_results.type_reference = { status: "skipped" };
  } else {
    try {
      await publishFixtureFn({ fixturePayload, config });
      runRecord.step_results.fixture = { status: "created" };

      if (pollUntilFn && pool) {
        const gameId = String(
          preflight?.resolvedFixture?.game_id || preflight?.resolvedFixture?.gameId || ""
        ).trim();
        if (gameId) {
          const found = await pollUntilFn({
            fn: async () => {
              const r = await pool.query(
                `SELECT fixture_id, match_day FROM fixtures WHERE game_id = $1 LIMIT 1`,
                [gameId]
              );
              return r.rows[0] || null;
            },
            attempts: 10,
          });
          if (found?.fixture_id) resolvedFixtureRecord = found;
        }
      }
    } catch (err) {
      runRecord.step_results.fixture = { status: "failed", error: String(err?.message || err) };
      runRecord.status = "failed";
      runRecord.completed_at = new Date().toISOString();
      return { runRecord };
    }

    try {
      await publishTypeReferenceFn({ typeReferencePayload, config });
      runRecord.step_results.type_reference = { status: "created" };

      if (pollUntilFn && pool && resolvedFixtureRecord?.fixture_id) {
        const found = await pollUntilFn({
          fn: async () => {
            const r = await pool.query(
              `SELECT type_reference_id FROM type_references WHERE type_value_id = $1 LIMIT 1`,
              [resolvedFixtureRecord.fixture_id]
            );
            return r.rows[0] || null;
          },
          attempts: 10,
        });
        if (found?.type_reference_id) resolvedTypeRefId = found.type_reference_id;
      }
    } catch (err) {
      runRecord.step_results.type_reference = {
        status: "failed",
        error: String(err?.message || err),
      };
      runRecord.status = "failed";
      runRecord.completed_at = new Date().toISOString();
      return { runRecord };
    }
  }

  const matchDay = Number(resolvedFixtureRecord?.match_day || 0) + 1;

  for (const item of preflightItems) {
    const publishKey = String(item?.publish_key || "").trim();
    const itemStatus = String(item?.status || "");

    if (itemStatus === "existing") {
      runRecord.parent_market_results[publishKey] = { status: "existing" };
      runRecord.aggregate.existing++;
      continue;
    }

    if (itemStatus === "blocked") {
      const existingRows = item.existingRows || [];
      const existingReconstructed = reconstructParentMarketPayloadFromRows(existingRows);
      const providedCanonical = canonicalizeParentMarketComparisonPayload(
        item.parent_market_payload
      );
      const existingCanonical = canonicalizeParentMarketComparisonPayload(existingReconstructed);

      if (providedCanonical === existingCanonical) {
        runRecord.parent_market_results[publishKey] = { status: "blocked" };
        runRecord.aggregate.blocked++;
        continue;
      }

      const pm = item.parent_market_payload?.parent_market || {};
      const modifiedPayload = {
        ...item.parent_market_payload,
        parent_market: {
          ...pm,
          type_reference_id: resolvedTypeRefId || pm.type_reference_id || "",
          rules: `${String(pm.rules || "")} [Match Day ${matchDay}]`,
        },
      };
      try {
        await publishParentMarketFn({ parentMarketPayload: modifiedPayload, publishKey, config });
        if (pollUntilFn && pool && resolvedTypeRefId) {
          await pollUntilFn({
            fn: async () => {
              const r = await pool.query(
                `SELECT pm.parent_market_id, pm.parent_market_family, pm.market_line, m.market_id FROM parent_markets pm LEFT JOIN markets m ON m.parent_market_id = pm.parent_market_id WHERE pm.type_reference_id = $1`,
                [resolvedTypeRefId]
              );
              const rows = r.rows || [];
              const matched = _matchRowsToPublishKey(rows, publishKey);
              if (!matched || matched.some((row) => row.market_id == null)) return null;
              return matched;
            },
            attempts: 10,
          });
        }
        runRecord.parent_market_results[publishKey] = { status: "published" };
        runRecord.aggregate.published++;
      } catch (err) {
        runRecord.parent_market_results[publishKey] = {
          status: "failed",
          error: String(err?.message || err),
        };
        runRecord.aggregate.failed++;
      }
      continue;
    }

    const pm = item.parent_market_payload?.parent_market || {};
    const modifiedPayload = {
      ...item.parent_market_payload,
      parent_market: { ...pm, type_reference_id: resolvedTypeRefId || pm.type_reference_id || "" },
    };
    try {
      await publishParentMarketFn({ parentMarketPayload: modifiedPayload, publishKey, config });
      if (pollUntilFn && pool && resolvedTypeRefId) {
        await pollUntilFn({
          fn: async () => {
            const r = await pool.query(
              `SELECT pm.parent_market_id, pm.parent_market_family, pm.market_line, m.market_id FROM parent_markets pm LEFT JOIN markets m ON m.parent_market_id = pm.parent_market_id WHERE pm.type_reference_id = $1`,
              [resolvedTypeRefId]
            );
            const rows = r.rows || [];
            const matched = _matchRowsToPublishKey(rows, publishKey);
            if (!matched || matched.some((row) => row.market_id == null)) return null;
            return matched;
          },
          attempts: 10,
        });
      }
      runRecord.parent_market_results[publishKey] = { status: "published" };
      runRecord.aggregate.published++;
    } catch (err) {
      runRecord.parent_market_results[publishKey] = {
        status: "failed",
        error: String(err?.message || err),
      };
      runRecord.aggregate.failed++;
    }
  }

  const { published, failed } = runRecord.aggregate;
  runRecord.status = failed > 0 && published > 0 ? "partial" : failed > 0 ? "failed" : "completed";
  runRecord.summary =
    runRecord.status === "completed"
      ? "Publish completed."
      : runRecord.status === "partial"
        ? "Publish partially completed."
        : "Publish failed.";

  if (skipFixtureAndTypeRef) {
    runRecord.detail = `Used existing type reference and published ${published} selected market${published !== 1 ? "s" : ""}.`;
  } else {
    const fixStep = runRecord.step_results.fixture?.status;
    const trStep = runRecord.step_results.type_reference?.status;
    const parts = [];
    if (fixStep === "created") parts.push("fixture");
    if (trStep === "created") parts.push("type reference");
    if (published > 0) parts.push(`${published} selected market${published !== 1 ? "s" : ""}`);
    runRecord.detail = parts.length > 0 ? `Created ${joinPartsWithAnd(parts)}.` : "";
  }

  await runVaultSyncIfApplicable();
  runRecord.completed_at = new Date().toISOString();
  return { runRecord };
}

function joinPartsWithAnd(parts = []) {
  const list = parts.filter(Boolean);
  if (list.length === 0) return "";
  if (list.length === 1) return list[0];
  if (list.length === 2) return `${list[0]} and ${list[1]}`;
  return `${list.slice(0, -1).join(", ")}, and ${list[list.length - 1]}`;
}

function deriveStartTimeFromSelectedFixture(selectedFixture = {}) {
  const date = String(selectedFixture?.fixture_date || selectedFixture?.fixtureDate || "").trim();
  if (!date) return "";
  const time = String(
    selectedFixture?.kickoff_time_utc || selectedFixture?.kickoffTimeUtc || ""
  ).trim();
  if (!time) return `${date}T00:00:00Z`;
  const normalizedTime = /^\d{2}:\d{2}$/.test(time) ? `${time}:00` : time;
  return `${date}T${normalizedTime}Z`;
}

export {
  resolveCatalogPaths,
  getCatalogPayloadCached,
  parsePositiveIntegerEnv,
  parseSemicolonCsv,
  resolveClientIp,
  handleCatalogRequest,
  handleCatalogMetaRequest,
  handleReadyRequest,
  serveStaticFile,
  resolveBatchLeague,
  deriveBatchFixtureStatusFromMarkets,
  deriveBatchRunStatusFromFixtures,
  classifyExistingBatchParentMarketRows,
  sortCmsBatchFixturesByKickoff,
  pollUntil,
  buildCmsSelectedPreflight,
  executeCmsSelectedPublish,
  cmsScheduler,
  fireScheduledJob,
  server,
};
