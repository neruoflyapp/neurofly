#!/usr/bin/env node
// etl_thermo_extension.mjs — adds FlyWire's real thermosensory neurons to the
// escape circuit, so temperature can reach the brain model through the cells
// that actually transduce it instead of through visual looming detectors.
//
// The escape-circuit subgraph (etl.py) contains no thermosensors: its partner
// selection ranks by synapse count onto the command neurons, and FlyWire's
// hot and cold cells barely touch those (31 and 6 synapses). Their influence
// arrives over a second synapse. So this extension adds
//   layer 0: every FAFB v783 neuron with class "thermosensory" and sub_class
//            "heating" (hot cells) or "cold" (cold cells);
//   layer 1: their direct postsynaptic partners whose two-synapse path into
//            the circuit is strongest, ranked by the bottleneck
//            min(synapses from thermosensors, synapses onto circuit neurons);
// and every connection row between the added neurons and the circuit, in both
// directions, signed and classed exactly as etl.py does. Humidity cells
// (sub_class "humid") are left out: nothing in the world model stimulates
// them. Anything further upstream than two synapses (e.g. the main
// thermosensory projection-neuron routes into the lateral horn) is truncated
// and reported, not claimed.
//
// Output: data/thermo_extension.json, locked to the SHA-256 of the exact
// circuit.json it extends. data.js merges it only when that hash matches, so
// circuit.json itself, which every other tool reads unchanged, is
// untouched.
//
// Usage: node etl_thermo_extension.mjs [raw_dir]   (default ./raw_flywire_v2,
// the unthresholded connections table circuit.json was built from).

import fs from 'node:fs';
import path from 'node:path';
import zlib from 'node:zlib';
import readline from 'node:readline';
import { createHash } from 'node:crypto';
import { fileURLToPath } from 'node:url';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const RAW = process.argv[2] || path.join(HERE, 'raw_flywire_v2');
const OUT = path.join(HERE, 'data');

const MIN_FROM_SEEDS = 5;      // synapses from hot/cold cells onto a layer-1 candidate
const MIN_INTO_CIRCUIT = 20;   // synapses from that candidate onto circuit neurons
const MAX_BRIDGES = 150;
// identical to etl.py
const NT_SIGN = { ACH: 1.0, GABA: -1.0, GLUT: -1.0, DA: 0.5, SER: 0.5, OCT: 0.5 };
const NT_CLASS = { DA: 1, SER: 2, OCT: 3 };
const THERMO_GROUP = { heating: 'hot', cold: 'cold' };

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
function splitCSV(line) {
  // Codex dumps quote only fields that contain commas; none of the columns
  // read here do, but strip stray quotes defensively.
  return line.split(',').map((f) => f.replace(/^"|"$/g, '').trim());
}

const circuitFile = path.join(OUT, 'circuit.json');
const circuitRaw = fs.readFileSync(circuitFile);
const circuit = JSON.parse(circuitRaw.toString('utf8'));
const circuitSHA256 = createHash('sha256').update(circuitRaw).digest('hex');
const n0 = circuit.neurons.length;
const circIdx = new Map(circuit.neurons.map((nr, i) => [String(nr.id), i]));

// --- classification: seeds + super_class/side for everyone -------------------
const klass = new Map();          // id -> { superClass, cls, subClass, side }
const seeds = new Map();          // id -> 'hot' | 'cold'
{
  let header = null;
  for await (const line of lines('classification.csv.gz')) {
    const c = splitCSV(line);
    if (!header) { header = Object.fromEntries(c.map((h, i) => [h, i])); continue; }
    if (!c[0]) continue;
    const rec = { superClass: c[header.super_class] || '', cls: c[header.class] || '',
      subClass: c[header.sub_class] || '', side: c[header.side] || '' };
    klass.set(c[0], rec);
    if (rec.cls === 'thermosensory' && THERMO_GROUP[rec.subClass]) seeds.set(c[0], THERMO_GROUP[rec.subClass]);
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
// --- coordinates: first occurrence, etl.py's normalization over ALL of them --
const pos = new Map();
{
  let first = true;
  for await (const line of lines('coordinates.csv.gz')) {
    if (first) { first = false; continue; }
    const comma = line.indexOf(',');
    const rid = line.slice(0, comma);
    if (!rid || pos.has(rid)) continue;
    const rest = line.slice(comma + 1);
    const m = rest.match(/\[([^\]]*)\]/);
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

// The added neurons must sit in the same coordinate frame as the circuit.
let posChecked = 0, posMismatch = 0;
for (const nr of circuit.neurons.slice(0, 300)) {
  const p = pos.get(String(nr.id));
  if (!p) continue;
  posChecked++;
  const q = norm(p);
  if (q.some((v, k) => Math.abs(v - nr.pos[k]) > 0.0015)) posMismatch++;
}
if (!posChecked || posMismatch) {
  console.error(`FATAL: coordinate normalization does not reproduce circuit.json (${posMismatch}/${posChecked} mismatched)`);
  process.exit(1);
}

const seedsInCircuit = [...seeds.keys()].filter((id) => circIdx.has(id));
const seedCounts = { hot: 0, cold: 0 };
for (const g of seeds.values()) seedCounts[g]++;
console.log(`thermosensory seeds: ${seeds.size} (hot ${seedCounts.hot}, cold ${seedCounts.cold}); already in circuit: ${seedsInCircuit.length}`);

// --- connections pass 1: candidate strengths -------------------------------
const fromSeeds = new Map();       // post -> { hot, cold }
const intoCircuit = new Map();     // pre  -> synapses onto circuit neurons
const seedDirectToCircuit = { hot: 0, cold: 0 };
let rowsSeen = 0;
{
  let first = true;
  for await (const line of lines('connections.csv.gz')) {
    if (first) { first = false; continue; }
    rowsSeen++;
    const c = line.split(',');
    const pre = c[0], post = c[1], syn = +c[3];
    const g = seeds.get(pre);
    if (g) {
      if (!fromSeeds.has(post)) fromSeeds.set(post, { hot: 0, cold: 0 });
      fromSeeds.get(post)[g] += syn;
      if (circIdx.has(post)) seedDirectToCircuit[g] += syn;
    }
    if (circIdx.has(post)) intoCircuit.set(pre, (intoCircuit.get(pre) || 0) + syn);
  }
}
console.log(`connections rows: ${rowsSeen}; direct thermosensor -> circuit synapses:`, seedDirectToCircuit);

const usable = (id) => pos.has(id) && klass.has(id);
const candidates = [];
for (const [id, s] of fromSeeds) {
  if (circIdx.has(id) || seeds.has(id) || !usable(id)) continue;
  const from = s.hot + s.cold, into = intoCircuit.get(id) || 0;
  if (from < MIN_FROM_SEEDS || into < MIN_INTO_CIRCUIT) continue;
  candidates.push({ id, fromHot: s.hot, fromCold: s.cold, into, score: Math.min(from, into) });
}
candidates.sort((a, b) => b.score - a.score || (a.id < b.id ? -1 : a.id > b.id ? 1 : 0));
const bridges = candidates.slice(0, MAX_BRIDGES);
console.log(`layer-1 candidates meeting thresholds: ${candidates.length}; kept: ${bridges.length}`);

// --- the added neurons (seeds already in the circuit are tagged, not duplicated)
const ext = [];
const circuitTags = [];
for (const [id, g] of seeds) {
  if (circIdx.has(id)) { circuitTags.push({ index: circIdx.get(id), id, thermoGroup: g }); continue; }
  if (!usable(id)) { console.warn(`seed ${id} has no position/classification; skipped`); continue; }
  ext.push({ id, layer: 0, thermoGroup: g });
}
for (const b of bridges) ext.push({ id: b.id, layer: 1, fromHot: b.fromHot, fromCold: b.fromCold, intoCircuit: b.into });
const extIdx = new Map(ext.map((e, k) => [e.id, n0 + k]));
const neurons = ext.map((e) => {
  const k = klass.get(e.id);
  const out = { id: e.id, type: k.superClass || '?', role: 'other', side: k.side, pos: norm(pos.get(e.id)),
    cellType: cellType.get(e.id) || '', extension: 'thermo', layer: e.layer };
  if (e.thermoGroup) out.thermoGroup = e.thermoGroup;
  if (e.layer === 1) Object.assign(out, { fromHot: e.fromHot, fromCold: e.fromCold, intoCircuit: e.intoCircuit });
  return out;
});

// --- connections pass 2: every row touching an added neuron ------------------
const edges = [];
let circCircRows = 0;
const counts = { extToCirc: 0, circToExt: 0, extToExt: 0 };
const synToRole = Object.create(null);    // synapses from added neurons onto circuit roles
{
  let first = true;
  for await (const line of lines('connections.csv.gz')) {
    if (first) { first = false; continue; }
    const c = line.split(',');
    const pre = c[0], post = c[1];
    const ci = circIdx.get(pre), cj = circIdx.get(post);
    if (ci !== undefined && cj !== undefined) { circCircRows++; continue; }
    const i = ci !== undefined ? ci : extIdx.get(pre);
    const j = cj !== undefined ? cj : extIdx.get(post);
    if (i === undefined || j === undefined) continue;
    const syn = +c[3], nt = (c[4] || '').trim().toUpperCase();
    const sign = NT_SIGN[nt] ?? 1.0;
    edges.push([i, j, Math.round(syn * sign * 10) / 10, NT_CLASS[nt] || 0]);
    if (i >= n0 && j < n0) {
      counts.extToCirc++;
      const nr = circuit.neurons[j];
      const key = nr.role !== 'other' ? nr.role : nr.type;
      synToRole[key] = (synToRole[key] || 0) + syn;
    } else if (i < n0) counts.circToExt++;
    else counts.extToExt++;
  }
}
// The circuit's own rows must be exactly the ones etl.py kept: proves this is
// the connections table circuit.json was built from.
if (circCircRows !== circuit.edges.length) {
  console.error(`FATAL: ${circCircRows} circuit-internal rows here vs ${circuit.edges.length} in circuit.json — wrong connections table`);
  process.exit(1);
}

const inputs = {};
for (const f of ['classification.csv.gz', 'consolidated_cell_types.csv.gz', 'coordinates.csv.gz', 'connections.csv.gz']) {
  inputs[f] = await sha256File(path.join(RAW, f));
}
const report = {
  seeds: seedCounts, seedsAlreadyInCircuit: circuitTags.length,
  directThermosensorToCircuitSynapses: seedDirectToCircuit,
  layer1Candidates: candidates.length, layer1Kept: bridges.length,
  edges: counts, synapsesFromAddedNeuronsOntoCircuit: synToRole,
  topBridges: bridges.slice(0, 12).map((b) => ({ cellType: cellType.get(b.id) || b.id, fromHot: b.fromHot, fromCold: b.fromCold, intoCircuit: b.into })),
  truncation: 'Two synapses from the thermosensors at most; routes needing a third synapse (e.g. via thermosensory projection neurons into the lateral horn) are not included.',
};
const outFile = path.join(OUT, 'thermo_extension.json');
fs.writeFileSync(outFile, JSON.stringify({
  source: 'FlyWire Codex FAFB v783: classification.csv (class thermosensory; sub_class heating/cold), '
    + 'consolidated_cell_types.csv, coordinates.csv, connections.csv (unthresholded, signed by nt_type as in etl.py)',
  generatedBy: 'etl_thermo_extension.mjs',
  circuitSHA256, baseNeurons: n0, inputSHA256: inputs,
  selection: { layer0: 'all hot (heating) and cold thermosensory cells', layer1: 'direct partners ranked by min(synapses from thermosensors, synapses onto circuit)',
    minFromSeeds: MIN_FROM_SEEDS, minIntoCircuit: MIN_INTO_CIRCUIT, maxBridges: MAX_BRIDGES },
  edge_format: circuit.edge_format,
  report, circuitTags, neurons, edges,
}));
console.log(`thermo_extension.json: +${neurons.length} neurons (${neurons.filter((x) => x.layer === 0).length} thermosensors, ${bridges.length} layer-1), ${edges.length} edges`, counts);
console.log('synapses from added neurons onto circuit roles:', JSON.stringify(synToRole));
console.log('top layer-1:', JSON.stringify(report.topBridges));
