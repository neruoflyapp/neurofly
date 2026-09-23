// Parse native centreline morphology. Source scale is explicit: never infer
// nm/voxel/micrometre units from coordinate magnitude or neuron ID.
export function parseSWC(text, { id, specimen, nmPerUnit, maxSegments = 30000 }) {
  if (!Number.isFinite(nmPerUnit) || nmPerUnit <= 0) throw new Error('Explicit SWC unit conversion required');
  const nodes = new Map();
  for (const line of text.split(/\r?\n/)) {
    if (!line.trim() || line.trimStart().startsWith('#')) continue;
    const p = line.trim().split(/\s+/).map(Number);
    if (p.length !== 7 || !p.every(Number.isFinite) || !Number.isSafeInteger(p[0]) || p[0] < 0 || !Number.isSafeInteger(p[6]) || p[6] < -1 || nodes.has(p[0])) throw new Error('Invalid or duplicate SWC node');
    nodes.set(p[0], { position: p.slice(2, 5).map(v => v * nmPerUnit), parent: p[6] });
  }
  if (!nodes.size) throw new Error('Empty skeleton');
  const branches = new Map(), segments = [];
  let length = 0, totalSegments = 0;
  // Parent chains form a forest. A cycle is corrupt geometry, not a branch.
  const done = new Set();
  for (const id of nodes.keys()) {
    const visiting = new Set(); let current = id;
    while (current !== -1 && !done.has(current)) {
      if (visiting.has(current)) throw new Error('SWC parent cycle');
      visiting.add(current);
      const node = nodes.get(current);
      if (!node) throw new Error('Missing SWC parent');
      current = node.parent;
    }
    for (const item of visiting) done.add(item);
  }
  for (const node of nodes.values()) {
    if (node.parent < 0) continue;
    const parent = nodes.get(node.parent);
    length += Math.hypot(...node.position.map((v, i) => v - parent.position[i]));
    totalSegments++; branches.set(node.parent, (branches.get(node.parent) || 0) + 1);
    if (segments.length < maxSegments) segments.push([...node.position, ...parent.position]);
  }
  return { id, specimen, units: 'nm', sourceNmPerUnit: nmPerUnit, points: nodes.size, segments,
    cableLengthNm: length, branchPoints: [...branches.values()].filter(n => n > 1).length,
    displayedSegments: segments.length, totalSegments, truncated: totalSegments > segments.length };
}
