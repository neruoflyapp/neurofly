import assert from 'node:assert/strict';
import { SamplingClock } from '../src/sampling-clock.js';
for (const hz of [10, 20]) {
  for (const tickHz of [60, 120, 240]) {
    const clock = new SamplingClock(hz);
    let count = 0;
    for (let i = 0; i < tickHz * 60; i++) if (clock.advance(1 / tickHz)) count++;
    assert.equal(count, hz * 60); assert.equal(clock.missed, 0);
  }
}
const clock = new SamplingClock(20);
assert.equal(clock.advance(.02), false);
assert.equal(clock.advance(.03), true);
assert.equal(clock.advance(.2), true); assert.equal(clock.missed, 3);
clock.reset(); assert.equal(clock.missed, 0); assert.equal(clock.phase, 0);
assert.throws(() => clock.advance(NaN));
console.log('PASS exact sample cadence at 60/120/240 Hz, remainder preservation, explicit missed samples, reset');
