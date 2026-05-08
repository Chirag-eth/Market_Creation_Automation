import test from "node:test";
import assert from "node:assert/strict";

import { syncFixture } from "../src/backend/vaultAutomationClient.js";

const baseConfig = {
  enabled: true,
  host: "https://vault.test",
  endpoint: "https://vault.test/api/v1/polymarket/sync-fixture",
  timeoutMs: 8_000,
  retryCount: 1,
  dryRun: false,
};

function mockResponse({ ok = true, status = 200, jsonBody = null, textBody = "" } = {}) {
  const body = jsonBody !== null ? JSON.stringify(jsonBody) : textBody;
  return {
    ok,
    status,
    text: async () => body,
  };
}

const NO_SLEEP = async () => {};

test("returns ok with parsed body on 200", async () => {
  let calls = 0;
  const fetchImpl = async () => {
    calls += 1;
    return mockResponse({ ok: true, status: 200, jsonBody: { sync_posted: 2 } });
  };
  const result = await syncFixture({
    config: baseConfig,
    polymarketUrl: "https://polymarket.com/market/abc",
    cmsFixtureId: "fix-1",
    vault: 1,
    fetchImpl,
    sleepImpl: NO_SLEEP,
  });
  assert.equal(calls, 1);
  assert.equal(result.status, "ok");
  assert.equal(result.statusCode, 200);
  assert.deepEqual(result.body, { sync_posted: 2 });
  assert.equal(result.attempts, 1);
});

test("retries once on 500 then returns ok on 200", async () => {
  let calls = 0;
  const fetchImpl = async () => {
    calls += 1;
    if (calls === 1) return mockResponse({ ok: false, status: 500, jsonBody: { error: "boom" } });
    return mockResponse({ ok: true, status: 200, jsonBody: { sync_posted: 1 } });
  };
  const result = await syncFixture({
    config: baseConfig,
    polymarketUrl: "https://polymarket.com/market/abc",
    cmsFixtureId: "fix-1",
    vault: 2,
    fetchImpl,
    sleepImpl: NO_SLEEP,
  });
  assert.equal(calls, 2);
  assert.equal(result.status, "ok");
  assert.equal(result.attempts, 2);
});

test("throws after retry exhaustion on persistent 5xx", async () => {
  let calls = 0;
  const fetchImpl = async () => {
    calls += 1;
    return mockResponse({ ok: false, status: 502, jsonBody: { error: "upstream" } });
  };
  await assert.rejects(
    () =>
      syncFixture({
        config: baseConfig,
        polymarketUrl: "https://polymarket.com/market/abc",
        cmsFixtureId: "fix-1",
        vault: 1,
        fetchImpl,
        sleepImpl: NO_SLEEP,
      }),
    (err) => {
      assert.match(err.message, /vault sync failed after 2 attempt/);
      assert.equal(err.statusCode, 502);
      return true;
    }
  );
  assert.equal(calls, 2); // 1 + 1 retry
});

test("does NOT retry on 400 (client error) and returns shaped result", async () => {
  let calls = 0;
  const fetchImpl = async () => {
    calls += 1;
    return mockResponse({
      ok: false,
      status: 400,
      jsonBody: { error: "missing_param", detail: "polymarket_url is required" },
    });
  };
  const result = await syncFixture({
    config: baseConfig,
    polymarketUrl: "https://polymarket.com/market/abc",
    cmsFixtureId: "fix-1",
    vault: 1,
    fetchImpl,
    sleepImpl: NO_SLEEP,
  });
  assert.equal(calls, 1);
  assert.equal(result.status, "client_error");
  assert.equal(result.statusCode, 400);
  assert.equal(result.body?.error, "missing_param");
});

test("retries on network error (e.g. AbortError) then succeeds", async () => {
  let calls = 0;
  const fetchImpl = async () => {
    calls += 1;
    if (calls === 1) {
      const err = new Error("aborted");
      err.name = "AbortError";
      throw err;
    }
    return mockResponse({ ok: true, status: 200, jsonBody: {} });
  };
  const result = await syncFixture({
    config: baseConfig,
    polymarketUrl: "https://polymarket.com/market/abc",
    cmsFixtureId: "fix-1",
    vault: 1,
    fetchImpl,
    sleepImpl: NO_SLEEP,
  });
  assert.equal(calls, 2);
  assert.equal(result.status, "ok");
});

test("throws after retry exhaustion on persistent network error", async () => {
  let calls = 0;
  const fetchImpl = async () => {
    calls += 1;
    throw new Error("ECONNREFUSED");
  };
  await assert.rejects(
    () =>
      syncFixture({
        config: baseConfig,
        polymarketUrl: "https://polymarket.com/market/abc",
        cmsFixtureId: "fix-1",
        vault: 1,
        fetchImpl,
        sleepImpl: NO_SLEEP,
      }),
    /ECONNREFUSED/
  );
  assert.equal(calls, 2);
});

test("returns disabled when config.enabled is false", async () => {
  let calls = 0;
  const fetchImpl = async () => {
    calls += 1;
    return mockResponse({ ok: true, status: 200, jsonBody: {} });
  };
  const result = await syncFixture({
    config: { ...baseConfig, enabled: false },
    polymarketUrl: "https://polymarket.com/market/abc",
    cmsFixtureId: "fix-1",
    vault: 1,
    fetchImpl,
    sleepImpl: NO_SLEEP,
  });
  assert.equal(calls, 0);
  assert.equal(result.status, "disabled");
});

test("returns skipped when polymarket_url is missing", async () => {
  let calls = 0;
  const fetchImpl = async () => {
    calls += 1;
    return mockResponse({ ok: true, status: 200, jsonBody: {} });
  };
  const result = await syncFixture({
    config: baseConfig,
    polymarketUrl: "",
    cmsFixtureId: "fix-1",
    vault: 1,
    fetchImpl,
    sleepImpl: NO_SLEEP,
  });
  assert.equal(calls, 0);
  assert.equal(result.status, "skipped");
  assert.match(result.reason, /polymarket_url/);
});

test("returns client_error when vault is invalid (not 1 or 2)", async () => {
  let calls = 0;
  const fetchImpl = async () => {
    calls += 1;
    return mockResponse({ ok: true, status: 200, jsonBody: {} });
  };
  const result = await syncFixture({
    config: baseConfig,
    polymarketUrl: "https://polymarket.com/market/abc",
    cmsFixtureId: "fix-1",
    vault: 3,
    fetchImpl,
    sleepImpl: NO_SLEEP,
  });
  assert.equal(calls, 0);
  assert.equal(result.status, "client_error");
});

test("retry count of 0 means single attempt only", async () => {
  let calls = 0;
  const fetchImpl = async () => {
    calls += 1;
    return mockResponse({ ok: false, status: 503, jsonBody: { error: "down" } });
  };
  await assert.rejects(() =>
    syncFixture({
      config: { ...baseConfig, retryCount: 0 },
      polymarketUrl: "https://polymarket.com/market/abc",
      cmsFixtureId: "fix-1",
      vault: 1,
      fetchImpl,
      sleepImpl: NO_SLEEP,
    })
  );
  assert.equal(calls, 1);
});

test("POST body shape is correct (polymarket_url, cms_fixture_id, vault, dry_run)", async () => {
  const captured = [];
  const fetchImpl = async (url, init) => {
    captured.push({ url, init });
    return mockResponse({ ok: true, status: 200, jsonBody: {} });
  };
  await syncFixture({
    config: { ...baseConfig, dryRun: true },
    polymarketUrl: "https://polymarket.com/market/abc",
    cmsFixtureId: "fix-xyz",
    vault: 2,
    fetchImpl,
    sleepImpl: NO_SLEEP,
  });
  assert.equal(captured.length, 1);
  assert.equal(captured[0].url, baseConfig.endpoint);
  assert.equal(captured[0].init.method, "POST");
  const body = JSON.parse(captured[0].init.body);
  assert.deepEqual(body, {
    polymarket_url: "https://polymarket.com/market/abc",
    cms_fixture_id: "fix-xyz",
    vault: 2,
    dry_run: true,
  });
});
