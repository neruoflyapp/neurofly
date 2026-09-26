// The eye's 20 Hz trigger stays in TerrariumView.frame(). This focused test
// verifies that a pending GPU read cannot cause an unused eye render, while
// accepted reads still receive the same 64x24 RGBA bytes in the same order.
import assert from 'node:assert/strict';
import { TerrariumView } from '../renderer/view/terrarium.js';

const W = 64, H = 24;
const view = Object.create(TerrariumView.prototype);
view.snap = { fly: { x: 12, y: -8, z: 3, heading: 0.42 } };
view.visionTarget = {};
view.visionPixels = new Uint8Array(W * H * 4);
view.visionReadPending = false;
view.displayExposure = 1.7;
view.scene = {};
const cameraOps = [];
view.visionCamera = {
  position: { set(...args) { cameraOps.push(['position', ...args]); } },
  lookAt(...args) { cameraOps.push(['lookAt', ...args]); },
};
const gpuOps = [];
const pending = [];
view.renderer = {
  toneMappingExposure: 1.7,
  setRenderTarget(target) { gpuOps.push(['target', target]); },
  render(scene, camera) { gpuOps.push(['render', scene, camera]); },
  readRenderTargetPixelsAsync(target, x, y, w, h, pixels) {
    assert.equal(target, view.visionTarget);
    assert.deepEqual([x, y, w, h], [0, 0, W, H]);
    assert.equal(pixels, view.visionPixels);
    gpuOps.push(['read']);
    return new Promise(resolve => pending.push(resolve));
  },
};
const samples = [];
view._processEye = () => samples.push(Uint8Array.from(view.visionPixels));
const imageA = Uint8Array.from(view.visionPixels, (_, i) => (i * 29 + 7) & 255);
const imageB = Uint8Array.from(view.visionPixels, (_, i) => (i * 17 + 19) & 255);

view._renderEye();
assert.equal(view.visionReadPending, true);
assert.equal(gpuOps.filter(op => op[0] === 'render').length, 1);
assert.equal(gpuOps.filter(op => op[0] === 'read').length, 1);
assert.equal(view.renderer.toneMappingExposure, 1.7);

const opsBeforePendingAttempt = [gpuOps.length, cameraOps.length];
view._renderEye(); // another 50 ms vision slot while the first read is pending
assert.deepEqual([gpuOps.length, cameraOps.length], opsBeforePendingAttempt,
  'a skipped sample must not submit an obsolete GPU eye pass');
assert.equal(view.visionReadPending, true);

view.visionPixels.set(imageA);
pending.shift()();
await Promise.resolve();
assert.equal(view.visionReadPending, false);
assert.deepEqual(samples[0], imageA, 'the first accepted read is byte-identical');

view._renderEye(); // the following vision slot still renders and reads normally
assert.equal(gpuOps.filter(op => op[0] === 'render').length, 2);
assert.equal(gpuOps.filter(op => op[0] === 'read').length, 2);
view.visionPixels.set(imageB);
pending.shift()();
await Promise.resolve();
assert.deepEqual(samples[1], imageB, 'the second accepted read is byte-identical');
assert.equal(view.renderer.toneMappingExposure, 1.7);
console.log('PASS eye readback: pending slots render zero discarded frames; accepted RGBA samples stay byte-identical');
