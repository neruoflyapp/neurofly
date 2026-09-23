#!/usr/bin/env node
// etl_sensory_extension.mjs — adds two real FlyWire sensorimotor pathways that
// the escape-circuit subgraph does not contain:
//
//   taste:    the labellar gustatory receptor neurons (sub_class "sugar/water"
//             and "bitter") and the motor neurons of the proboscis (sub_class
//             proboscis_, haustellum_ and ingestion_motor_neuron), joined by the
//             neurons on the strongest two- and three-synapse paths between
//             them. Sugar driving proboscis motor neurons, and bitter
//             suppressing that drive, is the benchmark result of the published
//             whole-brain FlyWire LIF model (Shiu et al. 2024, Nature 634:210).
//   grooming: the antennal JO-F mechanosensory neurons (sub_class "grooming",
//             Hampel et al. 2020, eLife 9:e59976) and the DNg12 descending
//             neurons, whose activation drives anterior grooming — head sweeps
//             alternating with front-leg rubbing (Guo, Zhang & Simpson 2022,
//             Curr Biol 32:823), again with the strongest two- and
//             three-synapse paths between them.
//
// The paths are selected from the unthresholded FAFB v783 connections table
// with a bottleneck score, exactly like etl_thermo_extension.mjs selects its
// relays: a mediator counts only as much as the weaker of its two sides.
// Every connection row between an added neuron and the running circuit
// (circuit.json + thermo_extension.json + this file) is then kept, in both
// directions, signed and classed exactly as etl.py does.
//
// Output: data/sensory_extension.json, locked to the SHA-256 of both files it
// extends. Indices of every existing neuron are unchanged: the added neurons
// are appended after the thermo extension.
//
// Usage: node etl_sensory_extension.mjs [raw_dir]   (default ./raw_flywire_v2)

import fs from 'node:fs';
import path from 'node:path';
import zlib from 'node:zlib';
import readline from 'node:readline';
import { createHash } from 'node:crypto';
import { fileURLToPath } from 'node:url';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const RAW = process.argv[2] || path.join(HERE, 'raw_flywire_v2');
const OUT = path.join(HERE, 'data');

// Selection thresholds (synapses, summed over neuropil rows of a pair).
const MIN_PAIR = 5;              // the usual FlyWire threshold for a real connection
const MIN_SIDE_2HOP = 10;        // both sides of a two-synapse mediator
const MIN_FIRST_LAYER = 10;      // synapses from the seeds onto a first-layer cell
const MAX_2HOP = 100;
const MAX_SECOND_LAYER = 80;     // B in seed -> A -> B -> target
const MAX_FIRST_LAYER = 100;     // A in seed -> A -> B -> target
const NT_SIGN = { ACH: 1.0, GABA: -1.0, GLUT: -1.0, DA: 0.5, SER: 0.5, OCT: 0.5 };
const NT_CLASS = { DA: 1, SER: 2, OCT: 3 };

const MODALITIES = {
  taste: {
    seeds: (k) => k.cls === 'gustatory' && (k.subClass === 'sugar/water' || k.subClass === 'bitter'),
    group: (k) => (k.subClass === 'bitter' ? 'bitter' : 'sugar'),
    targets: (k) => /^(proboscis|haustellum|ingestion)_motor_neuron$/.test(k.subClass),
    targetGroup: (k) => (k.subClass === 'ingestion_motor_neuron' ? 'ingestion' : 'proboscis'),
  },
  grooming: {
    seeds: (k) => k.cls === 'mechanosensory' && k.subClass === 'grooming',
    group: () => 'jof',
    targets: (k, type) => /^DNg12/.test(type),
    targetGroup: () => 'dng12',
  },
};

function lines(file) {
  const input = fs.createReadStream(path.join(RAW, file)).pipe(zlib.createGunzip());
  return readline.createInterface({ input, crlfDelay: Infinity });
}
function sha256File(file) {
  return new Promise((resolve, reject) => {
    const h = createHash('sha256');
    fs.createReadStream(file).on('data', (d) => h.update(d)).on('end', () => resolve(h.digest('hex'))).on('error', reject);
  });
}
const splitCSV = (line) => line.split(',').map((f) => f.replace(/^"|"$/g, '').trim());

// --- the running circuit this extends ----------------------------------------
const circuitRaw = fs.readFileSync(path.join(OUT, 'circuit.json'));
const circuit = JSON.parse(circuitRaw.toString('utf8'));
const circuitSHA256 = createHash('sha256').update(circuitRaw).digest('hex');
const thermoRaw = fs.readFileSync(path.join(OUT, 'thermo_extension.json'));
const thermo = JSON.parse(thermoRaw.toString('utf8'));
const thermoSHA256 = createHash('sha256').update(thermoRaw).digest('hex');
if (thermo.circuitSHA256 !== circuitSHA256) {
  console.error('FATAL: thermo_extension.json belongs to a different circuit.json — rerun etl_thermo_extension.mjs first');
  process.exit(1);
}
const running = circuit.neurons.concat(thermo.neurons);
const n0 = running.length;
const runIdx = new Map(running.map((nr, i) => [String(nr.id), i]));
const thermoEdgeKeys = new Set(thermo.edges.map((e) => `${e[0]}:${e[1]}`));

// --- classification, cell types, coordinates ---------------------------------
const klass = new Map();
{
  let header = null;
  for await (const line of lines('classification.csv.gz')) {
    const c = splitCSV(line);
    if (!header) { header = Object.fromEntries(c.map((h, i) => [h, i])); continue; }
    if (!c[0]) continue;
    klass.set(c[0], { superClass: c[header.super_class] || '', cls: c[header.class] || '',
      subClass: c[header.sub_class] || '', side: c[header.side] || '' });
  }
}
const cellType = new Map();
{
  let first = true;
  for await (const line of lines('consolidated_cell_types.csv.gz')) {
    if (first) { first = false; continue; }
    const c = splitCSV(line);
    if (c[0]) cellType.set(c[0], c[1] || '');
  }
}
const pos = new Map();
{
  let first = true;
  for await (const line of lines('coordinates.csv.gz')) {
    if (first) { first = false; continue; }
    const comma = line.indexOf(',');
    const rid = line.slice(0, comma);
    if (!rid || pos.has(rid)) continue;
    const m = line.slice(comma + 1).match(/\[([^\]]*)\]/);
    if (!m) continue;
    const p = m[1].trim().split(/\s+/).map(Number);
    if (p.length === 3 && p.every(Number.isFinite)) pos.set(rid, p);
  }
}
let mn = [Infinity, Infinity, Infinity], mx = [-Infinity, -Infinity, -Infinity];
for (const p of pos.values()) for (let k = 0; k < 3; k++) { if (p[k] < mn[k]) mn[k] = p[k]; if (p[k] > mx[k]) mx[k] = p[k]; }
const ctr = [0, 1, 2].map((k) => (mn[k] + mx[k]) / 2);
const scale = 20 / Math.max(mx[0] - mn[0], mx[1] - mn[1], mx[2] - mn[2]);
const r3 = (v) => Math.round(v * 1000) / 1000;
const norm = (p) => [r3((p[0] - ctr[0]) * scale), r3(-(p[1] - ctr[1]) * scale), r3(-(p[2] - ctr[2]) * scale)];
{
  let checked = 0, mismatch = 0;
  for (const nr of circuit.neurons.slice(0, 300)) {
    const p = pos.get(String(nr.id));
    if (!p) continue;
    checked++;
    if (norm(p).some((v, k) => Math.abs(v - nr.pos[k]) > 0.0015)) mismatch++;
  }
  if (!checked || mismatch) { console.error(`FATAL: coordinate normalization mismatch (${mismatch}/${checked})`); process.exit(1); }
}
const usable = (id) => pos.has(id) && klass.has(id);

// --- seeds and targets per modality ------------------------------------------
const seedOf = new Map();     // id -> { modality, group }
const targetOf = new Map();   // id -> { modality, group }
for (const [id, k] of klass) {
  const type = cellType.get(id) || '';
  for (const [name, spec] of Object.entries(MODALITIES)) {
    if (spec.seeds(k, type)) seedOf.set(id, { modality: name, group: spec.group(k, type) });
    else if (spec.targets(k, type)) targetOf.set(id, { modality: name, group: spec.targetGroup(k, type) });
  }
}
const counts = {};
for (const v of [...seedOf.values(), ...targetOf.values()]) counts[`${v.modality}:${v.group}`] = (counts[`${v.modality}:${v.group}`] || 0) + 1;
console.log('seeds/targets:', counts);

// --- pass 1: seed -> X and X -> target, aggregated per pair -------------------
const pairKey = (a, b) => `${a}>${b}`;
const pairSyn = new Map();          // seed->X and X->target pairs only
{
  let first = true;
  for await (const line of lines('connections.csv.gz')) {
    if (first) { first = false; continue; }
    const c = line.split(',');
    const pre = c[0], post = c[1];
    if (!seedOf.has(pre) && !targetOf.has(post)) continue;
    const key = pairKey(pre, post);
    pairSyn.set(key, (pairSyn.get(key) || 0) + (+c[3]));
  }
}
const fromSeeds = {};   // modality -> Map(X -> syn from that modality's seeds, pairs >= MIN_PAIR)
const toTargets = {};   // modality -> Map(X -> syn onto that modality's targets)
for (const name of Object.keys(MODALITIES)) { fromSeeds[name] = new Map(); toTargets[name] = new Map(); }
for (const [key, syn] of pairSyn) {
  if (syn < MIN_PAIR) continue;
  const [pre, post] = key.split('>');
  const s = seedOf.get(pre);
  if (s) fromSeeds[s.modality].set(post, (fromSeeds[s.modality].get(post) || 0) + syn);
  const t = targetOf.get(post);
  if (t) toTargets[t.modality].set(pre, (toTargets[t.modality].get(pre) || 0) + syn);
}

// two-synapse mediators, and candidates for the three-synapse layers
const selected = new Map();          // id -> { modality, layer, fromSeeds, toTargets }
const secondLayerPool = {};          // modality -> Set(B candidates)
const firstLayerPool = {};           // modality -> Set(A candidates)
for (const name of Object.keys(MODALITIES)) {
  const two = [];
  for (const [id, from] of fromSeeds[name]) {
    const to = toTargets[name].get(id) || 0;
    if (from >= MIN_SIDE_2HOP && to >= MIN_SIDE_2HOP && !seedOf.has(id) && !targetOf.has(id) && usable(id)) {
      two.push({ id, score: Math.min(from, to), from, to });
    }
  }
  two.sort((a, b) => b.score - a.score || (a.id < b.id ? -1 : 1));
  for (const m of two.slice(0, MAX_2HOP)) selected.set(m.id, { modality: name, layer: 'mediator', fromSeeds: m.from, toTargets: m.to });
  console.log(`${name}: two-synapse mediators ${two.length}, kept ${Math.min(two.length, MAX_2HOP)}`);
  firstLayerPool[name] = new Set([...fromSeeds[name]].filter(([id, s]) => s >= MIN_FIRST_LAYER && !seedOf.has(id) && !targetOf.has(id)).map(([id]) => id));
  secondLayerPool[name] = new Set([...toTargets[name]].filter(([id]) => !seedOf.has(id) && !targetOf.has(id)).map(([id]) => id));
}

// --- pass 2: A -> B between the first- and second-layer pools -----------------
const abSyn = {};
for (const name of Object.keys(MODALITIES)) abSyn[name] = new Map();
{
  let first = true;
  for await (const line of lines('connections.csv.gz')) {
    if (first) { first = false; continue; }
    const c = line.split(',');
    const pre = c[0], post = c[1];
    for (const name of Object.keys(MODALITIES)) {
      if (firstLayerPool[name].has(pre) && secondLayerPool[name].has(post)) {
        const key = pairKey(pre, post);
        abSyn[name].set(key, (abSyn[name].get(key) || 0) + (+c[3]));
      }
    }
  }
}
for (const name of Object.keys(MODALITIES)) {
  // B: bottleneck of (its strongest-fed input from first-layer cells, its drive onto targets)
  const intoB = new Map();
  for (const [key, syn] of abSyn[name]) {
    if (syn < MIN_PAIR) continue;
    const [a, b] = key.split('>');
    // weight by how strongly A itself is fed by the seeds, relative to 100
    const feed = Math.min(1, (fromSeeds[name].get(a) || 0) / 100);
    intoB.set(b, (intoB.get(b) || 0) + syn * feed);
  }
  const bs = [];
  for (const [b, into] of intoB) {
    if (selected.has(b) || !usable(b)) continue;
    bs.push({ id: b, score: Math.min(into, toTargets[name].get(b) || 0) });
  }
  bs.sort((x, y) => y.score - x.score || (x.id < y.id ? -1 : 1));
  const keptB = new Set(bs.slice(0, MAX_SECOND_LAYER).filter((x) => x.score >= MIN_SIDE_2HOP).map((x) => x.id));
  for (const b of keptB) selected.set(b, { modality: name, layer: 'second', fromSeeds: fromSeeds[name].get(b) || 0, toTargets: toTargets[name].get(b) || 0 });
  // A: bottleneck of (synapses from seeds, synapses onto the kept B cells)
  const ontoB = new Map();
  for (const [key, syn] of abSyn[name]) {
    if (syn < MIN_PAIR) continue;
    const [a, b] = key.split('>');
    if (keptB.has(b)) ontoB.set(a, (ontoB.get(a) || 0) + syn);
  }
  const as = [];
  for (const [a, onto] of ontoB) {
    if (selected.has(a) || !usable(a)) continue;
    as.push({ id: a, score: Math.min(fromSeeds[name].get(a) || 0, onto), onto });
  }
  as.sort((x, y) => y.score - x.score || (x.id < y.id ? -1 : 1));
  for (const a of as.slice(0, MAX_FIRST_LAYER).filter((x) => x.score >= MIN_SIDE_2HOP)) {
    selected.set(a.id, { modality: name, layer: 'first', fromSeeds: fromSeeds[name].get(a.id) || 0, toSecondLayer: a.onto });
  }
  console.log(`${name}: second layer kept ${keptB.size}, first layer kept ${[...selected.values()].filter((v) => v.modality === name && v.layer === 'first').length}`);
}

// --- the added neurons ---------------------------------------------------------
const ext = [];
const circuitTags = [];
const add = (id, rec) => {
  if (runIdx.has(id)) { circuitTags.push({ index: runIdx.get(id), id, ...rec }); return; }
  if (!usable(id)) { console.warn(`${id} lacks position/classification; skipped`); return; }
  ext.push({ id, ...rec });
};
for (const [id, s] of seedOf) add(id, { extension: s.modality, sensoryGroup: s.group, layer: 0 });
for (const [id, s] of selected) {
  const rec = { extension: s.modality, layer: s.layer === 'first' ? 1 : s.layer === 'mediator' ? 1 : 2 };
  rec.pathRole = s.layer;
  add(id, rec);
}
for (const [id, t] of targetOf) add(id, { extension: t.modality, motorGroup: t.group, layer: 3 });
const extIdx = new Map(ext.map((e, k) => [e.id, n0 + k]));
const neurons = ext.map((e) => {
  const k = klass.get(e.id);
  const out = { id: e.id, type: k.superClass || '?', role: 'other', side: k.side, pos: norm(pos.get(e.id)),
    cellType: cellType.get(e.id) || '', extension: e.extension, layer: e.layer };
  for (const f of ['sensoryGroup', 'motorGroup', 'pathRole']) if (e[f]) out[f] = e[f];
  return out;
});

// --- pass 3: every row touching an added neuron --------------------------------
const edges = [];
let circCircRows = 0, thermoRows = 0;
const edgeCounts = { extToRunning: 0, runningToExt: 0, extToExt: 0 };
const synToRole = Object.create(null);
{
  let first = true;
  for await (const line of lines('connections.csv.gz')) {
    if (first) { first = false; continue; }
    const c = line.split(',');
    const pre = c[0], post = c[1];
    const ri = runIdx.get(pre), rj = runIdx.get(post);
    if (ri !== undefined && rj !== undefined) {
      if (ri < circuit.neurons.length && rj < circuit.neurons.length) circCircRows++;
      else thermoRows++;
      continue;
    }
    const i = ri !== undefined ? ri : extIdx.get(pre);
    const j = rj !== undefined ? rj : extIdx.get(post);
    if (i === undefined || j === undefined) continue;
    const syn = +c[3], nt = (c[4] || '').trim().toUpperCase();
    edges.push([i, j, Math.round(syn * (NT_SIGN[nt] ?? 1.0) * 10) / 10, NT_CLASS[nt] || 0]);
    if (i >= n0 && j < n0) {
      edgeCounts.extToRunning++;
      const nr = running[j];
      const key = nr.role !== 'other' ? nr.role : (nr.extension ? `thermo:${nr.thermoGroup || 'relay'}` : nr.type);
      synToRole[key] = (synToRole[key] || 0) + syn;
    } else if (i < n0) edgeCounts.runningToExt++;
    else edgeCounts.extToExt++;
  }
}
if (circCircRows !== circuit.edges.length) {
  console.error(`FATAL: ${circCircRows} circuit-internal rows here vs ${circuit.edges.length} in circuit.json — wrong connections table`);
  process.exit(1);
}
if (thermoRows !== thermo.edges.length) {
  console.error(`FATAL: ${thermoRows} thermo rows here vs ${thermo.edges.length} in thermo_extension.json`);
  process.exit(1);
}
void thermoEdgeKeys;

const inputs = {};
for (const f of ['classification.csv.gz', 'consolidated_cell_types.csv.gz', 'coordinates.csv.gz', 'connections.csv.gz']) {
  inputs[f] = await sha256File(path.join(RAW, f));
}
const layerCount = (mod) => {
  const out = {};
  for (const nr of neurons.filter((x) => x.extension === mod)) {
    const key = nr.sensoryGroup || nr.motorGroup || nr.pathRole;
    out[key] = (out[key] || 0) + 1;
  }
  return out;
};
const report = {
  added: { taste: layerCount('taste'), grooming: layerCount('grooming') },
  alreadyRunning: circuitTags.length,
  edges: edgeCounts,
  synapsesFromAddedNeuronsOntoRunningCircuit: synToRole,
  truncation: 'Three synapses from the sensory neurons at most. Paths needing a fourth synapse, and every '
    + 'neuron outside the strongest-path selection, are not included; the motor neurons therefore see only '
    + 'part of their real input.',
};
fs.writeFileSync(path.join(OUT, 'sensory_extension.json'), JSON.stringify({
  source: 'FlyWire Codex FAFB v783: classification.csv (gustatory sugar/water + bitter; mechanosensory grooming; '
    + 'proboscis/haustellum/ingestion motor neurons), consolidated_cell_types.csv (DNg12_*), coordinates.csv, '
    + 'connections.csv (unthresholded, signed by nt_type as in etl.py)',
  generatedBy: 'etl_sensory_extension.mjs',
  circuitSHA256, thermoExtensionSHA256: thermoSHA256, baseNeurons: n0, inputSHA256: inputs,
  selection: { minPair: MIN_PAIR, minSide: MIN_SIDE_2HOP, minFirstLayer: MIN_FIRST_LAYER,
    maxTwoSynapseMediators: MAX_2HOP, maxSecondLayer: MAX_SECOND_LAYER, maxFirstLayer: MAX_FIRST_LAYER,
    score: 'bottleneck: min(synapses from the previous layer, synapses toward the targets)' },
  edge_format: circuit.edge_format,
  report, circuitTags, neurons, edges,
}));
console.log(`sensory_extension.json: +${neurons.length} neurons, ${edges.length} edges`, edgeCounts);
console.log(JSON.stringify(report.added), 'tags', circuitTags.length);
console.log('synapses onto running circuit:', JSON.stringify(synToRole));
