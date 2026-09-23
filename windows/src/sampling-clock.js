// Observer clock: preserve fractional time and never invent historical samples.
export class SamplingClock {
  constructor(hz) {
    if (!Number.isFinite(hz) || hz <= 0) throw new RangeError('Invalid sampling frequency');
    this.period = 1 / hz; this.reset();
  }
  reset() { this.phase = 0; this.missed = 0; }
  advance(dt) {
    if (!Number.isFinite(dt) || dt < 0) throw new RangeError('Invalid sampling timestep');
    this.phase += dt;
    const count = Math.floor((this.phase + this.period * 1e-9) / this.period);
    if (!count) return false;
    this.phase = Math.max(0, this.phase - count * this.period);
    this.missed += count - 1;
    return true;
  }
}
