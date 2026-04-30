const POSTMAN_API_BASE = "https://api.getpostman.com";
const ACTIVE_MARKER_KEY = "_dashboard_active";

// Maps dashboard env codes to Postman environment UIDs (Team Workspace)
export const POSTMAN_ENV_UID_MAP = Object.freeze({
  dev: "47824388-9cd94fb6-001a-4cd7-8a6f-ca73a70434e1",
  uat: "48366749-d783f9a3-0097-42e8-acc4-9ce7c7b5642e",
  testnet: "47824388-ab1263ed-5a74-47e6-b52e-5ad7ba8c63eb",
  mainnet: "48366749-8207a146-101f-4ed5-9c6b-6739548b7c4c",
});

async function postmanFetch(apiKey, path, { method = "GET", body = null, timeoutMs = 8000 } = {}) {
  const url = `${POSTMAN_API_BASE}${path}`;
  const headers = { "x-api-key": apiKey, "Content-Type": "application/json" };
  const options = { method, headers, signal: AbortSignal.timeout(timeoutMs) };
  if (body !== null) options.body = JSON.stringify(body);
  const res = await fetch(url, options);
  if (!res.ok) {
    throw new Error(`Postman API ${method} ${path} → HTTP ${res.status}`);
  }
  return res.json();
}

async function getPostmanEnvDetails(apiKey, uid) {
  const data = await postmanFetch(apiKey, `/environments/${uid}`);
  return data?.environment || null;
}

async function putPostmanEnvValues(apiKey, uid, name, values) {
  await postmanFetch(apiKey, `/environments/${uid}`, {
    method: "PUT",
    body: { environment: { name, values } },
  });
}

// Returns the dashboard env code currently marked active in Postman, or null if none.
export async function getPostmanActiveEnvCode(apiKey) {
  if (!apiKey) return null;
  for (const [code, uid] of Object.entries(POSTMAN_ENV_UID_MAP)) {
    try {
      const env = await getPostmanEnvDetails(apiKey, uid);
      const marker = env?.values?.find((v) => v.key === ACTIVE_MARKER_KEY);
      if (marker?.value === "true") return code;
    } catch {
      // continue checking other envs
    }
  }
  return null;
}

// Writes _dashboard_active = "true" to the target env and removes the marker from all others.
export async function setPostmanActiveEnvCode(apiKey, dashboardCode) {
  if (!apiKey || !POSTMAN_ENV_UID_MAP[dashboardCode]) return;
  const errors = [];
  for (const [code, uid] of Object.entries(POSTMAN_ENV_UID_MAP)) {
    try {
      const env = await getPostmanEnvDetails(apiKey, uid);
      if (!env) continue;
      const values = Array.isArray(env.values)
        ? env.values.filter((v) => v.key !== ACTIVE_MARKER_KEY)
        : [];
      if (code === dashboardCode) {
        values.push({ key: ACTIVE_MARKER_KEY, value: "true", enabled: true, type: "default" });
      }
      await putPostmanEnvValues(apiKey, uid, env.name, values);
    } catch (err) {
      errors.push(`${code}: ${String(err?.message || err)}`);
    }
  }
  if (errors.length) {
    throw new Error(`Postman sync partial failure — ${errors.join("; ")}`);
  }
}

// Returns a lightweight status list for all mapped environments.
// Uses the list endpoint (1 call) to get updatedAt, then fetches details only to read the marker.
export async function listPostmanMappedEnvs(apiKey) {
  if (!apiKey) return [];

  // Fetch all env summaries in one call for updatedAt timestamps
  let summaries = [];
  try {
    const data = await postmanFetch(apiKey, "/environments");
    summaries = Array.isArray(data?.environments) ? data.environments : [];
  } catch {
    // fall through — details will still be fetched individually
  }

  const summaryByUid = new Map(summaries.map((s) => [s.uid, s]));

  const results = [];
  for (const [code, uid] of Object.entries(POSTMAN_ENV_UID_MAP)) {
    try {
      const env = await getPostmanEnvDetails(apiKey, uid);
      const summary = summaryByUid.get(uid);
      const marker = env?.values?.find((v) => v.key === ACTIVE_MARKER_KEY);
      results.push({
        code,
        uid,
        name: env?.name || code,
        active: marker?.value === "true",
        updatedAt: summary?.updatedAt || env?.updatedAt || null,
      });
    } catch {
      results.push({ code, uid, name: code, active: false, updatedAt: null, error: true });
    }
  }
  return results;
}
