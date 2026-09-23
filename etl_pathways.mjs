#!/usr/bin/env node
// etl_pathways.mjs — measures, in the complete FAFB v783 connectome (all
// ~139,000 neurons, not the simulated subset), how directly the sensory
// neurons that signal potentially harmful or valuable stimuli reach the
// brain's integrative centres.
//
// This is the data behind criterion 3 of Birch et al. (2021), "integrated
// nociception": are the neurons that detect noxious stimuli connected to
// integrative brain regions? The adult fly brain in FlyWire contains no
// nociceptors in the strict sense (body-wall and leg nociceptors enter
// through the nerve cord, which FAFB does not include), so the candidates
// measured here are the brain's own aversive and thermal sensors — bitter
// taste neurons, hot cells and cold cells — with sugar taste neurons and the
// antennal grooming mechanosensors (JO-F) as comparisons.
//
// For each source class: the fewest synapses (connections of >= 5 synapses,
// the usual FlyWire threshold) to the mushroom body (Kenyon cells, output
// neurons, dopaminergic and other MB-associated types), the central complex
// and the lateral horn; how many of each region's cells lie within two and
// three synapses; and which cell types carry the two-synapse routes.
//
// Output: data/sentience_pathways.json, with the input files' SHA-256.
// Usage: node --max-old-space-size=8192 etl_pathways.mjs [raw_dir]

import fs from 'node:fs';
import path from 'node:path';
import zlib from 'node:zlib';
import readline from 'node:readline';
import { createHash } from 'node:crypto';
import { fileURLToPath } from 'node:url';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const RAW = process.argv[2] || path.join(HERE, 'raw_flywire_v2');
const OUT = path.join(HERE, 'data');
const MIN_PAIR = 5;

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

// --- neurons ---------------------------------------------------------------------
const ids = [], idx = new Map(), cls = [];
{
  let header = null;
  for await (const line of lines('classification.csv.gz')) {
    const c = line.split(',');
    if (!header) { header = Object.fromEntries(c.map((h, i) => [h, i])); continue; }
    if (!c[0]) continue;
    idx.set(c[0], ids.length); ids.push(c[0]);
    cls.push({ superClass: c[header.super_class], cls: c[header.class], subClass: c[header.sub_class] });
  }
}
const n = ids.length;
const type = new Array(n).fill('');
{
  let first = true;
  for await (const line of lines('consolidated_cell_types.csv.gz')) {
    if (first) { first = false; continue; }
    const c = line.split(',');
    const i = idx.get(c[0]);
    if (i !== undefined) type[i] = c[1] || '';
  }
}

// --- connections, summed per ordered pair ----------------------------------------------
let cap = 1 << 24, m = 0;
let pre = new Uint32Array(cap), post = new Uint32Array(cap), syn = new Uint32Array(cap);
{
  let first = true;
  for await (const line of lines('connections.csv.gz')) {
    if (first) { first = false; continue; }
    const c = line.split(',');
    const a = idx.get(c[0]), b = idx.get(c[1]);
    if (a === undefined || b === undefined) continue;
    if (m === cap) {
      cap *= 2;
      const grow = (arr) => { const x = new Uint32Array(cap); x.set(arr); return x; };
      pre = grow(pre); post = grow(post); syn = grow(syn);
    }
    pre[m] = a; post[m] = b; syn[m] = +c[3]; m++;
  }
}
const start = new Uint32Array(n + 1);
for (let k = 0; k < m; k++) start[pre[k] + 1]++;
for (let i = 0; i < n; i++) start[i + 1] += start[i];
const order = new Uint32Array(m);
{
  const fill = start.slice(0, n);
  for (let k = 0; k < m; k++) order[fill[pre[k]]++] = k;
}
const rs = new Uint32Array(n + 1);
const colList = [], wList = [];
{
  const tmp = new Map();
  for (let i = 0; i < n; i++) {
    tmp.clear();
    for (let q = start[i]; q < start[i + 1]; q++) {
      const k = order[q];
      tmp.set(post[k], (tmp.get(post[k]) || 0) + syn[k]);
    }
    for (const [j, s] of tmp) if (s >= MIN_PAIR) { colList.push(j); wList.push(s); }
    rs[i + 1] = colList.length;
  }
}
const col = Uint32Array.from(colList), W = Uint32Array.from(wList);
console.log(`neurons ${n}, rows ${m}, connections >= ${MIN_PAIR} synapses: ${col.length}`);

const select = (f) => { const a = []; for (let i = 0; i < n; i++) if (f(i)) a.push(i); return a; };
const SOURCES = {
  bitter: { label: 'Bitter taste neurons', cells: select((i) => cls[i].cls === 'gustatory' && cls[i].subClass === 'bitter') },
  hot: { label: 'Hot cells (thermosensory, heating)', cells: select((i) => cls[i].cls === 'thermosensory' && cls[i].subClass === 'heating') },
  cold: { label: 'Cold cells (thermosensory, cold)', cells: select((i) => cls[i].cls === 'thermosensory' && cls[i].subClass === 'cold') },
  sugar: { label: 'Sugar/water taste neurons', cells: select((i) => cls[i].cls === 'gustatory' && cls[i].subClass === 'sugar/water') },
  joF: { label: 'JO-F antennal grooming mechanosensors', cells: select((i) => cls[i].cls === 'mechanosensory' && cls[i].subClass === 'grooming') },
};
const REGIONS = {
  mushroomBody: { label: 'Mushroom body (KC, MBON, PAM/PPL, APL, DPM)', cells: select((i) => /^(KC|MBON|PAM|PPL|APL|DPM)/.test(type[i])) },
  centralComplex: { label: 'Central complex (EPG, PEN, PFN, FB, ER, ...)', cells: select((i) => /^(EPG|PEG|PEN|PFN|PFL|PFR|PFG|hDelta|vDelta|FB\d|ER\d|ExR|EL)/.test(type[i])) },
  lateralHorn: { label: 'Lateral horn (LH*)', cells: select((i) => /^LH/.test(type[i])) },
};

function bfs(seed, maxHops = 6) {
  const d = new Int8Array(n).fill(-1);
  const via = new Int32Array(n).fill(-1);      // first-hop cell on a shortest route
  let frontier = seed.slice();
  for (const s of seed) d[s] = 0;
  for (let h = 1; h <= maxHops && frontier.length; h++) {
    const next = [];
    for (const i of frontier) {
      for (let q = rs[i]; q < rs[i + 1]; q++) {
        const j = col[q];
        if (d[j] >= 0) continue;
        d[j] = h;
        via[j] = h === 1 ? j : via[i];
        next.push(j);
      }
    }
    frontier = next;
  }
  return { d, via };
}

const results = {};
for (const [key, src] of Object.entries(SOURCES)) {
  const { d, via } = bfs(src.cells);
  const regions = {};
  for (const [rk, region] of Object.entries(REGIONS)) {
    let minHops = null;
    for (const j of region.cells) if (d[j] > 0 && (minHops === null || d[j] < minHops)) minHops = d[j];
    const within = (h) => region.cells.filter((j) => d[j] > 0 && d[j] <= h).length;
    const firstHopTypes = new Map();
    for (const j of region.cells) {
      if (d[j] !== 2) continue;
      const t = type[via[j]] || cls[via[j]].superClass;
      firstHopTypes.set(t, (firstHopTypes.get(t) || 0) + 1);
    }
    regions[rk] = {
      label: region.label, regionCells: region.cells.length, minSynapses: minHops,
      within2: within(2), within3: within(3),
      twoSynapseRoutesVia: [...firstHopTypes].sort((a, b) => b[1] - a[1]).slice(0, 6).map(([t, c]) => ({ type: t, regionCellsReached: c })),
    };
  }
  results[key] = { label: src.label, cells: src.cells.length, regions };
  console.log(key, JSON.stringify(Object.fromEntries(Object.entries(regions).map(([k, v]) => [k, [v.minSynapses, v.within2, v.within3]]))));
}

const inputs = {};
for (const f of ['classification.csv.gz', 'consolidated_cell_types.csv.gz', 'connections.csv.gz']) inputs[f] = await sha256File(path.join(RAW, f));
fs.writeFileSync(path.join(OUT, 'sentience_pathways.json'), JSON.stringify({
  source: 'FlyWire Codex FAFB v783, complete connectome (classification, consolidated cell types, unthresholded connections summed per pair)',
  generatedBy: 'etl_pathways.mjs',
  inputSHA256: inputs,
  threshold: `a connection counts when a pair shares >= ${MIN_PAIR} synapses`,
  note: 'Measured anatomy of the real fly brain, not of the simulated subset. Reaching a region says a route exists, not that it is used, or used for anything like feeling.',
  sources: results,
}, null, 1));
console.log('sentience_pathways.json written');
