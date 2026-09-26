import assert from 'node:assert/strict';
import { recordingPackageJSON } from '../src/recording-package.js';
import { recordingState, recordingExitPolicy } from '../src/recording-guard.js';
import { ClosedLoop } from '../src/closed-loop.js';
import { Recorder } from '../src/recording.js';
import { SamplingClock } from '../src/sampling-clock.js';
const start = { session: { id: 'same', neuralRun: 1 }, createdAt: 'start', environment: { tempC: 24 } };
const end = { session: { id: 'same', neuralRun: 2 }, createdAt: 'end', environment: { tempC: 29 } };
const input = { csv: 'value\n1\n', rowCount: 1, start, end, samplingHz: 20, missedSamples: 0 };
const first = recordingPackageJSON(input);
assert.equal(recordingPackageJSON(input), first, 'retry produces byte-identical package');
const parsed = JSON.parse(first);
assert.equal(parsed.recording.csv, input.csv);
assert.equal(parsed.end.session.neuralRun, 2, 'recordings can span neural restarts');
assert.equal(parsed.start.environment.tempC, 24);
assert.equal(parsed.end.environment.tempC, 29);
assert.throws(() => recordingPackageJSON({ ...input, end: { session: { id: 'other' } } }));
assert.throws(() => recordingPackageJSON({ ...input, rowCount: 0 }));
assert.throws(() => recordingPackageJSON({ ...input, missedSamples: NaN }));
assert.equal(recordingExitPolicy(recordingState()), 'allow');
assert.equal(recordingExitPolicy(recordingState({ active: true })), 'confirm');
assert.equal(recordingExitPolicy(recordingState({ rows: 1 })), 'confirm');
assert.equal(recordingExitPolicy(recordingState({ saving: true, rows: 1 })), 'wait');
assert.deepEqual(recordingState({ active: 'yes', rows: NaN }), { active: false, saving: false, rows: 0 });
console.log('PASS self-contained recording packages, stable retry, session validation, exit/reload policy');

// Exercise the real recording methods without constructing a large neural
// circuit. These observers must not require running the simulated brain.
function recordingRig(maxRows = 10) {
  const rig = Object.create(ClosedLoop.prototype);
  Object.assign(rig, {
    recorder: new Recorder(undefined, maxRows), recording: false,
    recordElapsed: 0, recordSampling: new SamplingClock(20), recordingStart: null, recordingEnd: null,
    data: { provenance: {} }, sim: { plasticitySummary: () => ({ enabled: false }), simMs: 0 },
    flies: [{ pos: { x: 0, y: 0 }, state: 'walking' }], env: { tempC: 24 },
    vision: { L: 0, R: 0 }, genetics: [], pharmacology: {}, journal: { sequence: 0 },
    testTime: 0, testEvents: [],
    hour: () => 12, localTempC: () => 24,
    journalEvent(kind, details) { this.journal.sequence++; this.testEvents.push({ kind, details }); },
    manifest() {
      return {
        session: { id: 'same', neuralRun: 1 }, createdAt: `time-${this.testTime}`,
        model: { neuralTimeMs: this.testTime }, environment: { tempC: this.env.tempC },
        interventions: { totalEvents: this.journal.sequence },
      };
    },
  });
  return rig;
}

{
  const rig = recordingRig();
  assert.equal(rig.startRecording(), true);
  rig.recorder.add({ t: 0.05 });
  rig.testTime = 50;
  const csv = rig.stopRecording();
  const beforeRetry = rig.stopRecording({ format: 'bundle' });
  rig.testTime = 900;
  rig.env.tempC = 39;
  const retry = rig.stopRecording({ format: 'bundle' });
  assert.equal(retry.content, beforeRetry.content, 'save retries must preserve bytes after simulation time and conditions advance');
  assert.equal(JSON.parse(retry.content).end.model.neuralTimeMs, 50);
  assert.equal(JSON.parse(retry.content).end.environment.tempC, 24);
  assert.equal(JSON.parse(retry.content).recording.csv, csv.content, 'changing export format retains the same measurement series');
  assert.equal(rig.testEvents.filter((e) => e.kind === 'recording-stop').length, 1, 'retry is not another recording boundary');
  assert.equal(rig.startRecording(), false, 'a new recording cannot overwrite retained rows after a canceled or failed save');
  assert.equal(rig.recorder.count, 1);
  assert.equal(rig.stopRecording({ format: 'bundle' }).content, retry.content);
  console.log('PASS recording retries preserve the original boundary manifest and retained measurements');
}

{
  const rig = recordingRig(2);
  rig.startRecording();
  assert.equal(rig.clearRecording(), false, 'an in-flight recording cannot be cleared by a stale save reply');
  rig.testTime = 50;
  rig._captureSample();
  assert.equal(rig.recording, true);
  rig.testTime = 100;
  rig._captureSample();
  assert.equal(rig.recorder.count, 2);
  assert.equal(rig.recording, false, 'recording stops exactly on the final retained sample');
  assert.equal(rig.recordingEnd.model.neuralTimeMs, 100);
  assert.equal(rig.testEvents.at(-1).details.reason, 'row-cap');
  rig.testTime = 200;
  const saved = rig.stopRecording({ format: 'bundle' });
  assert.equal(saved.hitCap, true);
  assert.equal(JSON.parse(saved.content).end.model.neuralTimeMs, 100);
  assert.equal(rig.clearRecording(), true);
  assert.equal(rig.recordingStart, null);
  assert.equal(rig.recordingEnd, null);
  assert.equal(rig.startRecording(), true, 'explicit cleanup enables the next recording');
  assert.equal(rig.recordingStart.model.neuralTimeMs, 200);
  console.log('PASS row-cap stops capture at the exact boundary and explicit cleanup resets both manifests');
}

{
  const rig = recordingRig();
  rig.startRecording();
  assert.deepEqual(rig.stopRecording(), { rows: 0, content: null });
  assert.equal(rig.startRecording(), true, 'a genuinely empty stopped recording does not block the next one');
  assert.equal(rig.recordingEnd, null);
  console.log('PASS empty recordings restart safely without carrying an old end manifest');
}
