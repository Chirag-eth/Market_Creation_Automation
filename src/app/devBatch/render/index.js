import { renderSelectionStep } from "./selectionStep.js";
import { renderConfigStep } from "./configStep.js";

/**
 * Main render orchestrator.
 * @param {Element} panel - The #devBatchPanel element
 * @param {object} batchState - Current devBatch state slice
 * @param {object} deps - External function dependencies
 */
export function render(panel, batchState, deps = {}) {
  if (!panel) return;

  const step = batchState?.step || "selection";

  // Update step attribute for CSS visibility
  panel.dataset.step = step;

  // Update stepper indicators
  panel.querySelectorAll(".dev-batch-stepper__item").forEach((item) => {
    const itemStep = item.dataset.step;
    item.classList.toggle("is-active", itemStep === step);
    item.classList.toggle("is-done", step === "config" && itemStep === "selection");
  });

  if (step === "selection") {
    renderSelectionStep(panel, batchState, deps);
  } else {
    renderConfigStep(panel, batchState, deps);
  }
}
