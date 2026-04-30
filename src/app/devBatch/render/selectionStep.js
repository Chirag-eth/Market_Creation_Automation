import { renderSummaryBar } from "./summaryBar.js";
import { renderExplorer } from "./explorer.js";
import { selectLeagueOptions } from "../selectors.js";

export function renderSelectionStep(panel, batchState, deps = {}) {
  const escHtml = deps.escapeHtml || ((s) => s);
  const escAttr = deps.escapeHtmlAttribute || ((s) => s);

  // Summary bar
  renderSummaryBar(panel, batchState, deps);

  // Sync filter inputs
  const searchInput = panel.querySelector("#devBatchSearchInput");
  if (searchInput && searchInput.value !== String(batchState.filters?.search || "")) {
    searchInput.value = String(batchState.filters?.search || "");
  }

  const filterUnpublished = panel.querySelector("#devBatchFilterUnpublished");
  if (filterUnpublished) filterUnpublished.checked = Boolean(batchState.filters?.unpublishedOnly);

  const filterPartial = panel.querySelector("#devBatchFilterPartial");
  if (filterPartial) filterPartial.checked = Boolean(batchState.filters?.partialOnly);

  const filterSelected = panel.querySelector("#devBatchFilterSelected");
  if (filterSelected) filterSelected.checked = Boolean(batchState.filters?.selectedOnly);

  // League filter
  const leagueFilter = panel.querySelector("#devBatchLeagueFilter");
  if (leagueFilter) {
    const currentLeagueFilter = String(batchState.filters?.leagueFilter || "");
    const leagueOptions = selectLeagueOptions(batchState);
    const optionsHtml =
      `<option value="">All Leagues</option>` +
      leagueOptions
        .map(
          (o) =>
            `<option value="${escAttr(o.code)}"${o.code === currentLeagueFilter ? " selected" : ""}>${escHtml(o.label)}</option>`
        )
        .join("");
    if (leagueFilter.innerHTML !== optionsHtml) {
      leagueFilter.innerHTML = optionsHtml;
    }
    if (leagueFilter.value !== currentLeagueFilter) {
      leagueFilter.value = currentLeagueFilter;
    }
  }

  // Explorer list
  renderExplorer(panel, batchState, deps);
}
