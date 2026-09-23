import assert from 'node:assert/strict';
import { SPECIMENS } from '../src/specimen.js';
import { indexSpecimen, findSpecimenPath } from '../src/specimen-graph.js';
import { createSpecimenService } from '../src/specimen-service.js';
import { createSpecimenStore } from '../src/specimen-data.js';
import { nextSimulationWake } from '../src/worker-schedule.js';
import { ClosedLoop } from '../src/closed-loop.js';
import { SimulationClock } from '../src/sim.js';

const bundle = { profile: SPECIMENS['banc-v888'], sha256: 'fixture', summary: { edgeThreshold: 5 },
  neurons: Array.from({ length: 5 }, (_, i) => ({ id: String(720575940622838154n + BigInt(i)), type: 'test', specimen: 'BANC' })),
  edges: [[0, 1, 5], [1, 2, 8], [2, 0, 9], [0, 3, 7], [3, 2, 10]] };
const index = indexSpecimen(bundle), from = bundle.neurons[0].id, to = bundle.neurons[2].id;
const path = findSpecimenPath(bundle, index, { from, to });
assert.equal(path.hops, 2);
assert.deepEqual(path.edges.map(e => e.contacts), [7, 10]);
assert.equal(findSpecimenPath(bundle, index, { from, to, maxHops: 1 }).found, false);
assert.equal(findSpecimenPath(bundle, index, { from, to, minContacts: 8 }).found, false);
assert.equal(findSpecimenPath(bundle, index, { from, to: from }).hops, 0);
assert.equal(findSpecimenPath(bundle, index, { from, to: bundle.neurons[4].id }).found, false);
assert.throws(() => findSpecimenPath(bundle, index, { from: Number(from), to }));
assert.throws(() => findSpecimenPath(bundle, index, { from, to, maxHops: 1000 }));
assert.throws(() => findSpecimenPath(bundle, index, { from, to, minContacts: 0 }));
assert.equal(nextSimulationWake({ paused: true }), 50);
assert.equal(nextSimulationWake({ accumulator: 0, speed: 1, computeMs: 0 }), 1000 / 120);
assert.equal(nextSimulationWake({ accumulator: 0, speed: 1, computeMs: 20 }), 1);
// The old renderer clipped this to .25 s and exported dropped time as zero.
const loop = { paused: false, clock: new SimulationClock(), speed: 1,
  perf: { wall: 0, compute: 0, dropped: 0 }, totalDroppedSimulationSeconds: 0, tick() {} };
assert.equal(ClosedLoop.prototype.advance.call(loop, 2), 12);
assert.equal(loop.perf.wall, 2);
assert.equal(loop.totalDroppedSimulationSeconds, 1.9);
assert.equal(loop.perf.dropped, 1.9);
loop.paused = true;
assert.equal(ClosedLoop.prototype.advance.call(loop, 10), 0);
assert.equal(loop.perf.wall, 2, 'pause is not catch-up or overload');

const store = createSpecimenStore(), service = createSpecimenService({ idleMs: 80 });
try {
  const profiles = (await service.catalog()).profiles.filter(p => p.status === 'anatomy-ready');
  for (const p of profiles) {
    let heartbeats = 0;
    const timer = setInterval(() => heartbeats++, 10);
    const overview = await service.load(p.id);
    clearInterval(timer);
    assert.ok(heartbeats > 0, 'main event loop remains responsive during real graph loading');
    assert.equal(overview.edges, undefined, 'no huge edge-object graph crosses into UI');
    assert.ok(overview.neurons.every(n => !n.annotations));
    const raw = store.load(p.id), edge = raw.edges.find(e => e[0] !== e[1]);
    assert.equal(overview.edgeCount, raw.edges.length);
    const cell = await service.cell(p.id, raw.neurons[edge[0]].id, overview.sha256);
    assert.deepEqual(cell.neuron, raw.neurons[edge[0]]);
    assert.ok(cell.outgoing.some(e => e.every((v, i) => v === edge[i])));
    const found = await service.path(p.id, { from: raw.neurons[edge[0]].id, to: raw.neurons[edge[1]].id }, overview.sha256);
    assert.equal(found.hops, 1);
    assert.equal(found.edges[0].contacts, edge[2]);
    await assert.rejects(service.cell(p.id, raw.neurons[0].id, 'stale'), /changed/);
    console.log(`PASS ${p.id}: responsive worker (${heartbeats} heartbeats), compact overview, exact cell and directed path`);
  }
  await assert.rejects(service.load('../../private'), /Unknown/);
  const maleMorph = await service.morphology('10001', 'malecns-v1');
  if (maleMorph) {
    assert.equal(maleMorph.specimen, 'MaleCNS');
    assert.equal(maleMorph.sourceNmPerUnit, 8);
    assert.equal(maleMorph.units, 'nm');
    assert.equal(await service.morphology('10001', 'fafb-v783'), null, 'no skeleton reused across sex/specimen');
  }
  await new Promise(resolve => setTimeout(resolve, 150));
  assert.equal((await service.catalog()).profiles.length, 3, 'worker reopens after idle eviction');
} finally { await service.close(); }
await assert.rejects(service.catalog(), /closed/);
console.log('specimenservicetest: PASS — bounded asynchronous service, native paths, stale-data rejection, clock accounting');
