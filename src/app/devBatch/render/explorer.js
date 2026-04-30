import {
  selectVisibleFixtures,
  selectSelectedIds,
  selectVerificationByFixture,
  getDevBatchFixtureCounts,
  getDevBatchRunTone,
} from "../selectors.js";
import { COPY } from "../constants.js";

/**
 * Renders the fixture explorer list grouped into:
 *  - "Pinned" (selected fixtures, in selection order)
 *  - "Available" (unselected visible fixtures)
 *
 * Uses event delegation only — no per-row listeners.
 */
export function renderExplorer(panel, batchState, deps = {}) {
  const listEl = panel.querySelector("#devBatchExplorerList");
  if (!listEl) return;

  const getIdentity = deps.getScheduleFixtureIdentity || fallbackIdentity;
  const getLeagueLabel = deps.getScheduleLeagueLabel || ((code) => code.toUpperCase());
  const escHtml = deps.escapeHtml || ((s) => s);
  const escAttr = deps.escapeHtmlAttribute || ((s) => s);

  if (batchState.isLoadingFixtures) {
    listEl.innerHTML = `<div class="dev-batch-empty">${COPY.loadingFixtures}</div>`;
    return;
  }

  const fixtures = Array.isArray(batchState.fixtures) ? batchState.fixtures : [];
  if (fixtures.length === 0) {
    listEl.innerHTML = `<div class="dev-batch-empty">${COPY.emptyFixtures}</div>`;
    return;
  }

  const visibleFixtures = selectVisibleFixtures(batchState, deps);
  const selectedIdSet = new Set(selectSelectedIds(batchState));
  const verificationByFixture = selectVerificationByFixture(batchState);
  const selectionOrder = Array.isArray(batchState.selectedFixtureIds)
    ? batchState.selectedFixtureIds
    : [];

  if (visibleFixtures.length === 0) {
    listEl.innerHTML = `<div class="dev-batch-empty">${COPY.noFixturesFiltered}</div>`;
    return;
  }

  // Build pinned (selected) list in selection order, filtered to what's visible
  const visibleIds = new Set(visibleFixtures.map((f) => getIdentity(f)));
  const pinnedFixtures = selectionOrder
    .filter((id) => visibleIds.has(id))
    .map((id) => visibleFixtures.find((f) => getIdentity(f) === id))
    .filter(Boolean);

  const unselectedFixtures = visibleFixtures.filter(
    (f) => !selectedIdSet.has(getIdentity(f))
  );

  const showGroups = pinnedFixtures.length > 0 && unselectedFixtures.length > 0;
  const showOnlyPinned = pinnedFixtures.length > 0 && unselectedFixtures.length === 0;

  let html = "";

  if (showGroups || showOnlyPinned) {
    html += `<div class="dev-batch-group">
      <div class="dev-batch-group__header dev-batch-group__header--pinned">&#x2713; Pinned (${pinnedFixtures.length})</div>
      ${pinnedFixtures.map((f) => renderExplorerRow(f, true, batchState, verificationByFixture, deps)).join("")}
    </div>`;
  }

  if (showGroups || (!showOnlyPinned && unselectedFixtures.length > 0)) {
    const showHeader = showGroups;
    html += showHeader
      ? `<div class="dev-batch-group">
          <div class="dev-batch-group__header">Available (${unselectedFixtures.length})</div>
          ${unselectedFixtures.map((f) => renderExplorerRow(f, false, batchState, verificationByFixture, deps)).join("")}
        </div>`
      : unselectedFixtures.map((f) => renderExplorerRow(f, false, batchState, verificationByFixture, deps)).join("");
  }

  listEl.innerHTML = html;
}

function renderExplorerRow(fixture, isSelected, batchState, verificationByFixture, deps) {
  const getIdentity = deps.getScheduleFixtureIdentity || fallbackIdentity;
  const getLeagueLabel = deps.getScheduleLeagueLabel || ((code) => code.toUpperCase());
  const escHtml = deps.escapeHtml || ((s) => s);
  const escAttr = deps.escapeHtmlAttribute || ((s) => s);

  const fixtureId = getIdentity(fixture);
  const verification = verificationByFixture.get(fixtureId);
  const counts = getDevBatchFixtureCounts(verification);
  const verTone = verification?.row_tone || getDevBatchRunTone(verification?.status);
  const verLabel = verification?.row_label || verification?.status || "unverified";

  // Determine run state for row styling
  const currentRunFixtures = Array.isArray(batchState.currentRun?.fixtures)
    ? batchState.currentRun.fixtures
    : [];
  const runFixture = currentRunFixtures.find(
    (rf) =>
      String(rf?.fixture_key || "").trim() === fixtureId ||
      `game:${String(rf?.fixture_key || "").trim()}` === fixtureId
  );
  const runStatus = String(runFixture?.status || "").trim().toLowerCase();

  let rowClasses = "dev-batch-explorer-row";
  if (isSelected) rowClasses += " is-selected";
  if (fixtureId === String(batchState.focusedFixtureId || "")) rowClasses += " is-focused";
  if (runStatus === "publishing") rowClasses += " is-publishing";
  else if (["completed", "partial"].includes(runStatus)) rowClasses += " is-completed";
  else if (["failed", "failed_precheck"].includes(runStatus)) rowClasses += " is-failed";
  if (batchState.perFixtureExclusions?.[fixtureId]?.excluded_fixture) rowClasses += " is-excluded";

  const leagueLabel = escHtml(String(fixture.leagueLabel || getLeagueLabel(fixture?.leagueCode || "")));
  const dateStr = escHtml(`${fixture.fixtureDate || ""} ${fixture.kickoffTimeUtc || ""} UTC`.trim());

  return `<div class="${rowClasses}" role="listitem">
    <span class="dev-batch-row-state-dot" aria-hidden="true"></span>
    <button type="button" class="dev-batch-explorer-row__main" data-dev-batch-focus="${escAttr(fixtureId)}">
      <div class="dev-batch-explorer-row__top">
        <div>
          <p class="dev-batch-explorer-row__title">${escHtml(String(fixture?.eventName || "").trim())}</p>
          <div class="dev-batch-explorer-row__meta">${dateStr}</div>
        </div>
        <span class="dev-batch-row-indicator mini-badge" data-tone="${escAttr(verTone)}">${escHtml(verLabel)}</span>
      </div>
      <div class="dev-batch-explorer-row__stats">
        <span class="mini-badge">${leagueLabel}</span>
        <span class="mini-badge">Game ID ${escHtml(String(fixture.gameId || "\u2014"))}</span>
        <span class="mini-badge">Existing ${counts.existing}</span>
        <span class="mini-badge" data-tone="${counts.missing > 0 ? "warn" : "neutral"}">Missing ${counts.missing}</span>
      </div>
    </button>
    <div class="dev-batch-explorer-row__actions">
      <button type="button" class="btn btn-secondary btn-mini" data-dev-batch-select="${escAttr(fixtureId)}">${isSelected ? "Remove" : "Select"}</button>
    </div>
  </div>`;
}

function fallbackIdentity(fixture) {
  const gameId = String(fixture?.gameId || fixture?.game_id || "").trim();
  if (gameId) return `game:${gameId}`;
  return String(fixture?.eventName || "").toLowerCase().trim();
}
