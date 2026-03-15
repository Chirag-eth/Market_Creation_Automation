import { fetchCatalogPayload, normalizeCatalogPayload } from "./catalog.js";
import { createLogger } from "./logger.js";
import { loadSnapshot, saveSnapshot } from "./persistence.js";
import {
  generateBulkVaultPayloadsFromInput,
  generateFromEventInput,
  generateVaultPayloadFromInput,
  parseJsonInput,
  verifyBundleConsistency,
  verifyFixtureJsonStrict,
  verifyParentMarketJsonStrict,
} from "./verifier.js";
import { escapeHtml } from "./util.js";

const uiLog = createLogger("ui");
let resultPanelRenderId = 0;

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
  lastVerifyReportText: "",
  isCatalogLoading: false,
  isVerifying: false,
  isGenerating: false,
  isGeneratingVault: false,
  toastTimerId: null,
  lastVaultBulkOutputText: "",
  lastVaultOutputText: "",
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
  seedDefaults();
  restoreInputSnapshot();
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
  setOverviewCard("vault", {
    value: "Ready",
    note: "Single and bulk vault formatter",
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
  renderVaultStatus({
    summary: "Waiting for vault formatter input.",
    tone: "neutral",
    sections: [],
    counts: null,
  });
  renderVaultBulkStatus({
    summary: "Waiting for vault bulk input.",
    tone: "neutral",
    sections: [],
    counts: null,
  });
  renderJsonOutputs(null, null);
  renderVaultOutput(null);
  renderVaultBulkOutput([]);
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
    "vaultOverviewCard",
    "vaultOverviewValue",
    "vaultOverviewNote",
    "verifyToggleBtn",
    "verifyToggleCaption",
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
    "generateLeagueSelect",
    "generateTypeRefInput",
    "generateFixtureDateInput",
    "generateKickoffTimeInput",
    "generateMatchDayInput",
    "generateMatchWeekInput",
    "generateLocationInput",
    "generateVenueInput",
    "generateBtn",
    "copyGenerationStatusBtn",
    "generationStatus",
    "generatedFixtureOutput",
    "generatedParentOutput",
    "copyGeneratedFixtureBtn",
    "copyGeneratedParentBtn",
    "vaultFixtureNameInput",
    "vaultYesTokenInput",
    "vaultNoTokenInput",
    "vaultLeagueCodeSelect",
    "vaultMarketIdInput",
    "vaultMarketPrefixInput",
    "vaultGenerateBtn",
    "copyVaultStatusBtn",
    "copyVaultOutputBtn",
    "vaultStatus",
    "vaultOutput",
    "vaultBulkRowsInput",
    "vaultBulkFileInput",
    "vaultBulkUploadBtn",
    "vaultBulkClearBtn",
    "vaultBulkFileMeta",
    "vaultBulkMappingInput",
    "vaultBulkMappingFileInput",
    "vaultBulkMappingUploadBtn",
    "vaultBulkMappingClearBtn",
    "vaultBulkMappingFileMeta",
    "vaultBulkGenerateBtn",
    "copyVaultBulkStatusBtn",
    "copyVaultBulkOutputBtn",
    "vaultBulkStatus",
    "vaultBulkOutput",
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

  els.verifyToggleBtn.addEventListener("click", () => {
    const shouldOpen = els.verifyEditor.hidden;
    setVerifyEditorOpen(shouldOpen);
    if (shouldOpen) {
      els.fixtureInputJson.focus();
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

  els.copyGenerationStatusBtn.addEventListener("click", () => {
    void copyOutputText(els.generationStatus.innerText || "", "Generation status copied.");
  });

  els.vaultGenerateBtn.addEventListener("click", () => {
    void handleVaultGenerate();
  });

  els.vaultBulkGenerateBtn.addEventListener("click", () => {
    void handleVaultBulkGenerate();
  });

  els.vaultBulkFileInput.addEventListener("change", () => {
    void handleVaultBulkFileLoad();
  });

  els.vaultBulkMappingFileInput.addEventListener("change", () => {
    void handleVaultBulkMappingFileLoad();
  });

  els.vaultBulkUploadBtn.addEventListener("click", () => {
    els.vaultBulkFileInput.click();
  });

  els.vaultBulkMappingUploadBtn.addEventListener("click", () => {
    els.vaultBulkMappingFileInput.click();
  });

  els.vaultBulkClearBtn.addEventListener("click", () => {
    els.vaultBulkRowsInput.value = "";
    els.vaultBulkFileMeta.textContent = "No vault bulk file loaded";
    els.vaultBulkFileInput.value = "";
    renderVaultBulkOutput([]);
    persistInputSnapshot();
    showToast("Vault bulk rows cleared.", "info");
    syncActionState();
  });

  els.vaultBulkMappingClearBtn.addEventListener("click", () => {
    els.vaultBulkMappingInput.value = "";
    els.vaultBulkMappingFileMeta.textContent = "No vault mapping file loaded";
    els.vaultBulkMappingFileInput.value = "";
    persistInputSnapshot();
    showToast("Vault mapping rows cleared.", "info");
    syncActionState();
  });

  els.copyVaultStatusBtn.addEventListener("click", () => {
    void copyOutputText(els.vaultStatus.innerText || "", "Vault status copied.");
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

  els.copyVaultOutputBtn.addEventListener("click", () => {
    void copyOutputText(els.vaultOutput.textContent || "", "Vault JSON copied.");
  });

  els.copyVaultBulkStatusBtn.addEventListener("click", () => {
    void copyOutputText(els.vaultBulkStatus.innerText || "", "Vault bulk status copied.");
  });

  els.copyVaultBulkOutputBtn.addEventListener("click", () => {
    void copyOutputText(els.vaultBulkOutput.textContent || "", "Vault bulk JSON copied.");
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
    if (!toggle) {
      return;
    }

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
  });

  bindInputPersistence();
}

function seedDefaults() {
  const todayIso = new Date().toISOString().slice(0, 10);
  els.generateFixtureDateInput.value = todayIso;
  els.generateKickoffTimeInput.value = "20:00";
  els.generateMatchDayInput.value = "1";
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
    els.vaultFixtureNameInput,
    els.vaultYesTokenInput,
    els.vaultNoTokenInput,
    els.vaultMarketIdInput,
    els.vaultMarketPrefixInput,
    els.vaultBulkRowsInput,
    els.vaultBulkMappingInput,
  ];

  for (const element of persistOnInput) {
    element.addEventListener("input", persistInputSnapshot);
  }

  const persistOnChange = [
    els.generateLeagueSelect,
    els.vaultLeagueCodeSelect,
  ];

  for (const element of persistOnChange) {
    element.addEventListener("change", persistInputSnapshot);
  }
}

function persistInputSnapshot() {
  saveSnapshot({
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
    vault: {
      fixtureName: String(els.vaultFixtureNameInput.value || ""),
      yesTokenId: String(els.vaultYesTokenInput.value || ""),
      noTokenId: String(els.vaultNoTokenInput.value || ""),
      leagueCode: String(els.vaultLeagueCodeSelect.value || ""),
      marketId: String(els.vaultMarketIdInput.value || ""),
      marketPrefix: String(els.vaultMarketPrefixInput.value || ""),
    },
    vaultBulk: {
      rowsText: String(els.vaultBulkRowsInput.value || ""),
      mappingText: String(els.vaultBulkMappingInput.value || ""),
    },
  });
}

function restoreInputSnapshot() {
  const snapshot = loadSnapshot();
  if (!snapshot || typeof snapshot !== "object") {
    return;
  }

  const verify = snapshot.verify && typeof snapshot.verify === "object" ? snapshot.verify : {};
  const generate = snapshot.generate && typeof snapshot.generate === "object" ? snapshot.generate : {};
  const vault = snapshot.vault && typeof snapshot.vault === "object" ? snapshot.vault : {};
  const vaultBulk = snapshot.vaultBulk && typeof snapshot.vaultBulk === "object" ? snapshot.vaultBulk : {};

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

  els.vaultFixtureNameInput.value = asRestoredString(vault.fixtureName);
  els.vaultYesTokenInput.value = asRestoredString(vault.yesTokenId);
  els.vaultNoTokenInput.value = asRestoredString(vault.noTokenId);
  els.vaultLeagueCodeSelect.value = asRestoredString(vault.leagueCode) || els.vaultLeagueCodeSelect.value;
  els.vaultMarketIdInput.value = asRestoredString(vault.marketId);
  els.vaultMarketPrefixInput.value = asRestoredString(vault.marketPrefix);

  els.vaultBulkRowsInput.value = asRestoredString(vaultBulk.rowsText);
  els.vaultBulkMappingInput.value = asRestoredString(vaultBulk.mappingText);

  if (els.vaultBulkRowsInput.value.trim()) {
    els.vaultBulkFileMeta.textContent = "Cached bulk vault rows restored";
  }

  if (els.vaultBulkMappingInput.value.trim()) {
    els.vaultBulkMappingFileMeta.textContent = "Cached vault mapping rows restored";
  }
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
}

async function handleVerify(mode, { background = false } = {}) {
  if (state.isCatalogLoading || state.isVerifying || state.isGenerating || state.isGeneratingVault) {
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
        }
      );
    }

    if (mode === "both") {
      bundleResult = verifyBundleConsistency(fixtureParse.value, parentParse.value, {
        leagues: state.leagues,
        teams: state.teams,
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
    if (uniqueInfo.length > 0) {
      sections.push({ title: "Info", items: uniqueInfo });
    }

    const payload = {
      summary,
      tone: ok ? (uniqueWarnings.length > 0 ? "warn" : "success") : "error",
      sections,
      counts: {
        errors: uniqueErrors.length,
        warnings: uniqueWarnings.length,
        info: uniqueInfo.length,
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
  if (state.isCatalogLoading || state.isVerifying || state.isGenerating || state.isGeneratingVault) {
    return;
  }

  state.isGenerating = true;
  syncActionState();
  setOverviewCard("generate", {
    value: "Generating",
    note: "Building fixture + parent market JSON",
    tone: "working",
  });
  setButtonBusy(els.generateBtn, true, "Generating...");

  try {
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

async function handleVaultBulkFileLoad() {
  const file = els.vaultBulkFileInput.files && els.vaultBulkFileInput.files[0] ? els.vaultBulkFileInput.files[0] : null;
  if (!file) {
    return;
  }

  try {
    const text = await file.text();
    els.vaultBulkRowsInput.value = text;
    els.vaultBulkFileMeta.textContent = `${file.name} loaded · ${countNonEmptyLines(text)} line(s)`;
    persistInputSnapshot();
    showToast("Vault bulk file loaded.", "success");
    uiLog.info("vault.bulk_file_loaded", {
      fileName: file.name,
      size: file.size,
      lines: countNonEmptyLines(text),
    });
    renderVaultBulkOutput([]);
    await maybeAutoGenerateVaultBulk();
  } catch (error) {
    els.vaultBulkFileMeta.textContent = "Failed to read vault bulk file";
    showToast("Failed to read vault bulk file.", "error");
    uiLog.error("vault.bulk_file_load_failed", {
      fileName: file.name,
      message: String(error?.message || error),
    });
  } finally {
    els.vaultBulkFileInput.value = "";
    syncActionState();
  }
}

async function handleVaultBulkMappingFileLoad() {
  const file = els.vaultBulkMappingFileInput.files && els.vaultBulkMappingFileInput.files[0]
    ? els.vaultBulkMappingFileInput.files[0]
    : null;
  if (!file) {
    return;
  }

  try {
    const text = await file.text();
    els.vaultBulkMappingInput.value = text;
    els.vaultBulkMappingFileMeta.textContent = `${file.name} loaded · ${countNonEmptyLines(text)} line(s)`;
    persistInputSnapshot();
    showToast("Vault mapping file loaded.", "success");
    uiLog.info("vault.mapping_file_loaded", {
      fileName: file.name,
      size: file.size,
      lines: countNonEmptyLines(text),
    });
    renderVaultBulkOutput([]);
    await maybeAutoGenerateVaultBulk();
  } catch (error) {
    els.vaultBulkMappingFileMeta.textContent = "Failed to read vault mapping file";
    showToast("Failed to read vault mapping file.", "error");
    uiLog.error("vault.mapping_file_load_failed", {
      fileName: file.name,
      message: String(error?.message || error),
    });
  } finally {
    els.vaultBulkMappingFileInput.value = "";
    syncActionState();
  }
}

async function maybeAutoGenerateVaultBulk() {
  if (!String(els.vaultBulkRowsInput.value || "").trim()) {
    return;
  }

  if (state.isCatalogLoading || state.isVerifying || state.isGenerating || state.isGeneratingVault) {
    return;
  }

  await handleVaultBulkGenerate();
}

async function handleVaultGenerate() {
  if (state.isCatalogLoading || state.isVerifying || state.isGenerating || state.isGeneratingVault) {
    return;
  }

  state.isGeneratingVault = true;
  syncActionState();
  setOverviewCard("vault", {
    value: "Generating",
    note: "Building vault JSON payload",
    tone: "working",
  });
  setButtonBusy(els.vaultGenerateBtn, true, "Generating...");

  try {
    const result = generateVaultPayloadFromInput(
      {
        fixtureName: els.vaultFixtureNameInput.value,
        yesTokenId: els.vaultYesTokenInput.value,
        noTokenId: els.vaultNoTokenInput.value,
        leagueCode: els.vaultLeagueCodeSelect.value,
        marketId: els.vaultMarketIdInput.value,
        marketPrefix: els.vaultMarketPrefixInput.value,
      },
      {}
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

    renderVaultStatus({
      summary: result.ok
        ? "Vault JSON generated successfully."
        : `Vault generation failed with ${result.errors.length} error(s).`,
      tone: result.ok ? (result.warnings.length > 0 ? "warn" : "success") : "error",
      sections,
      counts: {
        errors: result.errors.length,
        warnings: result.warnings.length,
        info: result.info.length,
      },
    });

    renderVaultOutput(result.payload);
    state.lastVaultOutputText = result.payload ? JSON.stringify(result.payload, null, 2) : "";

    uiLog.info("vault.generate_complete", {
      ok: result.ok,
      errors: result.errors.length,
      warnings: result.warnings.length,
    });
  } finally {
    state.isGeneratingVault = false;
    setButtonBusy(els.vaultGenerateBtn, false, "Generate Vault JSON");
    syncActionState();
  }
}

async function handleVaultBulkGenerate() {
  if (state.isCatalogLoading || state.isVerifying || state.isGenerating || state.isGeneratingVault) {
    return;
  }

  state.isGeneratingVault = true;
  syncActionState();
  setOverviewCard("vault", {
    value: "Generating",
    note: "Building bulk vault JSON payloads",
    tone: "working",
  });
  setButtonBusy(els.vaultBulkGenerateBtn, true, "Generating...");

  try {
    const result = generateBulkVaultPayloadsFromInput(
      {
        rowsText: els.vaultBulkRowsInput.value,
        mappingText: els.vaultBulkMappingInput.value,
      },
      {}
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

    renderVaultBulkStatus({
      summary: result.ok
        ? `Bulk vault generation completed for ${result.payloads.length} payload(s).`
        : `Bulk vault generation failed with ${result.errors.length} error(s).`,
      tone: result.ok ? (result.warnings.length > 0 ? "warn" : "success") : "error",
      sections,
      counts: {
        errors: result.errors.length,
        warnings: result.warnings.length,
        info: result.info.length,
      },
    });

    renderVaultBulkOutput(result.payloads);
    state.lastVaultBulkOutputText = JSON.stringify(result.payloads || [], null, 2);

    uiLog.info("vault.bulk_generate_complete", {
      ok: result.ok,
      generated: result.payloads.length,
      errors: result.errors.length,
      warnings: result.warnings.length,
    });
  } finally {
    state.isGeneratingVault = false;
    setButtonBusy(els.vaultBulkGenerateBtn, false, "Generate Bulk Vault JSON");
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

function renderVaultStatus({ summary, tone, sections, counts }) {
  const panelClass = resultToneClass(tone);
  els.vaultStatus.className = `result-panel ${panelClass}`.trim();
  els.vaultStatus.innerHTML = buildResultHtml(summary, sections, counts);
  setOverviewCard("vault", deriveOverviewState(summary, tone, counts, {
    idleValue: "Ready",
    workingValue: "Generating",
  }));
}

function renderVaultBulkStatus({ summary, tone, sections, counts }) {
  const panelClass = resultToneClass(tone);
  els.vaultBulkStatus.className = `result-panel ${panelClass}`.trim();
  els.vaultBulkStatus.innerHTML = buildResultHtml(summary, sections, counts);
  setOverviewCard("vault", deriveOverviewState(summary, tone, counts, {
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

function renderVaultOutput(payload) {
  renderJsonOutputBlock(
    els.vaultOutput,
    payload ? JSON.stringify(payload, null, 2) : "",
    "Generated vault JSON appears here after a successful run."
  );
}

function renderVaultBulkOutput(payloads) {
  const hasPayloads = Array.isArray(payloads) && payloads.length > 0;
  renderJsonOutputBlock(
    els.vaultBulkOutput,
    hasPayloads ? JSON.stringify(payloads, null, 2) : "",
    "Generated bulk vault JSON appears here after a successful run."
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

  if (state.isCatalogLoading || state.isVerifying || state.isGenerating || state.isGeneratingVault) {
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

function setVerifyEditorOpen(open) {
  const isOpen = Boolean(open);
  els.verifyEditor.hidden = !isOpen;
  els.verifyToggleBtn.setAttribute("aria-expanded", String(isOpen));
  if (els.verifyToggleCaption) {
    els.verifyToggleCaption.textContent = isOpen
      ? "Editor open. Paste or inspect raw payloads here."
      : "Editor collapsed. Click to paste or inspect raw payloads.";
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
  const busy = state.isCatalogLoading || state.isVerifying || state.isGenerating || state.isGeneratingVault;
  const canRun = state.catalogLoaded && !busy;
  const canRunVault = !busy;
  const canCopyReport = !busy && Boolean(String(state.lastVerifyReportText || "").trim());
  const hasGeneratedFixture = els.generatedFixtureOutput?.dataset.empty !== "true";
  const hasGeneratedParent = els.generatedParentOutput?.dataset.empty !== "true";
  const hasGeneratedVault = els.vaultOutput?.dataset.empty !== "true";
  const hasGeneratedVaultBulk = els.vaultBulkOutput?.dataset.empty !== "true";

  els.reloadCatalogBtn.disabled = state.isCatalogLoading || state.isVerifying || state.isGenerating || state.isGeneratingVault;
  els.verifyBothBtn.disabled = !canRun;
  els.verifyFixtureBtn.disabled = !canRun;
  els.verifyParentBtn.disabled = !canRun;
  els.generateBtn.disabled = !canRun;
  els.vaultGenerateBtn.disabled = !canRunVault;
  els.vaultBulkGenerateBtn.disabled = !canRunVault;
  els.vaultBulkUploadBtn.disabled = busy;
  els.vaultBulkClearBtn.disabled = busy;
  els.vaultBulkMappingUploadBtn.disabled = busy;
  els.vaultBulkMappingClearBtn.disabled = busy;
  els.copyVerifyReportBtn.disabled = !canCopyReport;
  els.copyGeneratedFixtureBtn.disabled = busy || !hasGeneratedFixture;
  els.copyGeneratedParentBtn.disabled = busy || !hasGeneratedParent;
  els.copyGenerationStatusBtn.disabled = busy;
  els.copyVaultStatusBtn.disabled = busy;
  els.copyVaultOutputBtn.disabled = busy || !hasGeneratedVault;
  els.copyVaultBulkStatusBtn.disabled = busy;
  els.copyVaultBulkOutputBtn.disabled = busy || !hasGeneratedVaultBulk;
}

function countNonEmptyLines(value) {
  return String(value || "")
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter(Boolean).length;
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
