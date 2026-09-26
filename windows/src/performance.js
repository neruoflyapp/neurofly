// performance.js -- measured runtime telemetry for the simulation, not a
// guessed "performance score".  It separates wall-clock throughput (what the
// user experiences) from LIF-core throughput (what the neural solver costs).

export class PerformanceMeter {
  constructor(commitSeconds = 0.5) {
    this.commitSeconds = Math.max(0.05, commitSeconds);
    this.bucket = this._emptyBucket();
    this.last = this._emptySnapshot();
  }

  _emptyBucket() {
    return { wall: 0, frames: 0, simulated: 0, compute: 0, spikes: 0, deliveries: 0, dropped: 0 };
  }

  _emptySnapshot() {
    return {
      windowSeconds: 0,
      fps: 0,
      simulationRealtime: 0,
      coreRealtime: 0,
      neuralStepsPerSecond: 0,
      spikesPerSecond: 0,
      synapticDeliveriesPerSecond: 0,
      droppedSecondsPerSecond: 0,
    };
  }

  noteFrame(wallSeconds) {
    if (!(wallSeconds > 0) || !Number.isFinite(wallSeconds)) return this.last;
    this.bucket.wall += wallSeconds;
    this.bucket.frames++;
    return this.snapshot();
  }

  noteSimulation({ simulatedSeconds = 0, computeSeconds = 0, spikes = 0, deliveries = 0, droppedSeconds = 0 } = {}) {
    if (Number.isFinite(simulatedSeconds) && simulatedSeconds > 0) this.bucket.simulated += simulatedSeconds;
    if (Number.isFinite(computeSeconds) && computeSeconds > 0) this.bucket.compute += computeSeconds;
    if (Number.isFinite(spikes) && spikes > 0) this.bucket.spikes += spikes;
    if (Number.isFinite(deliveries) && deliveries > 0) this.bucket.deliveries += deliveries;
    if (Number.isFinite(droppedSeconds) && droppedSeconds > 0) this.bucket.dropped += droppedSeconds;
  }

  snapshot(force = false) {
    const b = this.bucket;
    if (b.wall < this.commitSeconds && !force) return this.last;
    if (!(b.wall > 0)) return this.last;
    this.last = {
      windowSeconds: b.wall,
      fps: b.frames / b.wall,
      simulationRealtime: b.simulated / b.wall,
      coreRealtime: b.compute > 0 ? b.simulated / b.compute : 0,
      neuralStepsPerSecond: b.simulated * 1000 / b.wall,
      spikesPerSecond: b.spikes / b.wall,
      synapticDeliveriesPerSecond: b.deliveries / b.wall,
      droppedSecondsPerSecond: b.dropped / b.wall,
    };
    this.bucket = this._emptyBucket();
    return this.last;
  }

  reset() {
    this.bucket = this._emptyBucket();
    this.last = this._emptySnapshot();
  }
}

// A slow or interrupted run must not be mistaken for a quiet biological state.
// These are observations about the numerical clock, not claims about the fly.
export function classifyRunTiming({ paused = false, speed = 1, perf = null } = {}) {
  const requested = Number.isFinite(speed) && speed > 0 ? speed : 1;
  const measured = Number.isFinite(perf?.simulationRealtime) ? Math.max(0, perf.simulationRealtime) : null;
  const runMissing = Number.isFinite(perf?.runDroppedSimulationSeconds)
    ? perf.runDroppedSimulationSeconds : perf?.totalDroppedSimulationSeconds;
  const missing = Number.isFinite(runMissing) ? Math.max(0, runMissing) : 0;
  if (paused) return 'paused';
  if (missing > 0.000001) return 'gap';
  if (!Number.isFinite(perf?.windowSeconds) || perf.windowSeconds <= 0 || measured === null) return 'measuring';
  if (measured < requested * 0.9) return 'behind';
  return 'on-pace';
}

// GPU work is observer-side only. This controller can lower the number of
// shaded pixels when the measured simulation is falling behind, then restore
// them after sustained headroom. It never changes a neural timestep, input,
// random draw or anatomical edge -- only how expensively the two canvases are
// drawn for the human observer.
export class AdaptiveRenderQuality {
  constructor({ minPixelRatio = 0.75, maxPixelRatio = 1.5, startPixelRatio = maxPixelRatio } = {}) {
    this.minPixelRatio = Math.max(0.25, Math.min(minPixelRatio, maxPixelRatio));
    this.maxPixelRatio = Math.max(this.minPixelRatio, maxPixelRatio);
    this.pixelRatio = Math.min(this.maxPixelRatio, Math.max(this.minPixelRatio, startPixelRatio));
    this.headroomWindows = 0;
  }

  observe({ fps = 0, simulationRealtime = 0, droppedSecondsPerSecond = 0 } = {}) {
    const overloaded = fps < 42 || simulationRealtime < 0.92 || droppedSecondsPerSecond > 0.0005;
    if (overloaded) {
      this.headroomWindows = 0;
      this.pixelRatio = Math.max(this.minPixelRatio, this.pixelRatio - 0.1);
      return this.pixelRatio;
    }
    const healthy = fps >= 58 && simulationRealtime >= 0.98 && droppedSecondsPerSecond <= 0.0005;
    this.headroomWindows = healthy ? this.headroomWindows + 1 : 0;
    if (this.headroomWindows >= 3) {
      this.pixelRatio = Math.min(this.maxPixelRatio, this.pixelRatio + 0.05);
      this.headroomWindows = 0;
    }
    return this.pixelRatio;
  }
}
