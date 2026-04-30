// store.js — initialized once from ui.js via mountDevBatch()
let _getState;
let _patch;
let _deps;
let _render; // the main render function

export function initStore({ getState, patch, deps, onRender }) {
  _getState = getState;
  _patch = patch;
  _deps = deps;
  _render = onRender;
}

export function getState() {
  if (!_getState) throw new Error("devBatch store not initialized — call initStore first");
  return _getState();
}

export function patchState(p) {
  if (!_patch) throw new Error("devBatch store not initialized — call initStore first");
  _patch(p);
}

export function getDeps() {
  if (!_deps) throw new Error("devBatch store not initialized — call initStore first");
  return _deps;
}

export function triggerRender() {
  if (_render) _render();
}
