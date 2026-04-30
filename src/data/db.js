import { fetchApiJson } from "../shared/apiClient.js";

export async function fetchDbSchema(environment) {
  return fetchApiJson("/api/db/schema", {
    method: "POST",
    cache: "no-store",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ environment }),
  });
}

export async function verifyFixtureInDb(environment, { fixtureId, name } = {}) {
  return fetchApiJson("/api/db/verify/fixture", {
    method: "POST",
    cache: "no-store",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ environment, fixture_id: fixtureId, name }),
  });
}

export async function verifyTypeReferenceInDb(environment, { typeValueId } = {}) {
  return fetchApiJson("/api/db/verify/type-reference", {
    method: "POST",
    cache: "no-store",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ environment, type_value_id: typeValueId }),
  });
}

// Queries parent_markets joined with markets, linked via type_reference_id
export async function verifyParentMarketInDb(environment, { typeReferenceId } = {}) {
  return fetchApiJson("/api/db/verify/parent-market", {
    method: "POST",
    cache: "no-store",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ environment, type_reference_id: typeReferenceId }),
  });
}
