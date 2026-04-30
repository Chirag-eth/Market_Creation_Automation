const REDACT_KEYS = new Set([
  "password", "secret", "token", "bearer", "api_key", "apikey",
  "authorization", "private_key", "privatekey", "access_key", "accesskey",
]);

export class InvalidIntegrationPayloadError extends Error {
  constructor(message, { issues = [] } = {}) {
    super(message);
    this.name = "InvalidIntegrationPayloadError";
    this.issues = Array.isArray(issues) ? issues : [];
  }
}

export function redactSecrets(value, depth = 0) {
  if (!value || typeof value !== "object" || depth > 10) return value;
  if (Array.isArray(value)) return value.map(v => redactSecrets(v, depth + 1));
  const out = {};
  for (const [k, v] of Object.entries(value)) {
    out[k] = REDACT_KEYS.has(k.toLowerCase()) ? "[REDACTED]" : redactSecrets(v, depth + 1);
  }
  return out;
}
