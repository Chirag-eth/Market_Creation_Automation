import { fetchApiJson } from "../shared/apiClient.js";

const RUNTIME_ENVIRONMENT_API_ENDPOINT = "/api/runtime/environment";

export async function fetchRuntimeEnvironmentPayload() {
  return fetchApiJson(RUNTIME_ENVIRONMENT_API_ENDPOINT, {
    cache: "no-store",
  });
}

export async function updateRuntimeEnvironment(appEnv) {
  return fetchApiJson(RUNTIME_ENVIRONMENT_API_ENDPOINT, {
    method: "POST",
    cache: "no-store",
    headers: {
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      app_env: String(appEnv || "").trim().toLowerCase(),
    }),
  });
}
