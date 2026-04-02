import { getLsportsCsvFixtureSourceAdapter, LSPORTS_CSV_FIXTURE_SOURCE_KEY } from "./lsportsCsv.js";
import { getSportsDataFixtureSourceAdapter, SPORTSDATA_FIXTURE_SOURCE_KEY } from "./sportsdata.js";

const FIXTURE_SOURCE_ADAPTERS = Object.freeze([
  getSportsDataFixtureSourceAdapter(),
  getLsportsCsvFixtureSourceAdapter(),
]);

const FIXTURE_SOURCE_ADAPTERS_BY_KEY = new Map(
  FIXTURE_SOURCE_ADAPTERS.map((adapter) => [String(adapter.key || "").trim().toLowerCase(), adapter])
);

export { LSPORTS_CSV_FIXTURE_SOURCE_KEY, SPORTSDATA_FIXTURE_SOURCE_KEY };

export function getBackendFixtureSourceAdapters() {
  return FIXTURE_SOURCE_ADAPTERS.slice();
}

export function getBackendFixtureSourceAdapter(key) {
  const normalizedKey = String(key || "").trim().toLowerCase();
  return FIXTURE_SOURCE_ADAPTERS_BY_KEY.get(normalizedKey) || null;
}
