// Read-only publisher discovery, saved for reproducible acquisition planning.
// No access restrictions bypassed and no downloaded scripts executed.
import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
const root = process.argv[2];
if (!root || !path.isAbsolute(root) || path.resolve(root) === path.parse(root).root) throw new Error('Provide an absolute archive subdirectory');
await fs.mkdir(root, { recursive: true });
const report = { checkedAt: new Date().toISOString(), worldwideComplete: false, speciesScope: 'Drosophila melanogaster', sources: [] };
async function get(url) {
  const r = await fetch(url, { signal: AbortSignal.timeout(60000) });
  if (!r.ok) throw new Error(`HTTP ${r.status}`);
  return r.json();
}
async function audit(id, source, fn) {
  try { const data = await fn(); report.sources.push({ id, source, status: 'catalogued', ...data }); console.log(`CATALOGUED ${id}: ${data.files?.length ?? 0} files`); }
  catch (e) { report.sources.push({ id, source, status: 'access-or-format-error', error: e.message }); console.log(`UNRESOLVED ${id}: ${e.message}`); }
  await fs.writeFile(path.join(root, 'public-source-audit.json'), JSON.stringify(report, null, 2));
  const summary = { ...report, sources: report.sources.map(({ files, ...s }) => ({ ...s, fileCount: files?.length ?? null, totalBytes: files?.reduce((n, f) => n + (f.bytes || 0), 0) ?? null })) };
  const target = fileURLToPath(new URL('../assets/connectomes/public-source-summary.json', import.meta.url));
  await fs.writeFile(target + '.partial', JSON.stringify(summary, null, 2));
  await fs.rename(target + '.partial', target);
}
await audit('fafb-v783-synapse-sites', 'https://zenodo.org/records/10676866', async () => {
  const j = await get('https://zenodo.org/api/records/10676866');
  return { specimen: 'FAFB', sex: 'female', stage: 'adult', detector: 'Buhmann; not additive with Princeton detections',
    license: j.metadata.license, files: j.files.map(f => ({ name: f.key, bytes: f.size, checksum: f.checksum, url: f.links.self, status: 'not-downloaded' })) };
});
await audit('manc-flat-export', 'https://www.janelia.org/project-team/flyem/manc-connectome', async () => {
  let token = '', files = [];
  do {
    const q = new URLSearchParams({ prefix: 'v1.0/', maxResults: '1000', fields: 'nextPageToken,items(name,size,md5Hash,generation)', ...(token ? { pageToken: token } : {}) });
    const j = await get('https://storage.googleapis.com/storage/v1/b/flyem-manc-exports/o?' + q);
    files.push(...(j.items || []).map(f => ({ name: f.name, bytes: Number(f.size), md5: Buffer.from(f.md5Hash || '', 'base64').toString('hex'), generation: f.generation, status: 'not-downloaded' })));
    token = j.nextPageToken;
    if (files.length > 20000) throw new Error('Unexpected export size; review pagination');
  } while (token);
  return { specimen: 'MANC', sex: 'male', stage: 'adult', license: 'CC-BY-4.0', releaseWarning: 'Official linked bulk bucket uses v1.0 paths; do not relabel these as neuPrint v1.2.1.', files };
});
await audit('fanc-public-2021', 'https://github.com/htem/GridTape_VNC_paper', async () => {
  const commit = await get('https://api.github.com/repos/htem/GridTape_VNC_paper/commits/main');
  const j = await get(`https://api.github.com/repos/htem/GridTape_VNC_paper/git/trees/${commit.sha}?recursive=1`);
  if (j.truncated) throw new Error('GitHub tree truncated');
  return { specimen: 'FANC', sex: 'female', stage: 'adult', commit: commit.sha,
    warning: 'Public historical release; not latest access-controlled reconstruction. Native and registered coordinates remain distinct.',
    files: j.tree.filter(f => f.type === 'blob' && (f.path.startsWith('neuron_reconstructions/') || /LICENSE/.test(f.path))).map(f => ({ name: f.path, bytes: f.size, gitBlobSHA1: f.sha, status: 'not-downloaded' })) };
});
await audit('flybody-reference', 'https://doi.org/10.25378/janelia.25309105', async () => {
  const j = await get('https://api.figshare.com/v2/articles/25309105');
  return { specimen: 'independent body / behavioural reference', sex: 'verify-per-file', stage: 'adult', license: j.license,
    files: j.files.map(f => ({ name: f.name, bytes: f.size, md5: f.computed_md5, url: f.download_url, status: 'not-downloaded' })) };
});
await audit('malecns-native-skeletons', 'https://male-cns.janelia.org/download/', async () => {
  let token = '', files = [];
  do {
    const q = new URLSearchParams({ prefix: 'v1.0/segmentation/skeletons-malecns/skeletons-swc/', maxResults: '1000', fields: 'nextPageToken,items(name,size,md5Hash,generation)', ...(token ? { pageToken: token } : {}) });
    const j = await get('https://storage.googleapis.com/storage/v1/b/flyem-male-cns/o?' + q);
    files.push(...(j.items || []).map(f => ({ name: f.name, bytes: Number(f.size), md5: Buffer.from(f.md5Hash || '', 'base64').toString('hex'), generation: f.generation })));
    token = j.nextPageToken;
    if (files.length % 20000 === 0) console.log(`Skeleton inventory: ${files.length} objects`);
    if (files.length > 500000) throw new Error('Unexpected skeleton collection size; review');
  } while (token);
  return { specimen: 'MaleCNS', sex: 'male', stage: 'adult', license: 'CC-BY-4.0', sourceNmPerUnit: 8,
    downloadedStatus: 'See male-skeleton-import-report.json; catalogued objects are not downloaded objects', totalBytes: files.reduce((s, f) => s + f.bytes, 0), files };
});
console.log('DONE source audit; catalogue is not integration');
