// plasticity-export.js -- a self-describing CSV for the optional learning
// experiment. This is deliberately separate from the 20-Hz time series:
// each row names one anatomical contact that actually changed.

export const PLASTICITY_EXPORT_COLUMNS = Object.freeze([
  'model_version',
  'neural_seed_u32',
  'brain_bundle_sha256_16',
  'plasticity_rule',
  'protocol_name',
  'protocol_pair_order',
  'protocol_trials',
  'protocol_delay_ms',
  'protocol_interval_ms',
  'pre_neuron_index',
  'post_neuron_index',
  'initial_weight',
  'current_weight',
  'relative_change',
  'update_count',
  'brain_bundle_sha256',
  'vnc_bundle_sha256',
  'cell_annotation_sha256',
  'cell_annotation_status',
  'thermo_extension_sha256',
  'thermo_extension_status',
  'plasticity_tau_ms',
  'plasticity_learning_rate',
  'plasticity_max_relative_change',
  'neural_time_ms',
  'change_scope',
  'weight_semantics',
  'protocol_metadata_scope',
  'protocol_history_count',
  'protocol_id',
  'protocol_scheduled_at_sim_ms',
  'protocol_end_sim_ms',
  'protocol_status',
  'pre_neuron_id',
  'post_neuron_id',
  'pre_neuron_type',
  'post_neuron_type',
  'pre_cell_type',
  'post_cell_type',
  'pre_role',
  'post_role',
  'pre_sensory_group',
  'post_sensory_group',
  'pre_thermo_group',
  'post_thermo_group',
]);

function cell(value) {
  if (value === null || value === undefined || !Number.isFinite(value) && typeof value === 'number') return '';
  const text = String(value);
  return /[",\r\n]/.test(text) ? `"${text.replace(/"/g, '""')}"` : text;
}

function neuronAt(neurons, index) {
  return Number.isSafeInteger(index) && index >= 0 ? neurons?.[index] : null;
}

// FlyWire IDs exceed JavaScript's safe integer range. Preserve their source
// strings exactly; never publish an already-rounded numeric ID as exact data.
function neuronId(neuron) {
  const id = neuron?.id;
  return typeof id === 'number' && !Number.isSafeInteger(id) ? null : id;
}

export function plasticityChangesCSV({
  modelVersion = '',
  neuralSeed = '',
  brainFingerprint = '',
  mechanism = '',
  data = null,
  plasticity = null,
  protocol = null,
  protocolHistory = null,
  neuralTimeMs = null,
  changes = [],
} = {}) {
  const provenance = data?.provenance || {};
  const neurons = data?.circuit?.neurons;
  const brainHash = provenance.brainCircuitSHA256 ?? '';
  const lines = [PLASTICITY_EXPORT_COLUMNS.join(',')];
  for (const change of changes) {
    const pre = neuronAt(neurons, change.pre);
    const post = neuronAt(neurons, change.post);
    lines.push([
      modelVersion,
      neuralSeed,
      brainHash ? brainHash.slice(0, 16) : brainFingerprint,
      plasticity?.mechanism ?? mechanism,
      protocol?.name ?? '',
      protocol?.pairOrder ?? '',
      protocol?.trials ?? '',
      protocol?.delayMs ?? '',
      protocol?.intervalMs ?? '',
      change.pre,
      change.post,
      change.initialWeight,
      change.currentWeight,
      change.relativeChange,
      change.updateCount,
      brainHash,
      provenance.locomotorSHA256,
      provenance.annotationSHA256,
      provenance.annotationStatus,
      provenance.thermoExtensionSHA256,
      provenance.thermoExtensionStatus,
      plasticity?.tauMs,
      plasticity?.learningRate,
      plasticity?.maxRelativeChange,
      neuralTimeMs,
      'cumulative-since-neural-restart',
      'LIF-model-weight-not-anatomical-synapse-count',
      'latest-intervention-not-per-contact-causal-attribution',
      Array.isArray(protocolHistory) ? protocolHistory.length : null,
      protocol?.id,
      protocol?.scheduledAtNeuralMs ?? protocol?.scheduledAtSimMs,
      protocol?.endNeuralMs ?? protocol?.endSimMs,
      protocol?.status,
      neuronId(pre),
      neuronId(post),
      pre?.type,
      post?.type,
      pre?.cellType,
      post?.cellType,
      pre?.role,
      post?.role,
      pre?.sensoryGroup,
      post?.sensoryGroup,
      pre?.thermoGroup,
      post?.thermoGroup,
    ].map(cell).join(','));
  }
  return `${lines.join('\n')}\n`;
}
