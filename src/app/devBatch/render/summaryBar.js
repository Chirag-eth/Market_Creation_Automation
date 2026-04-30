import { selectSelectionSummary, selectCanConfirm } from "../selectors.js";

export function renderSummaryBar(panel, batchState, deps = {}) {
  const summary = selectSelectionSummary(batchState, deps);
  const canConfirm = selectCanConfirm(batchState);

  const countEl = panel.querySelector("#devBatchSummaryCount");
  const leaguesEl = panel.querySelector("#devBatchSummaryLeagues");
  const clearBtn = panel.querySelector("#devBatchClearAllBtn");
  const confirmBtn = panel.querySelector("#devBatchConfirmSelectionBtn");

  if (countEl) {
    countEl.textContent = summary.count === 0
      ? "0 / 10 fixtures"
      : `${summary.count} / 10 fixtures`;
    countEl.classList.toggle("dev-batch-summary-count--active", summary.count > 0);
  }

  if (leaguesEl) {
    leaguesEl.textContent =
      summary.leagues.length > 0 ? summary.leagues.join(" \u00b7 ") : "Select fixtures below";
  }

  if (clearBtn) {
    clearBtn.disabled = summary.count === 0;
  }

  if (confirmBtn) {
    confirmBtn.disabled = !canConfirm;
    confirmBtn.textContent =
      summary.count === 0 ? "Confirm 0 Fixtures \u2192" : `Confirm ${summary.count} Fixture${summary.count === 1 ? "" : "s"} \u2192`;
  }
}
