export function createInitialDevBatchState() {
  return {
    step: "selection",            // "selection" | "config"
    fixtures: [],                 // loaded schedule fixtures
    isLoadingFixtures: false,
    selectedFixtureIds: [],       // string[]
    focusedFixtureId: "",
    selectedPublishKeys: [],      // market key strings
    perFixtureExclusions: {},     // { [fixtureId]: { excluded_fixture, excluded_publish_keys } }
    filters: {
      search: "",
      leagueFilter: "",
      unpublishedOnly: false,
      partialOnly: false,
      selectedOnly: false,
      sortAsc: true,
    },
    confirmation: {
      operator_name: "",
      fixture_count: "",
      confirmed: false,
    },
    expandedFixtureKeys: [],       // result row expand keys
    expandedExclusionIds: [],      // per-fixture exclusion expand state
    verification: null,
    isVerifying: false,
    isPublishing: false,
    currentRun: null,
    lastRun: null,
  };
}

export function resetDevBatchVerification(devBatch = createInitialDevBatchState()) {
  return {
    ...devBatch,
    verification: null,
  };
}

export function resetDevBatchRun(devBatch = createInitialDevBatchState()) {
  return {
    ...devBatch,
    currentRun: null,
    isPublishing: false,
  };
}

export function resetDevBatchStep(devBatch = createInitialDevBatchState(), step = "selection") {
  return {
    ...devBatch,
    step,
  };
}
