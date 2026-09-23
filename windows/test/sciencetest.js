// sciencetest.js -- guards scientific provenance and deterministic neural runs.

import { loadBrainData } from '../src/data.js';
import { LIFSim } from '../src/sim.js';
import { auditBrainCircuit, runDescriptor, MODEL_VERSION } from '../src/provenance.js';
import { assessSentience, SENTIENCE_RESEARCH_SOURCES, STATUS } from '../src/sentience.js';

let failures = 0;
function check(name, fn) {
  const [ok, detail] = fn();
  if (!ok) failures++;
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}: ${detail}`);
}

const data = loadBrainData();
if (!data) { process.stderr.write('no data/ — run etl.py first\n'); process.exit(1); }

check('the loaded FlyWire subset has a structural audit and raw-file fingerprints', () => {
  const audit = data.provenance.brainAudit;
  const hashes = [data.provenance.brainPointsSHA256, data.provenance.brainCircuitSHA256, data.provenance.locomotorSHA256];
  const hashOK = hashes.every((value) => value === null || /^[0-9a-f]{64}$/.test(value));
  const signsOK = audit.positiveEdges + audit.negativeEdges === audit.edges;
  // brainAudit describes circuit.json as published; the running circuit is
  // larger by exactly what the thermo and sensory extensions report adding.
  const thermo = data.provenance.thermoExtension?.addedNeurons ?? 0;
  const sensory = data.provenance.sensoryExtension?.addedNeurons ?? 0;
  return [audit.valid && hashOK && signsOK && audit.neurons === data.circuit.neurons.length - thermo - sensory,
    `${audit.neurons} neurons, ${audit.edges} edges in circuit.json (+${thermo} thermo, +${sensory} taste/grooming extension), SHA-256 present=${hashOK}`];
});

check('an invalid edge endpoint cannot be accepted as a brain circuit', () => {
  const corrupt = {
    ...data.circuit,
    neurons: data.circuit.neurons,
    edges: data.circuit.edges.slice(),
  };
  corrupt.edges[0] = [...corrupt.edges[0]];
  corrupt.edges[0][1] = corrupt.neurons.length;
  const audit = auditBrainCircuit(corrupt);
  return [!audit.valid && audit.errors.some((message) => message.includes('out-of-range')),
    audit.errors[0] || 'unexpectedly valid'];
});

function neuralTrace(seed) {
  const sim = new LIFSim(data.circuit, null, data.locomotor, { seed });
  const trace = [];
  for (let ms = 0; ms < 300; ms++) {
    sim.loomL = ms >= 80 && ms < 180 ? 0.32 : 0;
    sim.loomR = ms >= 130 && ms < 210 ? 0.15 : 0;
    sim.airPuff = ms >= 220 ? 0.4 : 0;
    sim.step(1);
    if (ms % 25 === 0) trace.push([sim.rateLoom, sim.rateGF, sim.rateSens, sim.v[4000]]);
  }
  return trace;
}

check('a fixed neural seed exactly reproduces an identical input trace', () => {
  const a = neuralTrace(0x1a2b3c4d);
  const b = neuralTrace(0x1a2b3c4d);
  const equal = JSON.stringify(a) === JSON.stringify(b);
  return [equal, `${a.length} samples ${equal ? 'match bit-for-bit' : 'differ'}`];
});

check('a changed neural seed changes the stochastic neural trajectory', () => {
  const a = neuralTrace(12345);
  const b = neuralTrace(54321);
  const differs = JSON.stringify(a) !== JSON.stringify(b);
  return [differs, differs ? 'different seeds produced different traces' : 'traces unexpectedly match'];
});

check('run descriptor records scope without claiming a literal brain-VNC connectome', () => {
  const run = runDescriptor({
    circuit: data.circuit,
    locomotor: data.locomotor,
    seed: 42,
    dataFingerprint: data.provenance.brainCircuitSHA256.slice(0, 16),
  });
  const ok = run.valid && run.modelVersion === MODEL_VERSION && run.neuralSeed === 42
    && run.bridge.includes('modeled') && run.brainEdges === data.circuit.edges.length;
  return [ok, `${run.modelVersion}, seed ${run.neuralSeed}, ${run.bridge}`];
});

check('sentience map follows the eight Birch et al. (2021) criteria, with the published ratings for real flies, and scores nothing', () => {
  const audit = assessSentience({ circuit: data.circuit, provenance: data.provenance, pathways: data.pathways });
  const learning = assessSentience({ circuit: data.circuit, provenance: data.provenance, pathways: data.pathways, hasPlasticity: true });
  const byId = (a, id) => a.items.find((item) => item.id === id);
  const ids = ['nociception', 'sensory-integration', 'integrated-nociception', 'analgesia',
    'motivational-tradeoffs', 'flexible-self-protection', 'associative-learning', 'analgesia-preference'];
  const allEight = ids.every((id) => byId(audit, id)) && audit.criteriaCount === 8;
  // Gibbons et al. (2022) Table 11, adult Diptera: VH VH VH VH H VL VH VL.
  const ratings = ids.map((id) => byId(audit, id).animal).join(' ');
  const noPresent = audit.criteria.every((c) => c.status !== STATUS.present);
  const ok = allEight && ratings === 'VH VH VH VH H VL VH VL' && audit.animalStrong === 6
    && byId(audit, 'subjective-experience')?.status === STATUS.notMeasurable
    && byId(audit, 'analgesia-preference')?.status === STATUS.absent
    && byId(audit, 'associative-learning')?.status === STATUS.absent
    && byId(learning, 'associative-learning')?.status === STATUS.experimental
    && noPresent && audit.conclusion.includes('not a sentience score');
  return [ok, `${audit.criteriaCount} criteria; real flies ${ratings}; model covers ${audit.modelled} partially; `
    + `none claimed present; subjective=${byId(audit, 'subjective-experience')?.status}`];
});

check('the full-connectome pathway analysis is loaded and measures routes from sensors to integrative centres', () => {
  const p = data.pathways;
  const hotMB = p?.sources?.hot?.regions?.mushroomBody;
  const bitterMB = p?.sources?.bitter?.regions?.mushroomBody;
  const ok = Boolean(hotMB && bitterMB) && hotMB.minSynapses >= 1 && hotMB.minSynapses <= 3 && bitterMB.within3 > 0
    && /complete connectome/.test(p.source);
  return [ok, hotMB ? `hot cells -> mushroom body: ${hotMB.minSynapses} synapses (${hotMB.within2} cells within 2); `
    + `bitter -> mushroom body: ${bitterMB.minSynapses} (${bitterMB.within3} within 3)` : 'sentience_pathways.json missing'];
});

// Regression guard: an earlier version cited a Gibbons et al. DOI that points
// into a different journal, and attributed Ueno et al. (2017) to "Aso et al.".
// Every source must be https, and those two errors must never come back.
check('cited sources are https and the two previously wrong citations stay corrected', () => {
  const https = SENTIENCE_RESEARCH_SOURCES.every((s) => /^https:\/\//.test(s.url));
  const text = JSON.stringify(SENTIENCE_RESEARCH_SOURCES);
  const noBadDOI = !text.includes('bs.aecr.2022.09.005');
  const gibbonsOK = text.includes('10.1016/bs.aiip.2022.10.001');
  const uenoOK = /Ueno et al\. \(2017\)[^"]*eLife/.test(text) && !/Aso et al[^"]*21076/.test(text);
  return [https && noBadDOI && gibbonsOK && uenoOK,
    `https=${https}, Gibbons DOI fixed=${gibbonsOK && noBadDOI}, Ueno attribution=${uenoOK}`];
});

// The model's sensory partners are Johnston's-organ neurons (FlyWire
// sub_class). The annotation must attach to this exact circuit, and the split
// must match FlyWire's own counts rather than drift silently.
check('FlyWire cell annotation is attached to this exact circuit', () => {
  const p = data.provenance;
  const c = p.sensoryGroupCounts || {};
  const ok = p.annotationStatus === 'attached' && c.jo_auditory === 176 && c.jo_wind_gravity === 18;
  return [ok, `status=${p.annotationStatus}, JO-A/B=${c.jo_auditory}, JO-C/D/E=${c.jo_wind_gravity}, other=${c.other_sensory}`];
});

console.log(failures === 0 ? 'ALL SCIENCE TESTS PASS' : `${failures} SCIENCE TESTS FAILED`);
process.exit(failures === 0 ? 0 : 1);
