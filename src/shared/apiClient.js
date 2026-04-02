const API_BEARER_TOKEN_STORAGE_KEY = "fixture-ocr-market-builder-api-bearer-token-v1";

export function loadApiBearerToken() {
  const storage = getBrowserStorage();
  if (!storage) {
    return "";
  }

  try {
    return String(storage.getItem(API_BEARER_TOKEN_STORAGE_KEY) || "").trim();
  } catch {
    return "";
  }
}

export function saveApiBearerToken(token) {
  const storage = getBrowserStorage();
  if (!storage) {
    return { ok: false };
  }

  const value = String(token || "").trim();
  try {
    if (value) {
      storage.setItem(API_BEARER_TOKEN_STORAGE_KEY, value);
    } else {
      storage.removeItem(API_BEARER_TOKEN_STORAGE_KEY);
    }
    return { ok: true };
  } catch {
    return { ok: false };
  }
}

export function clearApiBearerToken() {
  return saveApiBearerToken("");
}

export async function fetchApiJson(url, { headers = {}, ...options } = {}) {
  const response = await fetch(url, {
    cache: options.cache ?? "no-store",
    credentials: options.credentials ?? "same-origin",
    ...options,
    headers: buildApiHeaders(headers),
  });

  let payload = null;
  try {
    payload = await response.json();
  } catch {
    payload = null;
  }

  if (!response.ok) {
    const error = new Error(
      String(payload?.detail || payload?.error || `Request failed with status ${response.status}.`)
    );
    error.status = response.status;
    error.payload = payload;
    error.requiresBearerToken =
      response.status === 401 &&
      /Bearer\b/i.test(String(response.headers.get("www-authenticate") || ""));
    throw error;
  }

  return payload;
}

export function isBearerAuthError(error) {
  return Boolean(error?.requiresBearerToken);
}

function buildApiHeaders(headers) {
  const normalized = { ...(headers && typeof headers === "object" ? headers : {}) };
  if (!hasHeader(normalized, "Accept")) {
    normalized.Accept = "application/json";
  }

  const token = loadApiBearerToken();
  if (token && !hasHeader(normalized, "Authorization")) {
    normalized.Authorization = `Bearer ${token}`;
  }

  return normalized;
}

function hasHeader(headers, name) {
  const target = String(name || "").trim().toLowerCase();
  return Object.keys(headers || {}).some((key) => String(key || "").trim().toLowerCase() === target);
}

function getBrowserStorage() {
  if (typeof window === "undefined" || !window.localStorage) {
    return null;
  }
  return window.localStorage;
}
