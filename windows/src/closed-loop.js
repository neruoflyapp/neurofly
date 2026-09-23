// closed-loop.js — the whole simulated animal and her world, without a screen.
//
// Brain (LIFSim with the FlyWire circuit and its extensions), nerve cord
// (MaleCNS locomotor), body (Fly: behaviour, legs, flight), the terrarium's
// objects, weather and food, and every instrument that reads them — advanced
// together on one fixed 120 Hz clock. Sensing, neural updates, motor output,
// body integration and feedback all happen inside tick(), so the loop is
// closed at 120 Hz regardless of who is watching or how fast they draw.
//
// Nothing here touches a DOM, a canvas or a GPU. The renderer (in the page)
// draws snapshots of this state and sends back only what it alone can
// produce: the motion energy of the fly's own rendered eye, the pointer, and
// OS-level ambient signals. That makes the complete loop runnable in a Web
// Worker at full speed, in a background experiment rig, and in the Node test
// suites alike.

import { LIFSim, SpikeBus, SimulationClock, WATCH_GROUPS } from './sim.js';
import { SignalBuilder } from './signals.js';
import { Fly } from './flymodel.js';
import { World } from './world.js';
import { clampf, lag, withRandom, seededRandom, bodySeed } from './util.js';
import { circadianActivity, localTemperature } from './environment.js';
import { Recorder, RECORDING_HZ, MAX_ROWS } from './recording.js';
import { SpatialMap } from './spatial.js';
import { SamplingClock } from './sampling-clock.js';
import { MODEL_VERSION } from './provenance.js';
import { LearningSession } from './learning-session.js';
import { ExperimentJournal } from './experiment-journal.js';
import { makeExperimentManifest } from './experiment-manifest.js';
import { plasticityChangesCSV } from './plasticity-export.js';
import { recordingPackageJSON } from './recording-package.js';
import { InputHistory, explain } from './causal.js';
import { extractPose, poseNodes } from './pose.js';

export const LEG_NAMES = ['RF', 'LF', 'RM', 'LM', 'RH', 'LH'];
const FLY_GRAB_RADIUS = 26;
const FLOOD_MAX_Z = 70;
const SCENT_RADIUS = 260;
const TRACE_HZ = 20;

// Named-circuit stimulation: the strengths/durations the behavior test suite
// uses, so a panel button and its equivalent test do the same thing.
export const STIM_GROUPS = Object.freeze({
  groom: ['groom', 0.25, 600],
  walk: ['fwd', 0.25, 1200],
  backward: ['mdn', 0.3, 600],
  escape: ['gf', 0.5, 40],
  wings: ['escw', 0.3, 600],
  tap: ['sens', 0.45, 150],
  steerLeft: ['dnaL', 0.3, 900],
  steerRight: ['dnaR', 0.3, 900],
  headGroom: ['dng12', 0.35, 600],
  proboscis: ['proboscisMN', 0.35, 800],
});

// Ectotherm thermal response: torpor below ~10 C, a comfortable working
// range 10-30 C, then heat speeds locomotion further up to ~38 C.
export function tempoFromCelsius(c) {
  if (c < 10) return clampf(0.12 + (c + 10) / 20 * 0.4, 0.1, 0.5);
  if (c <= 30) return 0.6 + (c - 10) / 20 * 0.7;
  if (c <= 38) return 1.3 + (c - 30) / 8 * 0.5;
  return 1.8;
}

function freshSeed(random = Math.random) {
  return (Math.floor(random() * 0x100000000) >>> 0) || 1;
}

// Modelled transduction of dust on the antennae (load 0..1) into drive on the
// JO-F grooming mechanosensors. JO-F cells respond to antennal deflection;
// the dust load -> drive curve is a modelling choice. Its range was measured
// against the pathway (sim.js, PATHWAY_RECURRENT_FRACTION): drive below ~0.95
// leaves DNg12 silent, 1.4 gives ~33 Hz, and nothing the world produces
// reaches the >= 1.5 range where the truncated relay loops can latch.
export function dustDrive(load) {
  return load > 0.05 ? 0.95 + 0.45 * Math.min(load, 1) : 0;
}

export class ClosedLoop {
  constructor({
    data, bounds = { width: 1200, height: 800 }, seed = freshSeed(), plasticity = false,
    layout = null, empty = false, spikeBus = true, hour = null, instruments = true,
  }) {
    if (!data?.circuit) throw new Error('ClosedLoop needs the loaded brain data');
    // Seeded body/world randomness (behavioural choices, environment timers):
    // with the neural seed, a run is reproducible from its seed alone.
    this._random = seededRandom(bodySeed(seed));
    this.data = data;
    this.bounds = { width: bounds.width, height: bounds.height };
    this.fixedHour = hour;                 // null: follow the real clock
    this.world = new World(this.bounds, { layout, empty, dressing: false });
    this.clock = new SimulationClock();
    this.signalBuilder = new SignalBuilder();
    this.instrumentsOn = instruments;
    this.sessionId = globalThis.crypto?.randomUUID?.() ?? `session-${Date.now()}`;
    this.neuralRun = 0;
    this.individual = 1;
    this.plasticityEnabled = plasticity === true;
    this.useSpikeBus = spikeBus;

    // ---- environment, in real units -------------------------------------
    this.env = {
      tempC: 24, tempGradientC: 0, windKmh: 0, windDirDeg: 90, gravity: 1, oxygenPct: 100,
      rain: false, fire: false, quake: false, smoke: false, dust: false, iceRain: false, flood: false,
    };
    this.floodLevel = 0;
    this.firePos = { x: 0, y: 0 };
    this.scentPos = { x: (this._rnd() - 0.5) * this.bounds.width * 0.64, y: (this._rnd() - 0.5) * this.bounds.height * 0.64 };
    this.food = [];                       // [{ id, kind: 'sugar'|'bitter', x, y, conc, volume }]
    this.foodSeq = 0;
    this.tasteOffer = { sugar: 0, bitter: 0, until: 0 };
    this.dustLoad = 0;                    // particles on the antennae, 0..1
    this.bursts = {};                     // channel -> { level, until } short panel stimuli
    this.override = null;                 // protocol stimulus (experiment rigs)

    // ---- OS ambient and renderer inputs --------------------------------------
    this.ambient = { typing: 0, sleepy: false, activity: 1 };
    this.vision = { L: 0, R: 0 };
    this.pointer = null;                  // ground point under the cursor, or null
    this._prevPointer = null;
    this._pointerVel = { x: 0, y: 0 };
    this._pointerVelRaw = { x: 0, y: 0 };
    this._pointerSampleDt = 0;
    this.loomOverride = 0;
    this.drag = null;

    // ---- body state -----------------------------------------------------------
    this.missingLeg = -1;
    this.wingDamage = 0;
    this.pinned = null;
    this.wetness = 0;
    this.health = 100;
    this.dead = false;
    this.squeezeT = 0;
    this.lifeSupport = 1; this.coldScale = 1; this.oxygenScale = 1;
    this.smellPct = 0;
    this.effectiveTempC = 24;
    this._prevThermoTempC = null; this._thermoRate = 0;
    this._timers = { rain: 0, quake: 0, objectTap: 0, dust: 0 };

    // ---- instruments -----------------------------------------------------------
    this.journal = new ExperimentJournal();
    this.recorder = new Recorder();
    this.recording = false;
    this.recordSampling = new SamplingClock(RECORDING_HZ);
    this.recordElapsed = 0;
    this.recordingStart = null;
    this.spatialMap = new SpatialMap(undefined, undefined, ['fear', 'loom', 'sens', 'temp', 'hot', 'cold', 'proboscis', 'dng12']);
    this.traceSampling = new SamplingClock(TRACE_HZ);
    this.pendingTrace = [];
    this.history = new InputHistory();
    this.events = [];
    this.pendingEvents = [];
    this._eventCooldown = {};
    this.learningSession = new LearningSession();
    this.learningProtocol = null;
    this.genetics = [];                   // [{ key, mode: 'silence'|'activate', population, label, count, strength }]
    this.pharmacology = { exc: 1, inh: 1, da: 1, ser: 1, oct: 1 };
    this.perf = { simulated: 0, compute: 0, spikes: 0, deliveries: 0, wall: 0, dropped: 0 };
    this.totalDroppedSimulationSeconds = 0;
    this.simTime = 0;
    this.paused = false;
    this.speed = 1;

    this.flies = [];
    this._buildSimulation(seed);
    this._addFly();
    this._prev = { state: this.fly.state, backward: 0, dart: 0, proboscisOut: false, heading: this.fly.heading, headingT: 0 };
    this.journalEvent('session-ready', { environment: this.environmentSnapshot(), body: this.bodySnapshot() });
  }

  _rnd() { return this._random(); }
  get fly() { return this.flies[0]; }

  // ---- construction ----------------------------------------------------------
  _buildSimulation(seed) {
    if (this.sim && this.learningSession.active) {
      this.learningSession.abort(this.sim, 'neural-restart');
      this.journalEvent('learning-aborted', { protocol: this.learningProtocol });
    }
    this.neuralSeed = (Number(seed) >>> 0) || 1;
    this._random = seededRandom(bodySeed(this.neuralSeed));
    this.learningProtocol = null;
    this.learningSession.reset();
    this.spikeBus = this.useSpikeBus ? new SpikeBus(1024) : null;
    this.sim = new LIFSim(this.data.circuit, this.spikeBus, this.data.locomotor, {
      seed: this.neuralSeed, plasticity: { enabled: this.plasticityEnabled },
    });
    this.signalBuilder.reset();
    this.msAccumulator = 0;
    this.neuralRun++;
    this.populationIndex = null;
    this._reapplyConditions();
    this.journalEvent('neural-start', { seed: this.neuralSeed, plasticityEnabled: this.plasticityEnabled });
  }

  // Genetic and pharmacological conditions belong to the experiment, not to
  // one neural run: a fresh network gets them again.
  _reapplyConditions() {
    for (const g of this.genetics) this._applyGenetic(g);
    for (const [cls, gain] of Object.entries(this.pharmacology)) if (gain !== 1) this.sim.setTransmitterGain(cls, gain);
  }

  _addFly() {
    const pos = this.world.findClearSpot(this.bounds, FLY_GRAB_RADIUS, 20);
    const fly = new Fly(pos);
    this.flies.push(fly);
    return fly;
  }

  // A fresh trial in the experiment arena: the same individual (weights,
  // baselines, genetic and pharmacological condition) with reseeded neural
  // noise, a rested body in the middle of the arena and no stimulus.
  resetTrial(seed) {
    this._random = seededRandom(bodySeed(seed));
    withRandom(this._random, () => this._resetTrial(seed));
  }

  _resetTrial(seed) {
    this.sim.resetDynamics(seed);
    this.signalBuilder.reset();
    this.msAccumulator = 0;
    const fly = new Fly({ x: 0, y: 0 });
    fly.heading = ((seed >>> 0) % 6283) / 1000;
    fly.state = 'idle';
    fly.speed = 0;
    this.flies[0] = fly;
    this.resetBody();
    this.health = 100; this.dead = false;
    this.loomOverride = 0; this.drag = null; this.pointer = null;
    this.vision = { L: 0, R: 0 };
    this.tasteOffer = { sugar: 0, bitter: 0, until: 0 };
    this.dustLoad = 0; this.food = [];
    this.override = null; this.bursts = {};
    this._prevThermoTempC = null; this._thermoRate = 0;
    this._prev = { state: fly.state, backward: 0, dart: 0, proboscisOut: false, heading: fly.heading, headingT: 0 };
    this.events = []; this.pendingEvents = []; this._eventCooldown = {};
  }

  // Advance the loop by `seconds` of simulated time, calling `observe` after
  // every 120 Hz tick.
  run(seconds, observe = null) {
    const ticks = Math.round(seconds * 120);
    for (let k = 0; k < ticks; k++) {
      this.tick(SimulationClock.fixedDT);
      if (observe) observe(this, k);
    }
  }

  // ---- journal and snapshots of conditions ------------------------------------
  journalEvent(kind, details = {}) {
    if (!this.instrumentsOn) return null;
    return this.journal.add(kind, { sessionId: this.sessionId, neuralRun: this.neuralRun,
      neuralMs: this.sim?.simMs ?? null, simulationSeconds: this.simTime, wallClock: new Date().toISOString() }, details);
  }

  hour() {
    if (this.fixedHour !== null) return this.fixedHour;
    const now = new Date();
    return now.getHours() + now.getMinutes() / 60;
  }

  environmentSnapshot() {
    return { ...this.env, floodLevel: this.floodLevel,
      food: this.food.map(({ kind, conc, volume }) => ({ kind, conc, volume })),
      arena: { width: this.bounds.width, height: this.bounds.height },
      wallClock: new Date().toISOString(), circadianActivity: circadianActivity(this.hour()) };
  }

  bodySnapshot() {
    const fly = this.fly;
    return { individual: this.individual, health: this.health, dead: this.dead, wetness: this.wetness,
      missingLeg: this.missingLeg, wingDamage: this.wingDamage, fixedInPlace: Boolean(this.pinned),
      state: fly?.state ?? null, x: fly?.pos.x ?? null, y: fly?.pos.y ?? null, heading: fly?.heading ?? null };
  }

  localTempC(x) {
    return localTemperature(this.env.tempC, this.env.tempGradientC, (x + this.bounds.width / 2) / this.bounds.width);
  }

  // A dead fly's circuit gets no further input from anywhere.
  stim(indices, strength, durationMs, label = null) {
    if (!this.sim || this.dead || !indices || !indices.length) return false;
    const ok = this.sim.stimulate(indices, strength, durationMs);
    if (ok && label) this.history.noteStimulation(this.simTime, label);
    return ok;
  }

  // ---- populations for virtual genetics -------------------------------------------
  populations() {
    if (this.populationIndex) return this.populationIndex;
    const s = this.sim;
    const byRole = (role) => Int32Array.from(s.roles.map((r, i) => (r === role ? i : -1)).filter((i) => i >= 0));
    const list = [
      ['lc4', 'LC4 looming detectors', byRole('lc4')],
      ['lplc2', 'LPLC2 looming detectors', byRole('lplc2')],
      ['loomL', 'LC4/LPLC2, left eye', s.loomLeft],
      ['loomR', 'LC4/LPLC2, right eye', s.loomRight],
      ['gf', 'Giant fiber DNp01', s.gf],
      ['dnaL', 'Steering DNa01/02 left', s.dnaL],
      ['dnaR', 'Steering DNa01/02 right', s.dnaR],
      ['mdn', 'Moonwalker MDN', s.mdn],
      ['fwd', 'Walking DNp09', s.fwd],
      ['groom', 'Leg-rubbing DNg11', s.groom],
      ['escw', 'Escape-wing DNp02/04/11', s.escw],
      ['joA', "Johnston's organ JO-A/B (sound)", s.sensAuditory],
      ['joW', "Johnston's organ JO-C/D/E (wind)", s.sensWind],
      ['ascend', 'Ascending partners (body feedback)', s.ascend],
      ['hot', 'Hot cells', s.thermoHot],
      ['cold', 'Cold cells', s.thermoCold],
      ['thermoRelay', 'Thermosensory relays', s.thermoRelay],
      ['sugar', 'Sugar/water taste neurons', s.tasteSugar],
      ['bitter', 'Bitter taste neurons', s.tasteBitter],
      ['tasteRelay', 'Taste pathway relays', s.tasteRelay],
      ['proboscisMN', 'Proboscis motor neurons', s.proboscisMN],
      ['ingestionMN', 'Ingestion motor neurons', s.ingestionMN],
      ['joF', 'JO-F grooming mechanosensors', s.joF],
      ['groomRelay', 'Grooming pathway relays', s.groomRelay],
      ['dng12', 'Head-grooming DNg12', s.dng12],
    ];
    this.populationIndex = new Map(list.filter(([, , idx]) => idx.length).map(([key, label, idx]) => [key, { key, label, indices: idx }]));
    return this.populationIndex;
  }

  resolvePopulation(spec) {
    if (!spec) return null;
    if (typeof spec === 'string') {
      if (spec.startsWith('type:')) {
        const type = spec.slice(5);
        const idx = [];
        this.sim.cellTypes.forEach((t, i) => { if (t === type) idx.push(i); });
        return idx.length ? { key: spec, label: `FlyWire type ${type}`, indices: Int32Array.from(idx) } : null;
      }
      return this.populations().get(spec) || null;
    }
    return null;
  }

  cellTypeSearch(query, limit = 40) {
    const q = String(query || '').trim().toLowerCase();
    if (!q) return [];
    const counts = new Map();
    this.sim.cellTypes.forEach((t) => { if (t && t.toLowerCase().includes(q)) counts.set(t, (counts.get(t) || 0) + 1); });
    return [...counts].sort((a, b) => (a[0].toLowerCase() === q ? -1 : b[0].toLowerCase() === q ? 1 : b[1] - a[1]))
      .slice(0, limit).map(([type, count]) => ({ key: `type:${type}`, label: type, count }));
  }

  _applyGenetic(g) {
    const pop = this.resolvePopulation(g.population);
    if (!pop) return false;
    if (g.mode === 'silence') this.sim.setSilenced(pop.indices, true);
    else this.sim.setOptoDrive(g.key, pop.indices, g.strength ?? 0.06);
    return true;
  }

  setGenetic({ population, mode, strength = 0.06, on = true }) {
    const pop = this.resolvePopulation(population);
    if (!pop) return { ok: false, reason: 'unknown population' };
    const key = `${mode}:${population}`;
    this.genetics = this.genetics.filter((g) => g.key !== key);
    if (mode === 'silence') {
      this.sim.clearSilenced();
      for (const g of this.genetics) if (g.mode === 'silence') this._applyGenetic(g);
      if (on) { const g = { key, mode, population, label: pop.label, count: pop.indices.length }; this.genetics.push(g); this._applyGenetic(g); }
    } else {
      this.sim.setOptoDrive(key, [], 0);
      if (on) { const g = { key, mode: 'activate', population, label: pop.label, count: pop.indices.length, strength }; this.genetics.push(g); this._applyGenetic(g); }
    }
    this.journalEvent('genetics', { population, mode, on, strength, count: pop.indices.length });
    return { ok: true, genetics: this.genetics };
  }

  clearGenetics() {
    this.genetics = [];
    this.sim.clearSilenced();
    this.sim.clearOptoDrives();
    this.journalEvent('genetics', { cleared: true });
  }

  setPharmacology(cls, gain) {
    if (!(cls in this.pharmacology)) return false;
    const g = clampf(Number(gain), 0, 3);
    if (!this.sim.setTransmitterGain(cls, g)) return false;
    this.pharmacology[cls] = g;
    this.journalEvent('pharmacology', { transmitterClass: cls, gain: g });
    return true;
  }

  // ---- commands from the user interface ----------------------------------------------
  handle(cmd) {
    return withRandom(this._random, () => this._handle(cmd));
  }

  _handle(cmd) {
    const a = cmd.args || {};
    switch (cmd.name) {
      case 'env.set': {
        if (!(a.key in this.env) || typeof this.env[a.key] !== 'number' || !Number.isFinite(a.value)) return false;
        this.env[a.key] = a.value;
        this.journalEvent('environment-control', { control: a.key, value: a.value, environment: this.environmentSnapshot() });
        return true;
      }
      case 'env.toggle': {
        if (!(a.key in this.env) || typeof this.env[a.key] !== 'boolean') return false;
        this.env[a.key] = typeof a.on === 'boolean' ? a.on : !this.env[a.key];
        if (a.key === 'fire' && this.env.fire) { this.firePos.x = this.bounds.width * 0.28; this.firePos.y = -this.bounds.height * 0.3; }
        if (a.key === 'iceRain' && this.env.iceRain) this.env.rain = true;
        this.journalEvent('control-request', { control: a.key, value: this.env[a.key], environment: this.environmentSnapshot() });
        return this.env[a.key];
      }
      case 'stim.group': return this.stimulateGroup(a.name);
      case 'stim.burst': {
        // a short controlled stimulus on one sensory channel, from the panel
        const channels = ['loomL', 'loomR', 'puff', 'wind', 'sound', 'sugar', 'bitter', 'dust'];
        if (!channels.includes(a.channel)) return false;
        this.bursts[a.channel] = { level: clampf(a.level ?? 0.6, 0, 1), until: this.simTime + clampf(a.durationS ?? 0.5, 0.02, 10) };
        this.history.noteStimulation(this.simTime, a.label ?? a.channel);
        this.journalEvent('control-request', { control: 'burst', channel: a.channel, level: this.bursts[a.channel].level });
        return true;
      }
      case 'stim.loom': this.loomOverride = clampf(a.strength ?? 0.6, 0, 1); this.history.noteStimulation(this.simTime, 'looming stimulus'); return true;
      case 'stim.cells': return this.stim(a.indices, a.strength ?? 0.25, a.durationMs ?? 400, a.label ?? 'brain-view stimulation');
      case 'taste.offer': {
        const d = clampf(a.durationS ?? 2, 0.1, 20);
        this.tasteOffer = { sugar: clampf(a.sugar ?? 0, 0, 1), bitter: clampf(a.bitter ?? 0, 0, 1), until: this.simTime + d };
        this.journalEvent('control-request', { control: 'taste-offer', ...this.tasteOffer });
        return true;
      }
      case 'food.add': {
        const kind = a.kind === 'bitter' ? 'bitter' : a.kind === 'mixed' ? 'mixed' : 'sugar';
        const fly = this.fly;
        const x = Number.isFinite(a.x) ? a.x : clampf(fly.pos.x + Math.cos(fly.heading) * 90, -this.bounds.width / 2 + 60, this.bounds.width / 2 - 60);
        const y = Number.isFinite(a.y) ? a.y : clampf(fly.pos.y + Math.sin(fly.heading) * 90, -this.bounds.height / 2 + 60, this.bounds.height / 2 - 60);
        const drop = { id: ++this.foodSeq, kind, x, y, conc: clampf(a.conc ?? 0.8, 0.05, 1), bitter: kind === 'mixed' ? clampf(a.bitter ?? 0.5, 0, 1) : 0, volume: 1 };
        this.food.push(drop);
        this.journalEvent('control-request', { control: 'food-add', kind, conc: drop.conc, bitter: drop.bitter });
        return drop.id;
      }
      case 'food.clear': this.food = []; return true;
      case 'antenna.dust': this.dustLoad = clampf(a.amount ?? 1, 0, 1); this.history.noteStimulation(this.simTime, 'dust on the antennae'); this.journalEvent('control-request', { control: 'antenna-dust', amount: this.dustLoad }); return true;
      case 'body.removeLeg': return this.removeNextLeg();
      case 'body.wing': return this.cycleWingDamage();
      case 'body.freeze': return this.toggleFreeze();
      case 'body.squeeze': return this.squeeze();
      case 'body.reset': this.resetBody(); return true;
      case 'respawn': this.respawn({ seed: a.seed, plasticity: a.plasticity }); return this.neuralSeed;
      case 'genetics.set': return this.setGenetic(a);
      case 'genetics.clear': this.clearGenetics(); return true;
      case 'pharma.set': return this.setPharmacology(a.cls, a.gain);
      case 'pharma.reset': for (const k of Object.keys(this.pharmacology)) this.setPharmacology(k, 1); return true;
      case 'learning.start': return this.startLearning(a.order);
      case 'record.start': return this.startRecording();
      case 'map.reset': this.spatialMap.reset(); return true;
      case 'pause': this.paused = !!a.paused; this.journalEvent(this.paused ? 'pause' : 'resume'); return this.paused;
      case 'speed': this.speed = clampf(Number(a.factor) || 1, 0.1, 8); this.journalEvent('control-request', { control: 'speed', value: this.speed }); return this.speed;
      case 'addFly': this._addFly(); return this.flies.length;
      case 'removeFly': if (this.flies.length > 1) this.flies.pop(); return this.flies.length;
      case 'scareAll':
        this.loomOverride = 0.6;
        for (const f of this.flies.slice(1)) if (f.state !== 'flying') f.startFlight(this.bounds);
        return true;
      case 'resize': this.resize(a); return true;
      case 'tap': this.injectTap(a); return true;
      case 'drag.start': return this.dragStart(a);
      case 'drag.move': this.dragMove(a); return true;
      case 'drag.end': this.dragEnd(a); return true;
      case 'point.move': {
        if (a.kind === 'fire') { this.firePos.x = a.x; this.firePos.y = a.y; }
        else if (a.kind === 'scent') { this.scentPos.x = a.x; this.scentPos.y = a.y; }
        else if (a.kind === 'food') { const d = this.food.find((f) => f.id === a.id); if (d) { d.x = a.x; d.y = a.y; } }
        return true;
      }
      default: return undefined;
    }
  }

  stimulateGroup(name) {
    const spec = STIM_GROUPS[name];
    if (!spec || !this.sim) return false;
    const [field, strength, durationMs] = spec;
    const idx = this.sim[field];
    if (!idx || !idx.length) return false;
    return this.stim(idx, strength, durationMs, `stimulation: ${name}`);
  }

  startLearning(order) {
    if (!this.sim || this.dead) return { ok: false, reason: 'no simulation' };
    const result = this.learningSession.start(this.sim, order);
    if (!result.ok) return result;
    this.learningProtocol = result.protocol;
    this.journalEvent('learning-plan', { protocol: this.learningProtocol });
    return result;
  }

  // ---- body interventions ------------------------------------------------------------------
  removeNextLeg() {
    const fly = this.fly;
    if (!fly || this.dead || this.missingLeg >= 5) return this.missingLeg;
    this.missingLeg += 1;
    fly.model.legs[this.missingLeg].root.visible = false;
    // No brain-side "pain" pulse: this subgraph contains no nociceptors. The
    // loss is real where the model can make it real: the locomotor circuit
    // stops receiving that leg's contact/load feedback (see tick()).
    return this.missingLeg;
  }

  cycleWingDamage() {
    const fly = this.fly;
    if (!fly || this.dead) return this.wingDamage;
    this.wingDamage = (this.wingDamage + 1) % 3;
    fly.model.foldedWings.children[0].visible = this.wingDamage < 1;
    fly.model.foldedWings.children[1].visible = this.wingDamage < 2;
    return this.wingDamage;
  }

  toggleFreeze() {
    const fly = this.fly;
    if (!fly || this.dead) return false;
    this.pinned = this.pinned ? null : { x: fly.pos.x, y: fly.pos.y };
    return Boolean(this.pinned);
  }

  // Squeezing: there is no nociceptor pathway in this subgraph, so the escape
  // comes from an explicit experimental stimulation of the giant fiber plus
  // the jolt to the antenna (both JO populations). Neither a nociception model
  // nor a measurement of felt pain.
  squeeze() {
    if (!this.sim || this.dead) return false;
    this.stim(this.sim.sens, 0.4, 150);
    this.stim(this.sim.gf, 0.5, 40, 'squeeze (experimenter)');
    this.loomOverride = 1;
    this.squeezeT = 0.5;
    this.health = clampf(this.health - 18, 0, 100);
    if (this.health <= 0) this.triggerDeath();
    return true;
  }

  resetBody() {
    const fly = this.fly;
    if (!fly) return;
    if (this.missingLeg >= 0) {
      for (let i = 0; i <= this.missingLeg; i++) fly.model.legs[i].root.visible = true;
      this.missingLeg = -1;
    }
    this.wingDamage = 0;
    fly.model.foldedWings.children[0].visible = true;
    fly.model.foldedWings.children[1].visible = true;
    this.pinned = null;
    this.wetness = 0;
  }

  triggerDeath() {
    if (this.dead) return;
    this.dead = true;
    this.learningSession.abort(this.sim, 'body-death');
    this.journalEvent('body-death', { body: this.bodySnapshot(), protocol: this.learningProtocol });
    const fly = this.fly;
    if (fly) {
      fly.speed = 0;
      if (fly.state === 'flying') fly.land();
    }
    this._emit({ kind: 'death', t: this.simTime, neuralMs: this.sim.simMs });
  }

  // A fresh individual: new network state, same species-typical wiring.
  respawn({ seed = freshSeed(), plasticity = undefined } = {}) {
    if (typeof plasticity === 'boolean') this.plasticityEnabled = plasticity;
    this._buildSimulation(seed);
    this.resetBody();
    const fly = this.fly;
    const hw = this.bounds.width / 2 - 100, hh = this.bounds.height / 2 - 100;
    fly.pos.x = (this._rnd() * 2 - 1) * hw; fly.pos.y = (this._rnd() * 2 - 1) * hh;
    fly.node.scale.z = 1;
    fly.node.rotation.x = 0;
    if (fly.state === 'flying') fly.land();
    this.health = 100;
    this.dead = false;
    this.dustLoad = 0;
    // A respawn is a different animal: pooling two individuals' spatial data
    // would call their average a preference.
    this.spatialMap.reset();
    this.individual++;
    this.events = [];
    this.journalEvent('respawn', { body: this.bodySnapshot(), environment: this.environmentSnapshot() });
  }

  resize({ width, height }) {
    if (!(width > 50 && height > 50)) return;
    this.bounds = { width, height };
    this.world.resize(this.bounds);
    for (const fly of this.flies) {
      fly.ledge = null;
      fly.pos.x = clampf(fly.pos.x, -width / 2 + 40, width / 2 - 40);
      fly.pos.y = clampf(fly.pos.y, -height / 2 + 40, height / 2 - 40);
    }
    this.journalEvent('arena-resize', { width, height });
  }

  // ---- pointer, taps and dragging ------------------------------------------------------------
  injectTap(p) {
    const fly = this.fly;
    if (!this.sim || !fly || !p) return;
    const d = Math.hypot(p.x - fly.pos.x, p.y - fly.pos.y);
    const strength = clampf(1 - d / 520, 0, 1);
    if (strength > 0.05) this.stim(this.sim.sens, 0.15 + strength * 0.35, 130, 'touch');
  }

  dragStart({ kind, id, x, y }) {
    const fly = this.fly;
    if (kind === 'fly' && fly && Math.hypot(fly.pos.x - x, fly.pos.y - y) < FLY_GRAB_RADIUS * 1.5) {
      this.pinned = null;
      this.drag = { kind: 'fly', start: { x, y }, last: { x, y } };
      return true;
    }
    if (kind === 'object') {
      const o = this.world.objects[id];
      if (o) { this.drag = { kind: 'object', obj: o }; return true; }
    }
    if (kind === 'point') { this.drag = { kind: 'point', id }; return true; }
    return false;
  }

  dragMove({ x, y }) {
    const d = this.drag;
    if (!d) return;
    if (d.kind === 'fly') { this.fly.pos.x = x; this.fly.pos.y = y; d.last = { x, y }; }
    else if (d.kind === 'object') { d.obj.pos.x = x; d.obj.pos.y = y; d.obj.mesh.position.x = x; d.obj.mesh.position.y = y; }
    else if (d.kind === 'point') this.handle({ name: 'point.move', args: { ...d.id, x, y } });
  }

  dragEnd() {
    const d = this.drag;
    this.drag = null;
    if (!d || d.kind !== 'fly') return;
    const fly = this.fly;
    const dx = d.last.x - d.start.x, dy = d.last.y - d.start.y;
    const dist = Math.hypot(dx, dy);
    if (dist > 18 && !this.dead) {
      // a real flick: giant-fiber stimulus, the same escape path its own spike triggers
      const flick = clampf(dist * 1.8, 140, 420);
      const tx = clampf(fly.pos.x + dx / dist * flick, -this.bounds.width / 2 + 40, this.bounds.width / 2 - 40);
      const ty = clampf(fly.pos.y + dy / dist * flick, -this.bounds.height / 2 + 40, this.bounds.height / 2 - 40);
      this.stim(this.sim.gf, 0.5, 40, 'flick (experimenter)');
      this.loomOverride = 0.6;
      fly.startFlight(this.bounds, { target: { x: tx, y: ty }, escape: true });
    } else {
      this.injectTap(d.start);
    }
  }

  // Cursor kinematics -> looming drive for each eye + air puff.
  _cursorLoom(fly, dt) {
    const mouse = this.pointer;
    if (!mouse) { this._prevPointer = null; return { l: 0, r: 0, puff: 0 }; }
    if (this._prevPointer && dt > 0) {
      this._pointerSampleDt += dt;
      if (mouse.x !== this._prevPointer.x || mouse.y !== this._prevPointer.y || this._pointerSampleDt >= 1 / 30) {
        this._pointerVelRaw.x = (mouse.x - this._prevPointer.x) / this._pointerSampleDt;
        this._pointerVelRaw.y = (mouse.y - this._prevPointer.y) / this._pointerSampleDt;
        this._prevPointer = { x: mouse.x, y: mouse.y };
        this._pointerSampleDt = 0;
      }
      const k = lag(24, dt);
      this._pointerVel.x += (this._pointerVelRaw.x - this._pointerVel.x) * k;
      this._pointerVel.y += (this._pointerVelRaw.y - this._pointerVel.y) * k;
    } else {
      this._prevPointer = { x: mouse.x, y: mouse.y };
      this._pointerSampleDt = 0;
    }
    const rel = { x: mouse.x - fly.pos.x, y: mouse.y - fly.pos.y };
    const dist = Math.max(20, Math.hypot(rel.x, rel.y));
    const v = this._pointerVel;
    const approach = -(rel.x * v.x + rel.y * v.y) / dist;
    let loom = clampf(approach / dist * 6, 0, 1) * clampf(1 - dist / 800, 0, 1);
    loom += clampf((130 - dist) / 130, 0, 1) * 0.5;
    const f = { x: Math.cos(fly.heading), y: Math.sin(fly.heading) };
    const crossZ = (f.x * rel.y - f.y * rel.x) / dist;
    const lw = clampf(0.5 + 0.5 * crossZ, 0.12, 1);
    const rw = clampf(0.5 - 0.5 * crossZ, 0.12, 1);
    const puff = clampf(Math.hypot(v.x, v.y) / 1500, 0, 1) * clampf(1 - dist / 500, 0, 1);
    return { l: clampf(loom, 0, 1) * lw, r: clampf(loom, 0, 1) * rw, puff };
  }

  // ---- the 120 Hz step ---------------------------------------------------------------------------
  advance(elapsed) {
    if (this.paused) { this.clock.reset(); return 0; }
    if (!Number.isFinite(elapsed) || elapsed <= 0) return 0;
    const t0 = performance.now();
    const ticks = this.clock.advance(elapsed * this.speed, (dt) => this.tick(dt), 0.1 * Math.max(1, this.speed));
    const dropped = this.clock.consumeDroppedSeconds();
    this.perf.dropped += dropped;
    this.totalDroppedSimulationSeconds += dropped;
    this.perf.wall += elapsed;
    this.perf.compute += (performance.now() - t0) / 1000;
    return ticks;
  }

  tick(dt) {
    withRandom(this._random, () => this._tick(dt));
  }

  _tick(dt) {
    this.simTime += dt;
    const fly = this.fly;
    const sim = this.sim;
    const env = this.env;
    const hour = this.hour();
    this.world.update(dt, this.bounds, hour);
    // flood: the water level animates toward its target
    this.floodLevel += ((env.flood ? 1 : 0) - this.floodLevel) * Math.min(1, dt * 0.4);
    if (this.floodLevel < 0.003) this.floodLevel = 0;
    // scent field (no olfactory neurons in this circuit: measured, not routed)
    const dScent = Math.hypot(fly.pos.x - this.scentPos.x, fly.pos.y - this.scentPos.y);
    this.smellPct = clampf(1 - dScent / SCENT_RADIUS, 0, 1);

    // earthquake: repeated real startles through the antenna and looming
    if (env.quake) {
      this._timers.quake -= dt;
      if (this._timers.quake <= 0) {
        this._timers.quake = 0.12 + this._rnd() * 0.18;
        this.stim(sim.sensAuditory?.length ? sim.sensAuditory : sim.sens, 0.5, 120);
        this.loomOverride = Math.max(this.loomOverride, 0.5);
      }
    }
    // dust: particles settle on the antennae; grooming them off is what the
    // antennal grooming circuit is for (JO-F -> DNg12, Hampel et al. 2020;
    // Guo et al. 2022). The load falls while she grooms her head.
    const groomingHead = fly.state === 'grooming' && fly.groomMode === 'head';
    if (env.dust) this.dustLoad = clampf(this.dustLoad + dt * 0.35, 0, 1);
    if (groomingHead) this.dustLoad = clampf(this.dustLoad - dt * 0.5, 0, 1);
    else if (fly.state === 'grooming') this.dustLoad = clampf(this.dustLoad - dt * 0.08, 0, 1);
    else if (!env.dust) this.dustLoad = clampf(this.dustLoad - dt * 0.02, 0, 1);
    if (env.dust && !sim.hasGroomingPathway) {
      // without the grooming pathway, fall back to the command neuron itself
      this._timers.dust -= dt;
      if (this._timers.dust <= 0) { this._timers.dust = 0.6 + this._rnd() * 0.7; this.stim(sim.groom, 0.3, 500); }
    }
    const smokeOxygenPenalty = env.smoke ? 35 : 0;
    const flyZ = fly.node.position.z || 0;
    const submerged = this.floodLevel > 0.02 && flyZ < this.floodLevel * FLOOD_MAX_Z;

    // temperature where she is, fire as local heat plus a bright looming object
    let effectiveTempC = this.localTempC(fly.pos.x);
    const fireLoom = { l: 0, r: 0 };
    if (env.fire) {
      const rel = { x: this.firePos.x - fly.pos.x, y: this.firePos.y - fly.pos.y };
      const dist = Math.max(1, Math.hypot(rel.x, rel.y));
      effectiveTempC += clampf(1 - dist / 220, 0, 1) * 40;
      const strength = clampf(1 - dist / 260, 0, 1) * 0.7;
      if (strength > 0) {
        const f = { x: Math.cos(fly.heading), y: Math.sin(fly.heading) };
        const crossZ = (f.x * rel.y - f.y * rel.x) / dist;
        fireLoom.l = strength * clampf(0.5 + 0.5 * crossZ, 0.12, 1);
        fireLoom.r = strength * clampf(0.5 - 0.5 * crossZ, 0.12, 1);
      }
    }
    if (env.iceRain) effectiveTempC -= 15;
    this.effectiveTempC = effectiveTempC;

    const windMs = env.windKmh / 3.6;
    const windRad = (env.windDirDeg * Math.PI) / 180;
    const windPushX = Math.cos(windRad) * windMs, windPushY = Math.sin(windRad) * windMs;
    const windPuff = clampf(env.windKmh / 40, 0, 1);

    const rainActive = env.rain || env.iceRain;
    let touch = 0;
    if (rainActive || submerged) {
      this.wetness = submerged ? 1 : clampf(this.wetness + dt * 0.12, 0, 1);
      this._timers.rain -= dt;
      if (this._timers.rain <= 0) {
        this._timers.rain = 0.25 + this._rnd() * 0.35;
        if (fly.state !== 'flying') { this.stim(sim.sens, submerged ? 0.3 : 0.10, submerged ? 150 : 70); touch = 0.3; }
      }
    } else {
      this.wetness = clampf(this.wetness - dt * 0.03, 0, 1);
    }

    // food under her feet
    let onFood = null;
    if (fly.state !== 'flying') {
      for (const d of this.food) {
        if (d.volume <= 0) continue;
        if (Math.hypot(fly.pos.x - d.x, fly.pos.y - d.y) < 10 + 14 * Math.sqrt(d.volume)) { onFood = d; break; }
      }
    }
    fly.onFood = Boolean(onFood);

    let signals = null;
    const cursor = this._cursorLoom(fly, dt);
    const encounter = this.world.sense(fly);
    this.smellPct = Math.max(this.smellPct, encounter.scent);
    // Detection gain on the rendered eye's motion energy: a model constant,
    // calibrated against measurement. Walking over the textured ground leaves
    // a self-motion residual of 0.002-0.016 per eye after the centre-surround
    // stage; the looming pathway's escape threshold is ~0.14 (experiment
    // 'escape-threshold'). At the former gain of 7 ordinary walking reached
    // 0.11 and triggered takeoffs every few seconds with nothing approaching;
    // at 5 the walking floor stays below 0.08 while an approaching object
    // (residual 0.05-0.2) still drives the pathway well past threshold.
    const visionGain = 5;
    const vL = clampf(this.vision.L * visionGain, 0, 1), vR = clampf(this.vision.R * visionGain, 0, 1);
    const loomTerms = (side) => {
      const terms = side === 'l'
        ? { cursor: clampf(cursor.l + this.loomOverride, 0, 1), world: encounter.loomL, fire: fireLoom.l, vision: vL }
        : { cursor: clampf(cursor.r + this.loomOverride, 0, 1), world: encounter.loomR, fire: fireLoom.r, vision: vR };
      let best = 'cursor', value = 0;
      for (const [k, v] of Object.entries(terms)) if (v > value) { value = v; best = k; }
      if (best === 'cursor' && this.loomOverride > 0.05 && this.loomOverride >= clampf(cursor[side], 0, 1)) best = 'stimulus';
      return { value, source: best };
    };
    const lt = loomTerms('l'), rt = loomTerms('r');
    const dead = this.dead;
    sim.loomL = dead ? 0 : lt.value;
    sim.loomR = dead ? 0 : rt.value;
    // Each stimulus goes to the neurons that actually transduce it
    // (test/sensorytest.js): puff -> both JO populations; steady wind -> JO-C/D/E only;
    // typing (nearby acoustic disturbance) -> JO-A/B only; odour -> nothing,
    // because this circuit contains no olfactory receptor neurons.
    sim.airPuff = dead ? 0 : cursor.puff;
    sim.windDrive = dead ? 0 : windPuff;
    sim.soundDrive = dead ? 0 : this.ambient.typing * 0.30;
    // Contact with objects: cooldown-gated brushing taps to the deflection-
    // sensitive JO-C/D/E, never a runaway per-tick blast.
    this._timers.objectTap -= dt;
    if (encounter.tap > 0.05 && this._timers.objectTap <= 0) {
      this._timers.objectTap = 0.18 + this._rnd() * 0.08;
      this.stim(sim.sensWind?.length ? sim.sensWind : sim.sens, 0.08 + encounter.tap * 0.18, 110);
      touch = Math.max(touch, encounter.tap);
    }
    // Taste. The labellar gustatory neurons in this circuit taste what the
    // labellum touches. Leg (tarsal) taste neurons project to the nerve cord
    // and are not in the brain data, so standing on a drop drives the
    // labellar neurons at 60% strength (the model's stand-in for first
    // contact), and fully once the extended proboscis is on the food.
    let sugar = 0, bitter = 0;
    if (onFood) {
      const contact = 0.6 + 0.4 * clampf((fly.proboscisExtension - 0.3) / 0.4, 0, 1);
      const conc = onFood.conc * contact;
      if (onFood.kind === 'sugar') sugar = conc;
      else if (onFood.kind === 'bitter') bitter = conc;
      else { sugar = conc; bitter = onFood.bitter * contact; }
      if (fly.state === 'feeding') onFood.volume = Math.max(0, onFood.volume - dt * 0.03);
    }
    if (this.simTime < this.tasteOffer.until) {
      sugar = Math.max(sugar, this.tasteOffer.sugar);
      bitter = Math.max(bitter, this.tasteOffer.bitter);
    }
    this.food = this.food.filter((d) => d.volume > 0);
    sim.sugarTaste = dead ? 0 : sugar;
    sim.bitterTaste = dead ? 0 : bitter;
    // Particles on the antennae drive the JO-F grooming mechanosensors.
    sim.antennaDust = dead || !sim.hasGroomingPathway ? 0 : dustDrive(this.dustLoad);
    // An experiment protocol's controlled stimulus adds to whatever the world
    // provides (in the bare experiment arena, the world provides nothing).
    let o = this.override;
    const burstKeys = Object.keys(this.bursts);
    if (burstKeys.length) {
      o = { ...(o || {}) };
      for (const k of burstKeys) {
        const bst = this.bursts[k];
        if (this.simTime >= bst.until) { delete this.bursts[k]; continue; }
        o[k] = Math.max(o[k] || 0, bst.level);
      }
    }
    if (o && !dead) {
      if (o.loomL) sim.loomL = Math.max(sim.loomL, o.loomL);
      if (o.loomR) sim.loomR = Math.max(sim.loomR, o.loomR);
      if (o.puff) sim.airPuff = Math.max(sim.airPuff, o.puff);
      if (o.wind) sim.windDrive = Math.max(sim.windDrive, o.wind);
      if (o.sound) sim.soundDrive = Math.max(sim.soundDrive, o.sound);
      if (o.sugar) sim.sugarTaste = Math.max(sim.sugarTaste, o.sugar);
      if (o.bitter) sim.bitterTaste = Math.max(sim.bitterTaste, o.bitter);
      if (o.dust && sim.hasGroomingPathway) sim.antennaDust = Math.max(sim.antennaDust, dustDrive(o.dust));
    }

    sim.gaitDrive = fly.walkingIntensity;
    sim.gaitPhase = fly.gaitPhasePublic;
    const feedback = fly.legFeedback;
    sim.legFeedback = this.missingLeg >= 0
      ? feedback.map((f, i) => (i <= this.missingLeg ? { ...f, contact: false, load: 0 } : f))
      : feedback;

    // cold torpor and anoxia scale the real baseline drive toward silence
    this.coldScale = effectiveTempC < 10 ? clampf((effectiveTempC + 10) / 20, 0.02, 1) : 1;
    const effectiveOxygen = submerged ? 0 : Math.max(0, env.oxygenPct - smokeOxygenPenalty);
    this.oxygenScale = clampf(effectiveOxygen / 100, 0.02, 1);
    this.lifeSupport = this.coldScale * this.oxygenScale;
    const activity = this.ambient.activity;
    const sleepy = this.ambient.sleepy;
    sim.activityScale = dead ? 0 : this.lifeSupport * (1 - (1 - activity) * 0.35) * (sleepy ? 0.75 : 1);
    sim.sensoryGate = sleepy ? 0.55 : 1;

    // health: a body-level survival budget drained by the stresses above
    if (!dead) {
      let drain = 0;
      if (this.lifeSupport < 0.15) drain += 8;
      if (submerged) drain += 10;
      if (effectiveTempC > 50) drain += 15;
      if (effectiveTempC < -8) drain += 10;
      if (this.missingLeg >= 0) drain += (this.missingLeg + 1) * 0.5;
      if (this.wingDamage > 0) drain += this.wingDamage * 1.0;
      if (env.windKmh > 60) drain += 3;
      this.health = clampf(this.health - drain * dt + (drain === 0 ? 2 * dt : 0), 0, 100);
      if (this.health <= 0) this.triggerDeath();
    }

    // Temperature reaches the brain through FlyWire's real hot and cold cells.
    // Transduction is a MODEL: the antennal thermosensors respond mainly to
    // temperature CHANGE (Gallio et al. 2011; Budelli et al. 2019), plus a
    // smaller tonic term outside a 24-26 C band.
    const tempRate = this._prevThermoTempC === null ? 0 : (effectiveTempC - this._prevThermoTempC) / Math.max(dt, 1e-3);
    this._prevThermoTempC = effectiveTempC;
    this._thermoRate += (clampf(tempRate, -20, 20) - this._thermoRate) * clampf(dt / 0.3, 0, 1);
    const hotDrive = clampf((effectiveTempC - 26) / 14, 0, 1) + Math.max(0, this._thermoRate) * 0.25;
    const coldDrive = clampf((24 - effectiveTempC) / 14, 0, 1) + Math.max(0, -this._thermoRate) * 0.25;
    sim.thermoHotDrive = dead ? 0 : clampf(hotDrive, 0, 1);
    sim.thermoColdDrive = dead ? 0 : clampf(coldDrive, 0, 1);
    this.loomOverride = Math.max(0, this.loomOverride - dt * 1.2);

    this.history.push(this.simTime, {
      loomL: sim.loomL, loomR: sim.loomR, puff: sim.airPuff, wind: sim.windDrive, sound: sim.soundDrive,
      hot: sim.thermoHotDrive, cold: sim.thermoColdDrive, sugar: sim.sugarTaste, bitter: sim.bitterTaste,
      dust: sim.antennaDust, touch,
    }, { l: lt.source, r: rt.source });

    this.msAccumulator += dt * 1000;
    const steps = Math.min(50, Math.floor(this.msAccumulator));
    this.msAccumulator -= steps;
    if (steps > 0) {
      const t0 = performance.now();
      sim.step(steps);
      this.perf.simulated += steps / 1000;
      this.perf.neural = (this.perf.neural || 0) + (performance.now() - t0) / 1000;
      this.perf.spikes += sim.lastStepSpikes;
      this.perf.deliveries += sim.lastStepDeliveries;
    }
    signals = this.signalBuilder.make(sim, dt);
    signals.tempo = tempoFromCelsius(effectiveTempC);
    signals.sleep = sleepy;
    const escapeNow = signals.escape;

    // ---- body ----
    for (let i = 0; i < this.flies.length; i++) {
      const f = this.flies[i];
      f.gravityScale = env.gravity;
      const isFirst = i === 0;
      const held = (isFirst && this.drag?.kind === 'fly') || (isFirst && this.pinned) || (isFirst && dead);
      if (isFirst && dead) { if (f.state === 'flying') f.land(); f.speed = 0; }
      if (!held) {
        f.update(dt, this.bounds, this.pointer, isFirst ? signals : null);
        if (isFirst) {
          f.pos.x += windPushX * dt * (f.state === 'flying' ? 0.6 : 0.12);
          f.pos.y += windPushY * dt * (f.state === 'flying' ? 0.6 : 0.12);
        }
      } else if (isFirst && this.pinned) {
        f.pos.x = this.pinned.x; f.pos.y = this.pinned.y;
        f.syncNode();
      } else if (isFirst) f.syncNode();
      // wet or missing wings, water or high gravity cannot sustain lift
      if (isFirst && f.state === 'flying' && (this.wingDamage > 0 || this.wetness > 0.6 || submerged || env.gravity > 2.5)) f.land();
      if (isFirst && f.state === 'flying' && env.gravity > 1) f.alt = Math.max(0, f.alt - dt * 0.4 * (env.gravity - 1));
      // below ~10% of normal cold x oxygen the neurons no longer drive movement
      if (isFirst && this.lifeSupport < 0.1) { if (f.state === 'flying') f.land(); f.speed = 0; }
      if (isFirst && this.squeezeT > 0) {
        this.squeezeT -= dt;
        const k = 1 - clampf(this.squeezeT / 0.5, 0, 1);
        f.node.scale.z *= 1 - 0.55 * Math.sin(k * Math.PI);
      }
      if (isFirst && dead) f.node.rotation.x = Math.PI / 2;
      this.world.collide(f);
    }

    this._detectEvents(signals, escapeNow);

    // ---- instruments (read-only) ----
    const previousStatus = this.learningProtocol?.status;
    this.learningSession.poll(sim.simMs);
    if (this.learningProtocol && previousStatus !== this.learningProtocol.status) {
      this.journalEvent(`learning-${this.learningProtocol.status}`, { protocol: this.learningProtocol });
    }
    if (this.instrumentsOn) {
      if (this.recording) {
        this.recordElapsed += dt;
        if (this.recordSampling.advance(dt)) this._captureSample();
      }
      if (this.traceSampling.advance(dt)) this.pendingTrace.push(this._traceSample());
      if (this.pendingTrace.length > 400) this.pendingTrace.splice(0, this.pendingTrace.length - 400);
      const u = (fly.pos.x + this.bounds.width / 2) / this.bounds.width;
      const v = (fly.pos.y + this.bounds.height / 2) / this.bounds.height;
      this.spatialMap.add(u, v, dt, {
        fear: sim.rateGF, loom: sim.rateLoom, sens: sim.rateSens, temp: this.localTempC(fly.pos.x),
        hot: sim.rateThermoHot, cold: sim.rateThermoCold, proboscis: sim.rateProboscis, dng12: sim.rateDNg12,
      });
    }
  }

  // ---- behavioural events and their explanations ---------------------------------------
  _emit(event) {
    this.events.push(event);
    if (this.events.length > 60) this.events.shift();
    this.pendingEvents.push(event);
    if (this.pendingEvents.length > 20) this.pendingEvents.shift();
  }

  _explainEvent(kind, extra = {}) {
    const last = this._eventCooldown[kind] ?? -Infinity;
    if (this.simTime - last < 1.2) return;
    this._eventCooldown[kind] = this.simTime;
    const e = explain(kind, { sim: this.sim, now: this.simTime, history: this.history, rates: this.sim.rates(), extra });
    if (e) this._emit(e);
  }

  _detectEvents(signals, escapeNow) {
    const fly = this.fly, prev = this._prev;
    if (fly.state !== prev.state) {
      if (fly.state === 'flying') this._explainEvent(escapeNow ? 'takeoff' : 'spontaneousFlight', { populationHz: this.sim.ratePop });
      else if (fly.state === 'grooming') this._explainEvent(fly.groomMode === 'head' ? 'headGrooming' : 'legGrooming', { dustLoad: this.dustLoad });
      else if (fly.state === 'feeding') this._explainEvent('feeding');
    }
    if (fly.backwardTimer > 0 && prev.backward === 0) this._explainEvent('backward');
    if (fly.dartTimer > 0 && prev.dart === 0) this._explainEvent('dart', { loomHz: this.sim.rateLoom });
    const probOut = fly.proboscisExtension > 0.5;
    if (probOut && !prev.proboscisOut && fly.state !== 'feeding') this._explainEvent('proboscis');
    // sustained turning while walking: heading change over 0.3 s
    prev.headingT += SimulationClock.fixedDT;
    if (prev.headingT >= 0.3) {
      let dh = fly.heading - prev.heading;
      while (dh > Math.PI) dh -= 2 * Math.PI;
      while (dh < -Math.PI) dh += 2 * Math.PI;
      const rate = dh / prev.headingT;
      if (fly.state === 'walking' && Math.abs(rate) > 2.2) this._explainEvent(rate > 0 ? 'turnLeft' : 'turnRight', { turnRate: rate });
      prev.heading = fly.heading; prev.headingT = 0;
    }
    prev.state = fly.state;
    prev.backward = fly.backwardTimer;
    prev.dart = fly.dartTimer;
    prev.proboscisOut = probOut;
  }

  // ---- recording ------------------------------------------------------------------------------
  startRecording() {
    if (this.recording) return false;
    this.recorder.clear();
    this.recordElapsed = 0;
    this.recordSampling.reset();
    this.recording = true;
    this.recordingStart = this.manifest();
    this.journalEvent('recording-start');
    return true;
  }

  // Ends the recording and returns its content; the caller saves it.
  stopRecording({ format = 'csv' } = {}) {
    const wasRecording = this.recording;
    this.recording = false;
    if (wasRecording) this.journalEvent('recording-stop', { rows: this.recorder.count });
    const rows = this.recorder.count;
    if (!rows) return { rows: 0, content: null };
    const csv = this.recorder.toCSV();
    const content = format === 'bundle'
      ? recordingPackageJSON({ csv, rowCount: rows, start: this.recordingStart, end: this.manifest(),
        samplingHz: RECORDING_HZ, missedSamples: this.recordSampling.missed })
      : csv;
    return { rows, content, format, hitCap: rows >= MAX_ROWS };
  }

  clearRecording() { this.recorder.clear(); this.recordingStart = null; }

  _captureSample() {
    const sim = this.sim, fly = this.fly;
    const plasticity = sim.plasticitySummary();
    const ok = this.recorder.add({
      t: this.recordElapsed, clock: new Date().toISOString(), individual: this.individual,
      modelVersion: MODEL_VERSION, neuralSeed: sim.neuralSeed, sessionId: this.sessionId,
      neuralRun: this.neuralRun, neuralTimeMs: sim.simMs, eventSequence: this.journal.sequence,
      brainFingerprint: this.data.provenance?.brainCircuitSHA256?.slice(0, 16),
      vncFingerprint: this.data.provenance?.locomotorSHA256?.slice(0, 16),
      brainVncBridge: 'modeled same-type/side population-rate interface',
      plasticityMode: plasticity.enabled ? plasticity.mechanism : 'off',
      plasticityProtocol: this.learningProtocol?.name ?? 'none',
      plasticityEligibleEdges: plasticity.eligibleEdges, plasticityUpdates: plasticity.updates,
      plasticityMeanAbsRelChange: plasticity.meanAbsRelativeChange,
      ratePop: sim.ratePop, rateGF: sim.rateGF, rateLoom: sim.rateLoom, rateSens: sim.rateSens,
      rateJOAuditory: sim.rateJOAuditory, rateJOWind: sim.rateJOWind, rateFwd: sim.rateFwd, rateGroom: sim.rateGroom,
      rateThermoHot: sim.rateThermoHot, rateThermoCold: sim.rateThermoCold,
      rateThermoRelayHot: sim.rateThermoRelayHot, rateThermoRelayCold: sim.rateThermoRelayCold,
      thermoHotDrive: sim.thermoHotDrive, thermoColdDrive: sim.thermoColdDrive,
      rateMDN: sim.rateMDN, rateDNaL: sim.rateDNaL, rateDNaR: sim.rateDNaR, rateEscW: sim.rateEscW, rateAscend: sim.rateAscend,
      rateDA: sim.rateDA, rateModOther: sim.rateModOther,
      loomL: sim.loomL, loomR: sim.loomR, airPuff: sim.airPuff, windDrive: sim.windDrive, soundDrive: sim.soundDrive,
      visionMotionL: this.vision.L, visionMotionR: this.vision.R,
      state: fly.state, speed: fly.speed, alt: fly.alt, heading: fly.heading, posX: fly.pos.x, posY: fly.pos.y,
      health: this.health, tempC: this.env.tempC, tempLocal: this.localTempC(fly.pos.x), tempGradient: this.env.tempGradientC,
      windKmh: this.env.windKmh, gravity: this.env.gravity, oxygenPct: this.env.oxygenPct, wetness: this.wetness,
      smellPct: this.smellPct, circadian: circadianActivity(this.hour()),
      rateSugar: sim.rateSugar, rateBitter: sim.rateBitter, rateTasteRelay: sim.rateTasteRelay,
      rateProboscis: sim.rateProboscis, rateIngestion: sim.rateIngestion, rateJOF: sim.rateJOF,
      rateGroomRelay: sim.rateGroomRelay, rateDNg12: sim.rateDNg12,
      sugarTaste: sim.sugarTaste, bitterTaste: sim.bitterTaste, antennaDust: sim.antennaDust,
      proboscisExtension: fly.proboscisExtension, groomMode: fly.state === 'grooming' ? fly.groomMode : '',
      silencedCells: sim.silencedCount, genetics: this.genetics.map((g) => `${g.mode}:${g.population}`).join(';'),
      pharmacology: Object.entries(this.pharmacology).filter(([, v]) => v !== 1).map(([k, v]) => `${k}=${v}`).join(';'),
      simSpeed: this.speed,
    });
    if (!ok) this.recording = false;
  }

  _traceSample() {
    const s = this.sim;
    return { t: this.simTime, gf: s.rateGF, loomL: s.rateLoomL, loomR: s.rateLoomR, joA: s.rateJOAuditory, joW: s.rateJOWind,
      fwd: s.rateFwd, mdn: s.rateMDN, dnaL: s.rateDNaL, dnaR: s.rateDNaR, groom: s.rateGroom, dng12: s.rateDNg12,
      joF: s.rateJOF, sugar: s.rateSugar, bitter: s.rateBitter, proboscis: s.rateProboscis, hot: s.rateThermoHot,
      cold: s.rateThermoCold, pop: s.ratePop, escw: s.rateEscW, ascend: s.rateAscend };
  }

  // ---- manifests and exports ---------------------------------------------------------------
  manifest() {
    const sim = this.sim;
    const perf = this.performanceSnapshot();
    const m = makeExperimentManifest({
      session: { id: this.sessionId, neuralRun: this.neuralRun, individual: this.individual },
      environment: this.environmentSnapshot(), body: this.bodySnapshot(),
      interventions: this.journal.snapshot(), modelVersion: MODEL_VERSION, neuralSeed: sim.neuralSeed,
      data: this.data, plasticity: sim.plasticitySummary(), protocol: this.learningProtocol,
      performance: { windowSeconds: perf.windowSeconds, fps: null, simulationRealtime: perf.simulationRealtime,
        coreRealtime: perf.coreRealtime, droppedSecondsPerSecond: perf.droppedSecondsPerSecond,
        totalDroppedSimulationSeconds: this.totalDroppedSimulationSeconds },
      protocolHistory: this.learningSession.history, neuralTimeMs: sim.simMs,
    });
    return { ...m, conditions: {
      genetics: this.genetics.map(({ mode, population, label, count, strength }) => ({ mode, population, label, count, strength: strength ?? null })),
      pharmacology: { ...this.pharmacology, note: 'Synaptic efficacy scaled per transmitter class; GABA and glutamate share the inhibitory class in the extracted data.' },
      pathwayWeight: sim.pathwayWeight,
      pathwayWeightNote: 'Taste and antennal-grooming pathways run at the peak-matched per-synapse efficacy of Shiu et al. (2024); the core at 0.0002.',
      simulationSpeed: this.speed,
    } };
  }

  learningCSV() {
    const sim = this.sim;
    const summary = sim.plasticitySummary();
    const changes = sim.plasticityChanges();
    if (!summary.enabled || !changes.length) return null;
    return plasticityChangesCSV({ modelVersion: MODEL_VERSION, neuralSeed: sim.neuralSeed,
      brainFingerprint: this.data.provenance?.brainCircuitSHA256?.slice(0, 16), mechanism: summary.mechanism,
      protocol: this.learningProtocol, protocolHistory: this.learningSession.history, neuralTimeMs: sim.simMs,
      data: this.data, plasticity: summary, changes });
  }

  probe(index) {
    const sim = this.sim;
    const i = Number(index);
    if (!Number.isInteger(i) || i < 0 || i >= sim.n) return null;
    const nr = this.data.circuit.neurons[i];
    let incoming = 0, outgoing = sim.rowStart[i + 1] - sim.rowStart[i];
    // incoming count, computed on demand (a single pass over the CSR)
    const col = sim.colIdx;
    for (let k = 0; k < col.length; k++) if (col[k] === i) incoming++;
    const partners = (dir) => {
      const tally = new Map();
      if (dir === 'out') {
        for (let k = sim.rowStart[i]; k < sim.rowStart[i + 1]; k++) {
          const j = col[k]; const t = sim.cellTypes[j] || sim.types[j];
          tally.set(t, (tally.get(t) || 0) + sim.w[k]);
        }
      } else {
        for (let pre = 0; pre < sim.n; pre++) {
          for (let k = sim.rowStart[pre]; k < sim.rowStart[pre + 1]; k++) {
            if (col[k] !== i) continue;
            const t = sim.cellTypes[pre] || sim.types[pre];
            tally.set(t, (tally.get(t) || 0) + sim.w[k]);
          }
        }
      }
      return [...tally].sort((a, b) => Math.abs(b[1]) - Math.abs(a[1])).slice(0, 8).map(([type, weight]) => ({ type, weight }));
    };
    return { index: i, id: String(nr.id), type: nr.cellType || nr.type, superClass: nr.type, role: nr.role, side: nr.side,
      extension: nr.extension || null, group: nr.sensoryGroup || nr.motorGroup || nr.thermoGroup || nr.pathRole || null,
      incoming, outgoing, membrane: sim.v[i], threshold: sim.thresholds[i], refractoryMs: sim.refr[i],
      silenced: sim.silenced[i] === 1, baseline: sim.baseline[i], neuralMs: sim.simMs,
      topInputs: partners('in'), topOutputs: partners('out') };
  }

  performanceSnapshot() {
    const p = this.perf;
    const snap = {
      windowSeconds: p.wall,
      simulationRealtime: p.wall > 0 ? p.simulated / p.wall : 0,
      coreRealtime: p.neural > 0 ? p.simulated / p.neural : 0,
      loopLoad: p.wall > 0 ? p.compute / p.wall : 0,
      spikesPerSecond: p.wall > 0 ? p.spikes / p.wall : 0,
      deliveriesPerSecond: p.wall > 0 ? p.deliveries / p.wall : 0,
      droppedSecondsPerSecond: p.wall > 0 ? p.dropped / p.wall : 0,
      totalDroppedSimulationSeconds: this.totalDroppedSimulationSeconds,
    };
    if (p.wall > 1) this.perf = { simulated: 0, compute: 0, neural: 0, spikes: 0, deliveries: 0, wall: 0, dropped: 0, last: snap };
    return p.wall > 1 || !p.last ? snap : p.last;
  }

  // ---- what the renderer and the panels need, once per displayed frame ------------------
  snapshot({ includeMap = false, mapField = 'occupancy' } = {}) {
    const sim = this.sim, fly = this.fly;
    const rates = sim.rates();
    const poses = this.flies.map((f) => {
      f._poseNodes ??= poseNodes(f.model);
      f._pose = extractPose(f.model, f._pose, f._poseNodes);
      return f._pose.slice();
    });
    const legs = fly.legFeedback.map((f, i) => ({ contact: i <= this.missingLeg ? false : !!f.contact,
      load: i <= this.missingLeg ? 0 : f.load, hip: f.hipAngle, knee: f.kneeAngle }));
    const loc = sim.locomotor;
    const cord = (types) => {
      let sum = 0, n = 0;
      sim.cordSourceGroups.forEach((g, i) => { if (types.includes(g.type)) { sum += sim.cordSourceRates[i]; n++; } });
      return n ? sum / n : 0;
    };
    const out = {
      t: this.simTime, neuralMs: sim.simMs, seed: sim.neuralSeed, neuralRun: this.neuralRun, individual: this.individual,
      paused: this.paused, speed: this.speed, dead: this.dead, health: this.health, n: sim.n,
      fly: { x: fly.pos.x, y: fly.pos.y, z: fly.node.position.z || 0, heading: fly.heading, state: fly.state,
        groomMode: fly.groomMode, alt: fly.alt, speed: fly.speed, proboscis: fly.proboscisExtension, onFood: fly.onFood,
        backward: fly.backwardTimer > 0 },
      poses,
      objects: this.world.packState(),
      firePos: { ...this.firePos }, scentPos: { ...this.scentPos },
      food: this.food.map((d) => ({ ...d })),
      env: { ...this.env, floodLevel: this.floodLevel, dustLoad: this.dustLoad },
      body: { wetness: this.wetness, lifeSupport: this.lifeSupport, coldScale: this.coldScale, oxygenScale: this.oxygenScale,
        tempo: tempoFromCelsius(this.effectiveTempC), effectiveTempC: this.effectiveTempC, smell: this.smellPct,
        missingLeg: this.missingLeg, wingDamage: this.wingDamage, pinned: Boolean(this.pinned) },
      rates,
      inputs: { loomL: sim.loomL, loomR: sim.loomR, puff: sim.airPuff, wind: sim.windDrive, sound: sim.soundDrive,
        hot: sim.thermoHotDrive, cold: sim.thermoColdDrive, sugar: sim.sugarTaste, bitter: sim.bitterTaste, dust: sim.antennaDust,
        visionL: this.vision.L, visionR: this.vision.R },
      legs,
      // Modelled stepping rules (rhythm.js): which legs are in swing, for the gait diagram.
      stepping: loc?.stepper ? { active: loc.stepper.active, swing: Array.from(loc.stepper.swing),
        steps: loc.stepper.steps, direction: loc.stepper.direction } : null,
      hierarchy: { cordFwd: cord(['DNp09']), cordSteer: cord(['DNa01', 'DNa02']), cordBack: cord(['MDN']),
        vncSens: loc ? loc.meanRate('sensory') : 0, vncMotor: loc ? loc.meanRate('motor') : 0, brainAscend: sim.rateAscend },
      spikes: this.spikeBus ? this.spikeBus.drain() : null,
      trace: this.pendingTrace.splice(0),
      events: this.pendingEvents.splice(0),
      recording: { active: this.recording, rows: this.recorder.count },
      plasticity: sim.plasticitySummary(),
      learning: { protocol: this.learningProtocol, history: this.learningSession.history, active: Boolean(this.learningSession.active),
        progress: this.learningProtocol && this.learningSession.active
          ? clampf((sim.simMs - this.learningProtocol.startedAtNeuralMs) / Math.max(1, this.learningProtocol.endNeuralMs - this.learningProtocol.startedAtNeuralMs), 0, 1) : 0 },
      genetics: this.genetics.map(({ key, mode, population, label, count, strength }) => ({ key, mode, population, label, count, strength })),
      silenced: sim.silencedCount,
      pharmacology: { ...this.pharmacology },
      perf: this.performanceSnapshot(),
      journal: { total: this.journal.sequence, dropped: this.journal.dropped },
    };
    if (includeMap) {
      out.map = mapField === 'occupancy' || this.spatialMap.fields.includes(mapField) || mapField === 'events'
        ? { field: mapField, ...this.spatialMap.normalizedField(mapField, mapField === 'temp'),
          totalTime: this.spatialMap.totalTime, preference: mapField === 'occupancy' ? null : this.spatialMap.preferenceForLow(mapField),
          cols: this.spatialMap.cols, rows: this.spatialMap.rows }
        : null;
    }
    return out;
  }
}

export { WATCH_GROUPS, RECORDING_HZ };
