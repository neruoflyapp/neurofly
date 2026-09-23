// spatial.js — where in the terrarium she actually spends her time, and what
// her circuit was doing while she was there.
//
// The question this answers is a real one: does she come to treat some part of
// the world differently from another? That question is only worth asking if
// nothing here manufactures the answer. So this module invents no preference,
// no place memory and no bias — there is no mushroom body in the extracted
// circuit and nothing here pretends otherwise. It is a measuring instrument:
// it accumulates dwell time per cell and the time-weighted mean of whatever
// real quantities the caller hands it, and reports what it saw. If she shows
// no spatial structure at all, that is the honest reading and this will show
// it as an even map.
//
// Coordinates come in normalised (0..1 across the terrarium) so that a window
// resize, which rebuilds the terrarium at new dimensions, does not invalidate
// a map already collected.

export const DEFAULT_COLS = 24;
export const DEFAULT_ROWS = 16;

// How much recorded time before the preference statistic is allowed to report
// a number at all. See preferenceForLow — measured, not picked.
export const MIN_PREFERENCE_SECONDS = 600;

export class SpatialMap {
  constructor(cols = DEFAULT_COLS, rows = DEFAULT_ROWS, fields = ['fear', 'loom', 'sens', 'temp']) {
    this.cols = cols;
    this.rows = rows;
    this.fields = fields;
    this.dwell = new Float32Array(cols * rows);      // seconds per cell
    this.sums = new Map(fields.map((f) => [f, new Float32Array(cols * rows)]));
    this.events = new Float32Array(cols * rows);     // discrete events (takeoffs)
    this.totalTime = 0;
  }

  indexAt(u, v) {
    if (!(u >= 0) || !(v >= 0) || u > 1 || v > 1) return -1;
    const cx = Math.min(this.cols - 1, Math.floor(u * this.cols));
    const cy = Math.min(this.rows - 1, Math.floor(v * this.rows));
    return cy * this.cols + cx;
  }

  // dt-weighted so the statistic is "mean rate while she was here", not "mean
  // of however many samples happened to land here".
  add(u, v, dt, metrics) {
    const i = this.indexAt(u, v);
    if (i < 0 || !(dt > 0)) return -1;
    this.dwell[i] += dt;
    this.totalTime += dt;
    for (const f of this.fields) {
      const v2 = metrics ? metrics[f] : 0;
      if (Number.isFinite(v2)) this.sums.get(f)[i] += v2 * dt;
    }
    return i;
  }

  addEvent(u, v) {
    const i = this.indexAt(u, v);
    if (i >= 0) this.events[i] += 1;
    return i;
  }

  reset() {
    this.dwell.fill(0);
    this.events.fill(0);
    for (const arr of this.sums.values()) arr.fill(0);
    this.totalTime = 0;
  }

  // Time-weighted mean of a field in one cell. Null — not zero — where she has
  // never been: "no measurement here" and "measured, and it was zero" are
  // different statements and must not be drawn the same way.
  meanAt(field, i) {
    const t = this.dwell[i];
    if (!(t > 0)) return null;
    // Discrete events are reported as a RATE, not a count: a cell she happened
    // to spend longer in would otherwise show more takeoffs purely for having
    // been occupied longer, which says nothing about the place.
    if (field === 'events') return (this.events[i] / t) * 60;
    const arr = this.sums.get(field);
    return arr ? arr[i] / t : null;
  }

  // A 0..1 field for display, plus the peak it was scaled by, so a legend can
  // state what full intensity actually means instead of leaving it implied.
  // `coverage` is 0 where nothing was measured, so unvisited cells can be
  // drawn as absent rather than as a low value.
  // `spanFromMin` scales between the field's own min and max instead of from
  // zero. Right for an interval quantity like temperature, where zero is not a
  // meaningful floor and scaling from it would throw away half the colour
  // range on values the arena never reaches. Wrong for a rate, where zero IS
  // the floor and "no firing" must look different from "the least firing seen".
  normalizedField(field, spanFromMin = false) {
    const n = this.cols * this.rows;
    const out = new Float32Array(n);
    const coverage = new Float32Array(n);
    let peak = 0;
    let floor = Infinity;
    for (let i = 0; i < n; i++) {
      // Occupancy has the same "never measured" case as any other field: a
      // cell she has not entered has no dwell time, which is not the same
      // statement as "she was here for zero seconds" and must not be drawn
      // like one.
      const m = field === 'occupancy'
        ? (this.dwell[i] > 0 ? this.dwell[i] : null)
        : this.meanAt(field, i);
      if (m === null) continue;
      coverage[i] = 1;
      out[i] = m;
      if (m > peak) peak = m;
      if (m < floor) floor = m;
    }
    if (!Number.isFinite(floor)) floor = 0;
    const base = spanFromMin ? floor : 0;
    const span = peak - base;
    if (span > 0) {
      for (let i = 0; i < n; i++) if (coverage[i]) out[i] = (out[i] - base) / span;
    } else {
      // A single measured value, or all cells identical: everything sits at
      // the same place on the scale, which is the honest picture.
      for (let i = 0; i < n; i++) if (coverage[i]) out[i] = peak > 0 ? 1 : 0;
    }
    return { values: out, coverage, peak, floor: base };
  }

  // The map as data rather than as a picture: one row per cell she actually
  // visited, so the grid can be re-analysed, plotted or compared between runs
  // instead of only being looked at. Unvisited cells are omitted rather than
  // written as zeros — the same distinction the display makes, carried into
  // the file, so nothing downstream can average a place she never went.
  toCSV() {
    const head = 'cell_x,cell_y,u_center,v_center,dwell_s,'
      + `${this.fields.map((f) => `mean_${f}`).join(',')},takeoffs,takeoffs_per_min`;
    const lines = [head];
    for (let i = 0; i < this.dwell.length; i++) {
      const t = this.dwell[i];
      if (!(t > 0)) continue;
      const cx = i % this.cols, cy = Math.floor(i / this.cols);
      const means = this.fields.map((f) => {
        const m = this.meanAt(f, i);
        return m === null ? '' : String(Math.round(m * 10000) / 10000);
      });
      lines.push([
        cx, cy,
        ((cx + 0.5) / this.cols).toFixed(4), ((cy + 0.5) / this.rows).toFixed(4),
        Math.round(t * 1000) / 1000,
        ...means,
        this.events[i],
        Math.round((this.events[i] / t) * 60 * 10000) / 10000,
      ].join(','));
    }
    return `${lines.join('\n')}\n`;
  }

  // Share of total time spent in the half of visited cells with the lowest
  // mean of `field`. A fly that ends up mostly where her own circuit is
  // quietest scores above 0.5; no spatial structure scores about 0.5.
  //
  // MIN_SECONDS is not a guess. Replicated headless runs of the same flat,
  // spatially uniform world scored anywhere from 0.06 to 0.58 on four
  // simulated minutes each — i.e. over a few minutes this statistic is
  // dominated by wherever the walk happened to wander, and a short sample
  // will confidently show "structure" in a world that has none. Below the
  // threshold it returns null rather than a number that would be read as a
  // result. Even above it, short runs deserve the caveat the panel gives.
  preferenceForLow(field, minCells = 8, minSeconds = MIN_PREFERENCE_SECONDS) {
    const visited = [];
    for (let i = 0; i < this.dwell.length; i++) {
      const m = this.meanAt(field, i);
      if (m !== null) visited.push({ i, m, t: this.dwell[i] });
    }
    if (visited.length < minCells || this.totalTime < minSeconds) return null;
    visited.sort((a, b) => a.m - b.m);
    const half = Math.floor(visited.length / 2);
    let quietTime = 0;
    for (let k = 0; k < half; k++) quietTime += visited[k].t;
    return quietTime / this.totalTime;
  }
}
