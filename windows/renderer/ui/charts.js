// charts.js — canvas drawing for the live oscilloscope and experiment results.
// Plain 2D canvas, crisp at any device pixel ratio, themed from CSS variables.

const css = (name, fallback) => getComputedStyle(document.documentElement).getPropertyValue(name).trim() || fallback;

function fitCanvas(canvas) {
  const dpr = Math.min(2, window.devicePixelRatio || 1);
  const w = Math.max(10, canvas.clientWidth), h = Math.max(10, canvas.clientHeight);
  if (canvas.width !== Math.round(w * dpr) || canvas.height !== Math.round(h * dpr)) {
    canvas.width = Math.round(w * dpr); canvas.height = Math.round(h * dpr);
  }
  const ctx = canvas.getContext('2d');
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  return { ctx, w, h };
}

// Live multi-lane oscilloscope: one lane per channel, each with its own
// scale, like the traces of an electrophysiology rig. Samples arrive at
// 20 Hz simulated time from the worker.
export class Scope {
  constructor(canvas, { seconds = 20, hz = 20 } = {}) {
    this.canvas = canvas;
    this.capacity = seconds * hz;
    this.seconds = seconds;
    this.channels = [];
    this.data = new Map();
    this.times = [];
  }

  setChannels(channels) {
    this.channels = channels;       // [{ key, label, color, max }]
    for (const c of channels) if (!this.data.has(c.key)) this.data.set(c.key, []);
  }

  push(samples) {
    for (const s of samples) {
      this.times.push(s.t);
      for (const [key, arr] of this.data) arr.push(s[key] ?? 0);
    }
    const over = this.times.length - this.capacity;
    if (over > 0) {
      this.times.splice(0, over);
      for (const arr of this.data.values()) arr.splice(0, over);
    }
  }

  clear() { this.times = []; for (const arr of this.data.values()) arr.length = 0; }

  draw() {
    const { ctx, w, h } = fitCanvas(this.canvas);
    ctx.clearRect(0, 0, w, h);
    const lanes = this.channels.length;
    if (!lanes) return;
    const laneH = h / lanes;
    const labelW = 118, valueW = 58;
    const plotW = Math.max(10, w - labelW - valueW);
    const grid = css('--line', '#25322f');
    const muted = css('--muted', '#93a5a0');
    const ink = css('--ink', '#eaf2ee');
    ctx.font = '11px "Segoe UI Variable", "Segoe UI", sans-serif';
    ctx.textBaseline = 'middle';
    const n = this.times.length;
    const tNow = n ? this.times[n - 1] : 0;
    this.channels.forEach((c, li) => {
      const y0 = li * laneH;
      ctx.strokeStyle = grid; ctx.lineWidth = 1;
      ctx.beginPath(); ctx.moveTo(labelW, y0 + laneH - 0.5); ctx.lineTo(w - valueW, y0 + laneH - 0.5); ctx.stroke();
      ctx.fillStyle = c.color;
      ctx.fillRect(8, y0 + laneH / 2 - 3, 6, 6);
      ctx.fillStyle = muted;
      ctx.fillText(c.label, 20, y0 + laneH / 2);
      const arr = this.data.get(c.key) || [];
      let peak = c.max || 1;
      for (const v of arr) if (v > peak) peak = v;
      if (n > 1) {
        ctx.beginPath();
        for (let i = 0; i < n; i++) {
          const x = labelW + plotW - ((tNow - this.times[i]) / this.seconds) * plotW;
          const y = y0 + laneH - 3 - (arr[i] / peak) * (laneH - 7);
          if (i === 0) ctx.moveTo(x, y); else ctx.lineTo(x, y);
        }
        ctx.strokeStyle = c.color; ctx.lineWidth = 1.4; ctx.stroke();
        // soft fill under the trace
        ctx.lineTo(labelW + plotW, y0 + laneH - 3);
        ctx.lineTo(labelW + plotW - ((tNow - this.times[0]) / this.seconds) * plotW, y0 + laneH - 3);
        ctx.closePath();
        ctx.globalAlpha = 0.12; ctx.fillStyle = c.color; ctx.fill(); ctx.globalAlpha = 1;
      }
      const last = arr.length ? arr[arr.length - 1] : 0;
      ctx.fillStyle = ink;
      ctx.textAlign = 'right';
      ctx.fillText(`${last.toFixed(last < 10 ? 1 : 0)} Hz`, w - 6, y0 + laneH / 2);
      ctx.textAlign = 'left';
    });
    ctx.fillStyle = muted;
    ctx.textAlign = 'right';
    ctx.fillText(`${this.seconds} s`, w - valueW - 4, 8);
    ctx.textAlign = 'left';
  }
}

// Experiment result: curves with confidence bands, or bars with error bars.
export function drawResult(canvas, chart, { t = (s) => s } = {}) {
  const { ctx, w, h } = fitCanvas(canvas);
  ctx.clearRect(0, 0, w, h);
  if (!chart) return;
  const accent = css('--accent', '#00ff41');
  const second = css('--accent-2', '#56c8ff');
  const grid = css('--line', '#25322f');
  const muted = css('--muted', '#93a5a0');
  const ink = css('--ink', '#eaf2ee');
  const colors = [accent, second, '#ffb347', '#ff6b8b'];
  const pad = { l: 46, r: 14, t: 14, b: 38 };
  const pw = w - pad.l - pad.r, ph = h - pad.t - pad.b;
  let yMax = 0;
  for (const s of chart.series) for (let i = 0; i < s.y.length; i++) yMax = Math.max(yMax, s.hi?.[i] ?? 0, (s.y[i] ?? 0) + (s.err?.[i] ?? 0));
  if (chart.markers) for (const m of chart.markers) yMax = Math.max(yMax, m.y);
  const probability = /probab|P\(|fraction|Fraction|increase|Increase/i.test(chart.yLabel);
  yMax = probability ? 1 : (yMax > 0 ? yMax * 1.12 : 1);
  const Y = (v) => pad.t + ph - (v / yMax) * ph;
  ctx.font = '11px "Segoe UI Variable", "Segoe UI", sans-serif';
  ctx.strokeStyle = grid; ctx.fillStyle = muted; ctx.lineWidth = 1;
  for (let k = 0; k <= 4; k++) {
    const v = (yMax * k) / 4, y = Y(v);
    ctx.beginPath(); ctx.moveTo(pad.l, y + 0.5); ctx.lineTo(w - pad.r, y + 0.5); ctx.stroke();
    ctx.textAlign = 'right'; ctx.textBaseline = 'middle';
    ctx.fillText(probability ? `${Math.round(v * 100)}%` : v.toFixed(v < 10 ? 1 : 0), pad.l - 6, y);
  }
  ctx.textAlign = 'center'; ctx.textBaseline = 'alphabetic';
  ctx.fillText(t(chart.xLabel), pad.l + pw / 2, h - 4);
  if (chart.type === 'curve') {
    const allX = chart.series.flatMap((s) => s.x || chart.x);
    const xMin = Math.min(...allX), xMax = Math.max(...allX);
    const X = (v) => pad.l + ((v - xMin) / Math.max(1e-9, xMax - xMin)) * pw;
    ctx.textBaseline = 'top';
    for (const v of chart.x) { ctx.fillStyle = muted; ctx.fillText(String(v), X(v), h - pad.b + 6); }
    chart.series.forEach((s, si) => {
      const xs = s.x || chart.x, color = colors[si % colors.length];
      if (s.lo && s.hi) {
        ctx.beginPath();
        xs.forEach((x, i) => { const px = X(x), py = Y(s.hi[i]); if (i === 0) ctx.moveTo(px, py); else ctx.lineTo(px, py); });
        for (let i = xs.length - 1; i >= 0; i--) ctx.lineTo(X(xs[i]), Y(s.lo[i]));
        ctx.closePath(); ctx.globalAlpha = 0.14; ctx.fillStyle = color; ctx.fill(); ctx.globalAlpha = 1;
      }
      ctx.beginPath();
      xs.forEach((x, i) => { const px = X(x), py = Y(s.y[i] ?? 0); if (i === 0) ctx.moveTo(px, py); else ctx.lineTo(px, py); });
      ctx.strokeStyle = color; ctx.lineWidth = 2; ctx.stroke();
      ctx.fillStyle = color;
      xs.forEach((x, i) => { ctx.beginPath(); ctx.arc(X(x), Y(s.y[i] ?? 0), 3, 0, Math.PI * 2); ctx.fill(); });
    });
    if (chart.fit && Number.isFinite(chart.fit.x50) && chart.fit.x50 >= xMin && chart.fit.x50 <= xMax) {
      const px = X(chart.fit.x50);
      ctx.setLineDash([4, 4]); ctx.strokeStyle = ink; ctx.globalAlpha = 0.6;
      ctx.beginPath(); ctx.moveTo(px, pad.t); ctx.lineTo(px, pad.t + ph); ctx.stroke();
      ctx.setLineDash([]); ctx.globalAlpha = 1;
      ctx.fillStyle = ink; ctx.textBaseline = 'top'; ctx.fillText(`50% @ ${chart.fit.x50.toFixed(2)}`, px, pad.t + 2);
    }
    if (chart.markers) {
      chart.markers.forEach((m, mi) => {
        const px = X(m.x) - 10 - mi * 10, py = Y(m.y);
        ctx.fillStyle = colors[(mi + 2) % colors.length];
        ctx.beginPath(); ctx.moveTo(px, py - 5); ctx.lineTo(px + 5, py); ctx.lineTo(px, py + 5); ctx.lineTo(px - 5, py); ctx.closePath(); ctx.fill();
      });
    }
  } else {
    const n = chart.x.length, series = chart.series.length;
    const slot = pw / n, bw = Math.min(46, (slot * 0.7) / series);
    chart.x.forEach((label, i) => {
      ctx.fillStyle = muted; ctx.textBaseline = 'top';
      const text = t(String(label));
      ctx.fillText(text.length > 16 ? `${text.slice(0, 15)}…` : text, pad.l + slot * (i + 0.5), h - pad.b + 6);
      chart.series.forEach((s, si) => {
        const x = pad.l + slot * (i + 0.5) - (series * bw) / 2 + si * bw;
        const v = s.y[i] ?? 0;
        const color = colors[si % colors.length];
        ctx.fillStyle = color; ctx.globalAlpha = 0.85;
        ctx.fillRect(x + 2, Y(v), bw - 4, pad.t + ph - Y(v));
        ctx.globalAlpha = 1;
        const lo = s.lo ? s.lo[i] : s.err ? v - s.err[i] : null;
        const hi = s.hi ? s.hi[i] : s.err ? v + s.err[i] : null;
        if (Number.isFinite(lo) && Number.isFinite(hi)) {
          ctx.strokeStyle = ink; ctx.lineWidth = 1.2;
          const cx = x + bw / 2;
          ctx.beginPath(); ctx.moveTo(cx, Y(Math.max(0, lo))); ctx.lineTo(cx, Y(hi)); ctx.stroke();
          ctx.beginPath(); ctx.moveTo(cx - 4, Y(hi)); ctx.lineTo(cx + 4, Y(hi)); ctx.stroke();
        }
      });
    });
  }
  // legend
  ctx.textAlign = 'left'; ctx.textBaseline = 'middle';
  let lx = pad.l + 4;
  chart.series.forEach((s, si) => {
    ctx.fillStyle = colors[si % colors.length]; ctx.fillRect(lx, pad.t + 4, 10, 3);
    ctx.fillStyle = ink; const label = t(s.label); ctx.fillText(label, lx + 14, pad.t + 6);
    lx += 24 + ctx.measureText(label).width;
  });
  (chart.markers || []).forEach((m, mi) => {
    ctx.fillStyle = colors[(mi + 2) % colors.length]; ctx.fillRect(lx, pad.t + 2, 7, 7);
    ctx.fillStyle = ink; const label = t(m.label); ctx.fillText(label, lx + 11, pad.t + 6);
    lx += 22 + ctx.measureText(label).width;
  });
}
