// terrarium.js — draws the fly's world, and renders what the fly herself sees.
//
// This module simulates nothing. The terrarium's objects, the fly's pose and
// every environmental state arrive in snapshots from the simulation thread
// and are only drawn here. Two things are produced here and sent back,
// because only a GPU can produce them: the motion energy of the fly's own
// rendered eye (her visual input), and the pointer's position on the ground.
//
// Observer/simulation boundary: view exposure, the camera and
// the spatial-map overlay are observer-side. The eye renders at a fixed
// exposure, and the overlay lives on a render layer the eye cannot see.

import * as THREE from '../../node_modules/three/build/three.module.js';
import { buildFlyModel, SHADOWS_ENABLED } from '../../src/flymodel.js';
import { World } from '../../src/world.js';
import { applyPose, poseNodes } from '../../src/pose.js';
import { clampf } from '../../src/util.js';
import { circadianActivity } from '../../src/environment.js';
import { sceneLightLevel, autoExposureGain } from '../../src/display.js';
import { localMotionResidual } from '../../src/vision.js';

const VISION_W = 64, VISION_H = 24;
const VISION_EXPOSURE = 1;
const MAP_LAYER = 1;
const FLOOD_MAX_Z = 70;
const SCENT_RADIUS = 260;
const FLY_GRAB_RADIUS = 26;
const OBJECT_GRAB_MARGIN = 14;
const rnd = (lo, hi) => lo + Math.random() * (hi - lo);

// Keyframes across a real 24 h clock: [hour, top, mid, bottom, fog, key colour,
// key intensity, ambient intensity], interpolated linearly.
const DAY_NIGHT_KEYFRAMES = [
  [0, '#03040a', '#080d1a', '#141d33', 0x080a12, 0x8fa8ff, 0.35, 0.30],
  [5, '#03040a', '#080d1a', '#141d33', 0x080a12, 0x8fa8ff, 0.35, 0.30],
  [7, '#2a2038', '#7a4a4a', '#e0925a', 0x3a2a28, 0xffb37a, 0.95, 0.55],
  [9, '#4a7bb5', '#bcd6ea', '#e8ecec', 0x8fa8bd, 0xfff3d8, 1.55, 0.85],
  [13, '#3f7fc9', '#bcdcf0', '#eef4f2', 0x9fb6c9, 0xffffff, 1.65, 0.85],
  [17, '#3f6fb0', '#bcd0e0', '#eef0ea', 0x8fa2b0, 0xfff0d0, 1.45, 0.78],
  [19, '#382050', '#8a4a5a', '#e0824a', 0x3a2530, 0xffa060, 0.85, 0.5],
  [21, '#0a0a20', '#141830', '#242c48', 0x0d0f1c, 0x9098ff, 0.45, 0.34],
  [24, '#03040a', '#080d1a', '#141d33', 0x080a12, 0x8fa8ff, 0.35, 0.30],
];
function dayNightAt(hour) {
  const pts = DAY_NIGHT_KEYFRAMES;
  for (let i = 0; i < pts.length - 1; i++) {
    const a = pts[i], b = pts[i + 1];
    if (hour >= a[0] && hour <= b[0]) {
      const t = (hour - a[0]) / Math.max(0.001, b[0] - a[0]);
      const lerp = (x, y) => new THREE.Color(x).lerp(new THREE.Color(y), t);
      return { top: lerp(a[1], b[1]), mid: lerp(a[2], b[2]), bottom: lerp(a[3], b[3]), fog: lerp(a[4], b[4]),
        keyColor: lerp(a[5], b[5]), keyIntensity: a[6] + (b[6] - a[6]) * t, ambient: a[7] + (b[7] - a[7]) * t };
    }
  }
  const l = pts[pts.length - 1];
  return { top: new THREE.Color(l[1]), mid: new THREE.Color(l[2]), bottom: new THREE.Color(l[3]), fog: new THREE.Color(l[4]),
    keyColor: new THREE.Color(l[5]), keyIntensity: l[6], ambient: l[7] };
}
const DAY_REFERENCE_LIGHT = (() => {
  let peak = 0;
  for (let h = 0; h < 24; h += 0.25) {
    const sky = dayNightAt(h);
    const scale = 0.75 + 0.25 * circadianActivity(h);
    peak = Math.max(peak, sceneLightLevel(sky.ambient * scale, sky.keyIntensity * scale));
  }
  return peak;
})();

// A map value's colour: blue (low) -> amber -> red (high); alpha carries it.
export function mapColor(g, out, o) {
  out[o] = Math.round(40 + 215 * Math.min(1, g * 1.6));
  out[o + 1] = Math.round(90 + 120 * Math.max(0, 1 - Math.abs(g - 0.5) * 2));
  out[o + 2] = Math.round(200 * Math.max(0, 1 - g * 1.8));
  out[o + 3] = Math.round(60 + 150 * g);
}

export class TerrariumView {
  constructor(container, { layout, onPointer, onCommand, onVision, onTap }) {
    this.container = container;
    this.onPointer = onPointer;
    this.onCommand = onCommand;
    this.onVision = onVision;
    this.onTap = onTap;
    this.bounds = { width: Math.max(100, container.clientWidth), height: Math.max(100, container.clientHeight) };
    this.maxPixelRatio = Math.min(window.devicePixelRatio || 1, 1.5);
    this.snap = null;
    this.cameraMode = 'overview';
    this.orbit = { azimuth: 0, elevation: Math.atan2(0.62, 0.72), zoom: 1 };
    this.viewBrightness = 1;
    this.autoNightLift = true;
    this.autoLiftGain = 1;
    this.displayExposure = 1;
    this.dayNightT = 999;
    this.visionT = 0;
    this.visionReadPending = false;
    this.visionPreview = null;          // { rawCtx, motionCtx } when the panel shows it
    this.visionEnabled = true;

    this.scene = new THREE.Scene();
    this.camera = new THREE.PerspectiveCamera(50, this.bounds.width / this.bounds.height, 10, 4000);
    this.camera.up.set(0, 0, 1);
    this.camera.layers.enable(MAP_LAYER);   // the user sees the map; the fly never does
    this.followLookAt = new THREE.Vector3();
    this.groundRay = new THREE.Raycaster();

    this._buildLights();
    this._buildRenderer();
    this.world = new World(this.bounds, { layout, merge: true });
    this.scene.add(this.world.node);
    this._buildWeather();
    this._buildMapOverlay();
    this._buildVision();
    this.flyViews = [];
    this.foodViews = new Map();
    this.placeCamera();
    this.fitShadowCamera();
    this.updateDayNight();
    this._bindPointer();
  }

  // ---- construction ----------------------------------------------------------
  _buildLights() {
    this.key = new THREE.DirectionalLight(0xffffff, 1.5);
    this.key.position.set(0.2955 * 900, 0.3276 * 900, 0.8974 * 900);
    this.key.target.position.set(0, 0, 0);
    this.scene.add(this.key.target);
    if (SHADOWS_ENABLED) {
      this.key.castShadow = true;
      this.key.shadow.mapSize.set(1024, 1024);
      this.key.shadow.radius = 3;
      this.key.shadow.bias = -0.0008;
    }
    this.scene.add(this.key);
    this.ambientLight = new THREE.AmbientLight(0xffffff, 0.82);
    this.scene.add(this.ambientLight);
    const skyCanvas = document.createElement('canvas');
    skyCanvas.width = 2; skyCanvas.height = 256;
    this.skyCtx = skyCanvas.getContext('2d');
    this.skyTex = new THREE.CanvasTexture(skyCanvas);
    this.scene.add(new THREE.Mesh(new THREE.SphereGeometry(3000, 16, 16),
      new THREE.MeshBasicMaterial({ map: this.skyTex, side: THREE.BackSide, fog: false })));
    this.scene.fog = new THREE.Fog(0x0b0d14, 500, 2600);
  }

  _buildRenderer() {
    const r = new THREE.WebGLRenderer({ antialias: true, powerPreference: 'high-performance' });
    r.setPixelRatio(this.maxPixelRatio);
    r.setSize(this.bounds.width, this.bounds.height);
    r.setClearColor(0x0b0d14, 1);
    r.outputColorSpace = THREE.SRGBColorSpace;
    // Linear exposure: a straight gain like a camera's ISO, identical to no
    // tone mapping at 1.0, so the displayed world is scaled, never re-graded.
    r.toneMapping = THREE.LinearToneMapping;
    r.toneMappingExposure = 1;
    if (SHADOWS_ENABLED) {
      r.shadowMap.enabled = true;
      r.shadowMap.type = THREE.PCFSoftShadowMap;
      // refreshed once per displayed frame and reused by the eye pass
      r.shadowMap.autoUpdate = false;
      r.shadowMap.needsUpdate = true;
    }
    this.renderer = r;
    this.container.appendChild(r.domElement);
    r.domElement.addEventListener('webglcontextlost', (e) => e.preventDefault(), false);
  }

  _buildWeather() {
    const b = this.bounds;
    // rain
    this.RAIN_COUNT = 500;
    this.rainPos = new Float32Array(this.RAIN_COUNT * 3);
    this.rainVel = new Float32Array(this.RAIN_COUNT);
    for (let i = 0; i < this.RAIN_COUNT; i++) this._resetDrop(i);
    const rainGeo = new THREE.BufferGeometry();
    rainGeo.setAttribute('position', new THREE.BufferAttribute(this.rainPos, 3));
    this.rainPoints = new THREE.Points(rainGeo, new THREE.PointsMaterial({ color: 0xbfe0ff, size: 3.2, transparent: true, opacity: 0.55 }));
    this.rainPoints.visible = false;
    this.scene.add(this.rainPoints);
    // fire
    this.fireGroup = new THREE.Group();
    const emberGeo = new THREE.SphereGeometry(2.6, 6, 5);
    for (let i = 0; i < 26; i++) {
      const m = new THREE.Mesh(emberGeo, new THREE.MeshBasicMaterial({ color: new THREE.Color().setHSL(rnd(0.02, 0.08), 1, rnd(0.5, 0.7)) }));
      m.userData = { baseZ: rnd(2, 30), speed: rnd(30, 70), wobble: rnd(0, Math.PI * 2) };
      m.position.set(rnd(-10, 10), rnd(-10, 10), m.userData.baseZ);
      this.fireGroup.add(m);
    }
    this.fireGlow = new THREE.PointLight(0xff7a1a, 0, 320, 2);
    this.fireGlow.position.z = 20;
    this.fireGroup.add(this.fireGlow);
    this.fireGroup.visible = false;
    this.scene.add(this.fireGroup);
    // drifting particles
    const drift = (count, color, size, opacity) => {
      const geo = new THREE.BufferGeometry();
      const pos = new Float32Array(count * 3), vel = new Float32Array(count * 3);
      for (let i = 0; i < count; i++) {
        pos[3 * i] = rnd(-b.width / 2, b.width / 2); pos[3 * i + 1] = rnd(-b.height / 2, b.height / 2); pos[3 * i + 2] = rnd(4, 140);
        vel[3 * i] = rnd(-6, 6); vel[3 * i + 1] = rnd(-6, 6); vel[3 * i + 2] = rnd(4, 12);
      }
      geo.setAttribute('position', new THREE.BufferAttribute(pos, 3));
      const points = new THREE.Points(geo, new THREE.PointsMaterial({ color, size, transparent: true, opacity, depthWrite: false }));
      points.visible = false;
      points.userData.vel = vel;
      this.scene.add(points);
      return points;
    };
    this.smokePoints = drift(220, 0x777a80, 9, 0.22);
    this.dustPoints = drift(260, 0xb89a6a, 3.5, 0.35);
    this.pollenPoints = drift(70, 0xd8e8a0, 2.0, 0.25);   // decorative only
    this.pollenPoints.visible = true;
    // flood
    this.floodMesh = new THREE.Mesh(new THREE.PlaneGeometry(4000, 4000),
      new THREE.MeshPhongMaterial({ color: 0x1c5a72, transparent: true, opacity: 0.55, specular: new THREE.Color(0.6, 0.6, 0.6), shininess: 80 }));
    this.floodMesh.visible = false;
    this.scene.add(this.floodMesh);
    // scent source (odour is modelled in the world; this circuit has no olfactory neurons)
    this.scentGroup = new THREE.Group();
    const glow = new THREE.Mesh(new THREE.SphereGeometry(10, 14, 10), new THREE.MeshBasicMaterial({ color: 0xd7a8ff, transparent: true, opacity: 0.55 }));
    glow.position.z = 16;
    const ring = new THREE.Mesh(new THREE.RingGeometry(SCENT_RADIUS * 0.85, SCENT_RADIUS, 40),
      new THREE.MeshBasicMaterial({ color: 0xd7a8ff, transparent: true, opacity: 0.06, side: THREE.DoubleSide }));
    ring.position.z = 0.4;
    this.scentGroup.add(glow, ring);
    this.scene.add(this.scentGroup);
  }

  _resetDrop(i) {
    const b = this.bounds;
    this.rainPos[3 * i] = rnd(-b.width / 2 - 100, b.width / 2 + 100);
    this.rainPos[3 * i + 1] = rnd(-b.height / 2 - 100, b.height / 2 + 100);
    this.rainPos[3 * i + 2] = rnd(200, 900);
    this.rainVel[i] = rnd(700, 1000);
  }

  _buildMapOverlay() {
    this.mapCols = 24; this.mapRows = 16;
    this.mapTexData = new Uint8Array(this.mapCols * this.mapRows * 4);
    this.mapTexture = new THREE.DataTexture(this.mapTexData, this.mapCols, this.mapRows, THREE.RGBAFormat);
    this.mapTexture.magFilter = THREE.NearestFilter;
    this.mapTexture.minFilter = THREE.NearestFilter;
    this.mapTexture.colorSpace = THREE.SRGBColorSpace;
    this.mapTexture.needsUpdate = true;
    this.mapOverlay = new THREE.Mesh(new THREE.PlaneGeometry(1, 1), new THREE.MeshBasicMaterial({
      map: this.mapTexture, transparent: true, depthWrite: false, fog: false, side: THREE.DoubleSide, toneMapped: false }));
    this.mapOverlay.position.z = 1.2;
    this.mapOverlay.layers.set(MAP_LAYER);
    this.mapOverlay.visible = false;
    this.mapOverlay.renderOrder = 2;
    this.scene.add(this.mapOverlay);
    this.fitMapOverlay();
  }

  fitMapOverlay() { this.mapOverlay.scale.set(this.bounds.width, this.bounds.height, 1); }

  setMapVisible(on) { this.mapOverlay.visible = on; }

  paintMap(map) {
    if (!map) return;
    if (map.cols !== this.mapCols || map.rows !== this.mapRows) return;
    for (let i = 0; i < map.values.length; i++) {
      const o = i * 4;
      if (!map.coverage[i]) { this.mapTexData[o + 3] = 0; continue; }
      mapColor(clampf(map.values[i], 0, 1), this.mapTexData, o);
    }
    this.mapTexture.needsUpdate = true;
  }

  _buildVision() {
    // near = 1 so an object pressed against her face does not vanish past the
    // clip plane at the moment its looming should be strongest
    this.visionCamera = new THREE.PerspectiveCamera(150, VISION_W / VISION_H, 1, 900);
    this.visionCamera.up.set(0, 0, 1);
    this.visionTarget = new THREE.WebGLRenderTarget(VISION_W, VISION_H, { depthBuffer: true });
    this.visionPixels = new Uint8Array(VISION_W * VISION_H * 4);
    this.visionPrevLum = new Float32Array(VISION_W * VISION_H);
    this.visionMotion = new Float32Array(VISION_W * VISION_H);
    this.visionResidual = new Float32Array(VISION_W * VISION_H);
    this.visionSurround = new Float32Array(VISION_W * VISION_H);
    this.visionScratch = new Float32Array(VISION_W * VISION_H);
    this.visionMotionL = 0; this.visionMotionR = 0;
  }

  // ---- camera ------------------------------------------------------------------
  placeCamera() {
    const baseD = Math.max(this.bounds.width, this.bounds.height) * 0.85;
    const r = baseD * 0.9497 * this.orbit.zoom;
    const ce = Math.cos(this.orbit.elevation), se = Math.sin(this.orbit.elevation);
    const ca = Math.cos(this.orbit.azimuth), sa = Math.sin(this.orbit.azimuth);
    this.camera.position.set(r * ce * sa, -r * ce * ca, r * se);
    this.camera.lookAt(0, 0, 0);
    this.camera.aspect = this.bounds.width / this.bounds.height;
    this.camera.updateProjectionMatrix();
  }

  setZoom(z) { this.orbit.zoom = clampf(z, 0.3, 3.5); if (this.cameraMode === 'overview') this.placeCamera(); }

  toggleCameraMode() {
    this.cameraMode = this.cameraMode === 'overview' ? 'follow' : 'overview';
    if (this.cameraMode === 'overview') this.placeCamera();
    return this.cameraMode;
  }

  _updateFollowCamera(dt) {
    const f = this.snap?.fly;
    if (!f) return;
    // Keep the animal in frame on narrow windows; the old look-ahead placed
    // her behind the lower edge of the follow camera in portrait layouts.
    const back = 125, up = 64, ahead = 22;
    const hx = Math.cos(f.heading), hy = Math.sin(f.heading);
    const k = Math.min(1, dt * 5);
    const c = this.camera.position;
    c.x += (f.x - hx * back - c.x) * k;
    c.y += (f.y - hy * back - c.y) * k;
    c.z += (f.z + up - c.z) * k;
    this.followLookAt.set(f.x + hx * ahead, f.y + hy * ahead, f.z + 12);
    this.camera.lookAt(this.followLookAt);
  }

  fitShadowCamera() {
    const c = this.key.shadow.camera, m = 260, b = this.bounds;
    c.left = -b.width / 2 - m; c.right = b.width / 2 + m; c.top = b.height / 2 + m; c.bottom = -b.height / 2 - m;
    c.near = 1; c.far = 2200;
    c.updateProjectionMatrix();
  }

  // ---- exposure and daylight (observer side) --------------------------------------
  setViewBrightness(v) { this.viewBrightness = clampf(v, 0.5, 2.5); this._applyExposure(); }
  setAutoNightLift(on) { this.autoNightLift = !!on; this._applyExposure(); }
  _applyExposure() {
    this.displayExposure = clampf(this.viewBrightness * (this.autoNightLift ? this.autoLiftGain : 1), 0.25, 4);
    this.renderer.toneMappingExposure = this.displayExposure;
  }
  get exposureInfo() { return { exposure: this.displayExposure, autoLift: this.autoNightLift ? this.autoLiftGain : 1 }; }

  updateDayNight() {
    const now = new Date();
    const hour = now.getHours() + now.getMinutes() / 60;
    const sky = dayNightAt(hour);
    const grad = this.skyCtx.createLinearGradient(0, 0, 0, 256);
    grad.addColorStop(0, `#${sky.top.getHexString()}`);
    grad.addColorStop(0.55, `#${sky.mid.getHexString()}`);
    grad.addColorStop(1, `#${sky.bottom.getHexString()}`);
    this.skyCtx.fillStyle = grad;
    this.skyCtx.fillRect(0, 0, 2, 256);
    this.skyTex.needsUpdate = true;
    this.scene.fog.color.copy(sky.fog);
    this.renderer.setClearColor(sky.fog, 1);
    this.key.color.copy(sky.keyColor);
    const arousal = circadianActivity(hour);
    this.key.intensity = sky.keyIntensity * (0.75 + 0.25 * arousal);
    this.ambientLight.intensity = sky.ambient * (0.75 + 0.25 * arousal);
    const relative = sceneLightLevel(this.ambientLight.intensity, this.key.intensity) / DAY_REFERENCE_LIGHT;
    this.autoLiftGain = autoExposureGain(relative);
    this._applyExposure();
  }

  // ---- snapshots ------------------------------------------------------------------------
  applySnapshot(snap) {
    this.snap = snap;
    // flies
    while (this.flyViews.length < snap.poses.length) {
      const model = buildFlyModel();
      this.scene.add(model.root);
      this.flyViews.push({ model, nodes: poseNodes(model) });
    }
    while (this.flyViews.length > snap.poses.length) {
      const v = this.flyViews.pop();
      this.scene.remove(v.model.root);
    }
    snap.poses.forEach((pose, i) => applyPose(this.flyViews[i].model, pose, this.flyViews[i].nodes));
    this.world.applyState(snap.objects);
    const env = snap.env;
    this.rainPoints.visible = env.rain || env.iceRain;
    this.rainPoints.material.color.setHex(env.iceRain ? 0xdff3ff : 0xbfe0ff);
    this.fireGroup.visible = env.fire;
    this.fireGroup.position.set(snap.firePos.x, snap.firePos.y, 0);
    this.smokePoints.visible = env.smoke;
    this.dustPoints.visible = env.dust;
    this.floodMesh.visible = env.floodLevel > 0.003;
    this.floodMesh.position.z = env.floodLevel * FLOOD_MAX_Z;
    this.scentGroup.position.set(snap.scentPos.x, snap.scentPos.y, 0);
    this.quake = env.quake;
    this._syncFood(snap.food);
  }

  _syncFood(food) {
    const seen = new Set();
    for (const d of food) {
      seen.add(d.id);
      let v = this.foodViews.get(d.id);
      if (!v) {
        const color = d.kind === 'sugar' ? 0xfff3b0 : d.kind === 'bitter' ? 0x9be27a : 0xd9c87a;
        const drop = new THREE.Mesh(new THREE.SphereGeometry(12, 20, 12, 0, Math.PI * 2, 0, Math.PI / 2),
          new THREE.MeshPhongMaterial({ color, transparent: true, opacity: 0.78, specular: new THREE.Color(0.9, 0.9, 0.9), shininess: 120 }));
        drop.rotation.x = Math.PI / 2;
        drop.scale.set(1, 0.35, 1);
        const ring = new THREE.Mesh(new THREE.RingGeometry(15, 17, 32),
          new THREE.MeshBasicMaterial({ color: d.kind === 'sugar' ? 0xffe066 : d.kind === 'bitter' ? 0x6ee06e : 0xe0c060, transparent: true, opacity: 0.5, side: THREE.DoubleSide }));
        ring.position.z = 0.3;
        const g = new THREE.Group();
        g.add(drop, ring);
        g.userData.drop = drop;
        this.scene.add(g);
        v = g;
        this.foodViews.set(d.id, v);
      }
      const s = 0.35 + 0.65 * Math.sqrt(Math.max(0, d.volume));
      v.userData.drop.scale.set(s, 0.35 * s, s);
      v.position.set(d.x, d.y, 0.2);
    }
    for (const [id, v] of this.foodViews) if (!seen.has(id)) { this.scene.remove(v); this.foodViews.delete(id); }
  }

  // ---- per displayed frame -------------------------------------------------------------------
  frame(dt, tSeconds) {
    if (SHADOWS_ENABLED) this.renderer.shadowMap.needsUpdate = true;
    this.dayNightT += dt;
    if (this.dayNightT > 20) { this.dayNightT = 0; this.updateDayNight(); }
    this._animateWeather(dt, tSeconds);
    if (this.quake) { this.world.node.position.x = rnd(-3, 3); this.world.node.position.y = rnd(-3, 3); }
    else if (this.world.node.position.x || this.world.node.position.y) this.world.node.position.set(0, 0, 0);
    if (this.cameraMode === 'follow') this._updateFollowCamera(dt);
    this.visionT += dt;
    if (this.visionEnabled && this.visionT >= 0.05) { this.visionT = 0; this._renderEye(); }
    this.renderer.render(this.scene, this.camera);
  }

  _animateWeather(dt, t) {
    if (this.rainPoints.visible) {
      for (let i = 0; i < this.RAIN_COUNT; i++) {
        this.rainPos[3 * i + 2] -= this.rainVel[i] * dt;
        if (this.rainPos[3 * i + 2] < 0) this._resetDrop(i);
      }
      this.rainPoints.geometry.attributes.position.needsUpdate = true;
    }
    if (this.fireGroup.visible) {
      for (const m of this.fireGroup.children) {
        if (!m.isMesh) continue;
        const u = m.userData;
        m.position.z = u.baseZ + 14 * ((t * u.speed) % 1);
        if (((t * u.speed) % 1) < dt * u.speed) { m.position.x = rnd(-10, 10); m.position.y = rnd(-10, 10); }
        m.position.x += Math.sin(t * 3 + u.wobble) * 0.4;
      }
      this.fireGlow.intensity = 1.4 + 0.5 * Math.sin(t * 17);
    }
    for (const points of [this.smokePoints, this.dustPoints, this.pollenPoints]) {
      if (!points.visible) continue;
      const pos = points.geometry.attributes.position.array, vel = points.userData.vel;
      const hw = this.bounds.width / 2, hh = this.bounds.height / 2;
      for (let i = 0; i < pos.length / 3; i++) {
        pos[3 * i] += vel[3 * i] * dt; pos[3 * i + 1] += vel[3 * i + 1] * dt; pos[3 * i + 2] += vel[3 * i + 2] * dt;
        if (pos[3 * i + 2] > 150) pos[3 * i + 2] = 4;
        if (pos[3 * i] > hw) pos[3 * i] = -hw; else if (pos[3 * i] < -hw) pos[3 * i] = hw;
        if (pos[3 * i + 1] > hh) pos[3 * i + 1] = -hh; else if (pos[3 * i + 1] < -hh) pos[3 * i + 1] = hh;
      }
      points.geometry.attributes.position.needsUpdate = true;
    }
  }

  // The fly's own eye: the same scene from her head, along her heading, at
  // fixed exposure. The pixels come back asynchronously (a synchronous read
  // stalls the whole GPU pipeline); ~16 ms of sensory latency, far below what
  // the looming pathway integrates over.
  _renderEye() {
    const f = this.snap?.fly;
    if (!f) return;
    // The current read owns the previous frame's PBO. Rendering another eye
    // frame while it is pending cannot produce a sensory sample: the read
    // below would be skipped. Avoid that unused GPU pass, but leave the
    // 20 Hz sampling check in frame() and every accepted read unchanged.
    if (this.visionReadPending) return;
    const headZ = f.z + 8;
    this.visionCamera.position.set(f.x, f.y, headZ);
    this.visionCamera.lookAt(f.x + Math.cos(f.heading) * 40, f.y + Math.sin(f.heading) * 40, headZ);
    const r = this.renderer;
    r.toneMappingExposure = VISION_EXPOSURE;
    r.setRenderTarget(this.visionTarget);
    r.render(this.scene, this.visionCamera);
    r.setRenderTarget(null);
    r.toneMappingExposure = this.displayExposure;
    this.visionReadPending = true;
    r.readRenderTargetPixelsAsync(this.visionTarget, 0, 0, VISION_W, VISION_H, this.visionPixels)
      .then(() => { this.visionReadPending = false; this._processEye(); })
      .catch(() => { this.visionReadPending = false; });
  }

  _processEye() {
    const px = this.visionPixels, n = VISION_W * VISION_H;
    for (let p = 0; p < n; p++) {
      const o = p * 4;
      const lum = (px[o] * 0.299 + px[o + 1] * 0.587 + px[o + 2] * 0.114) / 255;
      this.visionMotion[p] = Math.abs(lum - this.visionPrevLum[p]);
      this.visionPrevLum[p] = lum;
    }
    // The first image after start (or after the eye was switched off) has
    // nothing real to be compared with: against the initial black it would
    // read as the whole world appearing at once — a maximal looming stimulus
    // manufactured by the renderer. It only primes the comparison.
    if (!this.eyePrimed) { this.eyePrimed = true; return; }
    // Centre-surround antagonism removes self-motion flow and keeps compact,
    // locally different motion — what LC4/LPLC2 are tuned to (src/vision.js).
    localMotionResidual(this.visionMotion, VISION_W, VISION_H, this.visionResidual, this.visionSurround, this.visionScratch);
    let sumL = 0, sumR = 0;
    for (let y = 0; y < VISION_H; y++) {
      for (let x = 0; x < VISION_W; x++) {
        const v = this.visionResidual[y * VISION_W + x];
        if (x < VISION_W / 2) sumL += v; else sumR += v;   // image left = her left eye
      }
    }
    const half = n / 2;
    this.visionMotionL = sumL / half; this.visionMotionR = sumR / half;
    this.onVision?.({ L: this.visionMotionL, R: this.visionMotionR });
    if (this.visionPreview) this._paintEye();
  }

  _paintEye() {
    const { rawCtx, motionCtx } = this.visionPreview;
    if (rawCtx) {
      const img = rawCtx.createImageData(VISION_W, VISION_H);
      // WebGL rows are bottom-up
      for (let y = 0; y < VISION_H; y++) {
        const src = (VISION_H - 1 - y) * VISION_W * 4, dst = y * VISION_W * 4;
        img.data.set(this.visionPixels.subarray(src, src + VISION_W * 4), dst);
      }
      for (let i = 3; i < img.data.length; i += 4) img.data[i] = 255;
      rawCtx.putImageData(img, 0, 0);
    }
    if (motionCtx) {
      const img = motionCtx.createImageData(VISION_W, VISION_H);
      for (let y = 0; y < VISION_H; y++) {
        for (let x = 0; x < VISION_W; x++) {
          const g = clampf(this.visionResidual[(VISION_H - 1 - y) * VISION_W + x] / 0.25, 0, 1);
          const o = (y * VISION_W + x) * 4;
          img.data[o] = 6 + 30 * g; img.data[o + 1] = 16 + 239 * g; img.data[o + 2] = 12 + 53 * g * g; img.data[o + 3] = 255;
        }
      }
      motionCtx.putImageData(img, 0, 0);
    }
  }

  // ---- pointer ----------------------------------------------------------------------------
  projectToGround(clientX, clientY) {
    const rect = this.renderer.domElement.getBoundingClientRect();
    const ndc = { x: ((clientX - rect.left) / rect.width) * 2 - 1, y: -((clientY - rect.top) / rect.height) * 2 + 1 };
    this.groundRay.setFromCamera(ndc, this.camera);
    const { origin, direction } = this.groundRay.ray;
    if (Math.abs(direction.z) < 1e-6) return null;
    const t = -origin.z / direction.z;
    if (t < 0) return null;
    return { x: origin.x + direction.x * t, y: origin.y + direction.y * t };
  }

  _bindPointer() {
    const el = this.renderer.domElement;
    el.addEventListener('contextmenu', (e) => e.preventDefault());
    this.drag = null;
    el.addEventListener('pointerdown', (e) => {
      if (e.button === 2) {
        if (this.cameraMode === 'overview') this.drag = { kind: 'camera', x: e.clientX, y: e.clientY };
        return;
      }
      if (e.button !== 0) return;
      const p = this.projectToGround(e.clientX, e.clientY);
      this.downPoint = p;
      if (!p || !this.snap) return;
      el.setPointerCapture(e.pointerId);
      const f = this.snap.fly;
      if (Math.hypot(f.x - p.x, f.y - p.y) < FLY_GRAB_RADIUS) {
        this.drag = { kind: 'fly' };
        this.onCommand('drag.start', { kind: 'fly', x: p.x, y: p.y });
        return;
      }
      let best = null, bestD = Infinity;
      this.world.objects.forEach((o, id) => {
        const d = Math.hypot(o.pos.x - p.x, o.pos.y - p.y);
        if (d < o.radius + OBJECT_GRAB_MARGIN && d < bestD) { bestD = d; best = { kind: 'object', id }; }
      });
      const points = [];
      if (this.snap.env.fire) points.push({ kind: 'fire', pos: this.snap.firePos, radius: 24 });
      points.push({ kind: 'scent', pos: this.snap.scentPos, radius: 18 });
      for (const d of this.snap.food) points.push({ kind: 'food', id: d.id, pos: d, radius: 20 });
      for (const pt of points) {
        const d = Math.hypot(pt.pos.x - p.x, pt.pos.y - p.y);
        if (d < pt.radius + OBJECT_GRAB_MARGIN && d < bestD) { bestD = d; best = { kind: 'point', id: { kind: pt.kind, id: pt.id } }; }
      }
      if (best) {
        this.drag = best;
        this.onCommand('drag.start', best);
      }
    });
    window.addEventListener('pointermove', (e) => {
      const rect = el.getBoundingClientRect();
      const inside = e.clientX >= rect.left && e.clientX <= rect.right && e.clientY >= rect.top && e.clientY <= rect.bottom;
      if (this.drag?.kind === 'camera') {
        const dx = e.clientX - this.drag.x, dy = e.clientY - this.drag.y;
        this.drag.x = e.clientX; this.drag.y = e.clientY;
        this.orbit.azimuth -= dx * 0.006;
        this.orbit.elevation = clampf(this.orbit.elevation - dy * 0.006, 0.08, 1.45);
        this.placeCamera();
        return;
      }
      const p = inside || this.drag ? this.projectToGround(e.clientX, e.clientY) : null;
      this.onPointer?.(p);
      if (this.drag && p) {
        if (this.drag.kind === 'object') {
          const o = this.world.objects[this.drag.id];
          if (o) { o.pos.x = p.x; o.pos.y = p.y; o.mesh.position.x = p.x; o.mesh.position.y = p.y; }
        }
        this.onCommand('drag.move', { x: p.x, y: p.y });
      }
    });
    el.addEventListener('pointerleave', () => { if (!this.drag) this.onPointer?.(null); });
    window.addEventListener('pointerup', (e) => {
      if (e.button === 2) { if (this.drag?.kind === 'camera') this.drag = null; return; }
      if (this.drag && this.drag.kind !== 'camera') this.onCommand('drag.end', {});
      else if (!this.drag && this.downPoint && e.target === el) this.onTap?.(this.downPoint);
      this.drag = null;
      this.downPoint = null;
    });
    el.addEventListener('wheel', (e) => {
      e.preventDefault();
      if (this.cameraMode !== 'overview') return;
      this.setZoom(this.orbit.zoom + e.deltaY * 0.0004);
      this.onZoom?.(this.orbit.zoom);
    }, { passive: false });
  }

  resize() {
    const w = Math.max(100, this.container.clientWidth), h = Math.max(100, this.container.clientHeight);
    if (w === this.bounds.width && h === this.bounds.height) return false;
    this.bounds = { width: w, height: h };
    this.renderer.setSize(w, h);
    if (this.cameraMode === 'overview') this.placeCamera();
    else { this.camera.aspect = w / h; this.camera.updateProjectionMatrix(); }
    this.fitMapOverlay();
    this.fitShadowCamera();
    this.world.resize(this.bounds);
    return true;
  }

  // three.js re-sizes the canvas on every call, which reallocates its drawing
  // buffer: only when the ratio actually changes (it is re-evaluated each second).
  setPixelRatio(r) {
    if (Math.abs(r - this.renderer.getPixelRatio()) < 0.001) return;
    this.renderer.setPixelRatio(r);
  }

  // head position of the brain-carrying fly on screen, for anchoring labels
  flyScreenPosition() {
    const f = this.snap?.fly;
    if (!f) return null;
    const v = new THREE.Vector3(f.x, f.y, f.z + 14).project(this.camera);
    return { x: (v.x + 1) / 2 * this.bounds.width, y: (1 - v.y) / 2 * this.bounds.height, visible: v.z < 1 };
  }
}
