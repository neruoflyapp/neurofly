// Reizplan provenance, separate from cumulative synaptic learning.
export class LearningSession {
  constructor() { this.reset(); }
  reset() { this.history = []; this.sim = null; }
  get active() { return this.history.find(p => p.status === 'scheduled' || p.status === 'running') ?? null; }
  start(sim, pairOrder) {
    this.poll(sim.simMs);
    if (this.active) return { ok: false, reason: 'A stimulus schedule is already running.' };
    if (!sim.plasticitySummary().enabled) return { ok: false, reason: 'Lernkern ist ausgeschaltet.' };
    if (!['pre-before-post', 'post-before-pre'].includes(pairOrder)) return { ok: false, reason: 'Invalid pairing order.' };
    const visual = [...sim.loomLeft, ...sim.loomRight];
    if (!visual.length || !sim.gf.length) return { ok: false, reason: 'A required neuron population is missing.' };
    if (sim.scheduledStims.length + 32 > 512) return { ok: false, reason: 'Reizwarteschlange voll.' };
    const before = new Set(sim.scheduledStims);
    const rollback = () => { sim.scheduledStims = sim.scheduledStims.filter(s => before.has(s)); };
    const id = this.history.length + 1;
    for (let trial = 0; trial < 16; trial++) {
      const first = pairOrder === 'pre-before-post' ? visual : sim.gf;
      const second = pairOrder === 'pre-before-post' ? sim.gf : visual;
      if (!sim.scheduleStimulate(first, 1.25, trial * 140 + 1, 3)
        || !sim.scheduleStimulate(second, 1.25, trial * 140 + 9, 3)) {
        rollback(); return { ok: false, reason: 'Stimulus schedule rejected; no pairing was added.' };
      }
    }
    for (const s of sim.scheduledStims) if (!before.has(s)) s.learningSessionId = id;
    const summary = sim.plasticitySummary();
    const protocol = {
      id, name: pairOrder === 'pre-before-post' ? 'visual-to-flight-alarm' : 'flight-alarm-to-visual-control',
      pairOrder, trials: 16, intervalMs: 140, delayMs: 8, durationMs: 3, strength: 1.25,
      scheduledAtNeuralMs: sim.simMs, startedAtNeuralMs: sim.simMs + 1, endNeuralMs: sim.simMs + 2111,
      status: 'scheduled', updatesAtStart: summary.updates, updatesAtEnd: null,
      rule: { mechanism: summary.mechanism, tauMs: summary.tauMs, learningRate: summary.learningRate, maxRelativeChange: summary.maxRelativeChange },
      context: 'Closed-loop environment remains active; changes are not uniquely attributable to this stimulus plan.',
    };
    this.sim = sim; this.history.push(protocol);
    return { ok: true, protocol };
  }
  poll(ms) {
    const p = this.active;
    if (!p) return;
    if (ms >= p.endNeuralMs) {
      p.status = 'completed'; p.observedCompletionNeuralMs = ms;
      p.updatesAtEnd = this.sim.plasticitySummary().updates;
    } else if (ms >= p.startedAtNeuralMs) p.status = 'running';
  }
  abort(sim, reason = 'aborted') {
    this.poll(sim?.simMs);
    const p = this.active;
    if (!p) return;
    for (const key of ['scheduledStims', 'activeStims']) sim[key] = sim[key].filter(s => s.learningSessionId !== p.id);
    p.status = 'aborted'; p.abortReason = reason; p.abortedAtNeuralMs = sim.simMs;
    p.updatesAtEnd = sim.plasticitySummary().updates;
  }
}
