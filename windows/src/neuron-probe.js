// Read-only anatomical index and live LIF-state inspection. No subscriptions,
// extra random draws, stimulation or simulation-state writes.
export class NeuronProbe {
  constructor(circuit) {
    this.neurons = circuit.neurons;
    this.ids = new Map(this.neurons.map((cell, index) => [String(cell.id), index]));
    this.incoming = new Uint32Array(this.neurons.length);
    this.outgoing = new Uint32Array(this.neurons.length);
    for (const [pre, post] of circuit.edges) { this.outgoing[pre]++; this.incoming[post]++; }
    this.index = 0;
  }
  select(query) {
    const text = String(query).trim();
    let index = this.ids.get(text);
    if (index === undefined && /^#\d+$/.test(text)) index = Number(text.slice(1));
    if (!Number.isSafeInteger(index) || index < 0 || index >= this.neurons.length) return false;
    this.index = index; return true;
  }
  snapshot(sim) {
    const index = this.index, cell = this.neurons[index];
    if (!cell || !sim || sim.n !== this.neurons.length) return null;
    return Object.freeze({
      index, id: typeof cell.id === 'string' || Number.isSafeInteger(cell.id) ? String(cell.id) : null,
      type: cell.cellType ?? cell.type ?? null, role: cell.role ?? null,
      side: cell.side ?? null, sensoryGroup: cell.sensoryGroup ?? cell.thermoGroup ?? null,
      incomingEdges: this.incoming[index], outgoingEdges: this.outgoing[index],
      membrane: sim.v[index], threshold: sim.threshold, refractoryMs: sim.refr[index], neuralTimeMs: sim.simMs,
    });
  }
}
