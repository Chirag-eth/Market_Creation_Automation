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
import {
  createCmsRuntimeConfig,
  publishCmsBundle,
  resolveCmsPublishBundle,
} from "./src/backend/cmsPublisher.js";
import { resolveLeagueScheduleCode } from "./src/shared/leagueRegistry.js";

const STARTUP_ENV = { ...process.env };
const ROOT_DIR = path.resolve(process.cwd());
for (const envFile of resolveDotEnvFiles(ROOT_DIR, process.env)) {
  loadDotEnv(envFile);
}
const RUNTIME_ENV_PROFILES = createRuntimeEnvironmentProfiles(ROOT_DIR, STARTUP_ENV);
let activeRuntimeEnvCode = resolveRuntimeEnvironmentCode(process.env);
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

    if (requestUrl.pathname === "/api/catalog/meta") {
      await handleCatalogMetaRequest(res);
      return;
    }

    if (requestUrl.pathname === "/api/schedules/upcoming") {
      await handleUpcomingScheduleRequest(requestUrl, res);
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
    files.push(
      path.isAbsolute(explicitEnvFile)
        ? explicitEnvFile
        : path.resolve(resolvedRoot, explicitEnvFile)
    );
  } else if (appEnv) {
    files.push(path.resolve(resolvedRoot, `.env.${appEnv}`));
  }

  files.push(path.resolve(resolvedRoot, ".env"));

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
  const uatEnvFile = path.resolve(resolvedRoot, ".env.uat");
  const sanitizedStartupEnv = sanitizeRuntimeStartupEnv(startupEnv);
  const mainnetFileValues = readDotEnvValues(mainnetEnvFile);
  const uatFileValues = readDotEnvValues(uatEnvFile);

  return {
    mainnet: {
      code: "mainnet",
      label: "Mainnet",
      envFile: mainnetEnvFile,
      available: true,
      env: {
        ...mainnetFileValues,
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
    sendJson(res, 400, {
      error: "Unsupported league",
      detail:
        "Pass ?league=epl, ?league=ucl, ?league=laliga, ?league=fifa-worldcup, or ?league=fifa-friendlies for the wired schedule provider.",
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
  const resolvedNow = now instanceof Date && !Number.isNaN(now.getTime()) ? new Date(now.getTime()) : resolveScheduleNow();
  const referenceNowIso = resolvedNow.toISOString();
  const cacheKey = `${String(leagueCode || "").trim().toLowerCase()}::${referenceNowIso}`;
  const cacheRecord = scheduleCache.get(cacheKey);
  if (!refresh && cacheRecord && cacheRecord.expiresAt > Date.now()) {
    return cacheRecord.payload;
  }

  const sportsDataAdapter = getBackendFixtureSourceAdapter("sportsdata");
  const rawRows = await sportsDataAdapter.fetchRawRows({
    leagueCode,
    env: getActiveRuntimeEnvVars(),
    rootDir: ROOT_DIR,
    timeoutMs: resolveScheduleFetchTimeoutMs(),
    baseUrl: resolveSportsDataScheduleBaseUrl(),
    season: resolveSportsDataScheduleSeason(),
  });
  const payload = sportsDataAdapter.createFixtureWindowPayload({
    leagueCode,
    rawRows,
    now: resolvedNow,
    fetchedAt: new Date().toISOString(),
  });

  scheduleCache.set(cacheKey, {
    expiresAt: Date.now() + resolveScheduleCacheTtlMs(),
    payload,
  });

  return payload;
}

async function fetchRawScheduleRows(leagueCode) {
  const sportsDataAdapter = getBackendFixtureSourceAdapter("sportsdata");
  return sportsDataAdapter.fetchRawRows({
    leagueCode,
    env: getActiveRuntimeEnvVars(),
    rootDir: ROOT_DIR,
    timeoutMs: resolveScheduleFetchTimeoutMs(),
    baseUrl: resolveSportsDataScheduleBaseUrl(),
    season: resolveSportsDataScheduleSeason(),
  });
}

function normalizeScheduleLeagueCode(value) {
  return resolveLeagueScheduleCode(value);
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
  server,
};
