import { spawn } from "node:child_process";

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

export function getBasicAuthHeader(user, pass) {
  const token = Buffer.from(`${user}:${pass}`, "utf8").toString("base64");
  return `Basic ${token}`;
}

export async function startServerForTest({
  cwd,
  port,
  env = {},
  readinessPath = "/",
  readinessHeaders = {},
  timeoutMs = 8_000,
} = {}) {
  const resolvedPort = Number(port || 0) || 0;
  if (!resolvedPort) {
    throw new Error("startServerForTest requires a non-zero port.");
  }

  const child = spawn(process.execPath, ["server.js"], {
    cwd,
    env: {
      ...process.env,
      PORT: String(resolvedPort),
      APP_ENV: "mainnet",
      ENV_FILE: "",
      EXTRA_LEAGUES_CSV_PATHS: "",
      EXTRA_TEAMS_CSV_PATHS: "",
      // Background workers off by default — tests that need the cms scheduler
      // can opt in by passing SCHEDULER_ENABLED: "1" in their env override.
      SCHEDULER_ENABLED: "0",
      ...env,
    },
    stdio: ["ignore", "pipe", "pipe"],
  });

  let stdout = "";
  let stderr = "";

  child.stdout?.setEncoding("utf8");
  child.stderr?.setEncoding("utf8");
  child.stdout?.on("data", (chunk) => {
    stdout += String(chunk || "");
  });
  child.stderr?.on("data", (chunk) => {
    stderr += String(chunk || "");
  });

  const baseUrl = `http://127.0.0.1:${resolvedPort}`;
  const readyAt = Date.now() + timeoutMs;

  while (Date.now() < readyAt) {
    if (child.exitCode !== null) {
      const combined = `${stdout}\n${stderr}`;
      if (/EPERM|EACCES|permission denied/i.test(combined)) {
        return {
          skipReason: "Port binding is blocked in this environment.",
          stdout,
          stderr,
          stop: async () => {},
        };
      }
      throw new Error(
        `Server exited early (code ${child.exitCode}).\nSTDOUT:\n${stdout}\nSTDERR:\n${stderr}`
      );
    }

    try {
      const response = await fetch(`${baseUrl}${readinessPath}`, {
        headers: readinessHeaders,
      });
      if (response.status >= 200 && response.status < 500) {
        return {
          baseUrl,
          stdout,
          stderr,
          process: child,
          stop: () => stopServerProcess(child),
        };
      }
    } catch {
      // keep polling
    }

    await sleep(120);
  }

  await stopServerProcess(child);
  throw new Error(`Timed out waiting for server readiness at ${baseUrl}${readinessPath}.`);
}

export async function stopServerProcess(child) {
  if (!child || child.exitCode !== null) {
    return;
  }

  child.kill("SIGTERM");
  const deadline = Date.now() + 2_000;
  while (child.exitCode === null && Date.now() < deadline) {
    await sleep(40);
  }
  if (child.exitCode === null) {
    child.kill("SIGKILL");
    await sleep(80);
  }
}
