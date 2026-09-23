// world.js — the terrarium the fly actually lives in: a textured ground with
// three low hills and a pond, low glass-look walls at the window edge, a
// dense (~50 object) scatter (rocks, pebbles, mushrooms, logs, stumps,
// bushes, twigs, fallen branches, flowers, berry clusters, ferns, leaves,
// grass, moss patches, puddles) and two wandering fireflies, dimmer by day
// than by night on the real system clock (see World.fireflyActivity — a
// real, honest crepuscular/nocturnal firefly behavior, not tied to the
// fly's own neurons). Objects can be dragged by the user (see app.js's
// pointer handlers); the fly can be grabbed and flicked away.
//
// There is no connectome pathway for "food" or "light attraction" in the
// real FlyWire circuit sim.js loads — it is an escape/steering circuit
// (LC4/LPLC2 -> DNp01 giant fiber, DNa01/02 steering, MDN backward walking).
// So encounters here stay purely reactive: proximity and a moving light feed
// the same loomL/loomR visual-looming inputs the cursor already drives (see
// computeLoom in app.js), and solid contact feeds the same `sens`
// pathway a tap/click does. Nothing here invents a new neuron population —
// it only decides *when* the real circuit gets stimulated.

import * as THREE from '../node_modules/three/build/three.module.js';
import { clampf, fmod } from './util.js';
import { mat, SHADOWS_ENABLED } from './flymodel.js';

// All of the terrarium's randomness goes through R. Placement draws from the
// platform RNG (tests seed Math.random), but each object's own dressing —
// rotations, petal colours, clump offsets — comes from a per-object seed, so
// a second process (the renderer, while the simulation runs in a worker) can
// rebuild exactly the same-looking object from its layout record.
let R = () => Math.random();
const rnd = (lo, hi) => lo + R() * (hi - lo);
function seededRandom(seed) {
  let state = (seed >>> 0) || 0x9e3779b9;
  return () => {
    state = (state + 0x6d2b79f5) >>> 0;
    let t = state;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
function withSeed(seed, fn) {
  const saved = R;
  R = seededRandom(seed);
  try { return fn(); } finally { R = saved; }
}

// Roughly half the ~30 px body length flymodel.js documents at FLY_SCALE —
// how close an object's edge has to get to the fly's centre to count as
// touching it.
export const FLY_TOUCH_RADIUS = 15;

// Real firefly bioluminescent signaling is a brief, distinct pulse every
// few seconds, not a continuous glow — see World.prototype.update.
const FLASH_DURATION = 0.35;

// ---- ground, walls, landscape dressing ----

function makeGroundTexture() {
  if (typeof document === 'undefined') return null;   // headless test runs
  const size = 512;
  const canvas = document.createElement('canvas');
  canvas.width = size; canvas.height = size;
  const ctx = canvas.getContext('2d');
  ctx.fillStyle = '#3b2c1c';
  ctx.fillRect(0, 0, size, size);
  for (let i = 0; i < 1100; i++) {
    const x = Math.random() * size, y = Math.random() * size;
    const r = 2 + Math.random() * 7;
    const grassy = Math.random() < 0.55;
    ctx.fillStyle = grassy
      ? `rgba(${60 + rnd(0, 40) | 0}, ${92 + rnd(0, 50) | 0}, ${30 + rnd(0, 25) | 0}, 0.5)`
      : `rgba(${46 + rnd(0, 30) | 0}, ${33 + rnd(0, 20) | 0}, ${18 + rnd(0, 15) | 0}, 0.6)`;
    ctx.beginPath();
    ctx.ellipse(x, y, r, r * 0.6, rnd(0, Math.PI), 0, Math.PI * 2);
    ctx.fill();
  }
  // fine grit/debris speckle on top — small pale flecks that break up the
  // large ellipses at close camera range (purely a texture-quality pass,
  // same ground plane and physics as before).
  for (let i = 0; i < 500; i++) {
    const x = Math.random() * size, y = Math.random() * size;
    const r = 0.6 + Math.random() * 1.6;
    ctx.fillStyle = `rgba(${90 + rnd(0, 50) | 0}, ${80 + rnd(0, 45) | 0}, ${60 + rnd(0, 35) | 0}, 0.35)`;
    ctx.beginPath();
    ctx.arc(x, y, r, 0, Math.PI * 2);
    ctx.fill();
  }
  const tex = new THREE.CanvasTexture(canvas);
  tex.wrapS = THREE.RepeatWrapping;
  tex.wrapT = THREE.RepeatWrapping;
  tex.colorSpace = THREE.SRGBColorSpace;
  return tex;
}

function makeGround(bounds) {
  const w = bounds.width + 500, h = bounds.height + 500;
  const material = mat(0x3b2c1c, 0.05, 0.04);
  const tex = makeGroundTexture();
  if (tex) {
    tex.repeat.set(w / 180, h / 180);
    material.map = tex;
  }
  const mesh = new THREE.Mesh(new THREE.PlaneGeometry(w, h), material);
  mesh.position.z = -0.55;
  mesh.receiveShadow = SHADOWS_ENABLED;
  return mesh;
}

function makeWalls(bounds) {
  const group = new THREE.Group();
  const h = 34, th = 8;
  const wallMat = new THREE.MeshPhongMaterial({
    color: 0x8fd6c8, transparent: true, opacity: 0.16,
    specular: new THREE.Color(0.4, 0.4, 0.4), shininess: 60,
  });
  const hw = bounds.width / 2, hh = bounds.height / 2;
  const specs = [
    [bounds.width + th, th, 0, hh],
    [bounds.width + th, th, 0, -hh],
    [th, bounds.height + th, hw, 0],
    [th, bounds.height + th, -hw, 0],
  ];
  for (const [w, d, x, y] of specs) {
    const wall = new THREE.Mesh(new THREE.BoxGeometry(w, d, h), wallMat);
    wall.position.set(x, y, h / 2 - 1);
    group.add(wall);
  }
  return group;
}

// A shallow polar cap of a sphere makes a gentle hill; thetaLength controls
// how much of the dome shows, i.e. how tall the hill reads. rotation.x
// re-points the geometry's default +Y pole to world-up +Z (see the mushroom
// cap below — same trick, same sign).
function buildMound(radius, thetaLength, color) {
  const mesh = new THREE.Mesh(
    new THREE.SphereGeometry(radius, 24, 10, 0, Math.PI * 2, 0, thetaLength),
    mat(color, 0.04, 0.03));
  mesh.rotation.x = Math.PI / 2;
  mesh.receiveShadow = SHADOWS_ENABLED;
  return mesh;
}

function buildPond(radius) {
  const mesh = new THREE.Mesh(
    new THREE.CircleGeometry(radius, 28),
    new THREE.MeshPhongMaterial({
      color: 0x2c5c66, specular: new THREE.Color(0.7, 0.7, 0.7), shininess: 90,
      transparent: true, opacity: 0.88,
    }));
  mesh.position.z = 0.05;
  return mesh;
}

function makeLandscape(bounds) {
  const group = new THREE.Group();
  const hw = bounds.width / 2, hh = bounds.height / 2;
  const hill1 = buildMound(rnd(120, 160), rnd(0.42, 0.55), 0x3f5a28);
  hill1.position.set(-hw * 0.62, hh * 0.55, 0);
  const hill2 = buildMound(rnd(85, 115), rnd(0.35, 0.48), 0x4a6b30);
  hill2.position.set(hw * 0.66, -hh * 0.58, 0);
  const hill3 = buildMound(rnd(55, 78), rnd(0.3, 0.4), 0x355024);
  hill3.position.set(-hw * 0.7, -hh * 0.62, 0);
  const pond = buildPond(rnd(55, 78));
  pond.position.set(hw * 0.6, hh * 0.48, 0);
  group.add(hill1, hill2, hill3, pond);
  return group;
}

// ---- object kinds ----

function buildRock(radius) {
  const mesh = new THREE.Mesh(
    new THREE.IcosahedronGeometry(radius, 0),
    mat(0x6b665f, 0.15, 0.1));
  mesh.rotation.set(rnd(0, Math.PI), rnd(0, Math.PI), rnd(0, Math.PI));
  mesh.scale.set(1, 1, rnd(0.55, 0.8));
  mesh.position.z = radius * 0.35;
  mesh.castShadow = SHADOWS_ENABLED;
  return mesh;
}

function buildPebble(radius) {
  const mesh = new THREE.Mesh(
    new THREE.DodecahedronGeometry(radius, 0),
    mat(0x9a9488, 0.2, 0.15));
  mesh.rotation.set(rnd(0, Math.PI), rnd(0, Math.PI), rnd(0, Math.PI));
  mesh.position.z = radius * 0.4;
  mesh.castShadow = SHADOWS_ENABLED;
  return mesh;
}

function buildMushroom(radius) {
  const group = new THREE.Group();
  const stem = new THREE.Mesh(
    new THREE.CylinderGeometry(radius * 0.22, radius * 0.3, radius * 1.1, 10),
    mat(0xe8ddc0, 0.2, 0.15));
  stem.rotation.x = Math.PI / 2;
  stem.position.z = radius * 0.55;
  const cap = new THREE.Mesh(
    new THREE.SphereGeometry(radius, 16, 10, 0, Math.PI * 2, 0, Math.PI / 2.1),
    mat(rnd(0, 1) < 0.5 ? 0xb5432f : 0xc98a2c, 0.25, 0.2));
  cap.rotation.x = Math.PI / 2;
  cap.position.z = radius * 1.05;
  group.add(stem, cap);
  group.traverse((o) => { if (o.isMesh) o.castShadow = SHADOWS_ENABLED; });
  return group;
}

function buildTwig(radius) {
  const mesh = new THREE.Mesh(
    new THREE.CapsuleGeometry(radius * 0.16, radius * 1.7, 3, 6),
    mat(0x5a4326, 0.1, 0.1));
  mesh.rotation.z = rnd(0, Math.PI * 2);
  mesh.rotation.x = Math.PI / 2;
  mesh.position.z = radius * 0.16;
  mesh.castShadow = SHADOWS_ENABLED;
  return mesh;
}

function buildLog(radius) {
  const mesh = new THREE.Mesh(
    new THREE.CapsuleGeometry(radius * 0.4, radius * 2.2, 4, 8),
    mat(0x4a3722, 0.08, 0.08));
  mesh.rotation.z = rnd(0, Math.PI * 2);
  mesh.rotation.x = Math.PI / 2;
  mesh.position.z = radius * 0.4;
  mesh.castShadow = SHADOWS_ENABLED;
  return mesh;
}

function buildFlower(radius) {
  const group = new THREE.Group();
  const stem = new THREE.Mesh(
    new THREE.CylinderGeometry(radius * 0.05, radius * 0.07, radius * 1.6, 6),
    mat(0x3f6b2a, 0.05, 0.05));
  stem.rotation.x = Math.PI / 2;
  stem.position.z = radius * 0.8;
  group.add(stem);
  const petalColor = [0xdd6b9c, 0xe0b23a, 0xd94f4f][Math.floor(rnd(0, 3))];
  const petalMat = mat(petalColor, 0.2, 0.15);
  const n = 5;
  for (let i = 0; i < n; i++) {
    const a = (i / n) * Math.PI * 2;
    const petal = new THREE.Mesh(new THREE.SphereGeometry(radius * 0.32, 8, 6), petalMat);
    petal.position.set(Math.cos(a) * radius * 0.38, Math.sin(a) * radius * 0.38, radius * 1.55);
    petal.scale.z = 0.5;
    group.add(petal);
  }
  const center = new THREE.Mesh(new THREE.SphereGeometry(radius * 0.22, 8, 6), mat(0xe8c93a, 0.25, 0.2));
  center.position.z = radius * 1.55;
  group.add(center);
  group.traverse((o) => { if (o.isMesh) o.castShadow = SHADOWS_ENABLED; });
  return group;
}

function buildLeaf(radius) {
  const mesh = new THREE.Mesh(new THREE.CircleGeometry(radius, 8), mat(0x4c7a34, 0.1, 0.08));
  mesh.position.z = 0.3;
  mesh.rotation.z = rnd(0, Math.PI * 2);
  mesh.scale.y = rnd(0.55, 0.75);
  mesh.castShadow = SHADOWS_ENABLED;
  return mesh;
}

function buildGrassTuft(radius) {
  const group = new THREE.Group();
  const bladeMat = mat(0x5c8a3a, 0.05, 0.05);
  const n = 5;
  for (let i = 0; i < n; i++) {
    const h = radius * rnd(1.3, 2.0);
    const blade = new THREE.Mesh(new THREE.ConeGeometry(radius * 0.12, h, 5), bladeMat);
    blade.position.set(rnd(-radius * 0.4, radius * 0.4), rnd(-radius * 0.4, radius * 0.4), h / 2);
    blade.rotation.x = Math.PI / 2 + rnd(-0.25, 0.25);
    blade.rotation.y = rnd(-0.25, 0.25);
    group.add(blade);
  }
  group.traverse((o) => { if (o.isMesh) o.castShadow = SHADOWS_ENABLED; });
  return group;
}

function buildBush(radius) {
  const group = new THREE.Group();
  const leafMat = mat(0x3d6a2a, 0.08, 0.06);
  const clumps = 5;
  for (let i = 0; i < clumps; i++) {
    const r = radius * rnd(0.45, 0.7);
    const clump = new THREE.Mesh(new THREE.IcosahedronGeometry(r, 0), leafMat);
    const a = (i / clumps) * Math.PI * 2 + rnd(-0.3, 0.3);
    const d = i === 0 ? 0 : radius * rnd(0.35, 0.55);
    clump.position.set(Math.cos(a) * d, Math.sin(a) * d, r * 0.85 + rnd(0, 4));
    clump.rotation.set(rnd(0, Math.PI), rnd(0, Math.PI), rnd(0, Math.PI));
    group.add(clump);
  }
  group.traverse((o) => { if (o.isMesh) o.castShadow = SHADOWS_ENABLED; });
  return group;
}

function buildStump(radius) {
  const group = new THREE.Group();
  const body = new THREE.Mesh(
    new THREE.CylinderGeometry(radius * 0.9, radius, radius * 0.75, 14),
    mat(0x6b4a2c, 0.12, 0.1));
  body.rotation.x = Math.PI / 2;
  body.position.z = radius * 0.375;
  group.add(body);
  // flat growth-ring outlines on the cut top face
  const topZ = radius * 0.75 + 0.05;
  const ringMat = mat(0x8a6438, 0.15, 0.12);
  for (let i = 1; i <= 2; i++) {
    const r = radius * 0.9 * (i / 3);
    const ring = new THREE.Mesh(new THREE.RingGeometry(Math.max(0.5, r - 1.2), r, 20), ringMat);
    ring.position.z = topZ;
    group.add(ring);
  }
  group.traverse((o) => { if (o.isMesh) o.castShadow = SHADOWS_ENABLED; });
  return group;
}

function buildBerryCluster(radius) {
  const group = new THREE.Group();
  const stem = new THREE.Mesh(
    new THREE.CylinderGeometry(radius * 0.06, radius * 0.08, radius * 1.2, 6),
    mat(0x4a6b2a, 0.06, 0.05));
  stem.rotation.x = Math.PI / 2;
  stem.position.z = radius * 0.6;
  group.add(stem);
  const berryColor = rnd(0, 1) < 0.5 ? 0x8a1f3a : 0x2a3a8a;
  const berryMat = mat(berryColor, 0.35, 0.3);
  const n = 6;
  for (let i = 0; i < n; i++) {
    const a = (i / n) * Math.PI * 2 + rnd(-0.2, 0.2);
    const d = radius * rnd(0.15, 0.4);
    const berry = new THREE.Mesh(new THREE.SphereGeometry(radius * rnd(0.14, 0.19), 8, 6), berryMat);
    berry.position.set(Math.cos(a) * d, Math.sin(a) * d, radius * (1.1 + rnd(0, 0.25)));
    group.add(berry);
  }
  group.traverse((o) => { if (o.isMesh) o.castShadow = SHADOWS_ENABLED; });
  return group;
}

function buildFern(radius) {
  const group = new THREE.Group();
  const frondMat = mat(0x3f7a3a, 0.08, 0.06);
  const fronds = 7;
  for (let i = 0; i < fronds; i++) {
    const a = (i / fronds) * Math.PI * 2 + rnd(-0.15, 0.15);
    const len = radius * rnd(1.1, 1.6);
    const droop = rnd(0.15, 0.45);
    // two capsule segments at a slight break angle stand in for a curved,
    // drooping frond without a full spline — cheap and reads fine at scale.
    const inner = new THREE.Mesh(new THREE.CapsuleGeometry(radius * 0.05, len * 0.55, 2, 5), frondMat);
    inner.position.set(0, 0, len * 0.275);
    inner.rotation.x = Math.PI / 2 - droop * 0.3;
    const outer = new THREE.Mesh(new THREE.CapsuleGeometry(radius * 0.04, len * 0.5, 2, 5), frondMat);
    outer.position.set(0, len * 0.5 * Math.cos(droop * 0.3), len * (0.55 + 0.25 * Math.cos(droop)));
    outer.rotation.x = Math.PI / 2 - droop * 1.4;
    const frondGroup = new THREE.Group();
    frondGroup.add(inner, outer);
    frondGroup.rotation.z = a;
    group.add(frondGroup);
  }
  group.traverse((o) => { if (o.isMesh) o.castShadow = SHADOWS_ENABLED; });
  return group;
}

function buildMossPatch(radius) {
  const mesh = new THREE.Mesh(
    new THREE.IcosahedronGeometry(radius, 1),
    mat(0x3f6b34, 0.06, 0.04));
  mesh.scale.z = 0.16;
  mesh.position.z = radius * 0.05;
  mesh.rotation.z = rnd(0, Math.PI * 2);
  return mesh;
}

function buildFallenBranch(radius) {
  const group = new THREE.Group();
  const woodMat = mat(0x5a4d3a, 0.1, 0.08);
  const a = new THREE.Mesh(new THREE.CapsuleGeometry(radius * 0.14, radius * 1.1, 3, 6), woodMat);
  a.rotation.x = Math.PI / 2;
  a.rotation.z = rnd(-0.2, 0.2);
  a.position.z = radius * 0.14;
  const b = new THREE.Mesh(new THREE.CapsuleGeometry(radius * 0.1, radius * 0.7, 3, 6), woodMat);
  b.rotation.x = Math.PI / 2;
  b.rotation.z = rnd(0.35, 0.6) * (rnd(0, 1) < 0.5 ? 1 : -1);
  b.position.set(radius * 0.55, radius * 0.35, radius * 0.11);
  group.add(a, b);
  group.rotation.z = rnd(0, Math.PI * 2);
  group.traverse((o) => { if (o.isMesh) o.castShadow = SHADOWS_ENABLED; });
  return group;
}

function buildPuddle(radius) {
  const mesh = new THREE.Mesh(
    new THREE.CircleGeometry(radius, 20),
    new THREE.MeshPhongMaterial({
      color: 0x2c5c66, specular: new THREE.Color(0.7, 0.7, 0.7), shininess: 90,
      transparent: true, opacity: 0.8,
    }));
  mesh.position.z = 0.04;
  mesh.scale.y = rnd(0.7, 0.9);
  mesh.rotation.z = rnd(0, Math.PI * 2);
  return mesh;
}

function buildFirefly(radius) {
  const group = new THREE.Group();
  const glow = new THREE.Mesh(
    new THREE.SphereGeometry(radius, 12, 10),
    new THREE.MeshBasicMaterial({ color: 0xd8ff8a, transparent: true, opacity: 1 }));
  const light = new THREE.PointLight(0xd8ff8a, 0.8, 240, 2);
  group.add(glow, light);
  group.position.z = 26;
  return { node: group, light, glow };
}

// solid: blocks movement and can startle on contact. draggable: any solid
// object can be picked up in app.js's pointer handlers (non-solid ones too,
// see app.js — solidity is a collision property, not a grabbability one).
// More varied than the original scatter for a richer terrarium, but SOLID
// obstacle density specifically was trimmed back from an earlier pass: every
// solid contact is a real mechanosensory tap (see World.sense's `tap`), and
// too many solid objects packed into one terrarium meant near-constant real
// touch events just from ordinary wandering — reading as implausibly
// elevated startle/sensory activity even with nothing actually chasing the fly.
// Non-solid decoration (flowers, grass, ferns, leaves, moss...) stays dense
// for visual richness — its contact is already weighted far softer (0.35x)
// and it doesn't block movement, so it doesn't drive the same problem.
const OBSTACLE_SPECS = [
  { kind: 'rock', radius: () => rnd(16, 24), build: buildRock, solid: true },
  { kind: 'rock', radius: () => rnd(14, 20), build: buildRock, solid: true },
  { kind: 'rock', radius: () => rnd(18, 26), build: buildRock, solid: true },
  { kind: 'pebble', radius: () => rnd(8, 12), build: buildPebble, solid: true },
  { kind: 'pebble', radius: () => rnd(8, 12), build: buildPebble, solid: true },
  { kind: 'pebble', radius: () => rnd(7, 10), build: buildPebble, solid: true },
  { kind: 'pebble', radius: () => rnd(7, 10), build: buildPebble, solid: true },
  { kind: 'mushroom', radius: () => rnd(14, 19), build: buildMushroom, solid: true },
  { kind: 'mushroom', radius: () => rnd(12, 16), build: buildMushroom, solid: true },
  { kind: 'mushroom', radius: () => rnd(15, 20), build: buildMushroom, solid: true },
  { kind: 'log', radius: () => rnd(24, 32), build: buildLog, solid: true },
  { kind: 'stump', radius: () => rnd(20, 27), build: buildStump, solid: true },
  { kind: 'bush', radius: () => rnd(20, 28), build: buildBush, solid: true },
  { kind: 'bush', radius: () => rnd(16, 22), build: buildBush, solid: true },
  { kind: 'twig', radius: () => rnd(16, 20), build: buildTwig, solid: true },
  { kind: 'twig', radius: () => rnd(14, 18), build: buildTwig, solid: true },
  { kind: 'branch', radius: () => rnd(18, 26), build: buildFallenBranch, solid: true },
  { kind: 'branch', radius: () => rnd(14, 19), build: buildFallenBranch, solid: true },
  { kind: 'flower', radius: () => rnd(10, 14), build: buildFlower, solid: false },
  { kind: 'flower', radius: () => rnd(10, 14), build: buildFlower, solid: false },
  { kind: 'flower', radius: () => rnd(9, 12), build: buildFlower, solid: false },
  { kind: 'flower', radius: () => rnd(9, 13), build: buildFlower, solid: false },
  { kind: 'flower', radius: () => rnd(8, 11), build: buildFlower, solid: false },
  { kind: 'berry', radius: () => rnd(9, 13), build: buildBerryCluster, solid: false },
  { kind: 'berry', radius: () => rnd(8, 12), build: buildBerryCluster, solid: false },
  { kind: 'berry', radius: () => rnd(9, 12), build: buildBerryCluster, solid: false },
  { kind: 'fern', radius: () => rnd(13, 18), build: buildFern, solid: false },
  { kind: 'fern', radius: () => rnd(11, 16), build: buildFern, solid: false },
  { kind: 'fern', radius: () => rnd(12, 17), build: buildFern, solid: false },
  { kind: 'fern', radius: () => rnd(10, 14), build: buildFern, solid: false },
  { kind: 'leaf', radius: () => rnd(10, 15), build: buildLeaf, solid: false },
  { kind: 'leaf', radius: () => rnd(10, 15), build: buildLeaf, solid: false },
  { kind: 'leaf', radius: () => rnd(9, 13), build: buildLeaf, solid: false },
  { kind: 'leaf', radius: () => rnd(9, 13), build: buildLeaf, solid: false },
  { kind: 'leaf', radius: () => rnd(8, 12), build: buildLeaf, solid: false },
  { kind: 'grass', radius: () => rnd(11, 16), build: buildGrassTuft, solid: false },
  { kind: 'grass', radius: () => rnd(11, 16), build: buildGrassTuft, solid: false },
  { kind: 'grass', radius: () => rnd(11, 16), build: buildGrassTuft, solid: false },
  { kind: 'grass', radius: () => rnd(9, 14), build: buildGrassTuft, solid: false },
  { kind: 'grass', radius: () => rnd(9, 14), build: buildGrassTuft, solid: false },
  { kind: 'grass', radius: () => rnd(9, 14), build: buildGrassTuft, solid: false },
  { kind: 'moss', radius: () => rnd(14, 22), build: buildMossPatch, solid: false },
  { kind: 'moss', radius: () => rnd(12, 18), build: buildMossPatch, solid: false },
  { kind: 'moss', radius: () => rnd(10, 15), build: buildMossPatch, solid: false },
  { kind: 'puddle', radius: () => rnd(16, 24), build: buildPuddle, solid: false },
  { kind: 'puddle', radius: () => rnd(12, 18), build: buildPuddle, solid: false },
];

// Relative scent strength per kind (0 = odourless). The extracted circuit
// has no per-odorant receptor populations — real Drosophila olfaction maps
// different odorants to different glomeruli/receptor types we simply don't
// have here — so every object's scent feeds the same real general sensory
// pool (see app.js's updateScent/sim.sens); only concentration differs by
// kind and distance, not which neurons respond.
const SCENT_BY_KIND = {
  flower: 1.0, berry: 0.85, mushroom: 0.75, log: 0.45, stump: 0.4, bush: 0.3,
  branch: 0.2, fern: 0.15, grass: 0.15, leaf: 0.2, moss: 0.1, twig: 0.1,
  rock: 0, pebble: 0, puddle: 0.05, firefly: 0,
};

export class World {
  // options.layout: rebuild the objects of another World exactly (see
  //   layout()); options.empty: a bare arena with no objects, for controlled
  //   experiments; options.dressing: false skips ground, walls and landscape,
  //   which carry no behaviour (a simulation-only world).
  constructor(bounds, { layout = null, empty = false, dressing = true } = {}) {
    this.node = new THREE.Group();
    this.dressing = dressing;
    this.landscapeSeed = layout?.landscapeSeed ?? Math.floor(R() * 0x100000000);
    if (dressing) this._buildDressing(bounds);
    this.objects = [];
    this.t = layout?.t ?? 0;
    if (layout) this._placeFromLayout(layout.objects || []);
    else if (!empty) {
      this._placeObstacles(bounds);
      this._placeFirefly(bounds);
    }
  }

  _buildDressing(bounds) {
    this._ground = makeGround(bounds);
    this._walls = makeWalls(bounds);
    this._landscape = withSeed(this.landscapeSeed, () => makeLandscape(bounds));
    this.node.add(this._ground, this._walls, this._landscape);
  }

  // Everything another process needs to rebuild these objects exactly.
  layout() {
    return {
      landscapeSeed: this.landscapeSeed,
      t: this.t,
      objects: this.objects.map((o) => ({
        kind: o.kind, spec: o.spec, radius: o.radius, x: o.pos.x, y: o.pos.y, seed: o.seed,
        scent: o.scent, solid: o.solid, flashPeriod: o.flashPeriod, flickerPhase: o.flickerPhase,
      })),
    };
  }

  _placeFromLayout(records) {
    for (const r of records) {
      if (r.kind === 'firefly') {
        const { node, light, glow } = buildFirefly(r.radius);
        node.position.set(r.x, r.y, 26);
        this.node.add(node);
        this.objects.push({ kind: 'firefly', spec: -1, seed: r.seed, pos: { x: r.x, y: r.y }, radius: r.radius,
          solid: false, mesh: node, light, glow, vx: 0, vy: 0, wanderT: 1, glowLevel: 0, dimLevel: 1, z: 26,
          flickerPhase: r.flickerPhase, flashPeriod: r.flashPeriod, scent: 0 });
        continue;
      }
      const spec = OBSTACLE_SPECS[r.spec];
      if (!spec) continue;
      const mesh = withSeed(r.seed, () => spec.build(r.radius));
      mesh.position.x = r.x; mesh.position.y = r.y;
      this.node.add(mesh);
      this.objects.push({ kind: r.kind, spec: r.spec, seed: r.seed, pos: { x: r.x, y: r.y }, radius: r.radius,
        solid: spec.solid, mesh, scent: r.scent });
    }
  }

  // The renderer's copy follows the simulation's: positions, firefly height,
  // flash and daylight dimming, packed as [x, y, z, glow, dim] per object.
  applyState(packed) {
    for (let k = 0; k < this.objects.length; k++) {
      const o = this.objects[k];
      const b = 5 * k;
      if (b + 4 >= packed.length) break;
      o.pos.x = packed[b]; o.pos.y = packed[b + 1];
      o.mesh.position.x = o.pos.x; o.mesh.position.y = o.pos.y;
      if (o.kind === 'firefly') {
        o.z = packed[b + 2];
        o.mesh.position.z = o.z;
        o.glowLevel = packed[b + 3];
        o.dimLevel = packed[b + 4];
        this._paintFirefly(o);
      }
    }
  }

  packState(out = new Float32Array(this.objects.length * 5)) {
    for (let k = 0; k < this.objects.length; k++) {
      const o = this.objects[k];
      out[5 * k] = o.pos.x; out[5 * k + 1] = o.pos.y;
      out[5 * k + 2] = o.kind === 'firefly' ? o.z : 0;
      out[5 * k + 3] = o.kind === 'firefly' ? o.glowLevel : 0;
      out[5 * k + 4] = o.kind === 'firefly' ? o.dimLevel : 1;
    }
    return out;
  }

  // The light and the glow sphere are two renderings of the same flash.
  _paintFirefly(o) {
    const dim = o.dimLevel ?? 1;
    if (o.light) o.light.intensity = (0.35 * dim) + o.glowLevel * 0.9;
    if (o.glow) o.glow.material.opacity = (0.3 * dim) + o.glowLevel * 0.7;
  }

  // Rejection-samples a spot inside the window that keeps clear of the fly's
  // spawn point at the origin and of every object already placed. If 40
  // tries never find a fully clear spot (a busy terrarium), falls back to
  // whichever tried candidate had the least overlap rather than a fresh,
  // completely unchecked random point — for object placement that's a
  // cosmetic nicety, but the same function now also places a freshly
  // spawned fly (see app.js's addFly()), where landing inside an object
  // means real, immediate, maxed-out contact distress for no visible reason.
  _safeSpot(bounds, radius, margin = 55) {
    const hw = bounds.width / 2 - 90, hh = bounds.height / 2 - 90;
    let best = null, bestClearance = -Infinity;
    for (let k = 0; k < 40; k++) {
      const p = { x: rnd(-hw, hw), y: rnd(-hh, hh) };
      if (Math.hypot(p.x, p.y) < 90) continue;
      const clearance = this.objects.length
        ? Math.min(...this.objects.map((o) => Math.hypot(o.pos.x - p.x, o.pos.y - p.y) - o.radius - radius))
        : Infinity;
      if (clearance > margin) return p;
      if (clearance > bestClearance) { bestClearance = clearance; best = p; }
    }
    return best || { x: rnd(-hw, hw), y: rnd(-hh, hh) };
  }

  // Public: same rejection-sampling, for anything outside World that needs
  // to place something (a newly spawned fly, say) without risking it
  // landing inside a solid obstacle — see app.js's addFly().
  findClearSpot(bounds, radius, margin = 55) { return this._safeSpot(bounds, radius, margin); }

  _placeObstacles(bounds) {
    OBSTACLE_SPECS.forEach((spec, specIndex) => {
      const radius = spec.radius();
      const pos = this._safeSpot(bounds, radius);
      const seed = Math.floor(R() * 0x100000000);
      const mesh = withSeed(seed, () => spec.build(radius));
      mesh.position.x = pos.x;
      mesh.position.y = pos.y;
      this.node.add(mesh);
      this.objects.push({
        kind: spec.kind, spec: specIndex, seed, pos, radius, solid: spec.solid, mesh,
        scent: (SCENT_BY_KIND[spec.kind] ?? 0) * rnd(0.8, 1.15),
      });
    });
  }

  // Real fireflies are crepuscular/nocturnal — two of them (was one) for a
  // livelier night scene, both genuinely dimming toward daylight hours
  // rather than glowing at a flat brightness around the clock.
  _placeFirefly(bounds) {
    for (let k = 0; k < 2; k++) {
      const radius = 9;
      const pos = this._safeSpot(bounds, radius, 40);
      const { node, light, glow } = buildFirefly(radius);
      node.position.x = pos.x;
      node.position.y = pos.y;
      this.node.add(node);
      this.objects.push({
        kind: 'firefly', spec: -1, seed: 0, pos, radius, solid: false, mesh: node, light, glow,
        vx: 0, vy: 0, wanderT: rnd(0.4, 1.6), flickerPhase: rnd(0, Math.PI * 2),
        flashPeriod: rnd(2.5, 5), glowLevel: 0, dimLevel: 1, z: 26, scent: 0,
      });
    }
  }

  resize(bounds) {
    if (this.dressing) {
      this.node.remove(this._ground, this._walls, this._landscape);
      this._buildDressing(bounds);
    }
    const hw = bounds.width / 2 - 60, hh = bounds.height / 2 - 60;
    for (const o of this.objects) {
      o.pos.x = clampf(o.pos.x, -hw, hw);
      o.pos.y = clampf(o.pos.y, -hh, hh);
      o.mesh.position.x = o.pos.x;
      o.mesh.position.y = o.pos.y;
    }
  }

  // Real fireflies are most active at dusk/night, quiet in full daylight —
  // a simple, honest piecewise curve over the real clock (same style as
  // environment.js's circadianActivity), not tied to the fly's own neurons.
  static fireflyActivity(hour) {
    const pts = [[0, 1], [5, 1], [8, 0.12], [17, 0.12], [20, 1], [24, 1]];
    for (let i = 0; i < pts.length - 1; i++) {
      const [h0, v0] = pts[i], [h1, v1] = pts[i + 1];
      if (hour >= h0 && hour <= h1) return v0 + (v1 - v0) * (hour - h0) / Math.max(0.001, h1 - h0);
    }
    return 1;
  }

  update(dt, bounds, hour = null) {
    this.t += dt;
    const hw = bounds.width / 2 - 60, hh = bounds.height / 2 - 60;
    let clockHour = hour;
    if (clockHour === null) { const now = new Date(); clockHour = now.getHours() + now.getMinutes() / 60; }
    const activity = World.fireflyActivity(clockHour);
    for (const o of this.objects) {
      if (o.kind !== 'firefly') continue;
      o.wanderT -= dt;
      if (o.wanderT <= 0) {
        o.wanderT = rnd(1.2, 3.2);
        const speed = rnd(14, 34);
        const ang = rnd(0, Math.PI * 2);
        o.vx = Math.cos(ang) * speed;
        o.vy = Math.sin(ang) * speed;
      }
      o.pos.x += o.vx * dt;
      o.pos.y += o.vy * dt;
      if (o.pos.x < -hw || o.pos.x > hw) { o.vx *= -1; o.pos.x = clampf(o.pos.x, -hw, hw); }
      if (o.pos.y < -hh || o.pos.y > hh) { o.vy *= -1; o.pos.y = clampf(o.pos.y, -hh, hh); }
      o.mesh.position.x = o.pos.x;
      o.mesh.position.y = o.pos.y;
      o.z = 26 + 5 * Math.sin(this.t * 1.7 + o.pos.x * 0.02);
      o.mesh.position.z = o.z;
      // Real fireflies (Photinus etc.) signal with a brief, distinct flash
      // every few seconds, not a continuous smooth twinkle. The old
      // always-on sin-wave "flicker" had a real side effect beyond looking
      // wrong: it drove this firefly's actual point light every single
      // frame, repainting the ground/grass around it, which the rendered-
      // vision looming pathway (real frame-to-frame luminance change, see
      // updateVision in app.js) read as a nonstop nearby visual event —
      // enough to keep the giant fiber pinned near its firing ceiling all
      // night, not just during a real flash. flashPeriod is fixed per
      // firefly (its own steady signaling rhythm), so most of the cycle now
      // holds a constant glow — no frame-to-frame delta, nothing for vision
      // to see — with one genuine brief bright pulse per cycle.
      const cyclePos = fmod(this.t + (o.flickerPhase || 0), o.flashPeriod || 3.5);
      const flash = cyclePos < FLASH_DURATION ? Math.sin((Math.PI * cyclePos) / FLASH_DURATION) : 0;
      const dim = 0.15 + 0.85 * activity;
      o.dimLevel = dim;
      o.glowLevel = flash * dim;
      this._paintFirefly(o);
    }
  }

  // Visual/tap sensory drive for the brain-carrying fly: proximity to any
  // object is a continuous "something is here" cue that grows sharply as it
  // closes to touching distance — holding an object right up to the fly is
  // a genuine, strong looming stimulus, not a token nudge; a fast-closing
  // firefly drives the same expanding-silhouette looming math the cursor
  // uses. Split left/right eye by bearing to the fly's own heading, exactly
  // like computeLoom() does for the cursor.
  sense(fly) {
    let loomL = 0, loomR = 0, tap = 0, scent = 0;
    const f = { x: Math.cos(fly.heading), y: Math.sin(fly.heading) };
    // A real fly in the air isn't in contact with, or looming-close over,
    // objects sitting on the ground below it — a fly cruising at altitude
    // over a mushroom is not touching the mushroom. Objects here have no
    // stored height, so each one's real solid extent is approximated as
    // ground level up to roughly its own radius (a reasonable stand-in
    // across rocks/mushrooms/bushes/logs alike); the fly's own real
    // rendered height clears that once airborne. Scent is deliberately
    // exempt — real odor plumes rise and reach a flying insect for real.
    const flyZ = fly.node?.position?.z || 0;
    for (const o of this.objects) {
      const dx = o.pos.x - fly.pos.x, dy = o.pos.y - fly.pos.y;
      const dist2d = Math.max(1, Math.hypot(dx, dy));
      const objTopZ = o.kind === 'firefly' ? 26 : o.radius * 1.1;
      const dz = Math.max(0, flyZ - objTopZ);
      const dist = Math.max(1, Math.hypot(dx, dy, dz));
      const crossZ = (f.x * dy - f.y * dx) / dist2d;
      const lw = clampf(0.5 + 0.5 * crossZ, 0.12, 1);
      const rw = clampf(0.5 - 0.5 * crossZ, 0.12, 1);

      let strength;
      if (o.kind === 'firefly') {
        // Approach is what LC4/LPLC2 respond to. A firefly merely hovering
        // near her head is seen by her rendered eye already; the former
        // proximity bonus (up to 0.35 on top of the approach term, 1.35 in
        // all) held the giant fiber near 250 Hz whenever she landed beside
        // one. Proximity now adds no more than a static object does.
        const closing = -(dx * o.vx + dy * o.vy) / dist;
        strength = clampf(closing / dist * 5, 0, 1) * clampf(1 - dist / 260, 0, 1);
        strength = clampf(strength + clampf((60 - dist) / 60, 0, 1) ** 2 * 0.16, 0, 1);
      } else {
        // Reality check, corrected: LC4/LPLC2 are tuned to an EXPANDING
        // silhouette (something actually approaching), not mere proximity —
        // a rock sitting still nearby is not a real visual threat to a fly,
        // however close it is. An earlier pass made static proximity alone
        // ramp up to a strong looming signal, which — combined with a dense,
        // ~50-object terrarium — meant the fly was reading a near-constant
        // "predator" signal just from standing near ordinary scenery. Real
        // near-contact is still a genuine strong stimulus, but the honest
        // pathway for "something is touching/right against me" is the tap
        // computation below (mechanosensory), not the visual escape trigger.
        // So a static object now only contributes a small, short-range
        // peripheral-vision cue here; actual approach (the rendered vision
        // system's real motion energy, the cursor, a closing firefly, fire)
        // remains the real driver of the escape pathway.
        const near = dist - o.radius;
        strength = clampf((35 - near) / 35, 0, 1) ** 2 * 0.16;
      }
      loomL = Math.max(loomL, strength * lw);
      loomR = Math.max(loomR, strength * rw);

      // Any object actually touching the fly's body is a real mechanosensory
      // event, not just the solid ones — a petal or a blade of grass resting
      // against her is a genuine, if gentle, contact stimulus. Solid objects
      // (which also physically block and push her, see collide()) still read
      // as the firmer bump; non-solid contact is real but deliberately soft.
      // Real (3D) distance, so this stays silent while the fly is airborne.
      const touchDist = o.radius + FLY_TOUCH_RADIUS;
      if (dist < touchDist) {
        const contactStrength = clampf(1 - dist / touchDist, 0, 1) * (o.solid ? 1 : 0.35);
        tap = Math.max(tap, contactStrength);
      }

      if (o.scent > 0) {
        const plumeRadius = o.radius + 140;
        scent += o.scent * clampf(1 - dist2d / plumeRadius, 0, 1);
      }
    }
    return { loomL, loomR, tap, scent: clampf(scent, 0, 1) };
  }

  // Soft collision: pushes the fly's centre back outside any solid object
  // it has walked into, so it visibly steps around rocks and logs instead
  // of clipping through them. Runs for every fly, not just the one wired to
  // the brain. Skipped once airborne clears an object's real height — a
  // flying fly shouldn't get shoved sideways by a rock it's cruising over.
  collide(fly) {
    const flyZ = fly.node?.position?.z || 0;
    for (const o of this.objects) {
      if (!o.solid) continue;
      if (flyZ > o.radius * 1.1) continue;
      const touchDist = o.radius + FLY_TOUCH_RADIUS;
      const dx = fly.pos.x - o.pos.x, dy = fly.pos.y - o.pos.y;
      const dist = Math.max(0.001, Math.hypot(dx, dy));
      if (dist >= touchDist) continue;
      const push = touchDist - dist;
      fly.pos.x += (dx / dist) * push;
      fly.pos.y += (dy / dist) * push;
    }
  }
}
