// preload.cjs — the bridge between the main process and the single window.
// CommonJS (not preload.mjs's ESM), specifically so this can run under
// Electron's OS-level renderer sandbox: the sandboxed preload loader doesn't
// support `import` syntax. Otherwise identical to the ESM version this
// replaces — everything that used to be renderer-to-renderer IPC (stimulate
// a circuit, move the environment sliders, push spikes/rates to a second
// window) is now a plain function call inside one page (see
// renderer/app.js) and needs no channel here at all. Only genuine
// main-process things remain: OS idle/CPU senses, tray commands, and
// loading the connectome data from disk.

const { contextBridge, ipcRenderer } = require('electron');

const on = (channel) => (fn) => {
  ipcRenderer.on(channel, (_e, payload) => fn(payload));
};

contextBridge.exposeInMainWorld('flyAPI', {
  getBrainData: () => ipcRenderer.invoke('brain-data'),
  getSpecimenCatalog: () => ipcRenderer.invoke('specimen-catalog'),
  getSpecimenData: (id) => ipcRenderer.invoke('specimen-data', id),
  getSpecimenMorphology: (id, profileId) => ipcRenderer.invoke('specimen-morphology', id, profileId),
  getSpecimenCell: (id, neuron, sha256) => ipcRenderer.invoke('specimen-cell', id, neuron, sha256),
  getSpecimenPath: (id, query, sha256) => ipcRenderer.invoke('specimen-path', id, query, sha256),
  onAmbient: on('ambient'),   // typing/sleep/tempo/activity, 30 Hz
  onCommand: on('cmd'),       // tray: pause, addFly, removeFly, scareAll
  // The in-window pause button is a second way to set the same state the
  // tray's Pause/Fortsetzen item controls — this tells main so the tray
  // label stays correct no matter which one was actually clicked.
  setPaused: (value) => ipcRenderer.send('renderer-set-paused', value),
  // Hands recorded CSV text to main, which asks the user where to put it.
  // Content only — the path is the user's choice in main's save dialog, never
  // the renderer's, so this cannot be turned into an arbitrary file write.
  saveRecording: (csv) => ipcRenderer.invoke('save-recording', csv),
  saveExperiment: (json) => ipcRenderer.invoke('save-experiment', json),
  setRecordingState: (state) => ipcRenderer.send('recording-state', state),
  saveLearningRecord: (csv) => ipcRenderer.invoke('save-learning-record', csv),
  saveManifest: (json) => ipcRenderer.invoke('save-manifest', json),
  // Captures before the dialog opens. Main owns the dialog and destination;
  // the renderer only receives the selected path after a successful save.
  saveSnapshot: () => ipcRenderer.invoke('save-snapshot'),
  // Opens a literature link in the default browser; main accepts only https
  // links to a fixed list of scientific hosts.
  openExternal: (url) => ipcRenderer.invoke('open-external', url),
});
