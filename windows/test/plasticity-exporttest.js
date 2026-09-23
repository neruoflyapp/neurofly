// Isolated export contract tests: no large circuit or neural run is required.
import assert from 'node:assert/strict';
import { PLASTICITY_EXPORT_COLUMNS, plasticityChangesCSV } from '../src/plasticity-export.js';

// Small independent CSV reader for round trips, including quoted CR and LF.
function parseCSV(text) {
  const rows = [];
  let row = [], value = '', quoted = false;
  for (let i = 0; i < text.length; i++) {
    const char = text[i];
    if (char === '"') {
      if (quoted && text[i + 1] === '"') { value += '"'; i++; }
      else quoted = !quoted;
    } else if (char === ',' && !quoted) {
      row.push(value); value = '';
    } else if (char === '\n' && !quoted) {
      row.push(value); rows.push(row); row = []; value = '';
    } else value += char;
  }
  assert.equal(quoted, false, 'CSV quotes must balance');
  assert.equal(value, '', 'CSV terminates with a newline');
  return rows;
}

function records(csv) {
  const [header, ...rows] = parseCSV(csv);
  assert.deepEqual(header, [...PLASTICITY_EXPORT_COLUMNS]);
  assert.equal(new Set(header).size, header.length, 'column names are unique');
  return rows.map((row) => {
    assert.equal(row.length, header.length, 'each data row aligns with its header');
    return Object.fromEntries(header.map((column, i) => [column, row[i]]));
  });
}

const changes = [{ pre: 0, post: 1, initialWeight: 0.125, currentWeight: 0.15,
  relativeChange: 0.2, updateCount: 3 }];
const hashes = { brainCircuitSHA256: 'a'.repeat(64), locomotorSHA256: 'b'.repeat(64),
  annotationSHA256: 'c'.repeat(64), thermoExtensionSHA256: 'd'.repeat(64),
  annotationStatus: 'attached', thermoExtensionStatus: 'attached' };
const neurons = [
  { id: '720575940600000001', type: 'LC4', cellType: 'LC4,"annotated"\rleft\nvisual', role: 'sens', sensoryGroup: 'visual' },
  { id: '720575940600000002', type: 'GF', cellType: 'GF', role: 'gf', thermoGroup: 'relayHot' },
];
const plasticity = { mechanism: 'bounded-pair-stdp', tauMs: 18, learningRate: 0.0075, maxRelativeChange: 0.08 };
const protocol = { id: 'p-2', name: 'pre\rpost', pairOrder: 'pre-before-post', trials: 2, delayMs: 7,
  intervalMs: 140, scheduledAtSimMs: 12, endSimMs: 172, status: 'running' };
const [row] = records(plasticityChangesCSV({
  modelVersion: '1.2.0', neuralSeed: 4294967295, brainFingerprint: 'obsolete', mechanism: 'obsolete',
  data: { provenance: hashes, circuit: { neurons } }, plasticity, protocol,
  protocolHistory: [{ id: 'p-1' }, protocol], neuralTimeMs: 90, changes,
}));

assert.equal(row.brain_bundle_sha256, hashes.brainCircuitSHA256);
assert.equal(row.brain_bundle_sha256_16, hashes.brainCircuitSHA256.slice(0, 16));
assert.equal(row.vnc_bundle_sha256, hashes.locomotorSHA256);
assert.equal(row.cell_annotation_sha256, hashes.annotationSHA256);
assert.equal(row.cell_annotation_status, 'attached');
assert.equal(row.thermo_extension_sha256, hashes.thermoExtensionSHA256);
assert.equal(row.thermo_extension_status, 'attached');
assert.equal(row.plasticity_rule, plasticity.mechanism);
assert.equal(Number(row.plasticity_tau_ms), plasticity.tauMs);
assert.equal(Number(row.plasticity_learning_rate), plasticity.learningRate);
assert.equal(Number(row.plasticity_max_relative_change), plasticity.maxRelativeChange);
assert.equal(row.neural_seed_u32, '4294967295');
assert.equal(row.neural_time_ms, '90');
assert.equal(row.pre_neuron_id, neurons[0].id);
assert.equal(row.post_neuron_id, neurons[1].id);
assert.equal(row.pre_cell_type, neurons[0].cellType, 'comma, quotes, CR and LF round-trip without changing annotations');
assert.equal(row.pre_neuron_type, 'LC4');
assert.equal(row.pre_sensory_group, 'visual');
assert.equal(row.post_thermo_group, 'relayHot');
assert.equal(row.protocol_name, 'pre\rpost', 'standalone CR is quoted');
assert.equal(row.protocol_id, 'p-2');
assert.equal(row.protocol_scheduled_at_sim_ms, '12');
assert.equal(row.protocol_end_sim_ms, '172');
assert.equal(row.protocol_status, 'running');
assert.equal(row.protocol_history_count, '2');
assert.match(row.change_scope, /cumulative/);
assert.match(row.weight_semantics, /not-anatomical-synapse-count/);
assert.match(row.protocol_metadata_scope, /not-per-contact-causal-attribution/);
assert.equal(Number(row.current_weight), changes[0].currentWeight);
console.log('PASS  full hashes, learning parameters, exact source IDs and annotations round-trip');

const [legacy] = records(plasticityChangesCSV({ brainFingerprint: 'feedface', mechanism: 'old-rule', changes }));
assert.equal(legacy.brain_bundle_sha256_16, 'feedface');
assert.equal(legacy.plasticity_rule, 'old-rule');
assert.equal(legacy.brain_bundle_sha256, '', 'a short fingerprint must not masquerade as a full hash');
assert.equal(legacy.plasticity_tau_ms, '', 'unknown parameters are not invented');
assert.equal(legacy.pre_neuron_id, '');
assert.equal(legacy.protocol_history_count, '', 'absent history is not a measured zero');
console.log('PASS  legacy caller remains supported with explicit unknown metadata');

const [invalid] = records(plasticityChangesCSV({
  data: { circuit: { neurons: [{ id: 720575940600000001 }, { id: 12 }] } },
  neuralTimeMs: Infinity, plasticity: { tauMs: NaN },
  changes: [{ ...changes[0], relativeChange: Infinity }],
}));
assert.equal(invalid.pre_neuron_id, '', 'unsafe numeric IDs cannot be reported as exact');
assert.equal(invalid.post_neuron_id, '12', 'safe numeric IDs remain representable');
assert.equal(invalid.neural_time_ms, '');
assert.equal(invalid.plasticity_tau_ms, '');
assert.equal(invalid.relative_change, '');
assert.equal(records(plasticityChangesCSV()).length, 0, 'empty exports retain a usable header');
console.log('PASS  missing/non-finite values and unsafe IDs are not fabricated');
console.log('ALL PLASTICITY EXPORT TESTS PASS');
