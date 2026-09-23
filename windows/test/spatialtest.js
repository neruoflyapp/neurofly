// spatialtest.js — the spatial occupancy/activity map.
//   node test/spatialtest.js
//
// This map exists to answer "does she treat one part of the world differently
// from another?", which is only worth asking if the instrument cannot invent
// the answer. So what is pinned here is mostly what it must NOT do: it must
// not report structure in an even world, must not present a cell it never
// measured as if it had measured zero there, and must weight by time rather
// than by however many samples happened to land where.

import { SpatialMap, MIN_PREFERENCE_SECONDS } from '../src/spatial.js';

let failures = 0;
function check(name, fn) {
  const [ok, describe] = fn();
  if (!ok) failures++;
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}: ${describe}`);
}

check('an unvisited cell reports no measurement, not a measurement of zero', () => {
  const m = new SpatialMap(4, 4);
  m.add(0.1, 0.1, 1, { fear: 50 });
  const visited = m.meanAt('fear', m.indexAt(0.1, 0.1));
  const never = m.meanAt('fear', m.indexAt(0.9, 0.9));
  const { coverage } = m.normalizedField('fear');
  return [visited === 50 && never === null && coverage[m.indexAt(0.9, 0.9)] === 0,
    `visited=${visited}, unvisited=${never}, coverage flag ${coverage[m.indexAt(0.9, 0.9)]}`];
});

// Regression: the occupancy field had its own code path that set the coverage
// flag unconditionally, so every cell she had never entered was drawn as a
// measured zero — the map showed a grid over the whole terrarium instead of
// the trail she had actually walked. Same rule, every field.
check('occupancy also distinguishes "never been here" from "was here 0 s"', () => {
  const m = new SpatialMap(4, 4);
  m.add(0.1, 0.1, 2, { fear: 0 });
  const { coverage, values } = m.normalizedField('occupancy');
  const visited = m.indexAt(0.1, 0.1), never = m.indexAt(0.9, 0.9);
  const uncovered = coverage.reduce((n, c) => n + (c ? 0 : 1), 0);
  return [coverage[visited] === 1 && coverage[never] === 0 && values[visited] === 1 && uncovered === 15,
    `1 visited cell covered, ${uncovered} of 16 left uncovered`];
});

check('means are weighted by dwell time, not by sample count', () => {
  const m = new SpatialMap(2, 1);
  // one long calm visit and one brief panic in the SAME cell
  m.add(0.25, 0.5, 9, { fear: 0 });
  m.add(0.25, 0.5, 1, { fear: 100 });
  const mean = m.meanAt('fear', m.indexAt(0.25, 0.5));
  return [Math.abs(mean - 10) < 1e-6,
    `9s at 0 Hz + 1s at 100 Hz -> ${mean.toFixed(2)} Hz (sample-count mean would be 50)`];
});

check('a spatially even world is reported as even, inventing no preference', () => {
  const m = new SpatialMap(8, 8);
  for (let i = 0; i < 8; i++) {
    for (let j = 0; j < 8; j++) m.add((i + 0.5) / 8, (j + 0.5) / 8, 20, { fear: 20 });
  }
  const pref = m.preferenceForLow('fear');
  return [Math.abs(pref - 0.5) < 1e-6, `preference score ${pref.toFixed(3)} (0.5 = no structure)`];
});

check('a genuine avoidance pattern is detected', () => {
  const m = new SpatialMap(8, 8);
  for (let i = 0; i < 8; i++) {
    for (let j = 0; j < 8; j++) {
      const dangerous = i >= 4;                    // right half frightens her
      // she spends little time where her circuit screams, a lot where it is calm
      m.add((i + 0.5) / 8, (j + 0.5) / 8, dangerous ? 20 : 200,
        { fear: dangerous ? 90 : 5 });
    }
  }
  const pref = m.preferenceForLow('fear');
  return [pref > 0.85, `spent ${(pref * 100).toFixed(1)}% of her time in the calm half`];
});

check('too little area covered reports nothing rather than a confident number', () => {
  const m = new SpatialMap(8, 8);
  m.add(0.1, 0.1, 5000, { fear: 10 });
  m.add(0.2, 0.2, 5000, { fear: 90 });
  return [m.preferenceForLow('fear') === null, 'two visited cells -> null, not a score'];
});

// Measured, not assumed: replicated runs of a spatially UNIFORM world scored
// between 0.06 and 0.58 over four simulated minutes each. Over short samples
// this statistic reads the random walk, not the world, so it must refuse to
// report at all until there is enough of it.
check('a short sample reports nothing, however much of the map it covers', () => {
  const m = new SpatialMap(8, 8);
  for (let i = 0; i < 8; i++) {
    for (let j = 0; j < 8; j++) m.add((i + 0.5) / 8, (j + 0.5) / 8, 1, { fear: i });
  }
  const short = m.preferenceForLow('fear');
  const threshold = MIN_PREFERENCE_SECONDS;
  // same coverage, now with enough time behind it
  const m2 = new SpatialMap(8, 8);
  for (let i = 0; i < 8; i++) {
    for (let j = 0; j < 8; j++) m2.add((i + 0.5) / 8, (j + 0.5) / 8, threshold / 64 + 1, { fear: i });
  }
  return [short === null && m2.preferenceForLow('fear') !== null,
    `64 cells x 1 s -> null; the same map with >= ${threshold} s total -> a number`];
});

// Escape takeoffs are the most direct "was this place frightening" signal the
// map carries, and the one most easily turned into an artefact: counted raw, a
// cell simply occupied for longer accumulates more of them and looks worse for
// it. They have to be a rate.
check('escape takeoffs are reported per minute, not as raw counts', () => {
  const m = new SpatialMap(4, 4);
  m.add(0.1, 0.1, 10, { fear: 0 });                 // brief visit, bolted twice
  m.addEvent(0.1, 0.1); m.addEvent(0.1, 0.1);
  m.add(0.9, 0.9, 600, { fear: 0 });                // long stay, also bolted twice
  m.addEvent(0.9, 0.9); m.addEvent(0.9, 0.9);
  const brief = m.meanAt('events', m.indexAt(0.1, 0.1));
  const long = m.meanAt('events', m.indexAt(0.9, 0.9));
  const never = m.meanAt('events', m.indexAt(0.5, 0.5));
  return [Math.abs(brief - 12) < 1e-6 && Math.abs(long - 0.2) < 1e-6 && never === null,
    `same 2 takeoffs: ${brief.toFixed(1)}/min where she barely stayed vs `
    + `${long.toFixed(1)}/min where she lingered`];
});

check('normalisation reports the peak it scaled by', () => {
  const m = new SpatialMap(4, 4);
  m.add(0.1, 0.1, 1, { fear: 40 });
  m.add(0.9, 0.9, 1, { fear: 10 });
  const { values, peak } = m.normalizedField('fear');
  return [peak === 40 && Math.abs(values[m.indexAt(0.1, 0.1)] - 1) < 1e-6
    && Math.abs(values[m.indexAt(0.9, 0.9)] - 0.25) < 1e-6,
  `peak ${peak} Hz, cells normalise to 1.00 and 0.25`];
});

// Rates and temperatures need different scales, and using one for the other
// misreads the map: a rate normalised from its own minimum would paint the
// quietest cell as "nothing", and a temperature normalised from zero throws
// away the part of the colour range the arena actually occupies.
check('rates scale from zero, temperatures from the range actually met', () => {
  const m = new SpatialMap(4, 1);
  m.add(0.1, 0.5, 10, { fear: 5, temp: 14 });
  m.add(0.4, 0.5, 10, { fear: 10, temp: 24 });
  m.add(0.9, 0.5, 10, { fear: 20, temp: 34 });
  const i = [m.indexAt(0.1, 0.5), m.indexAt(0.4, 0.5), m.indexAt(0.9, 0.5)];
  const rate = m.normalizedField('fear');            // zero-based
  const temp = m.normalizedField('temp', true);      // min-max
  const rateOK = Math.abs(rate.values[i[0]] - 0.25) < 1e-6 && rate.floor === 0;
  const tempOK = Math.abs(temp.values[i[0]]) < 1e-6
    && Math.abs(temp.values[i[1]] - 0.5) < 1e-6 && temp.floor === 14;
  return [rateOK && tempOK,
    `5 Hz of a 20 Hz peak -> ${rate.values[i[0]].toFixed(2)}; `
    + `14/24/34 C -> ${i.map((k) => temp.values[k].toFixed(2)).join('/')} (floor ${temp.floor} C)`];
});

check('a field with one single measured value does not divide by zero', () => {
  const m = new SpatialMap(4, 4);
  m.add(0.1, 0.1, 5, { temp: 21 });
  const f = m.normalizedField('temp', true);
  const v = f.values[m.indexAt(0.1, 0.1)];
  return [Number.isFinite(v) && v === 1, `single cell renders at ${v}, not NaN`];
});

check('out-of-bounds positions are rejected, not folded into edge cells', () => {
  const m = new SpatialMap(4, 4);
  const bad = m.add(1.4, 0.5, 1, { fear: 99 });
  const neg = m.add(-0.2, 0.5, 1, { fear: 99 });
  return [bad === -1 && neg === -1 && m.totalTime === 0,
    `both rejected, total time still ${m.totalTime}`];
});

// The same rule the display follows has to survive into the file: a cell she
// never entered must be absent, not a row of zeros somebody downstream averages
// into "she was calm there".
check('the CSV export omits unvisited cells instead of writing them as zero', () => {
  const m = new SpatialMap(4, 4);
  m.add(0.1, 0.1, 5, { fear: 7, loom: 1, sens: 2, temp: 22 });
  m.addEvent(0.1, 0.1);
  const lines = m.toCSV().trim().split('\n');
  const header = lines[0].split(',');
  const row = lines[1].split(',');
  return [lines.length === 2
    && header.includes('dwell_s') && header.includes('takeoffs_per_min')
    && Number(row[header.indexOf('dwell_s')]) === 5
    && Number(row[header.indexOf('mean_fear')]) === 7
    && Math.abs(Number(row[header.indexOf('takeoffs_per_min')]) - 12) < 1e-6,
  `1 of 16 cells written; that row carries dwell, means and a 12/min takeoff rate`];
});

check('reset clears every accumulator', () => {
  const m = new SpatialMap(4, 4);
  m.add(0.5, 0.5, 3, { fear: 10 });
  m.addEvent(0.5, 0.5);
  m.reset();
  const i = m.indexAt(0.5, 0.5);
  return [m.totalTime === 0 && m.dwell[i] === 0 && m.events[i] === 0 && m.meanAt('fear', i) === null,
    'dwell, events, sums and total time all back to empty'];
});

console.log(failures === 0 ? 'ALL SPATIAL TESTS PASS' : `${failures} FAILURES`);
process.exit(failures === 0 ? 0 : 1);
