const MARKET_SCHEMAS = Object.freeze([
  {
    key: "full-time-1x2",
    label: "Full Time Result",
    shortLabel: "1X2",
    category: "Parent Market",
    status: "active",
    description: "Three-outcome full-time result market with Home / Draw / Away settlement and the current parent market JSON shape.",
    outputs: ["Fixture JSON", "Parent Market JSON"],
    requiredFields: ["Event name", "League", "Fixture date (UTC)", "Kickoff time (UTC)", "Match day"],
    optionalFields: ["Type reference ID", "Match week", "Location", "Venue"],
    settlementScope: "90 minutes plus stoppage time",
  },
  {
    key: "btts",
    label: "Both Teams To Score",
    shortLabel: "BTTS",
    category: "Sub Market",
    status: "planned",
    description: "Binary both-teams-to-score market schema slot for future expansion.",
    outputs: ["Sub Market JSON"],
    requiredFields: ["Fixture context", "Market side tokens"],
    optionalFields: ["Type reference ID", "Market metadata overrides"],
    settlementScope: "Planned",
  },
  {
    key: "totals",
    label: "Totals",
    shortLabel: "O/U",
    category: "Sub Market",
    status: "planned",
    description: "Over/Under market schema slot for future line-based markets.",
    outputs: ["Sub Market JSON"],
    requiredFields: ["Fixture context", "Line", "Over/Under tokens"],
    optionalFields: ["Type reference ID", "Market metadata overrides"],
    settlementScope: "Planned",
  },
  {
    key: "double-chance",
    label: "Double Chance",
    shortLabel: "DC",
    category: "Sub Market",
    status: "planned",
    description: "Double chance market schema slot for future paired-outcome markets.",
    outputs: ["Sub Market JSON"],
    requiredFields: ["Fixture context", "Outcome pairing"],
    optionalFields: ["Type reference ID", "Market metadata overrides"],
    settlementScope: "Planned",
  },
]);

const MARKET_SCHEMA_BY_KEY = new Map(MARKET_SCHEMAS.map((schema) => [schema.key, schema]));

export function getMarketSchemas() {
  return MARKET_SCHEMAS.slice();
}

export function getActiveMarketSchemas() {
  return MARKET_SCHEMAS.filter((schema) => schema.status === "active");
}

export function getMarketSchema(key) {
  return MARKET_SCHEMA_BY_KEY.get(String(key || "").trim()) || null;
}

export function getDefaultMarketSchemaKey() {
  return getActiveMarketSchemas()[0]?.key || "full-time-1x2";
}
