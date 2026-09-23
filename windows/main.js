// main.js — the Electron main process. One window now: the fly's terrarium
// and its brain/control panel live on the same page (see renderer/app.js),
// so this file only does what a normal Electron main process does — own the
// window and tray, load the connectome data from disk, and forward the few
// signals that genuinely need OS access (idle timer, CPU load) to the page.
//
// There is no more desktop overlay: no window-terrain polling, no global
// mouse hook, no per-monitor scene mapping. Those existed only so a
// click-through fullscreen overlay could sense a desktop it wasn't allowed
// to receive normal input from. A regular window gets normal input.

import { app, BrowserWindow, Tray, Menu, powerMonitor, nativeImage, ipcMain, dialog, shell } from 'electron';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { loadBrainData } from './src/data.js';
import { createSpecimenService } from './src/specimen-service.js';
import { circadianActivity } from './src/environment.js';
import { createSaveService } from './src/save-io.js';
import { recordingState, recordingExitPolicy } from './src/recording-guard.js';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const DEBUG = !!process.env.NEUROFLY_DEBUG;
// A second launch must not create a second hidden simulation and GPU context.
// Electron scopes this lock to the user-data directory (isolated tests use their own).
const primaryInstance = app.requestSingleInstanceLock();
if (!primaryInstance) app.quit();

let win = null;
let tray = null;
let paused = false;
let typingLevel = 0;
let recordingStatus = recordingState();
let quitApproved = false;
// Main-process texts follow the system language (the renderer's own
// language switch cannot reach the tray and native dialogs).
const tr = (en, de) => (app.getLocale().toLowerCase().startsWith('de') ? de : en);
function allowRecordingExit(action) {
  const policy = recordingExitPolicy(recordingStatus);
  if (policy === 'allow') return true;
  if (!win || win.isDestroyed()) return false;
  win.show(); win.focus();
  if (policy === 'wait') {
    dialog.showMessageBoxSync(win, { type: 'info', title: tr('Saving in progress', 'Speichern läuft'),
      message: tr('Please wait until the current save has finished.', 'Bitte den laufenden Speichervorgang abschließen.'),
      buttons: [tr('Back', 'Zurück')], defaultId: 0, cancelId: 0 });
    return false;
  }
  const leave = action === 'quit' ? tr('Quit without saving', 'Ohne Speichern beenden')
    : tr('Continue without saving', 'Ohne Speichern fortfahren');
  return dialog.showMessageBoxSync(win, { type: 'warning', title: tr('Unsaved recording', 'Ungespeicherte Aufnahme'),
    message: recordingStatus.active ? tr('A recording is still running.', 'Eine Aufzeichnung läuft noch.')
      : tr('A recording has not been saved yet.', 'Eine Aufnahme ist noch nicht gespeichert.'),
    detail: tr('Choose Back and save the recording under Data. Without saving, this recording is lost.',
      'Zurück wählen und die Aufnahme unter Daten speichern. Ohne Speichern geht diese Aufnahme verloren.'),
    buttons: [tr('Back', 'Zurück'), leave], defaultId: 0, cancelId: 0, noLink: true }) === 1;
}

let brainData = null;
let dataInfo = 'no data — run etl.py';

function createWindow() {
  const W = 1500, H = 900;
  const bw = new BrowserWindow({
    width: W,
    height: H,
    minWidth: 1100,
    minHeight: 660,
    title: 'NeuroFly',
    icon: path.join(HERE, 'assets', 'brand', 'neurofly-app-icon.ico'),
    backgroundColor: '#0b100f',
    autoHideMenuBar: true,
    webPreferences: {
      // CommonJS, not ESM — Electron's sandboxed preload loader doesn't
      // support `import` syntax, and OS-level sandboxing needs a preload
      // it can actually load.
      preload: path.join(HERE, 'preload.cjs'),
      backgroundThrottling: false,
      sandbox: true,
    },
  });
  pipeConsole(bw);
  hardenNavigation(bw);
  bw.webContents.on('will-prevent-unload', event => {
    // Electron explicitly uses preventDefault here to ALLOW unloading.
    if (quitApproved || allowRecordingExit('continue')) event.preventDefault();
    else app.isQuitting = false;
  });
  bw.webContents.on('did-finish-load', () => { recordingStatus = recordingState(); });
  // With NEUROFLY_DEBUG set, the page logs a measured performance line every
  // few seconds (see updatePerformanceDisplay). Off by default: normal runs
  // stay silent.
  bw.loadFile(path.join(HERE, 'renderer', 'app.html'), DEBUG ? { query: { debug: '1' } } : undefined);
  return bw;
}

// This app has no links or external content — nothing legitimate ever
// navigates away from app.html or opens a new window. Deny both outright
// (defense in depth alongside the page's own CSP): if a bug or a future
// dependency ever tried, the old default was to actually follow it.
function hardenNavigation(bw) {
  bw.webContents.setWindowOpenHandler(() => ({ action: 'deny' }));
  bw.webContents.on('will-navigate', (e, url) => {
    if (url !== bw.webContents.getURL()) e.preventDefault();
  });
}

// Renderer errors are otherwise invisible; surface them.
function pipeConsole(bw) {
  bw.webContents.on('console-message', (_e, level, message, line, source) => {
    if (DEBUG || level >= 2) {
      process.stderr.write(`[app] ${message} (${source}:${line})
`);
    }
  });
  bw.webContents.on('did-fail-load', (_e, code, desc) => {
    process.stderr.write(`[app] load failed: ${desc} (${code})
`);
  });
  bw.webContents.on('render-process-gone', (_e, details) => {
    process.stderr.write(`[app] renderer gone: ${details.reason} (exit code ${details.exitCode})
`);
  });
}

function send(channel, payload) {
  if (win && !win.isDestroyed()) win.webContents.send(channel, payload);
}

function buildTrayMenu() {
  return Menu.buildFromTemplate([
    { label: 'NeuroFly', enabled: false },
    { label: dataInfo, enabled: false },
    { type: 'separator' },
    {
      label: paused ? tr('Resume', 'Fortsetzen') : tr('Pause', 'Pause'),
      click: () => { paused = !paused; send('cmd', { name: 'pause', value: paused }); refreshTray(); },
    },
    { label: tr('Add a fly', 'Fliege hinzufügen'), click: () => send('cmd', { name: 'addFly' }) },
    { label: tr('Remove a fly', 'Fliege entfernen'), click: () => send('cmd', { name: 'removeFly' }) },
    { label: tr('Startle the flies', 'Fliegen erschrecken'), click: () => send('cmd', { name: 'scareAll' }) },
    { type: 'separator' },
    { label: tr('Show window', 'Fenster anzeigen'), click: () => { if (win) { win.show(); win.focus(); } } },
    { label: tr('Quit', 'Beenden'), click: () => { app.isQuitting = true; app.quit(); } },
  ]);
}

function refreshTray() { if (tray) tray.setContextMenu(buildTrayMenu()); }

// ---- ambient senses: only the ones that genuinely need OS access ----
// Cursor position, clicks and drags are now ordinary DOM input on a normal
// window (see app.js); temperature and wind are now under the user's own
// control in the panel, so only idle-timer-derived typing/sleep is left.
function pollAmbient() {
  const idle = powerMonitor.getSystemIdleTime();   // seconds
  const typingNow = idle < 1 ? 1 : 0;
  typingLevel += (typingNow - typingLevel) * 0.15;

  const t = new Date();
  const h = t.getHours() + t.getMinutes() / 60;
  const sleepy = (idle > 600 && (h >= 22 || h < 6)) || idle > 1800;

  send('ambient', {
    typing: typingLevel,
    sleepy,
    activity: circadianActivity(h),
  });
}

app.setAppUserModelId('com.neurofly.windows');
app.commandLine.appendSwitch('disable-renderer-backgrounding');

app.on('second-instance', () => {
  if (win && !win.isDestroyed()) { if (win.isMinimized()) win.restore(); win.show(); win.focus(); }
});

app.whenReady().then(() => {
  if (!primaryInstance) return;
  try {
    brainData = loadBrainData();
  } catch (error) {
    brainData = null;
    dataInfo = `invalid neural data: ${error.message}`;
    process.stderr.write(`[data] ${dataInfo}\n`);
  }
  if (brainData) {
    dataInfo = `FlyWire v783 · ${brainData.points.points.length} somas · `
      + `circuit ${brainData.circuit.neurons.length}n/${brainData.circuit.edges.length}e`;
    if (brainData.locomotor) dataInfo += ` · MaleCNS ${brainData.locomotor.neurons.length}n`;
    if (brainData.provenance?.brainAudit?.valid) dataInfo += ' · audit ok';
  }

  win = createWindow();
  win.on('close', (e) => {
    if (!app.isQuitting) { e.preventDefault(); win.hide(); }
  });

  tray = new Tray(nativeImage.createFromPath(path.join(HERE, 'assets', 'brand', 'tray-32.png')));
  tray.setToolTip('NeuroFly');
  tray.on('click', () => { if (win) { win.isVisible() ? win.hide() : win.show(); } });
  refreshTray();

  setInterval(pollAmbient, 1000 / 30);
});

ipcMain.handle('brain-data', () => brainData);
const specimens = createSpecimenService();
ipcMain.handle('specimen-catalog', () => specimens.catalog());
ipcMain.handle('specimen-data', (_event, id) => specimens.load(id));
ipcMain.handle('specimen-morphology', (_event, id, profileId) => specimens.morphology(id, profileId));
ipcMain.handle('specimen-cell', (_event, id, neuron, sha256) => specimens.cell(id, neuron, sha256));
ipcMain.handle('specimen-path', (_event, id, query, sha256) => specimens.path(id, query, sha256));
app.on('will-quit', () => { void specimens.close(); });

// Literature links in the panels open in the user's browser. Only plain
// https URLs to a short list of scientific hosts are accepted, so this channel
// cannot be used to launch anything else.
const LINK_HOSTS = ['doi.org', 'pubmed.ncbi.nlm.nih.gov', 'www.nature.com', 'elifesciences.org', 'www.lse.ac.uk',
  'sites.google.com', 'male-cns.janelia.org', 'codex.flywire.ai', 'flywire.ai', 'neurofly.app', 'www.cell.com', 'dataverse.harvard.edu',
  'www.janelia.org', 'connectomics.hms.harvard.edu', 'www.virtualflybrain.org', 'flycellatlas.org', 'flybase.org', 'zenodo.org'];
ipcMain.handle('open-external', (_e, url) => {
  try {
    const u = new URL(String(url));
    if (u.protocol !== 'https:' || !LINK_HOSTS.includes(u.hostname)) return false;
    shell.openExternal(u.toString());
    return true;
  } catch { return false; }
});
ipcMain.on('renderer-set-paused', (_e, value) => { paused = !!value; refreshTray(); });

// Save a recorded run. The renderer hands over CSV text and nothing else —
// it cannot name a path, so this channel can only ever write where the user
// themselves pointed the save dialog. The size cap is a guard against a
// runaway buffer, not a policy: the recorder's own row cap keeps a normal
// session far below it.
const save = createSaveService({
  getWindow: () => win,
  showSaveDialog: (window, options) => dialog.showSaveDialog(window, options),
});
ipcMain.handle('save-recording', (_e, csv) => save('recording', csv));
ipcMain.handle('save-experiment', (_e, json) => save('experiment', json));
ipcMain.on('recording-state', (event, state) => {
  if (event.sender === win?.webContents && state && typeof state === 'object') recordingStatus = recordingState(state);
});

// Learning traces use their own file type and dialog title so an analytical
// contact-level export cannot be confused with the 20-Hz behavioural record.
ipcMain.handle('save-learning-record', (_e, csv) => save('learning', csv));

// A manifest is small JSON metadata that accompanies a trace/snapshot. Main
// owns both destination and size check, so the sandboxed renderer still has
// no arbitrary filesystem write capability.
ipcMain.handle('save-manifest', (_e, json) => save('manifest', json));

// A reproducible visual observation of the *current* run. As with CSV
// recording, the renderer cannot choose a path; the user selects it through
// the native dialog. capturePage includes the whole displayed application
// window, which is more useful for a lab note than a cropped WebGL canvas.
ipcMain.handle('save-snapshot', () => save('snapshot'));

app.on('window-all-closed', () => { if (process.platform !== 'darwin') { /* tray keeps it alive */ } });
app.on('before-quit', event => {
  if (!quitApproved && !allowRecordingExit('quit')) { event.preventDefault(); app.isQuitting = false; return; }
  quitApproved = true;
  app.isQuitting = true;
});
