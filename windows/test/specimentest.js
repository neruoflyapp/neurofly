import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { createHash } from 'node:crypto';
import { SPECIMENS, specimenCompatibility, validateSpecimenBundle } from '../src/specimen.js';
import { createSpecimenStore } from '../src/specimen-data.js';
import { makeExperimentManifest } from '../src/experiment-manifest.js';

assert.equal(specimenCompatibility('banc-v888', 'banc-v888').sameSpecimen, true);
assert.equal(specimenCompatibility('banc-v888', 'fafb-v783').sameSex, true);
assert.equal(specimenCompatibility('banc-v888', 'fafb-v783').sameSpecimen, false);
assert.equal(specimenCompatibility('fafb-v783', 'malecns-v1').sameSex, false);
assert.equal(specimenCompatibility('unknown', 'unknown').sameSpecimen, false);
const sample = {
  profile: SPECIMENS['banc-v888'],
  neurons: ['720575941633499884', '720575941633499885'].map(id => ({ id, specimen: 'BANC', type: 'test', pos: [0, 0, 0] })),
  edges: [[0, 1, 7]],
};
assert.equal(validateSpecimenBundle(sample).valid, true);
assert.equal(validateSpecimenBundle({ ...sample, neurons: [sample.neurons[0], { ...sample.neurons[1], pos: null, positionKnown: false }] }).valid, true, 'missing soma position must not erase sensory neurons');
assert.equal(validateSpecimenBundle({ ...sample, neurons: [sample.neurons[0], { ...sample.neurons[1], pos: null }] }).valid, false);
const provenance = { specimens: { brain: { ...SPECIMENS['fafb-v783'] }, nerveCord: SPECIMENS['malecns-v1'] }, sensoryExtensionSHA256: 'taste-and-grooming', sensoryExtensionStatus: 'attached', sensoryExtension: { addedNeurons: 864 } };
const manifest = makeExperimentManifest({ data: { provenance } });
assert.equal(manifest.data.specimens.brain.sex, 'female');
assert.equal(manifest.data.specimens.nerveCord.sex, 'male');
assert.equal(manifest.data.sensoryExtensionSHA256, 'taste-and-grooming');
assert.equal(makeExperimentManifest({ data: { circuit: { neurons: Array(3), edges: Array(4) }, provenance: { sensoryExtensionStatus: 'attached' } } }).data.baseBrainNeurons, null, 'sensory-only extension does not fabricate base counts');
provenance.specimens.brain.sex = 'changed';
assert.equal(manifest.data.specimens.brain.sex, 'female', 'exports retain immutable specimen metadata');
assert.equal(validateSpecimenBundle({ ...sample, profile: { ...sample.profile, sex: 'male' } }).valid, false);
assert.equal(validateSpecimenBundle({ ...sample, neurons: [sample.neurons[0], { ...sample.neurons[1], specimen: 'FAFB' }] }).valid, false);
assert.equal(validateSpecimenBundle({ ...sample, neurons: sample.neurons.map(n => ({ ...n, id: Number(n.id) })) }).valid, false, '64-bit IDs must not pass through JS numbers');
assert.equal(validateSpecimenBundle({ ...sample, edges: [[0, 1, 7], [0, 1, 7]] }).valid, false);
for (const edge of [[0, 2, 5], [0, 1, -1], [0, 1, 0.5], [-1, 0, 1], [0, 1, 1, 0]]) {
  assert.equal(validateSpecimenBundle({ ...sample, edges: [edge] }).valid, false);
}
assert.equal(validateSpecimenBundle(null).valid, false);

const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'neurofly-specimens-'));
try {
  const store = createSpecimenStore(dir);
  assert.equal(store.catalog().profiles.length, 3);
  assert.equal(store.catalog().profiles.every(p => !p.runtimeReady && p.status === 'not-imported'), true);
  assert.throws(() => store.load('../../private'));
  assert.throws(() => store.load('banc-v888'));
  const raw = JSON.stringify(sample), sha256 = createHash('sha256').update(raw).digest('hex');
  fs.writeFileSync(path.join(dir, 'banc-v888.json'), raw);
  fs.writeFileSync(path.join(dir, 'catalog.json'), JSON.stringify({ profiles: [{ id: 'banc-v888', sha256 }] }));
  assert.equal(store.catalog().profiles[0].status, 'anatomy-ready');
  assert.equal(store.catalog().profiles[0].runtimeReady, false, 'anatomy does not certify body/physiology');
  assert.equal(store.load('banc-v888').neurons[1].id, '720575941633499885');
  assert.equal(store.morphology('720575941633499885'), null);
  assert.throws(() => store.morphology('../invalid'));
  fs.writeFileSync(path.join(dir, 'banc-v888.json'), raw + ' ');
  assert.throws(() => createSpecimenStore(dir).load('banc-v888'), /checksum/);
  fs.writeFileSync(path.join(dir, 'catalog.json'), JSON.stringify({ profiles: [{ id: 'malecns-v1', sha256 }] }));
  fs.writeFileSync(path.join(dir, 'malecns-v1.json'), raw);
  assert.throws(() => createSpecimenStore(dir).load('malecns-v1'), /wrong animal/);
} finally {
  const resolved = fs.realpathSync(dir);
  assert.equal(path.dirname(resolved), fs.realpathSync(os.tmpdir()));
  assert.ok(path.basename(resolved).startsWith('neurofly-specimens-'));
  fs.rmSync(resolved, { recursive: true, force: true }); // only our verified fresh fixture
}
console.log('specimentest: PASS — identity, sex, exact IDs, counts, checksums, safe paths and readiness');
