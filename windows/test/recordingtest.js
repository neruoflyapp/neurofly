// recordingtest.js — the CSV capture of a run.
//   node test/recordingtest.js
//
// A recorded dataset outlives the session that produced it and may well be
// read by a script nobody has written yet, so the parts that a later analysis
// silently depends on are pinned here: that the column order is the schema's
// and not the caller's object order, that a missing value stays empty rather
// than becoming a zero somebody later averages, and that the row cap reports
// itself instead of quietly truncating.

import { Recorder, RECORDING_COLUMNS, RECORDING_HZ, MAX_ROWS } from '../src/recording.js';

let failures = 0;
function check(name, fn) {
  const [ok, describe] = fn();
  if (!ok) failures++;
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}: ${describe}`);
}

check('column order follows the schema, not the order of the sample object', () => {
  const r = new Recorder();
  // deliberately scrambled relative to RECORDING_COLUMNS
  r.add({ health: 100, t: 1.5, rateGF: 12.25, state: 'walking' });
  const [header, row] = r.toCSV().trim().split('\n');
  const cols = header.split(',');
  const vals = row.split(',');
  const tOK = vals[cols.indexOf('t_sim_s')] === '1.5';
  const gfOK = vals[cols.indexOf('hz_gf_dnp01')] === '12.25';
  const stOK = vals[cols.indexOf('state')] === 'walking';
  return [tOK && gfOK && stOK && cols.length === RECORDING_COLUMNS.length,
    `${cols.length} columns, values landed under their own headers`];
});

check('a value that was never measured stays empty, never becomes 0', () => {
  const r = new Recorder();
  r.add({ t: 0 });
  const [header, row] = r.toCSV().trim().split('\n');
  const i = header.split(',').indexOf('hz_gf_dnp01');
  const cell = row.split(',')[i];
  return [cell === '', `absent rate serialised as "${cell}" (empty), not "0"`];
});

check('trial provenance stays attached to each recorded sample', () => {
  const r = new Recorder();
  r.add({
    t: 0,
    modelVersion: '1.2.0',
    neuralSeed: 424242,
    brainFingerprint: '2c25cae5671eedcd',
    vncFingerprint: 'abc123',
    brainVncBridge: 'modeled same-type/side population-rate interface',
  });
  const [header, row] = r.toCSV().trim().split('\n');
  const cols = header.split(',');
  const values = row.split(',');
  const value = (label) => values[cols.indexOf(label)];
  const bridge = row.includes('modeled same-type/side population-rate interface');
  const ok = value('model_version') === '1.2.0' && value('neural_seed_u32') === '424242'
    && value('brain_bundle_sha256_16') === '2c25cae5671eedcd' && bridge;
  return [ok, `model ${value('model_version')}, seed ${value('neural_seed_u32')}, bridge present=${bridge}`];
});

// The stimulus routing was corrected (wind -> JO-C/D/E, sound -> JO-A/B,
// temperature -> real hot/cold cells). A recording must show which neurons a
// stimulus actually reached, or a later analysis cannot tell the two
// generations of runs apart.
check('sensory routing and thermosensor columns are recorded under their own names', () => {
  const r = new Recorder();
  r.add({ t: 0, rateJOAuditory: 9.5, rateJOWind: 120.25, rateThermoHot: 90.5, rateThermoCold: 0,
    rateThermoRelayHot: 11.5, rateThermoRelayCold: 17.75, windDrive: 0.5, soundDrive: 0.25,
    thermoHotDrive: 1, thermoColdDrive: 0 });
  const [header, row] = r.toCSV().trim().split('\n');
  const cols = header.split(',');
  const vals = row.split(',');
  const expect = {
    hz_jo_auditory_ab: '9.5', hz_jo_wind_gravity_cde: '120.25', hz_thermo_hot_cells: '90.5',
    hz_thermo_cold_cells: '0', hz_thermo_relays_hot_fed: '11.5', hz_thermo_relays_cold_fed: '17.75',
    in_wind_to_jo_cde: '0.5', in_sound_to_jo_ab: '0.25', in_temp_to_hot_cells: '1', in_temp_to_cold_cells: '0',
  };
  const wrong = Object.entries(expect).filter(([label, v]) => vals[cols.indexOf(label)] !== v).map(([label]) => label);
  return [wrong.length === 0, wrong.length ? `missing or misplaced: ${wrong.join(', ')}` : `${Object.keys(expect).length} columns present, values under their own headers`];
});

check('non-finite values do not leak NaN/Infinity into the file', () => {
  const r = new Recorder();
  r.add({ t: NaN, rateGF: Infinity, speed: -Infinity });
  const row = r.toCSV().trim().split('\n')[1];
  return [!/NaN|Infinity/.test(row), `row contains no NaN/Infinity tokens`];
});

check('text containing a comma cannot break the column structure', () => {
  const r = new Recorder();
  r.add({ t: 0, state: 'walking, then flying' });
  const [header, row] = r.toCSV().trim().split('\n');
  // a naive split would now yield more fields than there are columns
  const naive = row.split(',').length;
  const quoted = row.includes('"walking, then flying"');
  return [quoted && naive === RECORDING_COLUMNS.length + 1,
    `value quoted (${quoted}); a naive comma split sees ${naive} fields, so quoting is what protects it`];
});

check('the row cap refuses further rows rather than silently dropping them', () => {
  const r = new Recorder(RECORDING_COLUMNS, 3);
  const results = [r.add({ t: 1 }), r.add({ t: 2 }), r.add({ t: 3 }), r.add({ t: 4 })];
  return [results.join(',') === 'true,true,true,false' && r.count === 3 && r.full,
    `add() returned ${results.join(', ')} — the caller can see the cap was hit`];
});

check('clear empties the buffer but keeps the schema', () => {
  const r = new Recorder();
  r.add({ t: 1 });
  r.clear();
  const lines = r.toCSV().trim().split('\n');
  return [r.count === 0 && lines.length === 1 && lines[0].startsWith('t_sim_s,'),
    'header survives, rows gone'];
});

check('the documented sampling rate and cap are consistent with each other', () => {
  const minutes = MAX_ROWS / RECORDING_HZ / 60;
  return [RECORDING_HZ > 0 && Number.isInteger(MAX_ROWS) && minutes >= 10 && minutes <= 120,
    `${RECORDING_HZ} Hz, cap ${MAX_ROWS} rows = ${minutes.toFixed(0)} min of continuous recording`];
});

check('session linkage keeps its columns when later telemetry is appended', () => {
  const r = new Recorder();
  r.add({ sessionId: 'session-test', neuralRun: 2, neuralTimeMs: 50, eventSequence: 9 });
  const [header, row] = r.toCSV().trim().split('\n');
  const columns = header.split(','), values = row.split(',');
  const start = columns.indexOf('session_id');
  return [start >= 0 && columns.slice(start, start + 4).join(',') === 'session_id,neural_run_n,neural_time_ms,latest_intervention_sequence'
    && values.slice(start, start + 4).join(',') === 'session-test,2,50,9', 'session and run boundaries survive CSV export, including the appended taste/grooming fields'];
});

console.log(failures === 0 ? 'ALL RECORDING TESTS PASS' : `${failures} FAILURES`);
process.exit(failures === 0 ? 0 : 1);
