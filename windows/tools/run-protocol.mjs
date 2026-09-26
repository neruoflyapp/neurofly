// Run one guided protocol from src/experiments.js on the command line, exactly
// as the Lab workspace runs it (same rig, same seed derivation), and print the
// result — for benchmarks in VALIDATION.md.
//   node tools/run-protocol.mjs <protocol-id> [seed] [trials]
import { loadBrainData } from '../src/data.js';
import { ClosedLoop } from '../src/closed-loop.js';
import { protocolById, seedStream } from '../src/experiments.js';

const [id, seedArg = '20260923', trialsArg] = process.argv.slice(2);
const protocol = protocolById(id);
if (!protocol) {
  console.error('usage: node tools/run-protocol.mjs <protocol-id> [seed] [trials]');
  process.exit(2);
}
const seed = Number(seedArg) >>> 0;
const data = loadBrainData();
const rig = new ClosedLoop({ data, bounds: { width: 1100, height: 700 }, seed, empty: true, spikeBus: false, instruments: false, hour: 12 });
rig.ambient = { typing: 0, sleepy: false, activity: 1 };
const p = { ...protocol.defaults, ...(trialsArg ? { trials: Number(trialsArg) } : {}) };
const started = Date.now();
const gen = protocol.run(rig, p, seedStream(seed ^ 0x5bd1e995));
let step = gen.next();
while (!step.done) step = gen.next();
const result = step.value;
const round = (v) => (typeof v === 'number' ? Math.round(v * 1000) / 1000 : v);
console.log(`${protocol.title} — seed ${seed}, ${p.trials} trials, ${Math.round(rig.simTime)} s simulated in ${Math.round((Date.now() - started) / 1000)} s`);
console.log('verdict:', JSON.stringify(result.verdict));
for (const s of result.stats) console.log(`  ${s.key}${s.params ? ' ' + JSON.stringify(s.params) : ''}: ${round(s.value)}`);
if (result.table) {
  console.table(result.table.map((r) => Object.fromEntries(Object.entries(r).map(([k, v]) => [k, round(v)]))));
}
