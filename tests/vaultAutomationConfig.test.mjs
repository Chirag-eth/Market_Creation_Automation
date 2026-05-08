import test from "node:test";
import assert from "node:assert/strict";

import {
  createVaultAutomationConfig,
  VAULT_AUTOMATION_ALLOWED_ENVS,
} from "../src/backend/vaultAutomationConfig.js";

const SAMPLE_HOST = "http://127.0.0.1:8080";

test("allowlist is dev + uat (mainnet must stay off until opt-in)", () => {
  assert.deepEqual([...VAULT_AUTOMATION_ALLOWED_ENVS], ["dev", "uat"]);
});

test("dev env + host → enabled", () => {
  const cfg = createVaultAutomationConfig({
    APP_ENV: "dev",
    VAULT_AUTOMATION_HOST: SAMPLE_HOST,
  });
  assert.equal(cfg.enabled, true);
  assert.equal(cfg.appEnv, "dev");
  assert.equal(cfg.envAllowed, true);
  assert.equal(cfg.host, SAMPLE_HOST);
  assert.equal(cfg.endpoint, `${SAMPLE_HOST}/api/v1/polymarket/sync-fixture`);
});

test("uat env + host → enabled", () => {
  const cfg = createVaultAutomationConfig({
    APP_ENV: "uat",
    VAULT_AUTOMATION_HOST: SAMPLE_HOST,
  });
  assert.equal(cfg.enabled, true);
});

test("mainnet env + host → DISABLED with reason naming the env gate", () => {
  const cfg = createVaultAutomationConfig({
    APP_ENV: "mainnet",
    VAULT_AUTOMATION_HOST: SAMPLE_HOST,
  });
  assert.equal(cfg.enabled, false);
  assert.equal(cfg.envAllowed, false);
  assert.match(cfg.disabledReason, /APP_ENV="mainnet"/);
  assert.match(cfg.disabledReason, /allowlist/);
});

test("testnet env + host → DISABLED (not in allowlist)", () => {
  const cfg = createVaultAutomationConfig({
    APP_ENV: "testnet",
    VAULT_AUTOMATION_HOST: SAMPLE_HOST,
  });
  assert.equal(cfg.enabled, false);
});

test("unknown env + host → DISABLED with reason naming '(unset)' fallback", () => {
  const cfg = createVaultAutomationConfig({
    APP_ENV: "",
    VAULT_AUTOMATION_HOST: SAMPLE_HOST,
  });
  assert.equal(cfg.enabled, false);
  assert.match(cfg.disabledReason, /\(unset\)/);
});

test("dev env, no host → DISABLED with reason naming the missing host", () => {
  const cfg = createVaultAutomationConfig({
    APP_ENV: "dev",
    VAULT_AUTOMATION_HOST: "",
  });
  assert.equal(cfg.enabled, false);
  assert.equal(cfg.envAllowed, true);
  assert.match(cfg.disabledReason, /VAULT_AUTOMATION_HOST not set/);
});

test("normalizes bare host without protocol to http://", () => {
  const cfg = createVaultAutomationConfig({
    APP_ENV: "dev",
    VAULT_AUTOMATION_HOST: "vault.internal:8080",
  });
  assert.equal(cfg.host, "http://vault.internal:8080");
  assert.equal(cfg.endpoint, "http://vault.internal:8080/api/v1/polymarket/sync-fixture");
});

test("strips trailing slash from host", () => {
  const cfg = createVaultAutomationConfig({
    APP_ENV: "dev",
    VAULT_AUTOMATION_HOST: "https://vault.test/",
  });
  assert.equal(cfg.host, "https://vault.test");
});

test("parses timeout, retry, and dryRun from env vars", () => {
  const cfg = createVaultAutomationConfig({
    APP_ENV: "uat",
    VAULT_AUTOMATION_HOST: SAMPLE_HOST,
    VAULT_AUTOMATION_TIMEOUT_MS: "12000",
    VAULT_AUTOMATION_RETRY_COUNT: "3",
    VAULT_AUTOMATION_DRY_RUN: "true",
  });
  assert.equal(cfg.timeoutMs, 12_000);
  assert.equal(cfg.retryCount, 3);
  assert.equal(cfg.dryRun, true);
});

test("falls back to defaults on bad numeric values", () => {
  const cfg = createVaultAutomationConfig({
    APP_ENV: "uat",
    VAULT_AUTOMATION_HOST: SAMPLE_HOST,
    VAULT_AUTOMATION_TIMEOUT_MS: "not-a-number",
    VAULT_AUTOMATION_RETRY_COUNT: "-1",
  });
  assert.equal(cfg.timeoutMs, 8_000);
  assert.equal(cfg.retryCount, 1);
});

test("APP_ENV is case-insensitive", () => {
  const cfg = createVaultAutomationConfig({
    APP_ENV: "DEV",
    VAULT_AUTOMATION_HOST: SAMPLE_HOST,
  });
  assert.equal(cfg.enabled, true);
  assert.equal(cfg.appEnv, "dev");
});
