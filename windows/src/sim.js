// sim.js — loads real FlyWire v783 data and runs a leaky-integrate-and-fire
// simulation of the escape/steering circuit (LC4/LPLC2 -> DNp01 giant fiber,
// DNa01/02 steering, MDN backward walking, DNp09 walking, DNg11 grooming), the
// real thermosensory, gustatory and antennal-grooming pathways appended to it,
// and the MaleCNS nerve cord it drives — all with real signed synapse counts.
//
// Beyond integrating the network, the simulator offers three instruments that
// a wet-lab neuroscientist would recognise, none of which writes anything a
// normal run depends on unless it is switched on:
//   - virtual genetics: silence any set of neurons (Kir2.1-like) or drive it
//     tonically (CsChrimson-like);
//   - in-silico pharmacology: scale every synapse of a transmitter class;
//   - input attribution: for the command neurons that decide behaviour, which
//     presynaptic populations delivered their input during the last 64 ms.
//
// Runs unchanged in Electron's renderer, in a Web Worker and in bare Node.

import { LocomotorSim } from './locomotor.js';
import { auditBrainCircuit } from './provenance.js';

// Fast deterministic PRNG for the neural model.  A fixed seed makes a neural
// trajectory reproducible when it receives the same inputs; it does not claim
// to reproduce the unseeded body/world or a live animal.  Keeping it local to
// LIFSim also prevents UI rendering or scene decoration from changing a trial.
export function makeNeuralRandom(seed) {
  let state = (Number(seed) >>> 0) || 0x6d2b79f5;
  return () => {
    state = (state + 0x6d2b79f5) >>> 0;
    let t = state;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function freshNeuralSeed() {
  return (Math.floor(Math.random() * 0x100000000) >>> 0) || 0x6d2b79f5;
}

// This is deliberately a bounded, phenomenological experiment, not a claim
// that a particular FlyWire contact has this exact plasticity rule. Classical
// timing rules differ by cell type, location and neuromodulatory state. The
// mode is opt-in so baseline connectome runs retain their fixed measured edge
// counts and remain comparable across versions.
function makePlasticityConfig(config = {}) {
  const bounded = (value, fallback, lo, hi) => {
    const n = Number(value);
    return Number.isFinite(n) ? Math.min(hi, Math.max(lo, n)) : fallback;
  };
  return {
    enabled: config?.enabled === true,
    mechanism: 'bounded-pair-stdp',
    tauMs: bounded(config?.tauMs, 20, 5, 100),
    learningRate: bounded(config?.learningRate, 0.002, 0.00001, 0.05),
    maxRelativeChange: bounded(config?.maxRelativeChange, 0.25, 0.01, 1),
    eligibleEdges: 0,
    updates: 0,
    potentiations: 0,
    depressions: 0,
    totalAbsRelativeChange: 0,
  };
}

function isPlasticTarget(role) {
  return role === 'gf' || role === 'dna01' || role === 'dna02'
    || role === 'mdn' || role === 'dnp09' || role === 'dng11' || role === 'escw';
}

// The per-synapse efficacy of the two appended sensorimotor pathways (taste,
// antennal grooming). The core escape subgraph runs at 0.0002 per synapse, a
// scale tuned together with its tonic baselines: its neurons rest close to
// threshold and act through massive convergence (hundreds of LC4/LPLC2 onto
// the giant fiber). The appended pathways are sparse relay chains whose
// neurons are silent at rest; at the core's scale a two- or three-synapse
// chain cannot carry a signal at all. They are therefore modelled at the
// efficacy of the published whole-brain FlyWire LIF (Shiu et al. 2024): a
// synaptic event there adds 0.275 mV of conductance-like drive that decays
// with tau_syn = 5 ms into a membrane with tau_m = 20 ms, which peaks at
//   0.275 mV * 5/15 * (exp(-t*/20) - exp(-t*/5)) = 0.0432 mV   (t* = 9.2 ms)
// against 7 mV from reset to threshold: 0.0062 of threshold per synapse.
// This model deposits a postsynaptic potential instantaneously, so the peak
// is matched, not the charge (matching the charge, 0.0098, made the grooming
// pathway fire maximally at 4 Hz of receptor input). Every edge into or out of
// the core, and between the two pathways, keeps the core's scale, so the
// tuned escape circuit is not perturbed. A modelling choice, recorded in the
// run manifest.
//
// Within a pathway, the full strength applies to forward edges: from the
// receptors (layer 0) through the relay layers to the motor/command targets
// (layer 3). The ETL cut each pathway out of a recurrent brain along its
// strongest forward paths; the lateral and backward connections among the
// kept cells are real, but the inhibitory neurons that balance them in the
// whole brain were not kept. At full strength those loops latched — after
// one dusting, DNg12 kept firing at ~170 Hz indefinitely. With no recurrence
// the grooming pathway could not reach DNg12 at all. They therefore run at
// PATHWAY_RECURRENT_FRACTION of the forward strength, measured as the value at
// which grooming answers dust in a graded way and falls silent once the dust
// is gone. Together with the per-connection cap below (VALIDATION.md, 4
// seeds): JO-F drive 1.1 / 1.2 / 1.3 / 1.4 / 1.6 -> DNg12 ~3 / 8 / 15 / 25 /
// 40 Hz, silent within 2.5 s of the drive ending; kicks of up to 2x
// threshold for 300 ms to every relay leave no persistent activity.
export const PATHWAY_RECURRENT_FRACTION = 0.6;

// Saturation of single connections inside an appended pathway: one
// presynaptic spike may move a postsynaptic neuron at most half-way to
// threshold. A point neuron adds every synapse of a pair at the soma, so a
// pair joined by very many contacts becomes an instant relay: the two CB0216
// cells of the grooming pathway share ~700 contacts each way, so each spike
// lifted the partner to 2.6x threshold and the pair fired back and forth at
// the 500 Hz refractory limit, holding DNg12 at ~28 Hz with no dust at all
// (entered from ordinary fluctuations in the live terrarium). Real contacts
// of that size are largely axo-axonic or saturate; the cap is a modelling
// choice that stands in for that. Measured with it (sim scan, 2 seeds): JO-F
// drive 1.2/1.4/1.8 -> DNg12 7/26/50 Hz and silent after; a 60 ms kick to all
// relays no longer latches; sugar 0.75 -> proboscis MNs ~57 Hz, bitter veto
// intact. Short-term depression of the recurrent edges also prevented the
// latch but cut the stimulus responses to a few Hz.
export const PATHWAY_EDGE_CAP = 0.5;

// Firing threshold of the giant fiber relative to every other neuron (1.0).
// At the generic threshold the GF fired about once a minute at rest with no
// stimulus at all (6 spikes in 300 s, 2 seeds), each time from a chance
// coincidence of spontaneous auditory Johnston's-organ activity arriving
// through the x6 gap-junction gain; one GF spike is a takeoff. The GF is the
// largest interneuron of the fly brain and is recruited by strong,
// coincident input. 1.15 is the smallest step of a scan (1.0 / 1.15 / 1.3 /
// 1.5) that removes the noise-driven spikes (0 in 300 s) while the looming
// threshold (0/8 takeoffs at 0.14, 8/8 at 0.16), the 5 ms latency to an
// abrupt loom and the wind-vs-sound specificity (0 vs 34 GF spikes) stay as
// they were. A modelling choice, not a measured value.
export const GF_THRESHOLD = 1.15;

export const SPARSE_PATHWAY_WEIGHT = 0.275 * (5 / 15) * (Math.exp(-(Math.log(4) * 20 / 3) / 20) - Math.exp(-(Math.log(4) * 20 / 3) / 5)) / 7;

// Population codes. Every neuron belongs to at most one counted population;
// rates are Hz per neuron, exponential moving averages over ~120 ms.
export const POP = Object.freeze({
  NONE: 0, LOOM_L: 1, LOOM_R: 2, DNA_L: 3, DNA_R: 4, MDN: 5, FWD: 6, GROOM: 7, ESCW: 8, GF: 9,
  JOA: 10, JOW: 11, SENS_OTHER: 12, ASCEND: 13,
  THERMO_HOT: 14, THERMO_COLD: 15, THERMO_RELAY_HOT: 16, THERMO_RELAY_COLD: 17,
  SUGAR: 18, BITTER: 19, TASTE_RELAY: 20, PROBOSCIS_MN: 21, INGESTION_MN: 22,
  JOF: 23, GROOM_RELAY: 24, DNG12: 25,
});
const NPOP = 26;

// Extension of origin of each neuron.
export const EXT = Object.freeze({ CORE: 0, THERMO: 1, TASTE: 2, GROOMING: 3 });

// Command and motor populations whose synaptic input is attributed.
export const WATCH_GROUPS = Object.freeze([
  { key: 'gf', pop: POP.GF, label: 'Giant fiber (DNp01)' },
  { key: 'dnaL', pop: POP.DNA_L, label: 'Steering DNa01/02 left' },
  { key: 'dnaR', pop: POP.DNA_R, label: 'Steering DNa01/02 right' },
  { key: 'mdn', pop: POP.MDN, label: 'Moonwalker MDN' },
  { key: 'fwd', pop: POP.FWD, label: 'Walking DNp09' },
  { key: 'groom', pop: POP.GROOM, label: 'Leg rubbing DNg11' },
  { key: 'escw', pop: POP.ESCW, label: 'Escape wing DNp02/04/11' },
  { key: 'dng12', pop: POP.DNG12, label: 'Head grooming DNg12' },
  { key: 'proboscis', pop: POP.PROBOSCIS_MN, label: 'Proboscis motor neurons' },
]);
const G = WATCH_GROUPS.length;

// Where synaptic input can come from. The last entry is direct stimulation by
// the experimenter, which is not a synapse and is kept apart for that reason.
export const SOURCES = Object.freeze([
  'central', 'loomL', 'loomR', 'joAuditory', 'joWind', 'joF', 'thermo', 'thermoRelay',
  'sugar', 'bitter', 'tasteRelay', 'ascending', 'command', 'groomRelay', 'visual', 'external',
]);
const C = SOURCES.length;
const SRC_EXTERNAL = C - 1;
const ATTRIBUTION_RING_MS = 64;

// The complete sensory/neural/mechanical feedback loop runs at 120 Hz,
// independent of display refresh. Each tick contains 8/8/9 neural ms and
// five 600 Hz mechanics substeps; rendering may display multiple ticks.
export class SimulationClock {
  static fixedDT = 1 / 120;
  constructor() { this.accumulator = 0; this.droppedSeconds = 0; }
  reset() { this.accumulator = 0; }
  consumeDroppedSeconds() {
    const value = this.droppedSeconds;
    this.droppedSeconds = 0;
    return value;
  }
  advance(elapsed, tick, maxSeconds = 0.1) {
    if (!Number.isFinite(elapsed) || elapsed <= 0) return 0;
    const accepted = Math.min(maxSeconds, elapsed);
    this.droppedSeconds += elapsed - accepted;
    this.accumulator += accepted;
    let ticks = 0;
    while (this.accumulator + 1e-10 >= SimulationClock.fixedDT) {
      this.accumulator -= SimulationClock.fixedDT;
      tick(SimulationClock.fixedDT);
      ticks++;
    }
    return ticks;
  }
}

// What the brain tells the body each frame.
export function makeSignals() {
  return {
    escape: false,     // giant fiber spiked -> takeoff NOW
    nervous: 0,        // looming-detector population rate, 0..1
    turnBias: 0,       // rad/s steering from DNa01/DNa02 left-right rate difference
    backward: false,   // MDN burst -> backward walking
    walkDrive: 0,      // DNp09 forward-walking command rate, ~0..1.5
    groomDrive: 0,     // DNg11 grooming command rate, ~0..1.5
    headGroomDrive: 0, // DNg12 anterior (head) grooming command rate, ~0..1.5
    proboscis: 0,      // proboscis motor neuron drive, 0..1
    wingDrive: 0,      // DNp02/04/11 escape-maneuver DN rate, ~0..1.3
    arousal: 0,        // whole-population activity, ~0..1
    tempo: 1,          // thermal "temperature" scaling of locomotion
    sleep: false,      // circadian + idle -> sleep-like state
    legCommands: null, // RF LF RM LM RH LH antagonist motor outputs; null = legacy bundle
  };
}

// Spike hand-off from the simulation to whatever draws it. A bounded ring of
// neuron indices: the drawing side can never make the simulation wait or
// grow without limit. Giant-fiber spikes are always included (see step()).
export class SpikeBus {
  constructor(capacity = 512) {
    this.buffer = new Int32Array(capacity);
    this.count = 0;
    this.dropped = 0;
  }
  pushOne(neuron) {
    if (this.count < this.buffer.length) this.buffer[this.count++] = neuron;
    else this.dropped++;
  }
  // Indices since the last drain, oldest first.
  drain() {
    const out = this.buffer.slice(0, this.count);
    this.count = 0;
    return out;
  }
}

export class LIFSim {
  constructor(circuit, spikeBus = null, locomotorCircuit = null, { seed = freshNeuralSeed(), plasticity = null,
    pathwayWeight = SPARSE_PATHWAY_WEIGHT, pathwayRecurrent = PATHWAY_RECURRENT_FRACTION,
    pathwayCap = PATHWAY_EDGE_CAP, gfThreshold = GF_THRESHOLD } = {}) {
    this.audit = auditBrainCircuit(circuit);
    if (!this.audit.valid) throw new Error(`Invalid FlyWire circuit: ${this.audit.errors.slice(0, 3).join('; ')}`);
    this.neuralSeed = (Number(seed) >>> 0) || 0x6d2b79f5;
    this.random = makeNeuralRandom(this.neuralSeed);
    this.locomotor = locomotorCircuit ? new LocomotorSim(locomotorCircuit) : null;
    this._ascendVncIdx = this.locomotor ? Int32Array.from(this.locomotor.indices('ascending')) : null;
    this.legFeedback = [];
    this.spikeBus = spikeBus;
    const neurons = circuit.neurons;
    const n = neurons.length;
    this.n = n;
    this.roles = neurons.map((x) => x.role);
    this.types = neurons.map((x) => x.type);
    this.cellTypes = neurons.map((x) => x.cellType || '');

    this.positions = new Float32Array(3 * n);
    for (let i = 0; i < n; i++) {
      const p = neurons[i].pos;
      if (p && p.length === 3) {
        this.positions[3 * i] = p[0];
        this.positions[3 * i + 1] = p[1];
        this.positions[3 * i + 2] = p[2];
      }
    }

    // LIF state
    this.v = new Float32Array(n);
    this.refr = new Float32Array(n);
    this.inhQueue = Array.from({ length: 5 }, () => new Float32Array(n));
    // Which cells a bucket actually owes inhibition to. Delivering used to
    // scan all n every millisecond; a step touches a few hundred at most.
    this.inhDirty = Array.from({ length: 5 }, () => new Int32Array(n));
    this.inhDirtyCount = new Int32Array(5);
    this.qHead = 0;

    // ---- extension of origin --------------------------------------------
    this.extCode = new Uint8Array(n);
    for (let i = 0; i < n; i++) {
      const e = neurons[i].extension;
      this.extCode[i] = e === 'thermo' ? EXT.THERMO : e === 'taste' ? EXT.TASTE : e === 'grooming' ? EXT.GROOMING : EXT.CORE;
    }

    // ---- populations -----------------------------------------------------
    this.loomLeft = []; this.loomRight = [];
    this.gf = [];
    this.dnaL = []; this.dnaR = [];
    this.mdn = []; this.fwd = []; this.groom = []; this.escw = [];
    this.ascend = []; this.sens = [];
    for (let i = 0; i < n; i++) {
      const nr = neurons[i];
      switch (nr.role) {
        case 'lc4': case 'lplc2':
          (nr.side === 'left' ? this.loomLeft : this.loomRight).push(i); break;
        case 'gf': this.gf.push(i); break;
        case 'dna01': case 'dna02':
          (nr.side === 'left' ? this.dnaL : this.dnaR).push(i); break;
        case 'mdn': this.mdn.push(i); break;
        case 'dnp09': this.fwd.push(i); break;
        case 'dng11': this.groom.push(i); break;
        case 'escw': this.escw.push(i); break;
        case 'other':
          // Neurons added by an extension join no core input population: they
          // were selected for their own sensory wiring and must get their
          // activity from it, not from the ascending or antennal drives.
          if (nr.extension) break;
          if (nr.type === 'ascending') this.ascend.push(i);
          // thermosensory cells are FlyWire "sensory" too, but they sense
          // temperature, not antennal movement: kept out of the JO union
          else if (nr.type === 'sensory' && !nr.thermoGroup) this.sens.push(i);
          break;
        default: break;
      }
    }
    // The "sensory" partners are Johnston's-organ neurons of the antenna, not
    // a general touch/pain channel. With the FlyWire annotation loaded they
    // split into vibration-sensitive JO-A/B (near-field sound) and
    // deflection-sensitive JO-C/D/E (wind, gravity) — Kamikouchi et al. 2009;
    // Yorozu et al. 2009. `sens` stays the union for stimuli that genuinely
    // excite both (a sudden air puff has a fast onset and a sustained
    // deflection).
    this.sensAuditory = []; this.sensWind = []; this.sensOther = [];
    for (const i of this.sens) {
      const g = neurons[i].sensoryGroup;
      if (g === 'jo_auditory') this.sensAuditory.push(i);
      else if (g === 'jo_wind_gravity') this.sensWind.push(i);
      else this.sensOther.push(i);
    }
    this.sensoryAnnotated = this.sensAuditory.length + this.sensWind.length > 0;
    // Real FlyWire thermosensory neurons (hot and cold cells) and the relays
    // on their strongest two-synapse paths, present when
    // data/thermo_extension.json is loaded. Relays are split by which cell
    // class feeds them more: hot and cold information travel on largely
    // separate neurons, and a mean over both would hide either response.
    this.thermoHot = []; this.thermoCold = [];
    this.thermoRelay = []; this.thermoRelayHot = []; this.thermoRelayCold = [];
    // Gustatory receptor neurons, the relays on their strongest paths and the
    // proboscis/ingestion motor neurons (data/sensory_extension.json).
    this.tasteSugar = []; this.tasteBitter = []; this.tasteRelay = [];
    this.proboscisMN = []; this.ingestionMN = [];
    // Antennal JO-F grooming mechanosensors, relays and DNg12.
    this.joF = []; this.groomRelay = []; this.dng12 = [];
    for (let i = 0; i < n; i++) {
      const nr = neurons[i];
      if (nr.thermoGroup === 'hot') this.thermoHot.push(i);
      else if (nr.thermoGroup === 'cold') this.thermoCold.push(i);
      else if (nr.extension === 'thermo' && nr.layer === 1) {
        this.thermoRelay.push(i);
        ((nr.fromHot || 0) >= (nr.fromCold || 0) ? this.thermoRelayHot : this.thermoRelayCold).push(i);
      } else if (nr.extension === 'taste') {
        if (nr.sensoryGroup === 'sugar') this.tasteSugar.push(i);
        else if (nr.sensoryGroup === 'bitter') this.tasteBitter.push(i);
        else if (nr.motorGroup === 'proboscis') this.proboscisMN.push(i);
        else if (nr.motorGroup === 'ingestion') this.ingestionMN.push(i);
        else this.tasteRelay.push(i);
      } else if (nr.extension === 'grooming') {
        if (nr.sensoryGroup === 'jof') this.joF.push(i);
        else if (nr.motorGroup === 'dng12') this.dng12.push(i);
        else this.groomRelay.push(i);
      }
    }
    // Seeds or targets of the sensory extension that were already part of the
    // circuit are tagged rather than duplicated. They are driven with their
    // modality (a tagged JO-F cell feels dust) but keep their core rate code.
    this.joFDrive = [...this.joF]; this.sugarDrive = [...this.tasteSugar]; this.bitterDrive = [...this.tasteBitter];
    for (let i = 0; i < n; i++) {
      const tag = neurons[i].extensionTag;
      if (!tag || neurons[i].extension) continue;
      if (tag.sensoryGroup === 'jof') this.joFDrive.push(i);
      else if (tag.sensoryGroup === 'sugar') this.sugarDrive.push(i);
      else if (tag.sensoryGroup === 'bitter') this.bitterDrive.push(i);
    }
    this.thermoCode = new Uint8Array(n);   // 1 hot cell, 2 cold cell, 3 hot-fed relay, 4 cold-fed relay
    for (const i of this.thermoHot) this.thermoCode[i] = 1;
    for (const i of this.thermoCold) this.thermoCode[i] = 2;
    for (const i of this.thermoRelayHot) this.thermoCode[i] = 3;
    for (const i of this.thermoRelayCold) this.thermoCode[i] = 4;

    this.ascendPhase = new Float32Array(this.ascend.length);
    for (let k = 0; k < this.ascend.length; k++) this.ascendPhase[k] = this.random() * 2 * Math.PI;

    // Heterogeneous baseline drive: interneurons get enough to crackle at a
    // few Hz; sensory and command neurons stay quiet unless driven.
    this.baseline = new Float32Array(n);
    for (let i = 0; i < n; i++) {
      const nr = neurons[i];
      switch (nr.role) {
        case 'other': {
          // The random draw happens for every partner so that appending an
          // extension never shifts the baselines of the neurons before it.
          const r = 0.010 + this.random() * 0.060;
          if (nr.thermoGroup) this.baseline[i] = 0.004;         // receptor cells report, not crackle
          else if (nr.extension === 'taste' || nr.extension === 'grooming') {
            // Sparse pathways follow the whole-brain LIF they are calibrated
            // against: silent at rest. Receptor neurons keep the thermosensors'
            // small drive, so a stimulus finds them in the same state.
            this.baseline[i] = nr.layer === 0 ? 0.004 : 0;
          } else this.baseline[i] = r;
          break;
        }
        case 'lc4': case 'lplc2': this.baseline[i] = 0.004; break;
        // command DNs get deterministic, side-symmetric baselines: their
        // asymmetries and bursts must come from network dynamics, not luck
        case 'dna01': case 'dna02': case 'mdn': case 'dng11': case 'escw':
          this.baseline[i] = 0.036; break;
        case 'dnp09': this.baseline[i] = 0.038; break;
        default: this.baseline[i] = 0.002; break;   // gf: quiet unless synaptically driven
      }
    }

    // Preserve exact cell type and hemisphere across the specimen interface.
    this.cordSourceGroups = [];
    this.cordSourceOf = new Int32Array(n).fill(-1);
    const groupByKey = new Map();
    neurons.forEach((nr, i) => {
      if (!['DNp09', 'DNa01', 'DNa02', 'MDN'].includes(nr.type)) return;
      const key = `${nr.type}:${nr.side}`;
      if (!groupByKey.has(key)) {
        groupByKey.set(key, this.cordSourceGroups.length);
        this.cordSourceGroups.push({ type: nr.type, side: nr.side, count: 0 });
      }
      const group = groupByKey.get(key);
      this.cordSourceGroups[group].count++;
      this.cordSourceOf[i] = group;
    });
    this.cordSourceRates = new Float32Array(this.cordSourceGroups.length);
    this.cordSourceGain = Float32Array.from(this.cordSourceGroups, (g) => 1000 / g.count);

    // ---- population codes, rate gains ------------------------------------
    this.popCode = new Uint8Array(n);
    const assign = (list, code) => { for (const i of list) this.popCode[i] = code; };
    assign(this.loomLeft, POP.LOOM_L); assign(this.loomRight, POP.LOOM_R);
    assign(this.dnaL, POP.DNA_L); assign(this.dnaR, POP.DNA_R);
    assign(this.mdn, POP.MDN); assign(this.fwd, POP.FWD); assign(this.groom, POP.GROOM);
    assign(this.escw, POP.ESCW); assign(this.gf, POP.GF);
    assign(this.sensAuditory, POP.JOA); assign(this.sensWind, POP.JOW); assign(this.sensOther, POP.SENS_OTHER);
    assign(this.ascend, POP.ASCEND);
    assign(this.thermoHot, POP.THERMO_HOT); assign(this.thermoCold, POP.THERMO_COLD);
    assign(this.thermoRelayHot, POP.THERMO_RELAY_HOT); assign(this.thermoRelayCold, POP.THERMO_RELAY_COLD);
    assign(this.tasteSugar, POP.SUGAR); assign(this.tasteBitter, POP.BITTER); assign(this.tasteRelay, POP.TASTE_RELAY);
    assign(this.proboscisMN, POP.PROBOSCIS_MN); assign(this.ingestionMN, POP.INGESTION_MN);
    assign(this.joF, POP.JOF); assign(this.groomRelay, POP.GROOM_RELAY); assign(this.dng12, POP.DNG12);
    this.popSize = new Int32Array(NPOP);
    for (let i = 0; i < n; i++) this.popSize[this.popCode[i]]++;
    this.popGain = Float64Array.from(this.popSize, (s) => 1000 / Math.max(1, s));
    this.popRate = new Float64Array(NPOP);
    this._popCount = new Int32Array(NPOP);
    // Afferent populations: receptors and input channels the world or the
    // body drives directly. Arousal is read from everything else (central
    // interneurons, relays, command and motor neurons), so it reflects the
    // brain's state and not the raw sensory and proprioceptive input.
    this.afferentPops = Int32Array.from([POP.LOOM_L, POP.LOOM_R, POP.JOA, POP.JOW, POP.SENS_OTHER, POP.ASCEND,
      POP.THERMO_HOT, POP.THERMO_COLD, POP.SUGAR, POP.BITTER, POP.JOF]);
    this.centralSize = n - Array.from(this.afferentPops).reduce((sum, c) => sum + this.popSize[c], 0);

    // Populations are read every simulated millisecond and never change
    // after construction. As Int32Array they iterate without the array
    // iterator machinery.
    for (const key of ['loomLeft', 'loomRight', 'dnaL', 'dnaR', 'mdn', 'fwd', 'groom', 'escw',
      'gf', 'sens', 'sensAuditory', 'sensWind', 'sensOther', 'ascend',
      'thermoHot', 'thermoCold', 'thermoRelay', 'thermoRelayHot', 'thermoRelayCold',
      'tasteSugar', 'tasteBitter', 'tasteRelay', 'proboscisMN', 'ingestionMN',
      'joF', 'groomRelay', 'dng12', 'joFDrive', 'sugarDrive', 'bitterDrive']) {
      this[key] = Int32Array.from(this[key]);
    }

    // ---- attribution: source category per neuron, watch group per neuron --
    this.srcCat = new Uint8Array(n);
    for (let i = 0; i < n; i++) this.srcCat[i] = this._sourceCategory(neurons[i], this.popCode[i]);
    this.watchOf = new Int8Array(n).fill(-1);
    WATCH_GROUPS.forEach((g, gi) => { for (let i = 0; i < n; i++) if (this.popCode[i] === g.pop) this.watchOf[i] = gi; });
    this.attribExc = new Float32Array(ATTRIBUTION_RING_MS * G * C);
    this.attribInh = new Float32Array(ATTRIBUTION_RING_MS * G * C);
    this.attribSpikes = new Uint16Array(ATTRIBUTION_RING_MS * G);

    // ---- CSR adjacency, weights pre-scaled --------------------------------
    const edges = circuit.edges;
    const counts = new Int32Array(n);
    for (const e of edges) counts[e[0]]++;
    this.rowStart = new Int32Array(n + 1);
    for (let i = 0; i < n; i++) this.rowStart[i + 1] = this.rowStart[i] + counts[i];
    this.colIdx = new Int32Array(edges.length);
    this.w = new Float32Array(edges.length);
    // Real per-edge FlyWire neurotransmitter class (etl.py's edge[3]) —
    // 1=dopamine 2=serotonin 3=octopamine — kept so genuinely modulatory
    // synaptic signalling can be reported, and targeted pharmacologically.
    this.ntCode = new Uint8Array(edges.length);
    // Transmitter class per slot for pharmacology: 0 excitatory (ACh), 1
    // inhibitory (GABA and glutamate share the inhibitory sign in etl.py and
    // cannot be told apart in the extracted data), 2 DA, 3 5-HT, 4 OA.
    this.slotClass = new Uint8Array(edges.length);
    this.slotWatch = new Uint8Array(edges.length);   // watch group + 1 of the target, 0 = none
    this.daEdgeCount = 0;
    this.modOtherEdgeCount = 0;
    this.sparseEdgeCount = 0;
    // LC4/LPLC2 -> GF and Johnston's organ (overwhelmingly auditory JO-A/B:
    // 1,467 of the 1,501 JO synapses onto GF) -> GF couple via
    // electrical (gap-junction) synapses, which chemical synapse counts
    // under-represent; boost that drive.
    const gapJunctionBoost = 6.0;
    // Within one appended pathway only: taste-to-grooming contacts are real,
    // but each pathway was calibrated as its own module, and a contact between
    // two modules is treated like every other cross-module edge.
    const sparseModule = (i) => (this.extCode[i] === EXT.TASTE || this.extCode[i] === EXT.GROOMING ? this.extCode[i] : 0);
    this.pathwayWeight = pathwayWeight;
    this.pathwayRecurrent = pathwayRecurrent;
    this.pathwayCap = pathwayCap;
    const layerOf = (i) => (Number.isFinite(neurons[i].layer) ? neurons[i].layer : 1);
    const fill = Int32Array.from(this.rowStart.subarray(0, n));
    for (const e of edges) {
      const pre = e[0] | 0, post = e[1] | 0;
      const mod = sparseModule(pre);
      // forward within a pathway: full strength; lateral/backward: the
      // recurrent fraction (see PATHWAY_RECURRENT_FRACTION)
      const sameModule = mod !== 0 && mod === sparseModule(post);
      const forward = sameModule && layerOf(post) > layerOf(pre);
      let weight = e[2] * (forward ? pathwayWeight : sameModule ? pathwayWeight * this.pathwayRecurrent : this.weightScale);
      if (sameModule && pathwayCap) weight = Math.max(-pathwayCap, Math.min(pathwayCap, weight));
      if (sameModule) this.sparseEdgeCount++;
      const preRole = this.roles[pre];
      // the boost is for the documented JO -> GF electrical coupling only;
      // thermosensory cells and appended pathways have no known gap junctions
      // onto the giant fiber
      const electrical = preRole === 'lc4' || preRole === 'lplc2'
        || (preRole === 'other' && this.types[pre] === 'sensory' && !neurons[pre].thermoGroup && !neurons[pre].extension);
      if (electrical && this.roles[post] === 'gf') weight *= gapJunctionBoost;
      const slot = fill[pre];
      this.colIdx[slot] = post;
      this.w[slot] = weight;
      const nt = e[3] | 0;
      this.ntCode[slot] = nt;
      this.slotClass[slot] = nt === 1 ? 2 : nt === 2 ? 3 : nt === 3 ? 4 : weight < 0 ? 1 : 0;
      this.slotWatch[slot] = this.watchOf[post] + 1;
      if (nt === 1) this.daEdgeCount++;
      else if (nt === 2 || nt === 3) this.modOtherEdgeCount++;
      fill[pre]++;
    }
    this.plasticity = makePlasticityConfig(plasticity);
    this._preparePlasticity();


    // ---- virtual genetics and pharmacology ---------------------------------
    this.silenced = new Uint8Array(n);
    this._silencedList = new Int32Array(0);
    this.optoDrives = [];                 // [{ idx: Int32Array, strength, label }]
    this.transmitterGain = [1, 1, 1, 1, 1];   // exc, inh, DA, 5-HT, OA

    // inputs (0..1), set each frame by the coordinator
    this.loomL = 0;
    this.loomR = 0;
    this.gaitDrive = 0;      // body walking intensity -> ascending neurons
    this.gaitPhase = 0;      // body gait phase 0..1 -> rhythmic proprioception
    this.airPuff = 0;        // sudden air puff: fast onset + deflection -> both JO populations
    this.windDrive = 0;      // steady wind: sustained antennal deflection -> JO-C/D/E
    this.soundDrive = 0;     // near-field sound / antennal vibration -> JO-A/B
    this.thermoHotDrive = 0;  // warming above the preferred range -> hot cells
    this.thermoColdDrive = 0; // cooling below the preferred range -> cold cells
    this.sugarTaste = 0;     // sugar on the labellum -> sugar/water GRNs
    this.bitterTaste = 0;    // bitter on the labellum -> bitter GRNs
    this.antennaDust = 0;    // particles on the antenna -> JO-F grooming mechanosensors
    this.activityScale = 1;  // circadian / sleep neuromodulation of baseline+noise
    this.sensoryGate = 1;    // sleep gates sensory input (raised arousal threshold)

    this.rateDA = 0;         // real synaptic deliveries/sec per dopamine-classified synapse (EMA)
    this.rateModOther = 0;   // same, for serotonin+octopamine-classified synapses combined
    this.ratePop = 0;        // whole-population Hz per neuron
    this.rateCentral = 0;    // Hz per neuron outside the afferent populations (arousal)
    this.gfLatch = false;
    this.gfSpikeCount = 0;          // giant-fiber spikes since construction (experiments read differences)
    this.lastGFSpikeMs = -1;
    this.simMs = 0;
    this.totalSpikes = 0;
    // Exact counters for the most recent call to step(). Telemetry only.
    this.lastStepSpikes = 0;
    this.lastStepDeliveries = 0;
    this.lastStepMilliseconds = 0;
    this.totalSynapticDeliveries = 0;

    this.burstUntil = 0;     // occasional "arousal" noise bursts
    this.burstNext = 12000;
    // Arousal is a state of the central brain. A burst raises spontaneous
    // activity six-fold in central neurons only: not in sensory receptor
    // neurons (their noise is not set by the animal's state), not in the
    // looming detectors or the giant fiber. When the burst also reached the
    // auditory Johnston's-organ neurons, their ×6 gap-junction coupling turned
    // every burst into a giant-fiber escape with no stimulus at all (~one
    // every 20-30 s), and it could tip the truncated grooming relays into a
    // self-sustained state.
    this.thresholds = new Float32Array(n).fill(1);
    for (let i = 0; i < n; i++) if (neurons[i].role === 'gf') this.thresholds[i] = gfThreshold;
    this._burstTargets = Int32Array.from(neurons.reduce((list, nr, i) => {
      const peripheral = nr.type === 'sensory' || nr.role === 'lc4' || nr.role === 'lplc2' || nr.role === 'gf';
      if (!peripheral) list.push(i);
      return list;
    }, []));

    // "optogenetic" pulses from the panel and brain-window clicks
    this.pendingStims = [];
    this.activeStims = [];
    // A scheduled sequence is for reproducible in-silico protocols. It uses
    // simulation milliseconds, never wall time, so a slow display cannot
    // change the requested inter-stimulus interval.
    this.scheduledStims = [];

    this._spiked = new Int32Array(n);
  }

  // ---- population rates (Hz per neuron) -------------------------------------
  _mix(...codes) {
    let num = 0, den = 0;
    for (const c of codes) { num += this.popRate[c] * this.popSize[c]; den += this.popSize[c]; }
    return den ? num / den : 0;
  }
  get rateLoom() { return this._mix(POP.LOOM_L, POP.LOOM_R); }
  get rateLoomL() { return this.popRate[POP.LOOM_L]; }
  get rateLoomR() { return this.popRate[POP.LOOM_R]; }
  get rateDNaL() { return this.popRate[POP.DNA_L]; }
  get rateDNaR() { return this.popRate[POP.DNA_R]; }
  get rateMDN() { return this.popRate[POP.MDN]; }
  get rateFwd() { return this.popRate[POP.FWD]; }
  get rateGroom() { return this.popRate[POP.GROOM]; }
  get rateEscW() { return this.popRate[POP.ESCW]; }
  get rateGF() { return this.popRate[POP.GF]; }
  get rateSens() { return this._mix(POP.JOA, POP.JOW, POP.SENS_OTHER); }
  get rateJOAuditory() { return this.popRate[POP.JOA]; }
  get rateJOWind() { return this.popRate[POP.JOW]; }
  get rateAscend() { return this.popRate[POP.ASCEND]; }
  get rateThermoHot() { return this.popRate[POP.THERMO_HOT]; }
  get rateThermoCold() { return this.popRate[POP.THERMO_COLD]; }
  get rateThermoRelay() { return this._mix(POP.THERMO_RELAY_HOT, POP.THERMO_RELAY_COLD); }
  get rateThermoRelayHot() { return this.popRate[POP.THERMO_RELAY_HOT]; }
  get rateThermoRelayCold() { return this.popRate[POP.THERMO_RELAY_COLD]; }
  get rateSugar() { return this.popRate[POP.SUGAR]; }
  get rateBitter() { return this.popRate[POP.BITTER]; }
  get rateTasteRelay() { return this.popRate[POP.TASTE_RELAY]; }
  get rateProboscis() { return this.popRate[POP.PROBOSCIS_MN]; }
  get rateIngestion() { return this.popRate[POP.INGESTION_MN]; }
  get rateJOF() { return this.popRate[POP.JOF]; }
  get rateGroomRelay() { return this.popRate[POP.GROOM_RELAY]; }
  get rateDNg12() { return this.popRate[POP.DNG12]; }
  get hasTaste() { return this.tasteSugar.length > 0 && this.proboscisMN.length > 0; }
  get hasGroomingPathway() { return this.joF.length > 0 && this.dng12.length > 0; }

  // Every named rate at once, for recording and display.
  rates() {
    return {
      pop: this.ratePop, central: this.rateCentral, gf: this.rateGF, loom: this.rateLoom, loomL: this.rateLoomL, loomR: this.rateLoomR,
      dnaL: this.rateDNaL, dnaR: this.rateDNaR, mdn: this.rateMDN, fwd: this.rateFwd, groom: this.rateGroom,
      escw: this.rateEscW, sens: this.rateSens, joA: this.rateJOAuditory, joW: this.rateJOWind,
      ascend: this.rateAscend, hot: this.rateThermoHot, cold: this.rateThermoCold,
      relayHot: this.rateThermoRelayHot, relayCold: this.rateThermoRelayCold,
      sugar: this.rateSugar, bitter: this.rateBitter, tasteRelay: this.rateTasteRelay,
      proboscis: this.rateProboscis, ingestion: this.rateIngestion,
      joF: this.rateJOF, groomRelay: this.rateGroomRelay, dng12: this.rateDNg12,
      da: this.rateDA, modOther: this.rateModOther,
    };
  }

  _sourceCategory(nr, code) {
    switch (code) {
      case POP.LOOM_L: return SOURCES.indexOf('loomL');
      case POP.LOOM_R: return SOURCES.indexOf('loomR');
      case POP.JOA: return SOURCES.indexOf('joAuditory');
      case POP.JOW: case POP.SENS_OTHER: return SOURCES.indexOf('joWind');
      case POP.JOF: return SOURCES.indexOf('joF');
      case POP.THERMO_HOT: case POP.THERMO_COLD: return SOURCES.indexOf('thermo');
      case POP.THERMO_RELAY_HOT: case POP.THERMO_RELAY_COLD: return SOURCES.indexOf('thermoRelay');
      case POP.SUGAR: return SOURCES.indexOf('sugar');
      case POP.BITTER: return SOURCES.indexOf('bitter');
      case POP.TASTE_RELAY: case POP.PROBOSCIS_MN: case POP.INGESTION_MN: return SOURCES.indexOf('tasteRelay');
      case POP.GROOM_RELAY: return SOURCES.indexOf('groomRelay');
      case POP.ASCEND: return SOURCES.indexOf('ascending');
      case POP.GF: case POP.DNA_L: case POP.DNA_R: case POP.MDN: case POP.FWD: case POP.GROOM:
      case POP.ESCW: case POP.DNG12: return SOURCES.indexOf('command');
      default:
        if (nr.extension === 'thermo') return SOURCES.indexOf('thermoRelay');
        if (nr.type === 'optic' || nr.type === 'visual_projection' || nr.type === 'visual_centrifugal') return SOURCES.indexOf('visual');
        return SOURCES.indexOf('central');
    }
  }

  // Build only the reverse index needed by the optional learning experiment.
  // It covers excitatory sensory-to-command contacts in this selected circuit,
  // rather than silently making every one of the extracted contacts mutable.
  _preparePlasticity() {
    const p = this.plasticity;
    if (!p.enabled) return;
    const incomingCounts = new Int32Array(this.n);
    this.plasticEligible = new Uint8Array(this.w.length);
    this.plasticBaseW = new Float32Array(this.w);
    this.plasticPreBySlot = new Int32Array(this.w.length);
    this.plasticPreBySlot.fill(-1);
    this.plasticChangedSlots = [];
    this.plasticChangeCounts = new Map();
    for (let pre = 0; pre < this.n; pre++) {
      // The experiment is defined on the escape circuit's own sensory
      // contacts (JO, LC4/LPLC2); loading an extension must not quietly
      // widen its anatomical scope.
      const role = this.roles[pre];
      const source = role === 'lc4' || role === 'lplc2' || (role === 'other' && this.types[pre] === 'sensory');
      if (!source || this.extCode[pre] !== EXT.CORE) continue;
      for (let slot = this.rowStart[pre]; slot < this.rowStart[pre + 1]; slot++) {
        const post = this.colIdx[slot];
        if (this.w[slot] <= 0 || !isPlasticTarget(this.roles[post])) continue;
        this.plasticEligible[slot] = 1;
        this.plasticPreBySlot[slot] = pre;
        incomingCounts[post]++;
        p.eligibleEdges++;
      }
    }
    this.plasticIncomingStart = new Int32Array(this.n + 1);
    for (let i = 0; i < this.n; i++) {
      this.plasticIncomingStart[i + 1] = this.plasticIncomingStart[i] + incomingCounts[i];
    }
    this.plasticIncomingSlots = new Int32Array(p.eligibleEdges);
    this.plasticIncomingPres = new Int32Array(p.eligibleEdges);
    const cursor = Int32Array.from(this.plasticIncomingStart.subarray(0, this.n));
    for (let pre = 0; pre < this.n; pre++) {
      for (let slot = this.rowStart[pre]; slot < this.rowStart[pre + 1]; slot++) {
        if (!this.plasticEligible[slot]) continue;
        const at = cursor[this.colIdx[slot]]++;
        this.plasticIncomingSlots[at] = slot;
        this.plasticIncomingPres[at] = pre;
      }
    }
    this.lastSpikeMs = new Int32Array(this.n);
    this.lastSpikeMs.fill(-1000000);
  }

  plasticitySummary() {
    const p = this.plasticity;
    const meanRelativeChange = p.updates > 0 ? p.totalAbsRelativeChange / p.updates : 0;
    return Object.freeze({
      enabled: p.enabled,
      mechanism: p.mechanism,
      tauMs: p.tauMs,
      learningRate: p.learningRate,
      maxRelativeChange: p.maxRelativeChange,
      eligibleEdges: p.eligibleEdges,
      updates: p.updates,
      potentiations: p.potentiations,
      depressions: p.depressions,
      meanAbsRelativeChange: meanRelativeChange,
    });
  }

  plasticityChanges() {
    if (!this.plasticity.enabled) return Object.freeze([]);
    return Object.freeze(this.plasticChangedSlots.map((slot) => Object.freeze({
      pre: this.plasticPreBySlot[slot],
      post: this.colIdx[slot],
      initialWeight: this.plasticBaseW[slot],
      currentWeight: this.w[slot],
      relativeChange: (this.w[slot] - this.plasticBaseW[slot]) / this.plasticBaseW[slot],
      updateCount: this.plasticChangeCounts.get(slot) || 0,
    })));
  }

  _adjustPlasticWeight(slot, signedMagnitude) {
    const p = this.plasticity;
    if (!p.enabled || !this.plasticEligible[slot] || signedMagnitude === 0) return;
    const base = this.plasticBaseW[slot];
    const min = base * (1 - p.maxRelativeChange);
    const max = base * (1 + p.maxRelativeChange);
    const previous = this.w[slot];
    // Compare the representable state, not a Float64 candidate that rounds
    // back to the same Float32 weight.
    const next = Math.fround(Math.min(max, Math.max(min, previous + base * p.learningRate * signedMagnitude)));
    if (next === previous) return;
    this.w[slot] = next;
    if (!this.plasticChangeCounts.has(slot)) this.plasticChangedSlots.push(slot);
    this.plasticChangeCounts.set(slot, (this.plasticChangeCounts.get(slot) || 0) + 1);
    p.updates++;
    if (next > previous) p.potentiations++;
    else p.depressions++;
    p.totalAbsRelativeChange += Math.abs((next - previous) / base);
  }

  _applyPlasticityForSpikes(spiked, nSpiked) {
    const p = this.plasticity;
    if (!p.enabled || nSpiked === 0 || p.eligibleEdges === 0) return;
    const latest = this.lastSpikeMs;
    const window = p.tauMs;
    for (let s = 0; s < nSpiked; s++) {
      const pre = spiked[s];
      for (let slot = this.rowStart[pre]; slot < this.rowStart[pre + 1]; slot++) {
        if (!this.plasticEligible[slot]) continue;
        const delta = this.simMs - latest[this.colIdx[slot]];
        if (delta > 0 && delta <= window) this._adjustPlasticWeight(slot, -Math.exp(-delta / window));
      }
    }
    for (let s = 0; s < nSpiked; s++) {
      const post = spiked[s];
      for (let at = this.plasticIncomingStart[post]; at < this.plasticIncomingStart[post + 1]; at++) {
        const delta = this.simMs - latest[this.plasticIncomingPres[at]];
        if (delta > 0 && delta <= window) this._adjustPlasticWeight(this.plasticIncomingSlots[at], Math.exp(-delta / window));
      }
    }
    for (let s = 0; s < nSpiked; s++) latest[spiked[s]] = this.simMs;
  }

  // GABA/Glut synapses deliver with a few ms delay; the LC->GF electrical
  // coupling is instantaneous. This latency window is what lets the giant
  // fiber fire before feedforward inhibition arrives.
  get inhDelayMs() { return 4; }
  get decay() { return 0.9512; }         // exp(-1/20): 20 ms membrane tau, 1 ms step
  get threshold() { return 1.0; }
  get refractoryMs() { return 2; }
  get weightScale() { return 0.0002; }
  get pNoise() { return 0.0022; }
  get noiseKick() { return 0.42; }
  get loomGain() { return 0.30; }
  get rateAlpha() { return 1 / 120; }

  pos(i) {
    return [this.positions[3 * i], this.positions[3 * i + 1], this.positions[3 * i + 2]];
  }

  // ---- virtual genetics -------------------------------------------------------
  // Silencing holds a neuron at rest and keeps it from spiking, whatever its
  // inputs — the in-silico equivalent of expressing the Kir2.1 potassium
  // channel. It changes no weight, so switching it off restores the network.
  setSilenced(indices, on = true) {
    for (const i of indices) if (Number.isInteger(i) && i >= 0 && i < this.n) this.silenced[i] = on ? 1 : 0;
    const list = [];
    for (let i = 0; i < this.n; i++) if (this.silenced[i]) list.push(i);
    this._silencedList = Int32Array.from(list);
    for (const i of this._silencedList) { this.v[i] = 0; }
    return this._silencedList.length;
  }
  clearSilenced() { this.silenced.fill(0); this._silencedList = new Int32Array(0); }
  get silencedCount() { return this._silencedList.length; }

  // Tonic depolarising drive, the analogue of continuous red light on a
  // CsChrimson line. Strength is per simulated millisecond, like stimulate().
  setOptoDrive(key, indices, strength) {
    this.optoDrives = this.optoDrives.filter((d) => d.key !== key);
    const idx = Int32Array.from([...indices].filter((i) => Number.isInteger(i) && i >= 0 && i < this.n));
    if (idx.length && Number.isFinite(strength) && strength !== 0) this.optoDrives.push({ key, idx, strength });
    return this.optoDrives.length;
  }
  clearOptoDrives() { this.optoDrives = []; }

  // ---- pharmacology --------------------------------------------------------------
  // Scales every synapse of one transmitter class, as a receptor agonist or
  // antagonist would at the level of synaptic efficacy. Relative to the
  // current weights, so learned changes survive a dose change.
  setTransmitterGain(cls, gain) {
    const c = typeof cls === 'number' ? cls : ['exc', 'inh', 'da', 'ser', 'oct'].indexOf(cls);
    if (c < 0 || c > 4 || !Number.isFinite(gain) || gain < 0 || gain > 10) return false;
    const old = this.transmitterGain[c];
    if (old === gain) return true;
    this._ensureDataWeights();
    if (old === 0) {
      // A full block cannot be rescaled relative to itself; rebuild the class
      // from the data weights instead.
      this._restoreClass(c, gain);
    } else {
      const f = gain / old;
      const w = this.w, sc = this.slotClass, base = this.plasticBaseW;
      for (let k = 0; k < w.length; k++) if (sc[k] === c) { w[k] *= f; if (base) base[k] *= f; }
    }
    this.transmitterGain[c] = gain;
    return true;
  }
  _restoreClass(c, gain) {
    if (!this._dataWeights) return;
    const w = this.w, sc = this.slotClass;
    for (let k = 0; k < w.length; k++) if (sc[k] === c) w[k] = this._dataWeights[k] * gain;
    if (this.plasticBaseW) for (let k = 0; k < w.length; k++) if (sc[k] === c) this.plasticBaseW[k] = this._dataWeights[k] * gain;
  }
  // Keep a copy of the unmodified weights before the first dose, so a full
  // block (gain 0) can be reversed.
  _ensureDataWeights() { if (!this._dataWeights) this._dataWeights = new Float32Array(this.w); }

  // ---- attribution ------------------------------------------------------------------
  // Synaptic input delivered to one watched population during the last
  // `windowMs` simulated milliseconds, per source category, plus how many of
  // its spikes fell in that window. Inhibition is counted when it is sent;
  // it lands 4 ms later.
  attribution(group, windowMs = 20) {
    const gi = typeof group === 'number' ? group : WATCH_GROUPS.findIndex((g) => g.key === group);
    if (gi < 0) return null;
    const span = Math.min(ATTRIBUTION_RING_MS, Math.max(1, windowMs | 0));
    const exc = new Float64Array(C), inh = new Float64Array(C);
    let spikes = 0;
    for (let back = 0; back < span; back++) {
      const ms = this.simMs - back;
      if (ms < 0) break;
      const r = ms % ATTRIBUTION_RING_MS;
      const base = (r * G + gi) * C;
      for (let c = 0; c < C; c++) { exc[c] += this.attribExc[base + c]; inh[c] += this.attribInh[base + c]; }
      spikes += this.attribSpikes[r * G + gi];
    }
    const size = Math.max(1, this.popSize[WATCH_GROUPS[gi].pop]);
    return { group: WATCH_GROUPS[gi].key, windowMs: span, spikes, cells: size,
      exc: Object.fromEntries(SOURCES.map((s, c) => [s, exc[c] / size])),
      inh: Object.fromEntries(SOURCES.map((s, c) => [s, inh[c] / size])) };
  }

  _validatedStimulus(indices, strength, durationMs) {
    if ((!Array.isArray(indices) && !ArrayBuffer.isView(indices))
      || !indices.length || !Number.isFinite(strength) || !Number.isFinite(Math.fround(strength))
      || !Number.isSafeInteger(durationMs) || durationMs <= 0) return null;
    // A caller must not be able to change a queued experiment by mutating its
    // selection later. Reject invalid indices atomically before touching state.
    const idx = Array.from(indices);
    if (!idx.every((i) => Number.isInteger(i) && i >= 0 && i < this.n)) return null;
    return { idx, strength, durationMs };
  }

  stimulate(indices, strength, durationMs) {
    if (this.pendingStims.length >= 8) return false;
    const stimulus = this._validatedStimulus(indices, strength, durationMs);
    if (!stimulus || !Number.isSafeInteger(this.simMs + 1 + durationMs)) return false;
    this.pendingStims.push(stimulus);
    return true;
  }

  scheduleStimulate(indices, strength, delayMs, durationMs) {
    if (!Number.isSafeInteger(delayMs) || delayMs < 0 || this.scheduledStims.length >= 512) return false;
    const stimulus = this._validatedStimulus(indices, strength, durationMs);
    if (!stimulus) return false;
    // State at simMs has already been integrated. Zero delay means the next
    // step, and a 1-ms pulse must still receive exactly one integration step.
    const startMs = this.simMs + Math.max(1, delayMs);
    if (!Number.isSafeInteger(startMs + durationMs)) return false;
    this.scheduledStims.push({ ...stimulus, startMs });
    this.scheduledStims.sort((a, b) => a.startMs - b.startMs);
    return true;
  }

  consumeGF() { const s = this.gfLatch; this.gfLatch = false; return s; }

  // A fresh trial for the same individual: every membrane, refractory timer,
  // queued inhibition, rate and pending stimulus back to rest, and the noise
  // generator reseeded. Baselines (the individual's heterogeneity), weights,
  // silencing, drugs and learned changes are kept — they are the animal and
  // the experimental condition, not the trial. The simulated clock keeps
  // running so scheduled protocols never see time go backwards.
  resetDynamics(seed = this.neuralSeed) {
    this.neuralSeed = (Number(seed) >>> 0) || 0x6d2b79f5;
    this.random = makeNeuralRandom(this.neuralSeed);
    this.v.fill(0); this.refr.fill(0);
    for (const q of this.inhQueue) q.fill(0);
    this.inhDirtyCount.fill(0);
    this.popRate.fill(0);
    this.rateDA = 0; this.rateModOther = 0; this.ratePop = 0; this.rateCentral = 0;
    this.cordSourceRates.fill(0);
    this.attribExc.fill(0); this.attribInh.fill(0); this.attribSpikes.fill(0);
    this.pendingStims = []; this.activeStims = []; this.scheduledStims = [];
    this.gfLatch = false;
    this.burstUntil = 0; this.burstNext = this.simMs + 12000;
    if (this.locomotor) this.locomotor.reset();
    this.loomL = 0; this.loomR = 0; this.airPuff = 0; this.windDrive = 0; this.soundDrive = 0;
    this.thermoHotDrive = 0; this.thermoColdDrive = 0; this.sugarTaste = 0; this.bitterTaste = 0; this.antennaDust = 0;
  }

  step(ms) {
    if (!(ms > 0)) return;
    if (this.locomotor) this.locomotor.feedback = this.legFeedback;
    for (const p of this.pendingStims) {
      p.untilMs = this.simMs + 1 + p.durationMs;
      this.activeStims.push(p);
    }
    this.pendingStims.length = 0;

    const n = this.n, v = this.v, refr = this.refr, base = this.baseline;
    const decay = this.decay, thresholds = this.thresholds, refractoryMs = this.refractoryMs;
    const noiseKick = this.noiseKick, loomGain = this.loomGain, pNoise = this.pNoise;
    const spiked = this._spiked;
    const random = this.random;
    const bus = this.spikeBus;
    let stepSpikes = 0;
    let stepDeliveries = 0;
    // Everything below is read inside the millisecond loop but set between
    // step() calls, so it is read once here instead of per neuron per ms.
    const rowStart = this.rowStart, colIdx = this.colIdx, w = this.w, ntCode = this.ntCode;
    const popCode = this.popCode, srcCat = this.srcCat, slotWatch = this.slotWatch, watchOf = this.watchOf;
    const aExc = this.attribExc, aInh = this.attribInh, aSpk = this.attribSpikes;
    const popRate = this.popRate, popGain = this.popGain, popCount = this._popCount;
    const sensoryGate = this.sensoryGate;
    const loomL = this.loomL, loomR = this.loomR, airPuff = this.airPuff;
    const windDrive = this.windDrive, soundDrive = this.soundDrive;
    const hotDrive = this.thermoHotDrive, coldDrive = this.thermoColdDrive;
    const sugar = this.sugarTaste, bitter = this.bitterTaste, dust = this.antennaDust;
    const loomLeft = this.loomLeft, loomRight = this.loomRight, ascend = this.ascend;
    const sens = this.sens;
    const windTarget = this.sensoryAnnotated ? this.sensWind : this.sens;
    const soundTarget = this.sensoryAnnotated ? this.sensAuditory : this.sens;
    const thermoHot = this.thermoHot, thermoCold = this.thermoCold;
    const sugarCells = this.sugarDrive, bitterCells = this.bitterDrive, joFCells = this.joFDrive;
    const stims = this.activeStims, optos = this.optoDrives;
    const silencedList = this._silencedList;
    const gPop = 1000 / Math.max(1, n);
    const gCentral = 1000 / Math.max(1, this.centralSize), afferentPops = this.afferentPops;
    const gDA = 1000 / Math.max(1, this.daEdgeCount), gMod = 1000 / Math.max(1, this.modOtherEdgeCount);
    const RING = ATTRIBUTION_RING_MS;

    for (let t = 0; t < ms; t++) {
      this.simMs++;
      const ring = this.simMs % RING;
      {
        const o = ring * G * C;
        aExc.fill(0, o, o + G * C); aInh.fill(0, o, o + G * C); aSpk.fill(0, ring * G, ring * G + G);
      }
      while (this.scheduledStims.length && this.scheduledStims[0].startMs <= this.simMs) {
        const s = this.scheduledStims.shift();
        this.activeStims.push({ ...s, untilMs: s.startMs + s.durationMs });
      }
      if (this.simMs >= this.burstNext) {
        this.burstUntil = this.simMs + 400;
        this.burstNext = this.simMs + 15000 + Math.floor(random() * 25001);
      }
      const activityScale = this.activityScale;
      const p = pNoise * activityScale;

      for (let i = 0; i < n; i++) {
        if (refr[i] > 0) { refr[i] -= 1; v[i] *= decay; continue; }
        v[i] = v[i] * decay + base[i] * activityScale;
      }
      // Spontaneous noise is one Bernoulli(p) trial per neuron. The gap to the
      // next kicked cell is geometrically distributed, so the identical
      // process needs a handful of draws instead of one per neuron.
      if (p > 0) {
        const logQ = Math.log(1 - p);
        for (let i = Math.floor(Math.log(1 - random()) / logQ); i < n;
          i += 1 + Math.floor(Math.log(1 - random()) / logQ)) {
          if (refr[i] <= 0) v[i] += noiseKick;
        }
        // arousal burst: five more trials' worth for central neurons (6x in all)
        if (this.simMs < this.burstUntil) {
          const targets = this._burstTargets, nt = targets.length;
          const logQb = Math.log(1 - Math.min(0.5, p * 5));
          for (let q = Math.floor(Math.log(1 - random()) / logQb); q < nt;
            q += 1 + Math.floor(Math.log(1 - random()) / logQb)) {
            const i = targets[q];
            if (refr[i] <= 0) v[i] += noiseKick;
          }
        }
      }
      if (loomL > 0.001) {
        const d = loomL * loomGain * sensoryGate;
        for (let k = 0; k < loomLeft.length; k++) v[loomLeft[k]] += d;
      }
      if (loomR > 0.001) {
        const d = loomR * loomGain * sensoryGate;
        for (let k = 0; k < loomRight.length; k++) v[loomRight[k]] += d;
      }
      // body -> brain: the VNC's real ascending neurons (MaleCNS) drive the
      // brain's ascend-labeled partners through the same population-rate
      // interface used for the descending direction. No literal
      // cross-specimen synapses; data/LOCOMOTOR_PROVENANCE.md documents the
      // modeled interface.
      if (this.locomotor) {
        const idx = this._ascendVncIdx, rates = this.locomotor.rates;
        let ascendSum = 0;
        for (let k = 0; k < idx.length; k++) ascendSum += rates[idx[k]];
        const ascendHz = ascendSum / Math.max(1, idx.length);
        const ascendGain = Math.min(1, ascendHz / 40) * 0.09;
        if (ascendGain > 0.0005) {
          const ph = this.gaitPhase * 2 * Math.PI;
          for (let k = 0; k < ascend.length; k++) {
            v[ascend[k]] += ascendGain * (0.5 + 0.5 * Math.sin(ph + this.ascendPhase[k]));
          }
        }
      } else if (this.gaitDrive > 0.001) {
        // Legacy fallback (no real locomotor loaded): a synthetic rhythm
        // tied to body gait phase.
        const ph = this.gaitPhase * 2 * Math.PI;
        for (let k = 0; k < ascend.length; k++) {
          v[ascend[k]] += this.gaitDrive * 0.09 * (0.5 + 0.5 * Math.sin(ph + this.ascendPhase[k]));
        }
      }
      // Each stimulus reaches only the receptor neurons that transduce it; the
      // same per-neuron gain throughout, so what differs between modalities is
      // WHICH neurons are reached and therefore what their wiring does.
      if (airPuff > 0.001) {
        const d = airPuff * 0.12 * sensoryGate;
        for (let k = 0; k < sens.length; k++) v[sens[k]] += d;
      }
      if (windDrive > 0.001) {
        const d = windDrive * 0.12 * sensoryGate;
        for (let k = 0; k < windTarget.length; k++) v[windTarget[k]] += d;
      }
      if (soundDrive > 0.001) {
        const d = soundDrive * 0.12 * sensoryGate;
        for (let k = 0; k < soundTarget.length; k++) v[soundTarget[k]] += d;
      }
      if (hotDrive > 0.001) {
        const d = hotDrive * 0.12 * sensoryGate;
        for (let k = 0; k < thermoHot.length; k++) v[thermoHot[k]] += d;
      }
      if (coldDrive > 0.001) {
        const d = coldDrive * 0.12 * sensoryGate;
        for (let k = 0; k < thermoCold.length; k++) v[thermoCold[k]] += d;
      }
      if (sugar > 0.001) {
        const d = sugar * 0.12 * sensoryGate;
        for (let k = 0; k < sugarCells.length; k++) v[sugarCells[k]] += d;
      }
      if (bitter > 0.001) {
        const d = bitter * 0.12 * sensoryGate;
        for (let k = 0; k < bitterCells.length; k++) v[bitterCells[k]] += d;
      }
      if (dust > 0.001) {
        const d = dust * 0.12 * sensoryGate;
        for (let k = 0; k < joFCells.length; k++) v[joFCells[k]] += d;
      }
      // experimenter stimulation: pulses and tonic (optogenetic) drive
      let activeCount = 0;
      for (let si = 0; si < stims.length; si++) {
        const st = stims[si];
        if (this.simMs >= st.untilMs) continue;
        stims[activeCount++] = st;
        const idx = st.idx, strength = st.strength;
        for (let k = 0; k < idx.length; k++) {
          const j = idx[k];
          v[j] += strength;
          const g = watchOf[j];
          if (g >= 0) aExc[(ring * G + g) * C + SRC_EXTERNAL] += strength;
        }
      }
      stims.length = activeCount;
      for (let oi = 0; oi < optos.length; oi++) {
        const idx = optos[oi].idx, strength = optos[oi].strength;
        for (let k = 0; k < idx.length; k++) {
          const j = idx[k];
          v[j] += strength;
          const g = watchOf[j];
          if (g >= 0) aExc[(ring * G + g) * C + SRC_EXTERNAL] += strength;
        }
      }

      // deliver delayed inhibition scheduled for this millisecond
      const q = this.inhQueue[this.qHead];
      const qd = this.inhDirty[this.qHead];
      const qn = this.inhDirtyCount[this.qHead];
      for (let k = 0; k < qn; k++) {
        const j = qd[k];
        const nv = v[j] + q[j];
        v[j] = nv < -2 ? -2 : nv;
        q[j] = 0;
      }
      this.inhDirtyCount[this.qHead] = 0;
      // silenced neurons are held at rest whatever arrived
      for (let k = 0; k < silencedList.length; k++) v[silencedList[k]] = 0;

      let nSpiked = 0;
      for (let i = 0; i < n; i++) {
        if (refr[i] <= 0 && v[i] >= thresholds[i]) {
          v[i] = 0; refr[i] = refractoryMs;
          spiked[nSpiked++] = i;
        }
      }
      this.totalSpikes += nSpiked;
      stepSpikes += nSpiked;
      this._applyPlasticityForSpikes(spiked, nSpiked);
      const inhIdx = (this.qHead + this.inhDelayMs) % this.inhQueue.length;
      const inh = this.inhQueue[inhIdx], inhD = this.inhDirty[inhIdx];
      let inhN = this.inhDirtyCount[inhIdx];
      let cDA = 0, cMod = 0;
      const ringBase = ring * G;
      for (let s = 0; s < nSpiked; s++) {
        const i = spiked[s];
        const start = rowStart[i], end = rowStart[i + 1];
        const cat = srcCat[i];
        for (let k = start; k < end; k++) {
          const j = colIdx[k], wk = w[k];
          if (wk >= 0) { const nv = v[j] + wk; v[j] = nv < -2 ? -2 : nv; }
          else { if (inh[j] === 0) inhD[inhN++] = j; inh[j] += wk; }
          const nt = ntCode[k];
          if (nt === 1) cDA++;
          else if (nt === 2 || nt === 3) cMod++;
          const wg = slotWatch[k];
          if (wg !== 0) {
            const o = (ringBase + wg - 1) * C + cat;
            if (wk >= 0) aExc[o] += wk; else aInh[o] += wk;
          }
        }
        stepDeliveries += end - start;
      }
      this.inhDirtyCount[inhIdx] = inhN;
      this.qHead = (this.qHead + 1) % this.inhQueue.length;

      // population rates (Hz per neuron, EMA)
      popCount.fill(0);
      for (let s = 0; s < nSpiked; s++) {
        const i = spiked[s];
        popCount[popCode[i]]++;
        const g = watchOf[i];
        if (g >= 0) aSpk[ringBase + g]++;
      }
      if (popCount[POP.GF] > 0) {
        this.gfLatch = true;
        this.gfSpikeCount += popCount[POP.GF];
        this.lastGFSpikeMs = this.simMs;
      }
      const a = this.rateAlpha;
      for (let c = 1; c < NPOP; c++) popRate[c] += (popCount[c] * popGain[c] - popRate[c]) * a;
      this.rateDA += (cDA * gDA - this.rateDA) * a;
      this.rateModOther += (cMod * gMod - this.rateModOther) * a;
      this.ratePop += (nSpiked * gPop - this.ratePop) * a;
      let afferentSpikes = 0;
      for (let q = 0; q < afferentPops.length; q++) afferentSpikes += popCount[afferentPops[q]];
      this.rateCentral += ((nSpiked - afferentSpikes) * gCentral - this.rateCentral) * a;

      if (this.locomotor) {
        const rates = this.cordSourceRates, gain = this.cordSourceGain;
        const groups = this.cordSourceGroups, cordOf = this.cordSourceOf;
        for (let i = 0; i < rates.length; i++) rates[i] *= 1 - a;
        for (let s = 0; s < nSpiked; s++) {
          const group = cordOf[spiked[s]];
          if (group >= 0) rates[group] += gain[group] * a;
        }
        for (let i = 0; i < groups.length; i++) {
          this.locomotor.setDescending(groups[i].type, groups[i].side, rates[i]);
        }
        this.locomotor.step(1);
      }

      if (bus) {
        // A drawing sample, not a record: every spike still counts in the
        // rates, recordings and dynamics. Six per millisecond is more than a
        // 60 Hz display resolves; giant-fiber spikes are always included —
        // they are the one event a viewer is watching for.
        const stride = Math.max(1, Math.floor(nSpiked / 6));
        for (let s = 0; s < nSpiked; s += stride) bus.pushOne(spiked[s]);
        if (popCount[POP.GF] > 0) {
          for (let s = 0; s < nSpiked; s++) if (popCode[spiked[s]] === POP.GF && s % stride !== 0) bus.pushOne(spiked[s]);
        }
      }
    }
    this.lastStepSpikes = stepSpikes;
    this.lastStepDeliveries = stepDeliveries;
    this.lastStepMilliseconds = ms;
    this.totalSynapticDeliveries += stepDeliveries;
  }
}
