import {
  canConfirmDevBatchSelection,
  getDevBatchMarketRows,
  getDevBatchRunTone,
  getDevBatchVerificationByFixture,
  selectCanRetryFailed,
  selectSelectedFixtures,
} from "./selectors.js";
import { resetDevBatchRun, resetDevBatchVerification } from "./state.js";
import { PUBLISH_KEYS, MARKET_OPTIONS, MAX_SELECTION } from "./constants.js";

// ---------------------------------------------------------------------------
// Context-based actions (used by ui.js and events/index.js)
// Each action receives a `ctx` object with { state, runtime, ui, api, helpers, selectors, feature }
// ---------------------------------------------------------------------------

export async function loadDevBatchFixtures(ctx, { force = false } = {}) {
  const { state, runtime, ui } = ctx;
  if (runtime.normalizeRuntimeAppEnvCode(state.runtimeAppEnv || "mainnet") !== "dev") {
    return;
  }
  const leagues = runtime.getScheduleLeagueViewModels();
  state.devBatch.isLoadingFixtures = true;
  ui.syncActionState();
  ui.setButtonBusy(ui.els.devBatchLoadFixturesBtn, true, "Loading...");
  try {
    const allFixtures = [];
    for (const league of leagues) {
      const payload = await ctx.api.fetchUpcomingFixturesForLeague(league.scheduleCode, {
        refresh: force,
        referenceNowIso: state.referenceNowIso,
      });
      const fixtures = Array.isArray(payload?.fixtures) ? payload.fixtures : [];
      for (const fixture of fixtures) {
        allFixtures.push({
          ...fixture,
          leagueCode: league.scheduleCode,
          leagueLabel: runtime.getScheduleLeagueLabel(league.scheduleCode),
        });
      }
    }
    state.devBatch.fixtures = allFixtures.sort((a, b) => {
      const aTime = Date.parse(String(a?.kickoffIso || "")) || Number.MAX_SAFE_INTEGER;
      const bTime = Date.parse(String(b?.kickoffIso || "")) || Number.MAX_SAFE_INTEGER;
      return aTime - bTime;
    });
    if (!state.devBatch.focusedFixtureId && state.devBatch.fixtures.length > 0) {
      state.devBatch.focusedFixtureId = runtime.getScheduleFixtureIdentity(
        state.devBatch.fixtures[0]
      );
    }
    ui.persistEnvironmentScopedSnapshot();
  } catch (error) {
    ui.showToast(`Could not load DEV fixtures: ${String(error?.message || error)}`, "error");
  } finally {
    state.devBatch.isLoadingFixtures = false;
    ui.setButtonBusy(ui.els.devBatchLoadFixturesBtn, false, "Load Fixtures");
    ui.renderDevBatchConsole();
    ui.syncActionState();
  }
}

export function toggleFixtureSelection(ctx, fixtureId) {
  const { state, ui } = ctx;
  const normalized = String(fixtureId || "").trim();
  if (!normalized) return;
  const current = new Set(
    Array.isArray(state.devBatch.selectedFixtureIds) ? state.devBatch.selectedFixtureIds : []
  );
  if (current.has(normalized)) {
    current.delete(normalized);
  } else {
    if (current.size >= MAX_SELECTION) {
      ui.showToast(
        `Max ${MAX_SELECTION} fixtures \u2014 deselect one before adding another.`,
        "error"
      );
      return;
    }
    current.add(normalized);
  }
  state.devBatch.selectedFixtureIds = Array.from(current);
  state.devBatch = resetDevBatchRun(resetDevBatchVerification(state.devBatch));
  ui.persistEnvironmentScopedSnapshot();
  ui.renderDevBatchConsole();
  ui.syncActionState();
}

// Alias for backwards compat with existing event listeners
export const toggleDevBatchFixtureSelection = toggleFixtureSelection;

export function setFocusedFixture(ctx, fixtureId) {
  ctx.state.devBatch.focusedFixtureId = String(fixtureId || "");
  ctx.ui.persistEnvironmentScopedSnapshot();
  ctx.ui.renderDevBatchConsole();
}

export function setStep(ctx, step) {
  ctx.state.devBatch.step = step;
  ctx.ui.persistEnvironmentScopedSnapshot();
  ctx.ui.renderDevBatchConsole();
  ctx.ui.syncActionState();
}

// Aliases
export const setDevBatchStep = setStep;

export function updateFilter(ctx, key, value) {
  if (!Object.prototype.hasOwnProperty.call(ctx.state.devBatch.filters || {}, key)) return;
  ctx.state.devBatch.filters[key] = value;
  ctx.state.devBatch = resetDevBatchRun(resetDevBatchVerification(ctx.state.devBatch));
  ctx.ui.persistEnvironmentScopedSnapshot();
  ctx.ui.renderDevBatchConsole();
}

export function toggleMarketKey(ctx, key, checked) {
  const { state, ui } = ctx;
  const normalized = String(key || "").trim().toLowerCase();
  if (!PUBLISH_KEYS.has(normalized)) return;
  const current = new Set(
    Array.isArray(state.devBatch.selectedPublishKeys) ? state.devBatch.selectedPublishKeys : []
  );
  if (checked) current.add(normalized);
  else current.delete(normalized);
  state.devBatch.selectedPublishKeys = MARKET_OPTIONS.map((o) => o.key).filter((o) =>
    current.has(o)
  );
  state.devBatch = resetDevBatchRun(resetDevBatchVerification(state.devBatch));
  ui.persistEnvironmentScopedSnapshot();
  ui.renderDevBatchConsole();
  ui.syncActionState();
}

// Alias
export const toggleDevBatchPublishKey = toggleMarketKey;

export function setFixtureExcluded(ctx, fixtureId, excluded) {
  const { state, ui } = ctx;
  const key = String(fixtureId || "").trim();
  if (!key) return;
  const current = { ...(state.devBatch.perFixtureExclusions || {}) };
  const next = { ...(current[key] || { excluded_fixture: false, excluded_publish_keys: [] }) };
  next.excluded_fixture = Boolean(excluded);
  current[key] = next;
  state.devBatch.perFixtureExclusions = current;
  state.devBatch = resetDevBatchRun(resetDevBatchVerification(state.devBatch));
  ui.persistEnvironmentScopedSnapshot();
  ui.renderDevBatchConsole();
  ui.syncActionState();
}

// Alias
export const setDevBatchFixtureExcluded = setFixtureExcluded;

export function toggleMarketExclusion(ctx, fixtureId, key, excluded) {
  const { state, ui } = ctx;
  const fixtureKey = String(fixtureId || "").trim();
  const normalizedKey = String(key || "").trim().toLowerCase();
  if (!fixtureKey || !PUBLISH_KEYS.has(normalizedKey)) return;
  const current = { ...(state.devBatch.perFixtureExclusions || {}) };
  const next = { ...(current[fixtureKey] || { excluded_fixture: false, excluded_publish_keys: [] }) };
  const excludedSet = new Set(
    Array.isArray(next.excluded_publish_keys) ? next.excluded_publish_keys : []
  );
  if (excluded) excludedSet.add(normalizedKey);
  else excludedSet.delete(normalizedKey);
  next.excluded_publish_keys = Array.from(excludedSet);
  current[fixtureKey] = next;
  state.devBatch.perFixtureExclusions = current;
  state.devBatch = resetDevBatchRun(resetDevBatchVerification(state.devBatch));
  ui.persistEnvironmentScopedSnapshot();
  ui.renderDevBatchConsole();
  ui.syncActionState();
}

// Alias
export const toggleDevBatchFixturePublishKeyExclusion = toggleMarketExclusion;

export function clearSelection(ctx) {
  ctx.state.devBatch.selectedFixtureIds = [];
  ctx.state.devBatch = resetDevBatchRun(resetDevBatchVerification(ctx.state.devBatch));
  ctx.ui.persistEnvironmentScopedSnapshot();
  ctx.ui.renderDevBatchConsole();
  ctx.ui.syncActionState();
}

export function toggleExpandResult(ctx, fixtureKey) {
  const normalizedKey = String(fixtureKey || "").trim();
  if (!normalizedKey) return;
  const expanded = new Set(
    Array.isArray(ctx.state.devBatch.expandedFixtureKeys)
      ? ctx.state.devBatch.expandedFixtureKeys
      : []
  );
  if (expanded.has(normalizedKey)) expanded.delete(normalizedKey);
  else expanded.add(normalizedKey);
  ctx.state.devBatch.expandedFixtureKeys = Array.from(expanded);
  ctx.ui.persistEnvironmentScopedSnapshot();
  ctx.ui.renderDevBatchConsole();
}

// Alias
export const toggleDevBatchExpandedFixture = toggleExpandResult;

export function toggleExpandExclusion(ctx, fixtureId) {
  const normalizedId = String(fixtureId || "").trim();
  if (!normalizedId) return;
  const expanded = new Set(
    Array.isArray(ctx.state.devBatch.expandedExclusionIds)
      ? ctx.state.devBatch.expandedExclusionIds
      : []
  );
  if (expanded.has(normalizedId)) expanded.delete(normalizedId);
  else expanded.add(normalizedId);
  ctx.state.devBatch.expandedExclusionIds = Array.from(expanded);
  ctx.ui.persistEnvironmentScopedSnapshot();
  ctx.ui.renderDevBatchConsole();
}

export function selectUnpublishedFixtures(ctx) {
  const verificationByFixture = getDevBatchVerificationByFixture(ctx.state.devBatch);
  const next = [];
  for (const fixture of Array.isArray(ctx.state.devBatch.fixtures)
    ? ctx.state.devBatch.fixtures
    : []) {
    const fixtureId = ctx.runtime.getScheduleFixtureIdentity(fixture);
    const verification = verificationByFixture.get(fixtureId);
    const hasMissing = getDevBatchMarketRows(verification).some(
      (row) => String(row?.status || "").trim().toLowerCase() === "missing"
    );
    if (hasMissing) next.push(fixtureId);
    if (next.length >= MAX_SELECTION) break;
  }
  ctx.state.devBatch.selectedFixtureIds = next;
  ctx.ui.persistEnvironmentScopedSnapshot();
  ctx.ui.renderDevBatchConsole();
  ctx.ui.syncActionState();
}

export function selectPartialFixtures(ctx) {
  const verificationByFixture = getDevBatchVerificationByFixture(ctx.state.devBatch);
  const next = [];
  for (const fixture of Array.isArray(ctx.state.devBatch.fixtures)
    ? ctx.state.devBatch.fixtures
    : []) {
    const fixtureId = ctx.runtime.getScheduleFixtureIdentity(fixture);
    const verification = verificationByFixture.get(fixtureId);
    if (String(verification?.status || "").trim().toLowerCase() === "partial") {
      next.push(fixtureId);
    }
    if (next.length >= MAX_SELECTION) break;
  }
  ctx.state.devBatch.selectedFixtureIds = next;
  ctx.ui.persistEnvironmentScopedSnapshot();
  ctx.ui.renderDevBatchConsole();
  ctx.ui.syncActionState();
}

export function confirmSelection(ctx) {
  if (!canConfirmDevBatchSelection(ctx.state, ctx.runtime)) return;
  setStep(ctx, "config");
}

export const confirmDevBatchSelection = confirmSelection;

export function goBack(ctx) {
  setStep(ctx, "selection");
}

export const goBackToDevBatchSelection = goBack;

export async function requestStop(ctx) {
  const runId = String(ctx.state.devBatch.currentRun?.run_id || "").trim();
  if (!runId) return;
  try {
    const result = await ctx.api.stopCmsBatchRun(runId);
    if (result?.ok) {
      ctx.state.devBatch.currentRun = {
        ...ctx.state.devBatch.currentRun,
        status: "stopping",
        stop_requested: true,
      };
      ctx.ui.persistEnvironmentScopedSnapshot();
      ctx.ui.renderDevBatchConsole();
      ctx.ui.syncActionState();
    }
  } catch (error) {
    ctx.ui.showPublishError("Stop request failed", error);
  }
}

export const requestDevBatchStop = requestStop;

export function buildRequestPayload(ctx, { retryFailedOnly = false } = {}) {
  const selectedFixtures = selectSelectedFixtures(ctx.state.devBatch, ctx.runtime);
  if (!selectedFixtures.length) {
    throw new Error("Select at least one fixture for the DEV batch.");
  }
  if (!ctx.state.devBatch.selectedPublishKeys.length) {
    throw new Error("Select at least one market family for the DEV batch.");
  }
  return {
    selected_fixtures: selectedFixtures.map((fixture) => ({
      game_id: String(fixture?.gameId || fixture?.game_id || "").trim(),
      event_name: String(fixture?.eventName || "").trim(),
      fixture_date: String(fixture?.fixtureDate || "").trim(),
      kickoff_time_utc: String(fixture?.kickoffTimeUtc || "").trim(),
      league_code: String(fixture?.leagueCode || fixture?.league_code || "")
        .trim()
        .toLowerCase(),
    })),
    selected_publish_keys: ctx.state.devBatch.selectedPublishKeys.slice(),
    per_fixture_exclusions: ctx.state.devBatch.perFixtureExclusions || {},
    confirmation: {
      operator_name: String(ctx.state.devBatch.confirmation?.operator_name || "").trim(),
      fixture_count: Number.parseInt(
        String(ctx.state.devBatch.confirmation?.fixture_count || "").trim(),
        10
      ),
      confirmed: Boolean(ctx.state.devBatch.confirmation?.confirmed),
    },
    retry_failed_only: retryFailedOnly,
    last_run_id: retryFailedOnly
      ? String(ctx.state.devBatch.lastRun?.run_id || "").trim()
      : "",
  };
}

export const buildDevBatchRequestPayload = buildRequestPayload;

export async function verifyBatch(ctx) {
  try {
    ctx.state.devBatch.isVerifying = true;
    ctx.ui.renderDevBatchConsole();
    const payload = buildRequestPayload(ctx, { retryFailedOnly: false });
    const result = await ctx.api.preflightCmsBatchPublish("dev", payload);
    ctx.state.devBatch.verification = result;
    ctx.state.devBatch.currentRun = null;
    ctx.ui.persistEnvironmentScopedSnapshot();
    ctx.ui.renderDevBatchConsole();
  } catch (error) {
    ctx.ui.showPublishError("DEV batch verify failed", error);
  } finally {
    ctx.state.devBatch.isVerifying = false;
    ctx.ui.renderDevBatchConsole();
    ctx.ui.syncActionState();
  }
}

export const handleDevBatchVerify = verifyBatch;

export async function pollUntilSettled(ctx, runId, { attempts = 24, delayMs = 500 } = {}) {
  const normalizedRunId = String(runId || "").trim();
  if (!normalizedRunId) return null;
  let lastRun = null;
  for (let index = 0; index < attempts; index += 1) {
    lastRun = await ctx.api.fetchCmsBatchRun(normalizedRunId);
    ctx.state.devBatch.currentRun = lastRun;
    ctx.state.devBatch.lastRun = lastRun;
    ctx.ui.persistEnvironmentScopedSnapshot();
    ctx.ui.renderDevBatchConsole();
    const status = String(lastRun?.status || "").trim().toLowerCase();
    if (["completed", "partial", "failed", "stopped"].includes(status)) {
      return lastRun;
    }
    await new Promise((resolve) => window.setTimeout(resolve, delayMs));
  }
  return lastRun;
}

export const pollDevBatchRunUntilSettled = pollUntilSettled;

export async function publishBatch(ctx, { retryFailedOnly = false } = {}) {
  try {
    ctx.state.devBatch.isPublishing = true;
    ctx.ui.renderDevBatchConsole();
    const payload = buildRequestPayload(ctx, { retryFailedOnly });
    const result = await ctx.api.publishCmsBatch("dev", payload);
    const runId = String(result?.run_id || "").trim();
    const run = runId ? await pollUntilSettled(ctx, runId) : result;
    ctx.state.devBatch.currentRun = run;
    ctx.state.devBatch.lastRun = run;
    ctx.ui.persistEnvironmentScopedSnapshot();
    ctx.ui.renderDevBatchConsole();
    const tone = getDevBatchRunTone(run?.status);
    ctx.ui.showToast(
      String(run?.summary || result?.summary || "DEV batch publish completed."),
      tone === "error" ? "error" : tone === "warn" ? "info" : "success"
    );
  } catch (error) {
    ctx.ui.showPublishError("DEV batch publish failed", error);
  } finally {
    ctx.state.devBatch.isPublishing = false;
    ctx.ui.renderDevBatchConsole();
    ctx.ui.syncActionState();
  }
}

export const handleDevBatchPublish = publishBatch;

// ---------------------------------------------------------------------------
// Confirm modal helpers (still referenced from events)
// ---------------------------------------------------------------------------

export function syncDevBatchDialogPublishBtn(ctx) {
  const button = ctx.ui.els.devBatchConfirmDialogPublishBtn;
  if (!button) return;
  const selectedCount = selectSelectedFixtures(ctx.state.devBatch, ctx.runtime).length;
  const operatorName = String(ctx.ui.els.devBatchConfirmOperatorInput?.value || "").trim();
  const confirmedCount = Number.parseInt(
    String(ctx.ui.els.devBatchConfirmCountInput?.value || "").trim(),
    10
  );
  const confirmed = Boolean(ctx.ui.els.devBatchDialogConfirmCheckbox?.checked);
  button.disabled = !operatorName || confirmedCount !== selectedCount || !confirmed;
}

export function openDevBatchConfirmModal(ctx, retryFailedOnly = false) {
  const { state, ui } = ctx;
  const selectedFixtures = selectSelectedFixtures(state.devBatch, ctx.runtime);
  const publishKeyCount = state.devBatch.selectedPublishKeys.length;
  if (ui.els.devBatchConfirmTitle) {
    ui.els.devBatchConfirmTitle.textContent = retryFailedOnly
      ? "Confirm DEV Batch Retry"
      : "Confirm DEV Batch Publish";
  }
  if (ui.els.devBatchConfirmSummaryLine) {
    if (retryFailedOnly) {
      const lastRunFixtures = Array.isArray(state.devBatch.lastRun?.fixtures)
        ? state.devBatch.lastRun.fixtures
        : [];
      const failedCount = lastRunFixtures.reduce((acc, fixture) => {
        return (
          acc +
          (Array.isArray(fixture?.markets) ? fixture.markets : []).filter((market) =>
            ["failed", "half_prepared"].includes(
              String(market?.status || "").trim().toLowerCase()
            )
          ).length
        );
      }, 0);
      ui.els.devBatchConfirmSummaryLine.textContent = `Retry ${failedCount} failed market(s) across ${selectedFixtures.length} fixture(s) in DEV.`;
    } else {
      const missingCount =
        state.devBatch.verification?.aggregate?.markets_missing ?? "?";
      ui.els.devBatchConfirmSummaryLine.textContent = `Publish ${missingCount} missing market(s) across ${selectedFixtures.length} fixture(s) in DEV.`;
    }
  }
  if (ui.els.devBatchConfirmBreakdown) {
    const aggregate = state.devBatch.verification?.aggregate || {};
    const escHtml = ctx.helpers?.escapeHtml || ((s) => s);
    const escAttr = ctx.helpers?.escapeHtmlAttribute || ((s) => s);
    const badges = [
      {
        label: `${selectedFixtures.length} fixture${selectedFixtures.length === 1 ? "" : "s"}`,
        tone: "neutral",
      },
      {
        label: `${publishKeyCount} market key${publishKeyCount === 1 ? "" : "s"}`,
        tone: "neutral",
      },
      aggregate.markets_missing
        ? { label: `${aggregate.markets_missing} missing`, tone: "warn" }
        : null,
      aggregate.markets_existing
        ? { label: `${aggregate.markets_existing} existing`, tone: "neutral" }
        : null,
    ].filter(Boolean);
    ui.els.devBatchConfirmBreakdown.innerHTML = badges
      .map(
        (badge) =>
          `<span class="mini-badge" data-tone="${escAttr(badge.tone)}">${escHtml(badge.label)}</span>`
      )
      .join("");
  }
  if (ui.els.devBatchConfirmOperatorInput) ui.els.devBatchConfirmOperatorInput.value = "";
  if (ui.els.devBatchConfirmCountInput) ui.els.devBatchConfirmCountInput.value = "";
  if (ui.els.devBatchDialogConfirmCheckbox) ui.els.devBatchDialogConfirmCheckbox.checked = false;
  if (ui.els.devBatchConfirmError) ui.els.devBatchConfirmError.textContent = "";
  if (ui.els.devBatchConfirmDialogPublishBtn)
    ui.els.devBatchConfirmDialogPublishBtn.disabled = true;
  if (ui.els.devBatchConfirmDialog) {
    ui.els.devBatchConfirmDialog.dataset.retryFailedOnly = String(retryFailedOnly);
    ui.els.devBatchConfirmDialog.showModal();
  }
}

export function closeDevBatchConfirmModal(ctx) {
  ctx.ui.els.devBatchConfirmDialog?.close();
}

// ---------------------------------------------------------------------------
// Legacy selectFixturesByPredicate helper
// ---------------------------------------------------------------------------
export function selectFixturesByPredicate(ctx, predicate) {
  const verificationByFixture = getDevBatchVerificationByFixture(ctx.state.devBatch);
  const next = [];
  for (const fixture of Array.isArray(ctx.state.devBatch.fixtures)
    ? ctx.state.devBatch.fixtures
    : []) {
    const verification = verificationByFixture.get(
      ctx.runtime.getScheduleFixtureIdentity(fixture)
    );
    if (predicate(fixture, verification)) {
      next.push(ctx.runtime.getScheduleFixtureIdentity(fixture));
    }
    if (next.length >= MAX_SELECTION) break;
  }
  ctx.state.devBatch.selectedFixtureIds = next;
  ctx.ui.persistEnvironmentScopedSnapshot();
  ctx.ui.renderDevBatchConsole();
  ctx.ui.syncActionState();
}

// Compatibility shims matching existing render.js / ui.js call patterns
export function setDevBatchSearchQuery(ctx, value) {
  updateFilter(ctx, "search", String(value || ""));
}

export function setDevBatchLeagueFilter(ctx, value) {
  updateFilter(ctx, "leagueFilter", String(value || ""));
}

export function setDevBatchFilterFlag(ctx, flag, checked) {
  updateFilter(ctx, flag, Boolean(checked));
}

export function clearDevBatchSelection(ctx) {
  clearSelection(ctx);
}

export function setDevBatchConfirmationField(ctx, field, value) {
  if (
    !ctx.state.devBatch.confirmation ||
    !Object.prototype.hasOwnProperty.call(ctx.state.devBatch.confirmation, field)
  ) {
    return;
  }
  ctx.state.devBatch.confirmation[field] = value;
  ctx.ui.persistEnvironmentScopedSnapshot();
}
