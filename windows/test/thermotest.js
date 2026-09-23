// thermotest.js — temperature must reach the brain through FlyWire's real
// thermosensory cells, and what follows must come from their real wiring.
//   node test/thermotest.js
//
// circuit.json (the escape-circuit subgraph) contains no thermosensors, so
// heat used to be injected into the visual looming detectors. The thermo
// extension (data/thermo_extension.json, etl_thermo_extension.mjs) adds the
// 7 hot and 9 cold cells of FAFB v783 plus the neurons carrying their
// strongest two-synapse paths into the circuit. These checks pin that down:
// the cells exist and are attached to this exact circuit, each temperature
// class reaches its own cells only, the activity travels on through the
// measured relay layer, and the old heat-into-vision shortcut stays gone.

import './random.js';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { loadBrainData } from '../src/data.js';
import { LIFSim } from '../src/sim.js';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const data = loadBrainData();
if (!data) { process.stderr.write('no data/ — run etl.py first\n'); process.exit(1); }

let failures = 0;
function check(name, fn) {
  const [ok, describe] = fn();
  if (!ok) failures++;
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}: ${describe}`);
}

const ext = data.provenance.thermoExtension;
check('the thermo extension is attached to this exact circuit', () => {
  const ok = data.provenance.thermoExtensionStatus === 'attached' && ext
    && ext.hotCells === 7 && ext.coldCells === 9 && ext.relayNeurons > 0
    && ext.runningNeurons === data.provenance.brainAudit.neurons + ext.addedNeurons;
  return [ok, `status=${data.provenance.thermoExtensionStatus}, hot ${ext?.hotCells}, cold ${ext?.coldCells}, `
    + `relays ${ext?.relayNeurons}, +${ext?.addedEdges} edges, running ${ext?.runningNeurons} neurons`];
});
if (!ext) { console.log('1 FAILURES'); process.exit(1); }

function run({ hot = 0, cold = 0, ms = 2500, seed = 11 } = {}) {
  const sim = new LIFSim(data.circuit, null, null, { seed });
  sim.step(600); sim.consumeGF();
  let gfSpikes = 0;
  for (let t = 0; t < ms; t++) {
    sim.thermoHotDrive = hot; sim.thermoColdDrive = cold;
    sim.step(1);
    if (sim.consumeGF()) gfSpikes++;
  }
  return { sim, gfSpikes };
}
const rest = run();
const heat = run({ hot: 1 });
const chill = run({ cold: 1 });
const fmt = (v) => v.toFixed(1);

check('added neurons stay out of the antennal and ascending input populations', () => {
  const s = rest.sim;
  const inSens = s.sens.some((i) => data.circuit.neurons[i].extension);
  const inAsc = s.ascend.some((i) => data.circuit.neurons[i].extension);
  return [!inSens && !inAsc && s.sensAuditory.length === 176 && s.sensWind.length === 18,
    `JO-A/B ${s.sensAuditory.length}, JO-C/D/E ${s.sensWind.length}, ascend ${s.ascend.length}; extension in sens=${inSens}, in ascend=${inAsc}`];
});

check('thermosensors are quiet at a comfortable temperature', () => {
  const s = rest.sim;
  return [s.rateThermoHot < 5 && s.rateThermoCold < 5,
    `hot cells ${fmt(s.rateThermoHot)} Hz, cold cells ${fmt(s.rateThermoCold)} Hz`];
});

check('warming drives the hot cells and not the cold cells', () => {
  const s = heat.sim;
  return [s.rateThermoHot > 30 && s.rateThermoCold < 5,
    `hot cells ${fmt(rest.sim.rateThermoHot)} -> ${fmt(s.rateThermoHot)} Hz, cold cells ${fmt(s.rateThermoCold)} Hz`];
});

check('cooling drives the cold cells and not the hot cells', () => {
  const s = chill.sim;
  return [s.rateThermoCold > 30 && s.rateThermoHot < 5,
    `cold cells ${fmt(rest.sim.rateThermoCold)} -> ${fmt(s.rateThermoCold)} Hz, hot cells ${fmt(s.rateThermoHot)} Hz`];
});

// Does the activity travel on? Measured on the three relays each cell class
// drives hardest (FlyWire synapse counts: the VP2 / VP3 thermosensory
// projection neurons), as their mean membrane potential — the direct effect
// of the input, whether or not it reaches threshold. It must rise for the
// driven class and not for the other.
//
// Measured, and a known model weakness: at the uniform 0.0002/synapse scale
// the hot path stays mostly SUBTHRESHOLD at this first relay (strong
// depolarization, few extra spikes), while the cold cells — 7,812 synapses
// against the hot cells' 4,830 — push their projection neurons over
// threshold. Real VP2 projection neurons respond robustly to heating (Frank
// et al. 2015; Liu et al. 2015). Nothing is special-cased to hide that.
function relayDepolarization(targetCells, drive) {
  const cells = new Set(targetCells);
  const input = new Map();
  for (const [i, j, w] of data.circuit.edges) {
    if (cells.has(i) && rest.sim.thermoRelay.includes(j)) input.set(j, (input.get(j) || 0) + w);
  }
  const top = [...input.entries()].sort((a, b) => b[1] - a[1]).slice(0, 3).map(([j]) => j);
  const meanV = (opts) => {
    const sim = new LIFSim(data.circuit, null, null, { seed: 11 });
    sim.step(600);
    let sum = 0, spikes = 0;
    for (let t = 0; t < 2000; t++) {
      sim.thermoHotDrive = opts.hot || 0; sim.thermoColdDrive = opts.cold || 0;
      sim.step(1);
      for (const j of top) { sum += sim.v[j]; if (sim.refr[j] >= 1.5) spikes++; }
    }
    return { v: sum / (2000 * top.length), hz: spikes / (2 * top.length) };
  };
  return { top, rest: meanV({}), driven: meanV(drive), other: meanV(drive.hot ? { cold: 1 } : { hot: 1 }) };
}

for (const [label, cellsKey, drive] of [['warming', 'thermoHot', { hot: 1 }], ['cooling', 'thermoCold', { cold: 1 }]]) {
  const r = relayDepolarization(rest.sim[cellsKey], drive);
  const types = r.top.map((j) => data.circuit.neurons[j].cellType).join(', ');
  // "More active" = clearly depolarized OR clearly firing more: a neuron
  // driven over threshold resets to 0 at every spike, so its mean potential
  // understates suprathreshold drive (the cold path's VP3 neurons).
  const moreActive = (x) => x.v > r.rest.v + 0.15 || x.hz > r.rest.hz * 2 + 2;
  check(`${label} activates the projection neurons its own cells drive hardest`, () => {
    const ok = moreActive(r.driven) && !moreActive(r.other);
    return [ok, `${types}: mean v ${r.rest.v.toFixed(2)} -> ${r.driven.v.toFixed(2)} `
      + `(other class ${r.other.v.toFixed(2)}); spikes ${r.rest.hz.toFixed(1)} -> ${r.driven.hz.toFixed(1)} Hz`];
  });
}
console.log(`INFO  relay groups: hot-fed ${rest.sim.thermoRelayHot.length} at ${fmt(rest.sim.rateThermoRelayHot)} -> `
  + `${fmt(heat.sim.rateThermoRelayHot)} Hz warming; cold-fed ${rest.sim.thermoRelayCold.length} at `
  + `${fmt(rest.sim.rateThermoRelayCold)} -> ${fmt(chill.sim.rateThermoRelayCold)} Hz cooling`);

// Measured, not asserted: which of the original circuit's outputs move is the
// wiring's answer, and this model has no validated thermotaxis to compare it to.
const line = (label, r) => `${label}: DNa L/R ${fmt(r.sim.rateDNaL)}/${fmt(r.sim.rateDNaR)}, DNp09 ${fmt(r.sim.rateFwd)}, `
  + `MDN ${fmt(r.sim.rateMDN)}, GF spikes ${r.gfSpikes}, population ${fmt(r.sim.ratePop)} Hz`;
console.log(`INFO  ${line('rest   ', rest)}`);
console.log(`INFO  ${line('warming', heat)}`);
console.log(`INFO  ${line('cooling', chill)}`);

check('no thermosensor inherits the Johnston\'s-organ gap-junction boost onto the giant fiber', () => {
  const s = rest.sim;
  let boosted = 0, checked = 0;
  for (const i of [...s.thermoHot, ...s.thermoCold]) {
    for (let k = s.rowStart[i]; k < s.rowStart[i + 1]; k++) {
      if (s.roles[s.colIdx[k]] !== 'gf') continue;
      checked++;
      const raw = data.circuit.edges.find((e) => e[0] === i && e[1] === s.colIdx[k]);
      if (raw && Math.abs(s.w[k] - raw[2] * s.weightScale) > 1e-9) boosted++;
    }
  }
  return [boosted === 0, `${checked} direct thermosensor->GF synapse rows, ${boosted} boosted`];
});

check('the opt-in plasticity experiment keeps its scope when the extension is loaded', () => {
  const n0 = data.provenance.brainAudit.neurons;
  const base = {
    ...data.circuit,
    neurons: data.circuit.neurons.slice(0, n0),
    edges: data.circuit.edges.filter((e) => e[0] < n0 && e[1] < n0),
  };
  const withExt = new LIFSim(data.circuit, null, null, { seed: 11, plasticity: { enabled: true } });
  const without = new LIFSim(base, null, null, { seed: 11, plasticity: { enabled: true } });
  const a = withExt.plasticitySummary().eligibleEdges, b = without.plasticitySummary().eligibleEdges;
  return [a === b && a > 0, `eligible contacts: ${a} with extension, ${b} without`];
});

check('heat is no longer injected into the visual looming detectors', () => {
  // The worker refactor moved sensory routing out of the renderer.
  const src = fs.readFileSync(path.join(HERE, '..', 'src', 'closed-loop.js'), 'utf8');
  const old = /effectiveTempC\s*>\s*38\)\s*\{\s*loomOverride/.test(src);
  const routed = /sim\.thermoHotDrive\s*=/.test(src) && /sim\.thermoColdDrive\s*=/.test(src);
  return [!old && routed, `heat->loom shortcut present=${old}, temperature routed to thermosensors=${routed}`];
});

check('without the extension, temperature drives nothing instead of crashing', () => {
  const n0 = data.provenance.brainAudit.neurons;
  const base = {
    ...data.circuit,
    neurons: data.circuit.neurons.slice(0, n0),
    edges: data.circuit.edges.filter((e) => e[0] < n0 && e[1] < n0),
  };
  const sim = new LIFSim(base, null, null, { seed: 11 });
  for (let t = 0; t < 800; t++) { sim.thermoHotDrive = 1; sim.step(1); }
  return [sim.thermoHot.length === 0 && Number.isFinite(sim.ratePop) && sim.rateThermoHot === 0,
    `base circuit: ${sim.thermoHot.length} hot cells, population ${fmt(sim.ratePop)} Hz`];
});

console.log(failures === 0 ? 'ALL THERMO TESTS PASS' : `${failures} FAILURES`);
process.exit(failures === 0 ? 0 : 1);
