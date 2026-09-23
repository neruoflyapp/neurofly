// Bounded, immutable observation log. Never used to drive the simulation.
export class ExperimentJournal {
  constructor(capacity = 512) {
    if (!Number.isSafeInteger(capacity) || capacity < 1) throw new RangeError('Invalid journal capacity');
    this.capacity = capacity; this.sequence = 0; this.events = []; this.dropped = 0;
  }
  add(kind, context, details = {}) {
    if (typeof kind !== 'string' || !kind) throw new TypeError('Event kind required');
    // Detach metadata from live objects; missing numerical values become null,
    // never zero. Callers pass compact metadata only, not a circuit or DOM.
    const event = JSON.parse(JSON.stringify({ ...context, sequence: this.sequence + 1, kind, details }));
    const freeze = value => { if (value && typeof value === 'object') { Object.values(value).forEach(freeze); Object.freeze(value); } return value; };
    freeze(event);
    this.sequence++;
    if (this.events.length === this.capacity) { this.events.shift(); this.dropped++; }
    this.events.push(event);
    return event;
  }
  snapshot() {
    return Object.freeze({
      schema: 'neurofly-interventions/1', totalEvents: this.sequence,
      droppedEvents: this.dropped, capacity: this.capacity,
      completeRetainedHistory: this.dropped === 0,
      coverage: 'Explicit panel controls, pause, neural restarts, body death, learning plans, recording boundaries and arena resize.',
      limitations: 'Not a replay: continuous mouse motion, ambient OS inputs, every stochastic draw and all world interactions are not recorded.',
      events: Object.freeze([...this.events]),
    });
  }
}
