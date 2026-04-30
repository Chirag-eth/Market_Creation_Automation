import { MARKET_GROUPS } from "../constants.js";

/**
 * Renders market families GROUPED into Core / Totals / Spreads sections.
 */
export function renderMarketConfig(containerEl, batchState, deps = {}) {
  if (!containerEl) return;

  const escHtml = deps.escapeHtml || ((s) => s);
  const escAttr = deps.escapeHtmlAttribute || ((s) => s);
  const slugify = deps.slugify || ((s) => s.replace(/[^a-z0-9]+/gi, "-").toLowerCase());

  const selectedKeys = new Set(
    Array.isArray(batchState?.selectedPublishKeys) ? batchState.selectedPublishKeys : []
  );

  containerEl.innerHTML = MARKET_GROUPS.map((group) => {
    const optionsHtml = group.options
      .map((option) => {
        const optionId = `devBatchPublishKey-${slugify(option.key)}`;
        const isChecked = selectedKeys.has(option.key);
        return `<label class="field-option${isChecked ? " is-selected" : ""}" for="${escAttr(optionId)}">
          <input
            id="${escAttr(optionId)}"
            type="checkbox"
            data-dev-batch-publish-key="${escAttr(option.key)}"
            ${isChecked ? "checked" : ""}
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
}
