// experiments.js — standardised in-silico experiments with statistics.
//
// Each protocol is what a fly lab would run: a controlled stimulus in a bare
// arena, repeated trials, a stated readout, a statistical test, and a
// comparison with the published finding it corresponds to. They run on a
// separate "rig" — the complete closed loop (src/closed-loop.js) with an empty
// world and no instruments — so the live fly is never disturbed, and every
// result is reproducible from its seed.
//
// A protocol reports what the MODEL does. Agreement with the literature
// shows that the extracted wiring plus the model's assumptions reproduce a
// finding; disagreement is reported just as plainly, as is a finding the
// model has no mechanism for.

import { wilson, fisherExact, mannWhitney, fitLogistic, mean, sem, linearFit } from './stats.js';

export const LITERATURE = Object.freeze({
  vonReyn2014: { cite: 'von Reyn et al. (2014) Nat Neurosci 17:962', doi: 'https://doi.org/10.1038/nn.3741' },
  vonReyn2017: { cite: 'von Reyn et al. (2017) Neuron 94:1190', doi: 'https://doi.org/10.1016/j.neuron.2017.05.036' },
  ache2019: { cite: 'Ache et al. (2019) Curr Biol 29:1073', doi: 'https://doi.org/10.1016/j.cub.2019.01.079' },
  card2008: { cite: 'Card & Dickinson (2008) Curr Biol 18:1300', doi: 'https://doi.org/10.1016/j.cub.2008.07.094' },
  yorozu2009: { cite: 'Yorozu et al. (2009) Nature 458:201', doi: 'https://doi.org/10.1038/nature07843' },
  kamikouchi2009: { cite: 'Kamikouchi et al. (2009) Nature 458:165', doi: 'https://doi.org/10.1038/nature07810' },
  shiu2024: { cite: 'Shiu et al. (2024) Nature 634:210', doi: 'https://doi.org/10.1038/s41586-024-07763-9' },
  hampel2020: { cite: 'Hampel et al. (2020) eLife 9:e59976', doi: 'https://doi.org/10.7554/eLife.59976' },
  guo2022: { cite: 'Guo, Zhang & Simpson (2022) Curr Biol 32:823', doi: 'https://doi.org/10.1016/j.cub.2021.12.055' },
  bidaye2014: { cite: 'Bidaye et al. (2014) Science 344:97', doi: 'https://doi.org/10.1126/science.1249964' },
  bidaye2020: { cite: 'Bidaye et al. (2020) Neuron 108:469', doi: 'https://doi.org/10.1016/j.neuron.2020.07.032' },
  rayshubskiy2020: { cite: 'Rayshubskiy et al. (2025) eLife, reviewed preprint 102230 (bioRxiv 2020)', doi: 'https://elifesciences.org/articles/102230' },
  lima2005: { cite: 'Lima & Miesenböck (2005) Cell 121:141', doi: 'https://doi.org/10.1016/j.cell.2005.02.004' },
  hamada2008: { cite: 'Hamada et al. (2008) Nature 454:217', doi: 'https://doi.org/10.1038/nature07001' },
  sayeed1996: { cite: 'Sayeed & Benzer (1996) PNAS 93:6079', doi: 'https://doi.org/10.1073/pnas.93.12.6079' },
  engel1996: { cite: 'Engel & Wu (1996) J Neurosci 16:3486', doi: 'https://pubmed.ncbi.nlm.nih.gov/8627381/' },
  ueno2017: { cite: 'Ueno et al. (2017) eLife 6:e21076', doi: 'https://elifesciences.org/articles/21076' },
  gibbons2022: { cite: 'Gibbons et al. (2022) Adv Insect Physiol 63:155', doi: 'https://doi.org/10.1016/bs.aiip.2022.10.001' },
});

// Deterministic per-trial seeds from one master seed.
export function seedStream(master) {
  let s = (master >>> 0) || 1;
  return () => {
    s = (s + 0x6d2b79f5) >>> 0;
    let t = s;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) || 1;
  };
}

// One trial: settle, stimulate, observe. Returns the behavioural readouts.
export function runTrial(rig, seed, { settle = 0.4, duration = 0.3, after = 0.3, stimulus = {}, apply = null, release = null }) {
  rig.resetTrial(seed);
  rig.run(settle);
  if (rig.fly.state === 'flying') rig.fly.land();
  const sim = rig.sim;
  const onsetMs = sim.simMs;
  const gf0 = sim.gfSpikeCount;
  let firstGF = -1, tookOff = false, backward = false, headGroom = false, legGroom = false, walkTicks = 0;
  const onset = {};                       // behaviour -> first tick it appeared
  let walkRun = 0;
  const mark = (key, k) => { if (onset[key] === undefined) onset[key] = k; };
  let perMax = 0, perLatency = -1, groomLatency = -1, proboscisSum = 0, dng12Sum = 0, ticks = 0;
  const heading0 = rig.fly.heading;
  let headingNet = 0, lastHeading = heading0;
  rig.override = stimulus;
  if (apply) apply(rig);
  const total = duration + after;
  const stimTicks = Math.round(duration * 120);
  rig.run(total, (r, k) => {
    if (k === stimTicks) { r.override = null; if (release) release(r); }
    const f = r.fly;
    if (firstGF < 0 && sim.gfSpikeCount > gf0) firstGF = sim.lastGFSpikeMs - onsetMs;
    if (f.state === 'flying') { tookOff = true; mark('takeoff', k); }
    if (f.backwardTimer > 0) { backward = true; mark('backward', k); }
    if (f.state === 'grooming') {
      if (f.groomMode === 'head') { headGroom = true; mark('headGroom', k); } else { legGroom = true; mark('legGroom', k); }
      if (groomLatency < 0) groomLatency = (k + 1) / 120;
    }
    // walking counts as a behaviour once it has lasted a quarter second
    if (f.state === 'walking' && f.backwardTimer <= 0) { walkTicks++; walkRun++; if (walkRun >= 30) mark('walk', k - 29); } else walkRun = 0;
    if (f.proboscisExtension > perMax) perMax = f.proboscisExtension;
    if (perLatency < 0 && f.proboscisExtension > 0.5) { perLatency = (k + 1) / 120; mark('per', k); }
    let dh = f.heading - lastHeading;
    while (dh > Math.PI) dh -= 2 * Math.PI;
    while (dh < -Math.PI) dh += 2 * Math.PI;
    if (f.state === 'walking') headingNet += dh;
    lastHeading = f.heading;
    if (k < stimTicks) { proboscisSum += sim.rateProboscis; dng12Sum += sim.rateDNg12; ticks++; }
  });
  rig.override = null;
  return {
    gfSpikes: sim.gfSpikeCount - gf0, gfLatencyMs: firstGF, tookOff, backward, headGroom, legGroom,
    walkFraction: walkTicks / Math.max(1, Math.round(total * 120)), per: perMax > 0.5, perMax, perLatencyS: perLatency,
    groomLatencyS: groomLatency, proboscisHz: proboscisSum / Math.max(1, ticks), dng12Hz: dng12Sum / Math.max(1, ticks),
    turn: headingNet, onset,
  };
}

const proportion = (rows, key) => { const k = rows.filter((r) => r[key]).length; return { k, n: rows.length, ...wilson(k, rows.length) }; };

// ---- the protocols -----------------------------------------------------------------------
export const PROTOCOLS = [
  {
    id: 'escape-threshold', category: 'Escape', icon: 'loom',
    title: 'Looming escape threshold',
    question: 'How strong must an approaching object be before the giant fiber fires and she takes off?',
    measures: 'Takeoff probability and giant-fiber latency against looming intensity (both eyes, 300 ms steps).',
    literature: [{ ...LITERATURE.vonReyn2014, finding: 'Looming stimuli drive the giant fiber; its spike commits the fly to a short-mode takeoff.' },
      { ...LITERATURE.card2008, finding: 'Escape probability rises with looming strength.' }],
    defaults: { trials: 12 },
    levels: [0.04, 0.08, 0.12, 0.16, 0.2, 0.3, 0.45, 0.65, 1.0],
    estimateSeconds: (p) => 9 * p.trials * 1.0,
    *run(rig, p, nextSeed) {
      const rows = [];
      const levels = this.levels;
      let done = 0;
      for (const level of levels) {
        for (let i = 0; i < p.trials; i++) {
          const r = runTrial(rig, nextSeed(), { duration: 0.3, after: 0.3, stimulus: { loomL: level, loomR: level } });
          rows.push({ intensity: level, trial: i + 1, ...r });
          yield ++done / (levels.length * p.trials);
        }
      }
      const pts = levels.map((x) => { const sub = rows.filter((r) => r.intensity === x); return { x, ...proportion(sub, 'tookOff'), latency: mean(sub.filter((r) => r.gfLatencyMs >= 0).map((r) => r.gfLatencyMs)) }; });
      const fit = fitLogistic(pts.map((q) => ({ x: q.x, k: q.k, n: q.n })));
      return {
        rows,
        chart: { type: 'curve', xLabel: 'Looming intensity', yLabel: 'Takeoff probability', x: levels,
          series: [{ label: 'Takeoff', y: pts.map((q) => q.p), lo: pts.map((q) => q.lo), hi: pts.map((q) => q.hi) }],
          fit: fit ? { x50: fit.x50, slope: fit.slope } : null },
        stats: [
          { key: 'threshold', value: fit?.brackets ? fit.x50 : null, format: 'fixed2' },
          { key: 'latencyAtMax', value: pts[pts.length - 1].latency, unit: 'ms', format: 'fixed1' },
          { key: 'spontaneous', value: pts[0].p, format: 'pct' },
        ],
        verdict: fit?.brackets ? { code: 'threshold', params: { x50: fit.x50.toFixed(2) } } : { code: 'noTransition' },
      };
    },
  },
  {
    id: 'sound-vs-wind', category: 'Senses', icon: 'antenna',
    title: 'Sound versus wind',
    question: "Two stimuli of equal strength reach different Johnston's-organ neurons. Does the wiring alone decide which one makes her flee?",
    measures: 'Giant-fiber spikes and takeoffs for near-field sound (JO-A/B), steady wind (JO-C/D/E), an air puff (both) and no stimulus.',
    literature: [{ ...LITERATURE.yorozu2009, finding: 'Sound and wind are carried by separate JO populations; wind makes flies stop walking rather than flee.' },
      { ...LITERATURE.kamikouchi2009, finding: 'JO-A/B are vibration-sensitive, JO-C/E deflection-sensitive.' }],
    defaults: { trials: 12 },
    estimateSeconds: (p) => 4 * p.trials * 1.3,
    *run(rig, p, nextSeed) {
      const conds = [['none', {}], ['sound', { sound: 0.6 }], ['wind', { wind: 0.6 }], ['puff', { puff: 0.6 }]];
      const rows = [];
      let done = 0;
      for (const [label, stimulus] of conds) {
        for (let i = 0; i < p.trials; i++) {
          const r = runTrial(rig, nextSeed(), { duration: 0.6, after: 0.3, stimulus });
          rows.push({ condition: label, trial: i + 1, ...r });
          yield ++done / (conds.length * p.trials);
        }
      }
      const by = (c) => rows.filter((r) => r.condition === c);
      const sound = by('sound'), wind = by('wind');
      const pSound = proportion(sound, 'tookOff'), pWind = proportion(wind, 'tookOff');
      const fisher = fisherExact(pSound.k, pSound.n - pSound.k, pWind.k, pWind.n - pWind.k);
      const mw = mannWhitney(sound.map((r) => r.gfSpikes), wind.map((r) => r.gfSpikes));
      return {
        rows,
        chart: { type: 'bars', xLabel: 'Stimulus', yLabel: 'Giant-fiber spikes per trial', x: conds.map((c) => c[0]),
          series: [{ label: 'GF spikes', y: conds.map((c) => mean(by(c[0]).map((r) => r.gfSpikes))), err: conds.map((c) => sem(by(c[0]).map((r) => r.gfSpikes))) }] },
        stats: [
          { key: 'takeoffSound', value: pSound.p, format: 'pct' },
          { key: 'takeoffWind', value: pWind.p, format: 'pct' },
          { key: 'fisherP', value: fisher, format: 'p' },
          { key: 'mannWhitneyP', value: mw.p, format: 'p' },
        ],
        verdict: mean(sound.map((r) => r.gfSpikes)) > mean(wind.map((r) => r.gfSpikes)) && mw.p < 0.05
          ? { code: 'soundEscapes' } : { code: 'noDifference' },
      };
    },
  },
  {
    id: 'taste-tradeoff', category: 'Taste', icon: 'drop', requires: 'taste',
    title: 'Sugar, bitter and the proboscis',
    question: 'Does more sugar make her extend her proboscis more reliably — and can bitter talk her out of it?',
    measures: 'Proboscis extension (PER) against sugar concentration, and at fixed sugar against added bitter. 1 s on the labellum.',
    literature: [{ ...LITERATURE.shiu2024, finding: 'In the whole-brain FlyWire model, sugar neurons activate proboscis motor neuron MN9 and bitter input suppresses it; confirmed experimentally.' },
      { ...LITERATURE.gibbons2022, finding: 'Weighing reward against an aversive stimulus is the "motivational trade-off" criterion of the sentience framework (rated high confidence for adult flies).' }],
    defaults: { trials: 8 },
    sugarLevels: [0, 0.2, 0.3, 0.4, 0.5, 0.75, 1],
    bitterLevels: [0, 0.2, 0.35, 0.5, 0.75, 1],
    estimateSeconds: (p) => 13 * p.trials * 1.8,
    *run(rig, p, nextSeed) {
      const rows = [];
      const total = (this.sugarLevels.length + this.bitterLevels.length) * p.trials;
      let done = 0;
      for (const s of this.sugarLevels) {
        for (let i = 0; i < p.trials; i++) {
          const r = runTrial(rig, nextSeed(), { duration: 1.0, after: 0.2, stimulus: { sugar: s } });
          rows.push({ series: 'sugar', sugar: s, bitter: 0, trial: i + 1, ...r });
          yield ++done / total;
        }
      }
      for (const b of this.bitterLevels) {
        for (let i = 0; i < p.trials; i++) {
          const r = runTrial(rig, nextSeed(), { duration: 1.0, after: 0.2, stimulus: { sugar: 0.75, bitter: b } });
          rows.push({ series: 'bitter', sugar: 0.75, bitter: b, trial: i + 1, ...r });
          yield ++done / total;
        }
      }
      const sugarPts = this.sugarLevels.map((x) => ({ x, ...proportion(rows.filter((r) => r.series === 'sugar' && r.sugar === x), 'per') }));
      const bitterPts = this.bitterLevels.map((x) => ({ x, ...proportion(rows.filter((r) => r.series === 'bitter' && r.bitter === x), 'per') }));
      const fit = fitLogistic(sugarPts.map((q) => ({ x: q.x, k: q.k, n: q.n })));
      const b0 = bitterPts[0], bMax = bitterPts[bitterPts.length - 1];
      const fisher = fisherExact(b0.k, b0.n - b0.k, bMax.k, bMax.n - bMax.k);
      return {
        rows,
        chart: { type: 'curve', xLabel: 'Concentration', yLabel: 'P(proboscis extension)', x: this.sugarLevels,
          series: [{ label: 'Sugar', y: sugarPts.map((q) => q.p), lo: sugarPts.map((q) => q.lo), hi: sugarPts.map((q) => q.hi) },
            { label: 'Bitter added to sugar 0.75', x: this.bitterLevels, y: bitterPts.map((q) => q.p), lo: bitterPts.map((q) => q.lo), hi: bitterPts.map((q) => q.hi) }] },
        stats: [
          { key: 'sugarThreshold', value: fit?.brackets ? fit.x50 : null, format: 'fixed2' },
          { key: 'perSugarOnly', value: b0.p, format: 'pct' },
          { key: 'perWithBitter', value: bMax.p, format: 'pct' },
          { key: 'fisherP', value: fisher, format: 'p' },
        ],
        verdict: fit?.brackets && fisher < 0.05 && bMax.p < b0.p ? { code: 'tradeoff' }
          : fit?.brackets ? { code: 'sugarOnly' } : { code: 'noPer' },
      };
    },
  },
  {
    id: 'dust-grooming', category: 'Self-care', icon: 'groom', requires: 'grooming',
    title: 'Dust and head grooming',
    question: 'Does dust on the antennae make her groom her head — and does it need the JO-F sensory neurons to do it?',
    measures: 'Head-grooming probability against the amount of dust, and at full dust with JO-F or DNg12 silenced. 2.5 s.',
    literature: [{ ...LITERATURE.hampel2020, finding: 'Activating JO-F mechanosensory neurons elicits antennal grooming.' },
      { ...LITERATURE.guo2022, finding: 'DNg12 activation drives head sweeps alternating with front-leg rubbing.' }],
    defaults: { trials: 8 },
    levels: [0, 0.3, 0.45, 0.6, 0.8, 1],
    estimateSeconds: (p) => 8 * p.trials * 3.2,
    *run(rig, p, nextSeed) {
      const rows = [];
      const conds = this.levels.map((d) => ({ label: `dust ${d}`, dust: d, silence: null }));
      conds.push({ label: 'dust 1, JO-F silenced', dust: 1, silence: 'joF' }, { label: 'dust 1, DNg12 silenced', dust: 1, silence: 'dng12' });
      let done = 0;
      for (const c of conds) {
        if (c.silence) rig.setGenetic({ population: c.silence, mode: 'silence', on: true });
        for (let i = 0; i < p.trials; i++) {
          const r = runTrial(rig, nextSeed(), { duration: 2.5, after: 0.2, stimulus: { dust: c.dust } });
          rows.push({ condition: c.label, dust: c.dust, silenced: c.silence ?? '', trial: i + 1, ...r });
          yield ++done / (conds.length * p.trials);
        }
        if (c.silence) rig.clearGenetics();
      }
      const pts = this.levels.map((x) => ({ x, ...proportion(rows.filter((r) => r.dust === x && !r.silenced), 'headGroom') }));
      const full = pts[pts.length - 1];
      const joF = proportion(rows.filter((r) => r.silenced === 'joF'), 'headGroom');
      const dn = proportion(rows.filter((r) => r.silenced === 'dng12'), 'headGroom');
      const pJoF = fisherExact(full.k, full.n - full.k, joF.k, joF.n - joF.k);
      return {
        rows,
        chart: { type: 'curve', xLabel: 'Dust on the antennae', yLabel: 'P(head grooming)', x: this.levels,
          series: [{ label: 'Intact', y: pts.map((q) => q.p), lo: pts.map((q) => q.lo), hi: pts.map((q) => q.hi) }],
          markers: [{ label: 'JO-F silenced', x: 1, y: joF.p }, { label: 'DNg12 silenced', x: 1, y: dn.p }] },
        stats: [
          { key: 'groomFullDust', value: full.p, format: 'pct' },
          { key: 'groomJoFSilenced', value: joF.p, format: 'pct' },
          { key: 'groomDng12Silenced', value: dn.p, format: 'pct' },
          { key: 'fisherP', value: pJoF, format: 'p' },
        ],
        verdict: full.p > 0.5 && pJoF < 0.05 ? { code: 'necessary' } : full.p > 0.5 ? { code: 'groomsNotNecessary' } : { code: 'noGrooming' },
      };
    },
  },
  {
    id: 'opto-screen', category: 'Virtual genetics', icon: 'bolt',
    title: 'Optogenetic activation screen',
    question: 'Switch on one identified cell type at a time. Does each one produce the behaviour it is known for?',
    measures: 'Behaviour within 1.1 s of a 0.8 s activation, per cell type, against a no-light control.',
    literature: [{ ...LITERATURE.lima2005, finding: 'Activating the giant fiber evokes escape jumps.' },
      { ...LITERATURE.bidaye2014, finding: 'MDN activation drives backward walking.' },
      { ...LITERATURE.bidaye2020, finding: 'Activating DNp09 (P9) drives forward walking.' },
      { ...LITERATURE.guo2022, finding: 'DNg11: front-leg rubbing. DNg12: head grooming.' },
      { ...LITERATURE.rayshubskiy2020, finding: 'DNa02 activity steers turns to its own side.' },
      { ...LITERATURE.ache2019, finding: 'LPLC2 activation triggers escape takeoffs.' },
      { ...LITERATURE.hampel2020, finding: 'JO-F activation elicits antennal grooming.' },
      { ...LITERATURE.shiu2024, finding: 'Sugar-neuron activation drives proboscis extension.' }],
    defaults: { trials: 6 },
    targets: [
      { key: 'control', population: null, expect: 'none' },
      { key: 'gf', population: 'gf', strength: 0.5, expect: 'takeoff' },
      { key: 'lplc2', population: 'lplc2', strength: 0.3, expect: 'takeoff' },
      { key: 'fwd', population: 'fwd', strength: 0.25, expect: 'walk' },
      { key: 'mdn', population: 'mdn', strength: 0.3, expect: 'backward' },
      { key: 'groom', population: 'groom', strength: 0.25, expect: 'legGroom' },
      { key: 'dng12', population: 'dng12', strength: 0.35, expect: 'headGroom' },
      // Steering neurons act on a walking fly (Rayshubskiy et al. 2020): DNp09
      // is co-activated so that there is walking to steer.
      { key: 'dnaL', population: 'dnaL', strength: 0.3, expect: 'turnLeft', withWalk: true },
      { key: 'dnaR', population: 'dnaR', strength: 0.3, expect: 'turnRight', withWalk: true },
      { key: 'joF', population: 'joF', strength: 0.25, expect: 'headGroom' },
      { key: 'sugar', population: 'sugar', strength: 0.2, expect: 'per' },
    ],
    estimateSeconds: (p) => 11 * p.trials * 1.5,
    *run(rig, p, nextSeed) {
      const rows = [];
      const targets = this.targets.filter((tg) => !tg.population || rig.resolvePopulation(tg.population));
      let done = 0;
      // Which behaviours appeared at all in a trial.
      const present = (r) => ({
        takeoff: r.tookOff, backward: r.backward, headGroom: r.headGroom, legGroom: r.legGroom, per: r.per,
        walk: r.onset.walk !== undefined, turnLeft: r.turn > 0.6, turnRight: r.turn < -0.6,
      });
      const BEHAVIOURS = ['takeoff', 'backward', 'headGroom', 'legGroom', 'per', 'walk', 'turnLeft', 'turnRight'];
      const results = [];
      const fractions = {};
      for (const tg of targets) {
        const counts = Object.fromEntries(BEHAVIOURS.map((b) => [b, 0]));
        for (let i = 0; i < p.trials; i++) {
          const r = runTrial(rig, nextSeed(), { duration: 0.8, after: 0.3, apply: (rr) => {
            if (!tg.population) return;
            const pop = rr.resolvePopulation(tg.population);
            rr.sim.stimulate(pop.indices, tg.strength, 800);
            if (tg.withWalk) rr.sim.stimulate(rr.sim.fwd, 0.25, 800);
          } });
          const seen = present(r);
          for (const b of BEHAVIOURS) if (seen[b]) counts[b]++;
          const { onset: _onset, ...readouts } = r;
          rows.push({ target: tg.key, trial: i + 1, ...readouts, behaviours: BEHAVIOURS.filter((b) => seen[b]).join('+') || 'none' });
          yield ++done / (targets.length * p.trials);
        }
        fractions[tg.key] = Object.fromEntries(BEHAVIOURS.map((b) => [b, counts[b] / p.trials]));
        // An effect is what the light added over its control: the no-light
        // control, or DNp09-driven walking for the steering neurons.
        const base = fractions[tg.withWalk ? 'fwd' : 'control'] || fractions.control || {};
        const evoked = Object.fromEntries(BEHAVIOURS.map((b) => [b, fractions[tg.key][b] - (tg.key === 'control' ? 0 : base[b] || 0)]));
        const [top, topGain] = Object.entries(evoked).sort((a, b) => b[1] - a[1])[0];
        const observed = tg.key === 'control' ? 'baseline' : topGain >= 0.25 ? top : 'none';
        results.push({ target: tg.key, expect: tg.expect, observed, evokedFraction: tg.key === 'control' ? 0 : evoked[tg.expect] ?? 0,
          expectedFraction: tg.expect === 'none' ? 0 : fractions[tg.key][tg.expect] ?? 0,
          match: tg.key === 'control' ? true : (evoked[tg.expect] ?? 0) >= 0.34 });
      }
      const matches = results.filter((r) => r.target !== 'control' && r.match).length;
      return {
        rows,
        table: results.filter((r) => r.target !== "control"),
        chart: { type: 'bars', xLabel: 'Activated cell type', yLabel: 'Increase over control in the expected behaviour', x: results.filter((r) => r.target !== 'control').map((r) => r.target),
          series: [{ label: 'Evoked', y: results.filter((r) => r.target !== 'control').map((r) => r.evokedFraction) }] },
        stats: [{ key: 'matches', value: `${matches}/${results.length - 1}`, format: 'text' }],
        verdict: { code: 'screen', params: { matches, total: results.length - 1 } },
      };
    },
  },
  {
    id: 'silencing-escape', category: 'Virtual genetics', icon: 'mute',
    title: 'Which looming detectors does escape need?',
    question: 'Silence LPLC2, LC4 or both (Kir2.1-like). How much of the escape response survives?',
    measures: 'Takeoff probability and giant-fiber spikes to a moderate looming stimulus (0.2, 300 ms), each condition against the intact control.',
    literature: [{ ...LITERATURE.vonReyn2017, finding: 'LC4 and LPLC2 carry complementary looming features to the giant fiber.' },
      { ...LITERATURE.ache2019, finding: 'LPLC2 is required for normal looming-evoked escape.' }],
    defaults: { trials: 15 },
    estimateSeconds: (p) => 4 * p.trials * 1.0,
    *run(rig, p, nextSeed) {
      const conds = [['intact', []], ['LPLC2 silenced', ['lplc2']], ['LC4 silenced', ['lc4']], ['both silenced', ['lplc2', 'lc4']]];
      const rows = [];
      let done = 0;
      for (const [label, pops] of conds) {
        for (const pop of pops) rig.setGenetic({ population: pop, mode: 'silence', on: true });
        for (let i = 0; i < p.trials; i++) {
          const r = runTrial(rig, nextSeed(), { duration: 0.3, after: 0.3, stimulus: { loomL: 0.2, loomR: 0.2 } });
          rows.push({ condition: label, trial: i + 1, ...r });
          yield ++done / (conds.length * p.trials);
        }
        rig.clearGenetics();
      }
      const by = (c) => rows.filter((r) => r.condition === c);
      const ctlSpikes = by('intact').map((r) => r.gfSpikes);
      const out = conds.map(([label]) => {
        const q = proportion(by(label), 'tookOff');
        const sp = by(label).map((r) => r.gfSpikes);
        return { label, ...q, spikes: mean(sp), pVsControl: label === 'intact' ? null : mannWhitney(ctlSpikes, sp).p };
      });
      const ctl = out[0];
      return {
        rows,
        chart: { type: 'bars', xLabel: 'Condition', yLabel: 'Giant-fiber spikes per trial', x: out.map((o) => o.label),
          series: [{ label: 'GF spikes', y: out.map((o) => o.spikes), err: conds.map(([label]) => sem(by(label).map((r) => r.gfSpikes))) }],
          secondary: { label: 'Takeoff probability', y: out.map((o) => o.p) } },
        stats: [...out.map((o) => ({ key: 'gfSpikesFor', params: { condition: o.label }, value: o.spikes, format: 'fixed1' })),
          ...out.slice(1).map((o) => ({ key: 'pVsControlFor', params: { condition: o.label }, value: o.pVsControl, format: 'p' }))],
        verdict: out[1].pVsControl < 0.05 && out[2].pVsControl < 0.05 && out[1].spikes < ctl.spikes && out[2].spikes < ctl.spikes
          ? { code: 'bothMatter' }
          : out[3].pVsControl < 0.05 && out[3].spikes < ctl.spikes ? { code: 'redundant' } : { code: 'noEffect' },
      };
    },
  },
  {
    id: 'inhibition-escape', category: 'Pharmacology', icon: 'pill',
    title: 'Inhibition as the escape gate',
    question: 'Feedforward inhibition races the looming signal to the giant fiber. What happens when inhibitory synapses are weakened or strengthened?',
    measures: 'Takeoff probability and giant-fiber spikes to a near-threshold looming stimulus (0.15) at seven inhibitory synaptic gains (GABA + glutamate class): a dose–response curve and its half-maximal gain.',
    literature: [{ ...LITERATURE.vonReyn2014, finding: 'Giant-fiber spike timing decides between short- and long-mode takeoff; its recruitment is shaped by the balance of excitation and inhibition.' }],
    defaults: { trials: 10 },
    // Near threshold (x50 ~0.14) the gain moves the decision itself, not only
    // the spike count: at 0.17 every gain still took off.
    loom: 0.15,
    gains: [0.25, 0.5, 1, 1.5, 2, 3, 4],
    estimateSeconds: (p) => 7 * p.trials * 1.0,
    *run(rig, p, nextSeed) {
      const rows = [];
      let done = 0;
      for (const g of this.gains) {
        rig.setPharmacology('inh', g);
        for (let i = 0; i < p.trials; i++) {
          const r = runTrial(rig, nextSeed(), { duration: 0.3, after: 0.3, stimulus: { loomL: this.loom, loomR: this.loom } });
          rows.push({ inhibitoryGain: g, trial: i + 1, ...r });
          yield ++done / (this.gains.length * p.trials);
        }
      }
      rig.setPharmacology('inh', 1);
      const pts = this.gains.map((x) => ({ x, ...proportion(rows.filter((r) => r.inhibitoryGain === x), 'tookOff') }));
      const lin = linearFit(rows.map((r) => r.inhibitoryGain), rows.map((r) => r.gfSpikes));
      const spikes = this.gains.map((x) => rows.filter((r) => r.inhibitoryGain === x).map((r) => r.gfSpikes));
      // Half-maximal inhibitory gain: a logistic fit of takeoff *suppression*
      // against log2(gain), the way a dose-response is read.
      const fit = fitLogistic(pts.map((q) => ({ x: Math.log2(q.x), k: q.n - q.k, n: q.n })));
      const ic50 = fit?.brackets ? 2 ** fit.x50 : null;
      return {
        rows,
        chart: { type: 'curve', xLabel: 'Inhibitory synaptic gain (× normal)', yLabel: 'Takeoff probability', x: this.gains,
          series: [{ label: 'Takeoff', y: pts.map((q) => q.p), lo: pts.map((q) => q.lo), hi: pts.map((q) => q.hi) }] },
        stats: [{ key: 'gfSpikesLowInhibition', value: mean(spikes[0]), format: 'fixed1' },
          { key: 'gfSpikesHighInhibition', value: mean(spikes[spikes.length - 1]), format: 'fixed1' },
          { key: 'ic50Gain', value: ic50, format: 'fixed2' },
          { key: 'slope', value: lin?.slope ?? null, format: 'fixed2' }, { key: 'trendP', value: lin?.p ?? null, format: 'p' }],
        verdict: ic50 !== null || (lin && lin.p < 0.05 && lin.slope < 0) ? { code: 'gates' } : { code: 'noTrend' },
      };
    },
  },
  {
    id: 'habituation', category: 'Learning', icon: 'repeat',
    title: 'Habituation to repeated looms',
    question: 'Does the escape response weaken when the same threat comes again and again?',
    measures: 'Giant-fiber response to 20 identical looming stimuli, 1 s apart, on one individual; fixed wiring versus the experimental learning rule.',
    literature: [{ ...LITERATURE.engel1996, finding: 'The giant-fiber escape pathway habituates to repeated stimulation in real flies (non-associative learning).' }],
    defaults: { trials: 20 },
    estimateSeconds: (p) => 2 * p.trials * 1.0 + 30,
    *run(rig, p, nextSeed) {
      const rows = [];
      let done = 0;
      for (const plastic of [false, true]) {
        rig.respawn({ seed: nextSeed(), plasticity: plastic });
        rig.resetTrial(nextSeed());
        rig.run(0.5);
        for (let i = 0; i < p.trials; i++) {
          // one continuous individual: no reset between repetitions
          const sim = rig.sim, gf0 = sim.gfSpikeCount;
          rig.override = { loomL: 0.25, loomR: 0.25 };
          rig.run(0.25);
          rig.override = null;
          if (rig.fly.state === 'flying') rig.fly.land();
          rig.run(0.75);
          rows.push({ learningRule: plastic ? 'on' : 'off', repetition: i + 1, gfSpikes: sim.gfSpikeCount - gf0, responded: sim.gfSpikeCount > gf0 });
          yield ++done / (2 * p.trials);
        }
      }
      rig.respawn({ seed: nextSeed(), plasticity: false });
      const series = ['off', 'on'].map((mode) => {
        const sub = rows.filter((r) => r.learningRule === mode);
        return { mode, sub, fit: linearFit(sub.map((r) => r.repetition), sub.map((r) => r.gfSpikes)) };
      });
      return {
        rows,
        chart: { type: 'curve', xLabel: 'Repetition', yLabel: 'Giant-fiber spikes', x: series[0].sub.map((r) => r.repetition),
          series: series.map((s) => ({ label: s.mode === 'on' ? 'Learning rule on' : 'Fixed wiring', y: s.sub.map((r) => r.gfSpikes) })) },
        stats: [{ key: 'slopeFixed', value: series[0].fit?.slope ?? null, format: 'fixed3' }, { key: 'slopeLearning', value: series[1].fit?.slope ?? null, format: 'fixed3' },
          { key: 'trendP', value: series[1].fit?.p ?? null, format: 'p' }],
        verdict: series[1].fit && series[1].fit.p < 0.05
          ? { code: series[1].fit.slope < 0 ? 'habituates' : 'sensitizes' } : { code: 'noHabituation' },
      };
    },
  },
  {
    id: 'associative', category: 'Learning', icon: 'link',
    title: 'Associative pairing',
    question: 'Pair a weak visual threat with a giant-fiber spike 16 times. Does the weak threat alone then drive the giant fiber harder — more than after the same stimuli in reverse order?',
    measures: 'Giant-fiber response to a weak loom before and after training, with the experimental timing rule; paired order versus reversed-order control, several individuals each.',
    literature: [{ ...LITERATURE.ueno2017, finding: 'Associative learning in flies happens in the mushroom body and is dopamine-gated — not the generic timing rule tested here.' },
      { ...LITERATURE.gibbons2022, finding: 'Associative learning is one of the eight sentience criteria (very high confidence for adult flies).' }],
    defaults: { trials: 4 },
    estimateSeconds: (p) => 2 * p.trials * 22,
    *run(rig, p, nextSeed) {
      const rows = [];
      let done = 0;
      const test = () => {
        let spikes = 0;
        for (let k = 0; k < 6; k++) {
          const gf0 = rig.sim.gfSpikeCount;
          rig.override = { loomL: 0.18, loomR: 0.18 };
          rig.run(0.2);
          rig.override = null;
          if (rig.fly.state === 'flying') rig.fly.land();
          rig.run(0.8);
          spikes += rig.sim.gfSpikeCount - gf0;
        }
        return spikes;
      };
      for (const order of ['pre-before-post', 'post-before-pre']) {
        for (let i = 0; i < p.trials; i++) {
          rig.respawn({ seed: nextSeed(), plasticity: true });
          rig.resetTrial(nextSeed());
          rig.run(0.5);
          const pre = test();
          rig.startLearning(order);
          rig.run(2.4);
          const post = test();
          rows.push({ group: order === 'pre-before-post' ? 'paired' : 'reversed', individual: i + 1, pre, post,
            index: (post - pre) / Math.max(1, post + pre), updates: rig.sim.plasticitySummary().updates });
          yield ++done / (2 * p.trials);
        }
      }
      rig.respawn({ seed: nextSeed(), plasticity: false });
      const paired = rows.filter((r) => r.group === 'paired').map((r) => r.index);
      const reversed = rows.filter((r) => r.group === 'reversed').map((r) => r.index);
      const mw = mannWhitney(paired, reversed);
      return {
        rows,
        chart: { type: 'bars', xLabel: 'Group', yLabel: 'Learning index (post − pre)/(post + pre)', x: ['paired', 'reversed'],
          series: [{ label: 'Learning index', y: [mean(paired), mean(reversed)], err: [sem(paired), sem(reversed)] }] },
        stats: [{ key: 'indexPaired', value: mean(paired), format: 'fixed2' }, { key: 'indexReversed', value: mean(reversed), format: 'fixed2' },
          { key: 'mannWhitneyP', value: mw.p, format: 'p' }],
        verdict: mw.p < 0.05 && mean(paired) > mean(reversed) ? { code: 'learns' } : { code: 'noLearning' },
      };
    },
  },
  {
    id: 'thermal-preference', category: 'Temperature', icon: 'thermo',
    title: 'Thermal preference in a gradient',
    question: 'Put her in an arena that runs from 18 °C to 32 °C. Does she end up where it is comfortable, as real flies do?',
    measures: 'Time-weighted temperature experienced over several simulated minutes per individual, in the gradient and in a flat 25 °C control arena.',
    literature: [{ ...LITERATURE.sayeed1996, finding: 'Flies in a thermal gradient gather near 24-25 °C.' },
      { ...LITERATURE.hamada2008, finding: 'Warmth avoidance depends on internal thermosensors (AC neurons) — which are not in this circuit.' }],
    defaults: { trials: 3, minutes: 2 },
    estimateSeconds: (p) => 2 * p.trials * p.minutes * 60,
    *run(rig, p, nextSeed) {
      const rows = [];
      let done = 0;
      const total = 2 * p.trials * p.minutes * 60;
      for (const condition of ['gradient', 'flat']) {
        for (let i = 0; i < p.trials; i++) {
          rig.respawn({ seed: nextSeed(), plasticity: false });
          rig.resetTrial(nextSeed());
          rig.env.tempC = 25;
          rig.env.tempGradientC = condition === 'gradient' ? 14 : 0;
          let tempSum = 0, comfortable = 0, n = 0;
          const steps = Math.round(p.minutes * 60);
          for (let s = 0; s < steps; s++) {
            rig.run(1, (r) => {
              const x = r.fly.pos.x;
              const tLocal = r.localTempC(x);
              // "Where she is" measured against the gradient's geometry, so the
              // flat arena gets the same spatial statistic as a control.
              const tGeom = 25 + ((x + r.bounds.width / 2) / r.bounds.width - 0.5) * 14;
              tempSum += condition === 'gradient' ? tLocal : tGeom;
              if (Math.abs(tGeom - 25) <= 2) comfortable++;
              n++;
            });
            yield (++done) / total;
          }
          rows.push({ condition, individual: i + 1, meanPositionTempC: tempSum / n, fractionComfortZone: comfortable / n });
        }
      }
      rig.env.tempGradientC = 0; rig.env.tempC = 24;
      const g = rows.filter((r) => r.condition === 'gradient').map((r) => r.fractionComfortZone);
      const f = rows.filter((r) => r.condition === 'flat').map((r) => r.fractionComfortZone);
      const mw = mannWhitney(g, f);
      return {
        rows,
        chart: { type: 'bars', xLabel: 'Arena', yLabel: 'Fraction of time within ±2 °C of 25 °C', x: ['gradient', 'flat control'],
          series: [{ label: 'Comfort zone', y: [mean(g), mean(f)], err: [sem(g), sem(f)] }] },
        stats: [{ key: 'comfortGradient', value: mean(g), format: 'pct' }, { key: 'comfortFlat', value: mean(f), format: 'pct' },
          { key: 'mannWhitneyP', value: mw.p, format: 'p' }],
        verdict: mw.p < 0.05 && mean(g) > mean(f) ? { code: 'prefers' } : { code: 'noPreference' },
      };
    },
  },
];

export function protocolById(id) { return PROTOCOLS.find((p) => p.id === id) || null; }

// Rows as CSV: every key that appears in any row, in first-seen order.
export function resultCSV(result) {
  const rows = result?.rows || [];
  const keys = [];
  for (const r of rows) for (const k of Object.keys(r)) if (!keys.includes(k)) keys.push(k);
  const fmt = (v) => {
    if (v === null || v === undefined) return '';
    if (typeof v === 'number') return Number.isFinite(v) ? String(Math.round(v * 10000) / 10000) : '';
    const s = String(v);
    return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
  };
  return `${keys.join(',')}\n${rows.map((r) => keys.map((k) => fmt(r[k])).join(',')).join('\n')}\n`;
}
