import { getLeagueScheduleDefinition } from "../../shared/leagueRegistry.js";

export const POLYMARKET_FUTURES_SOURCE_KEY = "polymarket-futures";

const GAMMA_BASE_URL = "https://gamma-api.polymarket.com";
const CACHE_TTL_MS = 5 * 60 * 1000;

// Cache key: `${leagueCode}` → { futures, time }. Single league fetches; small
// surface keeps invalidation simple.
const _leagueCache = new Map();

// Heuristic title patterns that disqualify an event as a "league future".
// We aggressively drop matchups; everything else (season-long markets) stays.
const VS_TITLE_RE = /\bvs\.?\s/i;

export async function fetchPolymarketLeagueFutures({
  leagueCode,
  env = process.env,
  timeoutMs = 10000,
  fetchImpl = fetch,
  forceRefresh = false,
} = {}) {
  const definition = getLeagueScheduleDefinition(leagueCode);
  if (!definition) {
    throw new Error(`No league definition for "${leagueCode}".`);
  }

  const tagSlugs = Array.isArray(definition.gammaTagSlugs) ? definition.gammaTagSlugs : [];
  if (tagSlugs.length === 0) {
    return { futures: [], reason: "no polymarket mapping" };
  }

  const now = Date.now();
  const cacheKey = String(leagueCode);
  if (!forceRefresh) {
    const cached = _leagueCache.get(cacheKey);
    if (cached && now - cached.time < CACHE_TTL_MS) {
      return { futures: cached.futures, cached: true };
    }
  }

  const results = await Promise.allSettled(
    tagSlugs.map((slug) => fetchEventsBySlug(slug, { timeoutMs, fetchImpl }))
  );

  const seen = new Set();
  const rawEvents = [];
  for (const result of results) {
    if (result.status !== "fulfilled") continue;
    for (const event of result.value) {
      const id = String(event.id || "");
      if (!id || seen.has(id)) continue;
      seen.add(id);
      rawEvents.push(event);
    }
  }

  const futures = rawEvents
    .filter(isFutureEvent)
    .map(normalizePolymarketFuture)
    .filter(Boolean)
    .sort(
      (a, b) =>
        (a.endDate || "").localeCompare(b.endDate || "") ||
        String(a.title || "").localeCompare(String(b.title || ""))
    );

  _leagueCache.set(cacheKey, { futures, time: now });
  return { futures, cached: false };
}

// Identifies a Gamma event as a futures-style market: not a vs. matchup, has
// markets, and is not closed/archived. Matchup sub-markets contain " - ", e.g.
// "Arsenal vs Tottenham - Exact Score" — those still slip through the vs-skip
// because they include "vs"; we keep them out via the same regex.
function isFutureEvent(row) {
  if (!row || typeof row !== "object") return false;
  if (row.closed || row.archived) return false;
  const title = String(row.title || "").trim();
  if (!title) return false;
  if (VS_TITLE_RE.test(title)) return false;
  const markets = Array.isArray(row.markets) ? row.markets : [];
  if (markets.length === 0) return false;
  return true;
}

export function normalizePolymarketFuture(row) {
  if (!row || typeof row !== "object") return null;
  const eventId = String(row.id || "").trim();
  if (!eventId) return null;
  const slug = String(row.slug || "").trim();
  const title = String(row.title || "").trim();
  if (!title) return null;

  // Show only outcomes that are still live: not yet resolved AND publicly
  // active. Polymarket signals "resolved" through multiple flags that don't
  // always flip together, so we check all of them — see isResolvedOutcome.
  const outcomes = (Array.isArray(row.markets) ? row.markets : [])
    .map(normalizePolymarketFutureOutcome)
    .filter((o) => o && o.active && !isResolvedOutcome(o));
  if (outcomes.length === 0) return null;

  const futureKey = slug || `polymarket-event-${eventId}`;
  const endDate = parseIsoDate(row.endDate);

  return {
    future_key: futureKey,
    title,
    description: String(row.description || "").trim() || null,
    polymarket_event_id: eventId,
    polymarket_slug: slug || null,
    endDate,
    image: String(row.image || "").trim() || null,
    icon: String(row.icon || "").trim() || null,
    negRisk: Boolean(row.negRisk),
    outcomes,
  };
}

function normalizePolymarketFutureOutcome(market) {
  if (!market || typeof market !== "object") return null;
  const marketId = String(market.id || "").trim();
  if (!marketId) return null;
  const name = String(market.groupItemTitle || "").trim();
  if (!name) return null;

  const prices = parsePricesField(market.outcomePrices);
  const probability = Number.isFinite(prices?.yes) ? prices.yes : null;

  return {
    name,
    polymarket_market_id: marketId,
    polymarket_condition_id: String(market.conditionId || "").trim() || null,
    question: String(market.question || "").trim() || null,
    probability,
    image: String(market.image || "").trim() || null,
    icon: String(market.icon || "").trim() || null,
    closed: Boolean(market.closed),
    active: Boolean(market.active),
    accepting_orders: market.acceptingOrders !== false, // default to true when unset
    uma_status:
      String(market.umaResolutionStatus || "")
        .trim()
        .toLowerCase() || null,
    outcome_prices: prices, // {yes, no} object or null
  };
}

// Any one of these signals is enough to treat an outcome as resolved (i.e.
// permanently settled to Yes or No) and hide it from the operator. Polymarket
// doesn't flip all flags atomically — for the "3rd Place" UI screenshot, some
// teams have `closed: true` while others have only `acceptingOrders: false` or
// `umaResolutionStatus: "resolved"`. Stacking checks makes the filter robust.
export function isResolvedOutcome(outcome) {
  if (!outcome || typeof outcome !== "object") return false;
  if (outcome.closed === true) return true;
  if (outcome.accepting_orders === false) return true;
  if (outcome.uma_status === "resolved") return true;
  // Terminal pricing: Yes==0 OR Yes==1 means the market has paid out, even if
  // the other flags lag. Treat with a tiny epsilon since some venues return
  // 0.0000001 for "effectively zero" rather than exact 0.
  const yes = outcome.outcome_prices?.yes;
  if (Number.isFinite(yes) && (yes <= 0.0001 || yes >= 0.9999)) {
    // Only treat as resolved if the market is also no longer accepting orders
    // OR closed; a live market at 99.99¢ is still tradeable until settlement.
    // Without the gate, a heavy favorite (e.g., Man United 98%) would be hidden.
    if (outcome.closed || outcome.accepting_orders === false || outcome.uma_status === "resolved") {
      return true;
    }
  }
  return false;
}

// Gamma returns outcomePrices as a JSON-string-of-array, e.g. '["0.18", "0.82"]'.
// Convention is index 0 = Yes price, index 1 = No price. We expose `yes` only.
function parsePricesField(field) {
  if (!field) return null;
  let arr = field;
  if (typeof field === "string") {
    try {
      arr = JSON.parse(field);
    } catch {
      return null;
    }
  }
  if (!Array.isArray(arr) || arr.length === 0) return null;
  const yes = Number.parseFloat(arr[0]);
  const no = arr.length > 1 ? Number.parseFloat(arr[1]) : null;
  return {
    yes: Number.isFinite(yes) ? yes : null,
    no: Number.isFinite(no) ? no : null,
  };
}

function parseIsoDate(raw) {
  const s = String(raw || "").trim();
  if (!s) return null;
  const d = new Date(s);
  if (Number.isNaN(d.getTime())) return null;
  return d.toISOString();
}

async function fetchEventsBySlug(slug, { timeoutMs = 10000, fetchImpl = fetch } = {}) {
  const url = new URL(`${GAMMA_BASE_URL}/events`);
  url.searchParams.set("tag_slug", slug);
  url.searchParams.set("closed", "false");
  url.searchParams.set("limit", "500");

  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const response = await fetchImpl(url.toString(), {
      signal: controller.signal,
      headers: { Accept: "application/json" },
    });
    if (!response.ok) {
      throw new Error(`Gamma API returned ${response.status}`);
    }
    const data = await response.json();
    return Array.isArray(data) ? data : [];
  } catch (err) {
    if (err?.name === "AbortError") {
      throw new Error(`Gamma API timed out after ${timeoutMs}ms`);
    }
    throw err;
  } finally {
    clearTimeout(timeoutId);
  }
}

export function _clearFuturesCacheForTests() {
  _leagueCache.clear();
}
