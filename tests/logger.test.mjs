import test from "node:test";
import assert from "node:assert/strict";

import { clearDebugLogs, createLogger, formatDebugLogs, getDebugLogs } from "../src/logger.js";

test("logger captures entries and formats output", () => {
  clearDebugLogs();
  const log = createLogger("test");
  log.info("hello", { a: 1 });
  log.warn("warn_case");
  const entries = getDebugLogs();
  assert.equal(entries.length, 2);
  assert.equal(entries[0].scope, "test");
  assert.equal(entries[0].event, "hello");

  const formatted = formatDebugLogs(entries);
  assert.ok(formatted.includes("[test] hello"));
  assert.ok(formatted.includes("[warn]"));
});
