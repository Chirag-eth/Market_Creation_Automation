import test from "node:test";
import assert from "node:assert/strict";

import path from "node:path";

import { parsePositiveIntegerEnv, resolveClientIp, resolveDotEnvFiles, resolveRuntimeEnvironment } from "../server.js";

test("parsePositiveIntegerEnv falls back for invalid values and enforces min", () => {
  assert.equal(parsePositiveIntegerEnv("", 2020, { min: 1 }), 2020);
  assert.equal(parsePositiveIntegerEnv("abc", 2020, { min: 1 }), 2020);
  assert.equal(parsePositiveIntegerEnv("0", 2020, { min: 1 }), 2020);
  assert.equal(parsePositiveIntegerEnv("-9", 2020, { min: 1 }), 2020);
  assert.equal(parsePositiveIntegerEnv("60000", 1000, { min: 1000 }), 60000);
});

test("resolveClientIp uses remoteAddress by default and forwarded header only when trusted", () => {
  const req = {
    headers: { "x-forwarded-for": "203.0.113.9, 10.0.0.1" },
    socket: { remoteAddress: "127.0.0.1" },
  };

  assert.equal(resolveClientIp(req, { trustProxy: false }), "127.0.0.1");
  assert.equal(resolveClientIp(req, { trustProxy: true }), "203.0.113.9");
});

test("resolveDotEnvFiles prefers APP_ENV-specific files before the base .env", () => {
  const rootDir = "/tmp/fixture-app";

  assert.deepEqual(resolveDotEnvFiles(rootDir, { APP_ENV: "uat" }), [
    path.join(rootDir, ".env.uat"),
    path.join(rootDir, ".env"),
  ]);
});

test("resolveDotEnvFiles prefers an explicit ENV_FILE before the base .env", () => {
  const rootDir = "/tmp/fixture-app";

  assert.deepEqual(resolveDotEnvFiles(rootDir, { ENV_FILE: "config/.env.uat" }), [
    path.join(rootDir, "config", ".env.uat"),
    path.join(rootDir, ".env"),
  ]);
});

test("resolveRuntimeEnvironment exposes the active env choice for optional UI/debugging", () => {
  assert.deepEqual(resolveRuntimeEnvironment({ APP_ENV: "uat", ENV_FILE: "" }), {
    appEnv: "uat",
    appEnvLabel: "UAT",
    envFile: "",
  });

  assert.deepEqual(resolveRuntimeEnvironment({ APP_ENV: "", ENV_FILE: "/tmp/.env.uat" }), {
    appEnv: "mainnet",
    appEnvLabel: "Mainnet",
    envFile: "/tmp/.env.uat",
  });

  assert.deepEqual(resolveRuntimeEnvironment({ APP_ENV: "local", ENV_FILE: "" }), {
    appEnv: "mainnet",
    appEnvLabel: "Mainnet",
    envFile: "",
  });
});
