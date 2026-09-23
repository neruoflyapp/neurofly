// signals.js — SignalBuilder: turns population rates into clamped behavior signals.
// Converts sim population rates into body commands. Shared by the app loop and
// the behavior test so both exercise the identical mapping.

import { clampf, lag } from './util.js';
import { makeSignals } from './sim.js';

export class SignalBuilder {
  constructor() { this.dnaBaseline = 0; }

  // A respawn is a new simulated individual.  Carrying the previous
  // individual's slowly adapted steering offset into it would be an
  // undocumented cross-trial state leak.
  reset() { this.dnaBaseline = 0; }

  make(sim, dt) {
    const diff = sim.rateDNaL - sim.rateDNaR;
    // Slow adaptation (tau ~8 s): the connectome's persistent left/right
    // wiring asymmetry is adapted out, so steady-state walking is straight
    // and only transient DNa asymmetries (visual, stimulation) steer.
    this.dnaBaseline += (diff - this.dnaBaseline) * lag(1 / 8, dt);
    const s = makeSignals();
    s.escape = sim.consumeGF();
    s.nervous = clampf(sim.rateLoom / 80, 0, 1);
    s.turnBias = clampf((diff - this.dnaBaseline) * 0.04, -1.0, 1.0);
    s.backward = sim.rateMDN > 8;
    s.walkDrive = clampf(sim.rateFwd / 10, 0, 1.3);
    s.groomDrive = sim.rateGroom / 8;
    // DNg12 and the proboscis motor neurons exist only with the sensory
    // extension loaded; without it these stay 0. Both populations are silent
    // at rest. DNg12 fires ~5-35 Hz across the dust range (head grooming
    // starts above ~10 Hz); the proboscis motor neurons 25-150 Hz on sugar.
    s.headGroomDrive = clampf((sim.rateDNg12 ?? 0) / 20, 0, 1.5);
    s.proboscis = clampf((sim.rateProboscis ?? 0) / 90, 0, 1);
    s.wingDrive = clampf(sim.rateEscW / 10, 0, 1.3);
    // Arousal is the central rate, not the whole brain's: once walking really
    // stepped, richer leg feedback raised the ascending input alone enough to
    // push the whole-brain rate over the takeoff gate 2.5× as often, while the
    // central neurons were unchanged.
    s.arousal = clampf((sim.rateCentral ?? sim.ratePop) / 20, 0, 1);
    s.legCommands = sim.locomotor ? sim.locomotor.commands : null;
    return s;
  }
}
