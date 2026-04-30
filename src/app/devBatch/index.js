export { createInitialDevBatchState } from "./state.js";
export { render } from "./render/index.js";
export { wireEvents } from "./events/index.js";

import { render } from "./render/index.js";
import { wireEvents } from "./events/index.js";
import {
  getDevBatchRunTone,
  selectVerificationByFixture,
  getDevBatchFixtureCounts,
  getDevBatchMarketRows,
} from "./selectors.js";
import { PUBLISH_KEYS, MARKET_OPTIONS } from "./constants.js";

/**
 * Mount the devBatch module onto the given panel element.
 *
 * @param {object} options
 * @param {Element} options.panel - The #devBatchPanel DOM element
 * @param {Function} options.getState - Returns the devBatch state slice
 * @param {Function} options.patchState - Patches the devBatch state slice
 * @param {object} options.deps - External function dependencies from ui.js
 * @returns {{ render: Function }}
 */
export function mountDevBatch({ panel, getState, patchState, deps }) {
  const renderDeps = {
    getScheduleFixtureIdentity: deps.getScheduleFixtureIdentity,
    getScheduleLeagueLabel: deps.getScheduleLeagueLabel,
    normalizeForSearch: deps.normalizeForSearch,
    escapeHtml: deps.escapeHtml,
    escapeHtmlAttribute: deps.escapeHtmlAttribute,
    slugify: deps.slugify,
  };

  function renderFn() {
    render(panel, getState(), renderDeps);
  }

  // Build the action context that all action functions consume.
  const ctx = {
    get state() {
      // The parent state object so actions can write to state.devBatch
      return deps._parentState;
    },
    runtime: {
      normalizeRuntimeAppEnvCode: deps.normalizeRuntimeAppEnvCode,
      getScheduleLeagueViewModels: deps.getScheduleLeagueViewModels,
      getScheduleLeagueLabel: deps.getScheduleLeagueLabel,
      getScheduleFixtureIdentity: deps.getScheduleFixtureIdentity,
      normalizeForSearch: deps.normalizeForSearch,
    },
    ui: {
      persistEnvironmentScopedSnapshot: deps.persistEnvironmentScopedSnapshot,
      showToast: deps.showToast,
      showPublishError: deps.showPublishError,
      syncActionState: deps.syncActionState,
      renderDevBatchConsole: renderFn,
      setButtonBusy: deps.setButtonBusy,
      els: deps.els,
    },
    api: {
      fetchUpcomingFixturesForLeague: deps.fetchUpcomingFixturesForLeague,
      fetchCmsBatchRun: deps.fetchCmsBatchRun,
      preflightCmsBatchPublish: deps.preflightCmsBatchPublish,
      publishCmsBatch: deps.publishCmsBatch,
      stopCmsBatchRun: deps.stopCmsBatchRun,
    },
    helpers: {
      escapeHtml: deps.escapeHtml,
      escapeHtmlAttribute: deps.escapeHtmlAttribute,
      slugify: deps.slugify,
      normalizeForSearch: deps.normalizeForSearch,
    },
    selectors: {
      getDevBatchRunTone,
      getDevBatchVerificationByFixture: selectVerificationByFixture,
      getDevBatchFixtureCounts,
      getDevBatchMarketRows,
    },
    feature: {
      publishKeySet: PUBLISH_KEYS,
      publishOptions: MARKET_OPTIONS,
    },
  };

  wireEvents(panel, ctx);

  return { render: renderFn };
}
