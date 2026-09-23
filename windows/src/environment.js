// environment.js — the permission-free "senses" that are pure computation.
// The OS-specific ones (idle timer, typing) live in main.js, because they
// need Electron's powerMonitor API.

// A walkable window top edge, in scene coordinates (origin at screen center).
export function makeLedge(y, x0, x1, id) { return { y, x0, x1, id }; }

// Drosophila circadian activity: morning and evening peaks, midday siesta,
// night quiescence. Returns a multiplier for the sim's baseline drive.
export function circadianActivity(hour) {
  const pts = [[0, 0.25], [5, 0.25], [8, 1.0], [10, 1.0], [13, 0.55],
               [15, 0.55], [17, 1.0], [20, 1.0], [23, 0.3], [24, 0.25]];
  for (let i = 0; i < pts.length - 1; i++) {
    if (hour >= pts[i][0] && hour <= pts[i + 1][0]) {
      const t = (hour - pts[i][0]) / Math.max(0.001, pts[i + 1][0] - pts[i][0]);
      return pts[i][1] + (pts[i + 1][1] - pts[i][1]) * t;
    }
  }
  return 0.25;
}

// Temperature at a position in a terrarium that is not all one temperature.
// `spanC` is the total difference between the two ends (0 = uniform) and
// `meanC` stays the arena's mean, so widening the gradient makes the world
// more unequal without also making it hotter on average — otherwise a
// thermal-preference reading would be confounded by the mean shifting under
// it. Cool end at u = 0 (west), warm end at u = 1 (east).
//
// This is the classic Drosophila thermal-gradient arena. It adds no new
// mechanism: the same documented thermal responses (cold torpor, locomotor
// tempo, the heat-escape reflex) simply become a function of where she is.
export function localTemperature(meanC, spanC, u) {
  if (!spanC) return meanC;
  const clamped = u < 0 ? 0 : u > 1 ? 1 : u;
  return meanC + (clamped - 0.5) * spanC;
}
