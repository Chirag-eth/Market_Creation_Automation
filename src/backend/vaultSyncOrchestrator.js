// Glue between CMS publish flows and the Vault-Automation HTTP service.
// One fixture: assign vault → POST sync-fixture → shape result.
// Many fixtures (batch path): same per-fixture, with a concurrency cap.
//
// The result shape is what publish flows embed in runRecord.vault_sync /
// fixtureResults[].vault_sync — keep it stable, the UI/tests rely on it.

import { assignVaultForFixture } from "./vaultRouter.js";
import { syncFixture } from "./vaultAutomationClient.js";

const DEFAULT_CONCURRENCY = 4;

export function buildPolymarketUrl(eventId) {
  const id = String(eventId || "").trim();
  if (!id) return "";
  if (/^https?:\/\//i.test(id)) {
    return id.replace(/\/+$/, "");
  }
  return `https://polymarket.com/market/${encodeURIComponent(id)}`;
}

function pickPolymarketUrl(fixture) {
  const direct = String(fixture?.polymarket_url || fixture?.polymarketUrl || "").trim();
  if (/^https?:\/\//i.test(direct)) {
    return direct.replace(/\/+$/, "");
  }
  return buildPolymarketUrl(
    fixture?.polymarket_event_id ||
      fixture?.polymarketEventId ||
      fixture?.sourceMeta?.polymarketEventId ||
      ""
  );
}

function shapeFromClient(clientResult, vault, durationMs) {
  if (clientResult.status === "ok") {
    const body = clientResult.body || {};
    return {
      status: "completed",
      vault,
      sync_posted: Number(body.sync_posted || 0),
      sync_already_exists: Number(body.sync_already_exists || 0),
      sync_duplicate: Number(body.sync_duplicate || 0),
      sync_replaced: Number(body.sync_replaced || 0),
      sync_failed: Number(body.sync_failed || 0),
      duration_ms: durationMs,
    };
  }
  if (clientResult.status === "client_error") {
    return {
      status: "client_error",
      vault,
      reason: `vault sync rejected (HTTP ${clientResult.statusCode})`,
      body: clientResult.body,
      duration_ms: durationMs,
    };
  }
  // "disabled" / "skipped" pass through with their reason
  return {
    status: clientResult.status,
    vault,
    reason: clientResult.reason || "",
    duration_ms: durationMs,
  };
}

export async function syncSingleFixtureAfterPublish(pool, fixture, vaultConfig, log) {
  const startedAt = Date.now();
  if (!vaultConfig?.enabled) {
    return {
      status: "disabled",
      vault: null,
      reason: vaultConfig?.disabledReason || "VAULT_AUTOMATION_HOST not set",
      duration_ms: 0,
    };
  }

  const fixtureId = String(fixture?.fixture_id || fixture?.fixtureId || "").trim();
  const gameStartTime = fixture?.game_start_time || fixture?.gameStartTime || "";
  const polymarketUrl = pickPolymarketUrl(fixture);

  if (!polymarketUrl) {
    return {
      status: "skipped",
      vault: null,
      reason: "no polymarket URL",
      duration_ms: Date.now() - startedAt,
    };
  }
  if (!fixtureId) {
    return {
      status: "skipped",
      vault: null,
      reason: "no fixture_id",
      duration_ms: Date.now() - startedAt,
    };
  }
  if (!gameStartTime) {
    return {
      status: "skipped",
      vault: null,
      reason: "no game_start_time",
      duration_ms: Date.now() - startedAt,
    };
  }

  let assignment;
  try {
    assignment = await assignVaultForFixture(pool, { fixtureId, gameStartTime });
  } catch (err) {
    log?.error?.(
      { err: String(err?.message || err), fixtureId },
      "vault sync failed at vault assignment"
    );
    return {
      status: "failed",
      vault: null,
      error: `vault assignment failed: ${String(err?.message || err)}`,
      duration_ms: Date.now() - startedAt,
    };
  }

  log?.info?.(
    { fixtureId, vault: assignment.vault, isNew: assignment.isNew },
    "vault assigned, posting sync-fixture"
  );

  let clientResult;
  try {
    clientResult = await syncFixture({
      config: vaultConfig,
      polymarketUrl,
      cmsFixtureId: fixtureId,
      vault: assignment.vault,
      log,
    });
  } catch (err) {
    log?.error?.(
      { err: String(err?.message || err), fixtureId, vault: assignment.vault },
      "vault sync HTTP failed after retries"
    );
    return {
      status: "failed",
      vault: assignment.vault,
      error: String(err?.message || err),
      duration_ms: Date.now() - startedAt,
    };
  }

  return shapeFromClient(clientResult, assignment.vault, Date.now() - startedAt);
}

export async function syncFixturesAfterPublish(
  pool,
  fixtures,
  vaultConfig,
  log,
  { concurrency = DEFAULT_CONCURRENCY } = {}
) {
  if (!Array.isArray(fixtures) || fixtures.length === 0) return [];
  if (!vaultConfig?.enabled) {
    return fixtures.map(() => ({
      status: "disabled",
      vault: null,
      reason: vaultConfig?.disabledReason || "VAULT_AUTOMATION_HOST not set",
      duration_ms: 0,
    }));
  }
  return runWithConcurrency(fixtures, concurrency, async (fixture) =>
    syncSingleFixtureAfterPublish(pool, fixture, vaultConfig, log)
  );
}

async function runWithConcurrency(items, limit, worker) {
  const results = new Array(items.length);
  let next = 0;
  async function pull() {
    while (true) {
      const i = next;
      next += 1;
      if (i >= items.length) return;
      results[i] = await worker(items[i], i);
    }
  }
  const cap = Math.max(1, Math.min(limit, items.length));
  await Promise.all(Array.from({ length: cap }, () => pull()));
  return results;
}
