// Record a real NeuroFly experiment in the actual Electron app, not a staged
// animation. The focus view, simulation worker, neural activity and causal
// explanation are all the same components used by a normal user session.
//
// Usage: electron tools/render-feature-clip.mjs --ffmpeg=C:\path\ffmpeg.exe
//        electron tools/render-feature-clip.mjs --preview

import { app } from 'electron';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawn } from 'node:child_process';
import { once } from 'node:events';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const out = path.join(root, 'promos', 'feature');
const preview = process.argv.includes('--preview');
const ffmpeg = process.argv.find((arg) => arg.startsWith('--ffmpeg='))?.slice(9) || 'ffmpeg';
const profile = fs.mkdtempSync(path.join(os.tmpdir(), 'neurofly-feature-'));
app.setPath('userData', profile);
process.env.NEUROFLY_DEBUG = '1';
fs.mkdirSync(out, { recursive: true });

const FPS = 24;
const SECONDS = 22;
const FRAMES = FPS * SECONDS;
const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
const js = (win, code) => win.webContents.executeJavaScript(`(async () => { ${code} })()`);
let failed = false;

async function waitFor(win, code, ms = 90000) {
  const end = Date.now() + ms;
  while (Date.now() < end) {
    try { if (await js(win, code)) return; } catch { /* renderer still starting */ }
    await sleep(150);
  }
  throw new Error(`Timed out waiting for ${code}`);
}

// Procedural, original and unencumbered audio. Two low impacts correspond to
// the two real visual stimuli; the quieter bed leaves the experiment audible
// as an observation rather than making it look like an advert.
function makeScore(file) {
  const rate = 48000;
  const count = SECONDS * rate;
  const pcm = Buffer.alloc(count * 4);
  const notes = [82.41, 123.47, 164.81, 246.94];
  const events = [1.25, 13.0];
  for (let i = 0; i < count; i++) {
    const t = i / rate;
    const fade = Math.min(1, t / 0.7, (SECONDS - t) / 1.3);
    let value = 0;
    for (let n = 0; n < notes.length; n++) {
      const f = notes[n];
      value += (0.022 - n * 0.003) * Math.sin(2 * Math.PI * f * t + 0.22 * Math.sin(2 * Math.PI * 0.18 * t + n));
    }
    for (const at of events) {
      const d = t - at;
      if (d >= 0 && d < 3.2) {
        value += 0.19 * Math.sin(2 * Math.PI * 49 * d) * Math.exp(-d * 11);
        value += 0.065 * Math.sin(2 * Math.PI * (430 + 420 * d) * d) * Math.exp(-d * 3.8);
      }
    }
    // A restrained two-step pulse provides motion without borrowed music.
    const beat = (t % 0.75);
    value += 0.018 * Math.sin(2 * Math.PI * 96 * beat) * Math.exp(-beat * 23);
    const s = Math.max(-1, Math.min(1, value * Math.max(0, fade)));
    pcm.writeInt16LE(Math.round(s * 32767), i * 4);
    pcm.writeInt16LE(Math.round(s * 32767), i * 4 + 2);
  }
  const wav = Buffer.alloc(44 + pcm.length);
  wav.write('RIFF', 0); wav.writeUInt32LE(wav.length - 8, 4); wav.write('WAVEfmt ', 8);
  wav.writeUInt32LE(16, 16); wav.writeUInt16LE(1, 20); wav.writeUInt16LE(2, 22);
  wav.writeUInt32LE(rate, 24); wav.writeUInt32LE(rate * 4, 28);
  wav.writeUInt16LE(4, 32); wav.writeUInt16LE(16, 34);
  wav.write('data', 36); wav.writeUInt32LE(pcm.length, 40);
  pcm.copy(wav, 44);
  fs.writeFileSync(file, wav);
}

async function run(win) {
  await waitFor(win, `return !!(window.__nf?.snap && document.getElementById('focusMode'))`);
  win.setMinimumSize(640, 660);
  win.setContentSize(720, 1280);
  await sleep(350);
  await sleep(1600); // let the first-run guide finish opening, if needed
  await js(win, `document.getElementById('help')?.close(); document.querySelector('#rail button')?.click(); document.getElementById('focusMode').click(); document.querySelector('.hud-tr button')?.click(); __nf.views.brain.zoom = 13; return true;`);
  await sleep(1100);
  await waitFor(win, `return __nf.snap.fly.state !== 'flying'`, 20000);
  const size = win.getContentSize();
  const state = await js(win, `return { brain: __nf.data.circuit.neurons.length, cord: __nf.data.locomotor?.neurons?.length, focus: document.body.classList.contains('focus-mode') };`);
  if (!state.focus || state.brain < 7000 || state.cord !== 1045) throw new Error(`Unexpected live scene: ${JSON.stringify(state)}`);
  console.log(`Recording actual NeuroFly ${size[0]}×${size[1]} scene: ${state.brain} brain + ${state.cord} cord cells`);
  const cover = path.join(out, 'feature-loom-cover.png');
  fs.writeFileSync(cover, (await win.webContents.capturePage()).toPNG());
  if (preview) { console.log(`Preview: ${cover}`); return; }

  const wav = path.join(out, 'feature-loom-original-score.wav');
  const mp4 = path.join(out, 'feature-loom-22s.mp4');
  makeScore(wav);
  const args = ['-hide_banner', '-loglevel', 'error', '-y', '-f', 'image2pipe', '-framerate', String(FPS), '-vcodec', 'mjpeg', '-i', 'pipe:0',
    '-i', wav, '-map', '0:v:0', '-map', '1:a:0', '-vf', 'scale=720:1280:flags=lanczos,format=yuv420p',
    '-c:v', 'libx264', '-preset', 'fast', '-crf', '18', '-pix_fmt', 'yuv420p', '-r', String(FPS),
    '-c:a', 'aac', '-b:a', '192k', '-t', String(SECONDS), '-movflags', '+faststart', mp4];
  const encoder = spawn(ffmpeg, args, { stdio: ['pipe', 'ignore', 'pipe'] });
  let encoderError = '';
  encoder.stderr.on('data', (buf) => { encoderError = (encoderError + buf.toString()).slice(-4000); });
  encoder.on('error', (err) => { encoderError = err.message; });
  let eventCount = 0;
  const started = performance.now();
  for (let f = 0; f < FRAMES; f++) {
    // An actual camera-mode switch gives a wider, spatial view in act two.
    if (f === 254) await js(win, `document.querySelector('.hud-tr button')?.click(); return true;`);
    if (f === 100 || f === 277 || f === 355) await js(win, `document.querySelector('.brain-bar .tools button:nth-child(2)')?.click(); return true;`);
    if (f === 30 || f === 312) {
      await js(win, `document.getElementById('focusStim').click(); return true;`);
      eventCount++;
    }
    const image = await win.webContents.capturePage();
    if (image.isEmpty()) throw new Error(`Empty frame at ${f}`);
    if (f === 150) fs.writeFileSync(cover, image.toPNG());
    if (!encoder.stdin.write(image.toJPEG(89))) await once(encoder.stdin, 'drain');
    if (f % 72 === 0) console.log(`Frame ${f}/${FRAMES}; real events ${eventCount}`);
    const due = started + (f + 1) * 1000 / FPS;
    if (performance.now() < due) await sleep(due - performance.now());
  }
  encoder.stdin.end();
  const [code] = await once(encoder, 'close');
  if (code !== 0) throw new Error(`FFmpeg failed (${code}): ${encoderError}`);
  if (eventCount !== 2) throw new Error('Not all real stimuli were delivered');
  console.log(`Done: ${mp4}`);
}

app.on('browser-window-created', (_event, win) => {
  win.setMinimumSize(640, 660);
  win.setContentSize(720, 1280);
  win.webContents.once('did-finish-load', () => {
    run(win).catch((err) => { failed = true; console.error(err.stack || err.message); })
      .finally(() => {
        app.isQuitting = true;
        try { fs.rmSync(profile, { recursive: true, force: true }); } catch { /* Electron may still hold a handle */ }
        app.exit(failed ? 1 : 0);
      });
  });
});

process.chdir(root);
await import('../main.js');
