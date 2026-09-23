// stats.js — the statistics the experiment protocols report. Small, exact
// where it can be, and each result says which test produced it.

export function mean(xs) { return xs.length ? xs.reduce((s, x) => s + x, 0) / xs.length : NaN; }

export function sd(xs) {
  if (xs.length < 2) return NaN;
  const m = mean(xs);
  return Math.sqrt(xs.reduce((s, x) => s + (x - m) ** 2, 0) / (xs.length - 1));
}

export function sem(xs) { return xs.length > 1 ? sd(xs) / Math.sqrt(xs.length) : NaN; }

export function median(xs) {
  if (!xs.length) return NaN;
  const s = [...xs].sort((a, b) => a - b);
  const h = Math.floor(s.length / 2);
  return s.length % 2 ? s[h] : (s[h - 1] + s[h]) / 2;
}

// Wilson score interval for a binomial proportion (95% by default). Unlike
// the textbook normal interval it stays inside [0, 1] and behaves at 0/n.
export function wilson(k, n, z = 1.959964) {
  if (!n) return { p: NaN, lo: NaN, hi: NaN };
  const p = k / n, z2 = z * z;
  const d = 1 + z2 / n;
  const c = (p + z2 / (2 * n)) / d;
  const h = (z / d) * Math.sqrt(p * (1 - p) / n + z2 / (4 * n * n));
  return { p, lo: Math.max(0, c - h), hi: Math.min(1, c + h) };
}

function logFactorial(n) {
  let s = 0;
  for (let i = 2; i <= n; i++) s += Math.log(i);
  return s;
}

// Fisher's exact test, two-sided, for the 2x2 table [[a, b], [c, d]]:
// the summed probability of every table with the same margins that is no
// more likely than the one observed.
export function fisherExact(a, b, c, d) {
  const r1 = a + b, r2 = c + d, c1 = a + c, n = r1 + r2;
  const lf = [];
  for (let i = 0; i <= n; i++) lf.push(i ? lf[i - 1] + Math.log(i) : 0);
  const prob = (x) => Math.exp(lf[r1] + lf[r2] + lf[c1] + lf[n - c1] - lf[n] - lf[x] - lf[r1 - x] - lf[c1 - x] - lf[r2 - c1 + x]);
  const observed = prob(a);
  let p = 0;
  for (let x = Math.max(0, c1 - r2); x <= Math.min(r1, c1); x++) {
    const px = prob(x);
    if (px <= observed * (1 + 1e-9)) p += px;
  }
  return Math.min(1, p);
}
void logFactorial;

// Mann-Whitney U with the normal approximation (tie-corrected), two-sided.
export function mannWhitney(xs, ys) {
  const n1 = xs.length, n2 = ys.length;
  if (!n1 || !n2) return { u: NaN, p: NaN };
  const all = [...xs.map((v) => ({ v, g: 0 })), ...ys.map((v) => ({ v, g: 1 }))].sort((a, b) => a.v - b.v);
  const ranks = new Array(all.length);
  let tieTerm = 0;
  for (let i = 0; i < all.length;) {
    let j = i;
    while (j + 1 < all.length && all[j + 1].v === all[i].v) j++;
    const r = (i + j) / 2 + 1;
    for (let k = i; k <= j; k++) ranks[k] = r;
    const tlen = j - i + 1;
    tieTerm += tlen ** 3 - tlen;
    i = j + 1;
  }
  let r1 = 0;
  all.forEach((x, i) => { if (x.g === 0) r1 += ranks[i]; });
  const u1 = r1 - n1 * (n1 + 1) / 2;
  const n = n1 + n2;
  const mu = n1 * n2 / 2;
  const sigma = Math.sqrt(n1 * n2 / 12 * ((n + 1) - tieTerm / (n * (n - 1))));
  if (!(sigma > 0)) return { u: u1, p: 1 };
  const z = (Math.abs(u1 - mu) - 0.5) / sigma;
  return { u: u1, p: Math.min(1, 2 * (1 - normalCdf(Math.max(0, z)))) };
}

export function normalCdf(z) {
  // Abramowitz & Stegun 7.1.26
  const t = 1 / (1 + 0.3275911 * Math.abs(z) / Math.SQRT2);
  const y = 1 - (((((1.061405429 * t - 1.453152027) * t) + 1.421413741) * t - 0.284496736) * t + 0.254829592) * t * Math.exp(-(z * z) / 2);
  return z >= 0 ? (1 + y) / 2 : (1 - y) / 2;
}

// Logistic psychometric fit p(x) = 1 / (1 + exp(-(x - x50) / s)) by maximum
// likelihood over a grid, then refined. Returns the 50% point and the slope
// scale, or null when the data do not bracket a transition.
export function fitLogistic(points) {
  // points: [{ x, k, n }]
  const valid = points.filter((p) => p.n > 0);
  if (valid.length < 3) return null;
  const xs = valid.map((p) => p.x);
  const lo = Math.min(...xs), hi = Math.max(...xs);
  const loglik = (x50, s) => {
    let L = 0;
    for (const p of valid) {
      const q = Math.min(1 - 1e-9, Math.max(1e-9, 1 / (1 + Math.exp(-(p.x - x50) / s))));
      L += p.k * Math.log(q) + (p.n - p.k) * Math.log(1 - q);
    }
    return L;
  };
  let best = { x50: (lo + hi) / 2, s: (hi - lo) / 4, L: -Infinity };
  const span = hi - lo || 1;
  for (let i = 0; i <= 60; i++) {
    const x50 = lo - span * 0.25 + (span * 1.5 * i) / 60;
    for (let j = 1; j <= 40; j++) {
      const s = (span * j) / 160;
      const L = loglik(x50, s);
      if (L > best.L) best = { x50, s, L };
    }
  }
  const pAtLo = valid.find((p) => p.x === lo), pAtHi = valid.find((p) => p.x === hi);
  const brackets = pAtLo && pAtHi && pAtLo.k / pAtLo.n < 0.5 && pAtHi.k / pAtHi.n > 0.5;
  return { x50: best.x50, slope: best.s, logLikelihood: best.L, brackets };
}

// Seeded bootstrap confidence interval of a statistic.
export function bootstrapCI(xs, stat = mean, { reps = 1000, seed = 1, alpha = 0.05 } = {}) {
  if (!xs.length) return { lo: NaN, hi: NaN };
  let state = seed >>> 0 || 1;
  const rand = () => { state = (Math.imul(state, 1664525) + 1013904223) >>> 0; return state / 4294967296; };
  const values = [];
  for (let r = 0; r < reps; r++) {
    const sample = xs.map(() => xs[Math.floor(rand() * xs.length)]);
    values.push(stat(sample));
  }
  values.sort((a, b) => a - b);
  return { lo: values[Math.floor((alpha / 2) * reps)], hi: values[Math.min(reps - 1, Math.floor((1 - alpha / 2) * reps))] };
}

// Least-squares line; slope with its standard error and a two-sided p value
// (normal approximation to t for the sample sizes used here).
export function linearFit(xs, ys) {
  const n = xs.length;
  if (n < 3) return null;
  const mx = mean(xs), my = mean(ys);
  let sxx = 0, sxy = 0;
  for (let i = 0; i < n; i++) { sxx += (xs[i] - mx) ** 2; sxy += (xs[i] - mx) * (ys[i] - my); }
  if (!(sxx > 0)) return null;
  const slope = sxy / sxx, intercept = my - slope * mx;
  let sse = 0;
  for (let i = 0; i < n; i++) sse += (ys[i] - (intercept + slope * xs[i])) ** 2;
  const se = Math.sqrt(sse / (n - 2) / sxx);
  const z = se > 0 ? slope / se : Infinity;
  return { slope, intercept, se, p: Math.min(1, 2 * (1 - normalCdf(Math.abs(z)))) };
}
