// vision.js — the early-visual computation between the fly's rendered retinal
// image and the real LC4/LPLC2 looming population in sim.js.
//
// The problem this solves is a genuine one for any moving eye: a retina that
// simply reports "how much did each point change since last frame" cannot tell
// an approaching predator from the whole world sliding past because the animal
// itself turned or walked. Feeding that raw signal to an escape circuit
// manufactures threats out of ordinary locomotion.
//
// The previous stand-in subtracted the frame's median motion — a single global
// number. That removes a uniform whole-field shift, but not the structure real
// self-motion actually has: walking over textured ground produces strong
// parallax low in the visual field and almost none at the horizon, so a
// gradient like that survives a median untouched and keeps driving the escape
// pathway.
//
// Early visual systems, including the fly's own lamina/medulla, do not use a
// global constant. They use centre-surround antagonism: each unit is excited
// by its own patch and inhibited by the average of its neighbourhood. Broad,
// smoothly varying motion (self-motion flow, however uneven) is matched by its
// own surround and cancels; a compact patch moving differently from everything
// around it — which is what an approaching object is — stands out against its
// surround and survives. That is what this module implements, and it is both
// the more faithful model and the one that actually removes the parallax.
//
// Pure array maths, no WebGL and no three.js, so the behaviour is testable
// headlessly: see test/visiontest.js.

// Surround size in ommatidia. The rendered field is 64 x 24 across a 150 deg
// camera, i.e. roughly 2.3 deg per sample horizontally. A looming object large
// enough to matter subtends on the order of 10-30 deg (4-13 samples), so the
// surround has to be clearly wider than that to leave such an object standing
// while still averaging over the broad flow. Wider vertically in proportion to
// the much shorter axis.
export const SURROUND_RX = 10;
export const SURROUND_RY = 5;

// Separable box blur, edge-clamped. `tmp` and `out` must be the same length as
// `src`; `tmp` is scratch and its contents are not meaningful afterwards.
export function boxBlur(src, w, h, rx, ry, out, tmp) {
  for (let y = 0; y < h; y++) {
    const row = y * w;
    for (let x = 0; x < w; x++) {
      let sum = 0, n = 0;
      const x0 = Math.max(0, x - rx), x1 = Math.min(w - 1, x + rx);
      for (let k = x0; k <= x1; k++) { sum += src[row + k]; n++; }
      tmp[row + x] = sum / n;
    }
  }
  for (let x = 0; x < w; x++) {
    for (let y = 0; y < h; y++) {
      let sum = 0, n = 0;
      const y0 = Math.max(0, y - ry), y1 = Math.min(h - 1, y + ry);
      for (let k = y0; k <= y1; k++) { sum += tmp[k * w + x]; n++; }
      out[y * w + x] = sum / n;
    }
  }
}

// Centre-surround residual: what each ommatidium reports beyond what its
// neighbourhood is already doing. Clamped at zero — a patch moving LESS than
// its surround is not evidence of anything approaching.
export function localMotionResidual(motion, w, h, out, surround, tmp,
  rx = SURROUND_RX, ry = SURROUND_RY) {
  boxBlur(motion, w, h, rx, ry, surround, tmp);
  for (let i = 0; i < motion.length; i++) {
    out[i] = Math.max(0, motion[i] - surround[i]);
  }
  return out;
}
