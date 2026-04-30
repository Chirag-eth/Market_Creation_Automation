export const MAX_SELECTION = 10;

export const PUBLISH_KEYS = new Set([
  "moneyline|0",
  "btts|0",
  "totals|1.5",
  "totals|2.5",
  "totals|3.5",
  "totals|4.5",
  "spreads|1.5|home",
  "spreads|1.5|away",
  "spreads|2.5|home",
  "spreads|2.5|away",
]);

export const MARKET_GROUPS = [
  {
    label: "Core",
    options: [
      { key: "moneyline|0", label: "Moneyline" },
      { key: "btts|0", label: "BTTS" },
    ],
  },
  {
    label: "Totals",
    options: [
      { key: "totals|1.5", label: "1.5" },
      { key: "totals|2.5", label: "2.5" },
      { key: "totals|3.5", label: "3.5" },
      { key: "totals|4.5", label: "4.5" },
    ],
  },
  {
    label: "Spreads",
    options: [
      { key: "spreads|1.5|home", label: "Home \u22121.5" },
      { key: "spreads|1.5|away", label: "Away \u22121.5" },
      { key: "spreads|2.5|home", label: "Home \u22122.5" },
      { key: "spreads|2.5|away", label: "Away \u22122.5" },
    ],
  },
];

// All flat options (derived from groups)
export const MARKET_OPTIONS = MARKET_GROUPS.flatMap((g) => g.options);

export const COPY = {
  emptyFixtures: "Load DEV fixtures to start selecting across leagues.",
  loadingFixtures: "Loading DEV fixtures...",
  noFixturesFiltered: "No fixtures match your filters.",
  emptyResults: "No batch run yet. Verify and publish to see results.",
  emptySelected: "No fixtures selected yet.",
  selectionLimit: "Max 10 fixtures \u2014 deselect one before adding another.",
  verifyFirst: "Run Verify Batch before publishing.",
  marketHint: "Applies to all selected fixtures by default",
  stoppingMessage: "Stopping after current market completes\u2026",
  stoppedMessage: "Stopped by operator.",
};

export const STEP_LABELS = {
  selection: "Select Fixtures",
  config: "Configure & Publish",
};
