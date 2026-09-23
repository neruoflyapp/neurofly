// brain.js — the connectome, in 3D, as it fires.
//
// Every simulated neuron sits at its real FlyWire soma position; ~23,000
// further FlyWire somata give anatomical context. Spikes arrive in each
// snapshot (a drawing sample — every spike counts in the simulation) and
// flash their neuron and its real outgoing synapses. Populations can be
// highlighted — the cells a causal explanation names, or the ones picked in
// the circuit explorer — so what the text says is visible in the tissue.

import * as THREE from '../../node_modules/three/build/three.module.js';
import { clampf } from '../../src/util.js';
import { t } from '../i18n.js';

const CLASS_COLORS = [
  [0.16, 0.22, 0.34], [0.45, 0.33, 0.16], [0.14, 0.36, 0.34], [0.10, 0.48, 0.62],
  [0.38, 0.22, 0.55], [0.62, 0.28, 0.10], [0.20, 0.45, 0.18], [0.55, 0.14, 0.14],
  [0.50, 0.25, 0.40],
];
export const GROUP_COLORS = {
  loom: [0.15, 0.85, 1.0], gf: [1.0, 0.95, 0.4], dna: [1.0, 0.55, 0.10], mdn: [1.0, 0.20, 0.80],
  fwd: [0.25, 1.0, 0.35], groom: [0.75, 0.55, 1.0], escw: [1.0, 0.35, 0.25],
  hot: [1.0, 0.28, 0.08], cold: [0.35, 0.6, 1.0], thermoRelay: [0.9, 0.7, 0.5],
  sugar: [1.0, 0.86, 0.3], bitter: [0.45, 0.9, 0.35], tasteRelay: [0.85, 0.75, 0.45], proboscis: [1.0, 0.6, 0.15],
  joF: [0.4, 1.0, 0.85], groomRelay: [0.55, 0.8, 0.75], dng12: [0.8, 0.45, 1.0],
};

// Named groups with their own legend row and live rate. `match` decides
// membership from a circuit neuron record; `rate` names the snapshot rate.
const NAMED = [
  { key: 'loom', label: 'Threat detectors LC4/LPLC2', match: (nr) => nr.role === 'lc4' || nr.role === 'lplc2', rate: 'loom' },
  { key: 'gf', label: 'Giant fiber (escape)', match: (nr) => nr.role === 'gf', rate: 'gf' },
  { key: 'dna', label: 'Steering DNa01/02', match: (nr) => nr.role === 'dna01' || nr.role === 'dna02', rate: (r) => (r.dnaL + r.dnaR) / 2 },
  { key: 'mdn', label: 'Backward walking MDN', match: (nr) => nr.role === 'mdn', rate: 'mdn' },
  { key: 'fwd', label: 'Walking DNp09', match: (nr) => nr.role === 'dnp09', rate: 'fwd' },
  { key: 'groom', label: 'Leg rubbing DNg11', match: (nr) => nr.role === 'dng11', rate: 'groom' },
  { key: 'escw', label: 'Escape wing DNp02/04/11', match: (nr) => nr.role === 'escw', rate: 'escw' },
  { key: 'hot', label: 'Hot cells', match: (nr) => nr.thermoGroup === 'hot', rate: 'hot' },
  { key: 'cold', label: 'Cold cells', match: (nr) => nr.thermoGroup === 'cold', rate: 'cold' },
  { key: 'thermoRelay', label: 'Thermosensory relays', match: (nr) => nr.extension === 'thermo' && nr.layer === 1, rate: (r) => (r.relayHot + r.relayCold) / 2 },
  { key: 'sugar', label: 'Sugar/water taste neurons', match: (nr) => nr.extension === 'taste' && nr.sensoryGroup === 'sugar', rate: 'sugar' },
  { key: 'bitter', label: 'Bitter taste neurons', match: (nr) => nr.extension === 'taste' && nr.sensoryGroup === 'bitter', rate: 'bitter' },
  { key: 'tasteRelay', label: 'Taste relays', match: (nr) => nr.extension === 'taste' && nr.pathRole, rate: 'tasteRelay' },
  { key: 'proboscis', label: 'Proboscis & feeding motor neurons', match: (nr) => nr.extension === 'taste' && nr.motorGroup, rate: 'proboscis' },
  { key: 'joF', label: 'JO-F grooming mechanosensors', match: (nr) => nr.extension === 'grooming' && nr.sensoryGroup === 'jof', rate: 'joF' },
  { key: 'groomRelay', label: 'Grooming relays', match: (nr) => nr.extension === 'grooming' && nr.pathRole, rate: 'groomRelay' },
  { key: 'dng12', label: 'Head grooming DNg12', match: (nr) => nr.extension === 'grooming' && nr.motorGroup === 'dng12', rate: 'dng12' },
];

const SUPER_CLASS_LABELS = {
  optic: 'Optic lobe', central: 'Central brain', sensory: 'Sensory', visual_projection: 'Visual projection',
  visual_centrifugal: 'Visual centrifugal', descending: 'Descending (to the nerve cord)', ascending: 'Ascending (from the nerve cord)',
  motor: 'Motor', endocrine: 'Endocrine',
};

function pointCloud(positions, colors, size, opacity) {
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.BufferAttribute(positions, 3));
  g.setAttribute('color', new THREE.BufferAttribute(colors, 3));
  // Normal alpha compositing preserves anatomical colour and fine structure in
  // dense central regions. Additive blending saturated thousands of overlapping
  // somata into a white patch, hiding the measured positions and live flashes.
  return new THREE.Points(g, new THREE.PointsMaterial({ size, sizeAttenuation: true, vertexColors: true,
    opacity, blending: THREE.NormalBlending, depthWrite: false, depthTest: false, transparent: true }));
}

export class BrainView {
  constructor(container, { points, circuit, onPick }) {
    this.container = container;
    this.onPick = onPick;
    this.circuit = circuit;
    // Native anatomy-only datasets do not establish functional signs for
    // every edge. Render those links neutrally instead of as excitatory.
    this.edgeSignKnown = circuit.edgeSignKnown !== false;
    this.scene = new THREE.Scene();
    this.scene.background = new THREE.Color().setRGB(0.028, 0.04, 0.038, THREE.SRGBColorSpace);
    this.group = new THREE.Group();
    this.group.rotation.x = -0.15;
    this.scene.add(this.group);
    const w = Math.max(50, container.clientWidth), h = Math.max(50, container.clientHeight);
    this.camera = new THREE.PerspectiveCamera(46, w / h, 1, 120);
    this.camera.position.set(0, 0.6, 29);
    this.zoom = 29;
    this.renderer = new THREE.WebGLRenderer({ antialias: true, powerPreference: 'high-performance' });
    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 1.5));
    this.renderer.setSize(w, h);
    this.renderer.outputColorSpace = THREE.SRGBColorSpace;
    container.appendChild(this.renderer.domElement);
    this.renderer.domElement.addEventListener('webglcontextlost', (e) => e.preventDefault(), false);
    this.groups = [];
    this.visible = new Set();
    this.flashPool = []; this.flashState = []; this.flashNext = 0;
    this.activeGlow = new Set();
    this.fear = 0;
    this.idle = 0; this.hovering = false; this.dragging = false;
    this.pending = 0; this.last = null;
    this.flashBudget = 24;
    this.highlight = null;
    this.synapsesVisible = true;
    this._build(points, circuit);
    this._bind();
    new ResizeObserver(() => this.resize()).observe(container);
  }

  _build(points, circuit) {
    const classNames = points?.classes || [];
    // tier 1: anatomical context, one cloud per real super_class
    const byClass = [];
    for (const p of points?.points || []) {
      if (p.length < 4) continue;
      (byClass[p[3] | 0] ||= []).push(p);
    }
    byClass.forEach((list, ci) => {
      if (!list?.length) return;
      const pos = new Float32Array(list.length * 3), col = new Float32Array(list.length * 3);
      const c = CLASS_COLORS[ci] || [0.3, 0.3, 0.3];
      list.forEach((p, k) => { pos.set([p[0], p[1], p[2]], 3 * k); col.set(c, 3 * k); });
      const cloud = pointCloud(pos, col.map((v) => v * 0.55), 0.09, 0.16);
      this.group.add(cloud);
      this.groups.push({ key: `bg-${ci}`, tier: 'bg', object: cloud, count: list.length, color: c,
        label: SUPER_CLASS_LABELS[classNames[ci]] || classNames[ci] || `class ${ci}` });
    });
    const n = circuit.neurons.length;
    const cpos = new Float32Array(n * 3);
    circuit.neurons.forEach((nr, i) => { const p = nr.pos?.length === 3 ? nr.pos : [0, 0, 0]; cpos.set(p, 3 * i); });
    this.positions = cpos;
    this.n = n;
    this.groupOf = new Int32Array(n).fill(-1);
    // tier 2: named, individually understood populations
    for (const spec of NAMED) {
      const idx = [];
      circuit.neurons.forEach((nr, i) => { if (this.groupOf[i] < 0 && spec.match(nr)) idx.push(i); });
      if (!idx.length) continue;
      const color = GROUP_COLORS[spec.key];
      const pos = new Float32Array(idx.length * 3), col = new Float32Array(idx.length * 3);
      idx.forEach((i, k) => { pos.set(cpos.subarray(3 * i, 3 * i + 3), 3 * k); col.set(color, 3 * k); });
      const cloud = pointCloud(pos, col, spec.key.endsWith('Relay') ? 0.3 : 0.42, 0.85);
      this.group.add(cloud);
      const gi = this.groups.length;
      this.groups.push({ key: spec.key, tier: 'named', object: cloud, count: idx.length, color, label: spec.label, rate: spec.rate, indices: idx });
      for (const i of idx) this.groupOf[i] = gi;
    }
    // tier 3: unnamed partners grouped by their real super_class
    const other = new Map();
    circuit.neurons.forEach((nr, i) => {
      if (this.groupOf[i] >= 0) return;
      const t0 = nr.type || 'unknown';
      if (!other.has(t0)) other.set(t0, []);
      other.get(t0).push(i);
    });
    for (const [type, idx] of other) {
      const ci = classNames.indexOf(type);
      const c = ci >= 0 ? (CLASS_COLORS[ci] || [0.45, 0.45, 0.5]) : [0.45, 0.45, 0.5];
      const pos = new Float32Array(idx.length * 3), col = new Float32Array(idx.length * 3);
      idx.forEach((i, k) => { pos.set(cpos.subarray(3 * i, 3 * i + 3), 3 * k); col.set(c, 3 * k); });
      const cloud = pointCloud(pos, col.map((v) => v * 0.7), 0.2, 0.42);
      this.group.add(cloud);
      const gi = this.groups.length;
      this.groups.push({ key: `other-${type}`, tier: 'other', object: cloud, count: idx.length, color: c,
        label: SUPER_CLASS_LABELS[type] || type, suffix: 'unnamed partners', indices: idx });
      for (const i of idx) this.groupOf[i] = gi;
    }
    this.groups.forEach((_, gi) => this.visible.add(gi));

    // synapses: every edge can glow when it carries a spike; a deterministic
    // stride sample is drawn permanently as the resting web
    const edges = circuit.edges;
    this.edgeFrom = new Int32Array(edges.length); this.edgeTo = new Int32Array(edges.length); this.edgeExc = new Uint8Array(edges.length);
    const out = Array.from({ length: n }, () => []);
    edges.forEach((e, k) => { this.edgeFrom[k] = e[0]; this.edgeTo[k] = e[1]; this.edgeExc[k] = e[2] >= 0 ? 1 : 0; out[e[0]].push(k); });
    this.outEdges = out.map((a) => Int32Array.from(a));
    this.edgeGlow = new Float32Array(edges.length);
    this.synapseLines = new THREE.LineSegments(new THREE.BufferGeometry(), new THREE.LineBasicMaterial({ vertexColors: true, transparent: true, opacity: 0.055, depthWrite: false }));
    this.group.add(this.synapseLines);
    this.rebuildAmbient();
    const GLOW = 1500;
    this.GLOW = GLOW;
    const glowGeo = new THREE.BufferGeometry();
    glowGeo.setAttribute('position', new THREE.BufferAttribute(new Float32Array(GLOW * 6), 3).setUsage(THREE.DynamicDrawUsage));
    glowGeo.setAttribute('color', new THREE.BufferAttribute(new Float32Array(GLOW * 6), 3).setUsage(THREE.DynamicDrawUsage));
    glowGeo.setDrawRange(0, 0);
    this.glowLines = new THREE.LineSegments(glowGeo, new THREE.LineBasicMaterial({ vertexColors: true, transparent: true, blending: THREE.AdditiveBlending, depthWrite: false }));
    this.group.add(this.glowLines);
    // giant fiber markers and the flash pool
    const gfGeo = new THREE.SphereGeometry(0.28, 12, 10);
    circuit.neurons.forEach((nr, i) => {
      if (nr.role !== 'gf') return;
      const m = this._flashMat([1.0, 0.85, 0.25]); m.opacity = 0.35;
      const node = new THREE.Mesh(gfGeo, m);
      node.position.set(cpos[3 * i], cpos[3 * i + 1], cpos[3 * i + 2]);
      this.group.add(node);
    });
    this.isGF = new Uint8Array(n);
    circuit.neurons.forEach((nr, i) => { if (nr.role === 'gf') this.isGF[i] = 1; });
    const flashGeo = new THREE.SphereGeometry(0.16, 10, 8);
    for (let i = 0; i < 48; i++) {
      const node = new THREE.Mesh(flashGeo, this._flashMat([0.75, 1.0, 0.85]));
      node.visible = false;
      this.group.add(node);
      this.flashPool.push(node);
      this.flashState.push({ ttl: 0, dur: 1, peak: 1 });
    }
    // A giant-fiber event should read as a contour, not an opaque white ball
    // that hides the cells and connections underneath it.
    const rm = this._flashMat([1.0, 0.9, 0.5]); rm.opacity = 0.18; rm.side = THREE.DoubleSide; rm.wireframe = true;
    this.ring = new THREE.Mesh(new THREE.SphereGeometry(2.2, 20, 14), rm);
    this.ring.visible = false; this.ringT = 0;
    this.group.add(this.ring);
    // highlight layer
    this.highlightCloud = new THREE.Points(new THREE.BufferGeometry(), new THREE.PointsMaterial({ size: 0.75, sizeAttenuation: true,
      color: 0xffffff, transparent: true, opacity: 0.9, depthWrite: false, depthTest: false, blending: THREE.AdditiveBlending }));
    this.highlightCloud.visible = false;
    this.group.add(this.highlightCloud);
  }

  _flashMat(rgb) {
    return new THREE.MeshBasicMaterial({ color: new THREE.Color().setRGB(rgb[0], rgb[1], rgb[2], THREE.SRGBColorSpace),
      blending: THREE.AdditiveBlending, transparent: true, depthWrite: false });
  }

  // The resting web is a stride sample: too many translucent lines stacked in
  // the dense central brain summed to a white block that hid the neurons.
  // A 5,000-line context sample avoids opaque overlap while preserving the
  // measured topology; activity still lights the exact outgoing model edges.
  rebuildAmbient(cap = 5000) {
    const total = this.edgeFrom.length;
    const filtered = [];
    for (let k = 0; k < total; k++) {
      if (this.visible.has(this.groupOf[this.edgeFrom[k]]) && this.visible.has(this.groupOf[this.edgeTo[k]])) filtered.push(k);
    }
    const stride = Math.max(1, Math.ceil(filtered.length / cap));
    const count = Math.ceil(filtered.length / stride);
    const pos = new Float32Array(count * 6), col = new Float32Array(count * 6);
    const p = this.positions;
    let a = 0;
    for (let f = 0; f < filtered.length; f += stride) {
      const k = filtered[f], i = this.edgeFrom[k], j = this.edgeTo[k];
      pos.set(p.subarray(3 * i, 3 * i + 3), 6 * a); pos.set(p.subarray(3 * j, 3 * j + 3), 6 * a + 3);
      const base = !this.edgeSignKnown ? [0.2, 0.48, 0.52] : this.edgeExc[k] ? [0.12, 0.55, 0.3] : [0.62, 0.2, 0.24];
      const gi = this.groupOf[i];
      const path = gi >= 0 && this.groups[gi].tier === 'named' ? this.groups[gi].color : base;
      const c = [0, 1, 2].map((q) => base[q] + (path[q] - base[q]) * 0.4);
      col.set(c, 6 * a); col.set(c, 6 * a + 3);
      a++;
    }
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.BufferAttribute(pos, 3));
    g.setAttribute('color', new THREE.BufferAttribute(col, 3));
    this.synapseLines.geometry.dispose();
    this.synapseLines.geometry = g;
  }

  setGroupVisible(gi, on) {
    const g = this.groups[gi];
    if (!g) return;
    g.object.visible = on;
    if (on) this.visible.add(gi); else this.visible.delete(gi);
    if (g.tier !== 'bg') this.rebuildAmbient();
  }

  setSynapsesVisible(on) {
    this.synapsesVisible = on;
    this.synapseLines.visible = on;
    this.glowLines.visible = on;
  }

  // Highlight a set of neurons (indices) or named groups (keys), e.g. the ones
  // a causal explanation names. `null` clears it.
  setHighlight(spec) {
    if (!spec) { this.highlight = null; this.highlightCloud.visible = false; return; }
    const idx = [];
    for (const k of spec.groups || []) {
      const g = this.groups.find((x) => x.key === k);
      if (g?.indices) idx.push(...g.indices);
    }
    if (spec.indices) idx.push(...spec.indices);
    if (!idx.length) { this.setHighlight(null); return; }
    const pos = new Float32Array(idx.length * 3);
    idx.forEach((i, k) => pos.set(this.positions.subarray(3 * i, 3 * i + 3), 3 * k));
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.BufferAttribute(pos, 3));
    this.highlightCloud.geometry.dispose();
    this.highlightCloud.geometry = g;
    this.highlightCloud.material.color.setRGB(...(spec.color || [1, 1, 1]), THREE.SRGBColorSpace);
    this.highlightCloud.visible = true;
    this.highlight = { t: 0, until: spec.duration ?? Infinity };
  }

  // Spikes from the latest snapshot. A drawing budget per frame, never a
  // simulation limit; giant-fiber spikes always draw.
  addSpikes(indices) {
    if (!indices) return;
    for (let k = 0; k < indices.length; k++) {
      const i = indices[k];
      if (i < 0 || i >= this.n) continue;
      const gf = this.isGF[i] === 1;
      if (!gf) { if (this.flashBudget <= 0) continue; this.flashBudget--; }
      this._flash(i, gf);
    }
  }

  _flash(i, gf) {
    // A neuron's outgoing synapses light up with its spike. Cells with very
    // many outputs (antennal and taste relays reach into the thousands) show
    // an even sample: at most 48 for the named command/sensory populations,
    // 12 for their unnamed partners. All of them at once would paint the
    // whole view white and hide where the signal is going.
    const edges = this.outEdges[i];
    const gOwn = this.groupOf[i];
    const sample = gOwn >= 0 && this.groups[gOwn].tier === 'named' ? 48 : 12;
    const stride = Math.max(1, Math.ceil(edges.length / sample));
    for (let q = 0; q < edges.length; q += stride) {
      const e = edges[q];
      if (this.activeGlow.size >= this.GLOW && !this.activeGlow.has(e)) continue;
      this.edgeGlow[e] = 1;
      this.activeGlow.add(e);
    }
    const gi = this.groupOf[i];
    if (gi >= 0 && !this.visible.has(gi)) return;
    const idx = this.flashNext;
    this.flashNext = (this.flashNext + 1) % this.flashPool.length;
    const node = this.flashPool[idx];
    const p = this.positions;
    node.position.set(p[3 * i], p[3 * i + 1], p[3 * i + 2]);
    node.visible = true;
    node.material.opacity = gf ? 1 : 0.8;
    const s = gf ? 3.2 : 1;
    node.scale.set(s, s, s);
    const st = this.flashState[idx];
    st.ttl = gf ? 0.6 : 0.28; st.dur = st.ttl; st.peak = node.material.opacity;
    if (gf) this.flashRing(p[3 * i], p[3 * i + 1], p[3 * i + 2]);
  }

  flashRing(x, y, z) {
    this.ring.position.set(x, y, z);
    this.ring.visible = true;
    this.ring.scale.set(0.5, 0.5, 0.5);
    this.ring.material.opacity = 1;
    this.ringT = 0.55;
  }

  groupRates(rates) {
    return this.groups.filter((g) => g.tier === 'named').map((g) => ({
      key: g.key, label: g.label, color: g.color, count: g.count,
      hz: typeof g.rate === 'function' ? g.rate(rates) : rates?.[g.rate] ?? 0,
    }));
  }

  setFear(rates) {
    if (!rates) return;
    this.fearTarget = clampf(rates.gf / 8 + rates.loom / 140, 0, 1);
  }

  frame(tMs) {
    const t0 = tMs / 1000;
    if (this.last === null) { this.last = t0; return; }
    this.pending += Math.min(0.05, t0 - this.last);
    this.last = t0;
    const w = this.container.clientWidth, h = this.container.clientHeight;
    if (!w || !h) { this.pending = 0; return; }
    // Full rate while being handled, 30 Hz otherwise: an observation surface,
    // and no simulated value depends on how often it is drawn.
    if (!this.dragging && !this.hovering && this.pending < 1 / 30) return;
    const dt = this.pending;
    this.pending = 0;
    this.flashBudget = 24;
    this.camera.position.z += (this.zoom - this.camera.position.z) * Math.min(1, 10 * dt);
    this.camera.position.y = 0.6 * (this.camera.position.z / 29);
    this.fear += ((this.fearTarget ?? 0) - this.fear) * Math.min(1, dt * 3);
    const k = this.fear;
    this.scene.background.setRGB(0.028 + (0.085 - 0.028) * k, 0.04 + (0.03 - 0.04) * k, 0.038 + (0.036 - 0.038) * k, THREE.SRGBColorSpace);
    this.idle += dt;
    if (!this.dragging && (!this.hovering || this.idle > 4) && this.idle > 2) this.group.rotation.y += (0.35 / 6) * dt;
    for (let i = 0; i < this.flashPool.length; i++) {
      const st = this.flashState[i];
      if (st.ttl <= 0) continue;
      st.ttl -= dt;
      if (st.ttl <= 0) { this.flashPool[i].visible = false; continue; }
      this.flashPool[i].material.opacity = st.peak * (st.ttl / st.dur);
    }
    if (this.ringT > 0) {
      this.ringT -= dt;
      const q = Math.max(0, this.ringT / 0.55);
      const s = 0.5 + 0.9 * (1 - q);
      this.ring.scale.set(s, s, s);
      this.ring.material.opacity = q;
      if (this.ringT <= 0) this.ring.visible = false;
    }
    if (this.highlight) {
      this.highlight.t += dt;
      this.highlightCloud.material.opacity = 0.55 + 0.4 * Math.sin(this.highlight.t * 5);
      if (this.highlight.t > this.highlight.until) this.setHighlight(null);
    }
    if (this.glowLines.visible) {
      const gp = this.glowLines.geometry.attributes.position.array;
      const gc = this.glowLines.geometry.attributes.color.array;
      const decay = Math.exp(-dt * 5);
      const p = this.positions;
      let idx = 0;
      for (const e of this.activeGlow) {
        const g = this.edgeGlow[e] * decay;
        if (g < 0.02) { this.edgeGlow[e] = 0; this.activeGlow.delete(e); continue; }
        this.edgeGlow[e] = g;
        const i = this.edgeFrom[e], j = this.edgeTo[e];
        if (!this.visible.has(this.groupOf[i]) || !this.visible.has(this.groupOf[j])) continue;
        if (idx >= this.GLOW) continue;
        const o = idx * 6;
        gp[o] = p[3 * i]; gp[o + 1] = p[3 * i + 1]; gp[o + 2] = p[3 * i + 2];
        gp[o + 3] = p[3 * j]; gp[o + 4] = p[3 * j + 1]; gp[o + 5] = p[3 * j + 2];
        const base = !this.edgeSignKnown ? [0.32, 0.83, 0.82] : this.edgeExc[e] ? [0.2, 0.85, 0.45] : [0.95, 0.3, 0.35];
        const gi = this.groupOf[i];
        // named populations glow in their own colour; unnamed partners keep
        // the excitatory/inhibitory colour instead of flaring towards white
        const hot = gi >= 0 && this.groups[gi].tier === 'named' ? this.groups[gi].color : base;
        for (let v = 0; v < 2; v++) {
          const co = o + 3 * v;
          const k = 0.2 + 0.35 * g;           // additive: keep overlapping lines from saturating
          gc[co] = (base[0] + (hot[0] - base[0]) * g) * k; gc[co + 1] = (base[1] + (hot[1] - base[1]) * g) * k; gc[co + 2] = (base[2] + (hot[2] - base[2]) * g) * k;
        }
        idx++;
      }
      this.glowLines.geometry.setDrawRange(0, idx * 2);
      this.glowLines.geometry.attributes.position.needsUpdate = true;
      this.glowLines.geometry.attributes.color.needsUpdate = true;
    }
    this.renderer.render(this.scene, this.camera);
  }

  resize() {
    const w = this.container.clientWidth, h = this.container.clientHeight;
    if (!w || !h) return;
    this.camera.aspect = w / h;
    this.camera.updateProjectionMatrix();
    this.renderer.setSize(w, h);
  }

  _bind() {
    const c = this.renderer.domElement;
    let dx0 = 0, dy0 = 0, moved = 0;
    c.addEventListener('pointerdown', (e) => { this.dragging = true; moved = 0; dx0 = e.clientX; dy0 = e.clientY; this.idle = 0; this.hovering = true; c.setPointerCapture(e.pointerId); });
    c.addEventListener('pointermove', (e) => {
      this.hovering = true; this.idle = 0;
      if (!this.dragging) return;
      const dx = e.clientX - dx0, dy = e.clientY - dy0;
      dx0 = e.clientX; dy0 = e.clientY;
      moved += Math.abs(dx) + Math.abs(dy);
      this.group.rotation.y += dx * 0.008;
      this.group.rotation.x = clampf(this.group.rotation.x + dy * 0.008, -1.2, 1.2);
    });
    c.addEventListener('pointerup', (e) => {
      if (this.dragging && moved < 5) this._pick(e);
      this.dragging = false; this.idle = 0;
      if (c.hasPointerCapture(e.pointerId)) c.releasePointerCapture(e.pointerId);
    });
    c.addEventListener('pointerenter', () => { this.hovering = true; this.idle = 0; });
    c.addEventListener('pointerleave', () => { this.hovering = false; this.dragging = false; });
    c.addEventListener('wheel', (e) => { e.preventDefault(); this.idle = 0; this.hovering = true; this.zoom = clampf(this.zoom + e.deltaY * 0.025, 3, 70); }, { passive: false });
  }

  _pick(ev) {
    const rect = this.renderer.domElement.getBoundingClientRect();
    const ray = new THREE.Raycaster();
    ray.setFromCamera(new THREE.Vector2(((ev.clientX - rect.left) / rect.width) * 2 - 1, -((ev.clientY - rect.top) / rect.height) * 2 + 1), this.camera);
    this.group.updateMatrixWorld();
    const inv = new THREE.Matrix4().copy(this.group.matrixWorld).invert();
    const a = ray.ray.origin.clone().applyMatrix4(inv);
    const b = ray.ray.origin.clone().add(ray.ray.direction.clone().multiplyScalar(100)).applyMatrix4(inv);
    const d = b.sub(a).normalize();
    const p = this.positions;
    let best = -1, bestPerp = Infinity;
    const ap = new THREE.Vector3();
    for (let i = 0; i < this.n; i++) {
      if (!this.visible.has(this.groupOf[i])) continue;
      ap.set(p[3 * i] - a.x, p[3 * i + 1] - a.y, p[3 * i + 2] - a.z);
      const along = ap.dot(d);
      const perp = Math.hypot(ap.x - along * d.x, ap.y - along * d.y, ap.z - along * d.z);
      if (perp < bestPerp) { bestPerp = perp; best = i; }
    }
    if (best < 0 || bestPerp > 1.5) return;
    const ax = p[3 * best], ay = p[3 * best + 1], az = p[3 * best + 2];
    const dist2 = (i) => (p[3 * i] - ax) ** 2 + (p[3 * i + 1] - ay) ** 2 + (p[3 * i + 2] - az) ** 2;
    let picked = [];
    for (let i = 0; i < this.n; i++) if (dist2(i) < 2.2 * 2.2) picked.push(i);
    if (picked.length > 60) picked = picked.sort((x, y) => dist2(x) - dist2(y)).slice(0, 60);
    this.flashRing(ax, ay, az);
    const gi = this.groupOf[best];
    this.onPick?.({ nearest: best, cluster: picked, groupKey: gi >= 0 ? this.groups[gi].key : null, groupLabel: gi >= 0 ? this.groups[gi].label : null });
  }

  labelFor(key) {
    const g = this.groups.find((x) => x.key === key);
    return g ? t(g.label) : key;
  }
}
