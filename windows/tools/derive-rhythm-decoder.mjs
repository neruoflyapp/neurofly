// derive-rhythm-decoder.mjs — which premotor interneurons the stepping rules
// (src/rhythm.js) drive to move each joint of each leg, derived from the
// MaleCNS cord model itself.
//   node tools/derive-rhythm-decoder.mjs      (writes ../data/rhythm_decoder.json)
//
// Anatomy alone does not answer it: once the cord's own excitation and
// inhibition act, many premotor cells whose strongest contacts go to one
// muscle mainly recruit another, often on another leg. So the answer is
// measured in the model, in three steps:
//
//  1. Effects. In an active cord (DNp09 at 30 Hz on both sides, no stepping
//     rules), every premotor cell is driven alone, once excited and once
//     inhibited, and the change of all 18 joint axes (6 legs x hip, elevation,
//     knee; agonist minus antagonist motor activity) over 300 ms is measured
//     against the same cord without it. The model is deterministic, so each
//     difference is exact.
//  2. Fit. For each axis and direction, a sparse non-negative combination of
//     those cells (excited or inhibited) is fitted to move that axis and as
//     little else as possible (coordinate descent, L1 penalty, bounded
//     weights) — linear superposition of single-cell effects.
//  3. Check. Each fitted combination is then driven in the nonlinear model and
//     its real effect on its own axis and on all others is recorded.
//
// The output is derived data. It depends on the cord model's parameters
// (recorded, and checked by locomotor.js) and on the SHA-256 of
// locomotor_circuit.json with LF line endings (checked by data.js). Rerun
// after changing either.
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { fileURLToPath } from 'node:url';
import { LocomotorSim, DECODER_MODEL_KEYS } from '../src/locomotor.js';
import { JOINT_AXES, LEG_NAMES } from '../src/rhythm.js';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const DATA = path.resolve(HERE, '../../data');
const OUT = path.join(DATA, 'rhythm_decoder.json');
const raw = fs.readFileSync(path.join(DATA, 'locomotor_circuit.json'), 'utf8');
const circuit = JSON.parse(raw);
// Locked to the content with LF line endings (data.js does the same), so a
// CRLF checkout of the same file still matches.
const locomotorContentSHA256 = crypto.createHash('sha256').update(raw.replace(/\r\n/g, '\n'), 'utf8').digest('hex');

const PROBE = 0.12;               // drive onto one cell per probe (threshold-scale units per ms)
const WARM_MS = 200, MEASURE_MS = 300;
const TARGET = 0.3;               // fitted axis change per decoder
const LAMBDA = 0.002, MAX_WEIGHT = 3, SWEEPS = 300;
const CONTEXT = { DNp09: 30 };
const NA = JOINT_AXES.length, NAXES = 6 * NA;

const sim = new LocomotorSim(circuit, { rhythm: false });
function axesOf(commands, out) {
  for (let leg = 0; leg < 6; leg++) {
    const c = commands[leg];
    out[leg * NA] += c.protract - c.retract;
    out[leg * NA + 1] += c.lift - c.depress;
    out[leg * NA + 2] += c.flex - c.extend;
  }
}
// Mean joint axes over MEASURE_MS with the given premotor drive held on.
function measure(drive) {
  sim.reset();
  for (const [type, rate] of Object.entries(CONTEXT)) for (const side of ['left', 'right']) sim.setDescending(type, side, rate);
  sim.step(WARM_MS);
  for (const [i, value] of drive) sim.rhythmDrive[i] = value;
  const mean = new Float64Array(NAXES);
  for (let t = 0; t < MEASURE_MS; t++) { sim.step(1); axesOf(sim.commands, mean); }
  for (const [i] of drive) sim.rhythmDrive[i] = 0;
  for (let k = 0; k < NAXES; k++) mean[k] /= MEASURE_MS;
  return mean;
}

const t0 = Date.now();
const base = measure([]);
const premotor = circuit.neurons.map((n, i) => (n.role === 'premotor' ? i : -1)).filter((i) => i >= 0);
// Columns: premotor cells excited, then the same cells inhibited.
const columns = [];
for (const sign of [1, -1]) {
  for (const i of premotor) {
    const m = measure([[i, sign * PROBE]]);
    columns.push({ cell: i, sign, effect: m.map((x, k) => x - base[k]) });
  }
}
const norm2 = columns.map((c) => c.effect.reduce((s, x) => s + x * x, 0));

function fit(target) {
  const w = new Float64Array(columns.length), r = Float64Array.from(target);
  for (let sweep = 0; sweep < SWEEPS; sweep++) {
    let change = 0;
    for (let j = 0; j < columns.length; j++) {
      if (norm2[j] < 1e-8) continue;
      const e = columns[j].effect;
      let g = 0;
      for (let k = 0; k < NAXES; k++) g += e[k] * r[k];
      const next = Math.min(MAX_WEIGHT, Math.max(0, w[j] + (g - LAMBDA) / norm2[j]));
      const delta = next - w[j];
      if (delta !== 0) { for (let k = 0; k < NAXES; k++) r[k] -= delta * e[k]; w[j] = next; change += Math.abs(delta); }
    }
    if (change < 1e-9) break;
  }
  return w;
}

const decoders = [];
for (let leg = 0; leg < 6; leg++) {
  for (let a = 0; a < NA; a++) {
    for (const direction of [1, -1]) {
      const k = leg * NA + a, target = new Float64Array(NAXES);
      target[k] = direction * TARGET;
      const w = fit(target);
      // Drive per unit of axis demand, in multiples of the probe drive; a
      // cell listed twice (excited and inhibited) keeps its net drive.
      const net = new Map();
      w.forEach((x, j) => { if (x > 1e-4) net.set(columns[j].cell, (net.get(columns[j].cell) || 0) + columns[j].sign * x / TARGET); });
      const cells = [...net].filter(([, x]) => Math.abs(x) > 1e-4).sort((p, q) => Math.abs(q[1]) - Math.abs(p[1]));
      // Nonlinear check at a demand of 0.3: the linear fit predicts +/-0.3.
      const check = measure(cells.map(([i, x]) => [i, 0.3 * x * PROBE])).map((x, j) => x - base[j]);
      let cross = 0, worst = 0;
      check.forEach((x, j) => { if (j !== k) { cross += Math.abs(x); worst = Math.max(worst, Math.abs(x)); } });
      decoders.push({
        leg: LEG_NAMES[leg], axis: JOINT_AXES[a], direction,
        cells: cells.map(([i, x]) => [circuit.neurons[i].id, +x.toFixed(4), circuit.neurons[i].type]),
        check: { demand: 0.3, ownAxis: +(check[k] * direction).toFixed(3), largestOtherAxis: +worst.toFixed(3), sumOtherAxes: +cross.toFixed(3) },
      });
    }
  }
}

const model = Object.fromEntries(DECODER_MODEL_KEYS.map((key) => [key, sim.parameters[key]]));
const used = new Set(decoders.flatMap((d) => d.cells.map((c) => c[0])));
fs.writeFileSync(OUT, `${JSON.stringify({
  schema: 'neurofly-rhythm-decoder-1',
  description: 'Premotor drive that moves each joint axis of each leg in the NeuroFly MaleCNS cord model, fitted from single-cell '
    + 'effects measured in that model (tools/derive-rhythm-decoder.mjs). Derived, model-dependent data, not an annotation: '
    + 'which cells rhythm-generating interneurons actually contact is not in the extracted subgraph.',
  locomotorContentSHA256,
  model,
  method: { context: 'DNp09 30 Hz both sides, stepping rules off', probeDrive: PROBE, warmMs: WARM_MS, measureMs: MEASURE_MS,
    target: TARGET, lambda: LAMBDA, maxWeight: MAX_WEIGHT, premotorCells: premotor.length,
    axes: 'hip = protract - retract, elevation = lift - depress, knee = flex - extend (motor activity, 0..1 each)',
    weight: 'drive onto the cell per unit of axis demand, in multiples of probeDrive; negative = inhibition' },
  summary: { decoders: decoders.length, cells: used.size,
    meanOwnAxisAtDemand03: +(decoders.reduce((s, d) => s + d.check.ownAxis, 0) / decoders.length).toFixed(3) },
  decoders,
})}\n`);
console.log(`${decoders.length} decoders over ${used.size} premotor cells in ${((Date.now() - t0) / 1000).toFixed(0)} s`);
for (const d of decoders) {
  console.log(`${d.leg} ${d.axis.padEnd(9)} ${d.direction > 0 ? '+' : '-'} ${String(d.cells.length).padStart(2)} cells  own ${d.check.ownAxis.toFixed(2)}  largest other ${d.check.largestOtherAxis.toFixed(2)}`);
}
console.log('written', OUT);
