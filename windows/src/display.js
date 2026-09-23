// display.js — observer-side view math. Nothing in this file may ever reach
// the fly: it decides how brightly the USER's camera reports the terrarium,
// never how brightly the terrarium is actually lit. The simulated lighting
// (and therefore everything the fly's own eye renders in app.js's
// updateVision) is computed entirely separately and is not an input here.
//
// Split out of app.js so it can be tested headlessly — app.js needs a WebGL
// context, this is arithmetic. See test/displaytest.js.

// Overall illumination proxy, weighted the way the renderer actually uses the
// two lights: ambient reaches everything, the key only the faces turned to it.
export function sceneLightLevel(ambient, keyIntensity) {
  return ambient + 0.45 * keyIntensity;
}

// How far the exposure may open up before we would rather show an honestly
// dark scene than a noisy, flat one.
export const MAX_AUTO_LIFT = 2.4;

// Camera-style auto-exposure. `relative` is the current scene light as a
// fraction of the brightest the day ever gets (1.0 at that peak).
//
// The exponent is the whole design. Gain = relative^-COMPRESSION makes the
// displayed brightness relative^(1-COMPRESSION) — still strictly increasing in
// the real light level, so the picture can never claim night is brighter than
// noon (see the ordering test). It only compresses the range, the way any
// camera does, so a 24% night reads at ~52% instead of vanishing into black.
const COMPRESSION = 0.55;

export function autoExposureGain(relative, maxLift = MAX_AUTO_LIFT) {
  const safe = Math.max(0.02, relative);
  return Math.min(maxLift, Math.max(1, Math.pow(safe, -COMPRESSION)));
}

// Displayed brightness relative to the day peak, after auto-exposure. Exposed
// for tests and for reasoning about the curve; the renderer applies the gain
// itself via toneMappingExposure.
export function displayedRelative(relative, maxLift = MAX_AUTO_LIFT) {
  return relative * autoExposureGain(relative, maxLift);
}
