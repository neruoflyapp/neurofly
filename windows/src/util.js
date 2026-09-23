// util.js — small math helpers shared by the body and behavior layers.

// Behaviour randomness. Every stochastic decision of the body and the world
// goes through random(). ClosedLoop installs its own seeded source around each
// step (withRandom), so a run is reproducible from its seed; outside a loop it
// falls back to the platform RNG.
let source = null;
export function random() { return source ? source() : Math.random(); }
export function rnd(lo, hi) { return lo + random() * (hi - lo); }
export function withRandom(fn, body) {
  const prev = source;
  source = fn;
  try { return body(); } finally { source = prev; }
}
// mulberry32: small, fast, and good enough for behavioural decisions.
export function seededRandom(seed) {
  let a = (seed >>> 0) || 0x9e3779b9;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
// The body's stream is derived from, but distinct from, the neural seed.
export function bodySeed(seed) { return ((Number(seed) >>> 0) ^ 0x85ebca6b) >>> 0; }

// Reference frame rate the existing constants were tuned at.
export const TUNED_HZ = 60;

// Frame-rate-independent form of the `Math.min(1, k * dt)` idiom used
// throughout flymodel.js, for both first-order lags and per-frame event
// probabilities.
//
// `k` keeps its original meaning, so call sites are unchanged: at dt = 1/60
// this returns exactly `k/60`, the value the constants were tuned against.
// Away from 60 Hz it follows the geometric decay those constants imply instead
// of the straight line, which is what made behaviour drift with refresh rate —
// at the 50 ms dt cap in app.js the old form converged 27% too fast
// (0.50 vs 0.39 for k = 10).
//
// Writing it as `1 - exp(-k*dt)` would also be frame-rate independent, but it
// is a *different* continuous process: it would change the 60 Hz behaviour by
// 2-8% across the k values used here. This form is the one that leaves 60 Hz
// alone.
export function lag(k, dt) {
  const perFrame = Math.min(1, k / TUNED_HZ);
  if (perFrame >= 1) return 1;
  return 1 - Math.pow(1 - perFrame, TUNED_HZ * dt);
}

export function clampf(v, lo, hi) { return Math.min(hi, Math.max(lo, v)); }

export function angleDiff(from, to) {
  let d = (to - from) % (2 * Math.PI);
  if (d > Math.PI) d -= 2 * Math.PI;
  if (d < -Math.PI) d += 2 * Math.PI;
  return d;
}

export function smoothstep(t) {
  const x = clampf(t, 0, 1);
  return x * x * (3 - 2 * x);
}

export function hypot(x, y) { return Math.hypot(x, y); }

// Floating-point remainder with the sign of the dividend (JS % semantics).
export function fmod(a, b) { return a % b; }
