// causal.js — "why did she do that?"
//
// When the fly does something discrete — takes off, starts to groom, backs
// up, extends her proboscis — this module assembles the evidence for why, from
// what the simulation actually recorded, not from a story:
//   1. the trigger: which external input changed shortly before, and when;
//   2. the sensory populations it reached and their firing rates;
//   3. the command neurons that decide the behaviour, and the synaptic input
//      they received in the preceding window, split by source population
//      (LIFSim.attribution);
//   4. the behaviour and the rule that turned the command rate into it.
// Each step is labelled as measured (a spike count, a synapse sum) or modelled
// (a transduction gain, a body rule), so the explanation never claims more
// than the model contains.

// Which inputs the closed loop reports, with the sensory populations each one
// reaches. Order matters only for display.
export const INPUT_CHANNELS = Object.freeze([
  { key: 'loomL', label: 'looming, left eye', populations: ['loomL'] },
  { key: 'loomR', label: 'looming, right eye', populations: ['loomR'] },
  { key: 'puff', label: 'air puff', populations: ['joA', 'joW'] },
  { key: 'wind', label: 'wind', populations: ['joW'] },
  { key: 'sound', label: 'near-field sound', populations: ['joA'] },
  { key: 'hot', label: 'warming', populations: ['hot'] },
  { key: 'cold', label: 'cooling', populations: ['cold'] },
  { key: 'sugar', label: 'sugar on the labellum', populations: ['sugar'] },
  { key: 'bitter', label: 'bitter on the labellum', populations: ['bitter'] },
  { key: 'dust', label: 'dust on the antennae', populations: ['joF'] },
  { key: 'touch', label: 'touch', populations: ['joW'] },
  { key: 'stim', label: 'direct stimulation', populations: [] },
]);

const ONSET_THRESHOLD = 0.12;

// The attribution source categories (sim.js SOURCES) through which each input
// reaches the brain: its receptors and, for the appended pathways, their
// relays. An input counts as the trigger of a behaviour only when these
// categories delivered a measurable share of the excitatory input to the
// command neurons that decided it. Anything else that happened to be on at
// the time is reported as concurrent, never as the cause: an influence routed
// through unlabelled central neurons is not traced by the attribution.
export const CHANNEL_SOURCES = Object.freeze({
  loomL: ['loomL'], loomR: ['loomR'],
  puff: ['joAuditory', 'joWind'], wind: ['joWind'], sound: ['joAuditory'], touch: ['joWind'],
  hot: ['thermo', 'thermoRelay'], cold: ['thermo', 'thermoRelay'],
  sugar: ['sugar', 'tasteRelay'], bitter: ['bitter', 'tasteRelay'],
  dust: ['joF', 'groomRelay'],
});
export const TRACE_SHARE = 0.03;

// A short history of the inputs, one entry per 120 Hz tick, so the onset of
// the trigger can be dated after the fact.
export class InputHistory {
  constructor(capacity = 240) {
    this.capacity = capacity;
    this.times = new Float64Array(capacity);
    this.values = INPUT_CHANNELS.map(() => new Float32Array(capacity));
    this.sources = { loomL: new Array(capacity).fill(''), loomR: new Array(capacity).fill('') };
    this.head = 0;
    this.count = 0;
    this.lastStim = null;    // { t, label }
  }

  push(t, inputs, loomSources) {
    const i = this.head;
    this.times[i] = t;
    INPUT_CHANNELS.forEach((c, k) => { this.values[k][i] = inputs[c.key] ?? 0; });
    this.sources.loomL[i] = loomSources?.l ?? '';
    this.sources.loomR[i] = loomSources?.r ?? '';
    this.head = (this.head + 1) % this.capacity;
    if (this.count < this.capacity) this.count++;
  }

  noteStimulation(t, label) { this.lastStim = { t, label }; }

  // Newest-first iteration helper.
  _at(back) { return (this.head - 1 - back + this.capacity * 2) % this.capacity; }

  // The input that most recently rose above threshold within `windowS`
  // seconds (an onset), or, failing that, the strongest input that has been
  // on throughout (sustained: no onset to date, so no latency is claimed).
  // `accept`, when given, restricts the candidates to those channels.
  trigger(now, windowS = 0.8, accept = null) {
    let onset = null, sustained = null;
    const n = this.count;
    INPUT_CHANNELS.forEach((c, k) => {
      if (c.key === 'stim' || (accept && !accept.has(c.key))) return;
      const vals = this.values[k];
      let prev = 0, lastOnset = null, lastSource = '', peak = 0;
      for (let fwd = n - 1; fwd >= 0; fwd--) {          // oldest -> newest
        const i = this._at(fwd);
        const v = vals[i];
        if (now - this.times[i] <= windowS) peak = Math.max(peak, v);
        if (v > ONSET_THRESHOLD && prev <= ONSET_THRESHOLD && fwd < n - 1) {
          lastOnset = this.times[i];
          lastSource = (c.key === 'loomL' || c.key === 'loomR') ? this.sources[c.key][i] : '';
        }
        prev = v;
      }
      const latest = vals[this._at(0)];
      if (lastOnset !== null && now - lastOnset <= windowS) {
        if (!onset || lastOnset > onset.onsetT) {
          onset = { channel: c.key, label: c.label, onsetT: lastOnset, peak, source: lastSource, populations: c.populations };
        }
      } else if (latest > ONSET_THRESHOLD && (!sustained || latest > sustained.peak)) {
        const src = (c.key === 'loomL' || c.key === 'loomR') ? this.sources[c.key][this._at(0)] : '';
        sustained = { channel: c.key, label: c.label, onsetT: null, peak: latest, source: src, populations: c.populations };
      }
    });
    if (this.lastStim && now - this.lastStim.t <= windowS && (!onset || this.lastStim.t >= onset.onsetT)) {
      return { channel: 'stim', label: this.lastStim.label, onsetT: this.lastStim.t, peak: 1, source: 'experimenter', populations: [] };
    }
    return onset || sustained;
  }

  // Every input that was above threshold at some point within the window.
  active(now, windowS = 0.8) {
    const out = [];
    INPUT_CHANNELS.forEach((c, k) => {
      if (c.key === 'stim') return;
      const peak = this._peak(k, now, windowS);
      if (peak > ONSET_THRESHOLD) out.push({ channel: c.key, label: c.label, peak });
    });
    return out;
  }

  _peak(k, now, windowS) {
    let peak = 0;
    for (let back = 0; back < this.count; back++) {
      const i = this._at(back);
      if (now - this.times[i] > windowS) break;
      peak = Math.max(peak, this.values[k][i]);
    }
    return peak;
  }
}

// Which command population decides each behaviour, and the rule, stated.
const BEHAVIOURS = Object.freeze({
  takeoff: { group: 'gf', rule: 'A giant-fiber spike triggers the escape takeoff (the GF is the command for short-mode takeoffs, von Reyn et al. 2014).', ruleKind: 'model-rule' },
  spontaneousFlight: { group: null, rule: 'Voluntary takeoff: a body rule makes flight more likely the higher the whole-population firing rate. No single command neuron.', ruleKind: 'model-rule' },
  headGrooming: { group: 'dng12', rule: 'DNg12 above threshold starts anterior grooming: head sweeps alternating with leg rubbing (Guo, Zhang & Simpson 2022).', ruleKind: 'model-rule' },
  legGrooming: { group: 'groom', rule: 'DNg11 above threshold starts front-leg rubbing (Guo, Zhang & Simpson 2022).', ruleKind: 'model-rule' },
  backward: { group: 'mdn', rule: 'An MDN burst above 8 Hz starts backward walking (moonwalker neurons, Bidaye et al. 2014).', ruleKind: 'model-rule' },
  walk: { group: 'fwd', rule: 'DNp09 above threshold starts forward walking (Bidaye et al. 2020).', ruleKind: 'model-rule' },
  turnLeft: { group: 'dnaL', rule: 'More DNa01/02 activity on the left than on the right turns her to the left.', ruleKind: 'model-rule' },
  turnRight: { group: 'dnaR', rule: 'More DNa01/02 activity on the right than on the left turns her to the right.', ruleKind: 'model-rule' },
  proboscis: { group: 'proboscis', rule: 'Proboscis motor neurons above threshold extend the proboscis (proboscis extension response).', ruleKind: 'model-rule' },
  feeding: { group: 'proboscis', rule: 'Proboscis extended onto a food drop: she stays and feeds while the motor neurons keep it extended.', ruleKind: 'model-rule' },
  dart: { group: null, ruleChannels: ['loomL', 'loomR'], rule: 'High LC4/LPLC2 population rate without a giant-fiber spike: a body rule makes her dart away on foot.', ruleKind: 'model-rule' },
});

// Build one explanation. `sim` must be the LIFSim that produced the event.
export function explain(kind, { sim, now, history, rates, extra = {} }) {
  const spec = BEHAVIOURS[kind];
  if (!spec || !sim) return null;
  let command = null, inputs = [], inhibition = [];
  // Channels whose own receptors/relays measurably drove the decision. For a
  // behaviour decided by a body rule rather than a command population, only
  // the inputs that rule reads (e.g. looming for a dart) qualify.
  const traced = new Set(spec.ruleChannels ?? []);
  traced.add('stim');
  if (spec.group) {
    const a = sim.attribution(spec.group, 30);
    if (a) {
      const excTotal = Object.values(a.exc).reduce((s, v) => s + v, 0);
      for (const [channel, sources] of Object.entries(CHANNEL_SOURCES)) {
        const share = sources.reduce((s, k) => s + Math.max(0, a.exc[k] ?? 0), 0);
        if (excTotal > 0 && share / excTotal >= TRACE_SHARE) traced.add(channel);
      }
      const inhTotal = Object.values(a.inh).reduce((s, v) => s + v, 0);
      inputs = Object.entries(a.exc).filter(([, v]) => v > 0)
        .map(([source, v]) => ({ source, value: v, share: excTotal > 0 ? v / excTotal : 0 }))
        .sort((x, y) => y.value - x.value).slice(0, 5);
      inhibition = Object.entries(a.inh).filter(([, v]) => v < 0)
        .map(([source, v]) => ({ source, value: v, share: inhTotal < 0 ? v / inhTotal : 0 }))
        .sort((x, y) => x.value - y.value).slice(0, 3);
      command = { group: spec.group, spikes: a.spikes, cells: a.cells, windowMs: a.windowMs,
        excitation: excTotal, inhibition: inhTotal };
    }
  }
  const trigger = history ? history.trigger(now, 0.8, traced) : null;
  // Other inputs that were on: co-causes when their pathway is traced into
  // the decision too, otherwise merely concurrent.
  const others = history ? history.active(now, 0.8).filter((c) => c.channel !== trigger?.channel) : [];
  const contributing = others.filter((c) => traced.has(c.channel));
  const concurrent = others.filter((c) => !traced.has(c.channel));
  const sensory = {};
  for (const p of trigger?.populations ?? []) sensory[p] = rates[p] ?? 0;
  return {
    kind,
    t: now,
    neuralMs: sim.simMs,
    trigger: trigger ? { channel: trigger.channel, label: trigger.label, source: trigger.source,
      peak: trigger.peak, sustained: trigger.onsetT === null,
      latencyMs: trigger.onsetT === null ? null : Math.round((now - trigger.onsetT) * 1000) } : null,
    sensory,
    contributing,
    concurrent,
    command,
    commandRateHz: spec.group ? groupRate(spec.group, rates) : null,
    inputs,
    inhibition,
    rule: spec.rule,
    ruleKind: spec.ruleKind,
    ...extra,
  };
}

function groupRate(group, rates) {
  switch (group) {
    case 'gf': return rates.gf;
    case 'dnaL': return rates.dnaL;
    case 'dnaR': return rates.dnaR;
    case 'mdn': return rates.mdn;
    case 'fwd': return rates.fwd;
    case 'groom': return rates.groom;
    case 'escw': return rates.escw;
    case 'dng12': return rates.dng12;
    case 'proboscis': return rates.proboscis;
    default: return null;
  }
}
