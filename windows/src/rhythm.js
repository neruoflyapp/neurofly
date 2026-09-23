// rhythm.js — how the nerve cord steps, as a model.
//
// The MaleCNS subgraph carries the measured premotor-to-motor wiring of all
// six legs but not the interneurons that make legs step rhythmically: driven
// by DNp09 alone its motor neurons fire tonically, the legs twitch, and the
// fly crept about a third of a body length per second. This module stands in
// for the missing stepping circuitry with leg-local rules in the tradition of
// Walknet (Cruse 1990; Dürr, Schmitz & Cruse 2004), the rule-based controller
// NeuroMechFly v2 also uses (Wang-Chen et al. 2024, Nat Methods 21:2353):
//
//   - each leg alternates stance and swing, and switches from stance to swing
//     at its posterior extreme position and from swing to stance at its
//     anterior one, both sensed proprioceptively (hip angle), with time
//     limits for either phase;
//   - a leg does not lift off while a neighbour (ipsilateral or its
//     contralateral partner) is in swing (Cruse's rule 1). From symmetric
//     starts this alone settles into a tripod gait;
//   - a planted leg's retraction speed is servoed to a target set by the
//     descending drive, with a slow per-leg integral term: proprioceptive
//     velocity feedback that also evens out legs the cord drives unequally;
//   - a swinging leg protracts only once its foot is off the ground, and each
//     leg slowly adapts how hard it lifts and presses (load feedback), since
//     the cord moves some feet far less readily than others;
//   - descending neurons set drive and direction: DNp09 forward, MDN
//     backward (stance and swing exchange their hip movements), DNa01/DNa02
//     left versus right shorten the strides on the inner side and, in sharp
//     turns, make the inner legs step backward (a persistent left/right
//     offset adapts away over seconds, as in signals.js).
//
// The output is not a motor command. It is a set of joint-axis demands (hip:
// protraction minus retraction, elevation: levation minus depression, knee:
// flexion minus extension) that locomotor.js turns into drive onto premotor
// interneurons of the measured cord (data/rhythm_decoder.json). Only the
// cord's own synapses carry it to the motor neurons, so cutting the synapses
// or silencing the motor neurons still stops the legs. Every threshold, gain
// and time limit here is a modelling choice, not a measurement.

import { clampf } from './util.js';

// The six motor channels of a leg and the MaleCNS motor annotations behind them.
export const CHANNEL_MUSCLES = Object.freeze({
  protract: ['coxa_promotor', 'coxa_anterior_rotator'],
  retract: ['coxa_remotor', 'coxa_posterior_rotator'],
  lift: ['trochanter_flexor'],
  depress: ['trochanter_extensor'],
  flex: ['tibia_flexor'],
  extend: ['tibia_extensor'],
});
export const CHANNELS = Object.freeze(Object.keys(CHANNEL_MUSCLES));
// A joint axis is its agonist channel minus its antagonist channel.
export const JOINT_AXES = Object.freeze(['hip', 'elevation', 'knee']);
export const AXIS_CHANNELS = Object.freeze({
  hip: ['protract', 'retract'], elevation: ['lift', 'depress'], knee: ['flex', 'extend'] });
export const LEG_NAMES = Object.freeze(['RF', 'LF', 'RM', 'LM', 'RH', 'LH']);

// Leg order RF, LF, RM, LM, RH, LH (as everywhere in NeuroFly).
const IS_LEFT = Object.freeze([false, true, false, true, false, true]);
// Rule 1 neighbours: the ipsilateral legs in front and behind, and the
// contralateral partner.
export const LEG_NEIGHBOURS = Object.freeze([[1, 2], [0, 3], [0, 3, 4], [1, 2, 5], [2, 5], [3, 4]]);

export const STEPPING_DEFAULTS = Object.freeze({
  stroke: 0.35,           // hip angle (rad) of the anterior and posterior extreme positions
  swingHip: 1,            // hip protraction demand during swing
  swingLift: 0.6,         // levation demand during swing
  swingKnee: 0,           // knee flexion demand during swing
  stanceHip: 1,           // hip retraction demand of a stance leg at full drive
  stancePress: 0.5,       // depression demand during stance
  stanceKnee: 0,          // knee extension demand during stance
  stanceSpeed: 3,         // target retraction speed of a planted leg at full drive (rad/s)
  speedGain: 0.1,         // proportional velocity feedback (demand per rad/s)
  speedIntegral: 1,       // per-leg integral velocity feedback (demand per rad)
  speedIntegralMax: 1,
  contactIntegral: 1,     // per-leg levation/depression adaptation (demand per s of
  contactIntegralMax: 1,  //   a foot still down in swing / still up in stance)
  maxStanceMs: 700, maxSwingMs: 180, minSwingMs: 40,
  liftOffMs: 60,          // swing protracts only once the foot is up, or after this long
  turnGain: 1.6,          // stride shortening on the inner side per unit of steering
  innerReverse: 0.6,      // how far inner legs may step backward in sharp turns (0 = never)
  driveTauMs: 80,         // how quickly stepping follows the descending drive
  adaptTauS: 8,           // slow adaptation of a persistent left/right DNa offset
  forwardHz: 10,          // DNp09 rate for full forward drive (as signals.js walkDrive)
  backwardHz: 8,          // MDN rate above which stepping reverses (as signals.js)
  steerPerHz: 0.04,       // steering per Hz of left-right DNa difference (as signals.js)
});

export class LegStepper {
  constructor(parameters = {}) {
    this.p = { ...STEPPING_DEFAULTS, ...parameters };
    this.demand = new Float64Array(6 * JOINT_AXES.length);
    this.swing = new Uint8Array(6);
    this.phaseMs = new Float64Array(6);
    this.speedTerm = new Float64Array(6);
    this.liftTerm = new Float64Array(6);
    this.pressTerm = new Float64Array(6);
    this.reset();
  }

  reset() {
    this.drive = 0; this.direction = 1; this.turn = 0; this.dnaOffset = 0;
    this.demand.fill(0); this.swing.fill(0); this.phaseMs.fill(0); this.speedTerm.fill(0);
    this.liftTerm.fill(0); this.pressTerm.fill(0);
    this.steps = 0;
  }

  get active() { return this.drive > 0.05; }

  // One millisecond. rates: descending population rates in Hz.
  update(rates) {
    const p = this.p;
    const forward = clampf(rates.forward / p.forwardHz, 0, 1);
    const backward = rates.backward > p.backwardHz ? clampf(0.4 + (rates.backward - p.backwardHz) / 20, 0, 1) : 0;
    this.direction = backward > forward ? -1 : 1;
    this.drive += (Math.max(forward, backward) - this.drive) * (1 - Math.exp(-1 / p.driveTauMs));
    const diff = rates.steerLeft - rates.steerRight;
    this.dnaOffset += (diff - this.dnaOffset) * (1 - Math.exp(-0.001 / p.adaptTauS));
    this.turn = clampf((diff - this.dnaOffset) * p.steerPerHz, -1, 1);
  }

  // One millisecond of stepping rules. feedback: the six legs' proprioceptive
  // state (legdynamics.js). Returns the joint-axis demands (leg-major,
  // JOINT_AXES order), or null when the legs are not driven to step.
  step(feedback) {
    const p = this.p, demand = this.demand;
    if (!this.active || !feedback || feedback.length !== 6) {
      demand.fill(0); this.swing.fill(0); this.phaseMs.fill(0);
      return null;
    }
    const d = this.drive, dir = this.direction;
    for (let leg = 0; leg < 6; leg++) {
      const f = feedback[leg];
      // turning left (positive): shorter strides on the left, and in sharp
      // turns (innerReverse > 0) inner legs stepping backward
      const side = clampf(IS_LEFT[leg] ? 1 - p.turnGain * this.turn : 1 + p.turnGain * this.turn, -p.innerReverse, 1.6);
      const legDir = side < 0 ? -dir : dir, amount = Math.abs(side);
      const stroke = p.stroke * Math.max(0.15, amount);
      const hip = f.hipAngle * legDir;       // + = anterior extreme in this leg's stepping direction
      this.phaseMs[leg]++;
      if (this.swing[leg]) {
        if ((hip >= stroke && this.phaseMs[leg] >= p.minSwingMs) || this.phaseMs[leg] >= p.maxSwingMs) {
          this.swing[leg] = 0; this.phaseMs[leg] = 0;
        }
      } else {
        let neighbourSwinging = false;
        for (const j of LEG_NEIGHBOURS[leg]) if (this.swing[j]) neighbourSwinging = true;
        if ((hip <= -stroke && !neighbourSwinging) || this.phaseMs[leg] >= p.maxStanceMs) {
          this.swing[leg] = 1; this.phaseMs[leg] = 0; this.steps++;
        }
      }
      const k = leg * 3, planted = f.contact && f.load > 0;
      // Slow per-leg adaptation of levation and depression: a foot that stays
      // down during swing is lifted harder, one that stays up during stance is
      // pressed harder, and both relax when the foot does what it should.
      const ci = p.contactIntegral * 0.001, cmax = p.contactIntegralMax;
      if (this.swing[leg]) this.liftTerm[leg] = clampf(this.liftTerm[leg] + ci * (planted ? 1 : -0.25), 0, cmax);
      else this.pressTerm[leg] = clampf(this.pressTerm[leg] + ci * (planted ? -0.25 : 1), 0, cmax);
      if (this.swing[leg]) {
        // A foot still on the ground would drag the body back: protract only
        // once it has lifted off (or the lift-off wait is over).
        const lifting = planted && this.phaseMs[leg] < p.liftOffMs;
        demand[k] = lifting ? 0 : p.swingHip * legDir; demand[k + 1] = p.swingLift + this.liftTerm[leg];
        demand[k + 2] = p.swingKnee;
      } else {
        const strength = Math.max(0.2, amount);
        let retract = p.stanceHip * d * strength;
        if (planted) {
          const error = p.stanceSpeed * d * strength + f.hipVelocity * legDir;
          this.speedTerm[leg] = clampf(this.speedTerm[leg] + p.speedIntegral * 0.001 * error,
            -p.speedIntegralMax, p.speedIntegralMax);
          retract += p.speedGain * error + this.speedTerm[leg];
        }
        demand[k] = -retract * legDir; demand[k + 1] = -(p.stancePress + this.pressTerm[leg]); demand[k + 2] = -p.stanceKnee;
      }
    }
    return demand;
  }
}
