import { renderMarketConfig } from "./marketConfig.js";
import { renderSelectedFixtures } from "./selectedFixtures.js";
import { renderStatusRail } from "./statusRail.js";
import { selectSelectionSummary, selectCanPublish, selectCanRetryFailed } from "../selectors.js";

export function renderConfigStep(panel, batchState, deps = {}) {
  // Back nav meta badge
  const selectionMetaEl = panel.querySelector("#devBatchSelectionMeta");
  const summary = selectSelectionSummary(batchState, deps);
  if (selectionMetaEl) {
    selectionMetaEl.textContent = summary.selectionMeta;
    selectionMetaEl.dataset.tone = summary.count > 0 ? "success" : "neutral";
  }

  const configMetaEl = panel.querySelector("#devBatchConfigMeta");
  if (configMetaEl) {
    configMetaEl.textContent = summary.configMeta;
  }

  const selectionCountEl = panel.querySelector("#devBatchSelectionCount");
  if (selectionCountEl) {
    selectionCountEl.textContent = summary.selectionCount;
  }

  // Market families
  const marketKeysEl = panel.querySelector("#devBatchMarketKeys");
  renderMarketConfig(marketKeysEl, batchState, deps);

  // Selected fixtures list
  const selectedFixturesEl = panel.querySelector("#devBatchSelectedFixtures");
  renderSelectedFixtures(selectedFixturesEl, batchState, deps);

  // Publish action buttons
  const verifyBtn = panel.querySelector("#devBatchVerifyBtn");
  if (verifyBtn) {
    verifyBtn.disabled =
      batchState.isVerifying ||
      batchState.isLoadingFixtures ||
      (Array.isArray(batchState.selectedFixtureIds) ? batchState.selectedFixtureIds.length === 0 : true) ||
      (Array.isArray(batchState.selectedPublishKeys) ? batchState.selectedPublishKeys.length === 0 : true);
    verifyBtn.textContent = batchState.isVerifying ? "Verifying\u2026" : "Verify Batch";
  }

  const publishBtn = panel.querySelector("#devBatchPublishBtn");
  if (publishBtn) {
    publishBtn.disabled = !selectCanPublish(batchState);
    publishBtn.textContent = batchState.isPublishing ? "Publishing\u2026" : "Publish Missing";
  }

  const retryBtn = panel.querySelector("#devBatchRetryFailedBtn");
  if (retryBtn) {
    const canRetry = selectCanRetryFailed(batchState);
    retryBtn.hidden = !canRetry;
    retryBtn.disabled = !canRetry || batchState.isPublishing;
  }

  // Status rail (right column)
  renderStatusRail(panel, batchState, deps);
}
