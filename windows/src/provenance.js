// provenance.js -- scientific scope, validation and reproducibility helpers.
//
// A connectome records anatomy, not an animal's complete physiology or
// subjective experience.  This module makes that boundary executable: a
// malformed reduced circuit cannot quietly enter the simulation, and every
// recorded trial can identify both the exact input bundle and its neural RNG
// seed.  It intentionally does not manufacture a "sentience score".

export const MODEL_VERSION = '2.2.0';
export const BRAIN_DATASET = 'FlyWire FAFB v783';
export const VNC_DATASET = 'MaleCNS v1.0';

export const SCIENTIFIC_SCOPE = Object.freeze({
  measured: Object.freeze([
    'retained neuron identities, positions and signed synapse-count edges',
    'named FlyWire and MaleCNS cell annotations supplied in the data bundle',
    'simulated spike events and population rates',
  ]),
  modeled: Object.freeze([
    'LIF membrane parameters, stochastic drive and synaptic gain',
    'sensory transduction, body mechanics and muscle activation',
    'same-type population-rate bridge between female FlyWire brain and male VNC',
  ]),
  notInferable: Object.freeze([
    'subjective experience, consciousness, pain or emotion',
    'a complete individual fly, complete physiology, or unmodeled learning and memory',
  ]),
});

// A circuit is immutable after loading in this app. Caching the completed
// audit keeps a respawn from rescanning 700k edges merely to rebuild dynamic
// state; a newly parsed or newly constructed circuit is still always checked.
const auditCache = new WeakMap();

function finiteTriplet(value) {
  return Array.isArray(value) && value.length === 3 && value.every(Number.isFinite);
}

// Validate the data representation before allocating tens of megabytes of
// state.  The edge format is intentionally strict because an index shift or a
// transmitter-class shift still produces an animated network, but not the
// network the provenance line claims it is.
export function auditBrainCircuit(circuit) {
  if (circuit && typeof circuit === 'object' && auditCache.has(circuit)) return auditCache.get(circuit);
  const errors = [];
  const roleCounts = Object.create(null);
  const transmitterCounts = [0, 0, 0, 0];
  let positiveEdges = 0;
  let negativeEdges = 0;

  if (!circuit || !Array.isArray(circuit.neurons) || !Array.isArray(circuit.edges)) {
    const result = { valid: false, errors: ['circuit must contain neurons[] and edges[]'], roleCounts, transmitterCounts,
      neurons: 0, edges: 0, positiveEdges, negativeEdges };
    if (circuit && typeof circuit === 'object') auditCache.set(circuit, result);
    return result;
  }
  if (!circuit.neurons.length) errors.push('circuit contains no neurons');
  if (!circuit.edges.length) errors.push('circuit contains no edges');

  const seenIds = new Set();
  circuit.neurons.forEach((neuron, index) => {
    if (!neuron || typeof neuron !== 'object') { errors.push(`neuron ${index} is not an object`); return; }
    if (neuron.id === null || neuron.id === undefined || neuron.id === '') errors.push(`neuron ${index} has no id`);
    else if (seenIds.has(String(neuron.id))) errors.push(`duplicate neuron id at ${index}`);
    else seenIds.add(String(neuron.id));
    if (typeof neuron.role !== 'string' || !neuron.role) errors.push(`neuron ${index} has no role`);
    else roleCounts[neuron.role] = (roleCounts[neuron.role] || 0) + 1;
    if (typeof neuron.type !== 'string' || !neuron.type) errors.push(`neuron ${index} has no type`);
    if (!finiteTriplet(neuron.pos)) errors.push(`neuron ${index} has invalid position`);
  });

  const n = circuit.neurons.length;
  circuit.edges.forEach((edge, index) => {
    if (!Array.isArray(edge) || edge.length !== 4) { errors.push(`edge ${index} must be [pre, post, signed_count, nt_class]`); return; }
    const [pre, post, count, ntClass] = edge;
    if (!Number.isInteger(pre) || !Number.isInteger(post) || pre < 0 || post < 0 || pre >= n || post >= n) {
      errors.push(`edge ${index} has an out-of-range endpoint`);
    }
    if (!Number.isFinite(count) || count === 0) errors.push(`edge ${index} has an invalid signed count`);
    else if (count > 0) positiveEdges++; else negativeEdges++;
    if (!Number.isInteger(ntClass) || ntClass < 0 || ntClass > 3) errors.push(`edge ${index} has invalid nt class`);
    else transmitterCounts[ntClass]++;
  });

  const result = {
    valid: errors.length === 0,
    errors,
    neurons: n,
    edges: circuit.edges.length,
    roleCounts,
    transmitterCounts,
    positiveEdges,
    negativeEdges,
  };
  auditCache.set(circuit, result);
  return result;
}

// FNV-1a is deliberately labelled as a fingerprint rather than a security
// hash.  Its purpose is a compact, stable identifier in a CSV/UI, while the
// data loader also records SHA-256 when Node's crypto API is available.
export function fingerprintText(text) {
  let h = 0x811c9dc5;
  for (let i = 0; i < text.length; i++) {
    h ^= text.charCodeAt(i);
    h = Math.imul(h, 0x01000193) >>> 0;
  }
  return h.toString(16).padStart(8, '0');
}

export function runDescriptor({ circuit, locomotor = null, seed = 1, dataFingerprint = null } = {}) {
  const audit = auditBrainCircuit(circuit);
  const vncNeurons = Array.isArray(locomotor?.neurons) ? locomotor.neurons.length : 0;
  const vncEdges = Array.isArray(locomotor?.edges) ? locomotor.edges.length : 0;
  return Object.freeze({
    modelVersion: MODEL_VERSION,
    brainDataset: circuit?.source || BRAIN_DATASET,
    vncDataset: locomotor?.source || VNC_DATASET,
    brainNeurons: audit.neurons,
    brainEdges: audit.edges,
    vncNeurons,
    vncEdges,
    neuralSeed: seed >>> 0,
    dataFingerprint: dataFingerprint || fingerprintText(`${audit.neurons}/${audit.edges}/${circuit?.source || ''}`),
    bridge: 'modeled same-type/side population-rate interface',
    valid: audit.valid,
  });
}
