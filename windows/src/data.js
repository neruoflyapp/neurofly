// data.js — Node-only data loading (fs). Kept out of sim.js so the simulation
// module imports cleanly in the Electron renderer, which has no fs: there the
// main process reads the JSON and hands it over through the preload bridge.

import fs from 'node:fs';
import path from 'node:path';
import { createHash } from 'node:crypto';
import { fileURLToPath } from 'node:url';
import { auditBrainCircuit } from './provenance.js';
import { validateLocomotorCircuit } from './locomotor.js';
import { SPECIMENS, specimenCompatibility } from './specimen.js';

const HERE = path.dirname(fileURLToPath(import.meta.url));

export function findDataDir() {
  const candidates = [
    path.join(HERE, '..', '..', 'data'),   // repo root, next to windows/
    path.join(HERE, '..', 'data'),         // data copied into windows/
    path.join(process.cwd(), 'data'),
    path.join(process.cwd(), '..', 'data'),
  ];
  return candidates.find((d) => fs.existsSync(path.join(d, 'circuit.json'))) || null;
}

export function loadBrainData(dir = findDataDir()) {
  if (!dir) return null;
  let points, circuit, rawPoints, rawCircuit;
  try {
    rawPoints = fs.readFileSync(path.join(dir, 'brain_points.json'), 'utf8');
    rawCircuit = fs.readFileSync(path.join(dir, 'circuit.json'), 'utf8');
    points = JSON.parse(rawPoints);
    circuit = JSON.parse(rawCircuit);
  } catch (error) {
    console.warn(`Unable to load fly data from ${dir}: ${error.message}`);
    return null;
  }
  const audit = auditBrainCircuit(circuit);
  if (!audit.valid) {
    throw new Error(`Invalid FlyWire circuit: ${audit.errors.slice(0, 3).join('; ')}`);
  }
  // Older bundles remain usable. A present but invalid nerve-cord dataset
  // is a load error, never a silent switch back to scripted locomotion.
  const locomotorPath = path.join(dir, 'locomotor_circuit.json');
  let locomotor = null;
  let rawLocomotor = '';
  if (fs.existsSync(locomotorPath)) {
    try {
      rawLocomotor = fs.readFileSync(locomotorPath, 'utf8');
      locomotor = JSON.parse(rawLocomotor);
    }
    catch (error) { throw new Error(`Invalid locomotor dataset ${locomotorPath}: ${error.message}`); }
    if (!validateLocomotorCircuit(locomotor)) {
      throw new Error('Invalid MaleCNS locomotor circuit');
    }
  }
  // A raw-file SHA-256 identifies the exact exported input bundle. It is not
  // used to authorize anything; it makes two recorded runs auditable even if
  // their human-readable source names are identical.
  const sha256 = (value) => createHash('sha256').update(value, 'utf8').digest('hex');
  const brainCircuitSHA256 = sha256(rawCircuit);
  const locomotorSHA256 = rawLocomotor ? sha256(rawLocomotor) : null;
  // Git may check the pretty-printed cord file out with CRLF line endings; the
  // decoder is locked to its content with LF endings, the published bytes.
  const locomotorContentSHA256 = rawLocomotor ? sha256(rawLocomotor.replace(/\r\n/g, '\n')) : null;
  const decoder = locomotor ? attachRhythmDecoder(dir, locomotor, locomotorContentSHA256, sha256) : { status: 'absent', sha256: null, summary: null };
  const annotation = attachCellAnnotations(dir, circuit, brainCircuitSHA256, sha256);
  // After the annotation: that one is keyed by circuit.json's own indices.
  const thermo = attachThermoExtension(dir, circuit, brainCircuitSHA256, sha256);
  // After the thermo extension: its indices are part of what this one extends.
  const sensory = attachSensoryExtension(dir, thermo.circuit || circuit, brainCircuitSHA256, thermo.sha256, sha256);
  const provenance = {
    specimens: {
      brain: SPECIMENS['fafb-v783'],
      nerveCord: locomotor ? SPECIMENS['malecns-v1'] : null,
      compatibility: locomotor ? specimenCompatibility('fafb-v783', 'malecns-v1') : null,
      body: { status: 'modeled', sex: 'unspecified', measuredWholeAnimal: false },
    },
    brainPointsSHA256: sha256(rawPoints),
    brainCircuitSHA256,
    locomotorSHA256,
    locomotorContentSHA256,
    rhythmDecoderSHA256: decoder.sha256,
    rhythmDecoderStatus: decoder.status,
    rhythmDecoder: decoder.summary,
    annotationSHA256: annotation.sha256,
    annotationStatus: annotation.status,
    sensoryGroupCounts: annotation.sensoryGroupCounts,
    thermoExtensionSHA256: thermo.sha256,
    thermoExtensionStatus: thermo.status,
    thermoExtension: thermo.summary,
    sensoryExtensionSHA256: sensory.sha256,
    sensoryExtensionStatus: sensory.status,
    sensoryExtension: sensory.summary,
    // `brainAudit` describes circuit.json exactly as published (the file the
    // SHA-256 above identifies). The running circuit may be larger by the
    // extensions; `thermoExtension` and `sensoryExtension` say by how much.
    brainAudit: audit,
  };
  // Measured anatomy of the complete FlyWire brain (etl_pathways.mjs): how
  // directly aversive and thermal sensors reach integrative centres. Read for
  // the sentience criteria panel; nothing in the simulation depends on it.
  let pathways = null;
  const pathwaysFile = path.join(dir, 'sentience_pathways.json');
  if (fs.existsSync(pathwaysFile)) {
    try { pathways = JSON.parse(fs.readFileSync(pathwaysFile, 'utf8')); } catch { pathways = null; }
  }
  return { points, circuit: sensory.circuit || thermo.circuit || circuit, locomotor, provenance, pathways };
}

// Optional real gustatory and antennal-grooming pathways
// (etl_sensory_extension.mjs): sugar/water and bitter receptor neurons, the
// proboscis and ingestion motor neurons, JO-F grooming mechanosensors, DNg12,
// and the neurons on the strongest paths between them. Appended after the
// thermo extension, and accepted only for exactly that circuit.json and
// thermo_extension.json; the merged result must pass the structural audit.
function attachSensoryExtension(dir, running, circuitSHA256, thermoSHA256, sha256) {
  const file = path.join(dir, 'sensory_extension.json');
  const none = (status, hash = null) => ({ status, sha256: hash, summary: null });
  if (!fs.existsSync(file)) return none('absent');
  let raw, ext;
  try {
    raw = fs.readFileSync(file, 'utf8');
    ext = JSON.parse(raw);
  } catch (error) {
    console.warn(`sensory_extension.json unreadable, ignored: ${error.message}`);
    return none('unreadable');
  }
  const hash = sha256(raw);
  if (ext.circuitSHA256 !== circuitSHA256 || ext.thermoExtensionSHA256 !== thermoSHA256
    || ext.baseNeurons !== running.neurons.length) {
    console.warn('sensory_extension.json was generated for a different circuit/thermo extension; ignored — rerun etl_sensory_extension.mjs');
    return none('stale', hash);
  }
  const tags = Array.isArray(ext.circuitTags) ? ext.circuitTags : [];
  if (!tags.every((t) => String(running.neurons[t.index]?.id) === String(t.id))) {
    console.warn('sensory_extension.json tags do not line up with the running circuit; ignored');
    return none('misaligned', hash);
  }
  const merged = {
    ...running,
    neurons: running.neurons.concat(ext.neurons || []),
    edges: running.edges.concat(ext.edges || []),
  };
  const audit = auditBrainCircuit(merged);
  if (!audit.valid) {
    console.warn(`sensory_extension.json fails the structural audit, ignored: ${audit.errors.slice(0, 2).join('; ')}`);
    return none('invalid', hash);
  }
  for (const t of tags) {
    const tag = { extension: t.extension };
    for (const f of ['sensoryGroup', 'motorGroup', 'pathRole']) if (t[f]) tag[f] = t[f];
    running.neurons[t.index].extensionTag = tag;
  }
  const added = ext.neurons || [];
  const count = (pred) => added.filter(pred).length;
  const summary = {
    addedNeurons: added.length,
    addedEdges: (ext.edges || []).length,
    sugarCells: count((nr) => nr.sensoryGroup === 'sugar'),
    bitterCells: count((nr) => nr.sensoryGroup === 'bitter'),
    proboscisMotorNeurons: count((nr) => nr.motorGroup === 'proboscis'),
    ingestionMotorNeurons: count((nr) => nr.motorGroup === 'ingestion'),
    tasteRelays: count((nr) => nr.extension === 'taste' && nr.pathRole),
    joFCells: count((nr) => nr.sensoryGroup === 'jof'),
    dng12: count((nr) => nr.motorGroup === 'dng12'),
    groomingRelays: count((nr) => nr.extension === 'grooming' && nr.pathRole),
    taggedInRunningCircuit: tags.length,
    runningNeurons: merged.neurons.length,
    runningEdges: merged.edges.length,
  };
  return { status: 'attached', sha256: hash, summary, circuit: merged };
}

// Optional real thermosensory extension (etl_thermo_extension.mjs): FlyWire's
// hot and cold cells plus the layer of neurons carrying their strongest
// two-synapse paths into the circuit. Appended after circuit.json's neurons,
// so every existing index, and every baseline drawn from the seeded PRNG for
// them, is unchanged. Accepted only for this exact circuit.json; the merged
// result must pass the same structural audit, or nothing is merged.
function attachThermoExtension(dir, circuit, circuitSHA256, sha256) {
  const file = path.join(dir, 'thermo_extension.json');
  const none = (status, hash = null) => ({ status, sha256: hash, summary: null });
  if (!fs.existsSync(file)) return none('absent');
  let raw, ext;
  try {
    raw = fs.readFileSync(file, 'utf8');
    ext = JSON.parse(raw);
  } catch (error) {
    console.warn(`thermo_extension.json unreadable, ignored: ${error.message}`);
    return none('unreadable');
  }
  const hash = sha256(raw);
  if (ext.circuitSHA256 !== circuitSHA256 || ext.baseNeurons !== circuit.neurons.length) {
    console.warn('thermo_extension.json was generated for a different circuit.json; ignored — rerun etl_thermo_extension.mjs');
    return none('stale', hash);
  }
  const tags = Array.isArray(ext.circuitTags) ? ext.circuitTags : [];
  if (!tags.every((t) => String(circuit.neurons[t.index]?.id) === String(t.id))) {
    console.warn('thermo_extension.json circuit tags do not line up with circuit.json; ignored');
    return none('misaligned', hash);
  }
  const merged = {
    ...circuit,
    neurons: circuit.neurons.concat(ext.neurons || []),
    edges: circuit.edges.concat(ext.edges || []),
  };
  const audit = auditBrainCircuit(merged);
  if (!audit.valid) {
    console.warn(`thermo_extension.json fails the structural audit, ignored: ${audit.errors.slice(0, 2).join('; ')}`);
    return none('invalid', hash);
  }
  for (const t of tags) circuit.neurons[t.index].thermoGroup = t.thermoGroup;
  // A new object, never circuit.json's mutated in place: audits are cached
  // per object, and the published circuit's audit must stay its own.
  const added = ext.neurons || [];
  const summary = {
    addedNeurons: added.length,
    addedEdges: (ext.edges || []).length,
    hotCells: added.filter((nr) => nr.thermoGroup === 'hot').length + tags.filter((t) => t.thermoGroup === 'hot').length,
    coldCells: added.filter((nr) => nr.thermoGroup === 'cold').length + tags.filter((t) => t.thermoGroup === 'cold').length,
    relayNeurons: added.filter((nr) => nr.layer === 1).length,
    runningNeurons: merged.neurons.length,
    runningEdges: merged.edges.length,
  };
  return { status: 'attached', sha256: hash, summary, circuit: merged };
}

// Optional real FlyWire cell types (etl_cell_annotations.mjs). Merged onto the
// neuron objects as `cellType` and, for sensory partners, `sensoryGroup`.
// It is keyed by circuit index, so it is only accepted when it was generated
// against this exact circuit.json AND every row's FlyWire id matches — a
// stale annotation would otherwise attach cell types to the wrong neurons,
// which is worse than having none. Absent or rejected, the model falls back
// to treating all sensory partners as one population, and says so.
// The stepping rules' premotor decoder (tools/derive-rhythm-decoder.mjs):
// derived from this exact nerve-cord file, so a decoder for any other file is
// ignored and the cord runs without stepping rules — never with a mismatch.
function attachRhythmDecoder(dir, locomotor, locomotorContentSHA256, sha256) {
  const file = path.join(dir, 'rhythm_decoder.json');
  if (!fs.existsSync(file)) return { status: 'absent', sha256: null, summary: null };
  let raw, decoder;
  try {
    raw = fs.readFileSync(file, 'utf8');
    decoder = JSON.parse(raw);
  } catch (error) {
    console.warn(`rhythm_decoder.json unreadable, ignored: ${error.message}`);
    return { status: 'unreadable', sha256: null, summary: null };
  }
  if (decoder.locomotorContentSHA256 !== locomotorContentSHA256) {
    console.warn('rhythm_decoder.json was derived for a different locomotor_circuit.json; ignored — rerun tools/derive-rhythm-decoder.mjs');
    return { status: 'stale', sha256: sha256(raw), summary: null };
  }
  locomotor.rhythmDecoder = decoder;
  return { status: 'attached', sha256: sha256(raw), summary: decoder.summary || null };
}

function attachCellAnnotations(dir, circuit, circuitSHA256, sha256) {
  const file = path.join(dir, 'circuit_annotations.json');
  if (!fs.existsSync(file)) return { status: 'absent', sha256: null, sensoryGroupCounts: null };
  let raw, ann;
  try {
    raw = fs.readFileSync(file, 'utf8');
    ann = JSON.parse(raw);
  } catch (error) {
    console.warn(`circuit_annotations.json unreadable, ignored: ${error.message}`);
    return { status: 'unreadable', sha256: null, sensoryGroupCounts: null };
  }
  if (ann.circuitSHA256 !== circuitSHA256) {
    console.warn('circuit_annotations.json was generated for a different circuit.json; ignored — rerun etl_cell_annotations.mjs');
    return { status: 'stale', sha256: sha256(raw), sensoryGroupCounts: null };
  }
  const rows = Array.isArray(ann.neurons) ? ann.neurons : [];
  const idsMatch = rows.length === circuit.neurons.length
    && rows.every((r, i) => r.index === i && String(circuit.neurons[i].id) === r.id);
  if (!idsMatch) {
    console.warn('circuit_annotations.json does not line up with circuit.json neuron ids; ignored');
    return { status: 'misaligned', sha256: sha256(raw), sensoryGroupCounts: null };
  }
  rows.forEach((r, i) => {
    const neuron = circuit.neurons[i];
    if (r.primaryType) neuron.cellType = r.primaryType;
    if (r.sensoryGroup) neuron.sensoryGroup = r.sensoryGroup;
  });
  return { status: 'attached', sha256: sha256(raw), sensoryGroupCounts: ann.sensoryGroupCounts || null };
}
