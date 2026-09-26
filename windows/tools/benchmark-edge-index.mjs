// Read-only comparison on the shipped connectome. Run with:
// node --expose-gc tools/benchmark-edge-index.mjs
import { performance } from 'node:perf_hooks';
import { loadBrainData } from '../src/data.js';
import { buildOutgoingEdgeIndex, sampleVisibleEdges } from '../src/edge-index.js';

const circuit = loadBrainData()?.circuit;
if (!circuit) throw new Error('A local audited circuit is required');
const from = Int32Array.from(circuit.edges, e => e[0]);
const to = Int32Array.from(circuit.edges, e => e[1]);
const neuronCount = circuit.neurons.length;

function previousIndex() {
  const out = Array.from({ length: neuronCount }, () => []);
  for (let k = 0; k < from.length; k++) out[from[k]].push(k);
  return out.map(a => Int32Array.from(a));
}

function previousSample(groupOf, visible, cap) {
  const filtered = [];
  for (let k = 0; k < from.length; k++) {
    if (visible[groupOf[from[k]]] && visible[groupOf[to[k]]]) filtered.push(k);
  }
  const stride = Math.max(1, Math.ceil(filtered.length / cap));
  const selected = [];
  for (let i = 0; i < filtered.length; i += stride) selected.push(filtered[i]);
  return selected;
}

function measure(fn) {
  const values = [];
  let result;
  for (let i = 0; i < 4; i++) {
    global.gc?.();
    const at = performance.now();
    result = fn();
    if (i) values.push(performance.now() - at);
  }
  values.sort((a, b) => a - b);
  return { ms: values[1], result };
}

const oldIndex = measure(previousIndex);
const newIndex = measure(() => buildOutgoingEdgeIndex(from, neuronCount));
for (let i = 0; i < neuronCount; i++) {
  const a = oldIndex.result[i], b = newIndex.result[i];
  if (a.length !== b.length || a.some((edge, k) => edge !== b[k])) throw new Error(`Outgoing index mismatch at neuron ${i}`);
}
const groupOf = Int32Array.from({ length: neuronCount }, (_, i) => i % 6);
const visible = Uint8Array.from([1, 1, 0, 1, 0, 1]);
const cap = 5000;
const oldSample = measure(() => previousSample(groupOf, visible, cap));
const newSample = measure(() => sampleVisibleEdges(from, to, groupOf, visible, cap));
if (oldSample.result.length !== newSample.result.length ||
    oldSample.result.some((edge, i) => edge !== newSample.result[i])) throw new Error('Ambient sample mismatch');

console.log(`${neuronCount} neurons, ${from.length} edges; exact results matched`);
console.log(`Outgoing index: prior ${oldIndex.ms.toFixed(1)} ms; compact ${newIndex.ms.toFixed(1)} ms`);
console.log(`Ambient sample: prior ${oldSample.ms.toFixed(1)} ms; allocation-bounded ${newSample.ms.toFixed(1)} ms`);
