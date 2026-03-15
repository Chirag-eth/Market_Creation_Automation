import http from "node:http";
import { existsSync, readFileSync } from "node:fs";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

loadDotEnv(path.resolve(process.cwd(), ".env"));

const PORT = parsePositiveIntegerEnv(process.env.PORT, 2020, { min: 1 });
const ROOT_DIR = path.resolve(process.cwd());
const DEFAULT_DOWNLOADS_LEAGUES_CSV_PATH = path.join(os.homedir(), "Downloads", "leagues.csv");
const DEFAULT_DOWNLOADS_TEAMS_CSV_PATH = path.join(os.homedir(), "Downloads", "teams.csv");
const DEFAULT_LOCAL_LEAGUES_CSV_PATH = path.join(ROOT_DIR, "Info-source", "leagues.csv");
const DEFAULT_LOCAL_TEAMS_CSV_PATH = path.join(ROOT_DIR, "Info-source", "teams.csv");
const ALLOW_DOWNLOADS_CSV_FALLBACK = String(process.env.ALLOW_DOWNLOADS_CSV_FALLBACK || "").trim() === "1";
const TRUST_PROXY = String(process.env.TRUST_PROXY || "").trim() === "1";
const API_BEARER_TOKEN = String(process.env.API_BEARER_TOKEN || "").trim();
const APP_BASIC_AUTH_USER = String(process.env.APP_BASIC_AUTH_USER || "").trim();
const APP_BASIC_AUTH_PASS = String(process.env.APP_BASIC_AUTH_PASS || "").trim();
const API_RATE_WINDOW_MS = parsePositiveIntegerEnv(process.env.API_RATE_WINDOW_MS, 60_000, { min: 1_000 });
const API_RATE_MAX_REQUESTS = parsePositiveIntegerEnv(process.env.API_RATE_MAX_REQUESTS, 180, { min: 1 });

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

    if (requestUrl.pathname === "/api/catalog/meta") {
      await handleCatalogMetaRequest(res);
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

async function serveStaticFile(urlPathname, res) {
  let pathname = decodeURIComponent(urlPathname);
  if (pathname === "/") {
    pathname = "/index.html";
  }

  const vendorPath = resolveVendorAssetPath(pathname);
  let safePath = vendorPath;
  if (!safePath) {
    safePath = path.resolve(ROOT_DIR, `.${pathname}`);
    const relativePath = path.relative(ROOT_DIR, safePath);
    if (relativePath.startsWith("..") || path.isAbsolute(relativePath)) {
      sendText(res, 403, "Forbidden");
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
  if (isBasicAuthEnabled() && hasValidBasicAuth(req)) {
    return true;
  }
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
  const envLeagues = String(process.env.LEAGUES_CSV_PATH || "").trim();
  const envTeams = String(process.env.TEAMS_CSV_PATH || "").trim();
  if (envLeagues || envTeams) {
    if (!envLeagues || !envTeams) {
      throw new Error("Set both LEAGUES_CSV_PATH and TEAMS_CSV_PATH when using env CSV overrides.");
    }
    return { leagues: envLeagues, teams: envTeams, sourceKind: "env" };
  }

  const localPaths = {
    leagues: DEFAULT_LOCAL_LEAGUES_CSV_PATH,
    teams: DEFAULT_LOCAL_TEAMS_CSV_PATH,
    sourceKind: "workspace-info-source",
  };
  if (await pathsExist(localPaths.leagues, localPaths.teams)) {
    return localPaths;
  }

  if (ALLOW_DOWNLOADS_CSV_FALLBACK) {
    const downloadPaths = {
      leagues: DEFAULT_DOWNLOADS_LEAGUES_CSV_PATH,
      teams: DEFAULT_DOWNLOADS_TEAMS_CSV_PATH,
      sourceKind: "downloads",
    };
    if (await pathsExist(downloadPaths.leagues, downloadPaths.teams)) {
      return downloadPaths;
    }
  }

  throw new Error(
    `Could not locate leagues.csv and teams.csv (checked env and Info-source/).` +
      `${
        ALLOW_DOWNLOADS_CSV_FALLBACK
          ? " Downloads fallback was enabled but files were not found."
          : " Set ALLOW_DOWNLOADS_CSV_FALLBACK=1 to also check ~/Downloads."
      }`
  );
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
  const paths = await resolveCatalogPaths();
  const [leagueStat, teamStat] = await Promise.all([fs.stat(paths.leagues), fs.stat(paths.teams)]);
  const cacheKey = `${paths.leagues}:${leagueStat.mtimeMs}|${paths.teams}:${teamStat.mtimeMs}`;
  if (catalogCache && catalogCache.key === cacheKey) {
    return {
      ...catalogCache.payload,
      cache: { hit: true, key: cacheKey, loaded_at: catalogCache.payload.loaded_at },
    };
  }

  const [leaguesCsv, teamsCsv] = await Promise.all([
    fs.readFile(paths.leagues, "utf8"),
    fs.readFile(paths.teams, "utf8"),
  ]);

  const leagues = parseSemicolonCsv(leaguesCsv);
  const teams = parseSemicolonCsv(teamsCsv);
  const payload = {
    source: {
      kind: "csv-files",
      label: describeCatalogSourceLabel(paths.sourceKind),
      source_kind: paths.sourceKind,
      leagues_file: path.basename(paths.leagues),
      teams_file: path.basename(paths.teams),
    },
    counts: {
      leagues: leagues.length,
      teams: teams.length,
    },
    loaded_at: new Date().toISOString(),
    cache: { hit: false, key: cacheKey },
    leagues,
    teams,
  };

  catalogCache = {
    key: cacheKey,
    payload,
  };

  return payload;
}

function describeCatalogSourceLabel(sourceKind) {
  if (sourceKind === "env") return "CSV files (env override)";
  if (sourceKind === "workspace-info-source") return "Workspace Info-source CSV files";
  return "Downloads CSV files";
}

async function getCatalogSourceMetaSafe() {
  try {
    const paths = await resolveCatalogPaths();
    return {
      kind: "csv-files",
      label: describeCatalogSourceLabel(paths.sourceKind),
      source_kind: paths.sourceKind,
      leagues_file: path.basename(paths.leagues),
      teams_file: path.basename(paths.teams),
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
