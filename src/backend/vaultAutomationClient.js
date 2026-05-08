// Thin HTTP client for the Vault-Automation pred-polymarket-http service.
// Single attempt: POST {endpoint} with an AbortController-bounded timeout.
// Retry policy: only on 5xx and network/abort errors, up to config.retryCount.
// 4xx is returned as { status: "client_error" } without retry (a malformed
// payload won't succeed on a second try).

const RETRY_BACKOFF_MS = 1_000;

export async function syncFixture({
  config,
  polymarketUrl,
  cmsFixtureId,
  vault,
  log,
  fetchImpl = globalThis.fetch,
  sleepImpl = (ms) => new Promise((r) => setTimeout(r, ms)),
} = {}) {
  if (!config?.enabled) {
    return { status: "disabled", body: null, statusCode: 0, attempts: 0 };
  }
  if (!polymarketUrl) {
    return {
      status: "skipped",
      reason: "missing polymarket_url",
      body: null,
      statusCode: 0,
      attempts: 0,
    };
  }
  if (vault !== 1 && vault !== 2) {
    return {
      status: "client_error",
      reason: `invalid vault ${vault}`,
      body: null,
      statusCode: 0,
      attempts: 0,
    };
  }

  const body = {
    polymarket_url: polymarketUrl,
    cms_fixture_id: cmsFixtureId || "",
    vault,
    dry_run: Boolean(config.dryRun),
  };

  const maxAttempts = 1 + Math.max(0, Number(config.retryCount) || 0);
  let lastError = null;

  for (let attempt = 1; attempt <= maxAttempts; attempt++) {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), config.timeoutMs || 8_000);
    let response;
    try {
      response = await fetchImpl(config.endpoint, {
        method: "POST",
        headers: { "Content-Type": "application/json", Accept: "application/json" },
        body: JSON.stringify(body),
        signal: controller.signal,
      });
    } catch (err) {
      clearTimeout(timer);
      lastError = err;
      log?.warn?.(
        { attempt, maxAttempts, err: String(err?.message || err) },
        "vault sync attempt failed (network/abort)"
      );
      if (attempt < maxAttempts) {
        await sleepImpl(RETRY_BACKOFF_MS);
        continue;
      }
      throw err;
    }
    clearTimeout(timer);

    const text = await response.text();
    let parsed;
    try {
      parsed = text ? JSON.parse(text) : null;
    } catch {
      parsed = text;
    }

    if (response.ok) {
      return { status: "ok", body: parsed, statusCode: response.status, attempts: attempt };
    }

    if (response.status >= 400 && response.status < 500) {
      log?.warn?.(
        { statusCode: response.status, body: parsed },
        "vault sync rejected (client error, no retry)"
      );
      return {
        status: "client_error",
        body: parsed,
        statusCode: response.status,
        attempts: attempt,
      };
    }

    lastError = new Error(`HTTP ${response.status} from vault sync`);
    log?.warn?.(
      { attempt, maxAttempts, statusCode: response.status, body: parsed },
      "vault sync attempt failed (server error)"
    );
    if (attempt < maxAttempts) {
      await sleepImpl(RETRY_BACKOFF_MS);
      continue;
    }
    const err = new Error(`vault sync failed after ${attempt} attempt(s): HTTP ${response.status}`);
    err.statusCode = response.status;
    err.body = parsed;
    throw err;
  }

  // Defensive fallthrough — loop above always returns or throws.
  throw lastError || new Error("vault sync exited retry loop unexpectedly");
}
