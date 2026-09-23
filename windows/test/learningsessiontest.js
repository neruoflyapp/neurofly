import assert from 'node:assert/strict';
import { LearningSession } from '../src/learning-session.js';
const fake = () => ({ simMs: 0, loomLeft: [0], loomRight: [1], gf: [2], scheduledStims: [], activeStims: [],
  plasticitySummary: () => ({ enabled: true, updates: 0, tauMs: 20, learningRate: .01, maxRelativeChange: .2 }),
  scheduleStimulate(indices, strength, delayMs, durationMs) { this.scheduledStims.push({ indices, strength, startMs: this.simMs + delayMs, durationMs }); return true; },
});
const s = new LearningSession(), sim = fake();
assert.equal(s.start(sim, 'pre-before-post').ok, true);
assert.equal(sim.scheduledStims.length, 32);
assert.equal(s.active.endNeuralMs, 2111);
assert.equal(s.start(sim, 'post-before-pre').ok, false);
s.poll(1); assert.equal(s.active.status, 'running');
s.poll(2110); assert.ok(s.active);
s.poll(2111); assert.equal(s.active, null); assert.equal(s.history[0].status, 'completed');
sim.simMs = 2200; sim.scheduledStims = [];
assert.equal(s.start(sim, 'post-before-pre').ok, true);
sim.activeStims.push({ learningSessionId: 2 }, { external: true });
sim.scheduledStims.push({ external: true });
s.abort(sim, 'body-death');
assert.deepEqual(sim.activeStims, [{ external: true }]);
assert.deepEqual(sim.scheduledStims, [{ external: true }]);
assert.equal(s.history[1].abortReason, 'body-death');
s.reset(); assert.equal(s.history.length, 0);
const fail = fake(); let count = 0;
const schedule = fail.scheduleStimulate;
fail.scheduleStimulate = function (...args) { return ++count === 3 ? false : schedule.apply(this, args); };
assert.equal(s.start(fail, 'pre-before-post').ok, false);
assert.equal(fail.scheduledStims.length, 0);
assert.equal(s.history.length, 0);
console.log('PASS learning-session overlap guard, exact end, history, selective abort, atomic rollback');
