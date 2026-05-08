function stripTrailingSlash(value) {
  return String(value || "")
    .trim()
    .replace(/\/+$/, "");
}

function normalizeBaseUrl(rawValue) {
  const trimmed = String(rawValue || "").trim();
  if (!trimmed) return "";
  if (/^https?:\/\//i.test(trimmed)) return stripTrailingSlash(trimmed);
  return stripTrailingSlash(`http://${trimmed}`);
}

function parsePositiveInteger(value, fallback) {
  const parsed = Number.parseInt(String(value ?? "").trim(), 10);
  return Number.isInteger(parsed) && parsed > 0 ? parsed : fallback;
}

function parseNonNegativeInteger(value, fallback) {
  const parsed = Number.parseInt(String(value ?? "").trim(), 10);
  return Number.isInteger(parsed) && parsed >= 0 ? parsed : fallback;
}

function parseBooleanFlag(value, fallback = false) {
  const trimmed = String(value ?? "")
    .trim()
    .toLowerCase();
  if (trimmed === "1" || trimmed === "true" || trimmed === "yes") return true;
  if (trimmed === "0" || trimmed === "false" || trimmed === "no") return false;
  return fallback;
}

// Hard gate: vault sync ships to dev and uat first. Mainnet stays off
// regardless of env-var config until the operator opts it in explicitly.
// To enable a new environment, add it here in a separate change.
export const VAULT_AUTOMATION_ALLOWED_ENVS = Object.freeze(["dev", "uat"]);

export function createVaultAutomationConfig(runtimeEnv = {}) {
  const appEnv = String(runtimeEnv?.APP_ENV || "")
    .trim()
    .toLowerCase();
  const envAllowed = VAULT_AUTOMATION_ALLOWED_ENVS.includes(appEnv);
  const host = normalizeBaseUrl(runtimeEnv?.VAULT_AUTOMATION_HOST);
  const timeoutMs = parsePositiveInteger(runtimeEnv?.VAULT_AUTOMATION_TIMEOUT_MS, 8_000);
  const retryCount = parseNonNegativeInteger(runtimeEnv?.VAULT_AUTOMATION_RETRY_COUNT, 1);
  const dryRun = parseBooleanFlag(runtimeEnv?.VAULT_AUTOMATION_DRY_RUN, false);
  const disabledReason = !envAllowed
    ? `APP_ENV="${appEnv || "(unset)"}" not in allowlist [${VAULT_AUTOMATION_ALLOWED_ENVS.join(", ")}]`
    : !host
      ? "VAULT_AUTOMATION_HOST not set"
      : "";
  return {
    enabled: envAllowed && Boolean(host),
    appEnv,
    envAllowed,
    host,
    timeoutMs,
    retryCount,
    dryRun,
    endpoint: host ? `${host}/api/v1/polymarket/sync-fixture` : "",
    disabledReason,
  };
}
