// environmenttest.js — the pure environmental fields.
//   node test/environmenttest.js
//
// These are inputs the fly's real circuit responds to, so their shape matters:
// a thermal-preference reading is only interpretable if widening the gradient
// changes how UNEQUAL the arena is without also changing how hot it is on
// average, and the circadian curve has to keep the daily structure the neural
// baseline is tuned against.

import { circadianActivity, localTemperature } from '../src/environment.js';

let failures = 0;
function check(name, fn) {
  const [ok, describe] = fn();
  if (!ok) failures++;
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}: ${describe}`);
}

check('a zero gradient leaves the arena uniform', () => {
  const at = [0, 0.25, 0.5, 0.75, 1].map((u) => localTemperature(24, 0, u));
  return [at.every((t) => t === 24), `all positions read ${at[0]} C`];
});

// The one that matters: if the mean drifted as the span widened, "she moved
// west when I turned the gradient up" could just be a response to the whole
// arena getting hotter, and the measurement would mean nothing.
check('widening the gradient changes the spread, never the mean', () => {
  const spans = [0, 10, 20, 40];
  const means = spans.map((s) => {
    let sum = 0;
    const N = 1001;
    for (let k = 0; k < N; k++) sum += localTemperature(24, s, k / (N - 1));
    return sum / N;
  });
  const ok = means.every((m) => Math.abs(m - 24) < 1e-9);
  return [ok, `spans ${spans.join('/')} C all average ${means[0].toFixed(6)} C across the arena`];
});

check('the ends are exactly the stated arena limits, cool west, warm east', () => {
  const cool = localTemperature(24, 20, 0), warm = localTemperature(24, 20, 1);
  return [cool === 14 && warm === 34 && cool < warm, `u=0 -> ${cool} C, u=1 -> ${warm} C`];
});

check('positions outside the terrarium clamp instead of extrapolating', () => {
  const below = localTemperature(24, 20, -3), above = localTemperature(24, 20, 4);
  return [below === 14 && above === 34, `u=-3 -> ${below} C, u=4 -> ${above} C (no runaway)`];
});

check('temperature varies monotonically across the arena', () => {
  let ok = true, prev = -Infinity;
  for (let u = 0; u <= 1.0001; u += 0.05) {
    const t = localTemperature(24, 30, u);
    if (t < prev - 1e-12) ok = false;
    prev = t;
  }
  return [ok, 'no reversals between the cool and warm ends'];
});

check('the circadian curve keeps its documented daily structure', () => {
  const at = (h) => circadianActivity(h);
  const night = at(3), morning = at(9), siesta = at(14), evening = at(18);
  const ok = night < 0.4 && morning > 0.9 && siesta < morning && siesta > night && evening > 0.9;
  return [ok, `3h ${night.toFixed(2)}, 9h ${morning.toFixed(2)}, `
    + `14h ${siesta.toFixed(2)}, 18h ${evening.toFixed(2)}`];
});

check('the circadian curve is continuous across midnight', () => {
  const before = circadianActivity(23.999), after = circadianActivity(0);
  return [Math.abs(before - after) < 0.05, `23:59 ${before.toFixed(3)} vs 00:00 ${after.toFixed(3)}`];
});

console.log(failures === 0 ? 'ALL ENVIRONMENT TESTS PASS' : `${failures} FAILURES`);
process.exit(failures === 0 ? 0 : 1);
