const FIXTURE_SOURCE_REGISTRY = Object.freeze([
  {
    key: "live-schedules",
    label: "Live Schedules",
    shortLabel: "Live",
    description: "Browse deterministic upcoming fixtures from the live league schedule providers.",
    status: "active",
    capabilities: Object.freeze({
      browse: true,
      search: true,
      refetch: true,
      import: false,
    }),
  },
  {
    key: "imported-csv",
    label: "Imported CSV",
    shortLabel: "CSV",
    description: "Reserved for normalized Lsports DB-export fixture imports when the CSV column map is available.",
    status: "planned",
    capabilities: Object.freeze({
      browse: false,
      search: false,
      refetch: false,
      import: true,
    }),
  },
]);

const FIXTURE_SOURCE_BY_KEY = new Map(FIXTURE_SOURCE_REGISTRY.map((source) => [source.key, source]));

export function getFixtureSources() {
  return FIXTURE_SOURCE_REGISTRY.slice();
}

export function getFixtureSource(key) {
  const normalizedKey = String(key || "").trim().toLowerCase();
  return FIXTURE_SOURCE_BY_KEY.get(normalizedKey) || null;
}

export function getDefaultFixtureSourceKey() {
  return FIXTURE_SOURCE_REGISTRY[0]?.key || "live-schedules";
}

