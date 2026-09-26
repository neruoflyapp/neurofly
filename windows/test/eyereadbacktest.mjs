// Real GPU check for the eye readback path in a disposable Electron session.
// A delayed read completion emulates backlog without changing the 50-ms eye
// trigger. No camera, fly, sensory or simulation values are modified.
import { app } from 'electron';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const profile = fs.mkdtempSync(path.join(os.tmpdir(), 'neurofly-eye-'));
app.setPath('userData', profile);
app.commandLine.appendSwitch('disable-backgrounding-occluded-windows');
app.commandLine.appendSwitch('disable-renderer-backgrounding');
process.env.NEUROFLY_DEBUG = '1';

function finish(code) {
  app.isQuitting = true;
  const resolved = path.resolve(profile);
  const prefix = path.resolve(os.tmpdir()) + path.sep + 'neurofly-eye-';
  if (resolved.startsWith(prefix)) {
    try { fs.rmSync(resolved, { recursive: true, force: true }); } catch { /* OS may hold files briefly */ }
  }
  app.exit(code);
}
const sleep = ms => new Promise(resolve => setTimeout(resolve, ms));
const js = (win, code) => win.webContents.executeJavaScript(`(async () => { ${code} })()`);

async function run(win) {
  let ready = false;
  for (let i = 0; i < 400; i++) {
    try { ready = await js(win, `return !!(__nf?.views?.terrarium?.snap?.fly);`); } catch { /* booting */ }
    if (ready) break;
    await sleep(150);
  }
  if (!ready) throw new Error('Eye view did not initialize');
  const measured = await js(win, `
    const v = __nf.views.terrarium, r = v.renderer;
    const original = { eye: v._renderEye, render: r.render, read: r.readRenderTargetPixelsAsync };
    const run = async (delayMs, durationMs) => {
      let attempts = 0, eyeRenders = 0, reads = 0;
      v._renderEye = function() { attempts++; return original.eye.call(this); };
      r.render = function(scene, camera) { if (camera === v.visionCamera) eyeRenders++; return original.render.call(this, scene, camera); };
      r.readRenderTargetPixelsAsync = function(...args) {
        reads++;
        return original.read.apply(this, args).then(async bytes => {
          if (delayMs) await new Promise(resolve => setTimeout(resolve, delayMs));
          return bytes;
        });
      };
      await new Promise(resolve => setTimeout(resolve, durationMs));
      v._renderEye = original.eye; r.render = original.render; r.readRenderTargetPixelsAsync = original.read;
      return { attempts, eyeRenders, reads };
    };
    const normal = await run(0, 2600);
    const backlog = await run(100, 2600);
    v.visionEnabled = false;
    for (let i = 0; i < 100 && v.visionReadPending; i++) await new Promise(resolve => setTimeout(resolve, 5));
    if (v.visionReadPending) throw new Error('Eye read remained pending');
    v._renderEye();
    for (let i = 0; i < 100 && v.visionReadPending; i++) await new Promise(resolve => setTimeout(resolve, 5));
    if (v.visionReadPending) throw new Error('Manual eye read remained pending');
    const actual = Uint8Array.from(v.visionPixels);
    const expected = new Uint8Array(actual.length);
    r.readRenderTargetPixels(v.visionTarget, 0, 0, 64, 24, expected);
    v.visionEnabled = true;
    let mismatched = 0;
    for (let i = 0; i < actual.length; i++) if (actual[i] !== expected[i]) mismatched++;
    return { normal, backlog, pixels: actual.length, mismatched };
  `);
  console.log(JSON.stringify(measured));
  if (measured.mismatched || measured.normal.eyeRenders !== measured.normal.reads ||
      measured.backlog.eyeRenders !== measured.backlog.reads ||
      measured.backlog.attempts <= measured.backlog.eyeRenders || measured.normal.reads < 1) {
    throw new Error('Eye GPU readback invariant failed');
  }
  console.log('PASS live eye GPU check');
}

app.on('browser-window-created', (_event, win) => {
  win.webContents.once('did-finish-load', () => {
    run(win).then(() => finish(0)).catch(error => { console.error(error); finish(1); });
  });
});
process.chdir(path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..'));
await import('../main.js');
