// Four original soundtracks for the same 22-second real-app capture.
// No borrowed samples, melodies, platform audio, or third-party licences.
// Usage: node tools/score-feature-clip.mjs --audio-only
//        node tools/score-feature-clip.mjs --ffmpeg=C:\path\to\ffmpeg.exe

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawn } from 'node:child_process';
import { once } from 'node:events';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const out = path.join(root, 'promos', 'feature');
const video = path.join(out, 'feature-loom-22s-smooth-quiet.mp4');
const ffmpeg = process.argv.find((x) => x.startsWith('--ffmpeg='))?.slice(9) || 'ffmpeg';
const audioOnly = process.argv.includes('--audio-only');
const RATE = 48000, SECONDS = 22, N = RATE * SECONDS, TAU = Math.PI * 2;
const clip = (x) => Math.max(0, Math.min(1, x));
const hz = (midi) => 440 * 2 ** ((midi - 69) / 12);
const tracks = [
  { id: '01-pulse-drive', title: 'Pulse Drive', bpm: 128, root: 50, progression: [0, 5, 7, 3], sound: 'pulse' },
  { id: '02-cinematic-lift', title: 'Cinematic Lift', bpm: 96, root: 48, progression: [0, 8, 3, 10], sound: 'cinema' },
  { id: '03-neural-break', title: 'Neural Break', bpm: 146, root: 53, progression: [0, 8, 3, 10], sound: 'break' },
  { id: '04-signal-bloom', title: 'Signal Bloom', bpm: 112, root: 57, progression: [0, 8, 3, 10], sound: 'bloom' },
];

function createScore(spec) {
  const L = new Float32Array(N), R = new Float32Array(N);
  let random = (0x57f19a43 ^ spec.bpm) >>> 0;
  function noise() { random ^= random << 13; random ^= random >>> 17; random ^= random << 5; return (random >>> 0) / 2147483648 - 1; }
  function add(start, duration, gain, pan, sample) {
    const first = Math.max(0, Math.floor(start * RATE));
    const last = Math.min(N, Math.floor((start + duration) * RATE));
    const left = Math.sqrt((1 - pan) / 2), right = Math.sqrt((1 + pan) / 2);
    for (let i = first; i < last; i++) {
      const t = i / RATE - start, v = gain * sample(t, duration);
      L[i] += v * left; R[i] += v * right;
    }
  }
  function tone(start, duration, note, gain, voice = 'pluck', pan = 0) {
    const f = hz(note);
    add(start, duration, gain, pan, (t, d) => {
      const a = clip(t / (voice === 'pad' ? 0.45 : 0.012));
      const release = clip((d - t) / (voice === 'pad' ? 0.6 : 0.12));
      const p = TAU * f * t;
      if (voice === 'pad') return a * release * (Math.sin(p) + 0.28 * Math.sin(p * 1.003) + 0.12 * Math.sin(2 * p));
      if (voice === 'bass') return a * release * Math.exp(-t * 1.4) * (Math.sin(p) + 0.22 * Math.sin(2 * p));
      if (voice === 'bell') return a * release * Math.exp(-t * 2.0) * (Math.sin(p + 2.4 * Math.exp(-t * 4) * Math.sin(2.01 * p)) + 0.2 * Math.sin(3.01 * p));
      if (voice === 'glitch') return a * release * Math.exp(-t * 8) * (Math.sin(p) + 0.38 * Math.sin(2.7 * p));
      return a * release * Math.exp(-t * 3.2) * (Math.sin(p) + 0.42 * Math.sin(2 * p) + 0.18 * Math.sin(3 * p));
    });
  }
  function kick(start, gain = 0.35) {
    add(start, 0.45, gain, 0, (t) => {
      const p = TAU * (49 * t + 105 * (1 - Math.exp(-35 * t)) / 35);
      const click = t < 0.018 ? noise() * (1 - t / 0.018) * 0.28 : 0;
      return Math.sin(p) * Math.exp(-t * 12) + click;
    });
  }
  function snare(start, gain = 0.19) {
    let prev = 0;
    add(start, 0.26, gain, 0.1, (t) => {
      const n = noise(); const hp = n - 0.88 * prev; prev = n;
      return (0.68 * hp + 0.3 * Math.sin(TAU * 186 * t)) * Math.exp(-t * 16);
    });
  }
  function hat(start, gain = 0.08, pan = 0) {
    let prev = 0;
    add(start, 0.095, gain, pan, (t) => {
      const n = noise(); const hp = n - prev; prev = n;
      return hp * Math.exp(-t * 55);
    });
  }
  function whoosh(start, gain = 0.16) {
    let filtered = 0;
    add(start, 1.5, gain, 0, (t) => {
      const n = noise(); filtered = filtered * 0.87 + n * 0.13;
      const rise = clip(t / 0.36), fall = Math.exp(-Math.max(0, t - 0.36) * 3.5);
      return (n - filtered) * rise * fall;
    });
  }
  function chordAt(bar) {
    const root = spec.root + spec.progression[bar % spec.progression.length];
    return [root, root + 3, root + 7];
  }
  const beat = 60 / spec.bpm, beats = Math.ceil(SECONDS / beat);
  if (spec.sound === 'pulse') {
    const motif = [12, 19, 15, 22, 12, 19, 17, 15];
    for (let b = 0; b < beats; b++) {
      const at = b * beat, bar = Math.floor(b / 4), root = chordAt(bar)[0];
      kick(at, b % 4 === 0 ? 0.43 : 0.34);
      if (b % 4 === 1 || b % 4 === 3) snare(at, 0.22);
      hat(at, 0.045, -0.45); hat(at + beat / 2, 0.075, 0.48);
      tone(at + beat / 2, beat * 0.75, root - 12, 0.17, 'bass');
      tone(at, beat * 0.42, root + motif[b % 8], 0.13, 'pluck', b % 2 ? 0.45 : -0.45);
      if (b % 8 === 0) for (const n of chordAt(bar)) tone(at, beat * 7.7, n, 0.021, 'pad', (n - root - 3) / 12);
    }
  } else if (spec.sound === 'cinema') {
    const motif = [12, 15, 19, 22, 19, 15, 10, 12];
    for (let b = 0; b < beats; b++) {
      const at = b * beat, bar = Math.floor(b / 4), root = chordAt(bar)[0];
      if (b % 4 === 0) {
        kick(at, 0.35);
        for (const n of chordAt(bar)) tone(at, beat * 4.6, n, 0.064, 'pad', (n - root - 3) / 13);
        tone(at, beat * 3.6, root - 12, 0.12, 'bass');
      }
      if (b % 4 === 2) { snare(at, 0.12); kick(at, 0.2); }
      if (b % 2 === 0) tone(at + beat * 0.5, beat * 1.4, root + motif[b % 8], 0.13, 'bell', b % 4 ? 0.38 : -0.38);
      hat(at + beat / 2, 0.022, b % 2 ? 0.35 : -0.35);
    }
  } else if (spec.sound === 'break') {
    const motif = [12, 15, 19, 24, 22, 19, 15, 10];
    for (let b = 0; b < beats; b++) {
      const at = b * beat, root = chordAt(Math.floor(b / 4))[0];
      if (b % 4 === 0 || b % 4 === 2) kick(at, 0.4);
      if (b % 4 === 1 || b % 4 === 3) snare(at, 0.25);
      if (b % 4 === 2) kick(at + beat * 0.7, 0.21);
      if (b % 4 === 3) snare(at + beat * 0.72, 0.08);
      for (let k = 0; k < 4; k++) hat(at + k * beat / 4, k % 2 ? 0.052 : 0.035, k % 2 ? 0.55 : -0.55);
      tone(at, beat * 0.65, root - 12, 0.19, 'bass');
      if (b % 2 === 0) tone(at + beat * 0.18, beat * 0.41, root + motif[b % 8], 0.15, 'glitch', b % 4 ? 0.6 : -0.6);
    }
  } else {
    const motif = [12, 16, 19, 24, 19, 16, 14, 12];
    for (let b = 0; b < beats; b++) {
      const at = b * beat, bar = Math.floor(b / 4), root = chordAt(bar)[0];
      if (b % 2 === 0) kick(at, b % 4 === 0 ? 0.36 : 0.24);
      if (b % 4 === 2) snare(at, 0.14);
      hat(at + beat / 2, 0.044, b % 2 ? 0.42 : -0.42);
      tone(at, beat * 0.88, root + motif[b % 8], 0.18, 'pluck', b % 2 ? 0.35 : -0.35);
      if (b % 2 === 1) tone(at + beat * 0.5, beat * 0.66, root + motif[(b + 2) % 8], 0.08, 'bell', b % 4 ? -0.48 : 0.48);
      if (b % 4 === 0) {
        tone(at, beat * 3.7, root - 12, 0.11, 'bass');
        for (const n of chordAt(bar)) tone(at, beat * 3.9, n, 0.015, 'pad', 0);
      }
    }
  }
  // Sound-design cues follow the two recorded visual threats; never pass them
  // off as insect audio. The mix starts immediately and fades only at the end.
  for (const at of [1.25, 13.0]) {
    whoosh(at - 0.2, spec.sound === 'cinema' ? 0.22 : 0.14);
    kick(at, spec.sound === 'cinema' ? 0.55 : 0.43);
    tone(at, 1.1, spec.root + 24, 0.16, 'bell', 0.65);
    tone(at + 0.085, 1.0, spec.root + 19, 0.12, 'bell', -0.65);
  }
  // One subtle stereo reflection gives space while preserving the transient.
  const delay = Math.floor(RATE * (spec.sound === 'cinema' ? 0.22 : 0.16));
  for (let i = delay; i < N; i++) { L[i] += R[i - delay] * 0.07; R[i] += L[i - delay] * 0.07; }
  let peak = 0;
  for (let i = 0; i < N; i++) {
    const fade = clip((SECONDS - i / RATE) / 0.75);
    L[i] = Math.tanh(L[i] * 0.9) * fade;
    R[i] = Math.tanh(R[i] * 0.9) * fade;
    peak = Math.max(peak, Math.abs(L[i]), Math.abs(R[i]));
  }
  const pcm = Buffer.alloc(N * 4), gain = peak > 0 ? 0.91 / peak : 1;
  for (let i = 0; i < N; i++) {
    pcm.writeInt16LE(Math.round(Math.max(-1, Math.min(1, L[i] * gain)) * 32767), i * 4);
    pcm.writeInt16LE(Math.round(Math.max(-1, Math.min(1, R[i] * gain)) * 32767), i * 4 + 2);
  }
  const wav = Buffer.alloc(44 + pcm.length);
  wav.write('RIFF', 0); wav.writeUInt32LE(wav.length - 8, 4); wav.write('WAVEfmt ', 8);
  wav.writeUInt32LE(16, 16); wav.writeUInt16LE(1, 20); wav.writeUInt16LE(2, 22);
  wav.writeUInt32LE(RATE, 24); wav.writeUInt32LE(RATE * 4, 28);
  wav.writeUInt16LE(4, 32); wav.writeUInt16LE(16, 34);
  wav.write('data', 36); wav.writeUInt32LE(pcm.length, 40); pcm.copy(wav, 44);
  const dest = path.join(out, `${spec.id}.wav`);
  fs.writeFileSync(dest, wav);
  console.log(`${spec.title}: ${dest}; peak ${peak.toFixed(3)}`);
  return dest;
}

for (const spec of tracks) {
  const audio = createScore(spec);
  if (audioOnly) continue;
  if (!fs.existsSync(video)) throw new Error(`Smooth master missing: ${video}`);
  const mp4 = path.join(out, `feature-loom-${spec.id}.mp4`);
  const args = ['-hide_banner', '-loglevel', 'error', '-y', '-i', video, '-i', audio,
    '-map', '0:v:0', '-map', '1:a:0', '-c:v', 'copy', '-af', 'loudnorm=I=-15:TP=-1.5:LRA=8',
    '-ar', '48000', '-c:a', 'aac', '-b:a', '224k', '-t', String(SECONDS), '-movflags', '+faststart', mp4];
  const child = spawn(ffmpeg, args, { stdio: ['ignore', 'ignore', 'pipe'] });
  let error = '';
  child.stderr.on('data', (data) => { error = (error + data.toString()).slice(-3000); });
  const [code] = await once(child, 'close');
  if (code !== 0) throw new Error(`${spec.title} mux failed (${code}): ${error}`);
  console.log(`VIDEO ${mp4}`);
}
