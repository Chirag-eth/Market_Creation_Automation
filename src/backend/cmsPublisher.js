function stripTrailingSlash(value) {
  return String(value || "").trim().replace(/\/+$/, "");
}

function normalizeBaseUrl(rawValue) {
  const trimmed = String(rawValue || "").trim();
  if (!trimmed) {
    return "";
  }
  if (/^https?:\/\//i.test(trimmed)) {
    return stripTrailingSlash(trimmed);
  }
  return stripTrailingSlash(`http://${trimmed}`);
}

export function createCmsRuntimeConfig(runtimeEnv = {}) {
  const baseUrl = normalizeBaseUrl(
    runtimeEnv?.COMP_SERVICE_INTERNAL_HOST ||
      runtimeEnv?.CMS_INTERNAL_BASE_URL ||
      runtimeEnv?.CMS_BASE_URL
  );
  const bearerToken = String(
    runtimeEnv?.COMP_SERVICE_INTERNAL_BEARER_TOKEN ||
      runtimeEnv?.CMS_INTERNAL_BEARER_TOKEN ||
      runtimeEnv?.CMS_BEARER_TOKEN ||
      ""
  ).trim();
  const timeoutMs = parsePositiveInteger(
    runtimeEnv?.CMS_PUBLISH_TIMEOUT_MS,
    parsePositiveInteger(runtimeEnv?.SCHEDULE_FETCH_TIMEOUT_MS, 8_000)
  );

  return {
    enabled: Boolean(baseUrl),
    baseUrl,
    bearerToken,
    timeoutMs,
    endpoints: {
      fixture: baseUrl ? `${baseUrl}/api/v1/cms/internal/fixtures/` : "",
      typeReference: baseUrl ? `${baseUrl}/api/v1/cms/internal/type-reference` : "",
      parentMarket: baseUrl ? `${baseUrl}/api/v1/cms/internal/parent-and-market/` : "",
    },
  };
}

function parsePositiveInteger(value, fallback) {
  const parsed = Number.parseInt(String(value ?? "").trim(), 10);
  return Number.isInteger(parsed) && parsed > 0 ? parsed : fallback;
}

export function resolveCmsPublishBundle(payload = {}) {
  const fixturePayload =
    payload?.fixture_payload ||
    payload?.fixturePayload ||
    payload?.fixture_json ||
    payload?.fixtureJson ||
    null;

  const typeReferencePayload =
    payload?.type_reference_payload ||
    payload?.typeReferencePayload ||
    payload?.type_reference_payloads?.fixture ||
    payload?.typeReferencePayloads?.fixture ||
    payload?.type_reference_payloads?.generic ||
    payload?.typeReferencePayloads?.generic ||
    null;

  const requestedFamily = String(
    payload?.parent_market_family || payload?.parentMarketFamily || ""
  )
    .trim()
    .toLowerCase();

  const parentPayloadFromFamily =
    (requestedFamily &&
      (payload?.uat_parent_payloads?.[requestedFamily] ||
        payload?.uatParentPayloads?.[requestedFamily])) ||
    null;

  const parentMarketPayload =
    payload?.parent_market_payload ||
    payload?.parentMarketPayload ||
    parentPayloadFromFamily ||
    null;

  return {
    fixturePayload,
    typeReferencePayload,
    parentMarketPayload,
    requestedFamily,
  };
}

async function parseHttpResponseBody(response) {
  const text = await response.text();
  if (!text) {
    return null;
  }
  try {
    return JSON.parse(text);
  } catch {
    return text;
  }
}

export async function publishCmsBundle(
  {
    config,
    fixturePayload,
    typeReferencePayload,
    parentMarketPayload,
    fetchImpl = globalThis.fetch,
  } = {}
) {
  if (!config?.enabled || !config?.baseUrl) {
    throw new Error("CMS publishing is not configured for the active environment.");
  }
  if (typeof fetchImpl !== "function") {
    throw new Error("Fetch implementation is not available.");
  }

  const missing = [];
  if (!fixturePayload || typeof fixturePayload !== "object") {
    missing.push("fixture_payload");
  }
  if (!typeReferencePayload || typeof typeReferencePayload !== "object") {
    missing.push("type_reference_payload");
  }
  if (!parentMarketPayload || typeof parentMarketPayload !== "object") {
    missing.push("parent_market_payload");
  }
  if (missing.length > 0) {
    throw new Error(`Missing CMS publish payload(s): ${missing.join(", ")}.`);
  }

  const headers = {
    "Content-Type": "application/json; charset=utf-8",
    Accept: "application/json, text/plain;q=0.9, */*;q=0.8",
  };
  if (config.bearerToken) {
    headers.Authorization = `Bearer ${config.bearerToken}`;
  }

  const steps = [
    { key: "fixture", url: config.endpoints.fixture, payload: fixturePayload },
    { key: "type_reference", url: config.endpoints.typeReference, payload: typeReferencePayload },
    { key: "parent_market", url: config.endpoints.parentMarket, payload: parentMarketPayload },
  ];

  const results = [];

  for (const step of steps) {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), config.timeoutMs);
    try {
      const response = await fetchImpl(step.url, {
        method: "POST",
        headers,
        body: JSON.stringify(step.payload),
        signal: controller.signal,
      });
      const body = await parseHttpResponseBody(response);
      const stepResult = {
        key: step.key,
        ok: response.ok,
        status: response.status,
        url: step.url,
        response: body,
      };
      results.push(stepResult);
      if (!response.ok) {
        return {
          ok: false,
          failedStep: step.key,
          steps: results,
        };
      }
    } catch (error) {
      results.push({
        key: step.key,
        ok: false,
        status: 0,
        url: step.url,
        response: { error: String(error?.message || error) },
      });
      return {
        ok: false,
        failedStep: step.key,
        steps: results,
      };
    } finally {
      clearTimeout(timeout);
    }
  }

  return {
    ok: true,
    failedStep: null,
    steps: results,
  };
}
