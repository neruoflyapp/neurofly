// Main-process policy; keep state validation independent of Electron dialogs.
export function recordingState(value = {}) {
  return Object.freeze({ active: value.active === true, saving: value.saving === true,
    rows: Number.isSafeInteger(value.rows) && value.rows >= 0 ? value.rows : 0 });
}
export function recordingExitPolicy(state) {
  if (state.saving) return 'wait';
  return state.active || state.rows > 0 ? 'confirm' : 'allow';
}
