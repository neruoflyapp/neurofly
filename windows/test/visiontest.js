// visiontest.js — the early-visual (centre-surround) stage of the fly's eye.
//   node test/visiontest.js
//
// This stage sits between the rendered retinal image and the real LC4/LPLC2
// looming population, and it has to get a genuine trade-off right: suppress
// the motion the fly's own walking and turning smear across her whole visual
// field, without also suppressing the compact, locally-different motion that
// is the only evidence she has that something is actually coming at her.
//
// Both halves of that trade-off are failures that really happened in this
// project — a version with no suppression at all kept the giant fiber pinned
// near its firing ceiling on self-motion alone — so both halves are pinned
// here, on synthetic fields where the right answer is known exactly.

import { localMotionResidual, SURROUND_RX, SURROUND_RY } from '../src/vision.js';

const W = 64, H = 24;
let failures = 0;
function check(name, fn) {
  const [ok, describe] = fn();
  if (!ok) failures++;
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}: ${describe}`);
}

function field(fn) {
  const a = new Float32Array(W * H);
  for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) a[y * W + x] = fn(x, y);
  return a;
}
const out = new Float32Array(W * H);
const surround = new Float32Array(W * H);
const tmp = new Float32Array(W * H);
const residual = (src) => {
  localMotionResidual(src, W, H, out, surround, tmp);
  return out;
};
const mean = (a) => a.reduce((s, v) => s + v, 0) / a.length;
const max = (a) => a.reduce((s, v) => Math.max(s, v), 0);

// ---- self-motion: a whole field shifting together carries no information
// about anything approaching, and must not reach the escape circuit ----
check('a uniform whole-field shift (pure self-motion) is fully cancelled', () => {
  const r = residual(field(() => 0.4));
  return [max(r) < 1e-6, `peak residual ${max(r).toExponential(2)} from a flat 0.40 field`];
});

// ---- the case the global-median stand-in could not handle: walking over
// textured ground puts strong parallax low in the view and none at the
// horizon. That gradient is self-motion too, and must also cancel ----
check('a smooth vertical parallax gradient (walking over ground) is suppressed', () => {
  const src = field((_x, y) => 0.05 + 0.55 * (y / (H - 1)));
  const r = residual(src);
  const ratio = mean(r) / mean(src);
  return [ratio < 0.08, `residual retains ${(ratio * 100).toFixed(1)}% of the gradient's mean `
    + `(peak ${max(r).toFixed(3)} vs source peak ${max(src).toFixed(2)})`];
});

// ---- and the other half: a real object must still get through loudly ----
check('a compact approaching object survives the surround', () => {
  const cx = 20, cy = 12, rad = 3;      // ~7 samples across, a plausible looming target
  const src = field((x, y) => (Math.hypot(x - cx, y - cy) <= rad ? 0.6 : 0));
  const r = residual(src);
  const peak = max(r);
  return [peak > 0.45, `object peak survives at ${peak.toFixed(3)} of its original 0.60`];
});

// ---- the decisive comparison: the same object, seen while the fly is herself
// moving. The object has to stay far louder than the self-motion background ----
check('an object stays clearly above self-motion background when both are present', () => {
  const cx = 20, cy = 12, rad = 3;
  const bg = (x, y) => 0.05 + 0.55 * (y / (H - 1));
  const src = field((x, y) => bg(x, y) + (Math.hypot(x - cx, y - cy) <= rad ? 0.6 : 0));
  const r = residual(src);
  let objPeak = 0, bgPeak = 0;
  for (let y = 0; y < H; y++) {
    for (let x = 0; x < W; x++) {
      const v = r[y * W + x];
      if (Math.hypot(x - cx, y - cy) <= rad) objPeak = Math.max(objPeak, v);
      else if (Math.hypot(x - cx, y - cy) > rad + SURROUND_RX) bgPeak = Math.max(bgPeak, v);
    }
  }
  return [objPeak > bgPeak * 4, `object ${objPeak.toFixed(3)} vs background ${bgPeak.toFixed(3)} `
    + `(${(objPeak / Math.max(1e-9, bgPeak)).toFixed(1)}x contrast)`];
});

// ---- a still world seen by a still fly must be silent, not noisy ----
check('a completely static scene produces no drive at all', () => {
  const r = residual(field(() => 0));
  return [max(r) === 0, `peak residual ${max(r)}`];
});

// ---- the surround must be wider than the objects it has to preserve,
// otherwise an object sits inside its own inhibition and erases itself ----
check('surround is wider than a plausible looming target', () => {
  const objectSamples = 13;   // ~30 deg at ~2.3 deg per sample
  return [SURROUND_RX * 2 + 1 > objectSamples,
    `surround ${SURROUND_RX * 2 + 1} x ${SURROUND_RY * 2 + 1} samples vs object up to ${objectSamples}`];
});

console.log(failures === 0 ? 'ALL VISION TESTS PASS' : `${failures} FAILURES`);
process.exit(failures === 0 ? 0 : 1);
