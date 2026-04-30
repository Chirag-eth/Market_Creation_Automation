import { extractScheduleReadyLeagueCodes, fetchCatalogPayload, normalizeCatalogPayload } from "../data/catalog.js";
import { fetchRuntimeEnvironmentPayload, updateRuntimeEnvironment } from "../data/runtime.js";
import { fetchUpcomingFixturesForLeague } from "../data/schedules.js";
import { getActiveMarketSchemas, getDefaultMarketSchemaKey, getMarketSchema } from "../composer/marketSchemas.js";
import { getDefaultFixtureSourceKey, getFixtureSource, getFixtureSources } from "../shared/fixtureSourceRegistry.js";
import {
  clearApiBearerToken,
  isBearerAuthError,
  loadApiBearerToken,
  saveApiBearerToken,
} from "../shared/apiClient.js";
import { createLogger } from "../shared/logger.js";
import { loadSnapshot, loadThemePreference, saveSnapshot, saveThemePreference } from "./persistence.js";
import {
  generateFromEventInput,
  parseJsonInput,
  verifyBundleConsistency,
  verifyFixtureJsonStrict,
  verifyParentMarketJsonStrict,
} from "../core/verifier.js";
import {
  DEFAULT_UAT_MARKET_LINE,
  UAT_MARKET_LINE_OPTIONS,
  UAT_SPREAD_MARKET_LINE_OPTIONS,
} from "../core/uatFormats.js";
import {
  validateUatParentMarketFamilyPayload,
  validateUatTypeReferencePayloads,
} from "../core/validation.js";
import { escapeHtml, escapeHtmlAttribute, normalizeForSearch } from "../shared/util.js";
import { getLeagueScheduleDefinition, getLeagueScheduleDefinitions } from "../shared/leagueRegistry.js";
import { resolveAppliedMatchDayValue } from "../shared/scheduleFixtureSelection.js";
import { getAppWorkspace, getAppWorkspaces } from "../shared/workspaceRegistry.js";
import { resolveCatalogLeagueScheduleCode } from "../shared/scheduleLeagueBinding.js";

const uiLog = createLogger("ui");
let resultPanelRenderId = 0;
const SCHEDULE_SNAPSHOT_SCHEMA_VERSION = 5;
const DEFAULT_SCHEDULE_SEARCH_FILTERS = Object.freeze({
  team: true,
  date: true,
  kickoff: true,
  matchday: true,
});
const DEFAULT_RUNTIME_ENV_OPTIONS = Object.freeze([
  Object.freeze({ code: "mainnet", label: "Mainnet", available: true }),
  Object.freeze({ code: "uat", label: "UAT", available: true }),
]);
const DEFAULT_UAT_MARKET_FAMILY = "moneyline";
const DEFAULT_UAT_SPREAD_TEAM_SIDE = "home";
const UAT_MARKET_FAMILY_OPTIONS = Object.freeze([
  Object.freeze({
    key: "moneyline",
    label: "Moneyline",
    shortLabel: "1X2",
    description: "Three-way home / draw / away family payload for UAT.",
    outputLabel: "Moneyline Family JSON",
  }),
  Object.freeze({
    key: "spreads",
    label: "Spreads",
    shortLabel: "Handicap",
    description: "Single-sided team spread payload for UAT parent-market families.",
    outputLabel: "Spreads Family JSON",
  }),
  Object.freeze({
    key: "totals",
    label: "Totals",
    shortLabel: "Over/Under",
    description: "Line-based totals payload for UAT parent-market families.",
    outputLabel: "Totals Family JSON",
  }),
  Object.freeze({
    key: "btts",
    label: "Both Teams To Score",
    shortLabel: "BTTS",
    description: "Binary both-teams-to-score payload for UAT family output.",
    outputLabel: "BTTS Family JSON",
  }),
]);
const UPCOMING_MATCHWEEK_WINDOW = 6;

const state = {
  leagues: [],
  teams: [],
  catalogLoaded: false,
  catalogSourceLabel: "",
  apiAccessRequired: false,
  apiAccessMessage: "",
  autoVerifyTimerId: null,
  pendingAutoVerifyMode: null,
  pendingRestoredLeagueSelection: "",
  pendingRestoredScheduleLeagueOverrideCode: "",
  persistFixtureInput: true,
  persistParentInput: true,
  referenceNowIso: "",
  scheduleSnapshots: {},
  lastVerifyReportText: "",
  isCatalogLoading: false,
  isVerifying: false,
  isGenerating: false,
  isScheduleLoading: false,
  scheduleRequestId: 0,
  toastTimerId: null,
  scheduleReadyLeagueCodes: null,
  runtimeAppEnv: "",
  runtimeAppEnvLabel: "Mainnet",
  runtimeEnvOptions: [],
  isRuntimeEnvSwitching: false,
  scheduleLeagueOverrideCode: "",
  upcomingScheduleLeagueCode: "",
  upcomingScheduleWeek: null,
  upcomingScheduleWeeks: [],
  upcomingScheduleLabel: "",
  upcomingScheduleFixtures: [],
  selectedScheduleFixtureId: "",
  pendingRestoredSelectedScheduleFixtureId: "",
  scheduleCursorFixtureId: "",
  scheduleSearchFilters: createScheduleSearchFilters(),
  isScheduleFilterMenuOpen: false,
  currentGeneratePage: "builder",
  activeWorkspace: "composer",
  activeFixtureSource: getDefaultFixtureSourceKey(),
  selectedMarketSchemaKey: getDefaultMarketSchemaKey(),
  selectedUatMarketFamily: DEFAULT_UAT_MARKET_FAMILY,
  selectedUatMarketLine: DEFAULT_UAT_MARKET_LINE,
  selectedUatSpreadTeamSide: DEFAULT_UAT_SPREAD_TEAM_SIDE,
  builderScheduleWeek: null,
  builderSchedulePage: 1,
  fixturesPageScheduleWeek: null,
  lastGenerationResult: null,
  outputValidation: createInitialOutputValidationState(),
  theme: "light",
};

const els = {};
const SAMPLE_FIXTURE_JSON = {
  name: "Wolves vs Aston Villa",
  league_id: "de1bd252-baf5-4417-89ba-77d635f5f8f0",
  home_team_id: "072e6726-3524-4550-b2bc-dd0cabba6e2d",
  away_team_id: "11cccd75-3ccd-4b7c-8b85-a9e8f2216c3d",
  format: null,
  logo_url: "https://public-assets.pred.app/market-assets/fixture_128x128.png",
  theme_color: "#FFFFFF",
  match_day: 29,
  match_week: null,
  location: "",
  venue: "",
};
const SAMPLE_PARENT_JSON = {
  parent_market: {
    league_id: "de1bd252-baf5-4417-89ba-77d635f5f8f0",
    type_reference_id: "4b57bb5d-c292-4d3d-ab05-9f19e2b77aaf",
    title: "Wolves vs Aston Villa",
    description: "Wolves vs Aston Villa (2099-03-15). Settles on full-time: Wolves / Draw / Aston Villa.",
    market_code: "WOL_AVL_20990315",
    parent_market_canonical_name: "wol-avl-epl-2099-03-15",
    rules: "This market resolves based on the official result of Wolves vs Aston Villa after 90 minutes of regular play plus stoppage time. Exactly one outcome resolves to \"Long\" ($1) and the others resolve to \"Short\" ($0). If the match is postponed, the market remains open until the match has been completed. If the match is canceled entirely with no make-up game, Draw resolves to \"Long\" ($1) and both teams resolve to \"Short\" ($0).",
    markets_open_time: "2099-03-15T12:00:00Z",
    markets_close_time: "2099-03-15T14:00:00Z",
    payout_time: "2099-03-15T14:00:00Z",
    status: "active",
    is_cross_matching_enabled: true,
    order_delay_enabled: true,
    time_remaining: "2099-03-15T14:00:00Z",
  },
  markets: [
    {
      name: "Wolves",
      tick_size: "0.01",
      alternate_name: "Wolverhampton Wanderers",
      market_code: "WOL",
      market_canonical_name: "wol-avl-win-epl-2099-03-15",
      rules:
        "In the upcoming game, scheduled for March 15, 2099. If Wolves wins, this market will resolve to \"Long\" ($1 for Wolves). Otherwise, this market will resolve to \"Short\" ($0 for Wolves). If the game is postponed, this market will remain open until the game has been completed. If the game is canceled entirely, with no make-up game, this market will resolve to \"Short\" ($0 for Wolves).\n\nThis market refers only to the outcome within the first 90 minutes of regular play plus stoppage time.",
      theme_color: "#FDB913",
      team_id: "072e6726-3524-4550-b2bc-dd0cabba6e2d",
      logo_url: "https://example.com/wolves.png",
      time_remaining: "2099-03-15T14:00:00Z",
    },
    {
      name: "Draw",
      tick_size: "0.01",
      alternate_name: "Draw",
      market_code: "DRAW",
      market_canonical_name: "wol-avl-draw-epl-2099-03-15",
      rules:
        "In the upcoming game, scheduled for March 15, 2099. If the game ends in a draw, this market will resolve to \"Long\" ($1 for Draw). Otherwise, this market will resolve to \"Short\" ($0 for Draw). If the game is postponed, this market will remain open until the game has been completed. If the game is canceled entirely, with no make-up game, this market will resolve to \"Long\" ($1 for Draw).\n\nThis market refers only to the outcome within the first 90 minutes of regular play plus stoppage time.",
      theme_color: "#D5D5D6",
      team_id: null,
      logo_url: "https://public-assets.pred.app/market-assets/Draw_128x128.png",
      time_remaining: "2099-03-15T14:00:00Z",
    },
    {
      name: "Aston Villa",
      tick_size: "0.01",
      alternate_name: "Aston Villa FC",
      market_code: "AVL",
      market_canonical_name: "avl-wol-win-epl-2099-03-15",
      rules:
        "In the upcoming game, scheduled for March 15, 2099. If Aston Villa wins, this market will resolve to \"Long\" ($1 for Aston Villa). Otherwise, this market will resolve to \"Short\" ($0 for Aston Villa). If the game is postponed, this market will remain open until the game has been completed. If the game is canceled entirely, with no make-up game, this market will resolve to \"Short\" ($0 for Aston Villa).\n\nThis market refers only to the outcome within the first 90 minutes of regular play plus stoppage time.",
      theme_color: "#670E36",
      team_id: "11cccd75-3ccd-4b7c-8b85-a9e8f2216c3d",
      logo_url: "https://example.com/aston-villa.png",
      time_remaining: "2099-03-15T14:00:00Z",
    },
  ],
};

function createInitialOutputValidationState() {
  return {
    fixture: null,
    parent: null,
    uatFamily: null,
    typeReferences: null,
  };
}

function normalizeUatMarketFamilyKey(value) {
  const normalized = String(value || "").trim().toLowerCase();
  return UAT_MARKET_FAMILY_OPTIONS.some((option) => option.key === normalized)
    ? normalized
    : DEFAULT_UAT_MARKET_FAMILY;
}

function getUatMarketFamilyDefinition(value) {
  const key = normalizeUatMarketFamilyKey(value);
  return UAT_MARKET_FAMILY_OPTIONS.find((option) => option.key === key) || UAT_MARKET_FAMILY_OPTIONS[0];
}

function getAvailableUatMarketLineOptions(familyKey = state.selectedUatMarketFamily) {
  const family = normalizeUatMarketFamilyKey(familyKey);
  return family === "spreads" ? UAT_SPREAD_MARKET_LINE_OPTIONS : UAT_MARKET_LINE_OPTIONS;
}

function normalizeUatMarketLine(value, familyKey = state.selectedUatMarketFamily) {
  const normalized = String(value || "").trim();
  const options = getAvailableUatMarketLineOptions(familyKey);
  return options.some((option) => option.key === normalized)
    ? normalized
    : (options[0]?.key || DEFAULT_UAT_MARKET_LINE);
}

function supportsUatMarketLine(value) {
  const familyKey = normalizeUatMarketFamilyKey(value);
  return familyKey === "totals" || familyKey === "spreads";
}

function normalizeUatSpreadTeamSide(value) {
  return String(value || "").trim().toLowerCase() === "away" ? "away" : DEFAULT_UAT_SPREAD_TEAM_SIDE;
}

function getSelectedUatMarketLine(familyKey = state.selectedUatMarketFamily) {
  return normalizeUatMarketLine(state.selectedUatMarketLine, familyKey);
}

function getCurrentUatSpreadTeamOptions() {
  const selectedFixture = getCurrentSelectedScheduleFixture();
  const fallbackSides = splitScheduleEventName(els.generateEventNameInput?.value || "");
  const homeLabel = String(selectedFixture?.homeTeamName || fallbackSides.home || "Home team").trim() || "Home team";
  const awayLabel = String(selectedFixture?.awayTeamName || fallbackSides.away || "Away team").trim() || "Away team";
  return [
    { key: "home", label: homeLabel },
    { key: "away", label: awayLabel },
  ];
}

function getSelectedUatSpreadTeamSide() {
  return normalizeUatSpreadTeamSide(state.selectedUatSpreadTeamSide);
}

function getSelectedUatSpreadTeamLabel() {
  const selectedSide = getSelectedUatSpreadTeamSide();
  const selectedOption = getCurrentUatSpreadTeamOptions().find((option) => option.key === selectedSide);
  return selectedOption?.label || getCurrentUatSpreadTeamOptions()[0]?.label || "Home team";
}

function getUatFamilyOutputLabel(familyKey = state.selectedUatMarketFamily, marketLine = state.selectedUatMarketLine) {
  const family = getUatMarketFamilyDefinition(familyKey);
  if (family.key === "spreads") {
    return `${family.outputLabel} · ${getSelectedUatSpreadTeamLabel()} · ${normalizeUatMarketLine(marketLine, family.key)}`;
  }
  if (!supportsUatMarketLine(family.key)) {
    return family.outputLabel;
  }
  return `${family.outputLabel} · ${normalizeUatMarketLine(marketLine, family.key)}`;
}

function isSelectionSpecificUatFamilyOutputStale(generationResult = state.lastGenerationResult) {
  if (!generationResult || typeof generationResult !== "object") {
    return false;
  }

  const family = getUatMarketFamilyDefinition(state.selectedUatMarketFamily);
  if (!supportsUatMarketLine(family.key)) {
    return family.key === "spreads"
      ? normalizeUatSpreadTeamSide(generationResult.uatSpreadTeamSide) !== getSelectedUatSpreadTeamSide()
      : false;
  }

  if (normalizeUatMarketLine(generationResult.uatMarketLine, family.key) !== getSelectedUatMarketLine(family.key)) {
    return true;
  }

  if (family.key === "spreads") {
    return normalizeUatSpreadTeamSide(generationResult.uatSpreadTeamSide) !== getSelectedUatSpreadTeamSide();
  }

  return false;
}

function isUatRuntimeActive() {
  return normalizeRuntimeAppEnvCode(state.runtimeAppEnv || "mainnet") === "uat";
}

function resetUatComposerSelectionToDefaults() {
  state.selectedUatMarketFamily = DEFAULT_UAT_MARKET_FAMILY;
  state.selectedUatMarketLine = DEFAULT_UAT_MARKET_LINE;
  state.selectedUatSpreadTeamSide = DEFAULT_UAT_SPREAD_TEAM_SIDE;
  state.outputValidation.uatFamily = null;
}

export function initApp() {
  cacheElements();
  restoreThemePreference();
  applyTheme(state.theme);
  bindEvents();
  restoreInputSnapshot();
  ensureDeterministicRuntime();
  seedDefaults();
  setVerifyEditorOpen(false);
  setGeneratePage(state.currentGeneratePage);
  renderWorkspaceNav();
  renderFixtureSourceNav();
  populateMarketSchemaSelect();
  populateMarketFamilySelect();
  populateMarketLineSelect();
  populateSpreadTeamSelect();
  renderMarketSchemaPanel();
  renderGenerateWorkspaceLayout();

  setCatalogStatus("Loading CSV catalog...", "working");
  setOverviewCard("catalog", {
    value: "Loading",
    note: "Reading CSV source of truth",
    tone: "working",
  });
  setOverviewCard("verify", {
    value: "Idle",
    note: "Background checks wait for input",
    tone: "idle",
  });
  setOverviewCard("generate", {
    value: "Ready",
    note: "Event name to fixture + output payloads",
    tone: "idle",
  });
  renderVerifyOutput({
    summary: "No verification run yet.",
    tone: "neutral",
    sections: [],
    counts: null,
  });
  renderGenerationStatus({
    summary: "Waiting for input.",
    tone: "neutral",
    sections: [],
    counts: null,
  });
  renderJsonOutputs(null);
  clearScheduleSuggestions();
  syncFixtureSourceMode();
  renderDeterministicContext();
  renderGenerateReadiness();
  renderScheduleSearchControls();
  renderApiAccessPanel();
  renderRuntimeEnvironmentControl();
  updateJsonMeta("fixture");
  updateJsonMeta("parent");
  syncActionState();

  void hydrateRuntimeEnvironmentControl();
  void loadCatalog();
}

function cacheElements() {
  const ids = [
    "catalogStatus",
    "runtimeEnvSelect",
    "runtimeEnvBadge",
    "apiAccessPanel",
    "apiAccessNote",
    "apiAccessTokenInput",
    "saveApiAccessTokenBtn",
    "retryApiAccessBtn",
    "clearApiAccessTokenBtn",
    "apiAccessStatus",
    "reloadCatalogBtn",
    "workspaceNav",
    "fixtureSourceCard",
    "fixtureSourceNav",
    "fixtureSourceNote",
    "catalogOverviewCard",
    "catalogOverviewValue",
    "catalogOverviewNote",
    "verifyOverviewCard",
    "verifyOverviewValue",
    "verifyOverviewNote",
    "generateOverviewCard",
    "generateOverviewValue",
    "generateOverviewNote",
    "verifyToggleBtn",
    "verifyToggleCaption",
    "verifyBody",
    "verifyWorkspace",
    "verifyEditor",
    "fixtureInputJson",
    "parentInputJson",
    "verifyBothBtn",
    "verifyFixtureBtn",
    "verifyParentBtn",
    "copyVerifyReportBtn",
    "verifyOutput",
    "fixtureSampleBtn",
    "fixtureFormatBtn",
    "fixtureClearBtn",
    "fixtureJsonMeta",
    "parentSampleBtn",
    "parentFormatBtn",
    "parentClearBtn",
    "parentJsonMeta",
    "generateEventNameInput",
    "generateEventNameSuggestions",
    "generatePageTabs",
    "generateBuilderPageBtn",
    "generateFixturesPageBtn",
    "generateJsonPageBtn",
    "generateMarketSchemaCard",
    "generateMarketSchemaSelect",
    "generateMarketSchemaStatus",
    "generateMarketSchemaDescription",
    "generateMarketSchemaEnvironment",
    "generateMarketSchemaOutputs",
    "generateMarketSchemaRequired",
    "generateMarketSchemaOptional",
    "generateMarketFamilySelect",
    "generateMarketFamilyHelp",
    "generateMarketFamilyInactive",
    "generateMarketFamilyInactiveText",
    "generateMarketFamilyActivateBtn",
    "generateMarketLineField",
    "generateMarketLineSelect",
    "generateMarketLineHelp",
    "generateSpreadTeamField",
    "generateSpreadTeamSelect",
    "generateSpreadTeamHelp",
    "generateBuilderPage",
    "generateFixturesPage",
    "generateJsonPage",
    "generateWorkspace",
    "generateBuilderPreviewPanel",
    "generateSideColumn",
    "generateSideOutputsHost",
    "generateOutputsStack",
    "generateJsonOutputsHost",
    "generateBuilderWeekSelect",
    "generateBuilderRefetchBtn",
    "generateBuilderPreviewNote",
    "generateBuilderPreviewActions",
    "generateBuilderFixturePreview",
    "uatBuilderSchedulePanel",
    "uatBuilderScheduleState",
    "uatBuilderScheduleResults",
    "uatBuilderSchedulePrevBtn",
    "uatBuilderSchedulePageLabel",
    "uatBuilderScheduleNextBtn",
    "uatDbReadPanel",
    "uatDbReadSummary",
    "uatDbReadDetails",
    "generateFixturesLiveControls",
    "generateFixtureLeagueTabs",
    "generateFixtureWeekTabs",
    "generateFixtureSearchField",
    "generateFixtureSearchInput",
    "generateFixtureSearchFiltersBtn",
    "generateFixtureSearchFiltersMenu",
    "generateFixtureSearchFilterCount",
    "generateFixtureSearchFilterTeam",
    "generateFixtureSearchFilterDate",
    "generateFixtureSearchFilterKickoff",
    "generateFixtureSearchFilterMatchday",
    "generateFixtureActiveSummary",
    "generateFixtureActiveTitle",
    "generateFixtureActiveMeta",
    "generateFixtureActiveState",
    "generateFixtureSummary",
    "generateFixturesSourcePlaceholder",
    "generateFixtureResults",
    "generateScheduleStatus",
    "generateLeagueSelect",
    "generateTypeRefInput",
    "generateFixtureDateInput",
    "generateKickoffTimeInput",
    "generateMatchDayInput",
    "generateMatchWeekInput",
    "generateLocationInput",
    "generateVenueInput",
    "generateBtn",
    "refreshScheduleBtn",
    "copyGenerationStatusBtn",
    "generateStepLeagueCard",
    "generateStepLeagueValue",
    "generateStepLeagueNote",
    "generateStepFixtureCard",
    "generateStepFixtureValue",
    "generateStepFixtureNote",
    "generateStepTimingCard",
    "generateStepTimingValue",
    "generateStepTimingNote",
    "generateStepOutputCard",
    "generateStepOutputValue",
    "generateStepOutputNote",
    "deterministicReferenceNow",
    "deterministicReferenceNote",
    "deterministicScheduleState",
    "deterministicScheduleNote",
    "deterministicLeagueState",
    "deterministicLeagueNote",
    "generationStatus",
    "generatedFixturePanel",
    "generatedFixtureTitle",
    "generatedFixtureOutput",
    "generatedParentPanel",
    "generatedParentTitle",
    "generatedParentOutput",
    "generatedUatFamilyPanel",
    "generatedUatFamilyTitle",
    "generatedUatFamilyOutput",
    "generatedTypeReferencesPanel",
    "generatedTypeReferencesTitle",
    "generatedTypeReferencesOutput",
    "generatedFixtureState",
    "generatedParentState",
    "generatedUatFamilyState",
    "generatedTypeReferencesState",
    "generatedFixtureValidationState",
    "generatedParentValidationState",
    "generatedUatFamilyValidationState",
    "generatedTypeReferencesValidationState",
    "validateGeneratedFixtureBtn",
    "validateGeneratedParentBtn",
    "validateGeneratedUatFamilyBtn",
    "validateGeneratedTypeReferencesBtn",
    "copyGeneratedFixtureBtn",
    "copyGeneratedParentBtn",
    "copyGeneratedUatFamilyBtn",
    "copyGeneratedTypeReferencesBtn",
    "themeToggleBtn",
    "themeToggleIcon",
    "themeToggleLabel",
    "toastRegion",
  ];

  for (const id of ids) {
    els[id] = document.getElementById(id);
  }
}

function parseScheduleWeekValue(value) {
  const parsed = Number.parseInt(String(value ?? "").trim(), 10);
  return Number.isInteger(parsed) ? parsed : null;
}

function resolveUiScheduleLeagueCode(league) {
  return normalizeScheduleLeagueCode(
    resolveCatalogLeagueScheduleCode(league, { readyLeagueCodes: state.scheduleReadyLeagueCodes })
  );
}

function getSupportedScheduleLeagues() {
  return state.leagues
    .map((league) => ({
      ...league,
      scheduleCode: resolveUiScheduleLeagueCode(league),
    }))
    .filter((league) => Boolean(league.scheduleCode));
}

function getScheduleLeagueViewModels() {
  const supportedLeagues = getSupportedScheduleLeagues();
  const leagueByScheduleCode = new Map(
    supportedLeagues.map((league) => [String(league.scheduleCode || "").trim().toLowerCase(), league])
  );

  return getLeagueScheduleDefinitions().map((definition) => {
    const boundLeague = leagueByScheduleCode.get(definition.code) || null;
    return {
      ...definition,
      id: String(boundLeague?.id || ""),
      key: String(boundLeague?.key || definition.code),
      name: String(boundLeague?.name || definition.label),
      alternateName: String(boundLeague?.alternateName || ""),
      scheduleCode: definition.code,
      isConfiguredInCatalog: Boolean(boundLeague),
    };
  }).filter((league) => league.isConfiguredInCatalog && isScheduleLeaguePubliclyReady(league.scheduleCode));
}

function getScheduleLeagueDisplay(league, { isActive = false } = {}) {
  const code = String(league?.scheduleCode || "").trim().toLowerCase();
  const definition = getLeagueScheduleDefinition(code);
  if (definition) {
    const preferredIconUrl = String(definition.activeIconUrl || definition.inactiveIconUrl || "").trim();
    return {
      label: definition.label,
      icon: definition.icon,
      // Keep league artwork readable across themes instead of swapping to low-contrast inactive assets.
      iconUrl: preferredIconUrl,
    };
  }
  return {
    label: String(league?.key || league?.name || "").trim(),
    icon: "•",
    iconUrl: "",
  };
}

function getScheduleLeagueLabel(leagueCode) {
  const code = String(leagueCode || "").trim().toLowerCase();
  const definition = getLeagueScheduleDefinition(code);
  return String(definition?.label || code.toUpperCase()).trim();
}

function normalizeScheduleLeagueCode(value) {
  const code = String(value || "").trim().toLowerCase();
  return getLeagueScheduleDefinition(code) ? code : "";
}

function getSelectedLeagueControlValue() {
  return String(els.generateLeagueSelect?.value || "").trim();
}

function getSelectedCatalogLeague() {
  const selectedLeagueId = getSelectedLeagueControlValue();
  return state.leagues.find((league) => String(league.id || "") === selectedLeagueId) || null;
}

function getActiveScheduleLeagueCode() {
  const overrideCode = normalizeScheduleLeagueCode(state.scheduleLeagueOverrideCode);
  if (overrideCode && isScheduleLeaguePubliclyReady(overrideCode)) {
    return overrideCode;
  }
  const resolvedCode = (
    normalizeScheduleLeagueCode(getSelectedLeagueControlValue()) ||
    resolveUiScheduleLeagueCode(getSelectedCatalogLeague())
  );
  return isScheduleLeaguePubliclyReady(resolvedCode) ? resolvedCode : "";
}

function getScheduleWeekOptions(fixtures = state.upcomingScheduleFixtures) {
  const options = [];
  const seen = new Set();
  for (const fixture of fixtures || []) {
    const week = parseScheduleWeekValue(fixture?.matchDay);
    if (!Number.isInteger(week) || seen.has(week)) {
      continue;
    }
    seen.add(week);
    const count = (fixtures || []).filter((candidate) => parseScheduleWeekValue(candidate?.matchDay) === week).length;
    options.push({
      value: week,
      label: `Matchday ${week}`,
      count,
    });
  }
  return options.sort((a, b) => a.value - b.value).slice(0, UPCOMING_MATCHWEEK_WINDOW);
}

function resolveActiveScheduleWeek(weekValue, fixtures = state.upcomingScheduleFixtures) {
  const options = getScheduleWeekOptions(fixtures);
  if (Number.isInteger(weekValue) && options.some((option) => option.value === weekValue)) {
    return weekValue;
  }
  return options[0]?.value ?? null;
}

function getFixturesForScheduleWeek(weekValue, fixtures = state.upcomingScheduleFixtures) {
  const activeWeek = resolveActiveScheduleWeek(weekValue, fixtures);
  if (!Number.isInteger(activeWeek)) {
    return [];
  }
  return (fixtures || []).filter((fixture) => parseScheduleWeekValue(fixture?.matchDay) === activeWeek);
}

function renderCurrentUpcomingFixturesPage(fixtures = state.upcomingScheduleFixtures) {
  renderUpcomingFixturesPage(fixtures, {
    selectedWeek: state.fixturesPageScheduleWeek,
    selectedLabel: state.upcomingScheduleLabel,
    leagueCode: state.upcomingScheduleLeagueCode,
  });
}

function moveSingleSelectFocus(event, itemSelector, onActivate) {
  if (!(event.target instanceof Element)) {
    return;
  }

  const currentItem = event.target.closest(itemSelector);
  if (!currentItem) {
    return;
  }

  let step = 0;
  if (event.key === "ArrowRight" || event.key === "ArrowDown") {
    step = 1;
  } else if (event.key === "ArrowLeft" || event.key === "ArrowUp") {
    step = -1;
  }

  const container = currentItem.parentElement;
  if (!container) {
    return;
  }

  const items = Array.from(container.querySelectorAll(itemSelector)).filter((item) => !item.hasAttribute("disabled"));
  if (items.length === 0) {
    return;
  }

  let nextIndex = items.indexOf(currentItem);
  if (step !== 0) {
    nextIndex = (nextIndex + step + items.length) % items.length;
  } else if (event.key === "Home") {
    nextIndex = 0;
  } else if (event.key === "End") {
    nextIndex = items.length - 1;
  } else {
    return;
  }

  event.preventDefault();
  const nextItem = items[nextIndex];
  nextItem.focus();
  if (typeof onActivate === "function" && nextItem !== currentItem) {
    onActivate(nextItem);
  }
}

function setGeneratePage(page, { focusTarget = null } = {}) {
  const isUat = isUatRuntimeActive();
  const nextPage = page === "fixtures"
    ? "fixtures"
    : (isUat && page === "json" ? "json" : "builder");
  state.currentGeneratePage = nextPage;

  if (els.generateBuilderPage) {
    els.generateBuilderPage.hidden = nextPage !== "builder";
  }
  if (els.generateFixturesPage) {
    els.generateFixturesPage.hidden = nextPage !== "fixtures";
  }
  if (els.generateJsonPage) {
    els.generateJsonPage.hidden = nextPage !== "json";
  }

  if (els.generateBuilderPageBtn) {
    const isBuilder = nextPage === "builder";
    els.generateBuilderPageBtn.classList.toggle("is-active", isBuilder);
    els.generateBuilderPageBtn.setAttribute("aria-selected", String(isBuilder));
    els.generateBuilderPageBtn.setAttribute("tabindex", isBuilder ? "0" : "-1");
  }

  if (els.generateFixturesPageBtn) {
    const isFixtures = nextPage === "fixtures";
    els.generateFixturesPageBtn.classList.toggle("is-active", isFixtures);
    els.generateFixturesPageBtn.setAttribute("aria-selected", String(isFixtures));
    els.generateFixturesPageBtn.setAttribute("tabindex", isFixtures ? "0" : "-1");
  }
  if (els.generateJsonPageBtn) {
    const isJson = nextPage === "json";
    els.generateJsonPageBtn.classList.toggle("is-active", isJson);
    els.generateJsonPageBtn.setAttribute("aria-selected", String(isJson));
    els.generateJsonPageBtn.setAttribute("tabindex", isJson ? "0" : "-1");
  }

  renderGenerateWorkspaceLayout();

  syncWorkspaceFromUi();
  persistInputSnapshot();

  if (focusTarget && typeof focusTarget.focus === "function") {
    window.setTimeout(() => {
      focusTarget.focus();
    }, 0);
  }
}

function renderGenerateWorkspaceLayout() {
  const isUat = isUatRuntimeActive();
  if (!isUat && state.currentGeneratePage === "json") {
    state.currentGeneratePage = "builder";
  }
  const isBuilderPage = state.currentGeneratePage === "builder";
  const isJsonPage = isUat && state.currentGeneratePage === "json";

  if (els.generateJsonPageBtn) {
    els.generateJsonPageBtn.hidden = !isUat;
  }
  if (els.generateJsonPage) {
    els.generateJsonPage.hidden = !isJsonPage;
  }
  if (els.generateBuilderPreviewPanel) {
    els.generateBuilderPreviewPanel.hidden = isUat;
  }
  if (els.uatBuilderSchedulePanel) {
    els.uatBuilderSchedulePanel.hidden = !isUat || !isBuilderPage;
  }
  if (els.uatDbReadPanel) {
    els.uatDbReadPanel.hidden = !isUat || !isBuilderPage;
  }
  if (els.generateSideOutputsHost) {
    els.generateSideOutputsHost.hidden = isUat ? !isJsonPage : false;
  }
  if (els.generationStatus) {
    els.generationStatus.hidden = isUat ? !isJsonPage : true;
  }
  if (els.generateSideColumn) {
    els.generateSideColumn.hidden = false;
  }

  if (isUat && els.generateOutputsStack && els.generateJsonOutputsHost) {
    if (els.generateOutputsStack.parentElement !== els.generateJsonOutputsHost) {
      els.generateJsonOutputsHost.appendChild(els.generateOutputsStack);
    }
  } else if (els.generateOutputsStack && els.generateSideOutputsHost) {
    if (els.generateOutputsStack.parentElement !== els.generateSideOutputsHost) {
      els.generateSideOutputsHost.appendChild(els.generateOutputsStack);
    }
  }

  if (isUat) {
    renderUatBuilderSchedulePanel();
    renderUatDbReadPanel();
  }
}

function syncWorkspaceFromUi() {
  if (state.activeWorkspace === "verify") {
    renderWorkspaceNav();
    return;
  }
  state.activeWorkspace = state.currentGeneratePage === "fixtures" ? "fixtures" : "composer";
  renderWorkspaceNav();
}

function setActiveWorkspace(workspaceKey, { scroll = true } = {}) {
  const workspace = getAppWorkspace(workspaceKey) || getAppWorkspace("composer");
  state.activeWorkspace = workspace?.key || "composer";

  if (workspace?.key === "verify") {
    setVerifyEditorOpen(true);
  } else if (workspace?.generatePage) {
    setGeneratePage(workspace.generatePage);
  }

  renderWorkspaceNav();
  persistInputSnapshot();

  if (scroll && workspace?.targetId) {
    const target = document.getElementById(workspace.targetId);
    if (target?.scrollIntoView) {
      target.scrollIntoView({ behavior: "smooth", block: "start" });
    }
  }
}

function renderWorkspaceNav() {
  if (!els.workspaceNav) {
    return;
  }

  els.workspaceNav.innerHTML = getAppWorkspaces()
    .map((workspace) => {
      const isActive = workspace.key === state.activeWorkspace;
      return (
        `<button type="button" class="workspace-nav-tab${isActive ? " is-active" : ""}" data-workspace-key="${escapeHtml(workspace.key)}" aria-pressed="${isActive ? "true" : "false"}">` +
        `<span class="workspace-nav-tab__label">${escapeHtml(workspace.label)}</span>` +
        `<span class="workspace-nav-tab__note">${escapeHtml(workspace.description)}</span>` +
        `</button>`
      );
    })
    .join("");
}

function normalizeFixtureSourceKey(value) {
  const key = String(value || "").trim().toLowerCase();
  return getFixtureSource(key)?.key || "";
}

function getPublicFixtureSources() {
  return getFixtureSources().filter((source) => source.status === "active");
}

function normalizePublicFixtureSourceKey(value) {
  const key = normalizeFixtureSourceKey(value);
  return getPublicFixtureSources().some((source) => source.key === key) ? key : "";
}

function getActiveFixtureSource() {
  const sourceKey = normalizePublicFixtureSourceKey(state.activeFixtureSource) || getDefaultFixtureSourceKey();
  return getFixtureSource(sourceKey) || getFixtureSource(getDefaultFixtureSourceKey());
}

function isLiveFixtureSourceActive() {
  return getActiveFixtureSource()?.key === "live-schedules";
}

function isScheduleLeaguePubliclyReady(scheduleCode) {
  const definition = getLeagueScheduleDefinition(scheduleCode);
  if (!definition) {
    return false;
  }
  if (Array.isArray(state.scheduleReadyLeagueCodes)) {
    return state.scheduleReadyLeagueCodes.includes(definition.code);
  }
  return Boolean(definition.defaultCompetitionId);
}

function renderFixtureSourceNav() {
  if (!els.fixtureSourceNav) {
    return;
  }

  const publicSources = getPublicFixtureSources();
  const activeSourceKey = normalizePublicFixtureSourceKey(state.activeFixtureSource) || publicSources[0]?.key || getDefaultFixtureSourceKey();
  state.activeFixtureSource = activeSourceKey;
  if (els.fixtureSourceCard) {
    els.fixtureSourceCard.hidden = publicSources.length <= 1;
  }
  if (publicSources.length <= 1) {
    els.fixtureSourceNav.innerHTML = "";
    return;
  }

  els.fixtureSourceNav.innerHTML = publicSources
    .map((source) => {
      const isActive = source.key === activeSourceKey;
      const statusLabel = "Ready now";
      return (
        `<button type="button" class="fixture-source-tab${isActive ? " is-active" : ""}" data-source-key="${escapeHtml(source.key)}" aria-pressed="${isActive ? "true" : "false"}">` +
        `<span class="fixture-source-tab__copy">` +
        `<span class="fixture-source-tab__label">${escapeHtml(source.label)}</span>` +
        `<span class="fixture-source-tab__meta">${escapeHtml(statusLabel)}</span>` +
        `</span>` +
        `</button>`
      );
    })
    .join("");
}

function setActiveFixtureSource(sourceKey) {
  const nextSource = getFixtureSource(normalizePublicFixtureSourceKey(sourceKey) || getDefaultFixtureSourceKey()) ||
    getFixtureSource(getDefaultFixtureSourceKey());
  if (!nextSource) {
    return;
  }
  if (!getPublicFixtureSources().some((source) => source.key === nextSource.key)) {
    return;
  }
  const sourceChanged = nextSource.key !== state.activeFixtureSource;
  state.activeFixtureSource = nextSource.key;

  if (sourceChanged && nextSource.key !== "live-schedules") {
    clearSelectedScheduleFixtureState();
    renderScheduleActiveSummary(null, { leagueCode: "" });
  }

  renderFixtureSourceNav();
  syncFixtureSourceMode();
  persistInputSnapshot();

  if (nextSource.key === "live-schedules" && state.catalogLoaded) {
    void refreshLeagueScheduleSuggestions({ force: false });
  }
}

function syncFixtureSourceMode() {
  const source = getActiveFixtureSource();
  if (!source) {
    return;
  }

  if (els.fixtureSourceNote) {
    els.fixtureSourceNote.textContent =
      source.key === "live-schedules"
        ? "Browse deterministic upcoming fixtures now. Imported CSV is ready to plug in when the Lsports export schema lands."
        : "Imported CSV mode is reserved for normalized Lsports DB-export fixtures. The live schedule flow stays intact and can be resumed anytime.";
  }

  if (els.fixtureSourceCard) {
    els.fixtureSourceCard.hidden = getPublicFixtureSources().length <= 1;
  }

  if (els.generateBuilderPreviewNote) {
    els.generateBuilderPreviewNote.textContent =
      source.key === "live-schedules"
        ? "Default starts on the next matchweek."
        : "Imported CSV mode will use normalized fixture rows from future Lsports DB exports.";
  }

  if (els.generateBuilderPreviewActions) {
    els.generateBuilderPreviewActions.hidden = source.key !== "live-schedules";
  }

  if (els.generateFixturesLiveControls) {
    els.generateFixturesLiveControls.hidden = source.key !== "live-schedules";
  }

  if (els.generateFixtureSearchField) {
    els.generateFixtureSearchField.hidden = source.key !== "live-schedules";
  }

  if (els.refreshScheduleBtn) {
    els.refreshScheduleBtn.hidden = source.key !== "live-schedules";
  }

  if (els.generateFixtureWeekTabs) {
    els.generateFixtureWeekTabs.hidden = source.key !== "live-schedules" || els.generateFixtureWeekTabs.childElementCount === 0;
  }

  if (source.key !== "live-schedules") {
    setScheduleFilterMenuOpen(false);
    setScheduleStatus("Imported CSV mode is reserved for Lsports DB-export ingestion. Live schedule browsing is paused in this mode.", "idle");
    renderBuilderFixturePreview();
    renderCurrentUpcomingFixturesPage();
  } else {
    setScheduleStatus("Select a league to load upcoming scheduled fixtures, or keep typing manually.", "idle");
    renderBuilderFixturePreview();
    renderCurrentUpcomingFixturesPage();
  }

  syncActionState();
}

function populateMarketSchemaSelect() {
  if (!els.generateMarketSchemaSelect) {
    return;
  }

  const schemas = getActiveMarketSchemas();
  const currentKey = getMarketSchema(state.selectedMarketSchemaKey)?.key || getDefaultMarketSchemaKey();
  els.generateMarketSchemaSelect.innerHTML = schemas
    .map((schema) => {
      return `<option value="${escapeHtml(schema.key)}">${escapeHtml(`${schema.label} · ${schema.shortLabel}`)}</option>`;
    })
    .join("");
  const resolvedKey = schemas.some((schema) => schema.key === currentKey)
    ? currentKey
    : getDefaultMarketSchemaKey();
  els.generateMarketSchemaSelect.value = resolvedKey;
  state.selectedMarketSchemaKey = resolvedKey;
  els.generateMarketSchemaSelect.disabled = schemas.length <= 1;
}

function populateMarketFamilySelect() {
  if (!els.generateMarketFamilySelect) {
    return;
  }

  const currentFamily = normalizeUatMarketFamilyKey(state.selectedUatMarketFamily);
  els.generateMarketFamilySelect.innerHTML = UAT_MARKET_FAMILY_OPTIONS
    .map((family) => `<option value="${escapeHtmlAttribute(family.key)}">${escapeHtml(`${family.label} · ${family.shortLabel}`)}</option>`)
    .join("");
  els.generateMarketFamilySelect.value = currentFamily;
  state.selectedUatMarketFamily = currentFamily;
}

function populateMarketLineSelect() {
  if (!els.generateMarketLineSelect) {
    return;
  }

  const options = getAvailableUatMarketLineOptions(state.selectedUatMarketFamily);
  const currentLine = normalizeUatMarketLine(state.selectedUatMarketLine, state.selectedUatMarketFamily);
  els.generateMarketLineSelect.innerHTML = options
    .map((option) => `<option value="${escapeHtmlAttribute(option.key)}">${escapeHtml(option.label)}</option>`)
    .join("");
  els.generateMarketLineSelect.value = currentLine;
  state.selectedUatMarketLine = currentLine;
}

function populateSpreadTeamSelect() {
  if (!els.generateSpreadTeamSelect) {
    return;
  }

  const options = getCurrentUatSpreadTeamOptions();
  const currentSide = getSelectedUatSpreadTeamSide();
  els.generateSpreadTeamSelect.innerHTML = options
    .map((option) => `<option value="${escapeHtmlAttribute(option.key)}">${escapeHtml(option.label)}</option>`)
    .join("");
  els.generateSpreadTeamSelect.value = currentSide;
  state.selectedUatSpreadTeamSide = currentSide;
}

function renderMarketSchemaPanel() {
  const schema = getMarketSchema(state.selectedMarketSchemaKey) || getMarketSchema(getDefaultMarketSchemaKey());
  if (!schema) {
    return;
  }

  const runtimeLabel = String(state.runtimeAppEnvLabel || "Mainnet").trim() || "Mainnet";
  const runtimeCode = normalizeRuntimeAppEnvCode(state.runtimeAppEnv || "mainnet");
  const family = getUatMarketFamilyDefinition(state.selectedUatMarketFamily);
  state.selectedUatMarketLine = normalizeUatMarketLine(state.selectedUatMarketLine, family.key);
  state.selectedUatSpreadTeamSide = normalizeUatSpreadTeamSide(state.selectedUatSpreadTeamSide);
  populateMarketLineSelect();
  populateSpreadTeamSelect();
  const selectedLine = getSelectedUatMarketLine(family.key);
  const selectedSpreadTeamLabel = getSelectedUatSpreadTeamLabel();
  const showLineSelector = runtimeCode === "uat" && supportsUatMarketLine(family.key);
  const showSpreadTeamSelector = runtimeCode === "uat" && family.key === "spreads";
  const outputs = runtimeCode === "uat"
    ? ["Fixture JSON", getUatFamilyOutputLabel(family.key, selectedLine), "Type Reference Payloads (optional)"]
    : schema.outputs;
  const optionalFields = runtimeCode === "uat"
    ? uniqueItems([...(schema.optionalFields || []), "Market family", ...(showLineSelector ? ["Market line"] : []), ...(showSpreadTeamSelector ? ["Spread team"] : [])])
    : schema.optionalFields;
  const description = runtimeCode === "uat"
    ? `${schema.category} · ${family.description}${showLineSelector ? ` Selected line: ${selectedLine}.` : ""}${showSpreadTeamSelector ? ` Selected team: ${selectedSpreadTeamLabel}.` : ""} The selected family drives the primary UAT output panel and its validation rules.`
    : `${schema.category} · ${schema.description}`;

  if (els.generateMarketSchemaCard) {
    els.generateMarketSchemaCard.hidden = false;
  }

  if (els.generateMarketSchemaStatus) {
    els.generateMarketSchemaStatus.textContent = runtimeCode === "uat" ? `UAT · ${family.label}` : "Mainnet only";
    els.generateMarketSchemaStatus.dataset.status = schema.status;
    els.generateMarketSchemaStatus.className = runtimeCode === "uat" ? "mini-badge mini-badge-live" : "mini-badge";
  }
  if (els.generateMarketSchemaDescription) {
    els.generateMarketSchemaDescription.textContent = description;
  }
  if (els.generateMarketSchemaEnvironment) {
    els.generateMarketSchemaEnvironment.textContent = `${runtimeLabel}${runtimeCode === "uat" ? " · family-aware" : ""}`;
  }
  if (els.generateMarketSchemaOutputs) {
    els.generateMarketSchemaOutputs.textContent = outputs.join(" · ");
  }
  if (els.generateMarketSchemaRequired) {
    els.generateMarketSchemaRequired.textContent = schema.requiredFields.join(" · ");
  }
  if (els.generateMarketSchemaOptional) {
    els.generateMarketSchemaOptional.textContent = optionalFields.join(" · ");
  }
  if (els.generateMarketFamilySelect) {
    els.generateMarketFamilySelect.disabled = runtimeCode !== "uat";
    els.generateMarketFamilySelect.value = family.key;
  }
  if (els.generateMarketFamilyInactive) {
    els.generateMarketFamilyInactive.hidden = runtimeCode === "uat";
  }
  if (els.generateMarketFamilyInactiveText) {
    els.generateMarketFamilyInactiveText.textContent = runtimeCode === "uat"
      ? ""
      : `Market family becomes active in UAT. Current environment: ${runtimeLabel}.`;
  }
  if (els.generateMarketFamilyActivateBtn) {
    els.generateMarketFamilyActivateBtn.hidden = runtimeCode === "uat";
    els.generateMarketFamilyActivateBtn.disabled =
      runtimeCode === "uat" ||
      state.isRuntimeEnvSwitching ||
      state.isCatalogLoading ||
      state.isVerifying ||
      state.isGenerating ||
      state.isScheduleLoading;
    els.generateMarketFamilyActivateBtn.textContent = state.isRuntimeEnvSwitching ? "Switching..." : "Switch to UAT";
  }
  if (els.generateMarketFamilyHelp) {
    els.generateMarketFamilyHelp.textContent = runtimeCode === "uat"
      ? `Selected family: ${family.label}.${showLineSelector ? ` Selected line: ${selectedLine}.` : ""}${showSpreadTeamSelector ? ` Selected team: ${selectedSpreadTeamLabel}.` : ""} This drives the primary UAT output panel and validation rules.`
      : "This selector is read-only on Mainnet. Use the inline action to activate UAT-specific payloads.";
  }
  if (els.generateMarketLineField) {
    els.generateMarketLineField.hidden = !showLineSelector;
  }
  if (els.generateMarketLineSelect) {
    els.generateMarketLineSelect.disabled = !showLineSelector;
    els.generateMarketLineSelect.value = selectedLine;
  }
  if (els.generateMarketLineHelp) {
    els.generateMarketLineHelp.textContent = showLineSelector
      ? `Selected line: ${selectedLine}. Regenerate to update the ${family.label.toLowerCase()} family JSON.`
      : "Market line becomes available for Totals and Spreads in UAT.";
  }
  if (els.generateSpreadTeamField) {
    els.generateSpreadTeamField.hidden = !showSpreadTeamSelector;
  }
  if (els.generateSpreadTeamSelect) {
    els.generateSpreadTeamSelect.disabled = !showSpreadTeamSelector;
    els.generateSpreadTeamSelect.value = getSelectedUatSpreadTeamSide();
  }
  if (els.generateSpreadTeamHelp) {
    els.generateSpreadTeamHelp.textContent = showSpreadTeamSelector
      ? `Selected team: ${selectedSpreadTeamLabel}. Regenerate to update the spreads family JSON.`
      : "Spread team becomes available when Spreads is selected in UAT.";
  }

  renderGenerateWorkspaceLayout();
}

function bindEvents() {
  els.reloadCatalogBtn.addEventListener("click", () => {
    uiLog.info("catalog.reload_click");
    void loadCatalog({ force: true });
  });

  els.apiAccessTokenInput?.addEventListener("input", () => {
    renderApiAccessPanel();
  });

  els.apiAccessTokenInput?.addEventListener("keydown", (event) => {
    if (event.key !== "Enter") {
      return;
    }
    event.preventDefault();
    void handleSaveApiAccessTokenAndRetry();
  });

  els.saveApiAccessTokenBtn?.addEventListener("click", () => {
    void handleSaveApiAccessTokenAndRetry();
  });

  els.retryApiAccessBtn?.addEventListener("click", () => {
    void retryProtectedApiFlow();
  });

  els.clearApiAccessTokenBtn?.addEventListener("click", () => {
    handleClearApiAccessToken();
  });

  const verifySection = document.getElementById("verifySection");
  if (verifySection) {
    verifySection.addEventListener("toggle", () => {
      const isOpen = verifySection.open;
      setVerifyEditorOpen(isOpen);
      if (isOpen) {
        state.activeWorkspace = "verify";
      } else if (state.activeWorkspace === "verify") {
        state.activeWorkspace = state.currentGeneratePage === "fixtures" ? "fixtures" : "composer";
      }
      renderWorkspaceNav();
      persistInputSnapshot();
      if (isOpen) {
        window.setTimeout(() => {
          els.fixtureInputJson?.focus();
        }, 0);
      }
    });
  }

  els.workspaceNav?.addEventListener("click", (event) => {
    const tab = event.target instanceof Element ? event.target.closest(".workspace-nav-tab") : null;
    if (!tab) {
      return;
    }
    const workspaceKey = String(tab.getAttribute("data-workspace-key") || "").trim();
    if (workspaceKey) {
      setActiveWorkspace(workspaceKey);
    }
  });

  els.fixtureSourceNav?.addEventListener("click", (event) => {
    const tab = event.target instanceof Element ? event.target.closest(".fixture-source-tab") : null;
    if (!tab) {
      return;
    }
    const sourceKey = String(tab.getAttribute("data-source-key") || "").trim();
    if (sourceKey) {
      setActiveFixtureSource(sourceKey);
    }
  });

  els.verifyBothBtn.addEventListener("click", () => {
    void handleVerify("both");
  });

  els.verifyFixtureBtn.addEventListener("click", () => {
    void handleVerify("fixture");
  });

  els.verifyParentBtn.addEventListener("click", () => {
    void handleVerify("parent");
  });

  els.copyVerifyReportBtn.addEventListener("click", () => {
    void copyOutputText(state.lastVerifyReportText || "", "Verification report copied.");
  });

  els.generateBtn.addEventListener("click", () => {
    void handleGenerate();
  });

  els.generateLeagueSelect.addEventListener("change", () => {
    const selectedValue = getSelectedLeagueControlValue();
    const selectedLeague = getSelectedCatalogLeague();
    const nextScheduleLeagueCode =
      normalizeScheduleLeagueCode(selectedValue) ||
      resolveUiScheduleLeagueCode(selectedLeague);
    const currentScheduleLeagueCode = getActiveScheduleLeagueCode();
    const currentSelectedFixture = getCurrentSelectedScheduleFixture();

    if (currentSelectedFixture && currentScheduleLeagueCode && nextScheduleLeagueCode !== currentScheduleLeagueCode) {
      clearSelectedScheduleFixtureState({ clearDerivedInputs: true, resetWeeks: true });
    }

    state.scheduleLeagueOverrideCode = nextScheduleLeagueCode;
    persistInputSnapshot();
    renderScheduleLeagueTabs();
    renderDeterministicContext();
    if (isLiveFixtureSourceActive()) {
      void refreshLeagueScheduleSuggestions();
    } else {
      syncFixtureSourceMode();
    }
  });

  els.generateBuilderPageBtn?.addEventListener("click", () => {
    setGeneratePage("builder", { focusTarget: els.generateEventNameInput });
  });

  els.generateFixturesPageBtn?.addEventListener("click", () => {
    setGeneratePage("fixtures", { focusTarget: els.generateFixtureSearchInput });
  });

  els.generateJsonPageBtn?.addEventListener("click", () => {
    setGeneratePage("json");
  });

  els.generatePageTabs?.addEventListener("keydown", (event) => {
    moveSingleSelectFocus(event, ".generate-page-tab", (tab) => tab.click());
  });

  els.generateMarketSchemaSelect?.addEventListener("change", () => {
    const selectedKey = String(els.generateMarketSchemaSelect.value || "").trim();
    const schema = getMarketSchema(selectedKey);
    if (!schema || schema.status !== "active") {
      els.generateMarketSchemaSelect.value = state.selectedMarketSchemaKey;
      return;
    }
    state.selectedMarketSchemaKey = schema.key;
    renderMarketSchemaPanel();
    persistInputSnapshot();
  });

  els.generateMarketFamilySelect?.addEventListener("change", () => {
    state.selectedUatMarketFamily = normalizeUatMarketFamilyKey(els.generateMarketFamilySelect.value);
    state.selectedUatMarketLine = state.selectedUatMarketFamily === "totals"
      ? DEFAULT_UAT_MARKET_LINE
      : normalizeUatMarketLine(state.selectedUatMarketLine, state.selectedUatMarketFamily);
    state.outputValidation.uatFamily = null;
    renderMarketSchemaPanel();
    renderJsonOutputs();
    syncActionState();
    persistInputSnapshot();
  });

  els.generateMarketLineSelect?.addEventListener("change", () => {
    state.selectedUatMarketLine = normalizeUatMarketLine(els.generateMarketLineSelect.value, state.selectedUatMarketFamily);
    state.outputValidation.uatFamily = null;
    renderMarketSchemaPanel();
    renderJsonOutputs();
    syncActionState();
    persistInputSnapshot();
  });

  els.generateSpreadTeamSelect?.addEventListener("change", () => {
    state.selectedUatSpreadTeamSide = normalizeUatSpreadTeamSide(els.generateSpreadTeamSelect.value);
    state.outputValidation.uatFamily = null;
    renderMarketSchemaPanel();
    renderJsonOutputs();
    syncActionState();
    persistInputSnapshot();
  });

  els.generateBuilderWeekSelect?.addEventListener("change", () => {
    const selectedWeek = parseScheduleWeekValue(els.generateBuilderWeekSelect.value);
    state.builderScheduleWeek = selectedWeek;
    state.builderSchedulePage = 1;
    state.fixturesPageScheduleWeek = selectedWeek;
    persistInputSnapshot();
    renderBuilderFixturePreview();
    renderUatBuilderSchedulePanel();
    renderCurrentUpcomingFixturesPage();
  });

  els.uatBuilderSchedulePrevBtn?.addEventListener("click", () => {
    state.builderSchedulePage = Math.max(1, Number(state.builderSchedulePage || 1) - 1);
    persistInputSnapshot();
    renderUatBuilderSchedulePanel();
  });

  els.uatBuilderScheduleNextBtn?.addEventListener("click", () => {
    state.builderSchedulePage = Number(state.builderSchedulePage || 1) + 1;
    persistInputSnapshot();
    renderUatBuilderSchedulePanel();
  });

  const handleRefetchFixtures = () => {
    if (!isLiveFixtureSourceActive()) {
      return;
    }
    void refreshLeagueScheduleSuggestions({ force: true });
  };

  if (els.refreshScheduleBtn) {
    els.refreshScheduleBtn.addEventListener("click", handleRefetchFixtures);
  }

  if (els.generateBuilderRefetchBtn) {
    els.generateBuilderRefetchBtn.addEventListener("click", handleRefetchFixtures);
  }

  els.runtimeEnvSelect?.addEventListener("change", () => {
    const requestedEnv = normalizeRuntimeAppEnvCode(els.runtimeEnvSelect.value);
    if (!requestedEnv || requestedEnv === state.runtimeAppEnv) {
      renderRuntimeEnvironmentControl();
      return;
    }
    void handleRuntimeEnvironmentChange(requestedEnv);
  });

  els.generateMarketFamilyActivateBtn?.addEventListener("click", () => {
    if (normalizeRuntimeAppEnvCode(state.runtimeAppEnv || "mainnet") === "uat") {
      renderMarketSchemaPanel();
      return;
    }
    void handleRuntimeEnvironmentChange("uat");
  });

  els.themeToggleBtn?.addEventListener("click", () => {
    const nextTheme = state.theme === "dark" ? "light" : "dark";
    applyTheme(nextTheme);
    saveThemePreference(nextTheme);
  });

  els.generateEventNameInput.addEventListener("change", () => {
    applySelectedScheduleFixture(els.generateEventNameInput.value, { fromManualEntry: true });
    renderMarketSchemaPanel();
  });

  els.generateEventNameInput.addEventListener("input", () => {
    syncScheduleActiveSelection();
    renderMarketSchemaPanel();
  });

  els.generateFixtureSearchInput.addEventListener("input", () => {
    persistInputSnapshot();
    renderCurrentUpcomingFixturesPage();
  });

  if (els.generateFixtureSearchFiltersBtn) {
    els.generateFixtureSearchFiltersBtn.addEventListener("click", () => {
      if (els.generateFixtureSearchFiltersBtn.disabled) {
        return;
      }
      setScheduleFilterMenuOpen(!state.isScheduleFilterMenuOpen);
    });
  }

  for (const checkbox of getScheduleFilterCheckboxes()) {
    checkbox.addEventListener("change", handleScheduleSearchFilterChange);
  }

  els.generateFixtureLeagueTabs?.addEventListener("keydown", (event) => {
    moveSingleSelectFocus(event, ".league-nav-tab", (tab) => tab.click());
  });

  els.generateFixtureWeekTabs?.addEventListener("keydown", (event) => {
    moveSingleSelectFocus(event, ".fixtures-week-pill", (pill) => pill.click());
  });

  els.generateFixtureSearchInput.addEventListener("keydown", handleScheduleBrowserKeydown);
  els.generateFixtureResults.addEventListener("keydown", handleScheduleBrowserKeydown);

  els.copyGenerationStatusBtn.addEventListener("click", () => {
    void copyOutputText(els.generationStatus.innerText || "", "Generation status copied.");
  });

  els.fixtureSampleBtn.addEventListener("click", () => {
    els.fixtureInputJson.value = JSON.stringify(SAMPLE_FIXTURE_JSON, null, 2);
    state.persistFixtureInput = true;
    updateJsonMeta("fixture");
    persistInputSnapshot();
    scheduleAutoVerify({ immediate: true });
    showToast("Fixture sample loaded.", "success");
  });

  els.parentSampleBtn.addEventListener("click", () => {
    els.parentInputJson.value = JSON.stringify(SAMPLE_PARENT_JSON, null, 2);
    state.persistParentInput = true;
    updateJsonMeta("parent");
    persistInputSnapshot();
    scheduleAutoVerify({ immediate: true });
    showToast("Parent market sample loaded.", "success");
  });

  els.fixtureFormatBtn.addEventListener("click", () => {
    const outcome = formatJsonInput("fixture");
    state.persistFixtureInput = true;
    persistInputSnapshot();
    scheduleAutoVerify({ immediate: true });
    if (outcome === "ok") {
      showToast("Fixture JSON formatted.", "success");
    } else if (outcome === "invalid") {
      showToast("Fixture JSON is invalid. Fix syntax before formatting.", "error");
    }
  });

  els.parentFormatBtn.addEventListener("click", () => {
    const outcome = formatJsonInput("parent");
    state.persistParentInput = true;
    persistInputSnapshot();
    scheduleAutoVerify({ immediate: true });
    if (outcome === "ok") {
      showToast("Parent market JSON formatted.", "success");
    } else if (outcome === "invalid") {
      showToast("Parent market JSON is invalid. Fix syntax before formatting.", "error");
    }
  });

  els.fixtureClearBtn.addEventListener("click", () => {
    els.fixtureInputJson.value = "";
    state.persistFixtureInput = true;
    updateJsonMeta("fixture");
    persistInputSnapshot();
    scheduleAutoVerify({ immediate: true });
    showToast("Fixture JSON cleared.", "info");
  });

  els.parentClearBtn.addEventListener("click", () => {
    els.parentInputJson.value = "";
    state.persistParentInput = true;
    updateJsonMeta("parent");
    persistInputSnapshot();
    scheduleAutoVerify({ immediate: true });
    showToast("Parent market JSON cleared.", "info");
  });

  els.fixtureInputJson.addEventListener("input", () => {
    handleVerifyJsonInputChange("fixture");
  });

  els.parentInputJson.addEventListener("input", () => {
    handleVerifyJsonInputChange("parent");
  });

  els.copyGeneratedFixtureBtn.addEventListener("click", () => {
    void copyOutputText(els.generatedFixtureOutput.textContent || "", "Generated fixture JSON copied.");
  });

  els.copyGeneratedParentBtn.addEventListener("click", () => {
    void copyOutputText(els.generatedParentOutput.textContent || "", "Generated parent market JSON copied.");
  });

  els.copyGeneratedUatFamilyBtn?.addEventListener("click", () => {
    void copyOutputText(els.generatedUatFamilyOutput.textContent || "", "Generated UAT family JSON copied.");
  });

  els.copyGeneratedTypeReferencesBtn?.addEventListener("click", () => {
    void copyOutputText(els.generatedTypeReferencesOutput.textContent || "", "Generated type reference payloads copied.");
  });

  els.validateGeneratedFixtureBtn?.addEventListener("click", () => {
    validateGeneratedOutputPanel("fixture");
  });

  els.validateGeneratedParentBtn?.addEventListener("click", () => {
    validateGeneratedOutputPanel("parent");
  });

  els.validateGeneratedUatFamilyBtn?.addEventListener("click", () => {
    validateGeneratedOutputPanel("uatFamily");
  });

  els.validateGeneratedTypeReferencesBtn?.addEventListener("click", () => {
    validateGeneratedOutputPanel("typeReferences");
  });

  els.generateEventNameInput.addEventListener("keydown", (event) => {
    if (event.key !== "Enter") {
      return;
    }
    event.preventDefault();
    void handleGenerate();
  });

  document.addEventListener("keydown", (event) => {
    if (event.key === "Escape" && state.isScheduleFilterMenuOpen) {
      setScheduleFilterMenuOpen(false);
      els.generateFixtureSearchFiltersBtn?.focus();
      return;
    }

    const primaryMod = event.metaKey || event.ctrlKey;
    if (!primaryMod || event.key !== "Enter") {
      return;
    }

    event.preventDefault();
    if (event.shiftKey) {
      void handleGenerate();
      return;
    }
    void handleVerify("both");
  });

  document.addEventListener("pointerdown", (event) => {
    if (!state.isScheduleFilterMenuOpen) {
      return;
    }

    if (!(event.target instanceof Element)) {
      setScheduleFilterMenuOpen(false);
      return;
    }

    if (!event.target.closest(".fixture-search-shell")) {
      setScheduleFilterMenuOpen(false);
    }
  });

  document.addEventListener("click", (event) => {
    const leagueTab = event.target instanceof Element ? event.target.closest(".league-nav-tab") : null;
    if (leagueTab) {
      const leagueId = String(leagueTab.getAttribute("data-league-id") || "").trim();
      const scheduleCode = normalizeScheduleLeagueCode(leagueTab.getAttribute("data-schedule-code"));
      const currentScheduleLeagueCode = getActiveScheduleLeagueCode();
      const currentSelectedFixture = getCurrentSelectedScheduleFixture();

      if (currentSelectedFixture && scheduleCode && currentScheduleLeagueCode && scheduleCode !== currentScheduleLeagueCode) {
        clearSelectedScheduleFixtureState({ clearDerivedInputs: true, resetWeeks: true });
      }

      const nextSelectValue = leagueId || scheduleCode || "";
      if (nextSelectValue) {
        if (els.generateLeagueSelect.value !== nextSelectValue) {
          els.generateLeagueSelect.value = nextSelectValue;
        }
      } else if (els.generateLeagueSelect.value) {
        els.generateLeagueSelect.value = "";
      }

      if (scheduleCode) {
        state.scheduleLeagueOverrideCode = scheduleCode;
        persistInputSnapshot();
        renderScheduleLeagueTabs();
        renderDeterministicContext();
        void refreshLeagueScheduleSuggestions({ force: true });
      }
      return;
    }

    const weekPill = event.target instanceof Element ? event.target.closest(".fixtures-week-pill") : null;
    if (weekPill) {
      const week = parseScheduleWeekValue(weekPill.getAttribute("data-week"));
      state.fixturesPageScheduleWeek = week;
      state.builderScheduleWeek = week;
      persistInputSnapshot();
      renderCurrentUpcomingFixturesPage();
      renderBuilderFixturePreview();
      return;
    }

    const toggle = event.target instanceof Element ? event.target.closest(".result-chip-toggle") : null;
    if (toggle) {
      const targetId = String(toggle.getAttribute("aria-controls") || "").trim();
      if (!targetId) {
        return;
      }

      const section = document.getElementById(targetId);
      if (!section) {
        return;
      }

      const isExpanded = toggle.getAttribute("aria-expanded") === "true";
      const nextExpanded = !isExpanded;
      toggle.setAttribute("aria-expanded", String(nextExpanded));
      toggle.classList.toggle("chip-open", nextExpanded);
      section.hidden = !nextExpanded;
      return;
    }

    const scheduleButton = event.target instanceof Element
      ? event.target.closest(".schedule-fixture-btn, .builder-fixture-row")
      : null;
    if (!scheduleButton) {
      return;
    }

    const fixtureId = String(scheduleButton.getAttribute("data-fixture-id") || "").trim();
    const eventName = String(scheduleButton.getAttribute("data-event-name") || "").trim();
    const selection = fixtureId || eventName;
    if (!selection) {
      return;
    }
    const preservePage = state.currentGeneratePage === "fixtures";
    const appliedFixture = applySelectedScheduleFixture(selection, { preservePage });
    if (appliedFixture && preservePage) {
      void handleGenerate({ preserveGeneratePage: true });
    }
  });

  bindInputPersistence();
}

function seedDefaults() {
  const referenceDate = getReferenceNowDate() || new Date();
  const todayIso = referenceDate.toISOString().slice(0, 10);
  if (!String(els.generateFixtureDateInput.value || "").trim()) {
    els.generateFixtureDateInput.value = todayIso;
  }
  if (!String(els.generateKickoffTimeInput.value || "").trim()) {
    els.generateKickoffTimeInput.value = "20:00";
  }
  if (!String(els.generateMatchDayInput.value || "").trim()) {
    els.generateMatchDayInput.value = "1";
  }
}

function bindInputPersistence() {
  const persistOnInput = [
    els.fixtureInputJson,
    els.parentInputJson,
    els.generateEventNameInput,
    els.generateTypeRefInput,
    els.generateFixtureDateInput,
    els.generateKickoffTimeInput,
    els.generateMatchDayInput,
    els.generateMatchWeekInput,
    els.generateLocationInput,
    els.generateVenueInput,
  ];

  for (const element of persistOnInput) {
    element.addEventListener("input", persistInputSnapshot);
  }

  const persistOnChange = [
    els.generateLeagueSelect,
  ];

  for (const element of persistOnChange) {
    element.addEventListener("change", persistInputSnapshot);
  }
}

function persistInputSnapshot() {
  saveSnapshot({
    runtime: {
      scheduleSnapshotVersion: SCHEDULE_SNAPSHOT_SCHEMA_VERSION,
      referenceNowIso: String(state.referenceNowIso || ""),
      scheduleSnapshots: sanitizeScheduleSnapshots(state.scheduleSnapshots),
    },
    verify: {
      fixtureJson: state.persistFixtureInput ? String(els.fixtureInputJson.value || "") : "",
      parentJson: state.persistParentInput ? String(els.parentInputJson.value || "") : "",
    },
    generate: {
      activeWorkspace: String(state.activeWorkspace || "composer"),
      fixtureSourceKey: String(normalizePublicFixtureSourceKey(state.activeFixtureSource) || getDefaultFixtureSourceKey()),
      marketSchemaKey: String(state.selectedMarketSchemaKey || getDefaultMarketSchemaKey()),
      uatMarketFamily: String(state.selectedUatMarketFamily || DEFAULT_UAT_MARKET_FAMILY),
      uatMarketLine: String(state.selectedUatMarketLine || DEFAULT_UAT_MARKET_LINE),
      uatSpreadTeamSide: String(state.selectedUatSpreadTeamSide || DEFAULT_UAT_SPREAD_TEAM_SIDE),
      page: String(state.currentGeneratePage || "builder"),
      builderScheduleWeek: Number.isInteger(state.builderScheduleWeek) ? state.builderScheduleWeek : "",
      builderSchedulePage: Number.isInteger(state.builderSchedulePage) ? state.builderSchedulePage : 1,
      fixturesPageScheduleWeek: Number.isInteger(state.fixturesPageScheduleWeek) ? state.fixturesPageScheduleWeek : "",
      eventName: String(els.generateEventNameInput.value || ""),
      leagueSelection: String(els.generateLeagueSelect.value || state.pendingRestoredLeagueSelection || ""),
      scheduleLeagueOverrideCode: String(
        state.scheduleLeagueOverrideCode || state.pendingRestoredScheduleLeagueOverrideCode || ""
      ),
      selectedScheduleFixtureId: String(state.selectedScheduleFixtureId || state.pendingRestoredSelectedScheduleFixtureId || ""),
      fixtureSearch: String(els.generateFixtureSearchInput.value || ""),
      fixtureSearchFilters: { ...state.scheduleSearchFilters },
      typeReferenceId: String(els.generateTypeRefInput.value || ""),
      fixtureDate: String(els.generateFixtureDateInput.value || ""),
      kickoffTimeUtc: String(els.generateKickoffTimeInput.value || ""),
      matchDay: String(els.generateMatchDayInput.value || ""),
      matchWeek: String(els.generateMatchWeekInput.value || ""),
      location: String(els.generateLocationInput.value || ""),
      venue: String(els.generateVenueInput.value || ""),
    },
  });
  renderGenerateReadiness();
}

function restoreInputSnapshot() {
  const snapshot = loadSnapshot();
  if (!snapshot || typeof snapshot !== "object") {
    return;
  }

  const runtime = snapshot.runtime && typeof snapshot.runtime === "object" ? snapshot.runtime : {};
  const verify = snapshot.verify && typeof snapshot.verify === "object" ? snapshot.verify : {};
  const generate = snapshot.generate && typeof snapshot.generate === "object" ? snapshot.generate : {};
  const restoredScheduleSnapshots = restoreScheduleSnapshots(runtime.scheduleSnapshots);

  const restoredReferenceNowIso = normalizeReferenceNowIso(runtime.referenceNowIso);
  const restoredVersion = Number.parseInt(String(runtime.scheduleSnapshotVersion || ""), 10);
  const shouldInvalidateRuntime =
    restoredVersion !== SCHEDULE_SNAPSHOT_SCHEMA_VERSION ||
    (Object.keys(restoredScheduleSnapshots).length > 0 && shouldRotateDeterministicReference(restoredReferenceNowIso));

  state.referenceNowIso = shouldInvalidateRuntime ? "" : restoredReferenceNowIso;
  state.scheduleSnapshots = shouldInvalidateRuntime ? {} : restoredScheduleSnapshots;

  els.fixtureInputJson.value = asRestoredString(verify.fixtureJson);
  els.parentInputJson.value = asRestoredString(verify.parentJson);
  state.persistFixtureInput = true;
  state.persistParentInput = true;

  state.activeWorkspace = ["composer", "fixtures", "verify"].includes(String(generate.activeWorkspace || "").trim())
    ? String(generate.activeWorkspace || "").trim()
    : "composer";
  state.activeFixtureSource =
    normalizePublicFixtureSourceKey(generate.fixtureSourceKey) || getDefaultFixtureSourceKey();
  state.selectedMarketSchemaKey =
    getMarketSchema(asRestoredString(generate.marketSchemaKey))?.key || getDefaultMarketSchemaKey();
  state.selectedUatMarketFamily = normalizeUatMarketFamilyKey(generate.uatMarketFamily);
  state.selectedUatMarketLine = normalizeUatMarketLine(generate.uatMarketLine, generate.uatMarketFamily);
  state.selectedUatSpreadTeamSide = normalizeUatSpreadTeamSide(generate.uatSpreadTeamSide);
  {
    const restoredPage = String(generate.page || "").trim();
    state.currentGeneratePage =
      restoredPage === "fixtures"
        ? "fixtures"
        : (restoredPage === "json" ? "json" : "builder");
  }
  state.builderScheduleWeek = parseScheduleWeekValue(generate.builderScheduleWeek);
  state.builderSchedulePage = Number.parseInt(String(generate.builderSchedulePage || "1"), 10) > 0
    ? Number.parseInt(String(generate.builderSchedulePage || "1"), 10)
    : 1;
  state.fixturesPageScheduleWeek = parseScheduleWeekValue(generate.fixturesPageScheduleWeek);
  els.generateEventNameInput.value = asRestoredString(generate.eventName);
  state.pendingRestoredLeagueSelection = asRestoredString(generate.leagueSelection);
  state.pendingRestoredScheduleLeagueOverrideCode = asRestoredString(generate.scheduleLeagueOverrideCode);
  state.pendingRestoredSelectedScheduleFixtureId = asRestoredString(generate.selectedScheduleFixtureId);
  els.generateFixtureSearchInput.value = asRestoredString(generate.fixtureSearch);
  state.scheduleSearchFilters = createScheduleSearchFilters(generate.fixtureSearchFilters);
  els.generateTypeRefInput.value = asRestoredString(generate.typeReferenceId);
  els.generateFixtureDateInput.value = asRestoredString(generate.fixtureDate) || els.generateFixtureDateInput.value;
  els.generateKickoffTimeInput.value = asRestoredString(generate.kickoffTimeUtc) || els.generateKickoffTimeInput.value;
  els.generateMatchDayInput.value = asRestoredString(generate.matchDay) || els.generateMatchDayInput.value;
  els.generateMatchWeekInput.value = asRestoredString(generate.matchWeek);
  els.generateLocationInput.value = asRestoredString(generate.location);
  els.generateVenueInput.value = asRestoredString(generate.venue);
}

async function loadCatalog({ force = false } = {}) {
  state.isCatalogLoading = true;
  syncActionState();
  setButtonBusy(els.reloadCatalogBtn, true, "Loading...");
  setCatalogStatus(force ? "Reloading CSV catalog..." : "Loading CSV catalog...", "working");
  setOverviewCard("catalog", {
    value: force ? "Refreshing" : "Loading",
    note: force ? "Reloading CSV source of truth" : "Reading CSV source of truth",
    tone: "working",
  });

  try {
    const payload = await fetchCatalogPayload();
    const normalized = normalizeCatalogPayload(payload);
    clearProtectedApiAccessRequirement();
    state.leagues = normalized.leagues;
    state.teams = normalized.teams;
    state.catalogLoaded = true;
    state.catalogSourceLabel = String(payload?.source?.label || "CSV files");
    state.scheduleReadyLeagueCodes = extractScheduleReadyLeagueCodes(payload);
    state.runtimeAppEnv = normalizeRuntimeAppEnvCode(payload?.source?.environment?.app_env || "mainnet");
    state.runtimeAppEnvLabel = String(payload?.source?.environment?.app_env_label || (state.runtimeAppEnv === "uat" ? "UAT" : "Mainnet")).trim();
    renderRuntimeEnvironmentControl();
    renderMarketSchemaPanel();
    renderJsonOutputs();

    populateLeagueSelect();
    if (isLiveFixtureSourceActive()) {
      await refreshLeagueScheduleSuggestions({ force: false });
    } else {
      syncFixtureSourceMode();
    }

    setCatalogStatus(
      `CSV catalog loaded: ${state.leagues.length} leagues, ${state.teams.length} teams (${state.catalogSourceLabel}).`,
      "success"
    );
    setOverviewCard("catalog", {
      value: "Ready",
      note: `${state.leagues.length} leagues · ${state.teams.length} teams`,
      tone: "success",
    });

    uiLog.info("catalog.loaded", {
      leagues: state.leagues.length,
      teams: state.teams.length,
      source: state.catalogSourceLabel,
    });

    scheduleAutoVerify({ immediate: true });
  } catch (error) {
    state.catalogLoaded = false;
    state.leagues = [];
    state.teams = [];
    state.scheduleReadyLeagueCodes = null;
    if (isBearerAuthError(error)) {
      requireProtectedApiAccess("Catalog access is protected. Paste the API bearer token, then retry.");
    }
    populateLeagueSelect();
    clearScheduleSuggestions();
    setScheduleStatus(
      isBearerAuthError(error)
        ? "Schedule suggestions are paused until the API bearer token is supplied."
        : "Schedule suggestions are unavailable until the CSV catalog loads.",
      "error"
    );

    setCatalogStatus(
      isBearerAuthError(error)
        ? "Protected API access needs a bearer token before the catalog can load."
        : `Failed to load CSV catalog: ${String(error?.message || error)}`,
      "error"
    );
    setOverviewCard("catalog", {
      value: "Unavailable",
      note: "Catalog load failed",
      tone: "error",
    });
    uiLog.error("catalog.load_failed", { message: String(error?.message || error) });
  } finally {
    state.isCatalogLoading = false;
    setButtonBusy(els.reloadCatalogBtn, false, "Reload CSV Catalog");
    syncActionState();
  }
}

function populateLeagueSelect() {
  const current = String(state.pendingRestoredLeagueSelection || getSelectedLeagueControlValue() || "").trim();
  const options = [`<option value="">Auto-detect from teams</option>`];

  for (const league of state.leagues) {
    options.push(
      `<option value="${escapeHtml(league.id)}">${escapeHtml(getLeagueSelectOptionLabel(league))}</option>`
    );
  }

  els.generateLeagueSelect.innerHTML = options.join("");
  if (current && Array.from(els.generateLeagueSelect.options).some((option) => String(option.value) === current)) {
    els.generateLeagueSelect.value = current;
  }
  state.scheduleLeagueOverrideCode =
    normalizeScheduleLeagueCode(state.pendingRestoredScheduleLeagueOverrideCode) ||
    normalizeScheduleLeagueCode(current) ||
    resolveUiScheduleLeagueCode(getSelectedCatalogLeague()) ||
    normalizeScheduleLeagueCode(state.scheduleLeagueOverrideCode);
  state.pendingRestoredLeagueSelection = "";
  state.pendingRestoredScheduleLeagueOverrideCode = "";
  renderScheduleLeagueTabs();
  renderDeterministicContext();
}

function getLeagueSelectOptionLabel(league) {
  const scheduleCode = resolveUiScheduleLeagueCode(league);
  const definition = getLeagueScheduleDefinition(scheduleCode);
  const defaultName = String(league?.name || "").trim();
  const alternateName = String(league?.alternateName || "").trim();
  const key = String(league?.key || "").trim();

  let displayName = defaultName || key;
  if (scheduleCode === "fifa-friendlies") {
    const normalizedAlternate = normalizeForSearch(alternateName);
    displayName =
      normalizedAlternate && normalizedAlternate !== "fifa"
        ? alternateName
        : String(definition?.label || "").trim() || displayName;
  }

  return `${displayName} (${key})`.trim();
}

async function refreshLeagueScheduleSuggestions({ force = false } = {}) {
  if (!isLiveFixtureSourceActive()) {
    state.isScheduleLoading = false;
    setButtonBusy(els.refreshScheduleBtn, false, "Refetch Fixtures");
    setButtonBusy(els.generateBuilderRefetchBtn, false, "Refetch Fixtures");
    syncFixtureSourceMode();
    return;
  }

  const requestId = state.scheduleRequestId + 1;
  state.scheduleRequestId = requestId;
  const selectedLeagueId = String(els.generateLeagueSelect.value || "").trim();
  const scheduleLeagueCode = getActiveScheduleLeagueCode();

  if (!scheduleLeagueCode) {
    state.isScheduleLoading = false;
    syncActionState();
    clearScheduleSuggestions({ clearLeagueContext: true });
    if (!selectedLeagueId) {
      setScheduleStatus("Select a league to load upcoming scheduled fixtures, or keep typing manually.", "idle");
    } else {
      setScheduleStatus("Manual entry is active. Schedule suggestions are not wired for this league yet.", "idle");
    }
    return;
  }

  const savedSnapshot = state.scheduleSnapshots[scheduleLeagueCode] || null;
  const snapshotMode = String(savedSnapshot?.selectionMode || "").trim();
  const canUseSavedSnapshot =
    !force &&
    savedSnapshot &&
    Array.isArray(savedSnapshot.fixtures) &&
    (
      snapshotMode === "immediate-week" ||
      snapshotMode === "immediate-two-weeks" ||
      snapshotMode === "immediate-five-weeks" ||
      snapshotMode === "immediate-six-weeks"
    );

  if (canUseSavedSnapshot) {
    applyScheduleSnapshot(scheduleLeagueCode, savedSnapshot, { reason: "snapshot" });
    uiLog.info("schedule.snapshot_restored", {
      requestId,
      league: scheduleLeagueCode,
      fixtures: savedSnapshot.fixtures.length,
      referenceNow: savedSnapshot.referenceNowIso || state.referenceNowIso,
    });
    state.isScheduleLoading = false;
    setButtonBusy(els.refreshScheduleBtn, false, "Refetch Fixtures");
    setButtonBusy(els.generateBuilderRefetchBtn, false, "Refetch Fixtures");
    syncActionState();
    return;
  }

  const hasWarmCache =
    state.upcomingScheduleLeagueCode === scheduleLeagueCode &&
    state.upcomingScheduleFixtures.length > 0;

  if (hasWarmCache) {
    renderScheduleSuggestions(
      state.upcomingScheduleFixtures,
      state.upcomingScheduleWeek,
      state.upcomingScheduleLabel,
      scheduleLeagueCode
    );
    state.isScheduleLoading = false;
    setButtonBusy(els.refreshScheduleBtn, false, "Refetch Fixtures");
    setButtonBusy(els.generateBuilderRefetchBtn, false, "Refetch Fixtures");
    syncActionState();
    return;
  }

  state.isScheduleLoading = true;
  setButtonBusy(els.refreshScheduleBtn, true, force ? "Refetching..." : "Loading...");
  setButtonBusy(els.generateBuilderRefetchBtn, true, force ? "Refetching..." : "Loading...");
  syncActionState();
  setScheduleStatus(`Loading upcoming ${getScheduleLeagueLabel(scheduleLeagueCode)} fixtures...`, "working");
  if (!hasWarmCache) {
    els.generateFixtureSummary.textContent = "Loading upcoming fixtures...";
    els.generateFixtureResults.innerHTML = `<div class="schedule-browser-empty">Loading upcoming fixtures...</div>`;
    if (els.generateBuilderFixturePreview) {
      els.generateBuilderFixturePreview.innerHTML = `<div class="schedule-browser-empty">Loading upcoming fixtures...</div>`;
    }
  }
  uiLog.info("schedule.load_start", {
    requestId,
    force,
    league: scheduleLeagueCode,
    warmCache: hasWarmCache,
  });

  try {
    const payload = await fetchUpcomingFixturesForLeague(scheduleLeagueCode, {
      refresh: force,
      referenceNowIso: state.referenceNowIso,
    });
    clearProtectedApiAccessRequirement();
    if (requestId !== state.scheduleRequestId) {
      uiLog.warn("schedule.load_stale_discarded", {
        requestId,
        currentRequestId: state.scheduleRequestId,
        league: scheduleLeagueCode,
      });
      return;
    }
    const snapshot = {
      fetchedAt: String(payload?.fetched_at || "").trim(),
      referenceNowIso: normalizeReferenceNowIso(payload?.reference_now || state.referenceNowIso),
      selectedWeek: Number.isInteger(payload?.selected_week) ? payload.selected_week : null,
      selectedWeeks: Array.isArray(payload?.selected_weeks)
        ? payload.selected_weeks.filter((value) => Number.isInteger(value))
        : [],
      selectedLabel: String(payload?.selected_label || "").trim(),
      selectionMode: String(payload?.selection_mode || "").trim(),
      fixtures: Array.isArray(payload?.fixtures) ? payload.fixtures : [],
    };
    state.scheduleSnapshots[scheduleLeagueCode] = snapshot;
    persistInputSnapshot();
    applyScheduleSnapshot(scheduleLeagueCode, snapshot, { reason: force ? "manual-refresh" : "live-fetch" });
    uiLog.info("schedule.loaded", {
      league: scheduleLeagueCode,
      week: snapshot.selectedWeek,
      label: snapshot.selectedLabel,
      fixtures: snapshot.fixtures.length,
      referenceNow: snapshot.referenceNowIso,
    });
    const currentScheduleSelection = String(state.selectedScheduleFixtureId || els.generateEventNameInput.value || "").trim();
    if (currentScheduleSelection) {
      applySelectedScheduleFixture(currentScheduleSelection, { fromManualEntry: true, silent: true });
    }
  } catch (error) {
    if (requestId !== state.scheduleRequestId) {
      uiLog.warn("schedule.load_error_stale_discarded", {
        requestId,
        currentRequestId: state.scheduleRequestId,
        league: scheduleLeagueCode,
        message: String(error?.message || error),
      });
      return;
    }
    if (isBearerAuthError(error)) {
      requireProtectedApiAccess(
        `Upcoming ${getScheduleLeagueLabel(scheduleLeagueCode)} fixtures are behind a protected API. Paste the bearer token, then retry.`
      );
    }
    clearScheduleSuggestions();
    els.generateFixtureResults.innerHTML = `<div class="schedule-browser-empty">Could not load upcoming fixtures right now.</div>`;
    setScheduleStatus(
      isBearerAuthError(error)
        ? `Protected API access is required to load upcoming ${getScheduleLeagueLabel(scheduleLeagueCode)} fixtures.`
        : `Could not load upcoming ${getScheduleLeagueLabel(scheduleLeagueCode)} fixtures: ${String(error?.message || error)}`,
      "error"
    );
    uiLog.error("schedule.load_failed", {
      requestId,
      league: scheduleLeagueCode,
      message: String(error?.message || error),
    });
  } finally {
    if (requestId === state.scheduleRequestId) {
      state.isScheduleLoading = false;
      setButtonBusy(els.refreshScheduleBtn, false, "Refetch Fixtures");
      setButtonBusy(els.generateBuilderRefetchBtn, false, "Refetch Fixtures");
      syncActionState();
    }
  }
}

function renderScheduleSuggestions(fixtures, selectedWeek, selectedLabel, leagueCode) {
  const datalistOptions = [];

  for (const fixture of fixtures || []) {
    const eventName = String(fixture?.eventName || "").trim();
    if (!eventName) {
      continue;
    }

    const label = String(fixture?.optionLabel || eventName).trim();
    datalistOptions.push(`<option value="${escapeHtml(eventName)}" label="${escapeHtml(label)}"></option>`);
  }

  els.generateEventNameSuggestions.innerHTML = datalistOptions.join("");
  renderBuilderFixturePreview(fixtures);
  renderCurrentUpcomingFixturesPage(fixtures);
  renderScheduleLeagueTabs();

  if (!fixtures || fixtures.length === 0) {
    setScheduleStatus(buildNoFixturesStatusMessage(leagueCode), "warn");
    return;
  }

  const weekLabel = selectedLabel || (Number.isInteger(selectedWeek) ? `Matchday ${selectedWeek}` : "Upcoming fixtures");
  setScheduleStatus(`${weekLabel} loaded from ${getScheduleLeagueLabel(leagueCode)} schedule API. Pick a fixture or type manually.`, "success");
}

function applyScheduleSnapshot(leagueCode, snapshot, { reason = "snapshot" } = {}) {
  const previousSelectedFixture = getCurrentSelectedScheduleFixture();
  const fixtures = Array.isArray(snapshot?.fixtures) ? snapshot.fixtures : [];
  const nextLeagueCode = String(leagueCode || "").trim().toLowerCase();
  const leagueChanged = nextLeagueCode !== String(state.upcomingScheduleLeagueCode || "").trim().toLowerCase();
  const defaultWeek = Number.isInteger(snapshot?.selectedWeek) ? snapshot.selectedWeek : null;
  state.upcomingScheduleLeagueCode = String(leagueCode || "").trim().toLowerCase();
  state.upcomingScheduleWeek = Number.isInteger(snapshot?.selectedWeek) ? snapshot.selectedWeek : null;
  state.upcomingScheduleWeeks = Array.isArray(snapshot?.selectedWeeks)
    ? snapshot.selectedWeeks.filter((value) => Number.isInteger(value)).slice(0, UPCOMING_MATCHWEEK_WINDOW)
    : [];
  state.upcomingScheduleLabel = String(snapshot?.selectedLabel || "").trim();
  state.upcomingScheduleFixtures = fixtures;
  if (leagueChanged) {
    if (els.generateFixtureSearchInput) {
      els.generateFixtureSearchInput.value = "";
    }
    setScheduleFilterMenuOpen(false);
    persistInputSnapshot();
  }
  state.builderScheduleWeek = resolveActiveScheduleWeek(
    leagueChanged ? defaultWeek : state.builderScheduleWeek ?? defaultWeek,
    fixtures
  );
  state.builderSchedulePage = 1;
  state.fixturesPageScheduleWeek = resolveActiveScheduleWeek(
    leagueChanged ? defaultWeek : state.fixturesPageScheduleWeek ?? defaultWeek,
    fixtures
  );
  const restoredFixture = resolveScheduleFixture(state.pendingRestoredSelectedScheduleFixtureId, fixtures);
  if (restoredFixture) {
    state.selectedScheduleFixtureId = getScheduleFixtureIdentity(restoredFixture);
    state.pendingRestoredSelectedScheduleFixtureId = "";
  } else if (
    state.selectedScheduleFixtureId &&
    !resolveScheduleFixture(state.selectedScheduleFixtureId, fixtures)
  ) {
    const shouldClearDerivedInputs =
      leagueChanged &&
      previousSelectedFixture &&
      normalizeForSearch(els.generateEventNameInput.value || "") ===
        normalizeForSearch(previousSelectedFixture.eventName || "");

    clearSelectedScheduleFixtureState({ clearDerivedInputs: shouldClearDerivedInputs });
  }
  renderScheduleSuggestions(fixtures, state.upcomingScheduleWeek, state.upcomingScheduleLabel, state.upcomingScheduleLeagueCode);
  renderDeterministicContext();

  const weekLabel = state.upcomingScheduleLabel || (state.upcomingScheduleWeek ? `Matchday ${state.upcomingScheduleWeek}` : "Upcoming fixtures");
  setScheduleStatus(
    fixtures.length > 0
      ? `${weekLabel} loaded from ${getScheduleLeagueLabel(leagueCode)} schedule API.`
      : buildNoFixturesStatusMessage(leagueCode),
    fixtures.length > 0 ? "success" : "warn"
  );
}

function clearScheduleSuggestions({ clearLeagueContext = false } = {}) {
  if (clearLeagueContext) {
    state.scheduleLeagueOverrideCode = "";
  }
  state.upcomingScheduleLeagueCode = "";
  state.upcomingScheduleWeek = null;
  state.upcomingScheduleWeeks = [];
  state.upcomingScheduleLabel = "";
  state.upcomingScheduleFixtures = [];
  clearSelectedScheduleFixtureState();
  state.builderScheduleWeek = null;
  state.fixturesPageScheduleWeek = null;
  setScheduleFilterMenuOpen(false);
  els.generateFixtureSearchInput.value = "";
  els.generateEventNameSuggestions.innerHTML = "";
  els.generateFixtureSummary.textContent = "Select a supported league to browse upcoming fixtures.";
  if (els.generateBuilderWeekSelect) {
    els.generateBuilderWeekSelect.innerHTML = `<option value="">Select a league first</option>`;
    els.generateBuilderWeekSelect.value = "";
  }
  if (els.generateBuilderFixturePreview) {
    els.generateBuilderFixturePreview.innerHTML = `<div class="schedule-browser-empty">No schedule loaded yet.</div>`;
  }
  if (els.uatBuilderScheduleResults) {
    els.uatBuilderScheduleResults.innerHTML = `<div class="schedule-browser-empty">No schedule loaded yet.</div>`;
  }
  state.builderSchedulePage = 1;
  renderScheduleLeagueTabs();
  if (els.generateFixtureWeekTabs) {
    els.generateFixtureWeekTabs.innerHTML = "";
    els.generateFixtureWeekTabs.hidden = true;
  }
  els.generateFixtureResults.innerHTML = `<div class="schedule-browser-empty">No schedule loaded yet.</div>`;
  renderScheduleActiveSummary(null, { leagueCode: "" });
  renderDeterministicContext();
  renderGenerateReadiness();
}

function clearSelectedScheduleFixtureState({ clearDerivedInputs = false, resetWeeks = false } = {}) {
  state.selectedScheduleFixtureId = "";
  state.scheduleCursorFixtureId = "";

  if (clearDerivedInputs) {
    els.generateEventNameInput.value = "";
    els.generateFixtureDateInput.value = "";
    els.generateKickoffTimeInput.value = "";
    els.generateMatchDayInput.value = "";
    els.generateMatchWeekInput.value = "";
  }

  if (resetWeeks) {
    state.builderScheduleWeek = null;
    state.fixturesPageScheduleWeek = null;
  }

  renderMarketSchemaPanel();
}

function setScheduleStatus(message, tone = "idle") {
  els.generateScheduleStatus.textContent = String(message || "");
  els.generateScheduleStatus.className = "field-hint schedule-status";
  if (tone === "success") {
    els.generateScheduleStatus.classList.add("hint-success");
  } else if (tone === "error") {
    els.generateScheduleStatus.classList.add("hint-error");
  } else if (tone === "working") {
    els.generateScheduleStatus.classList.add("hint-working");
  } else if (tone === "warn") {
    els.generateScheduleStatus.classList.add("hint-warn");
  }
}

function applySelectedScheduleFixture(rawEventName, { fromManualEntry = false, silent = false, preservePage = false } = {}) {
  const selection = String(rawEventName || "").trim();
  if (!selection || !Array.isArray(state.upcomingScheduleFixtures) || state.upcomingScheduleFixtures.length === 0) {
    if (!selection) {
      state.selectedScheduleFixtureId = "";
    }
    renderCurrentUpcomingFixturesPage();
    renderBuilderFixturePreview(state.upcomingScheduleFixtures);
    return null;
  }

  const fixture = resolveScheduleFixture(selection, state.upcomingScheduleFixtures);
  if (!fixture) {
    if (fromManualEntry) {
      state.selectedScheduleFixtureId = "";
      renderCurrentUpcomingFixturesPage();
      renderBuilderFixturePreview(state.upcomingScheduleFixtures);
    }
    return null;
  }

  const previousFixtureId = String(state.selectedScheduleFixtureId || "").trim();
  const nextMatchDayValue = resolveAppliedMatchDayValue({
    existingMatchDayValue: els.generateMatchDayInput.value,
    fixtureMatchDay: fixture.matchDay,
  });
  const nextFixtureId = getScheduleFixtureIdentity(fixture);
  const shouldResetUatFamilySelection =
    isUatRuntimeActive() &&
    Boolean(nextFixtureId) &&
    nextFixtureId !== previousFixtureId;

  els.generateEventNameInput.value = fixture.eventName;
  els.generateFixtureDateInput.value = String(fixture.fixtureDate || "");
  els.generateKickoffTimeInput.value = String(fixture.kickoffTimeUtc || "");
  els.generateMatchDayInput.value = nextMatchDayValue;
  state.selectedScheduleFixtureId = nextFixtureId;
  state.scheduleCursorFixtureId = nextFixtureId;
  if (shouldResetUatFamilySelection) {
    resetUatComposerSelectionToDefaults();
  }
  const fixtureWeek = parseScheduleWeekValue(fixture.matchDay);
  if (Number.isInteger(fixtureWeek)) {
    state.builderScheduleWeek = fixtureWeek;
    state.builderSchedulePage = 1;
    state.fixturesPageScheduleWeek = fixtureWeek;
  }
  renderCurrentUpcomingFixturesPage();
  renderBuilderFixturePreview(state.upcomingScheduleFixtures);
  persistInputSnapshot();
  if (!preservePage) {
    setGeneratePage("builder");
  }

  if (!silent) {
    showToast("Fixture schedule applied to Event Setup.", "success");
  }

  renderMarketSchemaPanel();
  renderJsonOutputs();
  syncActionState();

  return fixture;
}

function getScheduleFixtureIdentity(fixture) {
  const gameId = String(fixture?.gameId || fixture?.game_id || "").trim();
  if (gameId) {
    return `game:${gameId}`;
  }

  const kickoffIso = String(fixture?.kickoffIso || "").trim();
  const eventName = normalizeForSearch(fixture?.eventName || "");
  if (kickoffIso && eventName) {
    return `fixture:${kickoffIso}:${eventName}`;
  }

  return eventName ? `event:${eventName}` : "";
}

function resolveScheduleFixture(selection, fixtures = []) {
  const raw = String(selection || "").trim();
  if (!raw) {
    return null;
  }

  const byIdentity = fixtures.find((fixture) => getScheduleFixtureIdentity(fixture) === raw);
  if (byIdentity) {
    return byIdentity;
  }

  const normalized = normalizeForSearch(raw);
  if (!normalized) {
    return null;
  }

  const matches = fixtures.filter((fixture) => normalizeForSearch(fixture?.eventName) === normalized);
  if (matches.length === 1) {
    return matches[0];
  }

  return null;
}

function getCurrentSelectedScheduleFixture(fixtures = state.upcomingScheduleFixtures) {
  return resolveScheduleFixture(state.selectedScheduleFixtureId, fixtures);
}

function createScheduleSearchFilters(raw = {}) {
  const source = raw && typeof raw === "object" ? raw : {};
  return {
    team: source.team !== false,
    date: source.date !== false,
    kickoff: source.kickoff !== false,
    matchday: source.matchday !== false,
  };
}

function getScheduleFilterCheckboxes() {
  return [
    els.generateFixtureSearchFilterTeam,
    els.generateFixtureSearchFilterDate,
    els.generateFixtureSearchFilterKickoff,
    els.generateFixtureSearchFilterMatchday,
  ].filter(Boolean);
}

function getActiveScheduleSearchFilterKeys() {
  return Object.entries(state.scheduleSearchFilters)
    .filter(([, enabled]) => Boolean(enabled))
    .map(([key]) => key);
}

function getScheduleSearchPlaceholder() {
  const activeKeys = getActiveScheduleSearchFilterKeys();
  if (activeKeys.length === 0 || activeKeys.length === Object.keys(DEFAULT_SCHEDULE_SEARCH_FILTERS).length) {
    return "Search by team, date, kickoff, or matchday";
  }

  const labels = activeKeys.map((key) => {
    if (key === "team") return "team";
    if (key === "date") return "date";
    if (key === "kickoff") return "kickoff";
    if (key === "matchday") return "matchday";
    return key;
  });
  return `Search by ${labels.join(", ")}`;
}

function renderScheduleSearchControls() {
  const source = getActiveFixtureSource();
  const activeKeys = getActiveScheduleSearchFilterKeys();
  const count = activeKeys.length || Object.keys(DEFAULT_SCHEDULE_SEARCH_FILTERS).length;
  const searchDisabled =
    source?.key !== "live-schedules" ||
    state.isScheduleLoading ||
    state.isCatalogLoading ||
    state.upcomingScheduleFixtures.length === 0;

  if (searchDisabled && state.isScheduleFilterMenuOpen) {
    state.isScheduleFilterMenuOpen = false;
  }

  if (els.generateFixtureSearchInput) {
    els.generateFixtureSearchInput.placeholder = getScheduleSearchPlaceholder();
    els.generateFixtureSearchInput.disabled = searchDisabled;
  }

  if (els.generateFixtureSearchFilterCount) {
    els.generateFixtureSearchFilterCount.textContent = String(count);
  }

  if (els.generateFixtureSearchFiltersBtn) {
    els.generateFixtureSearchFiltersBtn.disabled = searchDisabled;
    els.generateFixtureSearchFiltersBtn.setAttribute("aria-expanded", String(state.isScheduleFilterMenuOpen));
    els.generateFixtureSearchFiltersBtn.title = `Search filters (${count} active)`;
  }

  if (els.generateFixtureSearchFiltersMenu) {
    els.generateFixtureSearchFiltersMenu.hidden = searchDisabled || !state.isScheduleFilterMenuOpen;
  }

  for (const checkbox of getScheduleFilterCheckboxes()) {
    const key = String(checkbox.dataset.filterKey || "").trim();
    checkbox.checked = Boolean(state.scheduleSearchFilters[key]);
    checkbox.disabled = searchDisabled;
  }
}

function setScheduleFilterMenuOpen(isOpen) {
  state.isScheduleFilterMenuOpen = Boolean(isOpen);
  renderScheduleSearchControls();
}

function buildScheduleFixtureSearchSegments(fixture) {
  const metaLine = buildScheduleFixtureMetaLine(fixture);
  const matchDay = Number.isInteger(fixture?.matchDay) ? fixture.matchDay : "";
  return {
    team: `${fixture?.eventName || ""} ${fixture?.optionLabel || ""}`,
    date: `${fixture?.fixtureDate || ""} ${metaLine || ""}`,
    kickoff: `${fixture?.kickoffTimeUtc || ""} ${metaLine || ""}`,
    matchday: `${matchDay ? `matchday ${matchDay}` : ""} ${fixture?.roundLabel || ""}`,
  };
}

function fixtureMatchesScheduleSearch(fixture, filterNeedle) {
  if (!filterNeedle) {
    return true;
  }

  const activeKeys = getActiveScheduleSearchFilterKeys();
  const effectiveKeys = activeKeys.length ? activeKeys : Object.keys(DEFAULT_SCHEDULE_SEARCH_FILTERS);
  const segments = buildScheduleFixtureSearchSegments(fixture);
  return effectiveKeys.some((key) => normalizeForSearch(segments[key] || "").includes(filterNeedle));
}

function handleScheduleSearchFilterChange(event) {
  const checkbox = event.target;
  if (!(checkbox instanceof HTMLInputElement)) {
    return;
  }

  const key = String(checkbox.dataset.filterKey || "").trim();
  if (!key || !(key in DEFAULT_SCHEDULE_SEARCH_FILTERS)) {
    return;
  }

  const nextFilters = {
    ...state.scheduleSearchFilters,
    [key]: checkbox.checked,
  };
  const checkedCount = Object.values(nextFilters).filter(Boolean).length;
  if (checkedCount === 0) {
    checkbox.checked = true;
    return;
  }

  state.scheduleSearchFilters = nextFilters;
  persistInputSnapshot();
  renderScheduleSearchControls();
  renderCurrentUpcomingFixturesPage();
}

function renderBuilderFixturePreview(fixtures = state.upcomingScheduleFixtures) {
  const source = getActiveFixtureSource();
  if (source?.key !== "live-schedules") {
    if (els.generateBuilderWeekSelect) {
      els.generateBuilderWeekSelect.innerHTML = `<option value="">Imported CSV ready soon</option>`;
      els.generateBuilderWeekSelect.value = "";
      els.generateBuilderWeekSelect.disabled = true;
    }
    if (els.generateBuilderFixturePreview) {
      els.generateBuilderFixturePreview.innerHTML =
        `<div class="schedule-browser-empty">Imported CSV mode is ready for the upcoming Lsports DB-export adapter. Once the fixture CSV schema is available, normalized imported fixtures will appear here.</div>`;
    }
    return;
  }

  const allFixtures = Array.isArray(fixtures) ? fixtures : [];
  const weekOptions = getScheduleWeekOptions(allFixtures);
  const activeWeek = resolveActiveScheduleWeek(state.builderScheduleWeek, allFixtures);
  state.builderScheduleWeek = activeWeek;
  const roundOnlyLabel = String(state.upcomingScheduleLabel || "Current round").trim();
  const hasRoundOnlyFixtures = allFixtures.length > 0 && weekOptions.length === 0;

  if (els.generateBuilderWeekSelect) {
    const optionsHtml = weekOptions.length
      ? weekOptions
          .map((option) => `<option value="${escapeHtml(String(option.value))}">${escapeHtml(`${option.label} · ${option.count} fixture${option.count === 1 ? "" : "s"}`)}</option>`)
          .join("")
      : hasRoundOnlyFixtures
        ? `<option value="">${escapeHtml(`${roundOnlyLabel} · ${allFixtures.length} fixture${allFixtures.length === 1 ? "" : "s"}`)}</option>`
      : `<option value="">No upcoming weeks</option>`;
    els.generateBuilderWeekSelect.innerHTML = optionsHtml;
    els.generateBuilderWeekSelect.value = Number.isInteger(activeWeek) ? String(activeWeek) : "";
    els.generateBuilderWeekSelect.disabled = (!weekOptions.length && !hasRoundOnlyFixtures) || state.isScheduleLoading || state.isCatalogLoading;
  }

  if (!els.generateBuilderFixturePreview) {
    return;
  }

  if (!allFixtures.length) {
    const emptyMessage = state.upcomingScheduleLeagueCode
      ? buildNoFixturesBodyMessage(state.upcomingScheduleLeagueCode)
      : "Select a supported league to preview the next 6 upcoming matchweeks.";
    els.generateBuilderFixturePreview.innerHTML = `<div class="schedule-browser-empty">${escapeHtml(emptyMessage)}</div>`;
    return;
  }

  const visibleFixtures = Number.isInteger(activeWeek) ? getFixturesForScheduleWeek(activeWeek, allFixtures) : allFixtures;
  els.generateBuilderFixturePreview.innerHTML = visibleFixtures
    .map((fixture) => {
      const fixtureId = getScheduleFixtureIdentity(fixture);
      const eventName = String(fixture?.eventName || "").trim();
      const gameId = String(fixture?.gameId || fixture?.game_id || "").trim();
      const isSelected = fixtureId && fixtureId === state.selectedScheduleFixtureId;
      const sides = splitScheduleEventName(eventName);
      return (
        `<button type="button" class="builder-fixture-row${isSelected ? " is-selected" : ""}" data-event-name="${escapeHtml(eventName)}" data-fixture-id="${escapeHtml(fixtureId)}">` +
        `<span class="builder-fixture-copy">` +
        renderFixtureTeamsMarkup(sides, { compact: true }) +
        (gameId ? `<span class="schedule-fixture-id builder-fixture-id">Game ID ${escapeHtml(gameId)}</span>` : ``) +
        `<span class="builder-fixture-footer">` +
        `<span class="builder-fixture-meta">${escapeHtml(buildScheduleFixtureMetaLine(fixture))}</span>` +
        `<span class="builder-fixture-cta">${isSelected ? "Applied" : "Apply"}</span>` +
        `</span>` +
        `</span>` +
        `</button>`
      );
    })
    .join("");

  renderUatBuilderSchedulePanel(fixtures);
}

function renderUatBuilderSchedulePanel(fixtures = state.upcomingScheduleFixtures) {
  if (!els.uatBuilderScheduleResults) {
    return;
  }

  const source = getActiveFixtureSource();
  if (source?.key !== "live-schedules") {
    if (els.uatBuilderScheduleState) {
      els.uatBuilderScheduleState.textContent = "Imported CSV";
    }
    els.uatBuilderScheduleResults.innerHTML =
      `<div class="schedule-browser-empty">Imported CSV mode is ready for the upcoming Lsports DB-export adapter.</div>`;
    if (els.uatBuilderSchedulePrevBtn) els.uatBuilderSchedulePrevBtn.disabled = true;
    if (els.uatBuilderScheduleNextBtn) els.uatBuilderScheduleNextBtn.disabled = true;
    if (els.uatBuilderSchedulePageLabel) els.uatBuilderSchedulePageLabel.textContent = "Page 1";
    return;
  }

  const allFixtures = Array.isArray(fixtures) ? fixtures : [];
  if (els.uatBuilderScheduleState) {
    els.uatBuilderScheduleState.textContent = state.isScheduleLoading ? "Loading..." : "Loaded schedule";
  }
  if (!allFixtures.length) {
    const emptyMessage = state.upcomingScheduleLeagueCode
      ? buildNoFixturesBodyMessage(state.upcomingScheduleLeagueCode)
      : "Select a supported league to browse upcoming fixtures.";
    els.uatBuilderScheduleResults.innerHTML = `<div class="schedule-browser-empty">${escapeHtml(emptyMessage)}</div>`;
    if (els.uatBuilderSchedulePrevBtn) els.uatBuilderSchedulePrevBtn.disabled = true;
    if (els.uatBuilderScheduleNextBtn) els.uatBuilderScheduleNextBtn.disabled = true;
    if (els.uatBuilderSchedulePageLabel) els.uatBuilderSchedulePageLabel.textContent = "Page 1";
    return;
  }

  const activeWeek = resolveActiveScheduleWeek(state.builderScheduleWeek, allFixtures);
  const visibleFixtures = Number.isInteger(activeWeek) ? getFixturesForScheduleWeek(activeWeek, allFixtures) : allFixtures;
  const pageSize = 10;
  const totalPages = Math.max(1, Math.ceil(visibleFixtures.length / pageSize));
  state.builderSchedulePage = Math.min(Math.max(1, Number(state.builderSchedulePage || 1)), totalPages);
  const pageStart = (state.builderSchedulePage - 1) * pageSize;
  const pageFixtures = visibleFixtures.slice(pageStart, pageStart + pageSize);

  els.uatBuilderScheduleResults.innerHTML = pageFixtures
    .map((fixture) => {
      const fixtureId = getScheduleFixtureIdentity(fixture);
      const eventName = String(fixture?.eventName || "").trim();
      const gameId = String(fixture?.gameId || fixture?.game_id || "").trim();
      const isSelected = fixtureId && fixtureId === state.selectedScheduleFixtureId;
      const sides = splitScheduleEventName(eventName);
      return (
        `<button type="button" class="builder-fixture-row${isSelected ? " is-selected" : ""}" data-event-name="${escapeHtml(eventName)}" data-fixture-id="${escapeHtml(fixtureId)}">` +
        `<span class="builder-fixture-copy">` +
        renderFixtureTeamsMarkup(sides, { compact: true }) +
        (gameId ? `<span class="schedule-fixture-id builder-fixture-id">Game ID ${escapeHtml(gameId)}</span>` : ``) +
        `<span class="builder-fixture-footer">` +
        `<span class="builder-fixture-meta">${escapeHtml(buildScheduleFixtureMetaLine(fixture))}</span>` +
        `<span class="builder-fixture-cta">${isSelected ? "Applied" : "Apply"}</span>` +
        `</span>` +
        `</span>` +
        `</button>`
      );
    })
    .join("");

  if (els.uatBuilderSchedulePrevBtn) {
    els.uatBuilderSchedulePrevBtn.disabled = state.builderSchedulePage <= 1;
  }
  if (els.uatBuilderScheduleNextBtn) {
    els.uatBuilderScheduleNextBtn.disabled = state.builderSchedulePage >= totalPages;
  }
  if (els.uatBuilderSchedulePageLabel) {
    els.uatBuilderSchedulePageLabel.textContent = `Page ${state.builderSchedulePage} of ${totalPages}`;
  }
}

function renderUatDbReadPanel() {
  if (!els.uatDbReadSummary || !els.uatDbReadDetails) {
    return;
  }

  const fixture = getCurrentSelectedScheduleFixture();
  const typeReferenceId = String(els.generateTypeRefInput?.value || "").trim();
  if (!fixture) {
    els.uatDbReadSummary.textContent = "No fixture selected.";
    els.uatDbReadDetails.textContent = "Pick a schedule-backed fixture to inspect existing fixture and market rows.";
    return;
  }

  const fixtureName = String(fixture.eventName || "").trim() || "Selected fixture";
  const gameId = String(fixture.gameId || fixture.game_id || "").trim();
  els.uatDbReadSummary.textContent = fixtureName;
  const details = [
    buildScheduleFixtureMetaLine(fixture),
    gameId ? `Game ID ${gameId}` : "",
    typeReferenceId ? `Type reference ID ${typeReferenceId}` : "Add a type reference ID to inspect linked parent-market rows.",
  ].filter(Boolean);
  els.uatDbReadDetails.textContent = details.join(" · ");
}

function splitScheduleEventName(eventName) {
  const value = String(eventName || "").trim();
  if (!value) {
    return { home: "", away: "", full: "" };
  }
  const parts = value.split(/\s+vs\s+/i);
  if (parts.length >= 2) {
    return {
      home: parts[0].trim(),
      away: parts.slice(1).join(" vs ").trim(),
      full: value,
    };
  }
  return { home: value, away: "", full: value };
}

function renderFixtureTeamsMarkup(sides, { compact = false } = {}) {
  const home = String(sides?.home || "").trim();
  const away = String(sides?.away || "").trim();
  const full = String(sides?.full || home || "").trim();
  if (!away) {
    return (
      `<span class="fixture-card-teams${compact ? " is-compact" : ""}">` +
      `<span class="fixture-card-team fixture-card-team--home">${escapeHtml(full)}</span>` +
      `</span>`
    );
  }
    return (
      `<span class="fixture-card-teams${compact ? " is-compact" : ""}">` +
      `<span class="fixture-card-team fixture-card-team--home">${escapeHtml(home)}</span>` +
      `<span class="fixture-card-vs"> vs </span>` +
      `<span class="fixture-card-team fixture-card-team--away">${escapeHtml(away)}</span>` +
      `</span>`
    );
  }

function groupFixturesByScheduleWeek(fixtures = []) {
  const groups = new Map();
  for (const fixture of fixtures || []) {
    const week = parseScheduleWeekValue(fixture?.matchDay);
    const key = Number.isInteger(week) ? `matchday:${week}` : `round:${String(fixture?.roundLabel || fixture?.fixtureDate || "upcoming")}`;
    const title = Number.isInteger(week)
      ? `Matchday ${week}`
      : String(fixture?.roundLabel || fixture?.fixtureDate || "Upcoming fixtures");
    if (!groups.has(key)) {
      groups.set(key, {
        key,
        title,
        week,
        fixtures: [],
      });
    }
    groups.get(key).fixtures.push(fixture);
  }
  return Array.from(groups.values()).sort((a, b) => {
    const weekA = Number.isInteger(a.week) ? a.week : Number.MAX_SAFE_INTEGER;
    const weekB = Number.isInteger(b.week) ? b.week : Number.MAX_SAFE_INTEGER;
    if (weekA !== weekB) {
      return weekA - weekB;
    }
    return a.title.localeCompare(b.title);
  });
}

function buildNoFixturesStatusMessage(leagueCode) {
  const code = String(leagueCode || "").trim().toLowerCase();
  if (code === "ucl") {
    return "UCL has no upcoming fixtures from SportsData right now.";
  }
  if (code) {
    return `No upcoming ${getScheduleLeagueLabel(code)} fixtures are available from SportsData right now.`;
  }
  return "No upcoming fixtures are available from SportsData right now.";
}

function buildNoFixturesBodyMessage(leagueCode) {
  const code = String(leagueCode || "").trim().toLowerCase();
  if (code === "ucl") {
    return "UCL has no upcoming fixtures from SportsData right now. Try Refetch Fixtures later.";
  }
  if (code) {
    return `No upcoming ${getScheduleLeagueLabel(code)} fixtures are available from SportsData right now. Try Refetch Fixtures later.`;
  }
  return "No upcoming fixtures are available from SportsData right now.";
}

function renderScheduleLeagueTabs() {
  if (!els.generateFixtureLeagueTabs) {
    return;
  }

  if (!isLiveFixtureSourceActive()) {
    els.generateFixtureLeagueTabs.innerHTML = "";
    return;
  }

  const supportedLeagues = getScheduleLeagueViewModels();
  const activeScheduleLeagueCode = getActiveScheduleLeagueCode();
  const hasActiveLeague = supportedLeagues.some(
    (league) => activeScheduleLeagueCode === String(league.scheduleCode || "").trim().toLowerCase()
  );
  els.generateFixtureLeagueTabs.innerHTML = supportedLeagues
    .map((league, index) => {
      const isActive = activeScheduleLeagueCode === String(league.scheduleCode || "").trim().toLowerCase();
      const display = getScheduleLeagueDisplay(league, { isActive });
      const iconMarkup = display.iconUrl
        ? `<img class="league-nav-tab__icon-image" src="${escapeHtml(display.iconUrl)}" alt="" loading="lazy" decoding="async" />`
        : escapeHtml(display.icon);
      const title = league.isConfiguredInCatalog
        ? `Browse ${display.label} fixtures`
        : `Browse ${display.label} fixtures. Catalog-backed generation becomes available once the league CSV rows are loaded.`;
      const isFocusable = isActive || (!hasActiveLeague && index === 0);
      return (
        `<button type="button" class="league-nav-tab${isActive ? " is-active" : ""}" title="${escapeHtmlAttribute(title)}" ` +
        `data-league-id="${escapeHtml(String(league.id))}" data-schedule-code="${escapeHtml(String(league.scheduleCode || ""))}" ` +
        `role="radio" aria-checked="${isActive ? "true" : "false"}" tabindex="${isFocusable ? "0" : "-1"}">` +
        `<span class="league-nav-tab__icon" aria-hidden="true">${iconMarkup}</span>` +
        `<span class="league-nav-tab__label">${escapeHtml(display.label)}</span>` +
        `</button>`
      );
    })
    .join("");
}

function renderFixtureWeekTabs(fixtures, selectedWeek) {
  if (!els.generateFixtureWeekTabs) {
    return null;
  }

  const weekOptions = getScheduleWeekOptions(fixtures);
  if (!weekOptions.length) {
    state.fixturesPageScheduleWeek = null;
    els.generateFixtureWeekTabs.innerHTML = "";
    els.generateFixtureWeekTabs.hidden = true;
    return null;
  }

  const activeWeek = resolveActiveScheduleWeek(selectedWeek, fixtures);
  state.fixturesPageScheduleWeek = activeWeek;
  els.generateFixtureWeekTabs.innerHTML = weekOptions
    .map((option) => {
      const isActive = option.value === activeWeek;
      const title = `${option.label} · ${option.count} fixture${option.count === 1 ? "" : "s"}`;
      return (
        `<button type="button" class="fixtures-week-pill${isActive ? " is-active" : ""}" title="${escapeHtmlAttribute(title)}" ` +
        `data-week="${escapeHtml(String(option.value))}" role="radio" aria-checked="${isActive ? "true" : "false"}" tabindex="${isActive ? "0" : "-1"}">` +
        `${escapeHtml(option.label)}` +
        `</button>`
      );
    })
    .join("");
  els.generateFixtureWeekTabs.hidden = weekOptions.length <= 1;
  return activeWeek;
}

function renderUpcomingFixturesPage(fixtures, { selectedWeek = null, selectedLabel = "", leagueCode = "" } = {}) {
  const source = getActiveFixtureSource();
  if (source?.key !== "live-schedules") {
    if (els.generateFixturesSourcePlaceholder) {
      els.generateFixturesSourcePlaceholder.hidden = false;
      els.generateFixturesSourcePlaceholder.innerHTML =
        `<div class="schedule-browser-empty">Imported CSV mode will become the Lsports workspace. We have the source lane ready; once you provide the DB-export CSV shape, this view will group imported fixtures here using the same composer flow.</div>`;
    }
    els.generateFixtureSummary.textContent = "Imported CSV workspace is standing by for normalized fixture imports.";
    els.generateFixtureResults.innerHTML = "";
    if (els.generateFixtureWeekTabs) {
      els.generateFixtureWeekTabs.innerHTML = "";
      els.generateFixtureWeekTabs.hidden = true;
    }
    renderScheduleActiveSummary(null, { leagueCode: "" });
    return;
  }

  if (els.generateFixturesSourcePlaceholder) {
    els.generateFixturesSourcePlaceholder.hidden = true;
    els.generateFixturesSourcePlaceholder.innerHTML = "";
  }

  const allFixtures = Array.isArray(fixtures) ? fixtures : [];
  const weekOptions = getScheduleWeekOptions(allFixtures);
  const activeWeek = renderFixtureWeekTabs(allFixtures, selectedWeek);
  const filter = normalizeForSearch(els.generateFixtureSearchInput.value || "");
  const filteredFixtures = !filter ? allFixtures : allFixtures.filter((fixture) => fixtureMatchesScheduleSearch(fixture, filter));
  const visibleFixtures = Number.isInteger(activeWeek)
    ? filteredFixtures.filter((fixture) => parseScheduleWeekValue(fixture?.matchDay) === activeWeek)
    : filteredFixtures;
  const groupedFixtures = groupFixturesByScheduleWeek(visibleFixtures);
  const selectedFixture = getCurrentSelectedScheduleFixture(allFixtures);

  const summaryParts = [];
  if (leagueCode) {
    summaryParts.push(getScheduleLeagueLabel(leagueCode));
  }
  if (Number.isInteger(activeWeek)) {
    summaryParts.push(`Matchday ${activeWeek}`);
  } else if (selectedLabel) {
    summaryParts.push(selectedLabel);
  }
  if (allFixtures.length > 0) {
    summaryParts.push(`${allFixtures.length} fixture${allFixtures.length === 1 ? "" : "s"} loaded`);
  } else {
    summaryParts.push("No upcoming fixtures right now");
  }
  if (weekOptions.length > 1) {
    summaryParts.push(`${weekOptions.length} matchweeks loaded`);
  }
  if (filter || Number.isInteger(activeWeek)) {
    summaryParts.push(`${visibleFixtures.length} match${visibleFixtures.length === 1 ? "" : "es"} shown`);
  }
  els.generateFixtureSummary.textContent = summaryParts.join(" · ");
  syncScheduleCursor(visibleFixtures, selectedFixture);
  renderScheduleActiveSummary(selectedFixture, { leagueCode, selectedLabel });

  if (!allFixtures.length) {
    els.generateFixtureResults.innerHTML = `<div class="schedule-browser-empty">${escapeHtml(buildNoFixturesBodyMessage(leagueCode))}</div>`;
    return;
  }

  if (!visibleFixtures.length) {
    els.generateFixtureResults.innerHTML = `<div class="schedule-browser-empty">No fixtures match the current filter.</div>`;
    return;
  }

  els.generateFixtureResults.innerHTML = groupedFixtures
    .map((group) => {
      const groupCards = group.fixtures
        .map((fixture) => {
      const eventName = String(fixture?.eventName || "").trim();
      const gameId = String(fixture?.gameId || fixture?.game_id || "").trim();
      const fixtureId = getScheduleFixtureIdentity(fixture);
      const isSelected = fixtureId && fixtureId === state.selectedScheduleFixtureId;
      const isCursor = fixtureId && fixtureId === state.scheduleCursorFixtureId;
      const metaLine = buildScheduleFixtureMetaLine(fixture);
      const optionId = `schedule-option-${escapeHtmlAttribute(fixtureId || normalizeForSearch(eventName).replace(/[^a-z0-9]+/g, "-"))}`;
      const sides = splitScheduleEventName(eventName);
      return (
        `<button type="button" id="${escapeHtml(optionId)}" class="schedule-fixture-btn${isSelected ? " is-selected" : ""}${isCursor ? " is-cursor" : ""}" ` +
        `data-event-name="${escapeHtml(eventName)}" data-fixture-id="${escapeHtml(fixtureId)}" data-game-id="${escapeHtml(gameId)}">` +
        `<span class="schedule-fixture-copy">` +
        `<span class="schedule-fixture-topline">` +
        `<span class="schedule-fixture-week">Matchday ${escapeHtml(String(parseScheduleWeekValue(fixture?.matchDay) ?? fixture?.matchDay ?? ""))}</span>` +
        (gameId ? `<span class="schedule-fixture-id">Game ID ${escapeHtml(gameId)}</span>` : ``) +
        `</span>` +
        renderFixtureTeamsMarkup(sides) +
        `<span class="schedule-fixture-meta">${escapeHtml(metaLine)}</span>` +
        `</span>` +
        `<span class="schedule-fixture-cta">${isSelected ? "Applied" : "Apply"}</span>` +
        `</button>`
      );
        })
        .join("");
      return (
        `<section class="fixtures-week-group" aria-label="${escapeHtml(group.title)}">` +
        `<div class="fixtures-week-group__head">` +
        `<h4 class="fixtures-week-group__title">${escapeHtml(group.title)}</h4>` +
        `<span class="fixtures-week-group__count">${escapeHtml(`${group.fixtures.length} fixture${group.fixtures.length === 1 ? "" : "s"}`)}</span>` +
        `</div>` +
        `<div class="fixtures-week-group__grid">${groupCards}</div>` +
        `</section>`
      );
    })
    .join("");

}

function syncScheduleCursor(fixtures, selectedFixture = null) {
  const list = Array.isArray(fixtures) ? fixtures : [];
  if (list.length === 0) {
    state.scheduleCursorFixtureId = "";
    return;
  }

  const currentCursor = String(state.scheduleCursorFixtureId || "").trim();
  if (currentCursor && list.some((fixture) => getScheduleFixtureIdentity(fixture) === currentCursor)) {
    return;
  }

  state.scheduleCursorFixtureId = getScheduleFixtureIdentity(selectedFixture) || getScheduleFixtureIdentity(list[0]) || "";
}

function renderScheduleActiveSummary(fixture, { leagueCode = "", selectedLabel = "" } = {}) {
  if (!fixture) {
    els.generateFixtureActiveTitle.textContent = "";
    els.generateFixtureActiveMeta.textContent = "";
    els.generateFixtureActiveState.textContent = "";
    els.generateFixtureActiveState.className = "schedule-active-state";
    els.generateFixtureActiveSummary.classList.add("is-empty");
    renderGenerateReadiness();
    return;
  }

  const metaParts = [];
  if (leagueCode) {
    metaParts.push(getScheduleLeagueLabel(leagueCode));
  }
  if (Number.isInteger(fixture.matchDay)) {
    metaParts.push(`Matchday ${fixture.matchDay}`);
  } else if (selectedLabel) {
    metaParts.push(selectedLabel);
  }
  metaParts.push(`${fixture.fixtureDate} · ${fixture.kickoffTimeUtc} UTC`);

  els.generateFixtureActiveTitle.textContent = String(fixture.eventName || "");
  els.generateFixtureActiveMeta.textContent = metaParts.join(" · ");
  els.generateFixtureActiveState.textContent = "Applied to Event Setup";
  els.generateFixtureActiveState.className = "schedule-active-state is-applied";
  els.generateFixtureActiveSummary.classList.remove("is-empty");
  renderGenerateReadiness();
}

function syncScheduleActiveSelection() {
  renderCurrentUpcomingFixturesPage();
  renderBuilderFixturePreview(state.upcomingScheduleFixtures);
}

function handleScheduleBrowserKeydown(event) {
  const focusedButton = event.target instanceof Element
    ? event.target.closest(".schedule-fixture-btn")
    : null;
  const focusedFixtureId = String(focusedButton?.getAttribute("data-fixture-id") || "").trim();
  const fixtures = getVisibleScheduleFixtures();
  if (!fixtures.length) {
    return;
  }

  if (event.key === "ArrowDown" || event.key === "ArrowUp" || event.key === "Home" || event.key === "End") {
    event.preventDefault();
    moveScheduleCursor(event.key, fixtures, focusedFixtureId);
    return;
  }

  if (event.key === "Enter") {
    const fixtureIdToApply = focusedFixtureId || String(state.scheduleCursorFixtureId || "").trim();
    if (!fixtureIdToApply) {
      return;
    }
    event.preventDefault();
    state.scheduleCursorFixtureId = fixtureIdToApply;
    applySelectedScheduleFixture(fixtureIdToApply);
  }
}

function getVisibleScheduleFixtures() {
  const allFixtures = Array.isArray(state.upcomingScheduleFixtures) ? state.upcomingScheduleFixtures : [];
  const selectedWeek = resolveActiveScheduleWeek(state.fixturesPageScheduleWeek, allFixtures);
  const weekFixtures = Number.isInteger(selectedWeek) ? getFixturesForScheduleWeek(selectedWeek, allFixtures) : allFixtures;
  const filter = normalizeForSearch(els.generateFixtureSearchInput.value || "");
  if (!filter) {
    return weekFixtures;
  }
  return weekFixtures.filter((fixture) => fixtureMatchesScheduleSearch(fixture, filter));
}

function moveScheduleCursor(key, fixtures, focusedFixtureId = "") {
  const list = Array.isArray(fixtures) ? fixtures : [];
  if (!list.length) {
    return;
  }

  const currentFixtureId = String(focusedFixtureId || state.scheduleCursorFixtureId || "").trim();
  const currentIndex = list.findIndex((fixture) => getScheduleFixtureIdentity(fixture) === currentFixtureId);
  let nextIndex = currentIndex >= 0 ? currentIndex : 0;

  if (key === "ArrowDown") {
    nextIndex = Math.min(list.length - 1, nextIndex + 1);
  } else if (key === "ArrowUp") {
    nextIndex = Math.max(0, nextIndex - 1);
  } else if (key === "Home") {
    nextIndex = 0;
  } else if (key === "End") {
    nextIndex = list.length - 1;
  }

  state.scheduleCursorFixtureId = getScheduleFixtureIdentity(list[nextIndex]) || "";
  renderCurrentUpcomingFixturesPage();
  focusScheduleCursorButton();
}

function focusScheduleCursorButton() {
  const cursorFixtureId = String(state.scheduleCursorFixtureId || "").trim();
  if (!cursorFixtureId) {
    return;
  }

  const buttons = Array.from(els.generateFixtureResults.querySelectorAll(".schedule-fixture-btn"));
  const button = buttons.find((candidate) => String(candidate.getAttribute("data-fixture-id") || "") === cursorFixtureId);
  if (button && typeof button.focus === "function") {
    button.focus({ preventScroll: true });
  }
  if (button && typeof button.scrollIntoView === "function") {
    button.scrollIntoView({ block: "nearest" });
  }
}

function buildScheduleFixtureMetaLine(fixture) {
  const kickoff = String(fixture?.kickoffIso || "").trim();
  if (!kickoff) {
    return String(fixture?.roundLabel || (fixture?.matchDay ? `Matchday ${fixture.matchDay}` : "")).trim();
  }

  const parsed = new Date(kickoff);
  if (Number.isNaN(parsed.getTime())) {
    const roundSuffix = fixture?.matchDay ? `Matchday ${fixture.matchDay}` : String(fixture?.roundLabel || "");
    return `${String(fixture?.fixtureDate || "")} · ${String(fixture?.kickoffTimeUtc || "")} UTC · ${roundSuffix}`.trim();
  }

  const weekday = parsed.toLocaleDateString("en-US", { weekday: "short", timeZone: "UTC" });
  const month = parsed.toLocaleDateString("en-US", { month: "short", timeZone: "UTC" });
  const day = parsed.toLocaleDateString("en-US", { day: "numeric", timeZone: "UTC" });
  const hh = String(parsed.getUTCHours()).padStart(2, "0");
  const mm = String(parsed.getUTCMinutes()).padStart(2, "0");
  const roundSuffix = fixture?.matchDay ? `Matchday ${fixture.matchDay}` : String(fixture?.roundLabel || "");
  return `${weekday}, ${month} ${day} · ${hh}:${mm} UTC · ${roundSuffix}`.trim();
}

async function handleVerify(mode, { background = false } = {}) {
  if (state.isCatalogLoading || state.isVerifying || state.isGenerating) {
    return;
  }

  if (!background) {
    clearAutoVerifySchedule();
  }

  state.isVerifying = true;
  syncActionState();
  setOverviewCard("verify", {
    value: "Checking",
    note: background ? "Background verification is running" : "Verifying current JSON inputs",
    tone: "working",
  });
  if (!background) {
    setButtonBusy(els.verifyBothBtn, true, "Verifying...");
  }

  try {
    const referenceNow = getReferenceNowDate();
    if (!state.catalogLoaded) {
      const payload = {
        summary: "Verification blocked.",
        tone: "error",
        sections: [{ title: "Errors", items: ["CSV catalog is not loaded. Reload CSV Catalog first."] }],
        counts: {
          errors: 1,
          warnings: 0,
          info: 0,
        },
      };
      renderVerifyOutput(payload);
      state.lastVerifyReportText = buildPlainResultReport(payload.summary, payload.sections);
      return;
    }

    const fixtureParse = mode === "parent"
      ? { value: null, errors: [] }
      : parseJsonInput(els.fixtureInputJson.value, "Fixture JSON");
    const parentParse = mode === "fixture"
      ? { value: null, errors: [] }
      : parseJsonInput(els.parentInputJson.value, "Parent Market JSON");

    const parseErrors = [...fixtureParse.errors, ...parentParse.errors];
    if (parseErrors.length > 0) {
      const payload = {
        summary: "Verification failed before checks.",
        tone: "error",
        sections: [{ title: "Errors", items: parseErrors }],
        counts: {
          errors: parseErrors.length,
          warnings: 0,
          info: 0,
        },
      };
      renderVerifyOutput(payload);
      state.lastVerifyReportText = buildPlainResultReport(payload.summary, payload.sections);
      return;
    }

    let fixtureResult = null;
    let parentResult = null;
    let bundleResult = null;
    const selectedScheduleFixture = getCurrentSelectedScheduleFixture();

    if (mode === "fixture" || mode === "both") {
      fixtureResult = verifyFixtureJsonStrict(fixtureParse.value, {
        leagues: state.leagues,
        teams: state.teams,
      }, {
        selectedScheduleFixture,
      });
    }

    if (mode === "parent" || mode === "both") {
      parentResult = verifyParentMarketJsonStrict(
        parentParse.value,
        {
          leagues: state.leagues,
          teams: state.teams,
        },
        {
          fixture: fixtureParse.value,
          fixtureResolved: fixtureResult,
          now: referenceNow,
          selectedScheduleFixture,
        }
      );
    }

    if (mode === "both") {
      bundleResult = verifyBundleConsistency(fixtureParse.value, parentParse.value, {
        leagues: state.leagues,
        teams: state.teams,
      }, {
        now: referenceNow,
        selectedScheduleFixture,
      });
    }

    const errors = [
      ...(fixtureResult?.errors || []),
      ...(parentResult?.errors || []),
      ...(bundleResult?.errors || []),
    ];
    const warnings = [
      ...(fixtureResult?.warnings || []),
      ...(parentResult?.warnings || []),
      ...(bundleResult?.warnings || []),
    ];
    const info = [
      ...(fixtureResult?.info || []),
      ...(parentResult?.info || []),
      ...(bundleResult?.info || []),
    ];

    const uniqueErrors = uniqueItems(errors);
    const uniqueWarnings = uniqueItems(warnings);
    const uniqueInfo = uniqueItems(info);
    if (referenceNow) {
      uniqueInfo.push(`Deterministic reference UTC time: ${referenceNow.toISOString()}.`);
    }
    const finalInfo = uniqueItems(uniqueInfo);

    const ok = uniqueErrors.length === 0;
    const summary = ok
      ? "Verification passed with strict CSV checks."
      : `Verification found ${uniqueErrors.length} error(s).`;

    const sections = [];
    if (uniqueErrors.length > 0) {
      sections.push({ title: "Errors", items: uniqueErrors });
    }
    if (uniqueWarnings.length > 0) {
      sections.push({ title: "Warnings", items: uniqueWarnings });
    }
    if (finalInfo.length > 0) {
      sections.push({ title: "Info", items: finalInfo });
    }

    const payload = {
      summary,
      tone: ok ? (uniqueWarnings.length > 0 ? "warn" : "success") : "error",
      sections,
      counts: {
        errors: uniqueErrors.length,
        warnings: uniqueWarnings.length,
        info: finalInfo.length,
      },
    };
    renderVerifyOutput(payload);
    state.lastVerifyReportText = buildPlainResultReport(payload.summary, payload.sections);

    uiLog.info("verify.complete", {
      mode,
      background,
      ok,
      errors: uniqueErrors.length,
      warnings: uniqueWarnings.length,
    });
  } finally {
    state.isVerifying = false;
    if (!background) {
      setButtonBusy(els.verifyBothBtn, false, "Verify Both");
    }
    syncActionState();
  }
}

async function handleGenerate({ preserveGeneratePage = state.currentGeneratePage === "fixtures" } = {}) {
  if (state.isCatalogLoading || state.isVerifying || state.isGenerating) {
    return;
  }

  applySelectedScheduleFixture(els.generateEventNameInput.value, {
    fromManualEntry: true,
    silent: true,
    preservePage: preserveGeneratePage,
  });

  state.isGenerating = true;
  syncActionState();
  setOverviewCard("generate", {
    value: "Generating",
    note: isUatRuntimeActive() ? "Building UAT fixture + family payloads" : "Building fixture + parent market JSON",
    tone: "working",
  });
  setButtonBusy(els.generateBtn, true, "Generating...");

  try {
    const referenceNow = getReferenceNowDate();
    if (!state.catalogLoaded) {
      renderGenerationStatus({
        summary: "Generation blocked.",
        tone: "error",
        sections: [{ title: "Errors", items: ["CSV catalog is not loaded. Reload CSV Catalog first."] }],
        counts: {
          errors: 1,
          warnings: 0,
          info: 0,
        },
      });
      return;
    }

    const result = generateFromEventInput(
      {
        eventName: els.generateEventNameInput.value,
        leagueSelection: els.generateLeagueSelect.value,
        typeReferenceId: els.generateTypeRefInput.value,
        fixtureDate: els.generateFixtureDateInput.value,
        kickoffTimeUtc: els.generateKickoffTimeInput.value,
        matchDay: els.generateMatchDayInput.value,
        matchWeek: els.generateMatchWeekInput.value,
        location: els.generateLocationInput.value,
        venue: els.generateVenueInput.value,
        uatMarketLine: state.selectedUatMarketLine,
        uatSpreadTeamSide: state.selectedUatSpreadTeamSide,
        now: referenceNow,
        outputProfile: state.runtimeAppEnv,
        selectedScheduleFixture: getCurrentSelectedScheduleFixture(),
      },
      {
        leagues: state.leagues,
        teams: state.teams,
      }
    );

    const sections = [];
    if (result.errors.length > 0) {
      sections.push({ title: "Errors", items: result.errors });
    }
    if (result.warnings.length > 0) {
      sections.push({ title: "Warnings", items: result.warnings });
    }
    if (result.info.length > 0) {
      sections.push({ title: "Info", items: result.info });
    }

    renderGenerationStatus({
      summary: result.ok
        ? (
            isUatRuntimeActive()
              ? "Generation completed. UAT outputs are ready for panel-level validation."
              : "Generation completed and strict verification passed."
          )
        : `Generation failed with ${result.errors.length} error(s).`,
      tone: result.ok ? (result.warnings.length > 0 ? "warn" : "success") : "error",
      sections,
      counts: {
        errors: result.errors.length,
        warnings: result.warnings.length,
        info: result.info.length,
      },
    });

    state.lastGenerationResult = result;
    state.outputValidation = deriveAutoOutputValidation(result);
    renderJsonOutputs(result);

    if (!isUatRuntimeActive() && result.ok && result.fixtureJson && result.parentPayload) {
      els.fixtureInputJson.value = JSON.stringify(result.fixtureJson, null, 2);
      els.parentInputJson.value = JSON.stringify(result.parentPayload, null, 2);
      state.persistFixtureInput = false;
      state.persistParentInput = false;
      updateJsonMeta("fixture");
      updateJsonMeta("parent");
      persistInputSnapshot();
      scheduleAutoVerify({ immediate: true });
    } else if (isUatRuntimeActive() && result.ok && result.fixtureJson) {
      state.persistFixtureInput = true;
      state.persistParentInput = true;
      persistInputSnapshot();
    }

    uiLog.info("generate.complete", {
      ok: result.ok,
      errors: result.errors.length,
      warnings: result.warnings.length,
    });
  } finally {
    state.isGenerating = false;
    setButtonBusy(els.generateBtn, false, "Generate Outputs");
    syncActionState();
  }
}

function renderVerifyOutput({ summary, tone, sections, counts }) {
  const panelClass = resultToneClass(tone);
  els.verifyOutput.className = `result-panel ${panelClass}`.trim();
  els.verifyOutput.innerHTML = buildResultHtml(summary, sections, counts);
  setOverviewCard("verify", deriveOverviewState(summary, tone, counts, {
    idleValue: "Idle",
    workingValue: "Checking",
  }));
}

function renderGenerationStatus({ summary, tone, sections, counts }) {
  const panelClass = resultToneClass(tone);
  els.generationStatus.className = `result-panel ${panelClass}`.trim();
  els.generationStatus.innerHTML = buildResultHtml(summary, sections, counts);
  setOverviewCard("generate", deriveOverviewState(summary, tone, counts, {
    idleValue: "Ready",
    workingValue: "Generating",
  }));
}

function buildResultHtml(summary, sections, counts) {
  const panelId = ++resultPanelRenderId;
  const normalizedSections = Array.isArray(sections) ? sections : [];
  const groupedSections = new Map(
    normalizedSections
      .filter((section) => Array.isArray(section.items) && section.items.length > 0)
      .map((section) => [String(section.title || "Details").toLowerCase(), section])
  );
  const out = [`<p class="result-summary"><strong>${escapeHtml(summary)}</strong></p>`];

  if (counts) {
    const chipSpecs = [
      {
        key: "errors",
        title: "Errors",
        className: "chip-error",
        count: Number(counts.errors || 0),
      },
      {
        key: "warnings",
        title: "Warnings",
        className: "chip-warn",
        count: Number(counts.warnings || 0),
      },
      {
        key: "info",
        title: "Info",
        className: "chip-info",
        count: Number(counts.info || 0),
      },
    ];

    out.push(
      `<div class="summary-chips" role="group" aria-label="Result details">` +
        chipSpecs
          .map((chip) => {
            const sectionId = `result-panel-${panelId}-${chip.key}`;
            const hasItems = groupedSections.has(chip.key);
            return (
              `<button ` +
                `type="button" ` +
                `class="chip result-chip-toggle ${chip.className}" ` +
                `aria-expanded="false" ` +
                `aria-controls="${sectionId}" ` +
                `${hasItems ? "" : "disabled"}>` +
                `${escapeHtml(chip.title)}: ${chip.count}` +
              `</button>`
            );
          })
          .join("") +
      `</div>`
    );
  }

  const detailBlocks = [];

  for (const section of normalizedSections) {
    if (!Array.isArray(section.items) || section.items.length === 0) {
      continue;
    }

    const title = String(section.title || "Details");
    const sectionKey = title.toLowerCase();
    const sectionId = `result-panel-${panelId}-${sectionKey}`;
    detailBlocks.push(`<section id="${sectionId}" class="result-section" hidden>`);
    detailBlocks.push(`<h4>${escapeHtml(title)}</h4>`);
    detailBlocks.push("<ul>");
    for (const item of section.items) {
      detailBlocks.push(`<li>${escapeHtml(String(item || ""))}</li>`);
    }
    detailBlocks.push("</ul>");
    detailBlocks.push("</section>");
  }

  if (detailBlocks.length > 0) {
    out.push(`<div class="result-sections">${detailBlocks.join("\n")}</div>`);
  }

  return out.join("\n");
}

function getOutputPanelElements(outputKey) {
  switch (outputKey) {
    case "fixture":
      return {
        panel: els.generatedFixturePanel,
        title: els.generatedFixtureTitle,
        output: els.generatedFixtureOutput,
        stateBadge: els.generatedFixtureState,
        validationBadge: els.generatedFixtureValidationState,
      };
    case "parent":
      return {
        panel: els.generatedParentPanel,
        title: els.generatedParentTitle,
        output: els.generatedParentOutput,
        stateBadge: els.generatedParentState,
        validationBadge: els.generatedParentValidationState,
      };
    case "uatFamily":
      return {
        panel: els.generatedUatFamilyPanel,
        title: els.generatedUatFamilyTitle,
        output: els.generatedUatFamilyOutput,
        stateBadge: els.generatedUatFamilyState,
        validationBadge: els.generatedUatFamilyValidationState,
      };
    case "typeReferences":
      return {
        panel: els.generatedTypeReferencesPanel,
        title: els.generatedTypeReferencesTitle,
        output: els.generatedTypeReferencesOutput,
        stateBadge: els.generatedTypeReferencesState,
        validationBadge: els.generatedTypeReferencesValidationState,
      };
    default:
      return {
        panel: null,
        title: null,
        output: null,
        stateBadge: null,
        validationBadge: null,
      };
  }
}

function getCurrentOutputPayload(outputKey, generationResult = state.lastGenerationResult) {
  if (!generationResult || typeof generationResult !== "object") {
    return null;
  }

  if (outputKey === "fixture") {
    return generationResult.fixtureJson || null;
  }
  if (outputKey === "parent") {
    return generationResult.parentPayload || null;
  }
  if (outputKey === "uatFamily") {
    const family = getUatMarketFamilyDefinition(state.selectedUatMarketFamily);
    if (isSelectionSpecificUatFamilyOutputStale(generationResult)) {
      return null;
    }
    return generationResult.uatParentPayloads?.[family.key] || null;
  }
  if (outputKey === "typeReferences") {
    return generationResult.typeReferencePayloads || null;
  }
  return null;
}

function renderJsonOutputs(generationResult = state.lastGenerationResult) {
  state.lastGenerationResult = generationResult || null;

  const runtimeCode = normalizeRuntimeAppEnvCode(state.runtimeAppEnv || "mainnet");
  const family = getUatMarketFamilyDefinition(state.selectedUatMarketFamily);
  const selectedLine = getSelectedUatMarketLine();
  const hasTypeReferenceId = Boolean(String(els.generateTypeRefInput?.value || "").trim());
  const lineSpecificFamilyOutputStale = isSelectionSpecificUatFamilyOutputStale(generationResult);

  renderOutputPanel("fixture", {
    visible: true,
    title: runtimeCode === "uat" ? "Fixture JSON · UAT" : "Fixture JSON",
    payload: getCurrentOutputPayload("fixture", generationResult),
    emptyMessage: runtimeCode === "uat"
      ? "Generated UAT fixture JSON appears here after a successful run."
      : "Generated fixture JSON appears here after a successful run.",
  });

  renderOutputPanel("parent", {
    visible: runtimeCode !== "uat",
    title: "Parent Market JSON",
    payload: getCurrentOutputPayload("parent", generationResult),
    emptyMessage: "Generated parent market JSON appears here after a successful run.",
  });

  renderOutputPanel("uatFamily", {
    visible: runtimeCode === "uat",
    title: getUatFamilyOutputLabel(family.key, selectedLine),
    payload: getCurrentOutputPayload("uatFamily", generationResult),
    emptyMessage: lineSpecificFamilyOutputStale
      ? `Generate outputs again to build ${getUatFamilyOutputLabel(family.key, selectedLine)}.`
      : `${family.label} family payload appears here after a successful UAT run.`,
    emptyStateLabel: lineSpecificFamilyOutputStale ? "Refresh" : "Waiting",
  });

  renderOutputPanel("typeReferences", {
    visible: runtimeCode === "uat",
    title: "Type Reference Payloads",
    payload: getCurrentOutputPayload("typeReferences", generationResult),
    emptyMessage: hasTypeReferenceId
      ? "Generated type reference payloads appear here after a successful UAT run."
      : "Add a type reference ID to generate UAT type reference payloads.",
    emptyStateLabel: hasTypeReferenceId ? "Waiting" : "Optional",
  });

  renderOutputValidationBadges();
  renderGenerateReadiness();
}

function renderOutputPanel(outputKey, { visible, title, payload, emptyMessage, emptyStateLabel = "Waiting" }) {
  const refs = getOutputPanelElements(outputKey);
  if (refs.panel) {
    refs.panel.hidden = !visible;
  }
  if (refs.title) {
    refs.title.textContent = String(title || "");
  }

  if (!refs.output) {
    return;
  }

  const effectivePayload = visible ? payload : null;

  renderJsonOutputBlock(
    refs.output,
    effectivePayload ? JSON.stringify(effectivePayload, null, 2) : "",
    emptyMessage,
    {
      outputKey,
      visible,
      emptyStateLabel,
    }
  );
}

function renderJsonOutputBlock(element, content, emptyMessage, { outputKey = "", visible = true, emptyStateLabel = "Waiting" } = {}) {
  const text = String(content || "").trim();
  const isEmpty = !text;
  element.textContent = isEmpty ? emptyMessage : text;
  element.classList.toggle("is-empty", isEmpty);
  element.dataset.empty = isEmpty ? "true" : "false";

  const block = element.closest(".output-block");
  if (block) {
    block.dataset.tone = isEmpty ? "idle" : "active";
  }

  updateOutputStateBadge(outputKey, {
    visible,
    ready: !isEmpty,
    emptyStateLabel,
    readyStateLabel: "Ready to copy",
  });
}

function updateOutputStateBadge(outputKey, { visible = true, ready = false, emptyStateLabel = "Waiting", readyStateLabel = "Ready to copy" } = {}) {
  const badge = getOutputPanelElements(outputKey).stateBadge;
  if (!badge) {
    return;
  }

  badge.hidden = !visible;
  badge.textContent = ready ? readyStateLabel : emptyStateLabel;
  badge.dataset.tone = ready ? "ready" : "idle";
}

function setOutputValidationBadge(outputKey, validation, { visible = true, optional = false } = {}) {
  const badge = getOutputPanelElements(outputKey).validationBadge;
  if (!badge) {
    return;
  }

  badge.hidden = !visible;
  if (!visible) {
    return;
  }

  if (optional && !validation) {
    badge.textContent = "Optional";
    badge.dataset.tone = "idle";
    return;
  }

  if (!validation) {
    badge.textContent = "Not checked";
    badge.dataset.tone = "idle";
    return;
  }

  if (validation.ok) {
    const warningCount = Number(validation.warnings?.length || 0);
    badge.textContent = warningCount > 0 ? "Review" : "Valid";
    badge.dataset.tone = warningCount > 0 ? "warn" : "success";
    return;
  }

  badge.textContent = "Invalid";
  badge.dataset.tone = "error";
}

function renderOutputValidationBadges() {
  const runtimeCode = normalizeRuntimeAppEnvCode(state.runtimeAppEnv || "mainnet");
  const hasTypeReferenceId = Boolean(String(els.generateTypeRefInput?.value || "").trim());

  setOutputValidationBadge("fixture", state.outputValidation.fixture, { visible: true });
  setOutputValidationBadge("parent", state.outputValidation.parent, { visible: runtimeCode !== "uat" });
  setOutputValidationBadge("uatFamily", state.outputValidation.uatFamily, { visible: runtimeCode === "uat" });
  setOutputValidationBadge("typeReferences", state.outputValidation.typeReferences, {
    visible: runtimeCode === "uat",
    optional: !hasTypeReferenceId,
  });
}

function getOutputDisplayLabel(outputKey) {
  if (outputKey === "fixture") {
    return "Fixture JSON";
  }
  if (outputKey === "parent") {
    return "Parent Market JSON";
  }
  if (outputKey === "typeReferences") {
    return "Type Reference Payloads";
  }
  if (outputKey === "uatFamily") {
    return getUatFamilyOutputLabel();
  }
  return "Output";
}

function buildOutputValidationResult({ ok, errors = [], warnings = [], info = [] }) {
  return {
    ok: Boolean(ok),
    errors: Array.isArray(errors) ? errors : [],
    warnings: Array.isArray(warnings) ? warnings : [],
    info: Array.isArray(info) ? info : [],
  };
}

function runGeneratedOutputValidation(outputKey, generationResult = state.lastGenerationResult) {
  const payload = getCurrentOutputPayload(outputKey, generationResult);
  if (!payload) {
    return buildOutputValidationResult({
      ok: false,
      errors: [`${getOutputDisplayLabel(outputKey)} has not been generated yet.`],
    });
  }

  if (outputKey === "fixture") {
    const result = verifyFixtureJsonStrict(payload, {
      leagues: state.leagues,
      teams: state.teams,
    }, {
      selectedScheduleFixture: getCurrentSelectedScheduleFixture(),
    });
    return buildOutputValidationResult(result);
  }

  if (outputKey === "parent") {
    const result = verifyParentMarketJsonStrict(
      payload,
      {
        leagues: state.leagues,
        teams: state.teams,
      },
      {
        fixture: getCurrentOutputPayload("fixture", generationResult),
        fixtureResolved: generationResult?.fixtureCheck || null,
        now: getReferenceNowDate(),
        selectedScheduleFixture: getCurrentSelectedScheduleFixture(),
      }
    );
    return buildOutputValidationResult(result);
  }

  if (outputKey === "uatFamily") {
    const family = getUatMarketFamilyDefinition(state.selectedUatMarketFamily);
    const errors = validateUatParentMarketFamilyPayload(payload, { family: family.key });
    return buildOutputValidationResult({
      ok: errors.length === 0,
      errors,
      info: errors.length === 0 ? [`${family.label} family payload passed UAT structural validation.`] : [],
    });
  }

  if (outputKey === "typeReferences") {
    const errors = validateUatTypeReferencePayloads(payload);
    return buildOutputValidationResult({
      ok: errors.length === 0,
      errors,
      info: errors.length === 0 ? ["Type reference payloads passed UAT structural validation."] : [],
    });
  }

  return buildOutputValidationResult({
    ok: false,
    errors: [`Unsupported output key "${outputKey}".`],
  });
}

function deriveAutoOutputValidation(result) {
  const validation = createInitialOutputValidationState();
  if (!result || typeof result !== "object") {
    return validation;
  }

  if (result.fixtureJson) {
    validation.fixture = buildOutputValidationResult(result.fixtureCheck || runGeneratedOutputValidation("fixture", result));
  }

  if (isUatRuntimeActive()) {
    const uatFamilyPayload = getCurrentOutputPayload("uatFamily", result);
    if (uatFamilyPayload) {
      validation.uatFamily = runGeneratedOutputValidation("uatFamily", result);
    }
    if (result.typeReferencePayloads) {
      validation.typeReferences = runGeneratedOutputValidation("typeReferences", result);
    }
  } else if (result.parentPayload) {
    validation.parent = buildOutputValidationResult(result.parentCheck || runGeneratedOutputValidation("parent", result));
  }

  return validation;
}

function validateGeneratedOutputPanel(outputKey) {
  const validation = runGeneratedOutputValidation(outputKey);
  state.outputValidation[outputKey] = validation;
  renderOutputValidationBadges();

  if (validation.ok) {
    showToast(`${getOutputDisplayLabel(outputKey)} validation passed.`, validation.warnings.length > 0 ? "info" : "success");
  } else {
    showToast(
      `${getOutputDisplayLabel(outputKey)} validation found ${validation.errors.length} error(s).`,
      "error"
    );
  }
}

function resultToneClass(tone) {
  if (tone === "error") return "result-error";
  if (tone === "success") return "result-success";
  if (tone === "warn") return "result-warn";
  return "";
}

function deriveOverviewState(summary, tone, counts, labels = {}) {
  const idleValue = labels.idleValue || "Idle";
  const workingValue = labels.workingValue || "Working";

  if (tone === "neutral" && !counts) {
    return {
      value: idleValue,
      note: String(summary || "Waiting for input."),
      tone: "idle",
    };
  }

  if (tone === "working") {
    return {
      value: workingValue,
      note: String(summary || "Working"),
      tone: "working",
    };
  }

  const errors = Number(counts?.errors || 0);
  const warnings = Number(counts?.warnings || 0);
  const info = Number(counts?.info || 0);

  if (errors > 0) {
    return {
      value: `${errors} error${errors === 1 ? "" : "s"}`,
      note: String(summary || "Needs attention"),
      tone: "error",
    };
  }

  if (warnings > 0) {
    return {
      value: `${warnings} warning${warnings === 1 ? "" : "s"}`,
      note: String(summary || "Review warnings"),
      tone: "warn",
    };
  }

  if (info > 0) {
    return {
      value: `${info} checks`,
      note: String(summary || "Checks passed"),
      tone: "success",
    };
  }

  return {
    value: idleValue,
    note: String(summary || "Waiting for input."),
    tone: tone === "success" ? "success" : "idle",
  };
}

function setOverviewCard(kind, { value, note, tone = "idle" }) {
  const card = els[`${kind}OverviewCard`];
  const valueEl = els[`${kind}OverviewValue`];
  const noteEl = els[`${kind}OverviewNote`];
  if (!card || !valueEl || !noteEl) {
    return;
  }

  card.dataset.tone = tone;
  valueEl.textContent = String(value || "");
  noteEl.textContent = String(note || "");
}

function setCatalogStatus(message, tone = "idle") {
  els.catalogStatus.textContent = String(message || "");
  els.catalogStatus.className = "status";

  if (tone === "success") {
    els.catalogStatus.classList.add("status-success");
  } else if (tone === "error") {
    els.catalogStatus.classList.add("status-error");
  } else if (tone === "working") {
    els.catalogStatus.classList.add("status-working");
  } else {
    els.catalogStatus.classList.add("status-idle");
  }
}

function requireProtectedApiAccess(message) {
  state.apiAccessRequired = true;
  state.apiAccessMessage =
    String(message || "").trim() ||
    "This dashboard needs an API bearer token to reach protected catalog and schedule routes.";
  renderApiAccessPanel();
  if (!loadApiBearerToken() && els.apiAccessPanel && !els.apiAccessPanel.hidden && els.apiAccessTokenInput) {
    window.setTimeout(() => {
      els.apiAccessTokenInput?.focus();
      els.apiAccessTokenInput?.select();
    }, 0);
  }
}

function clearProtectedApiAccessRequirement() {
  if (!state.apiAccessRequired && !state.apiAccessMessage) {
    return;
  }
  state.apiAccessRequired = false;
  state.apiAccessMessage = "";
  renderApiAccessPanel();
}

function renderApiAccessPanel() {
  if (!els.apiAccessPanel) {
    return;
  }
  // Keep saved-token recovery working quietly, but keep the bearer panel out of the current UI.
  els.apiAccessPanel.hidden = true;
}

async function handleSaveApiAccessTokenAndRetry() {
  const token = String(els.apiAccessTokenInput?.value || "").trim();
  if (!token) {
    showToast("Paste the API bearer token first.", "error");
    els.apiAccessTokenInput?.focus();
    return;
  }

  const result = saveApiBearerToken(token);
  if (!result.ok) {
    showToast("Could not save the API bearer token in this browser.", "error");
    return;
  }

  if (els.apiAccessTokenInput) {
    els.apiAccessTokenInput.value = "";
  }
  renderApiAccessPanel();
  showToast("API bearer token saved.", "success");
  await retryProtectedApiFlow();
}

function handleClearApiAccessToken() {
  clearApiBearerToken();
  if (els.apiAccessTokenInput) {
    els.apiAccessTokenInput.value = "";
  }
  renderApiAccessPanel();
  showToast("Saved API bearer token cleared.", "success");
}

async function retryProtectedApiFlow() {
  const savedToken = loadApiBearerToken();
  if (!savedToken) {
    showToast("Save a bearer token first, then retry.", "error");
    els.apiAccessTokenInput?.focus();
    return;
  }

  if (!state.catalogLoaded) {
    await loadCatalog({ force: true });
    return;
  }

  if (isLiveFixtureSourceActive() && getActiveScheduleLeagueCode()) {
    await refreshLeagueScheduleSuggestions({ force: true });
    return;
  }

  await loadCatalog({ force: true });
}

async function copyOutputText(value, successMessage = "Copied to clipboard.") {
  const text = String(value || "").trim();
  if (!text) {
    showToast("Nothing to copy.", "info");
    return;
  }

  try {
    await navigator.clipboard.writeText(text);
    showToast(successMessage, "success");
  } catch {
    const area = document.createElement("textarea");
    area.value = text;
    area.setAttribute("readonly", "");
    area.style.position = "fixed";
    area.style.opacity = "0";
    document.body.appendChild(area);
    area.select();
    const copied = document.execCommand("copy");
    document.body.removeChild(area);
    if (copied) {
      showToast(successMessage, "success");
    } else {
      showToast("Copy failed. Please copy manually.", "error");
    }
  }
}

function formatJsonInput(kind) {
  const target = kind === "fixture" ? els.fixtureInputJson : els.parentInputJson;
  const raw = String(target.value || "").trim();
  if (!raw) {
    updateJsonMeta(kind);
    return "empty";
  }

  try {
    const parsed = JSON.parse(raw);
    target.value = JSON.stringify(parsed, null, 2);
    updateJsonMeta(kind);
    return "ok";
  } catch {
    // Keep raw value unchanged when invalid.
    updateJsonMeta(kind);
    return "invalid";
  }
}

function handleVerifyJsonInputChange(kind) {
  if (kind === "fixture") {
    state.persistFixtureInput = true;
  } else {
    state.persistParentInput = true;
  }
  updateJsonMeta(kind);
  scheduleAutoVerify();
}

function detectAutoVerifyMode() {
  const hasFixture = Boolean(String(els.fixtureInputJson.value || "").trim());
  const hasParent = Boolean(String(els.parentInputJson.value || "").trim());

  if (hasFixture && hasParent) {
    return "both";
  }
  if (hasFixture) {
    return "fixture";
  }
  if (hasParent) {
    return "parent";
  }
  return null;
}

function scheduleAutoVerify({ immediate = false } = {}) {
  clearTimeout(state.autoVerifyTimerId);
  state.autoVerifyTimerId = null;

  const mode = detectAutoVerifyMode();
  state.pendingAutoVerifyMode = mode;

  if (!mode) {
    state.lastVerifyReportText = "";
    renderVerifyOutput({
      summary: "No verification run yet.",
      tone: "neutral",
      sections: [],
      counts: null,
    });
    syncActionState();
    return;
  }

  const delay = immediate ? 0 : 320;
  state.autoVerifyTimerId = window.setTimeout(() => {
    state.autoVerifyTimerId = null;
    void flushAutoVerify();
  }, delay);
}

async function flushAutoVerify() {
  const mode = state.pendingAutoVerifyMode;
  if (!mode) {
    return;
  }

  if (state.isCatalogLoading || state.isVerifying || state.isGenerating) {
    scheduleAutoVerify();
    return;
  }

  state.pendingAutoVerifyMode = null;
  await handleVerify(mode, { background: true });
}

function clearAutoVerifySchedule() {
  clearTimeout(state.autoVerifyTimerId);
  state.autoVerifyTimerId = null;
  state.pendingAutoVerifyMode = null;
}

function updateJsonMeta(kind) {
  const input = kind === "fixture" ? els.fixtureInputJson : els.parentInputJson;
  const metaEl = kind === "fixture" ? els.fixtureJsonMeta : els.parentJsonMeta;
  const raw = String(input.value || "");
  const trimmed = raw.trim();
  const lines = trimmed ? trimmed.split(/\r?\n/).length : 0;
  const chars = trimmed.length;

  metaEl.className = "json-meta";

  if (!trimmed) {
    metaEl.textContent = "Empty";
    return;
  }

  try {
    const parsed = JSON.parse(trimmed);
    const typeLabel = Array.isArray(parsed) ? "Array" : "Object";
    metaEl.textContent = `Valid ${typeLabel} · ${lines} lines · ${chars} chars`;
    metaEl.classList.add("meta-ok");
  } catch (error) {
    const message = String(error?.message || "Invalid JSON").slice(0, 76);
    metaEl.textContent = `Invalid JSON · ${lines} lines · ${chars} chars · ${message}`;
    metaEl.classList.add("meta-error");
  }
}

function asRestoredString(value) {
  return typeof value === "string" ? value : "";
}

function normalizeRuntimeAppEnvCode(value) {
  const normalized = String(value || "").trim().toLowerCase();
  if (!normalized || normalized === "local" || normalized === "mainnet") {
    return "mainnet";
  }
  if (normalized === "uat") {
    return "uat";
  }
  return normalized;
}

function normalizeRuntimeEnvironmentOptions(payload) {
  const raw = Array.isArray(payload?.environments) ? payload.environments : [];
  const options = raw
    .map((environment) => ({
      code: normalizeRuntimeAppEnvCode(environment?.code),
      label: String(environment?.label || "").trim() || String(environment?.code || "").trim(),
      available: environment?.available !== false,
    }))
    .filter((environment) => Boolean(environment.code));

  if (options.length > 0) {
    return options;
  }
  return DEFAULT_RUNTIME_ENV_OPTIONS.map((environment) => ({ ...environment }));
}

function applyRuntimeEnvironmentPayload(payload) {
  const active = payload?.active_env || null;
  const activeCode = normalizeRuntimeAppEnvCode(active?.code || state.runtimeAppEnv || "mainnet");
  state.runtimeAppEnv = activeCode;
  state.runtimeAppEnvLabel = String(active?.label || (activeCode === "uat" ? "UAT" : "Mainnet")).trim();
  state.runtimeEnvOptions = normalizeRuntimeEnvironmentOptions(payload);
  renderRuntimeEnvironmentControl();
  renderMarketSchemaPanel();
  renderJsonOutputs();
}

async function hydrateRuntimeEnvironmentControl() {
  try {
    const payload = await fetchRuntimeEnvironmentPayload();
    clearProtectedApiAccessRequirement();
    applyRuntimeEnvironmentPayload(payload);
  } catch (error) {
    if (isBearerAuthError(error)) {
      requireProtectedApiAccess(
        "Protected API access is required to inspect or switch runtime environments."
      );
    }
    state.runtimeEnvOptions = DEFAULT_RUNTIME_ENV_OPTIONS.map((environment) => ({ ...environment }));
    if (!state.runtimeAppEnv) {
      state.runtimeAppEnv = "mainnet";
      state.runtimeAppEnvLabel = "Mainnet";
    }
    renderRuntimeEnvironmentControl();
  }
}

function renderRuntimeEnvironmentControl() {
  if (!els.runtimeEnvSelect) {
    return;
  }

  const options = Array.isArray(state.runtimeEnvOptions) && state.runtimeEnvOptions.length > 0
    ? state.runtimeEnvOptions
    : DEFAULT_RUNTIME_ENV_OPTIONS;
  const activeCode = normalizeRuntimeAppEnvCode(state.runtimeAppEnv || "mainnet");

  els.runtimeEnvSelect.innerHTML = options
    .map((environment) => {
      const code = normalizeRuntimeAppEnvCode(environment?.code);
      const label = String(environment?.label || code).trim();
      const isSelected = code === activeCode;
      const isAvailable = environment?.available !== false;
      return `<option value="${escapeHtmlAttribute(code)}"${isSelected ? " selected" : ""}${isAvailable ? "" : " disabled"}>${escapeHtml(label)}</option>`;
    })
    .join("");
  els.runtimeEnvSelect.value = activeCode;
  els.runtimeEnvSelect.disabled =
    state.isRuntimeEnvSwitching || state.isCatalogLoading || state.isVerifying || state.isGenerating || state.isScheduleLoading;
  els.runtimeEnvSelect.setAttribute("aria-label", `Active environment: ${state.runtimeAppEnvLabel || "Mainnet"}`);
  if (els.runtimeEnvBadge) {
    els.runtimeEnvBadge.textContent = state.runtimeAppEnvLabel || "Mainnet";
    els.runtimeEnvBadge.dataset.env = activeCode;
  }
}

function resetRuntimeStateAfterEnvironmentSwitch() {
  clearAutoVerifySchedule();
  state.scheduleSnapshots = {};
  state.referenceNowIso = new Date().toISOString();
  state.pendingRestoredSelectedScheduleFixtureId = "";
  state.lastGenerationResult = null;
  state.outputValidation = createInitialOutputValidationState();
  clearScheduleSuggestions({ clearLeagueContext: false });
  renderGenerationStatus({
    summary: "Waiting for input.",
    tone: "neutral",
    sections: [],
    counts: null,
  });
  renderJsonOutputs(null);
  state.lastVerifyReportText = "";
  renderVerifyOutput({
    summary: "No verification run yet.",
    tone: "neutral",
    sections: [],
    counts: null,
  });
  persistInputSnapshot();
}

async function handleRuntimeEnvironmentChange(requestedEnv) {
  const nextEnv = normalizeRuntimeAppEnvCode(requestedEnv);
  if (!nextEnv || state.isRuntimeEnvSwitching) {
    return;
  }

  state.isRuntimeEnvSwitching = true;
  renderRuntimeEnvironmentControl();
  renderMarketSchemaPanel();
  syncActionState();

  try {
    const payload = await updateRuntimeEnvironment(nextEnv);
    clearProtectedApiAccessRequirement();
    applyRuntimeEnvironmentPayload(payload);
    resetRuntimeStateAfterEnvironmentSwitch();
    await loadCatalog({ force: true });
    showToast(
      state.catalogLoaded
        ? `Switched to ${state.runtimeAppEnvLabel}.`
        : `Switched to ${state.runtimeAppEnvLabel}, but the catalog needs attention.`,
      state.catalogLoaded ? "success" : "error"
    );
  } catch (error) {
    renderRuntimeEnvironmentControl();
    if (isBearerAuthError(error)) {
      requireProtectedApiAccess(
        "Protected API access is required to switch runtime environments."
      );
    }
    showToast(`Could not switch environment: ${String(error?.message || error)}`, "error");
  } finally {
    state.isRuntimeEnvSwitching = false;
    renderRuntimeEnvironmentControl();
    renderMarketSchemaPanel();
    syncActionState();
  }
}

function ensureDeterministicRuntime() {
  if (!state.referenceNowIso) {
    state.referenceNowIso = new Date().toISOString();
  }
  if (!state.scheduleSnapshots || typeof state.scheduleSnapshots !== "object") {
    state.scheduleSnapshots = {};
  }
  persistInputSnapshot();
}

function getReferenceNowDate() {
  const raw = String(state.referenceNowIso || "").trim();
  if (!raw) {
    return null;
  }
  const parsed = new Date(raw);
  return Number.isNaN(parsed.getTime()) ? null : parsed;
}

function normalizeReferenceNowIso(value) {
  const text = String(value || "").trim();
  if (!text) {
    return "";
  }
  const parsed = new Date(text);
  return Number.isNaN(parsed.getTime()) ? "" : parsed.toISOString();
}

function shouldRotateDeterministicReference(referenceNowIso) {
  const normalized = normalizeReferenceNowIso(referenceNowIso);
  if (!normalized) {
    return false;
  }
  return normalized.slice(0, 10) !== new Date().toISOString().slice(0, 10);
}

function sanitizeScheduleSnapshots(input) {
  const output = {};
  if (!input || typeof input !== "object") {
    return output;
  }

  for (const [leagueCode, snapshot] of Object.entries(input)) {
    const key = String(leagueCode || "").trim().toLowerCase();
    if (!key || !snapshot || typeof snapshot !== "object") {
      continue;
    }
    const fixtures = Array.isArray(snapshot.fixtures) ? snapshot.fixtures.filter((fixture) => fixture && typeof fixture === "object") : [];
    output[key] = {
      fetchedAt: asRestoredString(snapshot.fetchedAt),
      referenceNowIso: normalizeReferenceNowIso(snapshot.referenceNowIso),
      selectedWeek: Number.isInteger(snapshot.selectedWeek) ? snapshot.selectedWeek : null,
      selectedWeeks: Array.isArray(snapshot.selectedWeeks)
        ? snapshot.selectedWeeks.filter((value) => Number.isInteger(value))
        : [],
      selectedLabel: asRestoredString(snapshot.selectedLabel),
      selectionMode: asRestoredString(snapshot.selectionMode),
      fixtures,
    };
  }

  return output;
}

function restoreScheduleSnapshots(value) {
  return sanitizeScheduleSnapshots(value);
}

function renderDeterministicContext() {
  if (!els.deterministicReferenceNow) {
    return;
  }

  const referenceNow = getReferenceNowDate();
  els.deterministicReferenceNow.textContent = referenceNow ? formatUtcStamp(referenceNow) : "Unset";
  els.deterministicReferenceNote.textContent = referenceNow
    ? "This frozen UTC reference drives schedule selection, generation, and verification."
    : "A reference UTC timestamp will be created when the workspace starts.";

  const selectedLeagueId = String(els.generateLeagueSelect?.value || "").trim();
  const selectedLeague = state.leagues.find((league) => String(league.id || "") === selectedLeagueId) || null;
  const scheduleLeagueCode = resolveUiScheduleLeagueCode(selectedLeague);
  const snapshot = scheduleLeagueCode ? state.scheduleSnapshots[scheduleLeagueCode] : null;

  els.deterministicLeagueState.textContent = selectedLeague
    ? `${selectedLeague.name} (${String(scheduleLeagueCode || selectedLeague.key || "").toUpperCase()})`
    : "Auto-detect";
  els.deterministicLeagueNote.textContent = selectedLeague
    ? "This selection controls which schedule source and snapshot are active."
    : "No league pinned yet. Auto-detect can still build payloads from team names.";

  if (!scheduleLeagueCode) {
    els.deterministicScheduleState.textContent = "No schedule source selected";
    els.deterministicScheduleNote.textContent = "Choose EPL/UCL/LALIGA to lock a fixture list from the schedule API.";
    return;
  }

  if (!snapshot) {
    els.deterministicScheduleState.textContent = `${scheduleLeagueCode.toUpperCase()} snapshot not loaded`;
    els.deterministicScheduleNote.textContent = "Load fixtures once to save a deterministic schedule snapshot for this league.";
    return;
  }

  const label = snapshot.selectedLabel || (snapshot.selectedWeek ? `Matchday ${snapshot.selectedWeek}` : "Upcoming fixtures");
  const fetchedAt = normalizeReferenceNowIso(snapshot.fetchedAt);
  els.deterministicScheduleState.textContent = `${scheduleLeagueCode.toUpperCase()} snapshot ready`;
  els.deterministicScheduleNote.textContent =
    `${label} · ${snapshot.fixtures.length} fixture${snapshot.fixtures.length === 1 ? "" : "s"} · fetched ${fetchedAt ? formatUtcStamp(new Date(fetchedAt)) : "unknown time"}.`;
}

function renderGenerateReadiness() {
  if (!els.generateStepLeagueCard) {
    return;
  }

  const selectedLeagueId = String(els.generateLeagueSelect?.value || "").trim();
  const selectedLeague = state.leagues.find((league) => String(league.id || "") === selectedLeagueId) || null;
  const scheduleLeagueCode = resolveUiScheduleLeagueCode(selectedLeague);
  const snapshot = scheduleLeagueCode ? state.scheduleSnapshots[scheduleLeagueCode] : null;

  if (!selectedLeague) {
    setPulseCard("League", {
      value: "Auto-detect mode",
      note: "Select a supported league to lock schedule snapshots and fixture browsing.",
      tone: "idle",
    });
  } else if (state.isScheduleLoading) {
    setPulseCard("League", {
      value: `${selectedLeague.key} schedule loading`,
      note: "Upcoming fixtures are being refreshed from the deterministic schedule source.",
      tone: "working",
    });
  } else if (!scheduleLeagueCode) {
    setPulseCard("League", {
      value: `${selectedLeague.key} manual mode`,
      note: "This league is available for generation, but live upcoming fixture browsing is not wired yet.",
      tone: "warn",
    });
  } else if (snapshot) {
    const label = snapshot.selectedLabel || (snapshot.selectedWeek ? `Matchday ${snapshot.selectedWeek}` : "Upcoming fixtures");
    setPulseCard("League", {
      value: `${selectedLeague.key} snapshot ready`,
      note: `${label} locked with ${snapshot.fixtures.length} fixture${snapshot.fixtures.length === 1 ? "" : "s"}.`,
      tone: "success",
    });
  } else {
    setPulseCard("League", {
      value: `${selectedLeague.key} selected`,
      note: "Refresh fixtures once to save a deterministic schedule snapshot for this league.",
      tone: "warn",
    });
  }

  const eventName = String(els.generateEventNameInput?.value || "").trim();
  const selectedFixture = getCurrentSelectedScheduleFixture();
  if (selectedFixture) {
    setPulseCard("Fixture", {
      value: selectedFixture.eventName,
      note: `${selectedFixture.fixtureDate} · ${selectedFixture.kickoffTimeUtc} UTC · Matchday ${selectedFixture.matchDay}`,
      tone: "success",
    });
  } else if (!eventName) {
    setPulseCard("Fixture", {
      value: "Awaiting event",
      note: "Type an event name manually or apply one from the upcoming fixture browser.",
      tone: "idle",
    });
  } else if (state.upcomingScheduleFixtures.length > 0) {
    setPulseCard("Fixture", {
      value: eventName,
      note: "Manual event entry is active. This name is not currently tied to a loaded schedule fixture.",
      tone: "warn",
    });
  } else {
    setPulseCard("Fixture", {
      value: eventName,
      note: "Manual event entry is active. Load fixtures or continue with manual metadata.",
      tone: "warn",
    });
  }

  const fixtureDate = String(els.generateFixtureDateInput?.value || "").trim();
  const kickoffTimeUtc = String(els.generateKickoffTimeInput?.value || "").trim();
  const matchDay = String(els.generateMatchDayInput?.value || "").trim();
  const missing = [];
  if (!fixtureDate) missing.push("date");
  if (!kickoffTimeUtc) missing.push("kickoff");
  if (!matchDay) missing.push("match day");
  if (missing.length === 0) {
    setPulseCard("Timing", {
      value: "UTC metadata ready",
      note: `${fixtureDate} · ${kickoffTimeUtc} UTC · Matchday ${matchDay}`,
      tone: "success",
    });
  } else {
    setPulseCard("Timing", {
      value: "Needs required fields",
      note: `Missing ${missing.join(", ")} before generation can produce final payloads.`,
      tone: "warn",
    });
  }

  const fixtureReady = els.generatedFixtureOutput?.dataset.empty === "false";
  const parentReady = els.generatedParentOutput?.dataset.empty === "false";
  const uatFamilyReady = els.generatedUatFamilyOutput?.dataset.empty === "false";
  const typeReferencesReady = els.generatedTypeReferencesOutput?.dataset.empty === "false";
  const typeRef = String(els.generateTypeRefInput?.value || "").trim();
  if (!isUatRuntimeActive() && fixtureReady && parentReady) {
    setPulseCard("Output", {
      value: "Payloads ready to copy",
      note: `${typeRef ? "Type reference locked." : "Type reference optional."} Generated payloads are also pushed into Verify automatically.`,
      tone: "success",
    });
  } else if (isUatRuntimeActive() && fixtureReady && uatFamilyReady && (!typeRef || typeReferencesReady)) {
    setPulseCard("Output", {
      value: "UAT outputs ready",
      note: `${getUatFamilyOutputLabel()} is ready.${typeRef ? " Type reference payloads are also ready." : " Add a type reference ID when you need the extra UAT payloads."}`,
      tone: "success",
    });
  } else if (state.isGenerating) {
    setPulseCard("Output", {
      value: "Generation in progress",
      note: "The current event input is being validated against the CSV source of truth.",
      tone: "working",
    });
  } else {
    setPulseCard("Output", {
      value: "Not generated yet",
      note: isUatRuntimeActive()
        ? "Run generation to create UAT fixture, family, and optional type-reference payloads."
        : "Run generation to create CSV-verified fixture and parent market payloads.",
      tone: "idle",
    });
  }
}

function setPulseCard(kind, { value, note, tone = "idle" }) {
  const card = els[`generateStep${kind}Card`];
  const valueEl = els[`generateStep${kind}Value`];
  const noteEl = els[`generateStep${kind}Note`];
  if (!card || !valueEl || !noteEl) {
    return;
  }
  card.dataset.tone = tone;
  valueEl.textContent = String(value || "");
  noteEl.textContent = String(note || "");
}

function formatUtcStamp(value) {
  const parsed = value instanceof Date ? value : new Date(value);
  if (Number.isNaN(parsed.getTime())) {
    return String(value || "Unknown");
  }
  const day = String(parsed.getUTCDate()).padStart(2, "0");
  const month = String(parsed.getUTCMonth() + 1).padStart(2, "0");
  const year = parsed.getUTCFullYear();
  const hh = String(parsed.getUTCHours()).padStart(2, "0");
  const mm = String(parsed.getUTCMinutes()).padStart(2, "0");
  return `${year}-${month}-${day} ${hh}:${mm} UTC`;
}

function setVerifyEditorOpen(open) {
  const isOpen = Boolean(open);
  const verifySection = document.getElementById("verifySection");
  if (verifySection) {
    verifySection.open = isOpen;
    verifySection.classList.toggle("verify-collapsed", !isOpen);
  }
  if (els.verifyWorkspace) {
    els.verifyWorkspace.classList.toggle("is-editor-open", isOpen);
  }
  if (els.verifyToggleBtn) {
    els.verifyToggleBtn.setAttribute("aria-expanded", String(isOpen));
  }
  if (els.verifyToggleCaption) {
    els.verifyToggleCaption.textContent = isOpen
      ? "Open. Paste payloads or review the live verification report."
      : "Collapsed. Click to open inputs and the live verification report.";
  }
}

function buildPlainResultReport(summary, sections) {
  const lines = [summary];

  for (const section of sections || []) {
    if (!Array.isArray(section.items) || section.items.length === 0) {
      continue;
    }
    lines.push("");
    lines.push(`${section.title}:`);
    for (const item of section.items) {
      lines.push(`- ${item}`);
    }
  }

  return lines.join("\n").trim();
}

function uniqueItems(items) {
  const out = [];
  const seen = new Set();

  for (const item of items || []) {
    const key = String(item || "").trim();
    if (!key || seen.has(key)) {
      continue;
    }
    seen.add(key);
    out.push(key);
  }

  return out;
}

function syncActionState() {
  const busy = state.isCatalogLoading || state.isVerifying || state.isGenerating;
  const canRun = state.catalogLoaded && !busy;
  const canCopyReport = !busy && Boolean(String(state.lastVerifyReportText || "").trim());
  const hasGeneratedFixture = els.generatedFixtureOutput?.dataset.empty !== "true";
  const hasGeneratedParent = els.generatedParentOutput?.dataset.empty !== "true";
  const hasGeneratedUatFamily = els.generatedUatFamilyOutput?.dataset.empty !== "true";
  const hasGeneratedTypeReferences = els.generatedTypeReferencesOutput?.dataset.empty !== "true";
  const hasScheduleSource = isLiveFixtureSourceActive() && Boolean(getActiveScheduleLeagueCode());

  els.reloadCatalogBtn.disabled = state.isCatalogLoading || state.isVerifying || state.isGenerating;
  if (els.runtimeEnvSelect) {
    els.runtimeEnvSelect.disabled =
      state.isRuntimeEnvSwitching || state.isCatalogLoading || state.isVerifying || state.isGenerating || state.isScheduleLoading;
  }
  if (els.generateMarketFamilyActivateBtn) {
    const runtimeCode = normalizeRuntimeAppEnvCode(state.runtimeAppEnv || "mainnet");
    els.generateMarketFamilyActivateBtn.disabled =
      runtimeCode === "uat" ||
      state.isRuntimeEnvSwitching ||
      state.isCatalogLoading ||
      state.isVerifying ||
      state.isGenerating ||
      state.isScheduleLoading;
    els.generateMarketFamilyActivateBtn.textContent = state.isRuntimeEnvSwitching ? "Switching..." : "Switch to UAT";
  }
  els.verifyBothBtn.disabled = !canRun;
  els.verifyFixtureBtn.disabled = !canRun;
  els.verifyParentBtn.disabled = !canRun;
  els.generateBtn.disabled = !canRun;
  if (els.refreshScheduleBtn) {
    els.refreshScheduleBtn.disabled =
      state.isCatalogLoading || state.isVerifying || state.isGenerating || state.isScheduleLoading || !hasScheduleSource;
  }
  if (els.generateBuilderRefetchBtn) {
    els.generateBuilderRefetchBtn.disabled =
      state.isCatalogLoading || state.isVerifying || state.isGenerating || state.isScheduleLoading || !hasScheduleSource;
  }
  if (els.generateBuilderWeekSelect) {
    const hasSelectableWeekOptions = Array.from(els.generateBuilderWeekSelect.options || []).some((option) => Boolean(String(option.value || "").trim()));
    const hasRoundOnlyBuilderFixtures =
      !hasSelectableWeekOptions &&
      Array.isArray(state.upcomingScheduleFixtures) &&
      state.upcomingScheduleFixtures.length > 0;
    els.generateBuilderWeekSelect.disabled =
      (!hasSelectableWeekOptions && !hasRoundOnlyBuilderFixtures) || state.isScheduleLoading || state.isCatalogLoading;
  }
  els.copyVerifyReportBtn.disabled = !canCopyReport;
  els.copyGeneratedFixtureBtn.disabled = busy || !hasGeneratedFixture;
  els.copyGeneratedParentBtn.disabled = busy || !hasGeneratedParent;
  if (els.copyGeneratedUatFamilyBtn) {
    els.copyGeneratedUatFamilyBtn.disabled = busy || !hasGeneratedUatFamily;
  }
  if (els.copyGeneratedTypeReferencesBtn) {
    els.copyGeneratedTypeReferencesBtn.disabled = busy || !hasGeneratedTypeReferences;
  }
  if (els.validateGeneratedFixtureBtn) {
    els.validateGeneratedFixtureBtn.disabled = busy || !hasGeneratedFixture;
  }
  if (els.validateGeneratedParentBtn) {
    els.validateGeneratedParentBtn.disabled = busy || !hasGeneratedParent;
  }
  if (els.validateGeneratedUatFamilyBtn) {
    els.validateGeneratedUatFamilyBtn.disabled = busy || !hasGeneratedUatFamily;
  }
  if (els.validateGeneratedTypeReferencesBtn) {
    els.validateGeneratedTypeReferencesBtn.disabled = busy || !hasGeneratedTypeReferences;
  }
  els.copyGenerationStatusBtn.disabled = busy;
  renderScheduleSearchControls();
  renderApiAccessPanel();
}

function setButtonBusy(button, busy, busyLabel) {
  if (!button) {
    return;
  }
  if (!button.dataset.defaultLabel) {
    button.dataset.defaultLabel = button.textContent || "";
  }
  button.textContent = busy ? String(busyLabel || "Working...") : String(button.dataset.defaultLabel || "");
}

function restoreThemePreference() {
  const restoredTheme = String(loadThemePreference() || "").trim().toLowerCase();
  state.theme = restoredTheme === "dark" ? "dark" : "light";
}

function applyTheme(theme) {
  const nextTheme = String(theme || "").trim().toLowerCase() === "dark" ? "dark" : "light";
  state.theme = nextTheme;
  document.documentElement.dataset.theme = nextTheme;
  document.documentElement.style.colorScheme = nextTheme;
  const themeMeta = document.querySelector('meta[name="theme-color"]');
  if (themeMeta) {
    themeMeta.setAttribute("content", nextTheme === "dark" ? "#243140" : "#f4f9fc");
  }
  if (els.themeToggleBtn) {
    els.themeToggleBtn.setAttribute("aria-pressed", String(nextTheme === "dark"));
  }
  if (els.themeToggleIcon) {
    els.themeToggleIcon.textContent = nextTheme === "dark" ? "☀" : "☾";
  }
  if (els.themeToggleLabel) {
    els.themeToggleLabel.textContent = nextTheme === "dark" ? "Light theme" : "Dark theme";
  }
}

function showToast(message, tone = "info") {
  if (!els.toastRegion) {
    return;
  }

  if (state.toastTimerId) {
    clearTimeout(state.toastTimerId);
    state.toastTimerId = null;
  }

  const classTone = tone === "success" || tone === "error" ? tone : "info";
  els.toastRegion.innerHTML = `<div class="toast toast-${classTone}">${escapeHtml(String(message || ""))}</div>`;

  state.toastTimerId = window.setTimeout(() => {
    els.toastRegion.innerHTML = "";
    state.toastTimerId = null;
  }, 2200);
}
