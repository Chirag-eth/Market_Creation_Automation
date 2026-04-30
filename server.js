import http from "node:http";
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
import { createCmsBatchRunRecord } from "./src/backend/cmsBatchPublish.js";
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
import { normalizeLeagueRows, normalizeTeamRows, buildTeamAliasIndex } from "./src/data/catalog.js";
import {
  buildUatParentPayloads,
  buildUatFixtureAlternateName,
  buildUatCanonicalFixtureName,
} from "./src/core/uatFormats.js";
import {
  classifyParentStatusFromRows,
  getExpectedMarketCountForPublishKey,
} from "./src/backend/cmsSelectedPublish.js";
import { normalizeForSearch } from "./src/shared/util.js";

const STARTUP_ENV = { ...process.env };
const ROOT_DIR = path.resolve(process.cwd());
for (const envFile of resolveDotEnvFiles(ROOT_DIR, process.env)) {
  loadDotEnv(envFile);
}
const RUNTIME_ENV_PROFILES = createRuntimeEnvironmentProfiles(ROOT_DIR, STARTUP_ENV);
let activeRuntimeEnvCode = resolveRuntimeEnvironmentCode(process.env);

// Per-environment DB pool cache — keyed by "host:port:user:database"
const _dbPoolCache = new Map();
function getDbPoolForEnv(envVars = {}) {
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
  activeRuntimeEnvCode = "mainnet";
}

const PORT = parsePositiveIntegerEnv(process.env.PORT, 2020, { min: 1 });
const PUBLIC_DIR = path.join(ROOT_DIR, "public");
const CATALOG_DIR = path.join(ROOT_DIR, "catalog");
const DEFAULT_DOWNLOADS_LEAGUES_CSV_PATH = path.join(os.homedir(), "Downloads", "leagues.csv");
const DEFAULT_DOWNLOADS_TEAMS_CSV_PATH = path.join(os.homedir(), "Downloads", "teams.csv");
const DEFAULT_DOWNLOADS_FIFA_TEAMS_CSV_PATH = path.join(os.homedir(), "Downloads", "fifa_teams.csv");
const DEFAULT_LOCAL_LEAGUES_CSV_CANDIDATES = [
  path.join(CATALOG_DIR, "leagues-main.csv"),
  path.join(CATALOG_DIR, "leagues.csv"),
];
const DEFAULT_LOCAL_TEAMS_CSV_CANDIDATES = [
  path.join(CATALOG_DIR, "teams-main.csv"),
  path.join(CATALOG_DIR, "teams.csv"),
];
const ALLOW_DOWNLOADS_CSV_FALLBACK = String(process.env.ALLOW_DOWNLOADS_CSV_FALLBACK || "").trim() === "1";
const EXTRA_LEAGUES_CSV_PATHS = parseCsvPathListEnv(process.env.EXTRA_LEAGUES_CSV_PATHS || "");
const EXTRA_TEAMS_CSV_PATHS = parseCsvPathListEnv(process.env.EXTRA_TEAMS_CSV_PATHS || "");
const TRUST_PROXY = String(process.env.TRUST_PROXY || "").trim() === "1";
const API_BEARER_TOKEN = String(process.env.API_BEARER_TOKEN || "").trim();
const APP_BASIC_AUTH_USER = String(process.env.APP_BASIC_AUTH_USER || "").trim();
const APP_BASIC_AUTH_PASS = String(process.env.APP_BASIC_AUTH_PASS || "").trim();
const API_RATE_WINDOW_MS = parsePositiveIntegerEnv(process.env.API_RATE_WINDOW_MS, 60_000, { min: 1_000 });
const API_RATE_MAX_REQUESTS = parsePositiveIntegerEnv(process.env.API_RATE_MAX_REQUESTS, 180, { min: 1 });
const SCHEDULE_CACHE_TTL_MS = parsePositiveIntegerEnv(process.env.SCHEDULE_CACHE_TTL_MS, 300_000, { min: 1_000 });
const SCHEDULE_FETCH_TIMEOUT_MS = parsePositiveIntegerEnv(process.env.SCHEDULE_FETCH_TIMEOUT_MS, 8_000, { min: 1_000 });
const SPORTSDATA_API_KEY = String(process.env.SPORTSDATA_API_KEY || "").trim();
const SPORTSDATA_SCHEDULE_BASE_URL = String(process.env.SPORTSDATA_SCHEDULE_BASE_URL || "https://api.sportsdata.io/v4/soccer/scores/json/Schedule").trim();
const SPORTSDATA_SCHEDULE_SEASON = parsePositiveIntegerEnv(process.env.SPORTSDATA_SCHEDULE_SEASON, 2026, { min: 2000 });
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
    "connect-src 'self' https://cdn.jsdelivr.net https://tessdata.projectnaptha.com; " +
    "object-src 'none'; base-uri 'self'; frame-ancestors 'none'",
};

let catalogCache = null;
const apiRateCounters = new Map();
const scheduleCache = new Map();
const batchRunStore = new Map();

// Maps frontend submarket IDs → CMS publish keys
const SUBMARKET_TO_PUBLISH_KEYS = {
  moneyline: ["moneyline|0"],
  btts:      ["btts|0"],
  ou_1_5:   ["totals|1.5"],
  ou_2_5:   ["totals|2.5"],
  ou_3_5:   ["totals|3.5"],
  ou_4_5:   ["totals|4.5"],
  home_1_5: ["spreads|1.5|home"],
  away_1_5: ["spreads|1.5|away"],
  home_2_5: ["spreads|2.5|home"],
  away_2_5: ["spreads|2.5|away"],
  spreads:  ["spreads|1.5|home", "spreads|1.5|away", "spreads|2.5|home", "spreads|2.5|away"],
  totals:   ["totals|1.5", "totals|2.5", "totals|3.5", "totals|4.5"],
};

const server = http.createServer(async (req, res) => {
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
    if (!requestUrl.pathname.startsWith("/api/") && !isAuthorizedStaticRequest(req)) {
      sendText(
        res,
        401,
        "Unauthorized",
        { "WWW-Authenticate": 'Basic realm="Fixture OCR Dashboard"' }
      );
      return;
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

    if (requestUrl.pathname === "/api/json/generate-parent-market" && req.method === "POST") {
      await handleJsonGenerateParentMarketRequest(req, res);
      return;
    }

    if (requestUrl.pathname === "/api/json/publish-fixture" && req.method === "POST") {
      await handleJsonPublishFixtureRequest(req, res);
      return;
    }

    if (requestUrl.pathname === "/api/json/publish-parent-market" && req.method === "POST") {
      await handleJsonPublishParentMarketRequest(req, res);
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
    console.error(error);
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
  const appEnv = String(env?.APP_ENV || "").trim().toLowerCase();

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
  const raw = String(env?.APP_ENV || "").trim().toLowerCase();
  if (!raw || raw === "local" || raw === "mainnet") {
    return "mainnet";
  }
  if (raw === "uat") {
    return "uat";
  }
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
  const mainnetLocalEnvFile = path.resolve(resolvedRoot, ".env.mainnet.local");
  const uatEnvFile = path.resolve(resolvedRoot, ".env.uat");
  const uatLocalEnvFile = path.resolve(resolvedRoot, ".env.uat.local");
  const sharedLocalEnvFile = path.resolve(resolvedRoot, ".env.local");
  const sanitizedStartupEnv = sanitizeRuntimeStartupEnv(startupEnv);
  const mainnetFileValues = readDotEnvValues(mainnetEnvFile);
  const mainnetLocalFileValues = readDotEnvValues(mainnetLocalEnvFile);
  const uatFileValues = readDotEnvValues(uatEnvFile);
  const uatLocalFileValues = readDotEnvValues(uatLocalEnvFile);
  const sharedLocalFileValues = readDotEnvValues(sharedLocalEnvFile);

  return {
    mainnet: {
      code: "mainnet",
      label: "Mainnet",
      envFile: mainnetEnvFile,
      available: true,
      env: {
        ...mainnetFileValues,
        ...sharedLocalFileValues,
        ...mainnetLocalFileValues,
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
        ...mainnetFileValues,
        ...uatFileValues,
        ...sharedLocalFileValues,
        ...uatLocalFileValues,
        ...sanitizedStartupEnv,
        APP_ENV: "uat",
        ENV_FILE: uatEnvFile,
      },
    },
  };
}

function sanitizeRuntimeStartupEnv(startupEnv = {}) {
  const next = { ...(startupEnv && typeof startupEnv === "object" ? startupEnv : {}) };
  delete next.APP_ENV;
  delete next.ENV_FILE;
  return next;
}

function getRuntimeEnvironmentProfile(code = activeRuntimeEnvCode) {
  const normalized = resolveRuntimeEnvironmentCode({ APP_ENV: code });
  return RUNTIME_ENV_PROFILES[normalized] || RUNTIME_ENV_PROFILES.mainnet;
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
  scheduleCache.clear();
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
  return parsePositiveIntegerEnv(
    runtimeEnv?.SCHEDULE_FETCH_TIMEOUT_MS,
    SCHEDULE_FETCH_TIMEOUT_MS,
    { min: 1_000 }
  );
}

function resolveScheduleCacheTtlMs(runtimeEnv = getActiveRuntimeEnvVars()) {
  return parsePositiveIntegerEnv(
    runtimeEnv?.SCHEDULE_CACHE_TTL_MS,
    SCHEDULE_CACHE_TTL_MS,
    { min: 1_000 }
  );
}

function resolveSportsDataScheduleBaseUrl(runtimeEnv = getActiveRuntimeEnvVars()) {
  return String(runtimeEnv?.SPORTSDATA_SCHEDULE_BASE_URL || SPORTSDATA_SCHEDULE_BASE_URL || "").trim();
}

function resolveSportsDataScheduleSeason(runtimeEnv = getActiveRuntimeEnvVars()) {
  return parsePositiveIntegerEnv(
    runtimeEnv?.SPORTSDATA_SCHEDULE_SEASON,
    SPORTSDATA_SCHEDULE_SEASON,
    { min: 2000 }
  );
}

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
  server.listen(PORT, () => {
    console.log(`Fixture OCR Market Builder running at http://localhost:${PORT}`);
    void (async () => {
      try {
        const paths = await resolveCatalogPaths();
        console.log(`CSV source (leagues): ${paths.leagues}`);
        console.log(`CSV source (teams):   ${paths.teams}`);
      } catch (error) {
        console.log(`CSV source resolution failed: ${String(error?.message || error)}`);
      }
    })();

    // Background schedule refresh — runs every SCHEDULE_CACHE_TTL_MS (default 5 min)
    const bgIntervalMs = SCHEDULE_CACHE_TTL_MS;
    setInterval(() => {
      backgroundRefreshAllSchedules().catch(err =>
        console.warn("[schedule-bg] interval error:", err.message)
      );
    }, bgIntervalMs).unref();
    console.log(`[schedule-bg] background refresh interval: ${bgIntervalMs / 1000}s`);
  });

  const shutdown = (signal) => {
    console.log(`Received ${signal}. Shutting down...`);
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
    sendJson(res, 405, { error: "Method not allowed", detail: "Use GET or POST." }, { Allow: "GET, POST" });
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
      detail: 'Pass {"app_env":"mainnet"} or {"app_env":"uat"}.',
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

  const fixtures   = Array.isArray(payload?.fixtures)   ? payload.fixtures   : [];
  const submarkets = Array.isArray(payload?.submarkets)  ? payload.submarkets : [];

  console.log(`[batch-publish] incoming request — ${fixtures.length} fixture(s), ${submarkets.length} submarket(s)`);
  if (fixtures.length) console.log(`[batch-publish]   fixtures:`, JSON.stringify(fixtures.map(f => ({ id: f.id, home: f.home, away: f.away, league: f.leagueCode }))));
  if (submarkets.length) console.log(`[batch-publish]   submarkets:`, submarkets);

  if (!fixtures.length) {
    console.warn(`[batch-publish] rejected — no fixtures`);
    sendJson(res, 400, { error: "No fixtures provided." });
    return;
  }
  if (!submarkets.length) {
    console.warn(`[batch-publish] rejected — no submarkets`);
    sendJson(res, 400, { error: "No submarkets provided." });
    return;
  }

  const publishKeys = [...new Set(submarkets.flatMap(s => SUBMARKET_TO_PUBLISH_KEYS[s] || []))];
  if (!publishKeys.length) {
    console.warn(`[batch-publish] No publish keys mapped from submarkets: ${submarkets.join(", ")}`);
    sendJson(res, 400, { error: "None of the provided submarkets map to known CMS publish keys." });
    return;
  }

  const activeProfile = getActiveRuntimeEnvironmentProfile();
  const runId = `run_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;

  console.log(`[batch-publish] ▶ ${runId}`);
  console.log(`[batch-publish]   env       : ${activeProfile.label} (${activeProfile.code})`);
  console.log(`[batch-publish]   fixtures  : ${fixtures.map(f => f.id || `${f.home} vs ${f.away}`).join(", ")}`);
  console.log(`[batch-publish]   submarkets: ${submarkets.join(", ")}`);
  console.log(`[batch-publish]   publishKeys: ${publishKeys.join(", ")}`);

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
  executeCmsBatchRun(runId, fixtures, publishKeys, activeProfile).catch(err => {
    const record = batchRunStore.get(runId);
    if (record) {
      record.status = "failed";
      record.detail = String(err?.message || err);
      record.completed_at = new Date().toISOString();
    }
    console.error(`[batch-run] ${runId} unhandled top-level error:`, err.message);
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

async function executeCmsBatchRun(runId, fixtures, publishKeys, activeProfile) {
  const record = batchRunStore.get(runId);
  if (!record) {
    console.error(`[batch-run] ${runId} — no record found in store, aborting`);
    return;
  }

  record.status = "running";
  console.log(`[batch-run] ${runId} — status: running`);

  const cmsConfig = createCmsRuntimeConfig(activeProfile.env);
  console.log(`[batch-run] ${runId} — CMS enabled: ${cmsConfig.enabled}, baseUrl: ${cmsConfig.baseUrl || "(none)"}`);

  if (!cmsConfig.enabled) {
    const detail = `CMS publishing is not configured for ${activeProfile.label}. Set COMP_SERVICE_INTERNAL_HOST.`;
    console.error(`[batch-run] ${runId} — FAILED: ${detail}`);
    record.status = "failed";
    record.detail = detail;
    record.completed_at = new Date().toISOString();
    return;
  }

  // Load leagues + teams from DB (authoritative CMS IDs); fall back to CSV if DB not configured
  let batchLeagues, batchTeams;
  const dbPool = getDbPoolForEnv(activeProfile.env);
  let catalogSource = "csv";
  if (dbPool) {
    console.log(`[batch-run] ${runId} — loading catalog from DB`);
    try {
      const dbCatalog = await queryCatalogRowsFromDb(dbPool);
      batchLeagues = normalizeLeagueRows(dbCatalog.leagues || []);
      batchTeams   = normalizeTeamRows(dbCatalog.teams || [], batchLeagues);
      catalogSource = "db";
    } catch (err) {
      console.warn(`[batch-run] ${runId} — DB catalog query failed (${err.message}), falling back to CSV`);
    }
  }
  if (!batchLeagues) {
    console.log(`[batch-run] ${runId} — loading catalog from CSV`);
    try {
      const catalogPayload = await getCatalogPayloadCached();
      batchLeagues = normalizeLeagueRows(catalogPayload.leagues || []);
      batchTeams   = normalizeTeamRows(catalogPayload.teams || [], batchLeagues);
    } catch (err) {
      const detail = `Catalog load failed: ${err.message}`;
      console.error(`[batch-run] ${runId} — FAILED: ${detail}`);
      record.status = "failed";
      record.detail = detail;
      record.completed_at = new Date().toISOString();
      return;
    }
  }

  const teamAliasIdx = buildTeamAliasIndex(batchTeams);
  console.log(`[batch-run] ${runId} — catalog loaded: ${batchLeagues.length} leagues, ${batchTeams.length} teams (source: ${catalogSource})`);

  const fixtureResults = [];
  let anyFailed = false;

  for (const fixture of fixtures) {
    const homeName  = fixture.home  || fixture.homeTeamName  || "";
    const awayName  = fixture.away  || fixture.awayTeamName  || "";
    const eventName = [homeName, awayName].filter(Boolean).join(" vs ");

    console.log(`\n[batch-run] ${runId} ── fixture: ${eventName}`);
    console.log(`[batch-run] ${runId}   id=${fixture.id}  leagueCode=${fixture.leagueCode}  kickoff=${fixture.kickoff}`);

    try {
      // ── 1. Resolve league ──────────────────────────────────────────────────
      const league = resolveBatchLeague(batchLeagues, fixture.leagueCode);
      if (!league) throw new Error(`League not found in catalog for code "${fixture.leagueCode}"`);
      console.log(`[batch-run] ${runId}   league → ${league.name} (${league.id})`);

      // ── 2. Resolve teams ───────────────────────────────────────────────────
      let homeTeam = resolveBatchTeam(teamAliasIdx, homeName, league.id);
      if (!homeTeam) throw new Error(`Home team "${homeName}" not found in catalog`);

      let awayTeam = resolveBatchTeam(teamAliasIdx, awayName, league.id);
      if (!awayTeam) throw new Error(`Away team "${awayName}" not found in catalog`);

      // If a team's leagueId doesn't match the fixture's league, query DB for
      // the correct team entry (teams can have multiple DB rows across leagues).
      if (dbPool && homeTeam.leagueId !== league.id) {
        const fixed = await resolveTeamByLeagueFromDb(dbPool, homeTeam.name, league.id);
        if (fixed) { homeTeam = fixed; console.log(`[batch-run] ${runId}   home team corrected from DB: ${fixed.name} (${fixed.id})`); }
        else console.warn(`[batch-run] ${runId}   WARN: home team has no entry for league ${league.id} in DB`);
      }
      if (dbPool && awayTeam.leagueId !== league.id) {
        const fixed = await resolveTeamByLeagueFromDb(dbPool, awayTeam.name, league.id);
        if (fixed) { awayTeam = fixed; console.log(`[batch-run] ${runId}   away team corrected from DB: ${fixed.name} (${fixed.id})`); }
        else console.warn(`[batch-run] ${runId}   WARN: away team has no entry for league ${league.id} in DB`);
      }

      console.log(`[batch-run] ${runId}   home  → ${homeTeam.name} (${homeTeam.id}) leagueId=${homeTeam.leagueId}`);
      console.log(`[batch-run] ${runId}   away  → ${awayTeam.name} (${awayTeam.id}) leagueId=${awayTeam.leagueId}`);

      // ── 3. Build fixture payload ───────────────────────────────────────────
      const kickoffIso  = fixture.kickoff || "";
      const kickoffDate = kickoffIso.split("T")[0] || "";
      const kickoffTime = (kickoffIso.split("T")[1] || "").replace("Z", "").slice(0, 5);
      const now         = new Date().toISOString();

      // Use team.name (common ASCII name, no hyphens) rather than alternateName
      // which can contain hyphens (e.g. "Paris Saint-Germain FC") that the API rejects.
      const catalogEventName = `${homeTeam.name || homeTeam.alternateName} vs ${awayTeam.name || awayTeam.alternateName}`;

      // Match the canonical UAT fixture generator shape exactly:
      // - integer match_day / match_week
      // - ISO kickoff with millisecond precision from Date#toISOString()
      const parsedKickoff = kickoffIso ? new Date(kickoffIso) : null;
      const hasValidKickoff = parsedKickoff instanceof Date && !Number.isNaN(parsedKickoff.getTime());
      const gameStartTime = hasValidKickoff ? parsedKickoff.toISOString() : kickoffIso;
      const parsedMatchDay = Number.parseInt(String(fixture.matchday || fixture.matchDay || "1"), 10);
      const parsedMatchWeek = Number.parseInt(String(fixture.matchWeek || fixture.match_week || "0"), 10);

      const fixturePayload = {
        name:            catalogEventName,
        league_id:       league.id,
        home_team_id:    homeTeam.id,
        away_team_id:    awayTeam.id,
        format:          null,
        logo_url:        "https://public-assets.pred.app/market-assets/fixture_128x128.png",
        theme_color:     "#FFFFFF",
        match_day:       Number.isInteger(parsedMatchDay) && parsedMatchDay > 0 ? parsedMatchDay : 1,
        match_week:      Number.isInteger(parsedMatchWeek) && parsedMatchWeek >= 0 ? parsedMatchWeek : 0,
        location:        "",
        venue:           "",
        game_start_time: gameStartTime,
        alternate_name:  buildUatFixtureAlternateName(homeTeam, awayTeam),
      };

      // ── 4. Fixture — DB lookup first, POST only if missing ─────────────────
      let fixtureUuid = null;
      if (dbPool) {
        try {
          const gameDate = gameStartTime.slice(0, 10);
          // Exact match: league + both team UUIDs
          const exact = await dbPool.query(
            `SELECT fixture_id FROM fixtures
             WHERE league_id = $1 AND home_team_id = $2 AND away_team_id = $3
             ORDER BY created_at DESC NULLS LAST LIMIT 1`,
            [league.id, homeTeam.id, awayTeam.id]
          );
          if (exact.rows.length > 0) {
            fixtureUuid = String(exact.rows[0].fixture_id).trim();
            console.log(`[batch-run] ${runId}   fixture found in DB (exact): ${fixtureUuid}`);
          } else {
            // Fallback: league + home team + game date (away team UUID may differ in DB)
            const byHome = await dbPool.query(
              `SELECT fixture_id, away_team_id FROM fixtures
               WHERE league_id = $1 AND home_team_id = $2 AND game_start_time::date = $3::date
               ORDER BY created_at DESC NULLS LAST LIMIT 1`,
              [league.id, homeTeam.id, gameDate]
            );
            if (byHome.rows.length > 0) {
              fixtureUuid = String(byHome.rows[0].fixture_id).trim();
              console.log(`[batch-run] ${runId}   fixture found in DB (home+date, away_uuid=${byHome.rows[0].away_team_id}): ${fixtureUuid}`);
            } else {
              // Fallback: league + away team + game date (home team UUID may differ in DB)
              const byAway = await dbPool.query(
                `SELECT fixture_id, home_team_id FROM fixtures
                 WHERE league_id = $1 AND away_team_id = $2 AND game_start_time::date = $3::date
                 ORDER BY created_at DESC NULLS LAST LIMIT 1`,
                [league.id, awayTeam.id, gameDate]
              );
              if (byAway.rows.length > 0) {
                fixtureUuid = String(byAway.rows[0].fixture_id).trim();
                console.log(`[batch-run] ${runId}   fixture found in DB (away+date, home_uuid=${byAway.rows[0].home_team_id}): ${fixtureUuid}`);
              } else {
                console.log(`[batch-run] ${runId}   no fixture in DB for league=${league.id} on date=${gameDate}, will POST`);
              }
            }
          }
        } catch (e) {
          console.warn(`[batch-run] ${runId}   DB fixture lookup failed (will POST): ${e.message}`);
        }
      }
      if (!fixtureUuid) {
        console.log(`[batch-run] ${runId}   POST fixture payload:`, JSON.stringify(fixturePayload));
        const fixtureResp = await postCmsJson(cmsConfig, cmsConfig.endpoints.fixture, fixturePayload);
        console.log(`[batch-run] ${runId}   fixture response:`, JSON.stringify(fixtureResp));
        fixtureUuid =
          String(
            fixtureResp?.fixture_id ||
            fixtureResp?.data?.fixture_id ||
            fixtureResp?.data?.id ||
            fixtureResp?.id ||
            ""
          ).trim() || null;
        if (!fixtureUuid) throw new Error(`Fixture POST returned no ID. Response: ${JSON.stringify(fixtureResp)}`);
        console.log(`[batch-run] ${runId}   fixture created: ${fixtureUuid}`);
      }

      // ── 5. Type reference — DB lookup first, POST only if missing ──────────
      const typeRefPayload = {
        type_value:     "fixture",
        type_value_id:  fixtureUuid,
        canonical_name: buildUatCanonicalFixtureName(catalogEventName, kickoffDate, fixture.leagueCode || league.key || league.code || ""),
      };
      let typeRefId = null;
      if (dbPool) {
        try {
          const rows = await dbPool.query(
            `SELECT id, type_reference_id FROM type_references WHERE type_value = 'fixture' AND type_value_id = $1 LIMIT 1`,
            [fixtureUuid]
          );
          if (rows.rows.length > 0) {
            typeRefId = pickUuidLikeValue(
              rows.rows[0].type_reference_id,
              rows.rows[0].id,
            );
            console.log(`[batch-run] ${runId}   type-ref found in DB: ${typeRefId}`);
          }
        } catch (e) {
          console.warn(`[batch-run] ${runId}   DB type-ref lookup failed (will POST): ${e.message}`);
        }
      }
      if (!typeRefId) {
        console.log(`[batch-run] ${runId}   POST type-ref payload:`, JSON.stringify(typeRefPayload));
        const typeRefResp = await postCmsJson(cmsConfig, cmsConfig.endpoints.typeReference, typeRefPayload);
        console.log(`[batch-run] ${runId}   type-ref response:`, JSON.stringify(typeRefResp));
        typeRefId = pickUuidLikeValue(
          typeRefResp?.type_reference_id ||
          typeRefResp?.meta?.type_reference_id ||
          typeRefResp?.data?.type_reference_id,
          typeRefResp?.id,
          typeRefResp?.meta?.id,
          typeRefResp?.data?.id,
        );
        if (!typeRefId) {
          throw new Error(`Type reference POST returned no ID. Response: ${JSON.stringify(typeRefResp)}`);
        }
        console.log(`[batch-run] ${runId}   type-ref id: ${typeRefId}`);
      }

      // ── 6. Parent markets — DB lookup first, POST only if missing ──────────
      const marketResults = [];
      const savedParentPayloads = {};

      for (const publishKey of publishKeys) {
        const [family, line, side] = publishKey.split("|");
        console.log(`[batch-run] ${runId}   publishKey="${publishKey}"  family=${family}  line=${line || "0"}  side=${side || "-"}`);

        const parentPayloads = buildUatParentPayloads({
          fixtureJson:     fixturePayload,
          league:          league,
          homeTeam:        homeTeam,
          awayTeam:        awayTeam,
          fixtureDateIso:  kickoffDate,
          kickoffTimeUtc:  kickoffTime,
          openIso:         kickoffIso,
          createdAtIso:    now,
          typeReferenceId: typeRefId,
          outputProfile:   "uat",
          marketLine:      line || "0",
          spreadTeamSide:  side || "home",
        });

        const familyPayload = parentPayloads?.[family];
        if (!familyPayload) {
          console.warn(`[batch-run] ${runId}   ⚠ no payload built for family "${family}" — skipping`);
          marketResults.push({ publish_key: publishKey, status: "skipped", reason: `No UAT payload for family "${family}"` });
          continue;
        }
        savedParentPayloads[publishKey] = familyPayload;

        // Check DB for existing or half-prepared parent market state for this slot.
        let existingParentState = null;
        if (dbPool) {
          try {
            const parent = familyPayload?.parent_market || {};
            const rows = await dbPool.query(
              `SELECT
                  pm.parent_market_id,
                  pm.parent_market_family,
                  pm.market_line,
                  pm.type_reference_id,
                  pm.title,
                  m.market_id,
                  m.team_id,
                  m.name AS market_name,
                  m.market_code
                 FROM parent_markets pm
                 LEFT JOIN markets m
                   ON m.parent_market_id = pm.parent_market_id
                WHERE type_reference_id = $1
                  AND parent_market_family = $2
                  AND market_line = $3
                  AND title = $4
                ORDER BY pm.created_at DESC NULLS LAST, m.created_at DESC NULLS LAST`,
              [
                typeRefId,
                String(parent.parent_market_family || "").trim(),
                String(parent.market_line ?? "").trim(),
                String(parent.title || "").trim(),
              ]
            );
            if (rows.rows.length > 0) {
              existingParentState = classifyExistingBatchParentMarketRows(rows.rows, {
                publishKey,
                homeTeamId: homeTeam.id,
                awayTeamId: awayTeam.id,
              });
              console.log(
                `[batch-run] ${runId}   parent-market state for key="${publishKey}": ${existingParentState.status}`
              );
            }
          } catch (e) {
            console.warn(`[batch-run] ${runId}   DB parent-market lookup failed (will POST): ${e.message}`);
          }
        }

        if (existingParentState?.status === "existing") {
          marketResults.push({ publish_key: publishKey, status: "exists" });
          continue;
        }

        if (existingParentState?.status === "half_prepared") {
          marketResults.push({
            publish_key: publishKey,
            status: "half_prepared",
            reason: String(existingParentState.warnings?.join(" ") || "").trim() || "Existing parent market is half-prepared.",
          });
          continue;
        }

        console.log(`[batch-run] ${runId}   POST parent-market payload:`, JSON.stringify(familyPayload));
        const pmResp = await postCmsJson(cmsConfig, cmsConfig.endpoints.parentMarket, familyPayload);
        console.log(`[batch-run] ${runId}   parent-market response:`, JSON.stringify(pmResp));
        marketResults.push({ publish_key: publishKey, status: "published" });
      }

      fixtureResults.push({
        fixture_key: fixture.id || eventName,
        event_name:  eventName,
        fixture_id:  fixtureUuid,
        status:      deriveBatchFixtureStatusFromMarkets(marketResults),
        markets:     marketResults,
        payloads: {
          fixture:        fixturePayload,
          type_reference: typeRefPayload,
          parent_markets: savedParentPayloads,
        },
      });

    } catch (err) {
      anyFailed = true;
      console.error(`[batch-run] ${runId}   FAILED "${eventName}": ${err.message}`);
      fixtureResults.push({
        fixture_key: fixture.id || eventName,
        event_name:  eventName,
        status:      "failed",
        reason:      String(err?.message || err),
        markets:     publishKeys.map(key => ({ publish_key: key, status: "failed" })),
      });
    }
  }

  record.fixtures     = fixtureResults;
  record.status       = deriveBatchRunStatusFromFixtures(fixtureResults, { anyFailed });
  record.completed_at = new Date().toISOString();
  console.log(`\n[batch-run] ${runId} — DONE: ${record.status} (${fixtureResults.length} fixture(s))`);
}

// ── Batch publish helpers ──────────────────────────────────────────────────────

function resolveBatchLeague(normalizedLeagues, leagueCode) {
  if (!leagueCode) return null;
  const normalizedScheduleCode = resolveLeagueScheduleCode(leagueCode) || String(leagueCode || "").trim().toLowerCase();
  const leagueDef = getLeagueScheduleDefinition(normalizedScheduleCode);
  const needles = new Set([
    normalizeForSearch(leagueCode),
    normalizeForSearch(normalizedScheduleCode),
    normalizeForSearch(leagueDef?.label),
    ...((Array.isArray(leagueDef?.aliases) ? leagueDef.aliases : []).map((alias) => normalizeForSearch(alias))),
  ]);
  return normalizedLeagues.find(l => {
    const haystack = new Set([
      normalizeForSearch(l.key),
      normalizeForSearch(l.name),
      normalizeForSearch(l.slug),
      normalizeForSearch(l.alternateName),
      ...((Array.isArray(l.aliases) ? l.aliases : []).map((alias) => normalizeForSearch(alias))),
    ]);
    for (const needle of needles) {
      if (needle && haystack.has(needle)) {
        return true;
      }
    }
    return false;
  }) || null;
}

function resolveBatchTeam(teamAliasIdx, teamName, leagueId) {
  if (!teamName) return null;
  const needle = normalizeForSearch(teamName);
  // Prefer exact alias match within the same league
  const candidates = teamAliasIdx.filter(e => e.alias === needle);
  if (candidates.length === 1) return candidates[0].team;
  const sameLeague = candidates.find(e => e.team.leagueId === leagueId);
  if (sameLeague) return sameLeague.team;
  if (candidates.length > 0) return candidates[0].team;
  // Fallback: substring match — collect all, prefer same league
  const partials = teamAliasIdx.filter(e => e.alias.includes(needle) || needle.includes(e.alias));
  if (partials.length === 1) return partials[0].team;
  const sameLeaguePartial = partials.find(e => e.team.leagueId === leagueId);
  return sameLeaguePartial?.team || partials[0]?.team || null;
}

// Query DB for a team entry with the exact league_id (fallback when catalog resolution
// picks a team from the wrong league, e.g. Liverpool with UCL league_id when EPL is needed).
async function resolveTeamByLeagueFromDb(pool, teamName, leagueId) {
  try {
    const rows = await pool.query(
      `SELECT team_id, name, alternate_name, league_id FROM teams
       WHERE league_id = $1 AND (name ILIKE $2 OR alternate_name ILIKE $2)
       ORDER BY name LIMIT 1`,
      [leagueId, teamName]
    );
    if (!rows.rows.length) return null;
    const r = rows.rows[0];
    return {
      id:            String(r.team_id || "").trim(),
      name:          String(r.name || "").trim(),
      alternateName: String(r.alternate_name || r.name || "").trim(),
      leagueId:      String(r.league_id || "").trim(),
    };
  } catch { return null; }
}

async function postCmsJson(cmsConfig, url, payload) {
  const headers = {
    "Content-Type": "application/json",
    Accept: "application/json",
  };
  if (cmsConfig.bearerToken) {
    headers.Authorization = `Bearer ${cmsConfig.bearerToken}`;
  }
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), cmsConfig.timeoutMs || 8000);
  try {
    const response = await fetch(url, {
      method: "POST",
      headers,
      body: JSON.stringify(payload),
      signal: controller.signal,
    });
    const text = await response.text();
    let body;
    try { body = JSON.parse(text); } catch { body = text; }
    if (!response.ok) {
      const respHeaders = {};
      for (const [k, v] of response.headers.entries()) respHeaders[k] = v;
      console.error(`[cms-post] ${response.status} from ${url}`);
      console.error(`[cms-post]   resp headers:`, JSON.stringify(respHeaders));
      console.error(`[cms-post]   resp body:`, typeof body === "string" ? body : JSON.stringify(body));
      throw new Error(`HTTP ${response.status} from ${url}: ${typeof body === "string" ? body : JSON.stringify(body)}`);
    }
    return body;
  } finally {
    clearTimeout(timeout);
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
    const relevantTables = ["fixtures", "type_references", "parent_markets", "markets", "leagues", "teams"];
    const samples = {};
    for (const table of relevantTables) {
      if (!schema[table]) continue;
      try {
        const r = await pool.query(`SELECT * FROM ${table} ORDER BY created_at DESC NULLS LAST LIMIT 3`);
        samples[table] = { columns: schema[table], rows: r.rows };
      } catch (e) {
        samples[table] = { columns: schema[table], error: e.message };
      }
    }
    sendJson(res, 200, { schema: Object.fromEntries(relevantTables.filter(t => schema[t]).map(t => [t, schema[t]])), samples });
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

    const result = await Promise.all(fixtureRows.map(async fixture => {
      const fid = fixture.fixture_id;
      const typeRefRes = await pool.query(
        `SELECT * FROM type_references WHERE type_value = 'fixture' AND type_value_id = $1 ORDER BY created_at DESC NULLS LAST`,
        [fid]
      );
      const typeRefs = typeRefRes.rows;
      const typeRefIds = typeRefs.map(r => r.type_reference_id || r.id).filter(Boolean);
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
        parent_markets:  parentMarkets,
      };
    }));

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
    const parentMarketIds = parentMarkets
      .map((row) => row.parent_market_id)
      .filter(Boolean);

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

  const fixtureName    = String(body?.fixture_name    || "").trim();
  const typeRefId      = String(body?.type_reference_id || "").trim();
  const marketFamily   = String(body?.market_family   || "").trim().toLowerCase();
  const marketLine     = String(body?.market_line     || "1.5").trim();
  const spreadTeamSide = String(body?.spread_team_side || "home").trim().toLowerCase();

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
    const kickoffIso  = row.game_start_time ? new Date(row.game_start_time).toISOString() : "";
    const kickoffDate = kickoffIso.slice(0, 10);
    const kickoffTime = kickoffIso.slice(11, 16);

    const leagueName = String(row.league_name || "").trim();
    const leagueSlug = leagueName.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "") || "league";

    const league   = { id: String(row.league_id   || "").trim(), name: leagueName, slug: leagueSlug };
    const homeTeam = { id: String(row.home_team_id || "").trim(), name: String(row.home_team_name || "").trim(), alternateName: String(row.home_team_alternate || row.home_team_name || "").trim() };
    const awayTeam = { id: String(row.away_team_id || "").trim(), name: String(row.away_team_name || "").trim(), alternateName: String(row.away_team_alternate || row.away_team_name || "").trim() };
    const fixtureJson = { name: String(row.name || "").trim(), league_id: league.id };

    const parentPayloads = buildUatParentPayloads({
      fixtureJson,
      league,
      homeTeam,
      awayTeam,
      fixtureDateIso:  kickoffDate,
      kickoffTimeUtc:  kickoffTime,
      openIso:         kickoffIso,
      createdAtIso:    new Date().toISOString(),
      typeReferenceId: typeRefId,
      outputProfile:   "uat",
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
      family:  marketFamily,
      fixture: { id: row.fixture_id, name: row.name, game_start_time: row.game_start_time },
      payload: familyPayload,
    });
  } catch (err) {
    sendJson(res, 500, { error: err.message });
  }
}

async function handleJsonPublishFixtureRequest(req, res) {
  const activeProfile = getActiveRuntimeEnvironmentProfile();
  const cmsConfig = createCmsRuntimeConfig(activeProfile.env);
  if (!cmsConfig.enabled) {
    sendJson(res, 503, { error: "CMS is not configured for this environment" });
    return;
  }
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
  if (!fixtureName) {
    sendJson(res, 400, { error: "fixture_name is required" });
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
    const kickoffIso  = row.game_start_time ? new Date(row.game_start_time).toISOString() : "";
    const kickoffDate = kickoffIso.slice(0, 10);

    const homeTeam = {
      id:            String(row.home_team_id || "").trim(),
      name:          String(row.home_team_name || "").trim(),
      alternateName: String(row.home_team_alternate || row.home_team_name || "").trim(),
    };
    const awayTeam = {
      id:            String(row.away_team_id || "").trim(),
      name:          String(row.away_team_name || "").trim(),
      alternateName: String(row.away_team_alternate || row.away_team_name || "").trim(),
    };
    const leagueName = String(row.league_name || "").trim();
    const league = {
      id:   String(row.league_id || "").trim(),
      name: leagueName,
      slug: leagueName.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "") || "league",
    };

    const fixturePayload = {
      name:            String(row.name || "").trim(),
      league_id:       league.id,
      home_team_id:    homeTeam.id,
      away_team_id:    awayTeam.id,
      format:          null,
      logo_url:        "https://public-assets.pred.app/market-assets/fixture_128x128.png",
      theme_color:     "#FFFFFF",
      match_day:       1,
      match_week:      0,
      location:        "",
      venue:           "",
      game_start_time: kickoffIso || null,
      alternate_name:  buildUatFixtureAlternateName(homeTeam, awayTeam),
    };

    // Use existing fixture_id from DB row if present — fixture already exists
    let fixtureUuid = String(row.fixture_id || "").trim() || null;
    const fixtureAlreadyExisted = Boolean(fixtureUuid);

    if (!fixtureUuid) {
      const fixtureResp = await postCmsJson(cmsConfig, cmsConfig.endpoints.fixture, fixturePayload);
      fixtureUuid = String(
        fixtureResp?.fixture_id  ||
        fixtureResp?.data?.fixture_id ||
        fixtureResp?.data?.id    ||
        fixtureResp?.id          ||
        ""
      ).trim() || null;
      if (!fixtureUuid) throw new Error(`Fixture POST returned no ID. Response: ${JSON.stringify(fixtureResp)}`);
    }

    const canonicalName = buildUatCanonicalFixtureName(
      String(row.name || "").trim(),
      kickoffDate,
      league.slug
    );
    const typeRefPayload = {
      type_value:     "fixture",
      type_value_id:  fixtureUuid,
      canonical_name: canonicalName,
    };

    let typeRefId = null;
    let typeRefAlreadyExisted = false;
    try {
      const typeRefRows = await pool.query(
        `SELECT id, type_reference_id FROM type_references WHERE type_value = 'fixture' AND type_value_id = $1 LIMIT 1`,
        [fixtureUuid]
      );
      if (typeRefRows.rows.length > 0) {
        typeRefId = pickUuidLikeValue(typeRefRows.rows[0].type_reference_id, typeRefRows.rows[0].id);
        typeRefAlreadyExisted = Boolean(typeRefId);
      }
    } catch (e) {
      console.warn(`[json-publish-fixture] DB type-ref lookup failed (will POST): ${e.message}`);
    }

    if (!typeRefId) {
      const typeRefResp = await postCmsJson(cmsConfig, cmsConfig.endpoints.typeReference, typeRefPayload);
      typeRefId = pickUuidLikeValue(
        typeRefResp?.type_reference_id,
        typeRefResp?.meta?.type_reference_id,
        typeRefResp?.data?.type_reference_id,
        typeRefResp?.id,
        typeRefResp?.meta?.id,
        typeRefResp?.data?.id,
      );
      if (!typeRefId) throw new Error(`Type reference POST returned no ID. Response: ${JSON.stringify(typeRefResp)}`);
    }

    sendJson(res, 200, {
      fixture_id:          fixtureUuid,
      fixture_existed:     fixtureAlreadyExisted,
      type_reference_id:   typeRefId,
      type_ref_existed:    typeRefAlreadyExisted,
      fixture_payload:     fixturePayload,
      type_ref_payload:    typeRefPayload,
      fixture_db_name:     String(row.name || "").trim(),
    });
  } catch (err) {
    console.error("[json-publish-fixture]", err.message);
    sendJson(res, 500, { error: err.message });
  }
}

async function handleJsonPublishParentMarketRequest(req, res) {
  const activeProfile = getActiveRuntimeEnvironmentProfile();
  const cmsConfig = createCmsRuntimeConfig(activeProfile.env);
  if (!cmsConfig.enabled) {
    sendJson(res, 503, { error: "CMS is not configured for this environment" });
    return;
  }

  let body;
  try {
    body = await readJsonRequestBody(req);
  } catch {
    sendJson(res, 400, { error: "Invalid JSON body" });
    return;
  }

  const payload = body?.payload;
  if (!payload || typeof payload !== "object" || Array.isArray(payload)) {
    sendJson(res, 400, { error: "payload (object) is required" });
    return;
  }

  try {
    const pmResp = await postCmsJson(cmsConfig, cmsConfig.endpoints.parentMarket, payload);
    sendJson(res, 200, { success: true, response: pmResp });
  } catch (err) {
    console.error("[json-publish-parent-market]", err.message);
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
  const requestedLeague = String(requestUrl.searchParams.get("league") || "").trim().toLowerCase();
  const leagueCode = normalizeScheduleLeagueCode(requestedLeague);
  const requestedNow = String(requestUrl.searchParams.get("now") || "").trim();
  if (!leagueCode) {
    const supportedLeagues = getLeagueScheduleDefinitions().map((definition) => `?league=${definition.code}`);
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
    const payload = await getUpcomingSchedulePayload(leagueCode, {
      refresh: requestUrl.searchParams.get("refresh") === "1",
      now: referenceNow,
    });
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

async function getUpcomingSchedulePayload(leagueCode, { refresh = false, now = null } = {}) {
  const hasCustomNow = now instanceof Date && !Number.isNaN(now.getTime());
  const resolvedNow = hasCustomNow ? new Date(now.getTime()) : resolveScheduleNow();
  const cacheKey = String(leagueCode || "").trim().toLowerCase();

  // Serve from stable cache unless refresh forced or a custom ?now= is given (test/debug only)
  if (!refresh && !hasCustomNow) {
    const cacheRecord = scheduleCache.get(cacheKey);
    if (cacheRecord) return cacheRecord.payload;
  }

  let payload = null;
  payload = await resolveSchedulePayloadWithFallback({
    loadSportsData: async () => {
      const sportsDataAdapter = getBackendFixtureSourceAdapter("sportsdata");
      const rawRows = await sportsDataAdapter.fetchRawRows({
        leagueCode,
        env: getActiveRuntimeEnvVars(),
        rootDir: ROOT_DIR,
        timeoutMs: resolveScheduleFetchTimeoutMs(),
        baseUrl: resolveSportsDataScheduleBaseUrl(),
        season: resolveSportsDataScheduleSeason(),
      });
      return sportsDataAdapter.createFixtureWindowPayload({
        leagueCode,
        rawRows,
        now: resolvedNow,
        fetchedAt: new Date().toISOString(),
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
      const rawRows = await lsportsDbAdapter.fetchRawRows({
        leagueCode,
        pool: dbPool,
        leagueNameLike,
        now: resolvedNow,
      });
      return lsportsDbAdapter.createFixtureWindowPayload({
        leagueCode,
        rawRows,
        now: resolvedNow,
        fetchedAt: new Date().toISOString(),
      });
    },
    loadPolymarket: async () => {
      const polymarketAdapter = getBackendFixtureSourceAdapter("polymarket");
      const rawRows = await polymarketAdapter.fetchRawRows({
        leagueCode,
        env: getActiveRuntimeEnvVars(),
        timeoutMs: resolveScheduleFetchTimeoutMs(),
        fetchImpl: fetch,
      });
      return polymarketAdapter.createFixtureWindowPayload({
        leagueCode,
        rawRows,
        now: resolvedNow,
        fetchedAt: new Date().toISOString(),
      });
    },
    loadLsportsCsv: async () => {
      const csvPath = LSPORTS_SCHEDULE_CSV_PATH;
      if (!csvPath) {
        return null;
      }
      return fetchLsportsCsvFixturesForLeague({
        csvFilePath: csvPath,
        leagueCode,
        now: resolvedNow,
      });
    },
  });

  // Compute version: bump only when genuinely new fixture IDs appear
  const newIds = new Set((payload?.fixtures || []).map(f => f.providerFixtureId).filter(Boolean));
  const existing = scheduleCache.get(cacheKey);
  const hasNewFixtures = !existing || [...newIds].some(id => !existing.fixtureIds?.has(id));
  const version = (existing?.version ?? 0) + (hasNewFixtures ? 1 : 0);

  // Don't write custom-now responses to the stable per-league cache
  if (!hasCustomNow) {
    const enriched = payload ? { ...payload, version } : null;
    scheduleCache.set(cacheKey, { payload: enriched, version, fetchedAt: new Date().toISOString(), fixtureIds: newIds });
    return enriched;
  }

  return payload;
}

function handleScheduleStatusRequest(res) {
  const leagues = {};
  for (const [code, record] of scheduleCache.entries()) {
    leagues[code] = {
      version:   record.version,
      fetchedAt: record.fetchedAt,
      count:     record.payload?.fixtures?.length ?? 0,
    };
  }
  sendJson(res, 200, { leagues });
}

async function backgroundRefreshAllSchedules() {
  const codes = [...scheduleCache.keys()];
  if (!codes.length) return;
  console.log(`[schedule-bg] refreshing ${codes.length} league(s): ${codes.join(", ")}`);
  for (const code of codes) {
    try {
      await getUpcomingSchedulePayload(code, { refresh: true });
      const r = scheduleCache.get(code);
      console.log(`[schedule-bg] ${code} — version=${r?.version} fixtures=${r?.payload?.fixtures?.length ?? 0}`);
    } catch (err) {
      console.warn(`[schedule-bg] refresh failed for "${code}": ${err.message}`);
    }
    // Stagger requests to avoid hammering sources simultaneously
    await new Promise(resolve => setTimeout(resolve, 800));
  }
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
      const catalogPayload = await getCatalogPayloadCached();
      catalogLeagues = normalizeLeagueRows(catalogPayload.leagues || []);
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

  const readySet = new Set(support.ready_leagues || []);
  const leagues = getLeagueScheduleDefinitions()
    .filter((def) => readySet.has(def.code))
    .map((def) => ({
      code: def.code,
      label: def.label,
      source: (support.leagues || []).find(l => l.code === def.code)?.config_source || "sportsdata",
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
  const scheduleNowIso = String(getActiveRuntimeEnvVars()?.SCHEDULE_NOW_ISO || SCHEDULE_NOW_ISO || "").trim();
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
  res.writeHead(200, buildResponseHeaders(contentType, fileBuffer.length, {}, { cacheControl: resolveStaticCacheControl(ext) }));
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
    const retryAfterSeconds = Math.max(1, Math.ceil((API_RATE_WINDOW_MS - (now - record.windowStart)) / 1000));
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
  if (!API_BEARER_TOKEN) {
    return !isBasicAuthEnabled() || hasValidBasicAuth(req);
  }
  return hasValidBearerAuth(req);
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
  const auth = String(req.headers.authorization || "").trim();
  if (!auth.startsWith("Bearer ")) {
    return false;
  }
  const token = auth.slice("Bearer ".length).trim();
  return token === API_BEARER_TOKEN;
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
    String(runtimeEnv.ALLOW_DOWNLOADS_CSV_FALLBACK || ALLOW_DOWNLOADS_CSV_FALLBACK || "").trim() === "1";
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
  const leagues = await pickFirstExistingPath(DEFAULT_LOCAL_LEAGUES_CSV_CANDIDATES);
  const teams = await pickFirstExistingPath(DEFAULT_LOCAL_TEAMS_CSV_CANDIDATES);
  if (!leagues || !teams) {
    return null;
  }
  return {
    leagues,
    teams,
    sourceKind: "workspace-catalog",
  };
}

async function pickFirstExistingPath(candidates = []) {
  for (const candidate of candidates) {
    if (!candidate) {
      continue;
    }
    if (await pathsExist(candidate)) {
      return candidate;
    }
  }
  return "";
}

async function resolveSupplementalCatalogPaths(primaryPaths, runtimeEnv = getActiveRuntimeEnvVars()) {
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
  const leagueFiles = [paths.leagues, ...(Array.isArray(paths.extraLeagues) ? paths.extraLeagues : [])];
  const teamFiles = [paths.teams, ...(Array.isArray(paths.extraTeams) ? paths.extraTeams : [])];
  const allFiles = [...leagueFiles, ...teamFiles];
  const allStats = await Promise.all(allFiles.map((filePath) => fs.stat(filePath)));
  const cacheKey = [runtimeProfile.code, ...allFiles
    .map((filePath, index) => `${filePath}:${allStats[index]?.mtimeMs || 0}`)
  ].join("|");
  if (catalogCache && catalogCache.key === cacheKey) {
    return {
      ...catalogCache.payload,
      cache: { hit: true, key: cacheKey, loaded_at: catalogCache.payload.loaded_at },
    };
  }

  const [leagueCsvs, teamCsvs] = await Promise.all([
    Promise.all(leagueFiles.map((filePath) => fs.readFile(filePath, "utf8"))),
    Promise.all(teamFiles.map((filePath) => fs.readFile(filePath, "utf8"))),
  ]);

  const leagues = mergeCatalogRows(
    leagueCsvs.map((csv) => parseSemicolonCsv(csv)),
    ["league_id", "id"]
  );
  const normalizedLeagues = normalizeLeagueStartWindows(leagues, { now: new Date() });
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
    payload,
  };

  return payload;
}

function describeCatalogSourceLabel(sourceKind) {
  const baseKind = typeof sourceKind === "string" ? sourceKind : String(sourceKind?.sourceKind || "");
  const hasSupplemental =
    Array.isArray(sourceKind?.extraLeagues) && sourceKind.extraLeagues.length > 0 ||
    Array.isArray(sourceKind?.extraTeams) && sourceKind.extraTeams.length > 0;
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
      supplemental_leagues_files: (paths.extraLeagues || []).map((filePath) => path.basename(filePath)),
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

function buildResponseHeaders(contentType, contentLength, extraHeaders = {}, { cacheControl = "no-store" } = {}) {
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

function pickUuidLikeValue(...values) {
  for (const value of values) {
    const normalized = String(value || "").trim();
    if (isUuidLike(normalized)) {
      return normalized;
    }
  }
  return null;
}

function isUuidLike(value) {
  return /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(String(value || "").trim());
}

function deriveBatchFixtureStatusFromMarkets(marketResults = []) {
  const statuses = (Array.isArray(marketResults) ? marketResults : [])
    .map((entry) => String(entry?.status || "").trim().toLowerCase())
    .filter(Boolean);

  if (statuses.some((status) => ["failed", "half_prepared", "blocked"].includes(status))) {
    return "partial";
  }
  if (statuses.length > 0 && statuses.every((status) => ["exists", "existing", "skipped"].includes(status))) {
    return "existing";
  }
  return "completed";
}

function deriveBatchRunStatusFromFixtures(fixtures = [], { anyFailed = false } = {}) {
  const statuses = (Array.isArray(fixtures) ? fixtures : [])
    .map((fixture) => String(fixture?.status || "").trim().toLowerCase())
    .filter(Boolean);

  if (statuses.some((status) => status === "partial")) {
    return "partial";
  }
  if (anyFailed) {
    return statuses.some((status) => ["completed", "existing"].includes(status)) ? "partial" : "failed";
  }
  return "completed";
}

function classifyExistingBatchParentMarketRows(rows = [], {
  publishKey = "",
  homeTeamId = "",
  awayTeamId = "",
} = {}) {
  return classifyParentStatusFromRows(rows, {
    selectedFixture: {
      home_team_id: String(homeTeamId || "").trim(),
      away_team_id: String(awayTeamId || "").trim(),
    },
    fixtureRecord: {
      home_team_id: String(homeTeamId || "").trim(),
      away_team_id: String(awayTeamId || "").trim(),
    },
    expectedMarketCount: getExpectedMarketCountForPublishKey(publishKey),
  });
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
  server,
};
