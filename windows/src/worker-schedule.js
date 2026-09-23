// Scheduling only; the scientific step size remains 1/120 s. Avoid waking
// 500 times/s just to discover that no fixed step is due yet.
export function nextSimulationWake({ paused, accumulator = 0, speed = 1, computeMs = 0 }) {
  if (paused) return 50;
  if (!Number.isFinite(speed) || speed <= 0) return 8;
  const remainingMs = (1 / 120 - Math.max(0, accumulator)) * 1000 / speed - Math.max(0, computeMs);
  return Math.max(1, Math.min(16, remainingMs));
}
