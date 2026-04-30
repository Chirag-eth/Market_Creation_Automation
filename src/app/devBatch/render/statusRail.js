import {
  getDevBatchAggregateStatusCards,
  getDevBatchRunTone,
  getDevBatchRunSummary,
} from "../selectors.js";
import { renderResultRow } from "./resultRow.js";
import { COPY } from "../constants.js";


export function renderStatusRail(panel, batchState, deps = {}) {
  const escHtml = deps.escapeHtml || ((s) => s);
  const escAttr = deps.escapeHtmlAttribute || ((s) => s);

  // Status badge + stop button
  const runStickyEl = panel.querySelector("#devBatchRunSticky");
  const stopBtn = panel.querySelector("#devBatchStopBtn");
  const run = batchState.currentRun;
  const runStatus = String(run?.status || "").trim().toLowerCase();
  const canStop =
    ["queued", "running"].includes(runStatus) && !run?.stop_requested;
  const isRunning = ["queued", "running", "stopping"].includes(runStatus);

  if (runStickyEl) {
    runStickyEl.textContent = run?.status ? String(run.status).toUpperCase() : "Idle";
    runStickyEl.dataset.tone = getDevBatchRunTone(run?.status);
  }
  if (stopBtn) {
    stopBtn.hidden = !isRunning;
    stopBtn.disabled = !canStop;
    stopBtn.textContent = run?.stop_requested ? "Stopping\u2026" : "Stop";
  }

  // Stopping context message
  const stopMsgEl = panel.querySelector("#devBatchStopMsg");
  if (stopMsgEl) {
    const isStopping = Boolean(run?.stop_requested) && isRunning;
    stopMsgEl.hidden = !isStopping;
    stopMsgEl.textContent = isStopping ? COPY.stoppingMessage : "";
  }

  // Aggregate bar
  const aggregateBarEl = panel.querySelector("#devBatchAggregateBar");
  if (aggregateBarEl) {
    const source = batchState.currentRun || batchState.verification || null;
    const cards = getDevBatchAggregateStatusCards(source);
    aggregateBarEl.innerHTML = cards
      .map(
        (card) =>
          `<div class="dev-batch-status-card" data-tone="${escAttr(card.tone)}">
            <span class="dev-batch-status-card__label">${escHtml(card.label)}</span>
            <strong class="dev-batch-status-card__value">${escHtml(String(card.value))}</strong>
          </div>`
      )
      .join("");
  }

  // Summary text
  const summaryEl = panel.querySelector("#devBatchSummary");
  if (summaryEl) {
    const summaryData = getDevBatchRunSummary(batchState);
    summaryEl.textContent = summaryData.summary;
    summaryEl.dataset.tone = summaryData.tone;
  }

  // Results list
  const resultsEl = panel.querySelector("#devBatchResults");
  if (resultsEl) {
    const sourceFixtures = Array.isArray(
      (batchState.currentRun || batchState.verification)?.fixtures
    )
      ? (batchState.currentRun || batchState.verification).fixtures
      : [];
    const expandedSet = new Set(
      Array.isArray(batchState.expandedFixtureKeys) ? batchState.expandedFixtureKeys : []
    );
    resultsEl.innerHTML = sourceFixtures.length
      ? sourceFixtures.map((fixture) => renderResultRow(fixture, expandedSet, deps)).join("")
      : `<div class="dev-batch-empty">${COPY.emptyResults}</div>`;
  }

  // Debug panel
  const debugOutputEl = panel.querySelector("#devBatchDebugOutput");
  if (debugOutputEl) {
    const source = batchState.currentRun || batchState.verification || {};
    debugOutputEl.textContent = Object.keys(source).length
      ? JSON.stringify(source, null, 2)
      : "No batch diagnostics yet.";
  }
}
