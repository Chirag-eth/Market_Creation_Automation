#!/usr/bin/env node
// Fails if any tracked .env.* file (excluding .env.*.local) has a non-empty
// value for a secret-named key. Prevents accidental commits of live secrets
// in shared/template env files. Invoked by lint-staged on .env.* changes.

import { readFileSync } from "node:fs";
import { basename } from "node:path";

const SECRET_PATTERNS = [
  /PASSWORD/i,
  /SECRET/i,
  /TOKEN/i,
  /API[_-]?KEY/i,
  /BEARER/i,
  /PRIVATE[_-]?KEY/i,
  /ACCESS[_-]?KEY/i,
  /CREDENTIAL/i,
];

function isSecretKey(key) {
  return SECRET_PATTERNS.some((re) => re.test(key));
}

function isExempt(file) {
  const name = basename(file);
  // .local overrides may hold real secrets (gitignored).
  // .env.example is a template — placeholder values are expected.
  return /\.local$/.test(name) || name === ".env.example";
}

const files = process.argv.slice(2);
const violations = [];

for (const file of files) {
  if (isExempt(file)) continue;
  let contents;
  try {
    contents = readFileSync(file, "utf8");
  } catch {
    continue;
  }
  const lines = contents.split(/\r?\n/);
  lines.forEach((line, idx) => {
    if (!line || line.startsWith("#")) return;
    const eq = line.indexOf("=");
    if (eq < 0) return;
    const key = line.slice(0, eq).trim();
    const value = line.slice(eq + 1).trim();
    if (!key || !value) return;
    if (isSecretKey(key)) {
      violations.push({ file, line: idx + 1, key });
    }
  });
}

if (violations.length > 0) {
  console.error("Refusing to commit: tracked env file(s) contain non-empty secret values.");
  console.error(
    "Move the value to the matching .env.<profile>.local file (gitignored) and leave the tracked entry blank.\n"
  );
  for (const v of violations) {
    console.error(`  ${v.file}:${v.line}  ${v.key}=<redacted>`);
  }
  process.exit(1);
}
