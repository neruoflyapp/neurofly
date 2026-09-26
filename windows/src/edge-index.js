// Compact, stable indexes for the observer-side connectome drawing. These
// never change the circuit or its weights; they only select edges to display.

export function buildOutgoingEdgeIndex(edgeFrom, neuronCount) {
  if (!Number.isInteger(neuronCount) || neuronCount < 0) throw new RangeError('Invalid neuron count');
  const counts = new Uint32Array(neuronCount);
  for (let k = 0; k < edgeFrom.length; k++) {
    const from = edgeFrom[k];
    if (!Number.isInteger(from) || from < 0 || from >= neuronCount) throw new RangeError('Invalid edge source');
    counts[from]++;
  }
  const starts = new Uint32Array(neuronCount + 1);
  for (let i = 0; i < neuronCount; i++) starts[i + 1] = starts[i] + counts[i];
  const cursor = starts.slice(0, neuronCount);
  const flat = new Uint32Array(edgeFrom.length);
  for (let k = 0; k < edgeFrom.length; k++) flat[cursor[edgeFrom[k]]++] = k;
  const outgoing = new Array(neuronCount);
  for (let i = 0; i < neuronCount; i++) outgoing[i] = flat.subarray(starts[i], starts[i + 1]);
  return outgoing;
}

// Same deterministic stride sample as the original renderer, without holding
// every eligible edge in an intermediate boxed-number array.
export function sampleVisibleEdges(edgeFrom, edgeTo, groupOf, visible, cap = 5000) {
  if (!Number.isInteger(cap) || cap < 1) throw new RangeError('Invalid edge cap');
  if (edgeFrom.length !== edgeTo.length) throw new RangeError('Edge arrays differ in length');
  const neuronVisible = new Uint8Array(groupOf.length);
  for (let i = 0; i < groupOf.length; i++) neuronVisible[i] = visible[groupOf[i]] ? 1 : 0;
  const eligibleMask = new Uint8Array(edgeFrom.length);
  let eligible = 0;
  for (let k = 0; k < edgeFrom.length; k++) {
    if (neuronVisible[edgeFrom[k]] && neuronVisible[edgeTo[k]]) {
      eligibleMask[k] = 1;
      eligible++;
    }
  }
  const stride = Math.max(1, Math.ceil(eligible / cap));
  const result = new Uint32Array(Math.ceil(eligible / stride));
  let seen = 0, written = 0;
  for (let k = 0; k < edgeFrom.length; k++) {
    if (!eligibleMask[k]) continue;
    if (seen % stride === 0) result[written++] = k;
    seen++;
  }
  return result;
}
