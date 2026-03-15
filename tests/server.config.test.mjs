import test from "node:test";
import assert from "node:assert/strict";

import { parsePositiveIntegerEnv, resolveClientIp } from "../server.js";

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
