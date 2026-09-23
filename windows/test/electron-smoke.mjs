// electron-smoke.mjs — end-to-end smoke test of the NeuroFly Studio in real
// Electron: the actual main process, preload, renderer, simulation worker and
// GPU views, in a throwaway profile.
//   npm run uitest            (electron test/electron-smoke.mjs)
//   NEUROFLY_TEST_OUTPUT=dir  also saves a screenshot of each workspace
//
// The page is driven only through DOM calls (element.click(), synthetic key
// events) — never OS-level mouse or keyboard input — so it cannot disturb a
// NeuroFly the user has open. The fresh user-data directory gives the test its
// own single-instance lock.

import { app } from 'electron';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = path.dirname(fileURLToPath(import.meta.url));
// The test window may open behind other applications. Chromium would then
// stop rendering it, and the snapshots every check reads would go stale.
app.commandLine.appendSwitch('disable-backgrounding-occluded-windows');
app.commandLine.appendSwitch('disable-renderer-backgrounding');
const profile = fs.mkdtempSync(path.join(os.tmpdir(), 'neurofly-ui-'));
app.setPath('userData', profile);
process.env.NEUROFLY_DEBUG = '1';           // exposes window.__nf, the renderer context
const outDir = process.env.NEUROFLY_TEST_OUTPUT || null;
if (outDir) fs.mkdirSync(outDir, { recursive: true });

let failures = 0;
function report(ok, name, detail) {
  if (!ok) failures++;
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}: ${detail}`);
}
const pageErrors = [];
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

app.on('browser-window-created', (_e, win) => {
  win.webContents.on('console-message', (event) => {
    if (event.level === 'error') pageErrors.push(String(event.message).slice(0, 300));
  });
  win.webContents.on('render-process-gone', (_ev, d) => pageErrors.push(`renderer gone: ${d.reason}`));
  win.webContents.once('did-finish-load', () => {
    run(win).catch((e) => report(false, 'harness', e.stack || e.message)).finally(finish);
  });
});

const js = (win, code) => win.webContents.executeJavaScript(`(async () => { ${code} })()`);
async function waitFor(win, code, timeoutMs) {
  const end = Date.now() + timeoutMs;
  while (Date.now() < end) {
    try { const v = await js(win, code); if (v) return v; } catch { /* page still loading */ }
    await sleep(100);
  }
  return null;
}
async function shot(win, name) {
  if (!outDir) return;
  const img = await win.webContents.capturePage();
  fs.writeFileSync(path.join(outDir, `${name}.png`), img.toPNG());
}

async function run(win) {
  const booted = await waitFor(win, `return !!(window.__nf?.snap && document.querySelector('#rail button'))`, 90000);
  report(!!booted, 'the Studio boots and the simulation worker delivers frames', booted ? 'first snapshot received' : 'no snapshot within 90 s');
  if (!booted) return;
  await js(win, `document.getElementById('help')?.close(); return true;`);

  const info = await js(win, `const d = __nf.data; return { brain: d.circuit.neurons.length, cord: d.locomotor?.neurons?.length ?? 0 };`);
  report(info.brain > 7000 && info.cord === 1045, 'the full circuit is loaded', `${info.brain} brain neurons, ${info.cord} nerve-cord neurons`);

  // Right after boot the simulation competes with the anatomy workers loading
  // their bundles and with both 3D views building, and lags behind. What is
  // checked is that it keeps pace once it runs: the first of up to six 3 s
  // windows at 0.4x real time or better.
  const clock = `return { ms: __nf.snap.neuralMs, at: performance.now() };`;
  let neural = 0, wall = 1, windows = 0;
  while (windows < 6 && !(neural > 0.4 * wall)) {
    const t0 = await js(win, clock);
    await sleep(3000);
    const t1 = await js(win, clock);
    neural = t1.ms - t0.ms; wall = t1.at - t0.at; windows++;
  }
  report(neural > 0.4 * wall, 'neural time advances in real time',
    `${Math.round(neural)} ms of neural time in ${(wall / 1000).toFixed(1)} s wall time (window ${windows})`);

  await js(win, `document.getElementById('focusMode').click(); return true;`);
  const focused = await js(win, `return document.body.classList.contains('focus-mode') && document.getElementById('focusMode').getAttribute('aria-pressed') === 'true' && getComputedStyle(document.getElementById('panel')).display === 'none';`);
  report(focused, 'focus view hides workspace chrome while preserving the live stage', String(focused));
  await sleep(700);
  await shot(win, 'focus-view');
  await js(win, `document.getElementById('focusMode').click(); return true;`);
  await js(win, `document.body.classList.add('inspector-collapsed'); document.getElementById('focusMode').click(); return true;`);
  const focusRestoresInspector = await js(win, `return getComputedStyle(document.getElementById('inspector')).display !== 'none';`);
  report(focusRestoresInspector, 'focus view reveals the connectome even if the inspector was hidden', String(focusRestoresInspector));
  await js(win, `document.getElementById('focusMode').click(); document.body.classList.remove('inspector-collapsed'); return true;`);

  // Every workspace mounts with content and without errors.
  const count = await js(win, `return document.querySelectorAll('#rail button').length;`);
  for (let i = 0; i < count; i++) {
    const errorsBefore = pageErrors.length;
    await js(win, `document.querySelectorAll('#rail button')[${i}].click(); return true;`);
    const specimens = await js(win, `return __nf.shell && document.querySelectorAll('#rail button')[${i}].getAttribute('aria-selected') === 'true';`);
    // The anatomy workspace loads its catalog from a background worker.
    const text = await waitFor(win, `const el = document.querySelector('#panel'); const s = el?.innerText ?? ''; return s.length > 80 ? s.slice(0, 60).replace(/\\s+/g, ' ') : null;`, 20000);
    await sleep(400);
    await shot(win, `workspace-${i + 1}`);
    report(!!text && specimens && pageErrors.length === errorsBefore, `workspace ${i + 1} mounts`, text ? `"${text}…"` : 'empty panel');
  }

  // Pause freezes neural time; resume continues it.
  await js(win, `document.dispatchEvent(new KeyboardEvent('keydown', { code: 'Space', key: ' ', bubbles: true })); return true;`);
  const paused = await waitFor(win, `return __nf.snap.paused ? __nf.snap.neuralMs : null;`, 3000);
  await sleep(800);
  const stillPaused = await js(win, `return __nf.snap.neuralMs;`);
  await js(win, `document.dispatchEvent(new KeyboardEvent('keydown', { code: 'Space', key: ' ', bubbles: true })); return true;`);
  const resumed = await waitFor(win, `return !__nf.snap.paused;`, 3000);
  report(paused !== null && Math.abs(stillPaused - paused) < 1 && !!resumed, 'Space pauses and resumes the whole simulation',
    `paused at ${Math.round(paused ?? -1)} ms, ${Math.round(stillPaused)} ms after 0.8 s, resumed ${!!resumed}`);

  // The language toggle relabels the interface without restarting the run.
  const before = await js(win, `return { lang: document.documentElement.lang, rail: document.querySelector('#rail').innerText, ms: __nf.snap.neuralMs };`);
  await js(win, `[...document.querySelectorAll('.topbar button, header button')].find((b) => /^(DE|EN)$/.test(b.textContent.trim()))?.click(); return true;`);
  const after = await waitFor(win, `const r = document.querySelector('#rail').innerText; return r !== ${JSON.stringify(before.rail)} ? { lang: document.documentElement.lang, rail: r, ms: __nf.snap.neuralMs } : null;`, 5000);
  report(!!after && after.lang !== before.lang && after.ms >= before.ms, 'the language toggle relabels the interface and keeps the run',
    after ? `${before.lang} -> ${after.lang}, neural time kept (${Math.round(before.ms)} -> ${Math.round(after.ms)} ms)` : 'labels unchanged');
  if (after) await js(win, `[...document.querySelectorAll('.topbar button, header button')].find((b) => /^(DE|EN)$/.test(b.textContent.trim()))?.click(); return true;`);

  // A loom makes her take off, and the event arrives with its causal chain.
  // The live fly is not seeded for this test and may already be airborne, so
  // wait until she is on the ground, and allow up to three attempts.
  let takeoff = null;
  for (let attempt = 0; attempt < 3 && !takeoff; attempt++) {
    await waitFor(win, `return __nf.snap.fly.state !== 'flying';`, 15000);
    await js(win, `__nf.state.lastEvents.length = 0; __nf.command('stim.loom', { strength: 1 }); return true;`);
    takeoff = await waitFor(win, `return __nf.state.lastEvents.find((e) => e.kind === 'takeoff') ?? null;`, 4000);
  }
  report(!!takeoff && ['stim', 'loomL', 'loomR'].includes(takeoff.trigger?.channel) && takeoff.command?.group === 'gf',
    'a loom triggers a takeoff with a traced causal chain',
    takeoff ? `trigger ${takeoff.trigger?.channel}, giant fiber ${takeoff.command?.spikes} spikes, top input ${takeoff.inputs?.[0]?.source}` : 'no takeoff within 5 s');
  const why = await waitFor(win, `return document.querySelector('.why-list')?.innerText?.length > 10;`, 3000);
  report(!!why, 'the explanation panel lists the event', why ? 'entry shown' : 'explanation panel empty');
  await shot(win, 'after-loom');

  report(pageErrors.length === 0, 'no page errors during the whole run', pageErrors.length ? pageErrors.slice(0, 3).join(' | ') : 'none');
}

function finish() {
  console.log(failures === 0 ? 'ALL UI TESTS PASS' : `${failures} FAILURES`);
  app.isQuitting = true;
  try { fs.rmSync(profile, { recursive: true, force: true }); } catch { /* locked files are left for the OS */ }
  app.exit(failures === 0 ? 0 : 1);
}

process.chdir(path.join(HERE, '..'));
await import('../main.js');
