import { MARKET_GROUPS } from "../constants.js";
import { getSpreadMarketLabel, buildSpreadMarketTooltip } from "../utils/spreadTitleExtraction.js";

/**
 * Renders market families GROUPED into Core / Totals / Spreads sections.
 * For spreads, shows team-specific labels if a fixture is selected.
 */
export function renderMarketConfig(containerEl, batchState, deps = {}) {
  if (!containerEl) return;

  const escHtml = deps.escapeHtml || ((s) => s);
  const escAttr = deps.escapeHtmlAttribute || ((s) => s);
  const slugify = deps.slugify || ((s) => s.replace(/[^a-z0-9]+/gi, "-").toLowerCase());
  const getFixtureIdentity = deps.getScheduleFixtureIdentity || fallbackIdentity;

  const selectedKeys = new Set(
    Array.isArray(batchState?.selectedPublishKeys) ? batchState.selectedPublishKeys : []
  );

  const selectedFixtureIds = Array.isArray(batchState?.selectedFixtureIds)
    ? batchState.selectedFixtureIds
    : [];
  const firstSelectedFixtureId = selectedFixtureIds[0];
  const fixtures = Array.isArray(batchState?.fixtures) ? batchState.fixtures : [];
  const selectedFixture = firstSelectedFixtureId
    ? fixtures.find((f) => getFixtureIdentity(f) === firstSelectedFixtureId)
    : null;

  containerEl.innerHTML = MARKET_GROUPS.map((group) => {
    const optionsHtml = group.options
      .map((option) => {
        const optionId = `devBatchPublishKey-${slugify(option.key)}`;
        const isChecked = selectedKeys.has(option.key);
        let label = option.label;
        let title = "";

        if (group.label === "Spreads" && selectedFixture) {
          const isAway = option.key.includes("|away");
          const lineMatch = option.key.match(/spreads\|(\d+(?:\.\d+)?)\|/);
          const spreadLine = lineMatch ? lineMatch[1] : null;

          if (spreadLine) {
            label = getSpreadMarketLabel(selectedFixture, spreadLine, isAway);
            title = buildSpreadMarketTooltip(selectedFixture, spreadLine);
          }
        }

        const titleAttr = title ? ` title="${escAttr(title)}"` : "";
        return `<label class="field-option${isChecked ? " is-selected" : ""}" for="${escAttr(optionId)}"${titleAttr}>
          <input
            id="${escAttr(optionId)}"
            type="checkbox"
            data-dev-batch-publish-key="${escAttr(option.key)}"
            ${isChecked ? "checked" : ""}
          />
          <span>${escHtml(label)}</span>
        </label>`;
      })
      .join("");
    return `<div class="dev-batch-market-group">
      <div class="dev-batch-market-group__label">${escHtml(group.label)}</div>
      <div class="dev-batch-market-group__options">${optionsHtml}</div>
    </div>`;
  }).join("");
}

function fallbackIdentity(fixture) {
  return String(fixture?.id || fixture?.gameId || fixture?.game_id || fixture?.key || "").trim();
}
