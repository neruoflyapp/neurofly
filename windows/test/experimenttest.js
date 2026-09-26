// experimenttest.js — the statistics behind the guided experiments, and the
// protocols themselves, run end to end in the bare experiment rig.
//   node test/experimenttest.js
//
// The statistics are checked against textbook values. The protocols are run
// with few trials: this pins that each one completes, produces its declared
// outputs, is reproducible from its master seed, and — where the effect is
// large — reaches the verdict the model is known to give. VALIDATION.md holds
// the full-size runs.

import './random.js';
import { loadBrainData } from '../src/data.js';
import { ClosedLoop } from '../src/closed-loop.js';
import { PROTOCOLS, seedStream, resultCSV } from '../src/experiments.js';
import { wilson, fisherExact, mannWhitney, holmAdjusted, fitLogistic, bootstrapCI, linearFit, median } from '../src/stats.js';

let failures = 0;
function check(name, fn) {
  const [ok, describe] = fn();
  if (!ok) failures++;
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}: ${describe}`);
}
const near = (a, b, tol) => Math.abs(a - b) <= tol;

// ---- statistics ---------------------------------------------------------------------------
check('Wilson interval matches the closed form, including 0/n', () => {
  const zero = wilson(0, 10), half = wilson(5, 10);
  const ok = zero.lo === 0 && near(zero.hi, 0.27753, 1e-4) && near(half.lo, 0.23659, 1e-4) && near(half.hi, 0.76341, 1e-4);
  return [ok, `0/10 -> [${zero.lo}, ${zero.hi.toFixed(5)}], 5/10 -> [${half.lo.toFixed(5)}, ${half.hi.toFixed(5)}]`];
});

check('Fisher exact test reproduces the tea-tasting table and extreme tables', () => {
  const tea = fisherExact(3, 1, 1, 3), extreme = fisherExact(8, 0, 0, 8), none = fisherExact(4, 4, 4, 4);
  return [near(tea, 0.485714, 1e-5) && near(extreme, 0.000155, 1e-5) && near(none, 1, 1e-9),
    `[[3,1],[1,3]] p=${tea.toFixed(6)}, [[8,0],[0,8]] p=${extreme.toExponential(3)}, [[4,4],[4,4]] p=${none}`];
});

check('Mann-Whitney U: complete separation is significant, identical samples are not', () => {
  const sep = mannWhitney([1, 2, 3, 4, 5, 6], [7, 8, 9, 10, 11, 12]), same = mannWhitney([1, 2, 3], [1, 2, 3]);
  return [sep.u === 0 && near(sep.p, 2 / 924, 1e-12) && sep.method === 'exact-permutation' && same.p === 1,
    `separated U=${sep.u} exact p=${sep.p.toFixed(6)}, identical p=${same.p.toFixed(4)}`];
});
check('Mann-Whitney exact permutation handles ties and falls back for large samples', () => {
  const tied = mannWhitney([1, 1, 2, 2], [3, 3, 4, 4]);
  const large = mannWhitney(Array.from({ length: 15 }, (_, i) => i), Array.from({ length: 15 }, (_, i) => i + 10));
  const invalid = mannWhitney([1, NaN], [2, 3]);
  return [tied.method === 'exact-permutation' && tied.permutations === 70 && near(tied.p, 2 / 70, 1e-12)
    && large.method === 'normal-approximation' && Number.isFinite(large.p)
    && invalid.method === 'invalid' && Number.isNaN(invalid.p),
  `tied p=${tied.p.toFixed(6)} (${tied.permutations} assignments), large=${large.method}`];
});
check('Holm correction preserves order and never decreases a raw p value', () => {
  const raw = [0.04, 0.01, 0.03, 0.9];
  const adjusted = holmAdjusted(raw);
  const expected = [0.09, 0.04, 0.09, 0.9];
  return [adjusted.every((p, i) => near(p, expected[i], 1e-12) && p >= raw[i])
    && holmAdjusted([]).length === 0,
  `raw=${raw.join(',')} adjusted=${adjusted.map((p) => p.toFixed(2)).join(',')}`];
});

check('logistic fit recovers a known 50% point and detects bracketing', () => {
  const x50 = 0.4, s = 0.08;
  const pts = [0, 0.2, 0.3, 0.4, 0.5, 0.6, 0.8].map((x) => ({ x, n: 400, k: Math.round(400 / (1 + Math.exp(-(x - x50) / s))) }));
  const fit = fitLogistic(pts);
  const flat = fitLogistic([0, 0.5, 1].map((x) => ({ x, n: 10, k: 1 })));
  return [near(fit.x50, x50, 0.03) && fit.brackets && !flat.brackets, `x50 ${fit.x50.toFixed(3)} (true ${x50}), slope ${fit.slope.toFixed(3)}; flat data brackets=${flat.brackets}`];
});

check('bootstrap intervals are seeded and bracket the sample median', () => {
  const xs = [3, 1, 4, 1, 5, 9, 2, 6, 5, 3, 5, 8, 9, 7];
  const a = bootstrapCI(xs, median, { seed: 5 }), b = bootstrapCI(xs, median, { seed: 5 });
  return [a.lo === b.lo && a.hi === b.hi && a.lo <= median(xs) && median(xs) <= a.hi, `median ${median(xs)}, 95% CI [${a.lo}, ${a.hi}], same seed identical`];
});

check('linear fit is exact on a line and finds no slope in constant data', () => {
  const line = linearFit([0, 1, 2, 3, 4], [1, 3, 5, 7, 9.0000001]), flat = linearFit([0, 1, 2, 3], [2, 2, 2, 2]);
  return [near(line.slope, 2, 1e-6) && near(line.intercept, 1, 1e-6) && line.p < 1e-6 && flat.slope === 0,
    `slope ${line.slope.toFixed(4)}, intercept ${line.intercept.toFixed(4)}, p ${line.p.toExponential(1)}; constant data slope ${flat.slope}`];
});

// ---- protocols -------------------------------------------------------------------------------
const data = loadBrainData();
if (!data) { process.stderr.write('no data/ — run etl.py first\n'); process.exit(1); }
const newRig = () => new ClosedLoop({ data, bounds: { width: 1100, height: 700 }, seed: 99, empty: true, spikeBus: false, instruments: false, hour: 12 });

function runProtocol(id, params) {
  const proto = PROTOCOLS.find((p) => p.id === id);
  const gen = proto.run(newRig(), { ...proto.defaults, ...params }, seedStream(1234));
  let r = gen.next(), progress = 0;
  while (!r.done) { progress = r.value; r = gen.next(); }
  return { proto, result: r.value, progress };
}

check('every protocol declares literature, a question and a runnable generator', () => {
  const bad = PROTOCOLS.filter((p) => !p.id || !p.title || !p.question || !p.measures || typeof p.run !== 'function' || !Array.isArray(p.literature));
  const noDoi = PROTOCOLS.flatMap((p) => p.literature).filter((l) => !l.doi && !l.url);
  return [bad.length === 0 && noDoi.length === 0 && PROTOCOLS.length >= 10, `${PROTOCOLS.length} protocols; incomplete: ${bad.map((p) => p.id).join(',') || 'none'}; references without DOI/URL: ${noDoi.length}`];
});

check('sound vs wind: sound drives the giant fiber, wind does not (wiring alone)', () => {
  const { result, progress } = runProtocol('sound-vs-wind', { trials: 5 });
  const csv = resultCSV(result);
  return [result.verdict?.code === 'soundEscapes' && progress > 0.99 && result.rows.length > 0 && csv.trim().split('\n').length === result.rows.length + 1,
    `verdict ${result.verdict?.code}, ${result.rows.length} rows, stats ${result.stats.map((s) => `${s.key}=${typeof s.value === 'number' ? s.value.toFixed(2) : s.value}`).join(' ')}`];
});

check('protocols are reproducible from their master seed', () => {
  const a = runProtocol('dust-grooming', { trials: 2 }).result, b = runProtocol('dust-grooming', { trials: 2 }).result;
  const same = JSON.stringify(a.rows) === JSON.stringify(b.rows);
  return [same && a.verdict.code === b.verdict.code, `two runs with master seed 1234: identical rows ${same}, verdict ${a.verdict.code}`];
});

check('dust grooming: JO-F is necessary for dust-evoked head grooming', () => {
  const { result } = runProtocol('dust-grooming', { trials: 4 });
  const stat = Object.fromEntries(result.stats.map((s) => [s.key, s.value]));
  return [result.verdict.code === 'necessary' && stat.groomFullDust >= 0.75 && stat.groomJoFSilenced === 0,
    `verdict ${result.verdict.code}; full dust ${Math.round(stat.groomFullDust * 100)}%, JO-F silenced ${Math.round(stat.groomJoFSilenced * 100)}%, DNg12 silenced ${Math.round(stat.groomDng12Silenced * 100)}%`];
});

console.log(failures === 0 ? 'ALL EXPERIMENT TESTS PASS' : `${failures} FAILURES`);
process.exit(failures === 0 ? 0 : 1);
