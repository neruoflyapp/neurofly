// history.js — a short rolling window of the real rates, so the dashboard can
// show the SHAPE of what she is doing and not only this instant's numbers.
//
// A bar that reads 60 Hz tells you a number. The same 60 Hz seen as the tail of
// a spike that rose in 20 ms and is already decaying tells you she was startled
// a moment ago and is settling — which is the thing an observer actually wants
// to know, and the thing that makes a row of numbers read as an animal rather
// than a gauge. Nothing here is smoothed, interpolated or embellished: it is
// the same measured values the bars show, kept for a while.
//
// A plain ring buffer per channel, fixed size, no allocation after
// construction — it is written every frame.

export class RingTrace {
  constructor(capacity) {
    this.capacity = capacity;
    this.data = new Float32Array(capacity);
    this.count = 0;     // how many slots hold real samples yet
    this.head = 0;      // next write position
  }

  push(v) {
    this.data[this.head] = Number.isFinite(v) ? v : 0;
    this.head = (this.head + 1) % this.capacity;
    if (this.count < this.capacity) this.count++;
  }

  // Oldest-to-newest, so a caller can draw left-to-right without knowing the
  // buffer has a seam in it. Index 0 is the oldest sample still held.
  at(i) {
    if (i < 0 || i >= this.count) return 0;
    const start = this.count < this.capacity ? 0 : this.head;
    return this.data[(start + i) % this.capacity];
  }

  max() {
    let m = 0;
    for (let i = 0; i < this.count; i++) {
      const v = this.at(i);
      if (v > m) m = v;
    }
    return m;
  }

  clear() { this.count = 0; this.head = 0; this.data.fill(0); }
}

// Several channels sharing one clock, so their samples line up in time and a
// spike in one can be read against what the others were doing at that moment.
export class MultiTrace {
  constructor(names, capacity) {
    this.names = names;
    this.capacity = capacity;
    this.traces = new Map(names.map((n) => [n, new RingTrace(capacity)]));
  }

  push(values) {
    for (const n of this.names) this.traces.get(n).push(values[n]);
  }

  get(name) { return this.traces.get(name); }
  get count() { return this.traces.get(this.names[0]).count; }
  clear() { for (const t of this.traces.values()) t.clear(); }
}
