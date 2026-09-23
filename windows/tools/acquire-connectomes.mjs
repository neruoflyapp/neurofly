// Reproducible acquisition. Source files are never modified or deleted.
// node tools/acquire-connectomes.mjs [online|local|all]
import fs from 'node:fs';
import fsp from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createHash } from 'node:crypto';
import { Transform, Writable, Readable } from 'node:stream';
import { pipeline } from 'node:stream/promises';
import { createGunzip } from 'node:zlib';

const ROOT = fileURLToPath(new URL('../../datasets/', import.meta.url));
const DOWNLOADS = path.join(process.env.USERPROFILE, 'Downloads');
const MODE = process.argv[2] || 'all';
if (!['online', 'local', 'all'].includes(MODE)) throw new Error('Choose online, local or all');
await fsp.mkdir(ROOT, { recursive: true });
const inventory = { schema: 1, checkedAt: new Date().toISOString(), files: [], notes: [
  'Alternative synapse detectors and release versions are not additive.',
  'FAFB skeletons and annotations belong to the female FAFB specimen, not BANC or MaleCNS.',
  'Raw measurements and predictions do not establish sentience or determine complete physiology.',
] };
async function save() {
  const file = path.join(ROOT, `inventory-${MODE}.json`);
  await fsp.writeFile(file + '.partial', JSON.stringify(inventory, null, 2));
  await fsp.rename(file + '.partial', file);
}
async function hashFile(file) {
  const sha = createHash('sha256'), md5 = createHash('md5');
  let bytes = 0;
  for await (const b of fs.createReadStream(file)) { sha.update(b); md5.update(b); bytes += b.length; }
  return { bytes, sha256: sha.digest('hex'), md5: md5.digest('hex') };
}
async function space(bytes) {
  const s = await fsp.statfs(ROOT);
  if (s.bavail * s.bsize < bytes + 12 * 1024 ** 3) throw new Error('Keep at least 12 GiB free; acquisition paused.');
}
async function acquire(item) {
  const target = path.join(ROOT, item.dataset, item.name);
  await fsp.mkdir(path.dirname(target), { recursive: true });
  try {
    let result;
    if (fs.existsSync(target)) {
      result = await hashFile(target);
      if ((item.bytes && result.bytes !== item.bytes) || (item.md5 && result.md5 !== item.md5)) throw new Error('Existing target does not match; preserved for manual review.');
    } else {
      console.log(`START ${item.dataset}/${item.name}`);
      let input;
      if (item.local) {
        item.bytes = (await fsp.stat(item.local)).size;
        input = fs.createReadStream(item.local);
      } else {
        const response = await fetch(item.url, { signal: AbortSignal.timeout(60 * 60 * 1000) });
        if (!response.ok) throw new Error(`HTTP ${response.status}`);
        input = Readable.fromWeb(response.body);
        const size = Number(response.headers.get('content-length'));
        if (!item.bytes && size) item.bytes = size;
        const gcs = response.headers.get('x-goog-hash')?.match(/md5=([^,]+)/)?.[1];
        if (gcs && !item.md5) item.md5 = Buffer.from(gcs, 'base64').toString('hex');
      }
      await space(item.bytes || 2 * 1024 ** 3);
      const sha = createHash('sha256'), md5 = createHash('md5');
      let bytes = 0, previous = 0;
      const digest = new Transform({ transform(b, _encoding, next) {
        sha.update(b); md5.update(b); bytes += b.length;
        if (bytes - previous > 512 * 1024 ** 2) { previous = bytes; console.log(`PROGRESS ${item.name} ${Math.round(bytes / 1024 ** 2)} MiB`); }
        next(null, b);
      } });
      // A partial file is never used by the app. Retrying replaces only our partial.
      await pipeline(input, digest, fs.createWriteStream(target + '.partial'));
      result = { bytes, sha256: sha.digest('hex'), md5: md5.digest('hex') };
      if ((item.bytes && bytes !== item.bytes) || (item.md5 && result.md5 !== item.md5)) throw new Error('Publisher size/checksum mismatch; partial retained, not imported.');
      if (item.name.endsWith('.gz')) {
        await pipeline(fs.createReadStream(target + '.partial'), createGunzip(), new Writable({ write(_b, _e, done) { done(); } }));
      }
      await fsp.rename(target + '.partial', target);
    }
    inventory.files.push({ ...item, ...result, status: 'verified', relativePath: path.relative(ROOT, target).replaceAll('\\', '/') });
    console.log(`OK ${item.name} ${result.bytes} bytes`);
  } catch (error) {
    inventory.files.push({ ...item, status: 'rejected', error: error.message });
    console.error(`REJECTED ${item.name}: ${error.message}`);
  }
  await save();
}

if (MODE !== 'local') {
  const response = await fetch('https://dataverse.harvard.edu/api/datasets/:persistentId/?persistentId=doi:10.7910/DVN/7WTH1N');
  if (!response.ok) throw new Error(`BANC metadata HTTP ${response.status}`);
  const metadata = await response.json();
  await fsp.mkdir(path.join(ROOT, 'banc-v888'), { recursive: true });
  await fsp.writeFile(path.join(ROOT, 'banc-v888', 'publisher-dataset-metadata.json'), JSON.stringify(metadata, null, 2));
  const names = ['banc_888_meta.feather', 'banc_888_edgelist_simple_v3.feather',
    'banc_888_neurotransmitter_prediction_v2.csv', 'banc_888_metrics.feather',
    'codex_annotations.parquet', 'cell_info.parquet', 'cell_representative_point.parquet',
    'peripheral_nerves.parquet', 'banc_supplemental_data.zip'];
  for (const name of names) {
    const entry = metadata.data.latestVersion.files.find(f => f.label === name);
    if (!entry) throw new Error(`Publisher removed ${name}; review release before continuing`);
    const f = entry.dataFile;
    await acquire({ dataset: 'banc-v888', sex: 'female', specimen: 'BANC', name,
      url: `https://dataverse.harvard.edu/api/access/datafile/${f.id}`, bytes: f.filesize,
      md5: f.checksum.type === 'MD5' ? f.checksum.value : undefined, license: 'CC-BY-4.0',
      source: 'https://doi.org/10.7910/DVN/7WTH1N' });
  }
  const base = 'https://storage.googleapis.com/flyem-male-cns/v1.0/connectome-data/flat-connectome/';
  for (const name of ['body-annotations-male-cns-v1.0-minconf-0.5.feather',
    'body-neurotransmitters-male-cns-v1.0.feather', 'connectome-weights-male-cns-v1.0-minconf-0.5.feather']) {
    await acquire({ dataset: 'malecns-v1', sex: 'male', specimen: 'MaleCNS', name, url: base + name,
      license: 'CC-BY-4.0', source: 'https://male-cns.janelia.org/download/' });
  }
}
if (MODE !== 'online') {
  // Deliberate scientific allowlist: never copy unrelated personal Downloads.
  const names = ['cell_stats.csv.gz', 'classification.csv.gz', 'column_assignment.csv.gz',
    'connections_buhmann_no_threshold.csv.gz', 'connections_princeton_no_threshold (1).csv.gz',
    'connections_princeton_no_threshold.csv.gz', 'connections_princeton.csv.gz',
    'connectivity_tags.csv.gz', 'consolidated_cell_types.csv.gz', 'coordinates.csv.gz',
    'labels.csv.gz', 'names.csv.gz', 'neurons.csv.gz', 'neuropil_synapse_table.csv.gz',
    'processed_labels.csv.gz', 'synapse_attachment_rates.csv.gz', 'visual_neuron_types.csv.gz',
    'sk_lod1_783_healed.zip'];
  for (const name of names) if (fs.existsSync(path.join(DOWNLOADS, name))) {
    await acquire({ dataset: 'fafb-v783', sex: 'female', specimen: 'FAFB', name,
      local: path.join(DOWNLOADS, name), license: 'CC-BY-NC-4.0',
      source: 'https://codex.flywire.ai/api/download',
      provenanceCaveat: 'Local filename/header identifies source; no publisher checksum supplied. SHA-256 identifies this copy.' });
  }
}
console.log(`DONE ${inventory.files.filter(f => f.status === 'verified').length} verified, ${inventory.files.filter(f => f.status !== 'verified').length} rejected`);
