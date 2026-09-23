// Anatomical queries only: positive contact counts are not physiological gains.
export function indexSpecimen(bundle) {
  const incoming = Array.from({ length: bundle.neurons.length }, () => []);
  const outgoing = Array.from({ length: bundle.neurons.length }, () => []);
  for (const e of bundle.edges) { incoming[e[1]].push(e); outgoing[e[0]].push(e); }
  const order = (a, b) => b[2] - a[2] || a[0] - b[0] || a[1] - b[1];
  for (const list of [...incoming, ...outgoing]) list.sort(order);
  return { incoming, outgoing, byId: new Map(bundle.neurons.map((n, i) => [n.id, i])) };
}

export function findSpecimenPath(bundle, index, options = {}) {
  const { from, to, minContacts = 5, maxHops = 6 } = options;
  if (typeof from !== 'string' || typeof to !== 'string' || !/^\d{1,24}$/.test(from) || !/^\d{1,24}$/.test(to)) throw new Error('Use exact decimal neuron IDs');
  if (!Number.isSafeInteger(minContacts) || minContacts < (bundle.summary?.edgeThreshold ?? 5)
    || !Number.isInteger(maxHops) || maxHops < 1 || maxHops > 12) throw new Error('Invalid path threshold or hop limit (1–12)');
  const start = index.byId.get(from), goal = index.byId.get(to);
  if (start === undefined || goal === undefined) throw new Error('Neuron is not in this specimen subset');
  const report = { schema: 'neurofly-anatomical-path/1', profile: bundle.profile, bundleSHA256: bundle.sha256,
    sources: bundle.sources, query: { from, to, minContacts, maxHops }, found: false, neurons: [], edges: [],
    scope: 'One directed shortest-hop path within this anatomical subset and threshold; not unique, not functional transmission, not evidence of sentience. Absence does not establish absence in the animal.' };
  const parent = new Int32Array(bundle.neurons.length).fill(-1), depth = new Uint8Array(bundle.neurons.length);
  const via = new Float64Array(bundle.neurons.length), queue = new Uint32Array(bundle.neurons.length);
  let head = 0, tail = 0;
  parent[start] = start; queue[tail++] = start;
  while (head < tail && parent[goal] < 0) {
    const node = queue[head++];
    if (depth[node] >= maxHops) continue;
    for (const edge of index.outgoing[node]) {
      if (edge[2] < minContacts) break; // descending contact order
      const next = edge[1];
      if (parent[next] >= 0) continue;
      parent[next] = node; via[next] = edge[2]; depth[next] = depth[node] + 1;
      queue[tail++] = next;
      if (next === goal) break;
    }
  }
  report.visitedNeurons = tail;
  if (parent[goal] < 0) return report;
  const steps = [goal];
  while (steps.at(-1) !== start) steps.push(parent[steps.at(-1)]);
  steps.reverse(); report.found = true; report.hops = steps.length - 1;
  report.neurons = steps.map(i => { const n = bundle.neurons[i]; return { id: n.id, type: n.type, specimen: n.specimen, nt: n.nt, ntEvidence: n.ntEvidence }; });
  report.edges = steps.slice(1).map(i => ({ from: bundle.neurons[parent[i]].id, to: bundle.neurons[i].id, contacts: via[i] }));
  return report;
}
