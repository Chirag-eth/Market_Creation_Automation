import { spawn } from "child_process";
import path from "path";
import { fileURLToPath } from "url";

const ROOT = path.resolve(fileURLToPath(import.meta.url), "../..");

const ENVS = [
  { code: "mainnet", label: "MAINNET", color: "\x1b[32m" },  // green
  { code: "uat",     label: "UAT    ", color: "\x1b[33m" },  // yellow
  { code: "dev",     label: "DEV    ", color: "\x1b[36m" },  // cyan
];

const RESET = "\x1b[0m";

const children = [];

for (const env of ENVS) {
  const child = spawn("node", ["server.js"], {
    cwd: ROOT,
    env: { ...process.env, APP_ENV: env.code },
  });

  children.push(child);

  const prefix = `${env.color}[${env.label}]${RESET} `;

  child.stdout.on("data", (d) =>
    process.stdout.write(d.toString().replace(/^/gm, prefix))
  );
  child.stderr.on("data", (d) =>
    process.stderr.write(d.toString().replace(/^/gm, prefix))
  );
  child.on("exit", (code) =>
    console.log(`${prefix}exited with code ${code}`)
  );
}

function shutdown() {
  for (const child of children) child.kill("SIGTERM");
  process.exit(0);
}

process.on("SIGINT",  shutdown);
process.on("SIGTERM", shutdown);
