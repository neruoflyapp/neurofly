// Publish only small discovery counters to the app, not 200k object records.
import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
const root = process.argv[2];
if (!root || !path.isAbsolute(root)) throw new Error('Absolute archive path required');
const report = JSON.parse(await fs.readFile(path.join(root, 'public-source-audit.json')));
const summary = { ...report, sources: report.sources.map(({ files, ...s }) => ({ ...s, fileCount: files?.length ?? null, totalBytes: files?.reduce((n, f) => n + (f.bytes || 0), 0) ?? null })) };
const target = fileURLToPath(new URL('../assets/connectomes/public-source-summary.json', import.meta.url));
await fs.writeFile(target + '.partial', JSON.stringify(summary, null, 2));
await fs.rename(target + '.partial', target);
console.log(`Published ${summary.sources.length} source summaries; discovery is not download or integration`);
