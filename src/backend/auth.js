import { randomBytes } from "node:crypto";

const SESSION_COOKIE_NAME = "mo-session";
const STATE_TTL_MS        = 10 * 60 * 1000; // 10 min

// ── Stores ────────────────────────────────────────────────────────────────────

// sessionId → { email, name, initials, expiresAt }
const sessions = new Map();

// oauthState → expiresAt  (CSRF nonce, one-time use)
const pendingStates = new Map();

// ── Session ───────────────────────────────────────────────────────────────────

export function createSession(userData, ttlMs = 86_400_000) {
  const sessionId = randomBytes(32).toString("hex");
  sessions.set(sessionId, { ...userData, expiresAt: Date.now() + ttlMs });
  return sessionId;
}

export function getSession(sessionId) {
  if (!sessionId) return null;
  const entry = sessions.get(sessionId);
  if (!entry) return null;
  if (entry.expiresAt <= Date.now()) {
    sessions.delete(sessionId);
    return null;
  }
  return entry;
}

export function deleteSession(sessionId) {
  if (sessionId) sessions.delete(sessionId);
}

export function purgeExpiredSessions() {
  const now = Date.now();
  for (const [id, entry] of sessions) {
    if (entry.expiresAt <= now) sessions.delete(id);
  }
  for (const [state, expiresAt] of pendingStates) {
    if (expiresAt <= now) pendingStates.delete(state);
  }
}

// ── Cookie helpers ─────────────────────────────────────────────────────────────

export function parseSessionCookie(req) {
  const raw = String(req.headers?.cookie || "");
  for (const part of raw.split(";")) {
    const trimmed = part.trim();
    if (trimmed.startsWith(`${SESSION_COOKIE_NAME}=`)) {
      return trimmed.slice(SESSION_COOKIE_NAME.length + 1).trim() || null;
    }
  }
  return null;
}

export function buildSessionCookie(sessionId, { secure = false, ttlSeconds = 86400 } = {}) {
  let cookie = `${SESSION_COOKIE_NAME}=${sessionId}; HttpOnly; SameSite=Lax; Path=/; Max-Age=${ttlSeconds}`;
  if (secure) cookie += "; Secure";
  return cookie;
}

export function buildClearSessionCookie() {
  return `${SESSION_COOKIE_NAME}=; HttpOnly; SameSite=Lax; Path=/; Max-Age=0`;
}

// ── OAuth state nonce ─────────────────────────────────────────────────────────

export function createOAuthState() {
  const state = randomBytes(16).toString("hex");
  pendingStates.set(state, Date.now() + STATE_TTL_MS);
  return state;
}

export function validateOAuthState(state) {
  if (!state) return false;
  const expiresAt = pendingStates.get(state);
  pendingStates.delete(state); // one-time use regardless
  return Boolean(expiresAt && expiresAt > Date.now());
}

// ── Google OAuth ──────────────────────────────────────────────────────────────

export function buildGoogleAuthUrl(clientId, redirectUri, state) {
  const url = new URL("https://accounts.google.com/o/oauth2/v2/auth");
  url.searchParams.set("client_id",     clientId);
  url.searchParams.set("redirect_uri",  redirectUri);
  url.searchParams.set("response_type", "code");
  url.searchParams.set("scope",         "openid email profile");
  url.searchParams.set("state",         state);
  url.searchParams.set("access_type",   "online");
  url.searchParams.set("prompt",        "select_account");
  return url.toString();
}

export async function exchangeGoogleCode(code, redirectUri, clientId, clientSecret) {
  const resp = await fetch("https://oauth2.googleapis.com/token", {
    method:  "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      code,
      redirect_uri:  redirectUri,
      client_id:     clientId,
      client_secret: clientSecret,
      grant_type:    "authorization_code",
    }),
    signal: AbortSignal.timeout(8000),
  });
  if (!resp.ok) {
    const body = await resp.text().catch(() => "");
    throw new Error(`Google token exchange failed (${resp.status}): ${body.slice(0, 200)}`);
  }
  return resp.json();
}

export async function verifyGoogleIdToken(idToken, clientId) {
  const resp = await fetch(
    `https://oauth2.googleapis.com/tokeninfo?id_token=${encodeURIComponent(idToken)}`,
    { signal: AbortSignal.timeout(8000) }
  );
  if (!resp.ok) throw new Error(`tokeninfo failed: ${resp.status}`);
  const payload = await resp.json();
  if (payload.aud !== clientId)    throw new Error("Token audience mismatch");
  if (!payload.email_verified)     throw new Error("Email not verified by Google");
  if (!payload.email)              throw new Error("No email in token");
  return { email: payload.email, name: payload.name || "", sub: payload.sub || "" };
}

// ── Helpers ───────────────────────────────────────────────────────────────────

export function isOrgEmail(email, domain) {
  return (
    typeof email === "string" &&
    email.toLowerCase().endsWith(`@${domain.toLowerCase()}`)
  );
}

export function deriveInitials(name) {
  return String(name || "")
    .trim()
    .split(/\s+/)
    .map((p) => p[0] || "")
    .join("")
    .slice(0, 2)
    .toUpperCase();
}
