import { fetchCatalogPayload, normalizeCatalogPayload } from "../data/catalog.js";
import { fetchUpcomingFixturesForLeague, resolveScheduleLeagueCode } from "../data/schedules.js";
import { createLogger } from "../shared/logger.js";
import { loadSnapshot, saveSnapshot } from "./persistence.js";
import {
  generateFromEventInput,
  parseJsonInput,
  verifyBundleConsistency,
  verifyFixtureJsonStrict,
  verifyParentMarketJsonStrict,
} from "../core/verifier.js";
import { escapeHtml, normalizeForSearch } from "../shared/util.js";

const uiLog = createLogger("ui");
let resultPanelRenderId = 0;
const SCHEDULE_SNAPSHOT_SCHEMA_VERSION = 3;

const state = {
  leagues: [],
  teams: [],
  catalogLoaded: false,
  catalogSourceLabel: "",
  autoVerifyTimerId: null,
  pendingAutoVerifyMode: null,
  pendingRestoredLeagueSelection: "",
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
  upcomingScheduleLeagueCode: "",
  upcomingScheduleWeek: null,
  upcomingScheduleLabel: "",
  upcomingScheduleFixtures: [],
  scheduleCursorEventName: "",
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

export function initApp() {
  cacheElements();
  bindEvents();
  restoreInputSnapshot();
  ensureDeterministicRuntime();
  seedDefaults();
  setVerifyEditorOpen(false);

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
    note: "Event name to fixture + parent JSON",
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
  renderJsonOutputs(null, null);
  clearScheduleSuggestions();
  setScheduleStatus("Select a league to load upcoming scheduled fixtures, or keep typing manually.", "idle");
  renderDeterministicContext();
  renderGenerateReadiness();
  updateJsonMeta("fixture");
  updateJsonMeta("parent");
  syncActionState();

  void loadCatalog();
}

function cacheElements() {
  const ids = [
    "catalogStatus",
    "reloadCatalogBtn",
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
    "generateEventFixtureSelect",
    "generateFixtureSearchInput",
    "generateFixtureActiveSummary",
    "generateFixtureActiveTitle",
    "generateFixtureActiveMeta",
    "generateFixtureActiveState",
    "generateFixtureSummary",
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
    "generatedFixtureOutput",
    "generatedParentOutput",
    "generatedFixtureState",
    "generatedParentState",
    "copyGeneratedFixtureBtn",
    "copyGeneratedParentBtn",
    "toastRegion",
  ];

  for (const id of ids) {
    els[id] = document.getElementById(id);
  }
}

function bindEvents() {
  els.reloadCatalogBtn.addEventListener("click", () => {
    uiLog.info("catalog.reload_click");
    void loadCatalog({ force: true });
  });

  const verifySection = document.getElementById("verifySection");
  if (verifySection) {
    verifySection.addEventListener("toggle", () => {
      const isOpen = verifySection.open;
      setVerifyEditorOpen(isOpen);
      if (isOpen) {
        window.setTimeout(() => {
          els.fixtureInputJson?.focus();
        }, 0);
      }
    });
  }

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
    persistInputSnapshot();
    renderDeterministicContext();
    void refreshLeagueScheduleSuggestions();
  });

  if (els.refreshScheduleBtn) {
    els.refreshScheduleBtn.addEventListener("click", () => {
      void refreshLeagueScheduleSuggestions({ force: true });
    });
  }

  els.generateEventFixtureSelect.addEventListener("change", () => {
    applySelectedScheduleFixture(els.generateEventFixtureSelect.value);
  });

  els.generateEventNameInput.addEventListener("change", () => {
    applySelectedScheduleFixture(els.generateEventNameInput.value, { fromManualEntry: true });
  });

  els.generateEventNameInput.addEventListener("input", () => {
    syncScheduleActiveSelection();
  });

  els.generateFixtureSearchInput.addEventListener("input", () => {
    renderScheduleFixtureBrowser(state.upcomingScheduleFixtures, {
      selectedWeek: state.upcomingScheduleWeek,
      selectedLabel: state.upcomingScheduleLabel,
      leagueCode: state.upcomingScheduleLeagueCode,
    });
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

  els.generateEventNameInput.addEventListener("keydown", (event) => {
    if (event.key !== "Enter") {
      return;
    }
    event.preventDefault();
    void handleGenerate();
  });

  document.addEventListener("keydown", (event) => {
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

  document.addEventListener("click", (event) => {
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

    const scheduleButton = event.target instanceof Element ? event.target.closest(".schedule-fixture-btn") : null;
    if (!scheduleButton) {
      return;
    }

    const eventName = String(scheduleButton.getAttribute("data-event-name") || "").trim();
    if (!eventName) {
      return;
    }
    applySelectedScheduleFixture(eventName);
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
      eventName: String(els.generateEventNameInput.value || ""),
      leagueSelection: String(els.generateLeagueSelect.value || state.pendingRestoredLeagueSelection || ""),
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

  const restoredReferenceNowIso = normalizeReferenceNowIso(runtime.referenceNowIso);
  const restoredVersion = Number.parseInt(String(runtime.scheduleSnapshotVersion || ""), 10);
  const shouldInvalidateRuntime =
    restoredVersion !== SCHEDULE_SNAPSHOT_SCHEMA_VERSION ||
    shouldRotateDeterministicReference(restoredReferenceNowIso);

  state.referenceNowIso = shouldInvalidateRuntime ? "" : restoredReferenceNowIso;
  state.scheduleSnapshots = shouldInvalidateRuntime ? {} : restoreScheduleSnapshots(runtime.scheduleSnapshots);

  els.fixtureInputJson.value = asRestoredString(verify.fixtureJson);
  els.parentInputJson.value = asRestoredString(verify.parentJson);
  state.persistFixtureInput = true;
  state.persistParentInput = true;

  els.generateEventNameInput.value = asRestoredString(generate.eventName);
  state.pendingRestoredLeagueSelection = asRestoredString(generate.leagueSelection);
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
    state.leagues = normalized.leagues;
    state.teams = normalized.teams;
    state.catalogLoaded = true;
    state.catalogSourceLabel = String(payload?.source?.label || "CSV files");

    populateLeagueSelect();
    await refreshLeagueScheduleSuggestions({ force: false });

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
    populateLeagueSelect();
    clearScheduleSuggestions();
    setScheduleStatus("Schedule suggestions are unavailable until the CSV catalog loads.", "error");

    setCatalogStatus(`Failed to load CSV catalog: ${String(error?.message || error)}`, "error");
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
  const current = String(state.pendingRestoredLeagueSelection || els.generateLeagueSelect.value || "").trim();
  const options = [`<option value="">Auto-detect from teams</option>`];

  for (const league of state.leagues) {
    options.push(
      `<option value="${escapeHtml(league.id)}">${escapeHtml(league.name)} (${escapeHtml(league.key)})</option>`
    );
  }

  els.generateLeagueSelect.innerHTML = options.join("");
  if (current && state.leagues.some((league) => String(league.id) === current)) {
    els.generateLeagueSelect.value = current;
  }
  state.pendingRestoredLeagueSelection = "";
  renderDeterministicContext();
}

async function refreshLeagueScheduleSuggestions({ force = false } = {}) {
  const requestId = state.scheduleRequestId + 1;
  state.scheduleRequestId = requestId;
  const selectedLeagueId = String(els.generateLeagueSelect.value || "").trim();
  const selectedLeague = state.leagues.find((league) => String(league.id || "") === selectedLeagueId) || null;
  const scheduleLeagueCode = resolveScheduleLeagueCode(selectedLeague);

  if (!selectedLeague || !scheduleLeagueCode) {
    state.isScheduleLoading = false;
    syncActionState();
    clearScheduleSuggestions();
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
    (snapshotMode === "immediate-week" || snapshotMode === "immediate-two-weeks");

  if (canUseSavedSnapshot) {
    applyScheduleSnapshot(scheduleLeagueCode, savedSnapshot, { reason: "snapshot" });
    uiLog.info("schedule.snapshot_restored", {
      requestId,
      league: scheduleLeagueCode,
      fixtures: savedSnapshot.fixtures.length,
      referenceNow: savedSnapshot.referenceNowIso || state.referenceNowIso,
    });
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
  }

  state.isScheduleLoading = true;
  setButtonBusy(els.refreshScheduleBtn, true, force ? "Refetching..." : "Loading...");
  syncActionState();
  setScheduleStatus(`Loading upcoming ${String(scheduleLeagueCode || "").toUpperCase()} fixtures...`, "working");
  if (!hasWarmCache) {
    els.generateFixtureSummary.textContent = "Loading upcoming fixtures...";
    els.generateFixtureResults.innerHTML = `<div class="schedule-browser-empty">Loading upcoming fixtures...</div>`;
  }
  uiLog.info("schedule.load_start", {
    requestId,
    force,
    league: scheduleLeagueCode,
    warmCache: hasWarmCache,
  });

  try {
    const payload = await fetchUpcomingFixturesForLeague(scheduleLeagueCode, {
      refresh: true,
      referenceNowIso: state.referenceNowIso,
    });
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
    if (els.generateEventNameInput.value.trim()) {
      applySelectedScheduleFixture(els.generateEventNameInput.value, { fromManualEntry: true, silent: true });
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
    clearScheduleSuggestions();
    setScheduleStatus(`Could not load upcoming ${String(scheduleLeagueCode || "").toUpperCase()} fixtures: ${String(error?.message || error)}`, "error");
    uiLog.error("schedule.load_failed", {
      requestId,
      league: scheduleLeagueCode,
      message: String(error?.message || error),
    });
  } finally {
    if (requestId === state.scheduleRequestId) {
      state.isScheduleLoading = false;
      setButtonBusy(els.refreshScheduleBtn, false, "Refetch Fixtures");
      syncActionState();
    }
  }
}

function renderScheduleSuggestions(fixtures, selectedWeek, selectedLabel, leagueCode) {
  const datalistOptions = [];
  const selectOptions = [`<option value="">Pick an upcoming fixture</option>`];

  for (const fixture of fixtures || []) {
    const eventName = String(fixture?.eventName || "").trim();
    const label = String(fixture?.optionLabel || eventName).trim();
    if (!eventName) {
      continue;
    }

    datalistOptions.push(`<option value="${escapeHtml(eventName)}" label="${escapeHtml(label)}"></option>`);
    selectOptions.push(`<option value="${escapeHtml(eventName)}">${escapeHtml(label)}</option>`);
  }

  els.generateEventNameSuggestions.innerHTML = datalistOptions.join("");
  els.generateEventFixtureSelect.innerHTML = selectOptions.join("");
  renderScheduleFixtureBrowser(fixtures, { selectedWeek, selectedLabel, leagueCode });

  const currentEventName = String(els.generateEventNameInput.value || "").trim();
  if (currentEventName && (fixtures || []).some((fixture) => String(fixture?.eventName || "") === currentEventName)) {
    els.generateEventFixtureSelect.value = currentEventName;
  } else {
    els.generateEventFixtureSelect.value = "";
  }

  if (!fixtures || fixtures.length === 0) {
    setScheduleStatus("No upcoming fixtures were found for this league in the schedule API.", "warn");
    return;
  }

  const weekLabel = selectedLabel || (Number.isInteger(selectedWeek) ? `Matchday ${selectedWeek}` : "Upcoming fixtures");
  setScheduleStatus(`${weekLabel} loaded from ${String(leagueCode || "").toUpperCase()} schedule API. Pick a fixture or keep typing manually.`, "success");
}

function applyScheduleSnapshot(leagueCode, snapshot, { reason = "snapshot" } = {}) {
  const fixtures = Array.isArray(snapshot?.fixtures) ? snapshot.fixtures : [];
  state.upcomingScheduleLeagueCode = String(leagueCode || "").trim().toLowerCase();
  state.upcomingScheduleWeek = Number.isInteger(snapshot?.selectedWeek) ? snapshot.selectedWeek : null;
  state.upcomingScheduleLabel = String(snapshot?.selectedLabel || "").trim();
  state.upcomingScheduleFixtures = fixtures;
  renderScheduleSuggestions(fixtures, state.upcomingScheduleWeek, state.upcomingScheduleLabel, state.upcomingScheduleLeagueCode);
  renderDeterministicContext();

  const weekLabel = state.upcomingScheduleLabel || (state.upcomingScheduleWeek ? `Matchday ${state.upcomingScheduleWeek}` : "Upcoming fixtures");
  const referenceNow = normalizeReferenceNowIso(snapshot?.referenceNowIso || state.referenceNowIso);
  const sourceNote = reason === "snapshot" ? "Using deterministic saved snapshot." : "Using deterministic fetched snapshot.";
  setScheduleStatus(
    `${weekLabel} loaded from ${String(leagueCode || "").toUpperCase()} schedule API. ${sourceNote} Reference UTC: ${referenceNow || "unknown"}.`,
    "success"
  );
}

function clearScheduleSuggestions() {
  state.upcomingScheduleLeagueCode = "";
  state.upcomingScheduleWeek = null;
  state.upcomingScheduleLabel = "";
  state.upcomingScheduleFixtures = [];
  state.scheduleCursorEventName = "";
  els.generateFixtureSearchInput.value = "";
  els.generateEventNameSuggestions.innerHTML = "";
  els.generateEventFixtureSelect.innerHTML = `<option value="">Pick a fixture after selecting a supported league</option>`;
  els.generateEventFixtureSelect.value = "";
  els.generateFixtureSummary.textContent = "Select a supported league to browse upcoming fixtures.";
  els.generateFixtureResults.innerHTML = `<div class="schedule-browser-empty">No schedule loaded yet.</div>`;
  renderScheduleActiveSummary(null, { leagueCode: "" });
  renderDeterministicContext();
  renderGenerateReadiness();
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

function applySelectedScheduleFixture(rawEventName, { fromManualEntry = false, silent = false } = {}) {
  const eventName = String(rawEventName || "").trim();
  if (!eventName || !Array.isArray(state.upcomingScheduleFixtures) || state.upcomingScheduleFixtures.length === 0) {
    if (!eventName) {
      els.generateEventFixtureSelect.value = "";
    }
    renderScheduleFixtureBrowser(state.upcomingScheduleFixtures, {
      selectedWeek: state.upcomingScheduleWeek,
      selectedLabel: state.upcomingScheduleLabel,
      leagueCode: state.upcomingScheduleLeagueCode,
    });
    return null;
  }

  const normalizedTarget = normalizeForSearch(eventName);
  const fixture = state.upcomingScheduleFixtures.find((entry) => normalizeForSearch(entry?.eventName) === normalizedTarget) || null;
  if (!fixture) {
    els.generateEventFixtureSelect.value = "";
    if (fromManualEntry) {
      renderScheduleFixtureBrowser(state.upcomingScheduleFixtures, {
        selectedWeek: state.upcomingScheduleWeek,
        selectedLabel: state.upcomingScheduleLabel,
        leagueCode: state.upcomingScheduleLeagueCode,
      });
    }
    return null;
  }

  els.generateEventNameInput.value = fixture.eventName;
  els.generateEventFixtureSelect.value = fixture.eventName;
  els.generateFixtureDateInput.value = String(fixture.fixtureDate || "");
  els.generateKickoffTimeInput.value = String(fixture.kickoffTimeUtc || "");
  els.generateMatchDayInput.value = String(fixture.matchDay || "");
  state.scheduleCursorEventName = fixture.eventName;
  renderScheduleFixtureBrowser(state.upcomingScheduleFixtures, {
    selectedWeek: state.upcomingScheduleWeek,
    selectedLabel: state.upcomingScheduleLabel,
    leagueCode: state.upcomingScheduleLeagueCode,
  });
  persistInputSnapshot();

  if (!silent) {
    showToast("Fixture schedule applied to Event Setup.", "success");
  }

  return fixture;
}

function renderScheduleFixtureBrowser(fixtures, { selectedWeek = null, selectedLabel = "", leagueCode = "" } = {}) {
  const allFixtures = Array.isArray(fixtures) ? fixtures : [];
  const filter = normalizeForSearch(els.generateFixtureSearchInput.value || "");
  const selectedEventName = normalizeForSearch(els.generateEventNameInput.value || "");
  const filteredFixtures = !filter
    ? allFixtures
    : allFixtures.filter((fixture) => {
        const haystack = normalizeForSearch(
          `${fixture?.eventName || ""} ${fixture?.optionLabel || ""} ${fixture?.fixtureDate || ""} ${fixture?.kickoffTimeUtc || ""}`
        );
        return haystack.includes(filter);
      });

  const selectedFixture =
    allFixtures.find((fixture) => normalizeForSearch(fixture?.eventName) === selectedEventName) || null;

  const summaryParts = [];
  if (leagueCode) {
    summaryParts.push(String(leagueCode).toUpperCase());
  }
  if (selectedLabel) {
    summaryParts.push(selectedLabel);
  } else if (Number.isInteger(selectedWeek)) {
    summaryParts.push(`Matchday ${selectedWeek}`);
  }
  summaryParts.push(`${allFixtures.length} fixture${allFixtures.length === 1 ? "" : "s"} loaded`);
  if (filter) {
    summaryParts.push(`${filteredFixtures.length} match${filteredFixtures.length === 1 ? "" : "es"} shown`);
  }
  els.generateFixtureSummary.textContent = summaryParts.join(" · ");
  syncScheduleCursor(filteredFixtures, selectedFixture);
  renderScheduleActiveSummary(selectedFixture, { leagueCode, selectedLabel });

  if (!allFixtures.length) {
    els.generateFixtureResults.innerHTML = `<div class="schedule-browser-empty">No fixtures loaded for this league yet.</div>`;
    return;
  }

  if (!filteredFixtures.length) {
    els.generateFixtureResults.innerHTML = `<div class="schedule-browser-empty">No fixtures match the current filter.</div>`;
    return;
  }

  els.generateFixtureResults.innerHTML = filteredFixtures
    .map((fixture) => {
      const eventName = String(fixture?.eventName || "").trim();
      const gameId = String(fixture?.gameId || fixture?.game_id || "").trim();
      const isSelected = normalizeForSearch(eventName) === selectedEventName;
      const isCursor = normalizeForSearch(eventName) === normalizeForSearch(state.scheduleCursorEventName);
      const metaLine = buildScheduleFixtureMetaLine(fixture);
      const optionId = `schedule-option-${fixture.gameId || normalizeForSearch(eventName).replace(/[^a-z0-9]+/g, "-")}`;
      return (
        `<button type="button" id="${escapeHtml(optionId)}" class="schedule-fixture-btn${isSelected ? " is-selected" : ""}${isCursor ? " is-cursor" : ""}" ` +
        `data-event-name="${escapeHtml(eventName)}" role="option" aria-selected="${isSelected ? "true" : "false"}" aria-pressed="${isSelected ? "true" : "false"}">` +
        `<span class="schedule-fixture-copy">` +
        `<span class="schedule-fixture-name">${escapeHtml(eventName)}</span>` +
        `<span class="schedule-fixture-meta">${escapeHtml(metaLine)}</span>` +
        (gameId ? `<span class="schedule-fixture-id">Game ID ${escapeHtml(gameId)}</span>` : ``) +
        `</span>` +
        `<span class="schedule-fixture-cta">${isSelected ? "Applied" : "Apply"}</span>` +
        `</button>`
      );
    })
    .join("");

  const cursorFixture = filteredFixtures.find(
    (fixture) => normalizeForSearch(fixture?.eventName) === normalizeForSearch(state.scheduleCursorEventName)
  );
  const cursorId = cursorFixture
    ? `schedule-option-${cursorFixture.gameId || normalizeForSearch(cursorFixture.eventName).replace(/[^a-z0-9]+/g, "-")}`
    : "";
  if (cursorId) {
    els.generateFixtureResults.setAttribute("aria-activedescendant", cursorId);
  } else {
    els.generateFixtureResults.removeAttribute("aria-activedescendant");
  }
}

function syncScheduleCursor(fixtures, selectedFixture = null) {
  const list = Array.isArray(fixtures) ? fixtures : [];
  if (list.length === 0) {
    state.scheduleCursorEventName = "";
    return;
  }

  const currentCursor = normalizeForSearch(state.scheduleCursorEventName);
  if (currentCursor && list.some((fixture) => normalizeForSearch(fixture?.eventName) === currentCursor)) {
    return;
  }

  state.scheduleCursorEventName = selectedFixture?.eventName || list[0]?.eventName || "";
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
    metaParts.push(String(leagueCode).toUpperCase());
  }
  if (selectedLabel) {
    metaParts.push(selectedLabel);
  } else if (Number.isInteger(fixture.matchDay)) {
    metaParts.push(`Matchday ${fixture.matchDay}`);
  }
  metaParts.push(`${fixture.fixtureDate} · ${fixture.kickoffTimeUtc} UTC`);
  const gameId = String(fixture?.gameId || fixture?.game_id || "").trim();
  if (gameId) {
    metaParts.push(`Game ID ${gameId}`);
  }

  els.generateFixtureActiveTitle.textContent = String(fixture.eventName || "");
  els.generateFixtureActiveMeta.textContent = metaParts.join(" · ");
  els.generateFixtureActiveState.textContent = "Applied to Event Setup";
  els.generateFixtureActiveState.className = "schedule-active-state is-applied";
  els.generateFixtureActiveSummary.classList.remove("is-empty");
  renderGenerateReadiness();
}

function syncScheduleActiveSelection() {
  renderScheduleFixtureBrowser(state.upcomingScheduleFixtures, {
    selectedWeek: state.upcomingScheduleWeek,
    selectedLabel: state.upcomingScheduleLabel,
    leagueCode: state.upcomingScheduleLeagueCode,
  });
}

function handleScheduleBrowserKeydown(event) {
  const fixtures = getVisibleScheduleFixtures();
  if (!fixtures.length) {
    return;
  }

  if (event.key === "ArrowDown" || event.key === "ArrowUp" || event.key === "Home" || event.key === "End") {
    event.preventDefault();
    moveScheduleCursor(event.key, fixtures);
    return;
  }

  if (event.key === "Enter") {
    const cursorEventName = String(state.scheduleCursorEventName || "").trim();
    if (!cursorEventName) {
      return;
    }
    event.preventDefault();
    applySelectedScheduleFixture(cursorEventName);
  }
}

function getVisibleScheduleFixtures() {
  const allFixtures = Array.isArray(state.upcomingScheduleFixtures) ? state.upcomingScheduleFixtures : [];
  const filter = normalizeForSearch(els.generateFixtureSearchInput.value || "");
  if (!filter) {
    return allFixtures;
  }
  return allFixtures.filter((fixture) => {
    const haystack = normalizeForSearch(
      `${fixture?.eventName || ""} ${fixture?.optionLabel || ""} ${fixture?.fixtureDate || ""} ${fixture?.kickoffTimeUtc || ""}`
    );
    return haystack.includes(filter);
  });
}

function moveScheduleCursor(key, fixtures) {
  const list = Array.isArray(fixtures) ? fixtures : [];
  if (!list.length) {
    return;
  }

  const currentIndex = list.findIndex(
    (fixture) => normalizeForSearch(fixture?.eventName) === normalizeForSearch(state.scheduleCursorEventName)
  );
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

  state.scheduleCursorEventName = list[nextIndex]?.eventName || "";
  renderScheduleFixtureBrowser(state.upcomingScheduleFixtures, {
    selectedWeek: state.upcomingScheduleWeek,
    selectedLabel: state.upcomingScheduleLabel,
    leagueCode: state.upcomingScheduleLeagueCode,
  });
  scrollScheduleCursorIntoView();
}

function scrollScheduleCursorIntoView() {
  const cursorEventName = String(state.scheduleCursorEventName || "").trim();
  if (!cursorEventName) {
    return;
  }

  const buttons = Array.from(els.generateFixtureResults.querySelectorAll(".schedule-fixture-btn"));
  const button = buttons.find(
    (candidate) => String(candidate.getAttribute("data-event-name") || "") === cursorEventName
  );
  if (button && typeof button.scrollIntoView === "function") {
    button.scrollIntoView({ block: "nearest" });
  }
}

function buildScheduleFixtureMetaLine(fixture) {
  const kickoff = String(fixture?.kickoffIso || "").trim();
  const gameId = String(fixture?.gameId || fixture?.game_id || "").trim();
  if (!kickoff) {
    const base = String(fixture?.roundLabel || (fixture?.matchDay ? `Matchday ${fixture.matchDay}` : "")).trim();
    return gameId ? `${base} · Game ID ${gameId}`.trim() : base;
  }

  const parsed = new Date(kickoff);
  if (Number.isNaN(parsed.getTime())) {
    const roundSuffix = fixture?.matchDay ? `Matchday ${fixture.matchDay}` : String(fixture?.roundLabel || "");
    const base = `${String(fixture?.fixtureDate || "")} · ${String(fixture?.kickoffTimeUtc || "")} UTC · ${roundSuffix}`.trim();
    return gameId ? `${base} · Game ID ${gameId}` : base;
  }

  const weekday = parsed.toLocaleDateString("en-US", { weekday: "short", timeZone: "UTC" });
  const month = parsed.toLocaleDateString("en-US", { month: "short", timeZone: "UTC" });
  const day = parsed.toLocaleDateString("en-US", { day: "numeric", timeZone: "UTC" });
  const hh = String(parsed.getUTCHours()).padStart(2, "0");
  const mm = String(parsed.getUTCMinutes()).padStart(2, "0");
  const roundSuffix = fixture?.matchDay ? `Matchday ${fixture.matchDay}` : String(fixture?.roundLabel || "");
  const base = `${weekday}, ${month} ${day} · ${hh}:${mm} UTC · ${roundSuffix}`.trim();
  return gameId ? `${base} · Game ID ${gameId}` : base;
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

    if (mode === "fixture" || mode === "both") {
      fixtureResult = verifyFixtureJsonStrict(fixtureParse.value, {
        leagues: state.leagues,
        teams: state.teams,
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
        }
      );
    }

    if (mode === "both") {
      bundleResult = verifyBundleConsistency(fixtureParse.value, parentParse.value, {
        leagues: state.leagues,
        teams: state.teams,
      }, {
        now: referenceNow,
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

async function handleGenerate() {
  if (state.isCatalogLoading || state.isVerifying || state.isGenerating) {
    return;
  }

  applySelectedScheduleFixture(els.generateEventNameInput.value, { fromManualEntry: true, silent: true });

  state.isGenerating = true;
  syncActionState();
  setOverviewCard("generate", {
    value: "Generating",
    note: "Building fixture + parent market JSON",
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
        now: referenceNow,
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
        ? "Generation completed and strict verification passed."
        : `Generation failed with ${result.errors.length} error(s).`,
      tone: result.ok ? (result.warnings.length > 0 ? "warn" : "success") : "error",
      sections,
      counts: {
        errors: result.errors.length,
        warnings: result.warnings.length,
        info: result.info.length,
      },
    });

    renderJsonOutputs(result.fixtureJson, result.parentPayload);

    if (result.ok && result.fixtureJson && result.parentPayload) {
      els.fixtureInputJson.value = JSON.stringify(result.fixtureJson, null, 2);
      els.parentInputJson.value = JSON.stringify(result.parentPayload, null, 2);
      state.persistFixtureInput = false;
      state.persistParentInput = false;
      updateJsonMeta("fixture");
      updateJsonMeta("parent");
      persistInputSnapshot();
      scheduleAutoVerify({ immediate: true });
    }

    uiLog.info("generate.complete", {
      ok: result.ok,
      errors: result.errors.length,
      warnings: result.warnings.length,
    });
  } finally {
    state.isGenerating = false;
    setButtonBusy(els.generateBtn, false, "Generate Fixture + Parent JSON");
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

function renderJsonOutputs(fixtureJson, parentPayload) {
  renderJsonOutputBlock(
    els.generatedFixtureOutput,
    fixtureJson ? JSON.stringify(fixtureJson, null, 2) : "",
    "Generated fixture JSON appears here after a successful run."
  );
  renderJsonOutputBlock(
    els.generatedParentOutput,
    parentPayload ? JSON.stringify(parentPayload, null, 2) : "",
    "Generated parent market JSON appears here after a successful run."
  );
}

function renderJsonOutputBlock(element, content, emptyMessage) {
  const text = String(content || "").trim();
  const isEmpty = !text;
  element.textContent = isEmpty ? emptyMessage : text;
  element.classList.toggle("is-empty", isEmpty);
  element.dataset.empty = isEmpty ? "true" : "false";

  const block = element.closest(".output-block");
  if (block) {
    block.dataset.tone = isEmpty ? "idle" : "active";
  }

  updateOutputStateBadge(element.id, !isEmpty);
  if (element === els.generatedFixtureOutput || element === els.generatedParentOutput) {
    renderGenerateReadiness();
  }
}

function updateOutputStateBadge(outputId, ready) {
  const badgeByOutputId = {
    generatedFixtureOutput: els.generatedFixtureState,
    generatedParentOutput: els.generatedParentState,
  };
  const badge = badgeByOutputId[outputId];
  if (!badge) {
    return;
  }

  badge.textContent = ready ? "Ready to copy" : "Waiting";
  badge.dataset.tone = ready ? "ready" : "idle";
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
  const scheduleLeagueCode = resolveScheduleLeagueCode(selectedLeague);
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
  const scheduleLeagueCode = resolveScheduleLeagueCode(selectedLeague);
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
  const selectedFixture =
    Array.isArray(state.upcomingScheduleFixtures)
      ? state.upcomingScheduleFixtures.find(
          (fixture) => normalizeForSearch(fixture?.eventName) === normalizeForSearch(eventName)
        ) || null
      : null;
  if (!eventName) {
    setPulseCard("Fixture", {
      value: "Awaiting event",
      note: "Type an event name manually or apply one from the upcoming fixture browser.",
      tone: "idle",
    });
  } else if (selectedFixture) {
    setPulseCard("Fixture", {
      value: selectedFixture.eventName,
      note: `${selectedFixture.fixtureDate} · ${selectedFixture.kickoffTimeUtc} UTC · Matchday ${selectedFixture.matchDay}`,
      tone: "success",
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
  const typeRef = String(els.generateTypeRefInput?.value || "").trim();
  if (fixtureReady && parentReady) {
    setPulseCard("Output", {
      value: "Payloads ready to copy",
      note: `${typeRef ? "Type reference locked." : "Type reference optional."} Generated payloads are also pushed into Verify automatically.`,
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
      note: "Run generation to create CSV-verified fixture and parent market payloads.",
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
  const selectedLeagueId = String(els.generateLeagueSelect?.value || "").trim();
  const selectedLeague = state.leagues.find((league) => String(league.id || "") === selectedLeagueId) || null;
  const hasScheduleSource = Boolean(selectedLeague && resolveScheduleLeagueCode(selectedLeague));

  els.reloadCatalogBtn.disabled = state.isCatalogLoading || state.isVerifying || state.isGenerating;
  els.verifyBothBtn.disabled = !canRun;
  els.verifyFixtureBtn.disabled = !canRun;
  els.verifyParentBtn.disabled = !canRun;
  els.generateBtn.disabled = !canRun;
  if (els.refreshScheduleBtn) {
    els.refreshScheduleBtn.disabled =
      state.isCatalogLoading || state.isVerifying || state.isGenerating || state.isScheduleLoading || !hasScheduleSource;
  }
  els.generateEventFixtureSelect.disabled = state.isScheduleLoading || state.isCatalogLoading;
  els.generateFixtureSearchInput.disabled = state.isScheduleLoading || state.isCatalogLoading || state.upcomingScheduleFixtures.length === 0;
  els.copyVerifyReportBtn.disabled = !canCopyReport;
  els.copyGeneratedFixtureBtn.disabled = busy || !hasGeneratedFixture;
  els.copyGeneratedParentBtn.disabled = busy || !hasGeneratedParent;
  els.copyGenerationStatusBtn.disabled = busy;
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
