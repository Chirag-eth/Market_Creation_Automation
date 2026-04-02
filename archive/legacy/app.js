const FIXTURE_LOGO_URL = "https://public-assets.pred.app/market-assets/fixture_128x128.png";
const DRAW_LOGO_URL = "https://public-assets.pred.app/market-assets/Draw_128x128.png";
const DEFAULT_DRAW_THEME = "#D5D5D6";
const DEFAULT_FIXTURE_THEME = "#FFFFFF";
const DEFAULT_KICKOFF_TIME_UTC = "20:00";
const CATALOG_API_ENDPOINT = "/api/catalog";

// Fallback catalog used only if CSV loading fails.
let LEAGUES = [
  {
    key: "ucl",
    id: "cc0d8029-3294-417f-b04f-bdc4d7fb8675",
    name: "UEFA Champions League",
    slug: "ucl",
    aliases: ["uefa champions league", "champions league", "ucl", "uefa cl"],
  },
  {
    key: "epl",
    id: "00000000-0000-0000-0000-00000000e001",
    name: "Premier League",
    slug: "epl",
    aliases: ["premier league", "epl", "english premier league"],
  },
  {
    key: "laliga",
    id: "00000000-0000-0000-0000-00000000e002",
    name: "La Liga",
    slug: "laliga",
    aliases: ["la liga", "laliga", "spanish league"],
  },
  {
    key: "europa",
    id: "00000000-0000-0000-0000-00000000e003",
    name: "UEFA Europa League",
    slug: "uel",
    aliases: ["europa league", "uefa europa league", "uel"],
  },
];

let TEAMS = [
  {
    id: "5a263d1e-b4c6-4355-9eed-9304c891b3f1",
    name: "Real Madrid",
    alternateName: "Real Madrid CF",
    code: "RMA",
    slug: "real-madrid",
    themeColor: "#E0A000",
    logoUrl: "https://public-assets.pred.app/market-assets/UCL/Real-madrid_128x128.png",
    aliases: ["real madrid", "real madrid cf", "realmadrid", "r. madrid"],
  },
  {
    id: "cc3dadbb-972d-4e0d-8f90-85bacee8e366",
    name: "Benfica",
    alternateName: "SL Benfica",
    code: "BEN",
    slug: "benfica",
    themeColor: "#E0C020",
    logoUrl: "https://public-assets.pred.app/market-assets/UCL/Benfica_128x128.png",
    aliases: ["benfica", "sl benfica", "s.l. benfica"],
  },
  {
    id: "",
    name: "Barcelona",
    alternateName: "FC Barcelona",
    code: "BAR",
    slug: "barcelona",
    themeColor: "#A50044",
    logoUrl: "",
    aliases: ["barcelona", "fc barcelona", "barca"],
  },
  {
    id: "",
    name: "Arsenal",
    alternateName: "Arsenal FC",
    code: "ARS",
    slug: "arsenal",
    themeColor: "#D00027",
    logoUrl: "",
    aliases: ["arsenal", "arsenal fc"],
  },
  {
    id: "",
    name: "Manchester City",
    alternateName: "Manchester City FC",
    code: "MCI",
    slug: "manchester-city",
    themeColor: "#6CABDD",
    logoUrl: "",
    aliases: ["manchester city", "man city", "manchester city fc"],
  },
  {
    id: "",
    name: "Bayern Munich",
    alternateName: "FC Bayern Munich",
    code: "BAY",
    slug: "bayern-munich",
    themeColor: "#DC052D",
    logoUrl: "",
    aliases: ["bayern", "bayern munich", "fc bayern", "fc bayern munich"],
  },
  {
    id: "",
    name: "Liverpool",
    alternateName: "Liverpool FC",
    code: "LIV",
    slug: "liverpool",
    themeColor: "#C8102E",
    logoUrl: "",
    aliases: ["liverpool", "liverpool fc"],
  },
  {
    id: "",
    name: "Chelsea",
    alternateName: "Chelsea FC",
    code: "CHE",
    slug: "chelsea",
    themeColor: "#034694",
    logoUrl: "",
    aliases: ["chelsea", "chelsea fc"],
  },
];

let TEAM_ALIAS_INDEX = buildTeamAliasIndex(TEAMS);

const state = {
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
};

const els = {};

document.addEventListener("DOMContentLoaded", async () => {
  cacheElements();
  seedDefaults();
  bindEvents();
  renderFixtureJson(null);
  renderParentMarketJson(null);
  renderDetectedFixtures();
  renderAllFixturesJson([]);
  renderBulkParentMarkets([]);
  populateLeagueSelect();
  setCatalogStatus("Loading team/league catalog from CSV source of truth...", "working");
  await initializeCatalog();
});

function cacheElements() {
  const ids = [
    "runOcrBtn",
    "catalogStatus",
    "reloadCatalogBtn",
    "fixtureImageInput",
    "dropzone",
    "previewImage",
    "ocrStatus",
    "ocrProgress",
    "ocrText",
    "parseTextBtn",
    "inferenceNotes",
    "fixtureForm",
    "regenerateFixtureBtn",
    "homeTeamNameInput",
    "awayTeamNameInput",
    "leagueSelect",
    "customLeagueIdWrap",
    "customLeagueFields",
    "customLeagueIdInput",
    "customLeagueNameInput",
    "customLeagueSlugInput",
    "matchDayInput",
    "matchWeekInput",
    "fixtureDateInput",
    "kickoffTimeUtcInput",
    "locationInput",
    "venueInput",
    "homeTeamIdInput",
    "awayTeamIdInput",
    "homeAlternateNameInput",
    "awayAlternateNameInput",
    "homeMarketCodeInput",
    "awayMarketCodeInput",
    "homeThemeColorInput",
    "awayThemeColorInput",
    "homeLogoUrlInput",
    "awayLogoUrlInput",
    "fixtureJsonOutput",
    "copyFixtureJsonBtn",
    "detectedFixturesSection",
    "detectedFixturesList",
    "selectAllFixturesBtn",
    "clearFixtureSelectionBtn",
    "allFixturesJsonOutput",
    "copyAllFixturesJsonBtn",
    "typeRefSection",
    "typeReferenceIdInput",
    "typeRefValidation",
    "parentMarketOutput",
    "copyParentJsonBtn",
    "bulkTypeReferenceInput",
    "applyBulkTypeRefsBtn",
    "generateBulkParentBtn",
    "bulkParentValidation",
    "bulkParentMarketsOutput",
    "copyBulkParentJsonBtn",
  ];

  for (const id of ids) {
    els[id] = document.getElementById(id);
  }
}

function populateLeagueSelect() {
  const previousValue = els.leagueSelect.value;
  const frag = document.createDocumentFragment();
  for (const league of LEAGUES) {
    const option = document.createElement("option");
    option.value = league.key;
    option.textContent = `${league.name} (${league.slug.toUpperCase()})`;
    frag.appendChild(option);
  }

  const custom = document.createElement("option");
  custom.value = "custom";
  custom.textContent = "Custom League";
  frag.appendChild(custom);

  els.leagueSelect.innerHTML = "";
  els.leagueSelect.appendChild(frag);

  if (previousValue && Array.from(els.leagueSelect.options).some((opt) => opt.value === previousValue)) {
    els.leagueSelect.value = previousValue;
  }
}

function seedDefaults() {
  const today = new Date();
  const isoDate = today.toISOString().slice(0, 10);
  els.fixtureDateInput.value = isoDate;
  els.kickoffTimeUtcInput.value = DEFAULT_KICKOFF_TIME_UTC;
  els.homeThemeColorInput.value = "#E0A000";
  els.awayThemeColorInput.value = "#E0C020";
}

function bindEvents() {
  els.fixtureImageInput.addEventListener("change", async (event) => {
    const file = event.target.files?.[0];
    if (file) {
      await handleSelectedFile(file);
    }
  });

  els.runOcrBtn.addEventListener("click", () => {
    void runOcr();
  });

  els.reloadCatalogBtn.addEventListener("click", () => {
    void initializeCatalog({ force: true });
  });

  document.addEventListener("paste", (event) => {
    void handleClipboardPaste(event);
  });

  els.parseTextBtn.addEventListener("click", () => {
    parseTextAndPopulate(els.ocrText.value);
  });

  els.regenerateFixtureBtn.addEventListener("click", () => {
    regenerateOutputsFromForm();
  });

  els.leagueSelect.addEventListener("change", () => {
    toggleCustomLeagueFields();
    regenerateOutputsFromForm();
  });

  els.typeReferenceIdInput.addEventListener("input", () => {
    if (state.activeDetectedFixtureIndex !== null && state.detectedFixtures[state.activeDetectedFixtureIndex]) {
      state.detectedFixtures[state.activeDetectedFixtureIndex].typeReferenceId = els.typeReferenceIdInput.value.trim();
      renderDetectedFixtures();
      updateBulkParentMarketOutputs();
    }
    updateParentMarketFromTypeRef();
  });

  els.selectAllFixturesBtn.addEventListener("click", () => {
    for (const fixture of state.detectedFixtures) {
      fixture.selected = true;
    }
    renderDetectedFixtures();
    updateBulkParentMarketOutputs();
  });

  els.clearFixtureSelectionBtn.addEventListener("click", () => {
    for (const fixture of state.detectedFixtures) {
      fixture.selected = false;
    }
    renderDetectedFixtures();
    updateBulkParentMarketOutputs();
  });

  els.copyFixtureJsonBtn.addEventListener("click", async () => {
    if (state.fixtureJson) {
      await copyText(JSON.stringify(state.fixtureJson, null, 2));
    }
  });

  els.copyAllFixturesJsonBtn.addEventListener("click", async () => {
    const allFixtureJson = state.detectedFixtures
      .map((entry) => entry.bundle?.fixtureJson)
      .filter(Boolean);
    if (allFixtureJson.length) {
      await copyText(JSON.stringify(allFixtureJson, null, 2));
    }
  });

  els.copyParentJsonBtn.addEventListener("click", async () => {
    const typeRefId = els.typeReferenceIdInput.value.trim();
    if (!isValidUuid(typeRefId) || !state.fixtureMeta) {
      return;
    }

    const payload = buildParentMarketPayload(state.fixtureMeta, typeRefId);
    await copyText(JSON.stringify(payload, null, 2));
  });

  els.applyBulkTypeRefsBtn.addEventListener("click", () => {
    applyBulkTypeReferencesToSelectedFixtures();
  });

  els.generateBulkParentBtn.addEventListener("click", () => {
    updateBulkParentMarketOutputs({ explicit: true });
  });

  els.copyBulkParentJsonBtn.addEventListener("click", async () => {
    if (Array.isArray(state.bulkParentPayloads) && state.bulkParentPayloads.length) {
      await copyText(JSON.stringify(state.bulkParentPayloads, null, 2));
    }
  });

  els.bulkTypeReferenceInput.addEventListener("input", () => {
    // Do not auto-assign while typing; user can click Apply.
    setBulkParentValidation("Paste one UUID per line, then click Apply To Selected Fixtures.", "neutral");
  });

  els.detectedFixturesList.addEventListener("click", (event) => {
    const target = event.target;
    if (!(target instanceof HTMLElement)) {
      return;
    }
    const loadButton = target.closest("[data-action='load-fixture']");
    if (loadButton instanceof HTMLElement) {
      const index = Number.parseInt(loadButton.dataset.index || "", 10);
      if (Number.isFinite(index)) {
        loadDetectedFixtureIntoEditor(index);
      }
      return;
    }
  });

  els.detectedFixturesList.addEventListener("change", (event) => {
    const target = event.target;
    if (!(target instanceof HTMLElement)) {
      return;
    }

    if (target.matches("[data-role='select-fixture']")) {
      const input = /** @type {HTMLInputElement} */ (target);
      const index = Number.parseInt(input.dataset.index || "", 10);
      const entry = state.detectedFixtures[index];
      if (entry) {
        entry.selected = input.checked;
        updateBulkParentMarketOutputs();
      }
      return;
    }

    if (target.matches("[data-role='fixture-type-ref']")) {
      const input = /** @type {HTMLInputElement} */ (target);
      const index = Number.parseInt(input.dataset.index || "", 10);
      const entry = state.detectedFixtures[index];
      if (entry) {
        entry.typeReferenceId = input.value.trim();
        if (state.activeDetectedFixtureIndex === index) {
          els.typeReferenceIdInput.value = entry.typeReferenceId;
          updateParentMarketFromTypeRef();
        }
        updateBulkParentMarketOutputs();
      }
    }
  });

  const liveInputs = [
    "homeTeamNameInput",
    "awayTeamNameInput",
    "customLeagueIdInput",
    "customLeagueNameInput",
    "customLeagueSlugInput",
    "matchDayInput",
    "matchWeekInput",
    "fixtureDateInput",
    "kickoffTimeUtcInput",
    "locationInput",
    "venueInput",
    "homeTeamIdInput",
    "awayTeamIdInput",
    "homeAlternateNameInput",
    "awayAlternateNameInput",
    "homeMarketCodeInput",
    "awayMarketCodeInput",
    "homeThemeColorInput",
    "awayThemeColorInput",
    "homeLogoUrlInput",
    "awayLogoUrlInput",
  ];

  for (const id of liveInputs) {
    els[id].addEventListener("input", () => {
      regenerateOutputsFromForm();
    });
    els[id].addEventListener("change", () => {
      regenerateOutputsFromForm();
    });
  }

  setupDropzone();
}

async function handleClipboardPaste(event) {
  const items = Array.from(event.clipboardData?.items || []);
  if (!items.length) {
    return;
  }

  const imageItem = items.find((item) => item.kind === "file" && item.type.startsWith("image/"));
  if (!imageItem) {
    return;
  }

  const file = imageItem.getAsFile();
  if (!file) {
    return;
  }

  event.preventDefault();
  setOcrStatus("Pasted image from clipboard. Running OCR...", "working");
  await handleSelectedFile(file);
}

async function initializeCatalog({ force = false } = {}) {
  if (state.catalogLoaded && !force) {
    setCatalogStatus(`CSV catalog loaded (${state.catalogSourceLabel}).`, "success");
    return;
  }

  els.reloadCatalogBtn.disabled = true;
  setCatalogStatus("Loading team/league catalog from CSV source of truth...", "working");

  try {
    const payload = await fetchCatalogPayload();
    const normalized = normalizeCatalogPayload(payload);

    if (!normalized.leagues.length) {
      throw new Error("No leagues found in CSV payload.");
    }

    LEAGUES = normalized.leagues;
    TEAMS = normalized.teams;
    TEAM_ALIAS_INDEX = buildTeamAliasIndex(TEAMS);

    state.catalogLoaded = true;
    state.catalogSourceLabel = payload?.source?.label || "CSV endpoint";

    populateLeagueSelect();
    toggleCustomLeagueFields();
    refreshDetectedFixtureBundlesFromCatalog();
    regenerateOutputsFromForm();

    setCatalogStatus(
      `CSV catalog loaded: ${LEAGUES.length} leagues, ${TEAMS.length} teams (${state.catalogSourceLabel}).`,
      "success"
    );
  } catch (error) {
    console.error("CSV catalog load failed:", error);
    state.catalogLoaded = false;
    state.catalogSourceLabel = "Fallback (hardcoded)";
    TEAM_ALIAS_INDEX = buildTeamAliasIndex(TEAMS);
    populateLeagueSelect();
    toggleCustomLeagueFields();
    refreshDetectedFixtureBundlesFromCatalog();
    setCatalogStatus(
      "CSV catalog unavailable. Using fallback IDs. Start / reload via node server to use leagues.csv and teams.csv.",
      "error"
    );
  } finally {
    els.reloadCatalogBtn.disabled = false;
  }
}

async function fetchCatalogPayload() {
  const response = await fetch(CATALOG_API_ENDPOINT, { cache: "no-store" });
  if (!response.ok) {
    throw new Error(`Catalog endpoint returned ${response.status}`);
  }
  return response.json();
}

function normalizeCatalogPayload(payload) {
  const rawLeagues = Array.isArray(payload?.leagues) ? payload.leagues : [];
  const rawTeams = Array.isArray(payload?.teams) ? payload.teams : [];

  const leagues = normalizeLeagueRows(rawLeagues);
  const leagueIdSet = new Set(leagues.map((league) => league.id));
  const teams = normalizeTeamRows(rawTeams).filter((team) => !team.leagueId || leagueIdSet.has(team.leagueId));

  return { leagues, teams };
}

function normalizeLeagueRows(rows) {
  const seenKeys = new Set();
  const leagues = [];

  for (const row of rows) {
    const id = (row.league_id || row.id || "").trim();
    const name = (row.name || "").trim();
    if (!id || !name) {
      continue;
    }

    const alternateName = (row.alternate_name || "").trim();
    const association = (row.association || "").trim();
    const rawSlug = alternateName || name;
    const baseSlug = slugify(rawSlug || name) || "league";
    let key = baseSlug;
    let suffix = 2;
    while (seenKeys.has(key)) {
      key = `${baseSlug}-${suffix}`;
      suffix += 1;
    }
    seenKeys.add(key);

    const aliases = new Set([name, alternateName, association, `${name} ${alternateName}`].filter(Boolean));
    if (alternateName) {
      aliases.add(expandLeagueAlias(alternateName));
    }

    leagues.push({
      key,
      id,
      name,
      slug: baseSlug,
      alternateName,
      aliases: Array.from(aliases)
        .map((alias) => alias.trim())
        .filter(Boolean),
    });
  }

  return leagues;
}

function normalizeTeamRows(rows) {
  const teams = [];

  for (const row of rows) {
    const id = (row.team_id || row.id || "").trim();
    const leagueId = (row.league_id || "").trim();
    const name = (row.name || "").trim();
    if (!id || !name) {
      continue;
    }

    const alternateName = (row.alternate_name || "").trim();
    const logoUrl = (row.logo_url || "").trim();
    const themeColor = normalizeHexColor(row.theme_color || "#FFFFFF");
    const aliases = buildTeamAliases(name, alternateName);

    teams.push({
      id,
      leagueId: leagueId || null,
      name,
      alternateName: alternateName || name,
      code: generateCodeFromName(name),
      slug: slugify(name),
      themeColor,
      logoUrl: logoUrl || FIXTURE_LOGO_URL,
      aliases,
    });
  }

  return teams;
}

function expandLeagueAlias(value) {
  const normalized = normalizeForSearch(value);
  if (normalized === "epl") {
    return "english premier league";
  }
  if (normalized === "ucl") {
    return "uefa champions league champions league";
  }
  if (normalized === "uel") {
    return "uefa europa league europa league";
  }
  return value;
}

function buildTeamAliases(name, alternateName) {
  const out = new Set();
  for (const candidate of [name, alternateName]) {
    const raw = String(candidate || "").trim();
    if (!raw) {
      continue;
    }
    out.add(raw);
    out.add(raw.replace(/\b(fc|cf|afc|sc)\b/gi, "").replace(/\s+/g, " ").trim());
    out.add(raw.replace(/\bsl\b/gi, "").replace(/\s+/g, " ").trim());
    out.add(raw.replace(/[\W_]+/g, ""));
  }

  return Array.from(out).filter(Boolean);
}

function buildTeamAliasIndex(teams) {
  const out = [];
  for (const team of teams) {
    const seen = new Set();
    const aliases = Array.isArray(team.aliases) ? team.aliases : [team.name];
    for (const alias of aliases) {
      const normalized = normalizeForSearch(alias);
      if (normalized.length < 2 || seen.has(normalized)) {
        continue;
      }
      seen.add(normalized);
      out.push({ alias: normalized, team });
    }
  }
  return out;
}

function setCatalogStatus(message, tone = "idle") {
  if (!els.catalogStatus) {
    return;
  }
  els.catalogStatus.textContent = message;
  els.catalogStatus.className = `status status-${tone}`;
}

function renderDetectedFixtures() {
  const entries = state.detectedFixtures;
  const hasFixtures = entries.length > 0;
  els.detectedFixturesSection.classList.toggle("hidden", !hasFixtures);

  if (!hasFixtures) {
    els.detectedFixturesList.innerHTML = `<div class="fixture-empty">No fixtures detected yet. Upload or paste an image, or paste OCR text and click Parse Text.</div>`;
    return;
  }

  const html = entries
    .map((entry, index) => {
      const title = entry.bundle?.fixtureJson?.name || `${entry.homeTeamName} vs ${entry.awayTeamName}`;
      const leagueLabel = entry.bundle?.meta?.league?.name || "Unknown league";
      const dateLabel = entry.bundle?.meta?.fixtureDateIso || "";
      const timeLabel = entry.bundle?.meta?.kickoffTimeUtc || "";
      const isActive = state.activeDetectedFixtureIndex === index;
      const selectedAttr = entry.selected ? "checked" : "";
      const safeTypeRef = escapeHtmlAttribute(entry.typeReferenceId || "");
      const notes = Array.isArray(entry.notes) ? entry.notes.slice(0, 2) : [];
      const notesText = notes.length ? notes.join(" | ") : "Ready";

      return `
        <div class="fixture-row ${isActive ? "active" : ""}">
          <div class="fixture-row-top">
            <div class="fixture-row-left">
              <input type="checkbox" data-role="select-fixture" data-index="${index}" ${selectedAttr} aria-label="Select fixture ${index + 1}" />
              <span class="fixture-index-pill">${index + 1}</span>
            </div>
            <div>
              <p class="fixture-title">${escapeHtml(title)}</p>
              <p class="fixture-meta">${escapeHtml(leagueLabel)}${dateLabel ? ` • ${escapeHtml(dateLabel)}` : ""}${timeLabel ? ` • ${escapeHtml(timeLabel)} UTC` : ""}</p>
            </div>
            <div class="fixture-actions">
              <button class="btn btn-secondary" type="button" data-action="load-fixture" data-index="${index}">
                ${isActive ? "Loaded In Editor" : "Load In Editor"}
              </button>
            </div>
          </div>
          <div class="fixture-row-grid">
            <label>
              Type Reference ID (for bulk parent market generation)
              <input
                type="text"
                value="${safeTypeRef}"
                data-role="fixture-type-ref"
                data-index="${index}"
                placeholder="872329ce-4891-4a9c-b203-4e71ff20d4d3"
              />
            </label>
            <label>
              Source OCR Line (read-only)
              <input type="text" value="${escapeHtmlAttribute(entry.sourceLine || title)}" readonly />
            </label>
          </div>
          <p class="fixture-row-notes">${escapeHtml(notesText)}</p>
        </div>
      `;
    })
    .join("");

  els.detectedFixturesList.innerHTML = html;
}

function renderAllFixturesJson(fixtures) {
  renderJsonInto(els.allFixturesJsonOutput, fixtures || []);
  if (!fixtures || fixtures.length === 0) {
    els.allFixturesJsonOutput.textContent = "[]";
    els.allFixturesJsonOutput.classList.add("empty");
  }
}

function renderBulkParentMarkets(payloads) {
  renderJsonInto(els.bulkParentMarketsOutput, payloads || []);
  if (!payloads || payloads.length === 0) {
    els.bulkParentMarketsOutput.textContent = "[]";
    els.bulkParentMarketsOutput.classList.add("empty");
  }
}

function setBulkParentValidation(message, kind) {
  els.bulkParentValidation.textContent = message;
  els.bulkParentValidation.className = "validation";
  if (kind === "ok") {
    els.bulkParentValidation.classList.add("ok");
  } else if (kind === "error") {
    els.bulkParentValidation.classList.add("error");
  }
}

function loadDetectedFixtureIntoEditor(index) {
  const entry = state.detectedFixtures[index];
  if (!entry) {
    return;
  }

  state.activeDetectedFixtureIndex = index;
  applyInferenceToForm(entry.inference);
  if (entry.typeReferenceId) {
    els.typeReferenceIdInput.value = entry.typeReferenceId;
  }
  renderDetectedFixtures();
  regenerateOutputsFromForm();
}

function applyBulkTypeReferencesToSelectedFixtures() {
  const selectedEntries = state.detectedFixtures.filter((entry) => entry.selected);
  if (!selectedEntries.length) {
    setBulkParentValidation("Select at least one fixture before applying bulk type reference IDs.", "error");
    return;
  }

  const ids = String(els.bulkTypeReferenceInput.value || "")
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter(Boolean);

  if (!ids.length) {
    setBulkParentValidation("Paste one or more UUIDs (one per line), then click Apply To Selected Fixtures.", "error");
    return;
  }

  let applied = 0;
  selectedEntries.forEach((entry, idx) => {
    if (ids[idx]) {
      entry.typeReferenceId = ids[idx];
      applied += 1;
    }
  });

  renderDetectedFixtures();
  updateBulkParentMarketOutputs();

  setBulkParentValidation(`Applied ${applied} type reference ID(s) to selected fixtures (in list order).`, "ok");
}

function updateBulkParentMarketOutputs({ explicit = false } = {}) {
  const selectedEntries = state.detectedFixtures.filter((entry) => entry.selected);
  if (!selectedEntries.length) {
    state.bulkParentPayloads = [];
    renderBulkParentMarkets([]);
    if (explicit) {
      setBulkParentValidation("Select one or more fixtures first.", "error");
    }
    return;
  }

  const hasAnyTypeRef = selectedEntries.some((entry) => String(entry.typeReferenceId || "").trim());
  if (!hasAnyTypeRef && !explicit) {
    state.bulkParentPayloads = [];
    renderBulkParentMarkets([]);
    setBulkParentValidation("Select fixtures and assign type reference IDs to generate bulk parent market payloads.", "neutral");
    return;
  }

  const validPayloads = [];
  const errors = [];

  for (const entry of selectedEntries) {
    if (!entry.bundle?.meta) {
      errors.push(`${entry.bundle?.fixtureJson?.name || entry.homeTeamName || "Fixture"}: missing fixture data`);
      continue;
    }
    if (!entry.typeReferenceId) {
      errors.push(`${entry.bundle.fixtureJson.name}: missing type reference ID`);
      continue;
    }
    if (!isValidUuid(entry.typeReferenceId)) {
      errors.push(`${entry.bundle.fixtureJson.name}: invalid UUID`);
      continue;
    }
    validPayloads.push({
      fixture_name: entry.bundle.fixtureJson.name,
      ...buildParentMarketPayload(entry.bundle.meta, entry.typeReferenceId),
    });
  }

  state.bulkParentPayloads = validPayloads;
  renderBulkParentMarkets(validPayloads);

  if (errors.length) {
    setBulkParentValidation(
      `${validPayloads.length} generated, ${errors.length} skipped. ${errors.slice(0, 2).join(" | ")}${errors.length > 2 ? " | ..." : ""}`,
      validPayloads.length ? "ok" : "error"
    );
    return;
  }

  if (validPayloads.length) {
    setBulkParentValidation(`Generated ${validPayloads.length} parent market payload(s) for selected fixtures.`, "ok");
  } else if (explicit) {
    setBulkParentValidation("No valid selected fixtures with type reference IDs to generate.", "error");
  }
}

function syncActiveDetectedFixtureFromEditor(bundle) {
  if (!bundle || state.activeDetectedFixtureIndex === null) {
    return;
  }

  const entry = state.detectedFixtures[state.activeDetectedFixtureIndex];
  if (!entry) {
    return;
  }

  entry.bundle = cloneJson(bundle);
  entry.inference = inferenceFromBundle(bundle.meta);
  entry.homeTeamName = bundle.meta.homeTeam.name;
  entry.awayTeamName = bundle.meta.awayTeam.name;
  entry.notes = Array.isArray(entry.notes) ? entry.notes : [];
}

function inferenceFromBundle(meta) {
  return {
    leagueSelectValue: meta?.league?.key || null,
    leagueId: meta?.league?.id || null,
    homeTeamName: meta?.homeTeam?.name || "",
    awayTeamName: meta?.awayTeam?.name || "",
    homeTeamMeta: meta?.homeTeam || null,
    awayTeamMeta: meta?.awayTeam || null,
    matchDay: meta?.fixtureJson?.match_day ?? null,
    matchWeek: meta?.fixtureJson?.match_week ?? null,
    fixtureDate: meta?.fixtureDateIso || null,
    kickoffTimeUtc: meta?.kickoffTimeUtc || DEFAULT_KICKOFF_TIME_UTC,
    location: meta?.fixtureJson?.location || "",
    venue: meta?.fixtureJson?.venue || "",
    notes: [],
  };
}

function setupDropzone() {
  const dropzone = els.dropzone;

  ["dragenter", "dragover"].forEach((eventName) => {
    dropzone.addEventListener(eventName, (event) => {
      event.preventDefault();
      dropzone.classList.add("dragover");
    });
  });

  ["dragleave", "drop"].forEach((eventName) => {
    dropzone.addEventListener(eventName, (event) => {
      event.preventDefault();
      dropzone.classList.remove("dragover");
    });
  });

  dropzone.addEventListener("drop", async (event) => {
    const file = event.dataTransfer?.files?.[0];
    if (file) {
      await handleSelectedFile(file);
    }
  });
}

async function handleSelectedFile(file) {
  if (!file.type.startsWith("image/")) {
    setOcrStatus("Please upload an image file.", "error");
    return;
  }

  state.file = file;
  els.runOcrBtn.disabled = false;
  setPreviewImage(file);
  setOcrStatus("Image loaded. Running OCR...", "working");
  els.ocrProgress.value = 0;

  await runOcr();
}

function setPreviewImage(file) {
  if (state.previewUrl) {
    URL.revokeObjectURL(state.previewUrl);
  }

  state.previewUrl = URL.createObjectURL(file);
  els.previewImage.src = state.previewUrl;
  els.previewImage.classList.remove("hidden");
}

async function runOcr() {
  if (state.ocrRunning || !state.file) {
    return;
  }

  if (!window.Tesseract) {
    setOcrStatus("Tesseract.js failed to load. Check internet connection and reload the page.", "error");
    return;
  }

  state.ocrRunning = true;
  els.runOcrBtn.disabled = true;
  setOcrStatus("Preparing image for OCR...", "working");

  try {
    const image = await loadImageFromFile(state.file);
    const canvas = preprocessImageForOcr(image);

    const result = await window.Tesseract.recognize(canvas, "eng", {
      logger: (message) => {
        if (message?.status) {
          const progress = Number.isFinite(message.progress) ? message.progress : 0;
          els.ocrProgress.value = Math.max(0, Math.min(1, progress));
          setOcrStatus(formatTesseractStatus(message.status, progress), "working");
        }
      },
    });

    const text = (result?.data?.text || "").trim();
    els.ocrText.value = text;

    if (!text) {
      setOcrStatus("OCR finished but no text was detected. Try a clearer crop or higher contrast image.", "error");
      renderNotes(["OCR returned empty text. You can paste text manually and click Parse Text."]);
      return;
    }

    setOcrStatus("OCR complete. Parsed the detected text into fixture fields.", "success");
    parseTextAndPopulate(text);
  } catch (error) {
    console.error(error);
    setOcrStatus(`OCR failed: ${error?.message || "Unknown error"}`, "error");
  } finally {
    state.ocrRunning = false;
    els.runOcrBtn.disabled = !state.file;
  }
}

function setOcrStatus(message, tone = "idle") {
  els.ocrStatus.textContent = message;
  els.ocrStatus.className = `status status-${tone}`;
}

function formatTesseractStatus(status, progress) {
  const pct = Math.round((progress || 0) * 100);
  return `${status.replace(/\b\w/g, (c) => c.toUpperCase())} (${pct}%)`;
}

function parseTextAndPopulate(rawText) {
  const result = inferFixturesFromText(rawText || "");
  setDetectedFixturesFromInferences(result.fixtures || []);

  if (state.detectedFixtures.length > 0) {
    state.activeDetectedFixtureIndex = 0;
    const first = state.detectedFixtures[0];
    applyInferenceToForm(first.inference);
    els.typeReferenceIdInput.value = first.typeReferenceId || "";
  } else {
    state.activeDetectedFixtureIndex = null;
    els.typeReferenceIdInput.value = "";
  }

  renderDetectedFixtures();
  renderNotes(result.notes || []);
  regenerateOutputsFromForm();
  updateBulkParentMarketOutputs();
}

function applyInferenceToForm(inference) {
  els.homeTeamNameInput.value = inference.homeTeamName || "";
  els.awayTeamNameInput.value = inference.awayTeamName || "";

  if (inference.homeTeamMeta) {
    hydrateTeamFields("home", inference.homeTeamMeta);
  } else {
    setUnknownTeamFields("home", els.homeTeamNameInput.value.trim());
  }

  if (inference.awayTeamMeta) {
    hydrateTeamFields("away", inference.awayTeamMeta);
  } else {
    setUnknownTeamFields("away", els.awayTeamNameInput.value.trim());
  }

  if (inference.leagueSelectValue) {
    els.leagueSelect.value = inference.leagueSelectValue;
  }

  toggleCustomLeagueFields();

  els.matchDayInput.value = inference.matchDay !== null && inference.matchDay !== undefined ? String(inference.matchDay) : "";
  els.matchWeekInput.value = inference.matchWeek !== null && inference.matchWeek !== undefined ? String(inference.matchWeek) : "";
  if (inference.fixtureDate) {
    els.fixtureDateInput.value = inference.fixtureDate;
  }
  if (inference.kickoffTimeUtc) {
    els.kickoffTimeUtcInput.value = inference.kickoffTimeUtc;
  }
  els.locationInput.value = inference.location || "";
  els.venueInput.value = inference.venue || "";
}

function hydrateTeamFields(side, team) {
  const home = side === "home";
  (home ? els.homeTeamNameInput : els.awayTeamNameInput).value = team.name || "";
  (home ? els.homeTeamIdInput : els.awayTeamIdInput).value = team.id || "";
  (home ? els.homeAlternateNameInput : els.awayAlternateNameInput).value = team.alternateName || "";
  (home ? els.homeMarketCodeInput : els.awayMarketCodeInput).value = team.code || "";
  (home ? els.homeThemeColorInput : els.awayThemeColorInput).value = normalizeHexColor(team.themeColor || (home ? "#E0A000" : "#E0C020"));
  (home ? els.homeLogoUrlInput : els.awayLogoUrlInput).value = team.logoUrl || "";
}

function seedUnknownTeamFields(side, teamName) {
  const home = side === "home";
  const code = generateCodeFromName(teamName);
  const nameInput = home ? els.homeAlternateNameInput : els.awayAlternateNameInput;
  const codeInput = home ? els.homeMarketCodeInput : els.awayMarketCodeInput;
  if (!nameInput.value.trim()) {
    nameInput.value = teamName;
  }
  if (!codeInput.value.trim()) {
    codeInput.value = code;
  }
}

function setUnknownTeamFields(side, teamName) {
  const home = side === "home";
  const code = teamName ? generateCodeFromName(teamName) : "";
  (home ? els.homeTeamIdInput : els.awayTeamIdInput).value = "";
  (home ? els.homeAlternateNameInput : els.awayAlternateNameInput).value = teamName || "";
  (home ? els.homeMarketCodeInput : els.awayMarketCodeInput).value = code;
  (home ? els.homeThemeColorInput : els.awayThemeColorInput).value = home ? "#E0A000" : "#E0C020";
  (home ? els.homeLogoUrlInput : els.awayLogoUrlInput).value = "";
}

function toggleCustomLeagueFields() {
  const isCustom = els.leagueSelect.value === "custom";
  els.customLeagueIdWrap.classList.toggle("hidden", !isCustom);
  els.customLeagueFields.classList.toggle("hidden", !isCustom);
}

function regenerateOutputsFromForm() {
  const bundle = collectFixtureBundleFromForm();

  state.fixtureJson = bundle?.fixtureJson || null;
  state.fixtureMeta = bundle?.meta || null;
  syncActiveDetectedFixtureFromEditor(bundle);

  renderFixtureJson(state.fixtureJson);
  renderAllFixturesJson(
    state.detectedFixtures
      .map((entry) => entry.bundle?.fixtureJson)
      .filter(Boolean)
  );
  renderDetectedFixtures();
  toggleTypeRefSection(Boolean(state.fixtureMeta));
  updateParentMarketFromTypeRef();
  updateBulkParentMarketOutputs();
}

function collectFixtureBundleFromForm() {
  const homeName = els.homeTeamNameInput.value.trim();
  const awayName = els.awayTeamNameInput.value.trim();

  if (!homeName || !awayName) {
    return null;
  }

  const league = getLeagueMetaFromForm();
  const date = els.fixtureDateInput.value || new Date().toISOString().slice(0, 10);
  const kickoffTimeUtc = els.kickoffTimeUtcInput.value || DEFAULT_KICKOFF_TIME_UTC;
  const kickoffDate = parseUtcDateTime(date, kickoffTimeUtc);
  const closeDate = kickoffDate;
  const openDate = new Date(kickoffDate.getTime() - 24 * 60 * 60 * 1000);

  const homeTeam = collectTeamMetaFromForm("home", homeName, league.id || null);
  const awayTeam = collectTeamMetaFromForm("away", awayName, league.id || null);

  const fixtureJson = {
    name: `${homeName} vs ${awayName}`,
    league_id: league.id || null,
    home_team_id: homeTeam.id || null,
    away_team_id: awayTeam.id || null,
    format: null,
    logo_url: FIXTURE_LOGO_URL,
    theme_color: DEFAULT_FIXTURE_THEME,
    match_day: toNullableInteger(els.matchDayInput.value),
    match_week: toNullableInteger(els.matchWeekInput.value),
    location: els.locationInput.value.trim(),
    venue: els.venueInput.value.trim(),
  };

  const meta = {
    league,
    homeTeam,
    awayTeam,
    fixtureDateIso: date,
    kickoffTimeUtc,
    openIso: openDate.toISOString(),
    closeIso: closeDate.toISOString(),
    payoutIso: closeDate.toISOString(),
    createdAtIso: openDate.toISOString(),
    fixtureJson,
  };

  return { fixtureJson, meta };
}

function getLeagueMetaFromForm() {
  const selected = els.leagueSelect.value;
  if (selected !== "custom") {
    const league = LEAGUES.find((item) => item.key === selected) || LEAGUES[0] || null;
    if (!league) {
      return {
        key: "unknown",
        id: null,
        name: "Unknown League",
        slug: "league",
      };
    }
    return {
      key: league.key,
      id: league.id,
      name: league.name,
      slug: league.slug,
    };
  }

  const customName = els.customLeagueNameInput.value.trim() || "Custom League";
  const customSlug = slugify(els.customLeagueSlugInput.value.trim() || customName || "custom");

  return {
    key: "custom",
    id: els.customLeagueIdInput.value.trim(),
    name: customName,
    slug: customSlug || "custom",
  };
}

function collectTeamMetaFromForm(side, fallbackName, leagueId = null) {
  const home = side === "home";
  const name = (home ? els.homeTeamNameInput : els.awayTeamNameInput).value.trim() || fallbackName;
  const manualId = (home ? els.homeTeamIdInput : els.awayTeamIdInput).value.trim();
  const manualAlternateName = (home ? els.homeAlternateNameInput : els.awayAlternateNameInput).value.trim();
  const manualCode = (home ? els.homeMarketCodeInput : els.awayMarketCodeInput).value.trim();
  const manualThemeColor = home ? els.homeThemeColorInput.value : els.awayThemeColorInput.value;
  const manualLogoUrl = (home ? els.homeLogoUrlInput : els.awayLogoUrlInput).value.trim();
  const catalogMatch = findBestTeamForLeague(name, leagueId);

  return {
    name,
    id: manualId || catalogMatch?.id || null,
    alternateName: manualAlternateName || catalogMatch?.alternateName || name,
    code: (manualCode || catalogMatch?.code || generateCodeFromName(name)).toUpperCase(),
    themeColor: normalizeHexColor(manualThemeColor || catalogMatch?.themeColor || (home ? "#E0A000" : "#E0C020")),
    logoUrl: manualLogoUrl || catalogMatch?.logoUrl || FIXTURE_LOGO_URL,
    slug: catalogMatch?.slug || slugify(name),
    leagueId: catalogMatch?.leagueId || leagueId || null,
  };
}

function setDetectedFixturesFromInferences(inferences) {
  const previousByName = new Map(
    state.detectedFixtures.map((entry) => [normalizeForSearch(entry.bundle?.fixtureJson?.name || `${entry.homeTeamName} vs ${entry.awayTeamName}`), entry])
  );

  state.detectedFixtures = (Array.isArray(inferences) ? inferences : [])
    .filter((inference) => inference?.homeTeamName && inference?.awayTeamName)
    .map((inference, index) => {
      const bundle = collectFixtureBundleFromInference(inference);
      const key = normalizeForSearch(bundle?.fixtureJson?.name || `${inference.homeTeamName} vs ${inference.awayTeamName}`);
      const prev = previousByName.get(key);
      return {
        id: `fixture-${index + 1}`,
        inference,
        bundle,
        homeTeamName: inference.homeTeamName,
        awayTeamName: inference.awayTeamName,
        sourceLine: inference.sourceLine || `${inference.homeTeamName} vs ${inference.awayTeamName}`,
        selected: typeof prev?.selected === "boolean" ? prev.selected : true,
        typeReferenceId: prev?.typeReferenceId || "",
        notes: Array.isArray(inference.notes) ? [...inference.notes] : [],
      };
    });

  if (state.detectedFixtures.length === 0) {
    state.activeDetectedFixtureIndex = null;
  } else if (
    state.activeDetectedFixtureIndex === null ||
    !state.detectedFixtures[state.activeDetectedFixtureIndex]
  ) {
    state.activeDetectedFixtureIndex = 0;
  }

  renderDetectedFixtures();
  renderAllFixturesJson(state.detectedFixtures.map((entry) => entry.bundle?.fixtureJson).filter(Boolean));
}

function refreshDetectedFixtureBundlesFromCatalog() {
  if (!Array.isArray(state.detectedFixtures) || state.detectedFixtures.length === 0) {
    return;
  }

  state.detectedFixtures = state.detectedFixtures.map((entry) => {
    const inference = entry.inference || {};
    const bundle = collectFixtureBundleFromInference(inference);
    return {
      ...entry,
      inference: bundle?.meta
        ? {
            ...inference,
            homeTeamMeta: bundle.meta.homeTeam,
            awayTeamMeta: bundle.meta.awayTeam,
            leagueSelectValue: bundle.meta.league.key,
            leagueId: bundle.meta.league.id,
          }
        : inference,
      bundle,
      homeTeamName: inference.homeTeamName || entry.homeTeamName,
      awayTeamName: inference.awayTeamName || entry.awayTeamName,
    };
  });

  renderDetectedFixtures();
  renderAllFixturesJson(state.detectedFixtures.map((entry) => entry.bundle?.fixtureJson).filter(Boolean));
  updateBulkParentMarketOutputs();
}

function collectFixtureBundleFromInference(inference) {
  const homeName = String(inference?.homeTeamName || "").trim();
  const awayName = String(inference?.awayTeamName || "").trim();
  if (!homeName || !awayName) {
    return null;
  }

  const league = getLeagueMetaFromInference(inference);
  const date = inference?.fixtureDate || els.fixtureDateInput.value || new Date().toISOString().slice(0, 10);
  const kickoffTimeUtc = inference?.kickoffTimeUtc || els.kickoffTimeUtcInput.value || DEFAULT_KICKOFF_TIME_UTC;
  const kickoffDate = parseUtcDateTime(date, kickoffTimeUtc);
  const closeDate = kickoffDate;
  const openDate = new Date(kickoffDate.getTime() - 24 * 60 * 60 * 1000);

  const homeTeam = collectTeamMetaFromInferenceSide(inference?.homeTeamMeta, homeName, league.id || null, "#E0A000");
  const awayTeam = collectTeamMetaFromInferenceSide(inference?.awayTeamMeta, awayName, league.id || null, "#E0C020");

  const fixtureJson = {
    name: `${homeName} vs ${awayName}`,
    league_id: league.id || null,
    home_team_id: homeTeam.id || null,
    away_team_id: awayTeam.id || null,
    format: null,
    logo_url: FIXTURE_LOGO_URL,
    theme_color: DEFAULT_FIXTURE_THEME,
    match_day: Number.isInteger(inference?.matchDay) ? inference.matchDay : null,
    match_week: Number.isInteger(inference?.matchWeek) ? inference.matchWeek : null,
    location: String(inference?.location || ""),
    venue: String(inference?.venue || ""),
  };

  const meta = {
    league,
    homeTeam,
    awayTeam,
    fixtureDateIso: date,
    kickoffTimeUtc,
    openIso: openDate.toISOString(),
    closeIso: closeDate.toISOString(),
    payoutIso: closeDate.toISOString(),
    createdAtIso: openDate.toISOString(),
    fixtureJson,
  };

  return { fixtureJson, meta };
}

function getLeagueMetaFromInference(inference) {
  const byKey = LEAGUES.find((league) => league.key === inference?.leagueSelectValue);
  if (byKey) {
    return { key: byKey.key, id: byKey.id, name: byKey.name, slug: byKey.slug };
  }
  const byId = LEAGUES.find((league) => league.id && league.id === inference?.leagueId);
  if (byId) {
    return { key: byId.key, id: byId.id, name: byId.name, slug: byId.slug };
  }
  return getLeagueMetaFromForm();
}

function collectTeamMetaFromInferenceSide(inferredTeam, fallbackName, leagueId, fallbackColor) {
  const name = String(fallbackName || inferredTeam?.name || "").trim();
  const catalogMatch = findBestTeamForLeague(name, leagueId) || inferredTeam || null;

  return {
    name,
    id: catalogMatch?.id || inferredTeam?.id || null,
    alternateName: catalogMatch?.alternateName || inferredTeam?.alternateName || name,
    code: (catalogMatch?.code || inferredTeam?.code || generateCodeFromName(name)).toUpperCase(),
    themeColor: normalizeHexColor(catalogMatch?.themeColor || inferredTeam?.themeColor || fallbackColor),
    logoUrl: catalogMatch?.logoUrl || inferredTeam?.logoUrl || FIXTURE_LOGO_URL,
    slug: catalogMatch?.slug || inferredTeam?.slug || slugify(name),
    leagueId: catalogMatch?.leagueId || inferredTeam?.leagueId || leagueId || null,
  };
}

function updateParentMarketFromTypeRef() {
  if (!state.fixtureMeta) {
    renderParentMarketJson(null);
    setTypeRefValidation("Generate a fixture JSON first.", "neutral");
    return;
  }

  const typeRefId = els.typeReferenceIdInput.value.trim();
  if (!typeRefId) {
    renderParentMarketJson(null);
    setTypeRefValidation("Enter a valid UUID to generate the parent market payload.", "neutral");
    return;
  }

  if (!isValidUuid(typeRefId)) {
    renderParentMarketJson(null);
    setTypeRefValidation("Type reference ID must be a valid UUID.", "error");
    return;
  }

  const payload = buildParentMarketPayload(state.fixtureMeta, typeRefId);
  renderParentMarketJson(payload);
  setTypeRefValidation("Parent market payload generated.", "ok");
}

function toggleTypeRefSection(show) {
  els.typeRefSection.classList.toggle("hidden", !show);
}

function buildParentMarketPayload(meta, typeReferenceId) {
  const { fixtureJson, league, homeTeam, awayTeam, fixtureDateIso, openIso, closeIso, payoutIso, createdAtIso } = meta;

  const title = fixtureJson.name;
  const suffix = typeReferenceId.split("-").pop();
  const leagueSlug = league.slug || "league";
  const homeSlug = homeTeam.slug || slugify(homeTeam.name);
  const awaySlug = awayTeam.slug || slugify(awayTeam.name);
  const parentMarketCode = `${homeTeam.code}_${awayTeam.code}_${suffix}`.toUpperCase();
  const parentCanonical = `${homeSlug}-${awaySlug}-${leagueSlug}-${fixtureDateIso}-${suffix}`;
  const closeDate = new Date(closeIso);

  const titleDate = fixtureDateIso;
  const endDateShort = formatDateMmDdYy(new Date(`${fixtureDateIso}T00:00:00Z`));
  const createdAtShort = formatDateTimeMmDdYyHm(new Date(createdAtIso));
  const closeIsoFinal = closeDate.toISOString();

  const parentMarket = {
    league_id: fixtureJson.league_id,
    type_reference_id: typeReferenceId,
    title,
    description: `${title} (${titleDate}). Settles on 90 minutes + stoppage time: ${homeTeam.name} / Draw / ${awayTeam.name}.`,
    market_code: parentMarketCode,
    parent_market_canonical_name: parentCanonical,
    rules: `This market resolves based on the official result of ${title} after 90 minutes of regular play plus stoppage time. Exactly one outcome pays $1 and the others pay $0. If the match is postponed, the market remains open until the match has been completed. If the match is canceled entirely with no make-up game, outcomes resolve as described in each outcome's rules.`,
    markets_open_time: openIso,
    markets_close_time: closeIsoFinal,
    payout_time: payoutIso,
    status: "active",
    is_cross_matching_enabled: true,
    time_remaining: closeIsoFinal,
  };

  const buildTeamRules = (teamName) =>
    `In the upcoming game, scheduled for ${endDateShort}, if ${teamName} wins, this market will resolve to $1. Otherwise, this market will resolve to $0. If the game is postponed, this market will remain open until the game has been completed. If the game is canceled entirely, with no make-up game, this market will resolve to $0. This market refers only to the outcome within the first 90 minutes of regular play plus stoppage time.\nEnd Date: ${endDateShort}\nCreated At: ${createdAtShort} / UTC`;

  const drawRules =
    `In the upcoming game, scheduled for ${endDateShort}, if the game ends in a draw, this market will resolve to $1. Otherwise, this market will resolve to $0. If the game is postponed, this market will remain open until the game has been completed. If the game is canceled entirely, with no make-up game, this market will resolve to $0. This market refers only to the outcome within the first 90 minutes of regular play plus stoppage time.\nEnd Date: ${endDateShort}\nCreated At: ${createdAtShort} / UTC`;

  const markets = [
    {
      name: homeTeam.name,
      tick_size: "0.01",
      alternate_name: homeTeam.alternateName,
      market_code: homeTeam.code,
      market_canonical_name: `${homeSlug}-${awaySlug}-win-${leagueSlug}-${fixtureDateIso}-${suffix}`,
      rules: buildTeamRules(homeTeam.name),
      theme_color: homeTeam.themeColor,
      team_id: homeTeam.id,
      logo_url: homeTeam.logoUrl || FIXTURE_LOGO_URL,
      time_remaining: closeIsoFinal,
    },
    {
      name: "Draw",
      tick_size: "0.01",
      alternate_name: "Draw",
      market_code: "DRAW",
      market_canonical_name: `${homeSlug}-${awaySlug}-draw-${leagueSlug}-${fixtureDateIso}-${suffix}`,
      rules: drawRules,
      theme_color: DEFAULT_DRAW_THEME,
      team_id: null,
      logo_url: DRAW_LOGO_URL,
      time_remaining: closeIsoFinal,
    },
    {
      name: awayTeam.name,
      tick_size: "0.01",
      alternate_name: awayTeam.alternateName,
      market_code: awayTeam.code,
      market_canonical_name: `${awaySlug}-${homeSlug}-win-${leagueSlug}-${fixtureDateIso}-${suffix}`,
      rules: buildTeamRules(awayTeam.name),
      theme_color: awayTeam.themeColor,
      team_id: awayTeam.id,
      logo_url: awayTeam.logoUrl || FIXTURE_LOGO_URL,
      time_remaining: closeIsoFinal,
    },
  ];

  return { parent_market: parentMarket, markets };
}

function inferFixturesFromText(rawText) {
  const text = String(rawText || "");
  const compactText = normalizeForSearch(text);
  const lines = text
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter(Boolean);

  const notes = [];
  const league = detectLeague(text);
  const preferredLeagueId = league?.id || null;

  if (!league) {
    notes.push("League not confidently detected. Defaulted to the selected league.");
  }

  const matchDay = parseMatchDay(text);
  const matchWeek = parseMatchWeek(text);
  const fixtureDate = parseFixtureDate(text);
  const kickoffTimeUtc = parseKickoffTime(text) || DEFAULT_KICKOFF_TIME_UTC;

  if (matchDay !== null) {
    notes.push(`Detected match day: ${matchDay}`);
  }
  if (matchWeek !== null) {
    notes.push(`Detected match week: ${matchWeek}`);
  }
  if (!fixtureDate) {
    notes.push("No fixture date detected. Using the current date field value.");
  }
  if (!parseKickoffTime(text)) {
    notes.push(`No kickoff time detected. Defaulting to ${DEFAULT_KICKOFF_TIME_UTC} UTC.`);
  }

  let pairs = detectFixturePairsFromLines(lines, { preferredLeagueId });
  if (!pairs.length) {
    const fallbackSingle = inferFixtureFromText(text);
    if (fallbackSingle.homeTeamName && fallbackSingle.awayTeamName) {
      pairs = [
        {
          ...fallbackSingle,
          sourceLine: `${fallbackSingle.homeTeamName} vs ${fallbackSingle.awayTeamName}`,
        },
      ];
    }
  }

  if (!pairs.length) {
    notes.push("Could not confidently detect any fixtures. Edit OCR text or fill the editor manually.");
    return { fixtures: [], notes };
  }

  const fixtures = pairs.map((pair) => {
    const fixtureNotes = [];
    if (pair.homeTeam && !pair.homeTeam.id) {
      fixtureNotes.push(`Home team "${pair.homeTeam.name}" matched but has no configured team_id in catalog.`);
    }
    if (pair.awayTeam && !pair.awayTeam.id) {
      fixtureNotes.push(`Away team "${pair.awayTeam.name}" matched but has no configured team_id in catalog.`);
    }

    return {
      leagueSelectValue: league?.key || null,
      leagueId: league?.id || null,
      homeTeamName: pair.homeName || "",
      awayTeamName: pair.awayName || "",
      homeTeamMeta: pair.homeTeam || null,
      awayTeamMeta: pair.awayTeam || null,
      matchDay,
      matchWeek,
      fixtureDate,
      kickoffTimeUtc,
      location: "",
      venue: "",
      sourceLine: pair.sourceLine || `${pair.homeName} vs ${pair.awayName}`,
      notes: fixtureNotes,
    };
  });

  notes.unshift(`Detected ${fixtures.length} fixture(s) from OCR text.`);
  return { fixtures, notes };
}

function detectFixturePairsFromLines(lines, options = {}) {
  const out = [];
  const seen = new Set();

  for (const line of lines) {
    const pair = detectTeamPairFromVsLine([line], options);
    if (!pair?.homeName || !pair?.awayName) {
      continue;
    }

    const key = `${normalizeForSearch(pair.homeName)}|${normalizeForSearch(pair.awayName)}`;
    const reverseKey = `${normalizeForSearch(pair.awayName)}|${normalizeForSearch(pair.homeName)}`;
    if (seen.has(key) || seen.has(reverseKey)) {
      continue;
    }
    seen.add(key);

    out.push({
      ...pair,
      sourceLine: line,
    });
  }

  if (out.length >= 2) {
    return out;
  }

  // Fallback: try catalog-based detection on the full text if line parsing only finds <2 fixtures.
  return out;
}

function inferFixtureFromText(rawText) {
  const text = String(rawText || "");
  const compactText = normalizeForSearch(text);
  const lines = text
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter(Boolean);

  const notes = [];

  const league = detectLeague(text);
  if (!league) {
    notes.push("League not confidently detected. Defaulted to the selected league.");
  }

  const preferredLeagueId = league?.id || null;

  let pair = detectTeamPairFromVsLine(lines, { preferredLeagueId });
  if (!pair) {
    pair = detectTeamPairByCatalog(compactText, { preferredLeagueId });
  }

  if (!pair) {
    notes.push("Could not confidently detect a fixture pair. Edit OCR text or fill team names manually.");
  }

  const homeTeamMeta = pair?.homeTeam || null;
  const awayTeamMeta = pair?.awayTeam || null;

  const homeTeamName = pair?.homeName || "";
  const awayTeamName = pair?.awayName || "";

  if (homeTeamMeta && !homeTeamMeta.id) {
    notes.push(`Home team "${homeTeamMeta.name}" matched the catalog, but team ID is not configured. Add it in Team Mapping Overrides.`);
  }
  if (awayTeamMeta && !awayTeamMeta.id) {
    notes.push(`Away team "${awayTeamMeta.name}" matched the catalog, but team ID is not configured. Add it in Team Mapping Overrides.`);
  }

  const matchDay = parseMatchDay(text);
  const matchWeek = parseMatchWeek(text);
  if (matchDay !== null) {
    notes.push(`Detected match day: ${matchDay}`);
  }
  if (matchWeek !== null) {
    notes.push(`Detected match week: ${matchWeek}`);
  }

  const fixtureDate = parseFixtureDate(text);
  if (!fixtureDate) {
    notes.push("No fixture date detected. Using the current date field value.");
  }

  const kickoffTimeUtc = parseKickoffTime(text);
  if (!kickoffTimeUtc) {
    notes.push(`No kickoff time detected. Defaulting to ${DEFAULT_KICKOFF_TIME_UTC} UTC.`);
  }

  return {
    leagueSelectValue: league?.key || null,
    homeTeamName,
    awayTeamName,
    homeTeamMeta,
    awayTeamMeta,
    matchDay,
    matchWeek,
    fixtureDate,
    kickoffTimeUtc: kickoffTimeUtc || DEFAULT_KICKOFF_TIME_UTC,
    notes,
  };
}

function detectLeague(text) {
  const haystack = normalizeForSearch(text);
  let best = null;
  let bestScore = -1;

  for (const league of LEAGUES) {
    for (const alias of league.aliases) {
      const aliasNorm = normalizeForSearch(alias);
      const idx = haystack.indexOf(aliasNorm);
      if (idx === -1) {
        continue;
      }

      const score = aliasNorm.length;
      if (score > bestScore) {
        bestScore = score;
        best = league;
      }
    }
  }

  return best;
}

function detectTeamPairFromVsLine(lines, options = {}) {
  const separators = ["vs", "vs.", "v", "v.", "-", "–", "—"];

  for (const line of lines) {
    const cleanedLine = line.replace(/\s+/g, " ").trim();
    if (!cleanedLine) {
      continue;
    }

    const lower = cleanedLine.toLowerCase();
    if (!separators.some((sep) => lower.includes(` ${sep} `))) {
      continue;
    }

    const regex = /(.+?)\s+(?:vs\.?|v\.?|-|–|—)\s+(.+)/i;
    const match = cleanedLine.match(regex);
    if (!match) {
      continue;
    }

    const leftRaw = stripFixtureNoise(match[1]);
    const rightRaw = stripFixtureNoise(match[2]);
    if (!leftRaw || !rightRaw) {
      continue;
    }

    const leftResolved = resolveTeamByName(leftRaw, options);
    const rightResolved = resolveTeamByName(rightRaw, options);

    const homeName = leftResolved?.team?.name || toTitleLike(leftRaw);
    const awayName = rightResolved?.team?.name || toTitleLike(rightRaw);

    return {
      homeName,
      awayName,
      homeTeam: leftResolved?.team || null,
      awayTeam: rightResolved?.team || null,
    };
  }

  return null;
}

function detectTeamPairByCatalog(normalizedText, options = {}) {
  const hits = [];
  const preferredLeagueId = options.preferredLeagueId || null;

  for (const entry of TEAM_ALIAS_INDEX) {
    const idx = normalizedText.indexOf(entry.alias);
    if (idx === -1) {
      continue;
    }
    hits.push({ idx, team: entry.team, alias: entry.alias });
  }

  if (hits.length < 2) {
    return null;
  }

  hits.sort((a, b) => {
    if (preferredLeagueId) {
      const aPref = a.team.leagueId === preferredLeagueId ? 0 : 1;
      const bPref = b.team.leagueId === preferredLeagueId ? 0 : 1;
      if (aPref !== bPref) {
        return aPref - bPref;
      }
    }
    return a.idx - b.idx || b.alias.length - a.alias.length;
  });
  const uniqueTeams = [];
  const seen = new Set();

  for (const hit of hits) {
    const key = hit.team.name;
    if (seen.has(key)) {
      continue;
    }
    seen.add(key);
    uniqueTeams.push(hit.team);
    if (uniqueTeams.length === 2) {
      break;
    }
  }

  if (uniqueTeams.length < 2) {
    return null;
  }

  return {
    homeName: uniqueTeams[0].name,
    awayName: uniqueTeams[1].name,
    homeTeam: uniqueTeams[0],
    awayTeam: uniqueTeams[1],
  };
}

function resolveTeamByName(rawName, options = {}) {
  const normalized = normalizeForSearch(rawName);
  if (!normalized) {
    return null;
  }

  const preferredLeagueId = options.preferredLeagueId || null;
  let best = null;
  let bestScore = -1;

  for (const team of TEAMS) {
    for (const alias of team.aliases) {
      const aliasNorm = normalizeForSearch(alias);
      let score = -1;

      if (normalized === aliasNorm) {
        score = 1000 + aliasNorm.length;
      } else if (normalized.includes(aliasNorm)) {
        score = 500 + aliasNorm.length;
      } else if (aliasNorm.includes(normalized)) {
        score = 400 + normalized.length;
      } else {
        score = tokenOverlapScore(normalized, aliasNorm);
      }

      if (preferredLeagueId) {
        if (team.leagueId === preferredLeagueId) {
          score += 50;
        } else {
          score -= 5;
        }
      }

      if (score > bestScore) {
        bestScore = score;
        best = team;
      }
    }
  }

  if (bestScore < 2) {
    return null;
  }

  return { team: best, score: bestScore };
}

function findBestTeamForLeague(rawName, leagueId = null) {
  const normalized = normalizeForSearch(rawName);
  if (!normalized) {
    return null;
  }

  if (leagueId) {
    let exact = TEAMS.find((team) => team.leagueId === leagueId && normalizeForSearch(team.name) === normalized);
    if (!exact) {
      exact = TEAMS.find(
        (team) =>
          team.leagueId === leagueId &&
          Array.isArray(team.aliases) &&
          team.aliases.some((alias) => normalizeForSearch(alias) === normalized)
      );
    }
    if (exact) {
      return exact;
    }

    const resolved = resolveTeamByName(rawName, { preferredLeagueId: leagueId });
    if (resolved?.team?.leagueId === leagueId) {
      return resolved.team;
    }
    return null;
  }

  return resolveTeamByName(rawName)?.team || null;
}

function stripFixtureNoise(value) {
  return value
    .replace(/\b(?:matchday|md|round|week)\s*\d+\b/gi, "")
    .replace(/\b\d{1,2}[:.]\d{2}\s*(?:am|pm|utc|gmt)?\b/gi, "")
    .replace(/\b\d{1,2}[\/.-]\d{1,2}(?:[\/.-]\d{2,4})?\b/g, "")
    .replace(/\([^)]*\)/g, " ")
    .replace(/\[[^\]]*\]/g, " ")
    .replace(/[,|]+/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function parseMatchDay(text) {
  const patterns = [
    /\bmatch\s*day\s*(\d{1,2})\b/i,
    /\bmatchday\s*(\d{1,2})\b/i,
    /\bmd\s*(\d{1,2})\b/i,
  ];
  for (const pattern of patterns) {
    const match = text.match(pattern);
    if (match) {
      return Number.parseInt(match[1], 10);
    }
  }
  return null;
}

function parseMatchWeek(text) {
  const patterns = [
    /\bmatch\s*week\s*(\d{1,2})\b/i,
    /\bgameweek\s*(\d{1,2})\b/i,
    /\bgw\s*(\d{1,2})\b/i,
  ];
  for (const pattern of patterns) {
    const match = text.match(pattern);
    if (match) {
      return Number.parseInt(match[1], 10);
    }
  }
  return null;
}

function parseFixtureDate(text) {
  const monthMap = {
    jan: 1,
    january: 1,
    feb: 2,
    february: 2,
    mar: 3,
    march: 3,
    apr: 4,
    april: 4,
    may: 5,
    jun: 6,
    june: 6,
    jul: 7,
    july: 7,
    aug: 8,
    august: 8,
    sep: 9,
    sept: 9,
    september: 9,
    oct: 10,
    october: 10,
    nov: 11,
    november: 11,
    dec: 12,
    december: 12,
  };

  const isoMatch = text.match(/\b(20\d{2})[\/.-](\d{1,2})[\/.-](\d{1,2})\b/);
  if (isoMatch) {
    return formatYyyyMmDd(Number(isoMatch[1]), Number(isoMatch[2]), Number(isoMatch[3]));
  }

  const monthWordMatch = text.match(
    /\b(\d{1,2})\s+(jan(?:uary)?|feb(?:ruary)?|mar(?:ch)?|apr(?:il)?|may|jun(?:e)?|jul(?:y)?|aug(?:ust)?|sep(?:t|tember)?|oct(?:ober)?|nov(?:ember)?|dec(?:ember)?)\,?\s+(20\d{2}|\d{2})\b/i
  );
  if (monthWordMatch) {
    const day = Number(monthWordMatch[1]);
    const month = monthMap[monthWordMatch[2].toLowerCase()];
    const year = normalizeYear(monthWordMatch[3]);
    return formatYyyyMmDd(year, month, day);
  }

  const monthWordFirstMatch = text.match(
    /\b(jan(?:uary)?|feb(?:ruary)?|mar(?:ch)?|apr(?:il)?|may|jun(?:e)?|jul(?:y)?|aug(?:ust)?|sep(?:t|tember)?|oct(?:ober)?|nov(?:ember)?|dec(?:ember)?)\s+(\d{1,2})\,?\s+(20\d{2}|\d{2})\b/i
  );
  if (monthWordFirstMatch) {
    const month = monthMap[monthWordFirstMatch[1].toLowerCase()];
    const day = Number(monthWordFirstMatch[2]);
    const year = normalizeYear(monthWordFirstMatch[3]);
    return formatYyyyMmDd(year, month, day);
  }

  const numericMatch = text.match(/\b(\d{1,2})[\/.-](\d{1,2})[\/.-](20\d{2}|\d{2})\b/);
  if (numericMatch) {
    const a = Number(numericMatch[1]);
    const b = Number(numericMatch[2]);
    const year = normalizeYear(numericMatch[3]);
    let month = b;
    let day = a;

    if (a > 12 && b <= 12) {
      day = a;
      month = b;
    } else if (b > 12 && a <= 12) {
      month = a;
      day = b;
    } else {
      // football fixtures are often day-first when ambiguous
      day = a;
      month = b;
    }

    return formatYyyyMmDd(year, month, day);
  }

  return null;
}

function parseKickoffTime(text) {
  const matches = text.matchAll(/\b(\d{1,2})[:.](\d{2})\s*([AaPp][Mm])?\s*(UTC|GMT)?\b/g);

  for (const match of matches) {
    let hours = Number(match[1]);
    const minutes = Number(match[2]);
    const meridiem = match[3]?.toLowerCase();

    if (meridiem) {
      if (meridiem === "pm" && hours < 12) {
        hours += 12;
      }
      if (meridiem === "am" && hours === 12) {
        hours = 0;
      }
    }

    if (hours > 23 || minutes > 59) {
      continue;
    }

    return `${String(hours).padStart(2, "0")}:${String(minutes).padStart(2, "0")}`;
  }

  return null;
}

function renderNotes(messages) {
  els.inferenceNotes.innerHTML = "";
  if (!messages || messages.length === 0) {
    const note = document.createElement("p");
    note.className = "note";
    note.textContent = "No parser notes.";
    els.inferenceNotes.appendChild(note);
    return;
  }

  for (const msg of messages) {
    const note = document.createElement("p");
    note.className = "note";
    note.textContent = msg;
    els.inferenceNotes.appendChild(note);
  }
}

function renderFixtureJson(obj) {
  renderJsonInto(els.fixtureJsonOutput, obj);
}

function renderParentMarketJson(obj) {
  renderJsonInto(els.parentMarketOutput, obj);
}

function renderJsonInto(element, obj) {
  if (!obj) {
    element.textContent = "{}";
    element.classList.add("empty");
    return;
  }

  element.textContent = JSON.stringify(obj, null, 2);
  element.classList.remove("empty");
}

function setTypeRefValidation(message, kind) {
  els.typeRefValidation.textContent = message;
  els.typeRefValidation.className = "validation";
  if (kind === "ok") {
    els.typeRefValidation.classList.add("ok");
  } else if (kind === "error") {
    els.typeRefValidation.classList.add("error");
  }
}

function isValidUuid(value) {
  return /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(value);
}

async function copyText(text) {
  try {
    await navigator.clipboard.writeText(text);
  } catch {
    // Clipboard API can fail on some local contexts; no-op fallback.
  }
}

function cloneJson(value) {
  return value == null ? value : JSON.parse(JSON.stringify(value));
}

function escapeHtml(value) {
  return String(value ?? "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

function escapeHtmlAttribute(value) {
  return escapeHtml(value).replace(/\n/g, " ").replace(/\r/g, " ");
}

function loadImageFromFile(file) {
  return new Promise((resolve, reject) => {
    const url = URL.createObjectURL(file);
    const image = new Image();
    image.onload = () => {
      URL.revokeObjectURL(url);
      resolve(image);
    };
    image.onerror = () => {
      URL.revokeObjectURL(url);
      reject(new Error("Could not read image file."));
    };
    image.src = url;
  });
}

function preprocessImageForOcr(image) {
  const maxTarget = 1800;
  const scale = Math.max(1, Math.min(3, maxTarget / Math.max(image.width, image.height)));
  const width = Math.max(1, Math.round(image.width * scale));
  const height = Math.max(1, Math.round(image.height * scale));

  const canvas = document.createElement("canvas");
  canvas.width = width;
  canvas.height = height;
  const ctx = canvas.getContext("2d", { willReadFrequently: true });
  ctx.drawImage(image, 0, 0, width, height);

  const imgData = ctx.getImageData(0, 0, width, height);
  const data = imgData.data;
  for (let i = 0; i < data.length; i += 4) {
    const gray = 0.299 * data[i] + 0.587 * data[i + 1] + 0.114 * data[i + 2];
    let v = (gray - 128) * 1.45 + 128;
    v = Math.max(0, Math.min(255, v));
    data[i] = v;
    data[i + 1] = v;
    data[i + 2] = v;
  }

  ctx.putImageData(imgData, 0, 0);
  return canvas;
}

function parseUtcDateTime(dateYmd, timeHm) {
  const parsed = new Date(`${dateYmd}T${timeHm}:00Z`);
  if (Number.isNaN(parsed.getTime())) {
    return new Date(`${new Date().toISOString().slice(0, 10)}T${DEFAULT_KICKOFF_TIME_UTC}:00Z`);
  }
  return parsed;
}

function toNullableInteger(value) {
  const trimmed = String(value ?? "").trim();
  if (!trimmed) {
    return null;
  }
  const n = Number.parseInt(trimmed, 10);
  return Number.isFinite(n) ? n : null;
}

function normalizeHexColor(value) {
  const hex = String(value || "").trim();
  if (/^#[0-9a-f]{6}$/i.test(hex)) {
    return hex.toUpperCase();
  }
  return "#FFFFFF";
}

function generateCodeFromName(name) {
  const parts = String(name || "")
    .trim()
    .split(/\s+/)
    .filter(Boolean);

  if (parts.length === 0) {
    return "TEAM";
  }

  if (parts.length >= 2) {
    return parts
      .slice(0, 3)
      .map((part) => part[0])
      .join("")
      .toUpperCase();
  }

  return parts[0].slice(0, 3).toUpperCase();
}

function normalizeForSearch(value) {
  return String(value || "")
    .normalize("NFKD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, " ")
    .trim()
    .replace(/\s+/g, " ");
}

function slugify(value) {
  return normalizeForSearch(value).replace(/\s+/g, "-");
}

function tokenOverlapScore(a, b) {
  const setA = new Set(a.split(" ").filter(Boolean));
  const setB = new Set(b.split(" ").filter(Boolean));
  let overlap = 0;
  for (const token of setA) {
    if (setB.has(token)) {
      overlap += 1;
    }
  }
  return overlap;
}

function toTitleLike(text) {
  return String(text || "")
    .split(/\s+/)
    .filter(Boolean)
    .map((word) => word.charAt(0).toUpperCase() + word.slice(1).toLowerCase())
    .join(" ");
}

function normalizeYear(raw) {
  const y = Number(raw);
  if (String(raw).length === 4) {
    return y;
  }
  return y >= 70 ? 1900 + y : 2000 + y;
}

function formatYyyyMmDd(year, month, day) {
  if (!year || !month || !day) {
    return null;
  }
  if (month < 1 || month > 12 || day < 1 || day > 31) {
    return null;
  }
  return `${String(year).padStart(4, "0")}-${String(month).padStart(2, "0")}-${String(day).padStart(2, "0")}`;
}

function formatDateMmDdYy(date) {
  return `${String(date.getUTCMonth() + 1).padStart(2, "0")}/${String(date.getUTCDate()).padStart(2, "0")}/${String(date.getUTCFullYear()).slice(-2)}`;
}

function formatDateTimeMmDdYyHm(date) {
  const datePart = formatDateMmDdYy(date);
  const hh = String(date.getUTCHours()).padStart(2, "0");
  const mm = String(date.getUTCMinutes()).padStart(2, "0");
  return `${datePart} , ${hh}:${mm}`;
}
