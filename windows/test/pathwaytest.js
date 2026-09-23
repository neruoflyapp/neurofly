// pathwaytest.js — the appended taste and antennal-grooming pathways, the
// virtual genetics that act on them, and the causal chain that explains what
// they make the body do.
//   node test/pathwaytest.js
//
// The two pathways (data/sensory_extension.json, etl_sensory_extension.mjs)
// are sparse relay chains cut out of the full FAFB connectome. They run at a
// per-synapse efficacy peak-matched to Shiu et al. 2024, with their lateral
// and backward edges at PATHWAY_RECURRENT_FRACTION (sim.js). These checks pin
// the behaviour that setting was chosen for: graded responses, and silence
// once the stimulus is gone — the truncated relay loops must not latch.

import './random.js';
import { loadBrainData } from '../src/data.js';
import { LIFSim, EXT } from '../src/sim.js';
import { ClosedLoop, dustDrive } from '../src/closed-loop.js';
import { explain, InputHistory } from '../src/causal.js';

const data = loadBrainData();
if (!data) { process.stderr.write('no data/ — run etl.py first\n'); process.exit(1); }

let failures = 0;
function check(name, fn) {
  const [ok, describe] = fn();
  if (!ok) failures++;
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}: ${describe}`);
}

const make = (seed) => new LIFSim(data.circuit, null, data.locomotor, { seed });

// Mean DNg12 rate while JO-F is driven, and the rate 2.5 s after it stops.
function dustResponse(seed, drive) {
  const s = make(seed);
  s.step(400);
  s.antennaDust = drive;
  let sum = 0, n = 0;
  for (let k = 0; k < 2000; k += 50) { s.step(50); if (k >= 300) { sum += s.rateDNg12; n++; } }
  s.antennaDust = 0;
  s.step(2500);
  return { during: sum / n, after: s.rateDNg12 };
}

check('the sensory extension is attached with both pathways', () => {
  const s = make(7);
  return [data.provenance.sensoryExtensionStatus === 'attached' && s.hasTaste && s.hasGroomingPathway,
    `status ${data.provenance.sensoryExtensionStatus}, taste ${s.hasTaste}, grooming ${s.hasGroomingPathway}`];
});

check('JO-F drive gives a graded DNg12 response and nothing at rest', () => {
  const r = [0, dustDrive(0.3), dustDrive(1)].map((d) => dustResponse(7, d).during);
  return [r[0] < 1 && r[1] < r[2] && r[2] > 15, `DNg12 ${r.map((x) => x.toFixed(1)).join(' < ')} Hz at dust 0 / 0.3 / 1`];
});

check('grooming releases: DNg12 falls silent once the dust is gone (no latch, 4 seeds)', () => {
  const after = [7, 8, 9, 10].map((seed) => dustResponse(seed, dustDrive(1)).after);
  return [after.every((x) => x < 2), `DNg12 2.5 s after full dust: ${after.map((x) => x.toFixed(1)).join(', ')} Hz`];
});

check('dust maps into the calibrated drive range, and none means none', () => {
  const top = dustDrive(1), none = dustDrive(0), trace = dustDrive(0.04);
  return [top <= 1.4 + 1e-9 && none === 0 && trace === 0, `dust load 1 -> drive ${top.toFixed(2)}, load 0 / 0.04 -> ${none} / ${trace}`];
});

// A monostable pathway returns to rest after any perturbation. The truncated
// relay loops used to be bistable: a strong enough push (in the live
// terrarium, an arousal burst) left DNg12 firing at ~28 Hz forever.
check('a hard kick to every relay of either pathway does not leave it running (no bistability)', () => {
  const relays = (s, code) => Int32Array.from([...Array(s.n).keys()].filter((i) => s.extCode[i] === code
    && (data.circuit.neurons[i].layer === 1 || data.circuit.neurons[i].layer === 2)));
  const after = [];
  for (const [code, rate] of [[EXT.GROOMING, 'rateDNg12'], [EXT.TASTE, 'rateProboscis']]) {
    for (const seed of [7, 8, 9]) {
      const s = make(seed);
      s.step(800);
      s.stimulate(relays(s, code), 1.2, 150);
      s.step(150 + 2500);
      after.push(s[rate]);
    }
  }
  return [after.every((x) => x < 2), `DNg12 / proboscis MNs 2.5 s after a 150 ms kick: ${after.map((x) => x.toFixed(1)).join(', ')} Hz`];
});

check('sugar extends the proboscis, bitter suppresses it, and both release', () => {
  const run = (sugar, bitter) => {
    const s = make(7);
    s.step(400);
    s.sugarTaste = sugar; s.bitterTaste = bitter;
    let sum = 0, n = 0;
    for (let k = 0; k < 1500; k += 50) { s.step(50); if (k >= 300) { sum += s.rateProboscis; n++; } }
    s.sugarTaste = 0; s.bitterTaste = 0; s.step(1000);
    return { during: sum / n, after: s.rateProboscis };
  };
  const sweet = run(1, 0), mixed = run(1, 1), none = run(0, 0);
  const ok = sweet.during > 40 && mixed.during < sweet.during * 0.5 && none.during < 1 && sweet.after < 2 && mixed.after < 2;
  return [ok, `proboscis MNs: sugar ${sweet.during.toFixed(0)} Hz, sugar+bitter ${mixed.during.toFixed(0)} Hz, `
    + `nothing ${none.during.toFixed(1)} Hz; 1 s after: ${sweet.after.toFixed(1)} / ${mixed.after.toFixed(1)} Hz`];
});

check('in the furnished terrarium, with no dust, DNg12 stays quiet through an arousal burst', () => {
  // Seed 101 is the live session in which the first burst (at 12 s) used to
  // tip the grooming relays into a permanent state: head grooming ~75% of
  // the time.
  const loop = new ClosedLoop({ data, bounds: { width: 1300, height: 800 }, seed: 101, hour: 12, spikeBus: false });
  let peak = 0, headTicks = 0, ticks = 0;
  for (let k = 0; k < 20 * 120; k++) {
    loop.tick(1 / 120);
    if (loop.dustLoad < 0.05) peak = Math.max(peak, loop.sim.rateDNg12);
    if (loop.fly.state === 'grooming' && loop.fly.groomMode === 'head') headTicks++;
    ticks++;
  }
  return [peak < 10 && headTicks / ticks < 0.2, `peak DNg12 without dust ${peak.toFixed(1)} Hz over 20 s; head grooming ${(100 * headTicks / ticks).toFixed(0)}% of the time`];
});

// Closed-loop checks share one rig in the bare experiment arena.
const rig = new ClosedLoop({ data, bounds: { width: 1100, height: 700 }, seed: 99, empty: true, spikeBus: false, instruments: false, hour: 12 });

function groomTrial(seed, silence) {
  rig.resetTrial(seed);
  if (silence) rig.setGenetic({ population: silence, mode: 'silence', on: true });
  rig.run(0.4);
  rig.override = { dust: 1 };
  let head = false;
  rig.run(2.5, (r) => { if (r.fly.state === 'grooming' && r.fly.groomMode === 'head') head = true; });
  rig.override = null;
  if (silence) rig.clearGenetics();
  return head;
}

check('dust on the antennae makes her groom her head in the closed loop', () => {
  const trials = [11, 12, 13].map((seed) => groomTrial(seed, null));
  return [trials.every(Boolean), `head grooming in ${trials.filter(Boolean).length}/3 trials at full dust`];
});

check('silencing JO-F or DNg12 abolishes dust-evoked head grooming (virtual genetics)', () => {
  const joF = [11, 12].map((seed) => groomTrial(seed, 'joF'));
  const dn = [11, 12].map((seed) => groomTrial(seed, 'dng12'));
  return [!joF.some(Boolean) && !dn.some(Boolean), `head grooming with JO-F silenced ${joF.filter(Boolean).length}/2, with DNg12 silenced ${dn.filter(Boolean).length}/2`];
});

check('silenced neurons are held at rest and the silencing is undone completely', () => {
  rig.resetTrial(21);
  const pop = rig.resolvePopulation('joF');
  rig.setGenetic({ population: 'joF', mode: 'silence', on: true });
  rig.override = { dust: 1 };
  rig.run(0.5);
  const silencedRate = rig.sim.rateJOF;
  const held = pop.indices.every((i) => rig.sim.v[i] === 0);
  rig.clearGenetics();
  rig.run(0.5);
  const restored = rig.sim.rateJOF;
  rig.override = null;
  return [held && silencedRate < 1 && restored > 5 && rig.sim.silencedCount === 0,
    `JO-F ${silencedRate.toFixed(1)} Hz silenced (membranes held at 0: ${held}), ${restored.toFixed(0)} Hz after clearing`];
});

// The causal chain must only name an input as the trigger when its sensory
// pathway measurably drove the neurons that decided.
check('head grooming is explained by the dust, through the grooming relays', () => {
  rig.resetTrial(31);
  rig.run(0.4);
  rig.override = { dust: 1 };
  let event = null;
  rig.run(2.5, (r) => {
    if (!event && r.fly.state === 'grooming' && r.fly.groomMode === 'head') {
      event = explain('headGrooming', { sim: r.sim, now: r.simTime, history: r.history, rates: r.sim.rates() });
    }
  });
  rig.override = null;
  const top = event?.inputs?.[0];
  return [event?.trigger?.channel === 'dust' && top?.source === 'groomRelay',
    `trigger ${event?.trigger?.channel ?? 'none'}, strongest input ${top?.source ?? '-'} ${top ? Math.round(top.share * 100) : 0}%`];
});

check('an input with no traced path to the deciding neurons is reported as concurrent, not as the cause', () => {
  // Dust is on throughout, but a spontaneous takeoff is decided by a body rule
  // on whole-brain activity, and leg grooming (DNg11) receives no direct input
  // from the grooming relays.
  const sim = make(41);
  const history = new InputHistory();
  for (let k = 0; k < 120; k++) { sim.step(8); history.push(k / 120, { dust: 1.3 }); }
  const now = 119 / 120;
  const flight = explain('spontaneousFlight', { sim, now, history, rates: sim.rates() });
  const legs = explain('legGrooming', { sim, now, history, rates: sim.rates() });
  const ok = flight.trigger === null && flight.concurrent.some((c) => c.channel === 'dust')
    && (legs.trigger === null || legs.trigger.channel !== 'dust') && legs.concurrent.some((c) => c.channel === 'dust');
  return [ok, `spontaneous flight trigger ${flight.trigger?.channel ?? 'none'} (concurrent: ${flight.concurrent.map((c) => c.channel).join(',')}); `
    + `leg grooming trigger ${legs.trigger?.channel ?? 'none'}`];
});

check('an abrupt loom is named as the trigger of the takeoff it causes', () => {
  rig.resetTrial(51);
  rig.run(0.4);
  if (rig.fly.state === 'flying') rig.fly.land();
  rig.override = { loomL: 1, loomR: 1 };
  let event = null;
  rig.run(0.4, (r) => {
    if (!event && r.fly.state === 'flying') event = explain('takeoff', { sim: r.sim, now: r.simTime, history: r.history, rates: r.sim.rates() });
  });
  rig.override = null;
  // Both eyes loomed and both feed the giant fiber: one is the trigger, the
  // other a traced co-cause — never an untraced bystander.
  const eyes = ['loomL', 'loomR'];
  const ok = !!event && eyes.includes(event.trigger?.channel)
    && event.contributing.some((c) => eyes.includes(c.channel)) && !event.concurrent.some((c) => eyes.includes(c.channel));
  return [ok, event ? `trigger ${event.trigger?.channel ?? 'none'} after ${event.trigger?.latencyMs ?? '?'} ms, together with `
    + `${event.contributing.map((c) => c.channel).join(',') || 'nothing'}, GF spikes ${event.command?.spikes}` : 'no takeoff within 0.4 s'];
});

console.log(failures === 0 ? 'ALL PATHWAY TESTS PASS' : `${failures} FAILURES`);
process.exit(failures === 0 ? 0 : 1);
