// Native MaleCNS skeletons, fixed official release, individually lazy-loaded.
// node tools/import-male-morphology.mjs <archive-dir> [core|subset]
import fs from 'node:fs/promises';
import path from 'node:path';
import { createHash } from 'node:crypto';
import { fileURLToPath } from 'node:url';
import { parseSWC } from '../src/swc.js';
const rawRoot = process.argv[2], mode = process.argv[3] || 'core';
if (!rawRoot || !path.isAbsolute(rawRoot) || !['core', 'subset'].includes(mode)) throw new Error('Provide absolute data root and core or subset');
const assets = fileURLToPath(new URL('../assets/connectomes/', import.meta.url));
const data = JSON.parse(await fs.readFile(path.join(assets, 'malecns-v1.json')));
const core = new Set(['DNp01', 'DNa01', 'DNa02', 'DNp09', 'MDN', 'DNg11', 'DNg12', 'DNp02', 'DNp04', 'DNp11']);
const chosen = data.neurons.filter(n => mode === 'subset' || core.has(n.type) || String(n.aliases).split(',').some(a => core.has(a)));
const out = path.join(assets, 'malecns-morphology'), rawDir = path.join(rawRoot, 'malecns-v1', 'skeletons-swc');
await fs.mkdir(out, { recursive: true }); await fs.mkdir(rawDir, { recursive: true });
const sha = b => createHash('sha256').update(b).digest('hex');
async function write(file, value) { const raw = JSON.stringify(value); await fs.writeFile(file + '.partial', raw); await fs.rename(file + '.partial', file); return sha(raw); }
let index;
try { index = JSON.parse(await fs.readFile(path.join(assets, 'malecns-morphology.json'))); }
catch (e) { if (e.code !== 'ENOENT') throw e; index = { schema: 2, specimen: 'MaleCNS', neurons: {}, summary: {} }; }
const report = { source: 'https://male-cns.janelia.org/download/', selected: chosen.length, verified: [], failed: [] };
for (const n of chosen) {
  try {
    if (!/^\d+$/.test(n.id)) throw new Error('Invalid native body ID');
    const object = `v1.0/segmentation/skeletons-malecns/skeletons-swc/${n.id}.swc`;
    const mr = await fetch('https://storage.googleapis.com/storage/v1/b/flyem-male-cns/o/' + encodeURIComponent(object), { signal: AbortSignal.timeout(30000) });
    if (!mr.ok) throw new Error(`Skeleton metadata HTTP ${mr.status}`);
    const meta = await mr.json();
    if (Number(meta.size) > 30 * 1024 ** 2) throw new Error('Skeleton too large for bounded importer');
    const file = path.join(rawDir, `${n.id}.swc`), url = `https://storage.googleapis.com/flyem-male-cns/${object}?generation=${meta.generation}`;
    let raw;
    try { raw = await fs.readFile(file); }
    catch (e) { if (e.code !== 'ENOENT') throw e; const r = await fetch(url, { signal: AbortSignal.timeout(60000) }); if (!r.ok) throw new Error(`Skeleton HTTP ${r.status}`); raw = Buffer.from(await r.arrayBuffer()); }
    if (raw.length !== Number(meta.size) || createHash('md5').update(raw).digest('base64') !== meta.md5Hash) throw new Error('Skeleton publisher checksum mismatch');
    const neuron = { ...parseSWC(raw.toString('utf8'), { id: n.id, specimen: 'MaleCNS', nmPerUnit: 8 }), sha256: sha(raw),
      resolution: 'Native centreline SWC', source: url, license: 'CC-BY-4.0', coordinateSpace: 'MaleCNS native EM',
      sourceGeneration: meta.generation, publisherMD5: Buffer.from(meta.md5Hash, 'base64').toString('hex') };
    await fs.writeFile(file + '.partial', raw); await fs.rename(file + '.partial', file);
    index.neurons[n.id] = { sha256: await write(path.join(out, `${n.id}.json`), neuron) };
    report.verified.push({ id: n.id, bytes: raw.length, sha256: neuron.sha256, publisherMD5: neuron.publisherMD5, url });
    console.log(`OK MaleCNS ${n.id} ${neuron.totalSegments} segments`);
  } catch (e) { report.failed.push({ id: n.id, error: e.message }); console.error(`FAILED ${n.id}: ${e.message}`); }
}
index.summary = { importedSkeletons: Object.keys(index.neurons).length, native: true, units: 'nm', sourceNmPerUnit: 8,
  source: report.source, coverage: 'Selected neurons only, not all published MaleCNS skeletons' };
const digest = await write(path.join(assets, 'malecns-morphology.json'), index);
const catalogFile = path.join(assets, 'catalog.json'), catalog = JSON.parse(await fs.readFile(catalogFile));
catalog.morphologies ||= {}; catalog.morphologies['malecns-v1'] = { sha256: digest, ...index.summary };
await write(catalogFile, catalog);
await write(path.join(rawRoot, 'male-skeleton-import-report.json'), report);
console.log(`DONE ${report.verified.length} verified / ${report.failed.length} failed`);
if (report.failed.length) process.exitCode = 1;
