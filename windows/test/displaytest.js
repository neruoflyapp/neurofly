// displaytest.js — the view-exposure invariants.
//   node test/displaytest.js
//
// The terrarium genuinely goes near-black at 2am, which is physically right
// and left the world unreadable. The fix was exposure: brighten the camera
// looking at the scene, never the scene itself, and never the separate render
// the fly's own eye takes of it (app.js pins that at VISION_EXPOSURE).
//
// That is only honest if the exposure curve cannot misrepresent the world it
// is showing, so the properties below are pinned here rather than left to a
// screenshot: gain must vanish in daylight, must never invert the real
// brightness ordering, and must stay bounded.

import { sceneLightLevel, autoExposureGain, displayedRelative, MAX_AUTO_LIFT } from '../src/display.js';
import { circadianActivity } from '../src/environment.js';

let failures = 0;
function check(name, fn) {
  const [ok, describe] = fn();
  if (!ok) failures++;
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}: ${describe}`);
}

// The real keyframes app.js renders from: [hour, keyIntensity, ambient].
const KEYFRAMES = [
  [0, 0.35, 0.30], [5, 0.35, 0.30], [7, 0.95, 0.55], [9, 1.55, 0.85],
  [13, 1.65, 0.85], [17, 1.45, 0.78], [19, 0.85, 0.5], [21, 0.45, 0.34],
  [24, 0.35, 0.30],
];
function lightAt(hour) {
  for (let i = 0; i < KEYFRAMES.length - 1; i++) {
    const a = KEYFRAMES[i], b = KEYFRAMES[i + 1];
    if (hour >= a[0] && hour <= b[0]) {
      const t = (hour - a[0]) / Math.max(0.001, b[0] - a[0]);
      const scale = 0.75 + 0.25 * circadianActivity(hour);
      return sceneLightLevel((a[2] + (b[2] - a[2]) * t) * scale, (a[1] + (b[1] - a[1]) * t) * scale);
    }
  }
  return sceneLightLevel(KEYFRAMES[0][2], KEYFRAMES[0][1]);
}
const HOURS = [];
for (let h = 0; h < 24; h += 0.25) HOURS.push(h);
const PEAK = Math.max(...HOURS.map(lightAt));

// ---- daylight must be untouched: an exposure fix for night that also
// re-grades the daytime picture would be changing what the world looks like,
// not just making it visible ----
check('auto-exposure is exactly 1.0x at the brightest hour (daylight unchanged)', () => {
  const gain = autoExposureGain(1);
  return [gain === 1, `gain at peak daylight = ${gain.toFixed(4)}x`];
});

// ---- the honesty property: the display may compress the range, never invert
// it. If a lifted night ever rendered brighter than an unlifted noon, the
// picture would be telling the viewer something false about the world. ----
check('displayed brightness stays strictly ordered with real light (night never outshines day)', () => {
  const samples = HOURS.map((h) => ({ h, rel: lightAt(h) / PEAK }))
    .sort((a, b) => a.rel - b.rel);
  let worst = null;
  for (let i = 1; i < samples.length; i++) {
    const prev = displayedRelative(samples[i - 1].rel);
    const cur = displayedRelative(samples[i].rel);
    if (cur < prev - 1e-12) worst = { a: samples[i - 1], b: samples[i], prev, cur };
  }
  return [worst === null, worst
    ? `inverted at ${worst.a.h}h -> ${worst.b.h}h (${worst.prev.toFixed(3)} -> ${worst.cur.toFixed(3)})`
    : `${samples.length} sampled hours, ordering preserved end to end`];
});

// ---- it has to actually solve the reported problem ----
// The ordering check above only walks real clock hours, which never get dark
// enough to reach the gain cap. Inside the capped region the curve is a
// different function (a straight multiply by maxLift), so the property has to
// be shown to survive there too — otherwise a darker scene could in principle
// be displayed brighter than a less dark one.
check('ordering survives across the gain cap, not just over real clock hours', () => {
  let worst = null, prev = -Infinity;
  for (let r = 0; r <= 1.0000001; r += 0.002) {
    const shown = displayedRelative(r);
    if (shown < prev - 1e-12) worst = { r, shown, prev };
    prev = shown;
  }
  const capEdge = Math.pow(MAX_AUTO_LIFT, -1 / 0.55);
  return [worst === null,
    worst ? `inverted at relative ${worst.r.toFixed(3)}`
      : `monotone over the full 0..1 range, including below the cap edge at ~${capEdge.toFixed(3)}`];
});

check('deepest night becomes legible without being flattened into daylight', () => {
  const darkest = Math.min(...HOURS.map(lightAt)) / PEAK;
  const shown = displayedRelative(darkest);
  return [shown > 0.40 && shown < 0.75,
    `darkest hour: ${(darkest * 100).toFixed(0)}% of peak light shown at `
    + `${(shown * 100).toFixed(0)}% brightness (gain ${autoExposureGain(darkest).toFixed(2)}x)`];
});

check('gain stays bounded even for an arbitrarily dark scene', () => {
  const extremes = [0, 1e-9, 0.0001, 0.01].map((r) => autoExposureGain(r));
  const ok = extremes.every((g) => Number.isFinite(g) && g <= MAX_AUTO_LIFT && g >= 1);
  return [ok, `gains at near-zero light: ${extremes.map((g) => g.toFixed(2)).join(', ')} (cap ${MAX_AUTO_LIFT})`];
});

check('gain never dims: it can only ever open the camera up, never stop it down', () => {
  const dimming = HOURS.map((h) => autoExposureGain(lightAt(h) / PEAK)).filter((g) => g < 1);
  return [dimming.length === 0, `${dimming.length} of ${HOURS.length} sampled hours would dim the view`];
});

console.log(failures === 0 ? 'ALL DISPLAY TESTS PASS' : `${failures} FAILURES`);
process.exit(failures === 0 ? 0 : 1);
