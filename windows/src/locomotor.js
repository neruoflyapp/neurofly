// MaleCNS v1.0 nerve-cord circuit. Anatomy and synapse counts are measured;
// LIF parameters, rate transfer between specimens, sensory tuning and muscle
// activation are modeling assumptions.
import { LegDynamics, makeLegMotorCommand } from './legdynamics.js';
import { LegStepper, JOINT_AXES, LEG_NAMES } from './rhythm.js';

// Cord-model parameters a rhythm decoder was derived with; a decoder derived
// with other values is not applied (tools/derive-rhythm-decoder.mjs).
export const DECODER_MODEL_KEYS = Object.freeze(['synapticGain', 'baseline', 'adaptationKick']);

export function validateLocomotorCircuit(circuit) {
  if (!circuit || !Array.isArray(circuit.neurons) || !circuit.neurons.length
      || !Array.isArray(circuit.edges) || !circuit.edges.length) return false;
  const { neurons, edges } = circuit;
  if (new Set(neurons.map((neuron) => neuron.id)).size !== neurons.length) return false;
  for (const nr of neurons) {
    if (nr.leg != null && (!Number.isInteger(nr.leg) || nr.leg < 0 || nr.leg >= 6)) return false;
  }
  for (const e of edges) {
    if (!Array.isArray(e) || e.length !== 3 || !e.every(Number.isFinite)
        || !Number.isInteger(e[0]) || !Number.isInteger(e[1])
        || e[0] < 0 || e[1] < 0 || e[0] >= neurons.length || e[1] >= neurons.length) return false;
  }
  return Array.from({ length: 6 }, (_, leg) => leg).every((leg) =>
    ['tibia_flexor', 'tibia_extensor', 'trochanter_flexor', 'trochanter_extensor'].every((channel) =>
      neurons.some((nr) => nr.leg === leg && nr.motorChannel === channel)));
}

export class LocomotorSim {
  constructor(circuit, parameters = {}) {
    // rhythm: false switches the stepping rules off (rhythm.js; otherwise
    // their parameter overrides). rhythmGain scales the decoder's drive onto
    // premotor cells per unit of joint-axis demand; rhythmCap bounds it.
    this.parameters = { synapticGain: 2.4, baseline: 0.022, adaptationKick: 0.01,
      rhythm: {}, rhythmGain: 0.2, rhythmCap: 0.4, ...parameters };
    if (!validateLocomotorCircuit(circuit)) throw new Error('Invalid MaleCNS locomotor circuit');
    this.circuit = circuit;
    this.n = circuit.neurons.length;
    const n = this.n;
    for (const field of ['voltage', 'adaptation', 'rates', 'excitatory', 'inhibitory', 'nextExcitatory', 'nextInhibitory', 'drive', 'sensoryDrive', 'rhythmDrive']) {
      this[field] = new Float64Array(n);
    }
    this.refractory = new Int32Array(n);
    this.dnRates = new Map();          // `${type}:${side}` -> rate (Hz) from the brain
    this.commandGroups = new Map();
    this.motorGroups = Array.from({ length: 6 }, () => new Map());
    this.sensory = [];
    this.commands = Array.from({ length: 6 }, makeLegMotorCommand);
    this.totalSpikes = 0; this.motorSpikes = 0; this.sensorySpikes = 0; this.simMs = 0;
    this.feedback = [];
    this.silenced = new Set();
    this.synapsesEnabled = true;
    this.feedbackEnabled = true;
    const counts = new Int32Array(n), inputTotal = new Float64Array(n);
    for (const [pre, post, weight] of circuit.edges) {
      counts[pre]++; inputTotal[post] += Math.abs(weight);
    }
    this.rowStart = new Int32Array(n + 1);
    for (let i = 0; i < n; i++) this.rowStart[i + 1] = this.rowStart[i] + counts[i];
    this.targets = new Int32Array(circuit.edges.length);
    this.weights = new Float64Array(circuit.edges.length);
    const fill = Int32Array.from(this.rowStart);
    for (const [pre, post, weight] of circuit.edges) {
      const slot = fill[pre]++;
      this.targets[slot] = post;
      // Keep relative counts and transmitter signs; counts are not conductance.
      this.weights[slot] = this.parameters.synapticGain * weight / Math.max(60, inputTotal[post]);
    }
    function append(map, key, i) {
      if (!map.has(key)) map.set(key, []);
      map.get(key).push(i);
    }
    // Precomputed once so step()'s per-ms sensory loop (up to 1000x/s) does
    // integer array reads instead of chasing circuit.neurons[i] objects and
    // comparing sensoryKind strings every simulated millisecond — same real
    // per-neuron classification, just not re-derived from the raw data
    // every single step.
    this.sensoryLeg = new Int8Array(n).fill(-1);
    this.sensoryKindCode = new Uint8Array(n);   // 0=campaniform/contact, 1=hair_plate, 2=other
    circuit.neurons.forEach((nr, i) => {
      if (nr.role === 'descending') append(this.commandGroups, `${nr.type}:${nr.side}`, i);
      if (nr.role === 'sensory' && nr.leg != null) {
        this.sensory.push(i);
        this.sensoryLeg[i] = nr.leg;
        this.sensoryKindCode[i] = nr.sensoryKind === 'campaniform' || nr.sensoryKind === 'contact' ? 0
          : nr.sensoryKind === 'hair_plate' ? 1 : 2;
      }
      if (nr.role === 'motor' && nr.leg != null && nr.motorChannel) append(this.motorGroups[nr.leg], nr.motorChannel, i);
    });
    this.sensory = Int32Array.from(this.sensory);
    // 1 motor, 2 sensory: spike counters read this instead of comparing role
    // strings on every spike.
    this.roleCode = Uint8Array.from(circuit.neurons, (nr) => (nr.role === 'motor' ? 1 : nr.role === 'sensory' ? 2 : 0));
    this._indexCache = new Map();
    // Stepping rules (rhythm.js) reach the cord only through a decoder derived
    // for exactly this dataset and cord model (data/rhythm_decoder.json).
    this.rhythmDecoder = this.parameters.rhythm === false ? null : this._buildDecoder(circuit.rhythmDecoder);
    this.stepper = this.rhythmDecoder ? new LegStepper(this.parameters.rhythm) : null;
  }

  // Decoder slots: (leg * 3 + axis) * 2 + (direction > 0 ? 0 : 1), each the
  // premotor cells and their drive per unit of demand.
  _buildDecoder(decoder) {
    if (!decoder || decoder.schema !== 'neurofly-rhythm-decoder-1' || !Array.isArray(decoder.decoders)) return null;
    for (const key of DECODER_MODEL_KEYS) {
      if (decoder.model?.[key] !== this.parameters[key]) {
        console.warn(`rhythm decoder derived with ${key}=${decoder.model?.[key]}, cord runs ${this.parameters[key]}: stepping rules off`);
        return null;
      }
    }
    const index = new Map(this.circuit.neurons.map((nr, i) => [String(nr.id), i]));
    const slots = Array.from({ length: 6 * JOINT_AXES.length * 2 }, () => null);
    const touched = new Set();
    for (const d of decoder.decoders) {
      const leg = LEG_NAMES.indexOf(d.leg), axis = JOINT_AXES.indexOf(d.axis);
      if (leg < 0 || axis < 0 || (d.direction !== 1 && d.direction !== -1) || !Array.isArray(d.cells)) return null;
      const cells = [], weights = [];
      for (const [id, weight] of d.cells) {
        const i = index.get(String(id));
        if (i === undefined || this.circuit.neurons[i].role !== 'premotor' || !Number.isFinite(weight)) return null;
        cells.push(i); weights.push(weight); touched.add(i);
      }
      slots[(leg * JOINT_AXES.length + axis) * 2 + (d.direction > 0 ? 0 : 1)] = [Int32Array.from(cells), Float64Array.from(weights)];
    }
    if (slots.some((slot) => !slot)) return null;
    return { slots, touched: Int32Array.from(touched) };
  }

  _dn(type, side) { return this.dnRates.get(`${type}:${side}`) || 0; }

  // Back to rest, same anatomy: a fresh trial for the same nerve cord.
  reset() {
    for (const field of ['voltage', 'adaptation', 'rates', 'excitatory', 'inhibitory', 'nextExcitatory', 'nextInhibitory', 'drive', 'sensoryDrive', 'rhythmDrive']) {
      this[field].fill(0);
    }
    this.refractory.fill(0);
    this.dnRates.clear();
    this.stepper?.reset();
    this.commands = Array.from({ length: 6 }, makeLegMotorCommand);
    this.totalSpikes = 0; this.motorSpikes = 0; this.sensorySpikes = 0; this.simMs = 0;
  }

  setDescending(type, side, rate) { this.setDescendingKey(`${type}:${side}`, rate); }

  // The brain calls this every simulated millisecond with a fixed key per
  // descending group, so no key string is built per call.
  setDescendingKey(key, rate) {
    this.dnRates.set(key, rate);
    const cells = this.commandGroups.get(key);
    if (!cells) return;
    const value = Math.min(0.35, Math.max(0, rate) * 0.004);
    for (let q = 0; q < cells.length; q++) this.drive[cells[q]] = value;
  }

  indices(role, leg = null) {
    return this.circuit.neurons.map((nr, i) => i).filter((i) =>
      this.circuit.neurons[i].role === role && (leg === null || this.circuit.neurons[i].leg === leg));
  }

  meanRate(role, leg = null) {
    const key = `${role}:${leg}`;
    let ids = this._indexCache.get(key);
    if (!ids) { ids = Int32Array.from(this.indices(role, leg)); this._indexCache.set(key, ids); }
    let sum = 0;
    for (let k = 0; k < ids.length; k++) sum += this.rates[ids[k]];
    return sum / Math.max(1, ids.length);
  }

  // One millisecond of stepping: descending rates and leg proprioception in,
  // drive onto the decoder's premotor cells out.
  _rhythmStep() {
    const stepper = this.stepper, dn = (key) => this.dnRates.get(key) || 0;
    stepper.update({
      forward: (dn('DNp09:left') + dn('DNp09:right')) / 2,
      backward: (dn('MDN:left') + dn('MDN:right')) / 2,
      steerLeft: (dn('DNa01:left') + dn('DNa02:left')) / 2,
      steerRight: (dn('DNa01:right') + dn('DNa02:right')) / 2,
    });
    const drive = this.rhythmDrive, { slots, touched } = this.rhythmDecoder;
    for (let q = 0; q < touched.length; q++) drive[touched[q]] = 0;
    const demand = stepper.step(this.feedbackEnabled ? this.feedback : null);
    if (!demand) return;
    const gain = this.parameters.rhythmGain, cap = this.parameters.rhythmCap;
    for (let k = 0; k < demand.length; k++) {
      const value = demand[k];
      if (value === 0) continue;
      const [cells, weights] = slots[k * 2 + (value > 0 ? 0 : 1)];
      const scale = Math.abs(value) * gain;
      for (let q = 0; q < cells.length; q++) drive[cells[q]] += scale * weights[q];
    }
    for (let q = 0; q < touched.length; q++) {
      const i = touched[q];
      drive[i] = Math.max(-cap, Math.min(cap, drive[i]));
    }
  }

  step(ms) {
    if (!(ms > 0)) return;
    // Arrays and parameters read once per call; the arithmetic, and its order,
    // are unchanged.
    const n = this.n, baseline = this.parameters.baseline, adaptationKick = this.parameters.adaptationKick;
    const voltage = this.voltage, adaptation = this.adaptation, rates = this.rates, refractory = this.refractory;
    const excitatory = this.excitatory, inhibitory = this.inhibitory;
    const nextExcitatory = this.nextExcitatory, nextInhibitory = this.nextInhibitory;
    const drive = this.drive, sensoryDrive = this.sensoryDrive, rhythmDrive = this.rhythmDrive;
    const sensory = this.sensory, sensoryLeg = this.sensoryLeg, sensoryKindCode = this.sensoryKindCode;
    const roleCode = this.roleCode, rowStart = this.rowStart, targets = this.targets, weights = this.weights;
    const hipLimit = LegDynamics.hipLimit, restKnee = LegDynamics.restKnee;
    const silenced = this.silenced, synapsesEnabled = this.synapsesEnabled;
    for (let t = 0; t < ms; t++) {
      this.simMs++;
      if (this.stepper) this._rhythmStep();
      for (let q = 0; q < sensory.length; q++) sensoryDrive[sensory[q]] = 0;
      const feedback = this.feedback;
      if (this.feedbackEnabled && feedback.length === 6) {
        for (let q = 0; q < sensory.length; q++) {
          const i = sensory[q];
          const f = feedback[sensoryLeg[i]];
          const kind = sensoryKindCode[i];
          const value = kind === 0
            ? (f.contact ? Math.min(1, f.load * 6) : 0)
            : kind === 1
              ? Math.min(1, Math.abs(f.hipAngle) / hipLimit + Math.abs(f.elevationVelocity) / 20)
              : Math.min(1, Math.abs(f.kneeVelocity) / 20 + Math.abs(f.hipVelocity) / 16
              + Math.abs(f.kneeAngle - restKnee) * 0.35);
          sensoryDrive[i] = value * 0.10;
        }
      }
      for (let i = 0; i < n; i++) {
        excitatory[i] = excitatory[i] * 0.8187308 + nextExcitatory[i];
        inhibitory[i] = inhibitory[i] * 0.9048374 + nextInhibitory[i];
        nextExcitatory[i] = 0; nextInhibitory[i] = 0;
      }
      const anySilenced = silenced.size > 0;
      for (let i = 0; i < n; i++) {
        rates[i] *= 0.9048374;
        adaptation[i] *= 0.9950125;
        if (anySilenced && silenced.has(i)) { voltage[i] = 0; rates[i] = 0; continue; }
        if (refractory[i] > 0) { refractory[i]--; continue; }
        voltage[i] = Math.max(-1, voltage[i] * 0.9512294 + excitatory[i] + inhibitory[i]
          + baseline + drive[i] + sensoryDrive[i] + rhythmDrive[i] - adaptation[i]);
        if (voltage[i] >= 1) {
          voltage[i] = 0; refractory[i] = 2;
          adaptation[i] += adaptationKick;
          rates[i] += 95.16258;
          this.totalSpikes++;
          const rc = roleCode[i];
          if (rc === 1) this.motorSpikes++;
          else if (rc === 2) this.sensorySpikes++;
          if (synapsesEnabled) {
            for (let e = rowStart[i], end = rowStart[i + 1]; e < end; e++) {
              const we = weights[e];
              if (we >= 0) nextExcitatory[targets[e]] += we;
              else nextInhibitory[targets[e]] += we;
            }
          }
        }
      }
    }
    for (let leg = 0; leg < 6; leg++) {
      const activity = (channel) => {
        const ids = this.motorGroups[leg].get(channel) || [];
        const rate = ids.reduce((sum, i) => sum + this.rates[i], 0) / Math.max(1, ids.length);
        return rate / (rate + 50);
      };
      this.commands[leg] = { protract: Math.max(activity('coxa_promotor'), activity('coxa_anterior_rotator')),
        retract: Math.max(activity('coxa_remotor'), activity('coxa_posterior_rotator')),
        lift: activity('trochanter_flexor'), depress: activity('trochanter_extensor'),
        flex: activity('tibia_flexor'), extend: activity('tibia_extensor') };
    }
  }
}
