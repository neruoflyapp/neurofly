// performancetest.js -- telemetry must measure, never hide a slow frame.

import { AdaptiveRenderQuality, PerformanceMeter } from '../src/performance.js';
import { SimulationClock } from '../src/sim.js';

let failures = 0;
const near = (actual, expected, tolerance = 1e-8) => Math.abs(actual - expected) < tolerance;
function check(name, fn) {
  const [ok, detail] = fn();
  if (!ok) failures++;
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}: ${detail}`);
}

check('runtime meter reports exact throughput over its completed measurement window', () => {
  const meter = new PerformanceMeter(1);
  meter.noteSimulation({ simulatedSeconds: 0.75, computeSeconds: 0.25, spikes: 120, deliveries: 4800 });
  meter.noteSimulation({ droppedSeconds: 0.02 });
  for (let i = 0; i < 60; i++) meter.noteFrame(1 / 60);
  const p = meter.snapshot();
  const ok = near(p.fps, 60) && near(p.simulationRealtime, 0.75)
    && near(p.coreRealtime, 3) && near(p.neuralStepsPerSecond, 750)
    && near(p.spikesPerSecond, 120) && near(p.synapticDeliveriesPerSecond, 4800)
    && near(p.droppedSecondsPerSecond, 0.02);
  return [ok, `${p.fps.toFixed(1)} fps, ${p.simulationRealtime.toFixed(2)}x, ${p.neuralStepsPerSecond} ms/s`];
});

check('short incomplete windows retain the last committed measurement', () => {
  const meter = new PerformanceMeter(1);
  meter.noteFrame(1);
  const committed = meter.snapshot();
  meter.noteSimulation({ simulatedSeconds: 0.5 });
  meter.noteFrame(0.1);
  const held = meter.snapshot();
  return [held === committed && held.windowSeconds === 1,
    `held ${held.windowSeconds.toFixed(1)}s measurement until the next full window`];
});

check('simulation clock reports elapsed time it deliberately does not simulate', () => {
  const clock = new SimulationClock();
  let ticks = 0;
  clock.advance(0.25, () => { ticks++; });
  const dropped = clock.consumeDroppedSeconds();
  const cleared = clock.consumeDroppedSeconds();
  const ok = ticks === 12 && Math.abs(dropped - 0.15) < 1e-9 && cleared === 0;
  return [ok, `${ticks} fixed ticks, ${(dropped * 1000).toFixed(0)} ms reported as dropped`];
});

check('adaptive render quality protects real-time simulation before lowering display detail', () => {
  const quality = new AdaptiveRenderQuality({ minPixelRatio: 0.8, maxPixelRatio: 1.5 });
  const initial = quality.pixelRatio;
  const low = quality.observe({ fps: 30, simulationRealtime: 0.8, droppedSecondsPerSecond: 0.01 });
  const stable = new AdaptiveRenderQuality({ minPixelRatio: 0.8, maxPixelRatio: 1.5, startPixelRatio: 1.2 });
  stable.observe({ fps: 60, simulationRealtime: 1, droppedSecondsPerSecond: 0 });
  stable.observe({ fps: 60, simulationRealtime: 1, droppedSecondsPerSecond: 0 });
  const recovered = stable.observe({ fps: 60, simulationRealtime: 1, droppedSecondsPerSecond: 0 });
  return [low < initial && Math.abs(recovered - 1.25) < 1e-10,
    `${initial.toFixed(2)} -> ${low.toFixed(2)} under load; ${recovered.toFixed(2)} after headroom`];
});

console.log(failures === 0 ? 'ALL PERFORMANCE TESTS PASS' : `${failures} PERFORMANCE TESTS FAILED`);
process.exit(failures === 0 ? 0 : 1);
