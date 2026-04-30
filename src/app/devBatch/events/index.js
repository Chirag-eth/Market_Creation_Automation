import {
  toggleFixtureSelection,
  setFocusedFixture,
  toggleMarketKey,
  setFixtureExcluded,
  toggleMarketExclusion,
  toggleExpandResult,
  toggleExpandExclusion,
  clearSelection,
  confirmSelection,
  goBack,
  requestStop,
  verifyBatch,
  publishBatch,
  selectUnpublishedFixtures,
  selectPartialFixtures,
  openDevBatchConfirmModal,
  closeDevBatchConfirmModal,
  syncDevBatchDialogPublishBtn,
  loadDevBatchFixtures,
} from "../actions.js";

/**
 * Wire all devBatch events using event delegation on #devBatchPanel.
 * Also wire direct button IDs and filter inputs.
 *
 * @param {Element} panel - #devBatchPanel element
 * @param {object} ctx - Action context: { state, runtime, ui, api, helpers, selectors, feature }
 */
export function wireEvents(panel, ctx) {
  if (!panel) return;

  // ── Delegated click handler ───────────────────────────────────────────────
  panel.addEventListener("click", (event) => {
    const target = event.target;
    if (!(target instanceof Element)) return;

    // data-dev-batch-select → toggleFixtureSelection
    const selectBtn = target.closest("[data-dev-batch-select]");
    if (selectBtn) {
      const fixtureId = String(selectBtn.getAttribute("data-dev-batch-select") || "");
      toggleFixtureSelection(ctx, fixtureId);
      return;
    }

    // data-dev-batch-focus → setFocusedFixture
    const focusBtn = target.closest("[data-dev-batch-focus]");
    if (focusBtn) {
      const fixtureId = String(focusBtn.getAttribute("data-dev-batch-focus") || "");
      setFocusedFixture(ctx, fixtureId);
      return;
    }

    // data-dev-batch-remove → toggleFixtureSelection (deselect)
    const removeBtn = target.closest("[data-dev-batch-remove]");
    if (removeBtn) {
      const fixtureId = String(removeBtn.getAttribute("data-dev-batch-remove") || "");
      toggleFixtureSelection(ctx, fixtureId);
      return;
    }

    // data-dev-batch-expand → toggleExpandResult
    const expandBtn = target.closest("[data-dev-batch-expand]");
    if (expandBtn) {
      const fixtureKey = String(expandBtn.getAttribute("data-dev-batch-expand") || "");
      toggleExpandResult(ctx, fixtureKey);
      return;
    }

    // data-dev-batch-expand-exclusion → toggleExpandExclusion
    const expandExclusionBtn = target.closest("[data-dev-batch-expand-exclusion]");
    if (expandExclusionBtn) {
      const fixtureId = String(
        expandExclusionBtn.getAttribute("data-dev-batch-expand-exclusion") || ""
      );
      toggleExpandExclusion(ctx, fixtureId);
      return;
    }
  });

  // ── Delegated input/change handler ───────────────────────────────────────
  panel.addEventListener("change", (event) => {
    const target = event.target;
    if (!(target instanceof Element)) return;

    // data-dev-batch-publish-key → toggleMarketKey
    if (target.hasAttribute("data-dev-batch-publish-key")) {
      const key = String(target.getAttribute("data-dev-batch-publish-key") || "");
      toggleMarketKey(ctx, key, Boolean(target.checked));
      return;
    }

    // data-dev-batch-exclude-fixture → setFixtureExcluded
    if (target.hasAttribute("data-dev-batch-exclude-fixture")) {
      const fixtureId = String(
        target.getAttribute("data-dev-batch-exclude-fixture") || ""
      );
      setFixtureExcluded(ctx, fixtureId, Boolean(target.checked));
      return;
    }

    // data-dev-batch-exclude-key → toggleMarketExclusion
    if (target.hasAttribute("data-dev-batch-exclude-key")) {
      const key = String(target.getAttribute("data-dev-batch-exclude-key") || "");
      const fixtureId = String(target.getAttribute("data-dev-batch-fixture-id") || "");
      toggleMarketExclusion(ctx, fixtureId, key, Boolean(target.checked));
      return;
    }
  });

  // ── Direct button wiring ──────────────────────────────────────────────────
  panel
    .querySelector("#devBatchLoadFixturesBtn")
    ?.addEventListener("click", () => void loadDevBatchFixtures(ctx, { force: true }));

  panel
    .querySelector("#devBatchConfirmSelectionBtn")
    ?.addEventListener("click", () => confirmSelection(ctx));

  panel
    .querySelector("#devBatchBackBtn")
    ?.addEventListener("click", () => goBack(ctx));

  panel
    .querySelector("#devBatchStopBtn")
    ?.addEventListener("click", () => void requestStop(ctx));

  panel
    .querySelector("#devBatchVerifyBtn")
    ?.addEventListener("click", () => void verifyBatch(ctx));

  panel
    .querySelector("#devBatchPublishBtn")
    ?.addEventListener("click", () => openDevBatchConfirmModal(ctx, false));

  panel
    .querySelector("#devBatchRetryFailedBtn")
    ?.addEventListener("click", () => openDevBatchConfirmModal(ctx, true));

  panel.querySelector("#devBatchClearAllBtn")?.addEventListener("click", () => clearSelection(ctx));

  panel
    .querySelector("#devBatchSelectUnpublishedBtn")
    ?.addEventListener("click", () => selectUnpublishedFixtures(ctx));

  panel
    .querySelector("#devBatchSelectPartialBtn")
    ?.addEventListener("click", () => selectPartialFixtures(ctx));

  // ── Filter inputs ─────────────────────────────────────────────────────────
  panel.querySelector("#devBatchSearchInput")?.addEventListener("input", (event) => {
    ctx.state.devBatch.filters.search = String(event.target.value || "");
    ctx.ui.persistEnvironmentScopedSnapshot();
    ctx.ui.renderDevBatchConsole();
  });

  panel.querySelector("#devBatchLeagueFilter")?.addEventListener("change", (event) => {
    ctx.state.devBatch.filters.leagueFilter = String(event.target.value || "");
    ctx.ui.persistEnvironmentScopedSnapshot();
    ctx.ui.renderDevBatchConsole();
  });

  panel.querySelector("#devBatchFilterUnpublished")?.addEventListener("change", (event) => {
    ctx.state.devBatch.filters.unpublishedOnly = Boolean(event.target.checked);
    ctx.ui.persistEnvironmentScopedSnapshot();
    ctx.ui.renderDevBatchConsole();
  });

  panel.querySelector("#devBatchFilterPartial")?.addEventListener("change", (event) => {
    ctx.state.devBatch.filters.partialOnly = Boolean(event.target.checked);
    ctx.ui.persistEnvironmentScopedSnapshot();
    ctx.ui.renderDevBatchConsole();
  });

  panel.querySelector("#devBatchFilterSelected")?.addEventListener("change", (event) => {
    ctx.state.devBatch.filters.selectedOnly = Boolean(event.target.checked);
    ctx.ui.persistEnvironmentScopedSnapshot();
    ctx.ui.renderDevBatchConsole();
  });

  // ── Confirm dialog (outside panel, wire directly) ─────────────────────────
  wireConfirmDialog(ctx);
}

function wireConfirmDialog(ctx) {
  const dialog = document.getElementById("devBatchConfirmDialog");
  if (!dialog) return;

  dialog
    .querySelector("#devBatchConfirmOperatorInput")
    ?.addEventListener("input", () => syncDevBatchDialogPublishBtn(ctx));

  dialog
    .querySelector("#devBatchConfirmCountInput")
    ?.addEventListener("input", () => syncDevBatchDialogPublishBtn(ctx));

  dialog
    .querySelector("#devBatchDialogConfirmCheckbox")
    ?.addEventListener("change", () => syncDevBatchDialogPublishBtn(ctx));

  dialog
    .querySelector("#devBatchConfirmDialogCancelBtn")
    ?.addEventListener("click", () => closeDevBatchConfirmModal(ctx));

  dialog
    .querySelector("#devBatchConfirmDialogPublishBtn")
    ?.addEventListener("click", () => {
      const retryFailedOnly = dialog?.dataset.retryFailedOnly === "true";
      ctx.state.devBatch.confirmation.operator_name = String(
        dialog.querySelector("#devBatchConfirmOperatorInput")?.value || ""
      ).trim();
      ctx.state.devBatch.confirmation.fixture_count = String(
        dialog.querySelector("#devBatchConfirmCountInput")?.value || ""
      ).trim();
      ctx.state.devBatch.confirmation.confirmed = Boolean(
        dialog.querySelector("#devBatchDialogConfirmCheckbox")?.checked
      );
      ctx.ui.persistEnvironmentScopedSnapshot();
      closeDevBatchConfirmModal(ctx);
      void publishBatch(ctx, { retryFailedOnly });
    });
}
