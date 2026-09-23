// recording.js — time-series capture of what the simulation actually did.
//
// Everything the dashboard shows is live-only: you can watch a giant-fiber
// spike happen and then it is gone. For any use beyond watching — comparing
// two conditions, checking whether a change in the model moved a rate,
// plotting a response against a stimulus — the run has to leave a record.
// This is that record: a plain CSV of the real measured quantities, sampled
// at a fixed, stated rate.
//
// Recording is strictly an observer: it reads state that already exists and
// writes nothing back, so a run with recording on and a run with it off are
// the same run. The schema below is the contract — app.js hands over a plain
// object per sample and the column order is taken from here, so a renamed or
// reordered field cannot silently shift a column under an existing analysis.

// Sampling rate. Deliberately its own constant rather than riding on the
// dashboard's refresh (which exists for human eyes and may be retuned):
// changing how often a number is drawn must not silently change what a
// recorded dataset means. 20 Hz resolves behavioural transitions and escape
// bouts comfortably while keeping a long session's file manageable.
export const RECORDING_HZ = 20;

// ~30 minutes at 20 Hz. A cap rather than unbounded growth, so a recording
// left running overnight cannot quietly eat the renderer's memory; the UI
// reports when it stops.
export const MAX_ROWS = RECORDING_HZ * 60 * 30;

// The canonical schema. Column order here IS the CSV column order.
export const RECORDING_COLUMNS = [
  // Simulated seconds, which is the fly's own elapsed time: the clock stops
  // while the simulation is paused, so this stays continuous across a pause
  // instead of jumping over one. `wall_clock` keeps real time alongside it.
  { key: 't', label: 't_sim_s' },
  { key: 'clock', label: 'wall_clock' },
  // Respawn builds a fresh LIFSim — a different individual with the same
  // species-typical wiring. A recording that spans one would otherwise pool
  // two animals into one undifferentiated table; this column lets any analysis
  // split them apart afterwards instead of having to know it happened.
  { key: 'individual', label: 'individual_n' },
  // --- provenance needed to compare or reproduce a neural trial ---
  { key: 'modelVersion', label: 'model_version' },
  { key: 'neuralSeed', label: 'neural_seed_u32' },
  { key: 'brainFingerprint', label: 'brain_bundle_sha256_16' },
  { key: 'vncFingerprint', label: 'vnc_bundle_sha256_16' },
  // This is intentionally a label rather than a biological measurement: it
  // records the cross-specimen interface that was assumed for this run.
  { key: 'brainVncBridge', label: 'brain_vnc_bridge' },
  // Optional learning experiments change an explicit, bounded copy of an
  // anatomical subset. These columns make it impossible to pool that trial
  // with a fixed-connectome run by accident.
  { key: 'plasticityMode', label: 'plasticity_mode' },
  { key: 'plasticityProtocol', label: 'plasticity_protocol' },
  { key: 'plasticityEligibleEdges', label: 'plasticity_eligible_edges' },
  { key: 'plasticityUpdates', label: 'plasticity_updates_total' },
  { key: 'plasticityMeanAbsRelChange', label: 'plasticity_mean_abs_relative_change' },
  // --- real measured firing rates, Hz per neuron in each named population ---
  { key: 'ratePop', label: 'hz_population_all' },
  { key: 'rateGF', label: 'hz_gf_dnp01' },
  { key: 'rateLoom', label: 'hz_loom_lc4_lplc2' },
  { key: 'rateSens', label: 'hz_sensory_combined' },
  // The sensory partners are Johnston's-organ neurons; their two physiological
  // populations are recorded separately so a stimulus can be traced to the
  // neurons it actually reached.
  { key: 'rateJOAuditory', label: 'hz_jo_auditory_ab' },
  { key: 'rateJOWind', label: 'hz_jo_wind_gravity_cde' },
  // FlyWire hot/cold thermosensory cells (thermo extension); 0 without it
  { key: 'rateThermoHot', label: 'hz_thermo_hot_cells' },
  { key: 'rateThermoCold', label: 'hz_thermo_cold_cells' },
  { key: 'rateThermoRelayHot', label: 'hz_thermo_relays_hot_fed' },
  { key: 'rateThermoRelayCold', label: 'hz_thermo_relays_cold_fed' },
  { key: 'rateFwd', label: 'hz_walk_dnp09' },
  { key: 'rateGroom', label: 'hz_groom_dng11' },
  { key: 'rateMDN', label: 'hz_backward_mdn' },
  { key: 'rateDNaL', label: 'hz_steer_left_dna' },
  { key: 'rateDNaR', label: 'hz_steer_right_dna' },
  { key: 'rateEscW', label: 'hz_escape_wing' },
  { key: 'rateAscend', label: 'hz_ascending' },
  { key: 'rateDA', label: 'syn_per_s_dopamine' },
  { key: 'rateModOther', label: 'syn_per_s_ser_oct' },
  // --- the sensory drive going IN, so a response can be read against it ---
  { key: 'loomL', label: 'in_loom_left' },
  { key: 'loomR', label: 'in_loom_right' },
  { key: 'airPuff', label: 'in_airpuff' },
  { key: 'windDrive', label: 'in_wind_to_jo_cde' },
  { key: 'soundDrive', label: 'in_sound_to_jo_ab' },
  { key: 'thermoHotDrive', label: 'in_temp_to_hot_cells' },
  { key: 'thermoColdDrive', label: 'in_temp_to_cold_cells' },
  { key: 'visionMotionL', label: 'in_vision_motion_left' },
  { key: 'visionMotionR', label: 'in_vision_motion_right' },
  // --- body and behaviour ---
  { key: 'state', label: 'state' },
  { key: 'speed', label: 'speed_pt_s' },
  { key: 'alt', label: 'altitude_0_1' },
  { key: 'heading', label: 'heading_rad' },
  { key: 'posX', label: 'pos_x' },
  { key: 'posY', label: 'pos_y' },
  { key: 'health', label: 'health_pct' },
  // --- environment as set by the user, so a condition is reconstructable ---
  // Both, deliberately: the slider's mean alone would make a gradient run look
  // identical to a flat one in the data, and the temperature that actually
  // acted on her is the local one at her position.
  { key: 'tempC', label: 'env_temp_mean_c' },
  { key: 'tempLocal', label: 'env_temp_local_c' },
  { key: 'tempGradient', label: 'env_temp_gradient_span_c' },
  { key: 'windKmh', label: 'env_wind_kmh' },
  { key: 'gravity', label: 'env_gravity_x' },
  { key: 'oxygenPct', label: 'env_oxygen_pct' },
  { key: 'wetness', label: 'env_wetness_0_1' },
  { key: 'smellPct', label: 'env_scent_0_1' },
  { key: 'circadian', label: 'env_circadian_0_1' },
  // Additive session linkage: preserve every pre-1.4 column position.
  { key: 'sessionId', label: 'session_id' },
  { key: 'neuralRun', label: 'neural_run_n' },
  { key: 'neuralTimeMs', label: 'neural_time_ms' },
  { key: 'eventSequence', label: 'latest_intervention_sequence' },
  // Additive (2.0): taste and antennal-grooming pathways, and the experimental
  // conditions (virtual genetics, pharmacology, simulation speed) a row was
  // recorded under. Every earlier column keeps its position.
  { key: 'rateSugar', label: 'hz_sugar_water_grn' },
  { key: 'rateBitter', label: 'hz_bitter_grn' },
  { key: 'rateTasteRelay', label: 'hz_taste_relays' },
  { key: 'rateProboscis', label: 'hz_proboscis_mn' },
  { key: 'rateIngestion', label: 'hz_ingestion_mn' },
  { key: 'rateJOF', label: 'hz_jo_f_grooming' },
  { key: 'rateGroomRelay', label: 'hz_grooming_relays' },
  { key: 'rateDNg12', label: 'hz_head_groom_dng12' },
  { key: 'sugarTaste', label: 'in_sugar_to_grn' },
  { key: 'bitterTaste', label: 'in_bitter_to_grn' },
  { key: 'antennaDust', label: 'in_antenna_dust_to_jo_f' },
  { key: 'proboscisExtension', label: 'proboscis_extension_0_1' },
  { key: 'groomMode', label: 'groom_mode' },
  { key: 'silencedCells', label: 'cond_silenced_cells' },
  { key: 'genetics', label: 'cond_genetics' },
  { key: 'pharmacology', label: 'cond_pharmacology' },
  { key: 'simSpeed', label: 'cond_sim_speed_x' },
];

function formatValue(v) {
  if (v === null || v === undefined) return '';
  if (typeof v === 'number') {
    if (!Number.isFinite(v)) return '';
    return String(Math.round(v * 10000) / 10000);
  }
  const s = String(v);
  return /[",\r\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
}

export class Recorder {
  constructor(columns = RECORDING_COLUMNS, maxRows = MAX_ROWS) {
    this.columns = columns;
    this.maxRows = maxRows;
    this.rows = [];
  }

  get full() { return this.rows.length >= this.maxRows; }
  get count() { return this.rows.length; }

  // Returns false once the cap is reached, so the caller can stop and say so
  // rather than silently dropping samples and leaving a dataset with an
  // unexplained gap at the end.
  //
  // Each sample is joined into its finished line here rather than kept as an
  // array of cells. A full 30-minute buffer is ~34 values a row; holding those
  // as separate strings costs several times what the text itself does, and the
  // buffer lives in the renderer alongside the simulation.
  add(sample) {
    if (this.full) return false;
    let line = '';
    for (let i = 0; i < this.columns.length; i++) {
      if (i) line += ',';
      line += formatValue(sample[this.columns[i].key]);
    }
    this.rows.push(line);
    return true;
  }

  clear() { this.rows = []; }

  toCSV() {
    const header = this.columns.map((c) => c.label).join(',');
    return `${header}\n${this.rows.join('\n')}\n`;
  }
}
