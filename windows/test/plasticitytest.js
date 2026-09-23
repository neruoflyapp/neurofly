// plasticitytest.js -- the optional learning hypothesis must be bounded,
// deterministic and completely absent from fixed-connectome runs.

import { loadBrainData } from '../src/data.js';
import { LIFSim } from '../src/sim.js';
import { plasticityChangesCSV } from '../src/plasticity-export.js';

let failures = 0;
function check(name, fn) {
  const [ok, detail] = fn();
  if (!ok) failures++;
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}: ${detail}`);
}

const data = loadBrainData();
if (!data) { process.stderr.write('no data/ -- run etl.py first\n'); process.exit(1); }

function firstEligible(sim) {
  for (let pre = 0; pre < sim.n; pre++) {
    for (let slot = sim.rowStart[pre]; slot < sim.rowStart[pre + 1]; slot++) {
      if (sim.plasticEligible?.[slot]) return { pre, post: sim.colIdx[slot], slot };
    }
  }
  return null;
}

function forceNextSpike(sim, neuron) {
  // Membrane state decays before thresholding inside a 1-ms step.
  sim.v[neuron] = sim.threshold / sim.decay + 0.01;
}

function isolatedPair(plasticity = null) {
  const circuit = {
    neurons: [
      { id: 'pre', role: 'lc4', type: 'LC4', side: 'left', pos: [0, 0, 0] },
      { id: 'post', role: 'gf', type: 'DNp01', side: 'left', pos: [1, 0, 0] },
    ],
    edges: [[0, 1, 100, 0]],
  };
  const sim = new LIFSim(circuit, null, null, { seed: 1, plasticity });
  sim.activityScale = 0;
  return sim;
}

check('saturated Float32 synapses report only actual weight changes', () => {
  const results = [];
  for (const direction of [1, -1]) {
    for (const maxRelativeChange of [0.1, 0.25]) {
      const sim = isolatedPair({ enabled: true, learningRate: 0.05, maxRelativeChange });
      for (let i = 0; i < 30; i++) sim._adjustPlasticWeight(0, direction);
      const before = sim.plasticitySummary(), weight = sim.w[0];
      for (let i = 0; i < 10; i++) sim._adjustPlasticWeight(0, direction);
      const after = sim.plasticitySummary();
      results.push(weight === sim.w[0] && before.updates === after.updates
        && before.meanAbsRelativeChange === after.meanAbsRelativeChange
        && (direction > 0 ? after.depressions === 0 : after.potentiations === 0));
    }
  }
  return [results.every(Boolean), 'positive and negative saturation: no phantom updates or reversed LTP/LTD counts'];
});

check('one-ms immediate and zero-delay pulses each deliver one neural step', () => {
  const outcomes = [];
  for (const delay of [null, 0, 1]) {
    const sim = isolatedPair();
    const queued = delay === null ? sim.stimulate([0], 1.25, 1)
      : sim.scheduleStimulate([0], 1.25, delay, 1);
    sim.step(1);
    outcomes.push(queued && sim.totalSpikes === 1);
    sim.step(1);
    outcomes.push(sim.activeStims.length === 0 && sim.totalSpikes === 1);
  }
  return [outcomes.every(Boolean), 'immediate, zero-delay and one-ms-delay pulses spike once and expire'];
});

check('pulse duration and expiration are independent of step batching', () => {
  const a = isolatedPair(), b = isolatedPair();
  for (const sim of [a, b]) sim.scheduleStimulate([0], 0.1, 2, 3);
  a.step(6);
  for (const ms of [1, 2, 3]) b.step(ms);
  const expected = 0.1 * (1 + a.decay + a.decay ** 2) * a.decay ** 2;
  const same = a.v.every((value, i) => value === b.v[i]);
  return [same && a.activeStims.length === 0 && b.activeStims.length === 0
    && Math.abs(a.v[0] - expected) < 1e-7,
  `three driven steps, then two decay steps: v=${a.v[0].toPrecision(8)}, batching identical=${same}`];
});

check('invalid stimulus requests cannot poison or partially change the queue', () => {
  const sim = isolatedPair();
  const invalid = [
    [[0], NaN, 0, 1], [[0], Infinity, 0, 1], [[0], 1e100, 0, 1],
    [[0, 2], 1, 0, 1], [[-1], 1, 0, 1], [[0.5], 1, 0, 1],
    [[0], 1, -1, 1], [[0], 1, 0.5, 1], [[0], 1, NaN, 1],
    [[0], 1, 0, 0], [[0], 1, 0, -1], [[0], 1, 0, 0.5],
    [[0], 1, 0, Infinity], [[], 1, 0, 1],
  ];
  const rejected = invalid.every((args) => sim.scheduleStimulate(...args) === false);
  const rejectedImmediate = sim.stimulate([0], NaN, 1) === false
    && sim.stimulate([0, 2], 1, 1) === false && sim.stimulate([0], 1, Infinity) === false;
  sim.step(2);
  return [rejected && rejectedImmediate && sim.scheduledStims.length === 0
    && sim.pendingStims.length === 0 && sim.v.every(Number.isFinite),
  'bad strengths, indices, fractional/negative/overflow times rejected atomically'];
});

check('queued target selections are snapshots of the requested neurons', () => {
  const sim = isolatedPair();
  const targets = [0];
  sim.scheduleStimulate(targets, 1.25, 1, 1);
  targets[0] = 1;
  sim.step(1);
  return [sim.rateLoom > 0 && sim.rateGF === 0, 'changing the caller array does not redirect a scheduled pulse'];
});

check('full stimulus queues reject additions without dropping accepted events', () => {
  const sim = isolatedPair();
  let accepted = 0;
  for (let i = 0; i < 512; i++) accepted += sim.scheduleStimulate([0], 0.1, i + 2, 1) ? 1 : 0;
  const first = sim.scheduledStims[0], last = sim.scheduledStims.at(-1);
  const rejected = sim.scheduleStimulate([1], 1.25, 1, 1) === false;
  for (let i = 0; i < 8; i++) sim.stimulate([0], 0.1, 1);
  const immediateFirst = sim.pendingStims[0];
  const immediateRejected = sim.stimulate([1], 1.25, 1) === false;
  return [accepted === 512 && rejected && sim.scheduledStims.length === 512
    && sim.scheduledStims[0] === first && sim.scheduledStims.at(-1) === last
    && immediateRejected && sim.pendingStims.length === 8 && sim.pendingStims[0] === immediateFirst,
  '512 scheduled / 8 immediate requests retained; overflow is reported'];
});

check('the opt-in learning experiment restricts plasticity to a named anatomical subset', () => {
  const sim = new LIFSim(data.circuit, null, null, {
    seed: 17,
    plasticity: { enabled: true },
  });
  const p = sim.plasticitySummary();
  return [p.enabled && p.eligibleEdges > 0 && p.eligibleEdges < data.circuit.edges.length,
    `${p.eligibleEdges} of ${data.circuit.edges.length} contacts are eligible; rule=${p.mechanism}`];
});

check('pre-before-post timing potentiates an eligible synapse and records the update', () => {
  const sim = new LIFSim(data.circuit, null, null, {
    seed: 23,
    plasticity: { enabled: true, learningRate: 0.02 },
  });
  const edge = firstEligible(sim);
  if (!edge) return [false, 'no eligible sensory-to-command contact found'];
  const before = sim.w[edge.slot];
  forceNextSpike(sim, edge.pre);
  sim.step(1);
  forceNextSpike(sim, edge.post);
  sim.step(1);
  const p = sim.plasticitySummary();
  const changes = sim.plasticityChanges();
  const changed = changes.find((change) => change.pre === edge.pre && change.post === edge.post);
  return [sim.w[edge.slot] > before && p.potentiations > 0 && p.updates > 0
    && changed?.updateCount > 0 && changed.currentWeight === sim.w[edge.slot],
  `weight ${before.toPrecision(5)} -> ${sim.w[edge.slot].toPrecision(5)}, ${p.potentiations} LTP update(s)`];
});

check('bounded plasticity never exceeds its declared relative ceiling', () => {
  const sim = new LIFSim(data.circuit, null, null, {
    seed: 29,
    plasticity: { enabled: true, learningRate: 0.05, maxRelativeChange: 0.1 },
  });
  const edge = firstEligible(sim);
  if (!edge) return [false, 'no eligible sensory-to-command contact found'];
  const base = sim.plasticBaseW[edge.slot];
  for (let i = 0; i < 20; i++) {
    forceNextSpike(sim, edge.pre);
    sim.step(1);
    forceNextSpike(sim, edge.post);
    sim.step(1);
  }
  const ceiling = base * 1.1 + 1e-8;
  return [sim.w[edge.slot] <= ceiling && sim.w[edge.slot] >= base * 0.9 - 1e-8,
    `weight=${sim.w[edge.slot].toPrecision(5)}, allowed [${(base * 0.9).toPrecision(5)}, ${ceiling.toPrecision(5)}]`];
});

check('the default fixed-connectome model leaves learning disabled', () => {
  const fixed = new LIFSim(data.circuit, null, null, { seed: 31 });
  const experimental = new LIFSim(data.circuit, null, null, {
    seed: 31,
    plasticity: { enabled: true },
  });
  const edge = firstEligible(experimental);
  if (!edge) return [false, 'no eligible sensory-to-command contact found'];
  const before = fixed.w[edge.slot];
  for (let i = 0; i < 5; i++) fixed.step(1);
  const p = fixed.plasticitySummary();
  return [!p.enabled && fixed.w[edge.slot] === before,
    `enabled=${p.enabled}, sampled fixed weight unchanged=${fixed.w[edge.slot] === before}`];
});

check('scheduled stimulation follows neural time, not display-frame time', () => {
  const sim = new LIFSim(data.circuit, null, null, { seed: 35 });
  const target = sim.loomLeft[0];
  const queued = sim.scheduleStimulate([target], 1.5, 3, 4);
  sim.step(2);
  const stillWaiting = sim.scheduledStims.length === 1 && sim.activeStims.length === 0;
  sim.step(1);
  const activeAtDueTime = sim.scheduledStims.length === 0 && sim.activeStims.length === 1;
  return [queued && stillWaiting && activeAtDueTime,
    `queued at 3 ms; waiting=${stillWaiting}, active at due time=${activeAtDueTime}`];
});

check('a scheduled pre-before-post protocol produces an auditable learning update', () => {
  const sim = new LIFSim(data.circuit, null, null, {
    seed: 36,
    plasticity: { enabled: true, learningRate: 0.02 },
  });
  const edge = firstEligible(sim);
  if (!edge) return [false, 'no eligible sensory-to-command contact found'];
  const before = sim.w[edge.slot];
  sim.scheduleStimulate([edge.pre], 1.5, 1, 3);
  sim.scheduleStimulate([edge.post], 1.5, 9, 3);
  sim.step(12);
  const changed = sim.plasticityChanges().find((change) => change.pre === edge.pre && change.post === edge.post);
  const ok = sim.w[edge.slot] > before && changed?.relativeChange > 0 && changed.updateCount > 0;
  return [ok, `scheduled weight ${before.toPrecision(5)} -> ${sim.w[edge.slot].toPrecision(5)}`];
});

check('the reverse scheduled protocol provides a depression control', () => {
  const sim = new LIFSim(data.circuit, null, null, {
    seed: 38,
    plasticity: { enabled: true, learningRate: 0.02 },
  });
  const edge = firstEligible(sim);
  if (!edge) return [false, 'no eligible sensory-to-command contact found'];
  const before = sim.w[edge.slot];
  sim.scheduleStimulate([edge.post], 1.5, 1, 3);
  sim.scheduleStimulate([edge.pre], 1.5, 9, 3);
  sim.step(12);
  const changed = sim.plasticityChanges().find((change) => change.pre === edge.pre && change.post === edge.post);
  const ok = sim.w[edge.slot] < before && changed?.relativeChange < 0 && changed.updateCount > 0;
  return [ok, `reverse scheduled weight ${before.toPrecision(5)} -> ${sim.w[edge.slot].toPrecision(5)}`];
});

check('changed contacts export with trial provenance instead of a nameless weight list', () => {
  const sim = new LIFSim(data.circuit, null, null, {
    seed: 37,
    plasticity: { enabled: true, learningRate: 0.02 },
  });
  const edge = firstEligible(sim);
  if (!edge) return [false, 'no eligible sensory-to-command contact found'];
  forceNextSpike(sim, edge.pre);
  sim.step(1);
  forceNextSpike(sim, edge.post);
  sim.step(1);
  const csv = plasticityChangesCSV({
    modelVersion: '1.2.0', neuralSeed: sim.neuralSeed, brainFingerprint: 'feedface',
    mechanism: sim.plasticitySummary().mechanism,
    protocol: { name: 'visual-to-flight-alarm', pairOrder: 'pre-before-post', trials: 16, delayMs: 8, intervalMs: 140 },
    changes: sim.plasticityChanges(),
  });
  const [header, row] = csv.trim().split('\n');
  const ok = header.includes('initial_weight') && header.includes('update_count') && header.includes('protocol_pair_order')
    && row.includes('1.2.0') && row.includes('feedface') && row.includes('bounded-pair-stdp')
    && row.includes('visual-to-flight-alarm') && row.includes('pre-before-post');
  return [ok, `${sim.plasticityChanges().length} changed contact(s) exported with model and seed`];
});

console.log(failures === 0 ? 'ALL PLASTICITY TESTS PASS' : `${failures} PLASTICITY TESTS FAILED`);
process.exit(failures === 0 ? 0 : 1);
