import {
  selectSelectedFixtures,
  selectVerificationByFixture,
  getDevBatchFixtureCounts,
  getDevBatchRunTone,
} from "../selectors.js";
import { MARKET_GROUPS } from "../constants.js";
import { COPY } from "../constants.js";

/**
 * Renders the compact selected-fixtures list in the config step.
 *
 * Each row shows:
 *  - Event name + meta
 *  - Status badge
 *  - Remove button
 *  - "Exclude fixture" toggle
 *  - "Customize markets" expand toggle → grouped exclusion grid
 */
export function renderSelectedFixtures(containerEl, batchState, deps = {}) {
  if (!containerEl) return;

  const getIdentity = deps.getScheduleFixtureIdentity || fallbackIdentity;
  const getLeagueLabel = deps.getScheduleLeagueLabel || ((code) => String(code || "").toUpperCase());
  const escHtml = deps.escapeHtml || ((s) => s);
  const escAttr = deps.escapeHtmlAttribute || ((s) => s);

  const selectedFixtures = selectSelectedFixtures(batchState, deps);
  const verificationByFixture = selectVerificationByFixture(batchState);
  const expandedExclusionIds = new Set(
    Array.isArray(batchState.expandedExclusionIds) ? batchState.expandedExclusionIds : []
  );

  if (selectedFixtures.length === 0) {
    containerEl.innerHTML = `<div class="dev-batch-empty">${COPY.emptySelected}</div>`;
    return;
  }

  containerEl.innerHTML = selectedFixtures
    .map((fixture) => {
      const fixtureId = getIdentity(fixture);
      const verification = verificationByFixture.get(fixtureId);
      const counts = getDevBatchFixtureCounts(verification);
      const verTone =
        verification?.row_tone || getDevBatchRunTone(verification?.status);
      const verLabel =
        verification?.row_label || verification?.status || "selected";

      const exclusion = batchState.perFixtureExclusions?.[fixtureId] || {
        excluded_fixture: false,
        excluded_publish_keys: [],
      };
      const isExcluded = Boolean(exclusion.excluded_fixture);
      const isExpanded = expandedExclusionIds.has(fixtureId);
      const excludedKeySet = new Set(
        Array.isArray(exclusion.excluded_publish_keys)
          ? exclusion.excluded_publish_keys
          : []
      );

      const metaStr = escHtml(
        `${fixture.leagueLabel || getLeagueLabel(fixture?.leagueCode || "")} \u00b7 ${fixture.fixtureDate || ""} ${fixture.kickoffTimeUtc || ""} UTC \u00b7 Game ID ${fixture.gameId || "\u2014"}`
      );

      // Per-fixture exclusion grid (grouped)
      const exclusionGridHtml = MARKET_GROUPS.map((group) => {
        const optionsHtml = group.options
          .map((option) => {
            const isExcludedKey = excludedKeySet.has(option.key);
            return `<label class="field-option${isExcludedKey ? " is-selected" : ""}">
              <input
                type="checkbox"
                data-dev-batch-exclude-key="${escAttr(option.key)}"
                data-dev-batch-fixture-id="${escAttr(fixtureId)}"
                ${isExcludedKey ? "checked" : ""}
              />
              <span>${escHtml(option.label)}</span>
            </label>`;
          })
          .join("");
        return `<div class="dev-batch-market-group">
          <div class="dev-batch-market-group__label">${escHtml(group.label)}</div>
          <div class="dev-batch-market-group__options">${optionsHtml}</div>
        </div>`;
      }).join("");

      return `<div class="dev-batch-chip${isExcluded ? " is-excluded" : ""}">
        <div class="dev-batch-chip__top">
          <div>
            <p class="dev-batch-chip__title">${escHtml(String(fixture?.eventName || "").trim())}</p>
            <div class="dev-batch-chip__meta">${metaStr}</div>
            <div class="dev-batch-chip__stats">
              <span class="mini-badge">Existing ${counts.existing}</span>
              <span class="mini-badge" data-tone="${counts.missing > 0 ? "warn" : "neutral"}">Missing ${counts.missing}</span>
            </div>
          </div>
          <div class="actions-inline">
            <span class="mini-badge" data-tone="${escAttr(verTone)}">${escHtml(verLabel)}</span>
            <button type="button" class="btn btn-secondary btn-mini" data-dev-batch-remove="${escAttr(fixtureId)}">Remove</button>
          </div>
        </div>
        <div class="dev-batch-chip__footer">
          <label class="field-option field-option-inline dev-batch-chip__exclude-toggle">
            <input
              type="checkbox"
              data-dev-batch-exclude-fixture="${escAttr(fixtureId)}"
              ${isExcluded ? "checked" : ""}
            />
            <span>Exclude fixture</span>
          </label>
          <button
            type="button"
            class="btn btn-ghost btn-mini"
            data-dev-batch-expand-exclusion="${escAttr(fixtureId)}"
          >Customize markets ${isExpanded ? "\u25be" : "\u25b8"}</button>
        </div>
        ${isExpanded ? `<div class="dev-batch-exclusion-panel">${exclusionGridHtml}</div>` : ""}
      </div>`;
    })
    .join("");
}

function fallbackIdentity(fixture) {
  const gameId = String(fixture?.gameId || fixture?.game_id || "").trim();
  if (gameId) return `game:${gameId}`;
  return String(fixture?.eventName || "").toLowerCase().trim();
}
