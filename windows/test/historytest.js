// historytest.js — the rolling history behind the dashboard's trace strip.
//   node test/historytest.js
//
// The trace is meant to be read as evidence ("that spike happened two seconds
// ago and is decaying"), so the ordering across the buffer's wrap-around has
// to be right, and channels have to stay aligned in time with each other —
// a trace that silently reorders itself would invite exactly the wrong reading.

import { RingTrace, MultiTrace } from '../src/history.js';

let failures = 0;
function check(name, fn) {
  const [ok, describe] = fn();
  if (!ok) failures++;
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}: ${describe}`);
}

check('before it is full, samples read back oldest-first', () => {
  const t = new RingTrace(5);
  [1, 2, 3].forEach((v) => t.push(v));
  const got = [t.at(0), t.at(1), t.at(2)];
  return [t.count === 3 && got.join(',') === '1,2,3', `count ${t.count}, read ${got.join(',')}`];
});

check('after wrapping, the oldest sample is dropped and order is preserved', () => {
  const t = new RingTrace(4);
  [1, 2, 3, 4, 5, 6].forEach((v) => t.push(v));
  const got = [];
  for (let i = 0; i < t.count; i++) got.push(t.at(i));
  return [t.count === 4 && got.join(',') === '3,4,5,6',
    `held ${got.join(',')} — 1 and 2 aged out, the rest still in order`];
});

check('the newest sample is always last', () => {
  const t = new RingTrace(3);
  for (let v = 1; v <= 10; v++) {
    t.push(v);
    if (t.at(t.count - 1) !== v) return [false, `after pushing ${v} the last slot held ${t.at(t.count - 1)}`];
  }
  return [true, 'last slot tracked the newest value across 10 pushes and 3 wraps'];
});

check('max reflects only what is still held, not what has aged out', () => {
  const t = new RingTrace(3);
  [100, 1, 2, 3].forEach((v) => t.push(v));
  return [t.max() === 3, `peak 100 aged out; max now ${t.max()}`];
});

check('non-finite samples are stored as 0 rather than poisoning the trace', () => {
  const t = new RingTrace(3);
  [NaN, Infinity, 5].forEach((v) => t.push(v));
  const ok = Number.isFinite(t.at(0)) && Number.isFinite(t.at(1)) && t.at(2) === 5;
  return [ok, `stored ${t.at(0)},${t.at(1)},${t.at(2)}`];
});

check('channels stay aligned in time with each other', () => {
  const m = new MultiTrace(['gf', 'loom'], 4);
  for (let k = 0; k < 6; k++) m.push({ gf: k, loom: k * 10 });
  let aligned = true;
  for (let i = 0; i < m.count; i++) {
    if (m.get('loom').at(i) !== m.get('gf').at(i) * 10) aligned = false;
  }
  return [aligned && m.count === 4,
    'every retained index still pairs the samples that were pushed together'];
});

check('a missing channel value does not shift the others', () => {
  const m = new MultiTrace(['a', 'b'], 3);
  m.push({ a: 1 });            // b absent
  m.push({ a: 2, b: 20 });
  return [m.get('a').count === m.get('b').count && m.get('b').at(0) === 0 && m.get('b').at(1) === 20,
    'both channels advanced together; the absent sample became 0, not a gap'];
});

check('clear empties every channel', () => {
  const m = new MultiTrace(['a'], 3);
  m.push({ a: 5 });
  m.clear();
  return [m.count === 0 && m.get('a').max() === 0, 'count back to 0'];
});

console.log(failures === 0 ? 'ALL HISTORY TESTS PASS' : `${failures} FAILURES`);
process.exit(failures === 0 ? 0 : 1);
