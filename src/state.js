import { FALLBACK_LEAGUES, FALLBACK_TEAMS } from "./fallbackCatalog.js";

export function createInitialState() {
  return {
    file: null,
    previewUrl: null,
    ocrRunning: false,
    fixtureJson: null,
    fixtureMeta: null,
    detectedFixtures: [],
    activeDetectedFixtureIndex: null,
    bulkParentPayloads: [],
    catalogLoaded: false,
    catalogSourceLabel: "Fallback (hardcoded)",
    showNeedsReviewOnly: false,
    strictPublishMode: false,
    fixtureSelectionQuery: "",
    preferredLeagueSelectValue: null,
    autosaveFailed: false,
    leagues: [...FALLBACK_LEAGUES],
    teams: [...FALLBACK_TEAMS],
    teamAliasIndex: [],
    lastOcrError: null,
    lastOcrArtifacts: null,
    formInputIssues: [],
  };
}
