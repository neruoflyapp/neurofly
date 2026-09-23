// etl_cell_annotations.mjs — attach each circuit neuron's real FlyWire
// classification and cell type, WITHOUT modifying data/circuit.json.
//
//   node etl_cell_annotations.mjs [rawDir] [dataDir]
//     rawDir  default ./raw_flywire   (classification.csv.gz, consolidated_cell_types.csv.gz)
//     dataDir default ./data
//   writes  dataDir/circuit_annotations.json
//
// Why a separate file: circuit.json is the published bundle and its
// counts are quoted in both READMEs, so it stays byte-identical. The partner
// neurons in circuit.json carry only their FlyWire super_class ("sensory",
// "central", ...) in `type`, which hid a real error: the 199 "sensory"
// partners the model used as a catch-all touch/wind/odour/pain channel are
// almost all Johnston's-organ neurons of the antenna — 176 auditory (JO-A/B,
// vibration-sensitive: near-field sound) and 18 wind/gravity (JO-C/D/E,
// deflection-sensitive). Kamikouchi et al. 2009 and Yorozu et al. 2009
// (Nature 458) establish that split physiologically; FlyWire's own sub_class
// column encodes it, and this script carries it through so the simulation can
// route each stimulus to the neurons that actually sense it.
//
// The output records the SHA-256 of the circuit.json it was generated
// against. The loader refuses a mismatched annotation instead of silently
// attaching cell types to the wrong neuron indices.

import fs from 'node:fs';
import path from 'node:path';
import zlib from 'node:zlib';
import crypto from 'node:crypto';

const rawDir = process.argv[2] || 'raw_flywire';
const dataDir = process.argv[3] || 'data';

const sha256 = (buf) => crypto.createHash('sha256').update(buf).digest('hex');

// Minimal RFC-4180 field splitter: FlyWire's additional_type(s) column can be
// quoted and contain commas.
function splitCSVLine(line) {
  const out = [];
  let cur = '', q = false;
  for (let i = 0; i < line.length; i++) {
    const ch = line[i];
    if (q) {
      if (ch === '"' && line[i + 1] === '"') { cur += '"'; i++; }
      else if (ch === '"') q = false;
      else cur += ch;
    } else if (ch === '"') q = true;
    else if (ch === ',') { out.push(cur); cur = ''; }
    else cur += ch;
  }
  out.push(cur);
  return out.map((s) => s.trim());
}

function readGzCSV(file) {
  const raw = fs.readFileSync(path.join(rawDir, file));
  const lines = zlib.gunzipSync(raw).toString('utf8').split(/\r?\n/).filter(Boolean);
  const header = splitCSVLine(lines[0]);
  const col = Object.fromEntries(header.map((h, i) => [h, i]));
  return { sha: sha256(raw), col, rows: lines.slice(1).map(splitCSVLine) };
}

const circuitRaw = fs.readFileSync(path.join(dataDir, 'circuit.json'));
const circuit = JSON.parse(circuitRaw.toString('utf8'));

const cls = readGzCSV('classification.csv.gz');
const types = readGzCSV('consolidated_cell_types.csv.gz');

const classById = new Map();
for (const r of cls.rows) {
  classById.set(r[cls.col.root_id], {
    flow: r[cls.col.flow] || null,
    superClass: r[cls.col.super_class] || null,
    class: r[cls.col.class] || null,
    subClass: r[cls.col.sub_class] || null,
  });
}
const typeById = new Map();
for (const r of types.rows) typeById.set(r[types.col.root_id], r[types.col.primary_type] || null);

// Grouping follows FlyWire's own sub_class, not a guess from type names.
function sensoryGroupOf(c) {
  if (!c || c.superClass !== 'sensory') return null;
  if (c.subClass === 'auditory') return 'jo_auditory';
  if (c.subClass === 'wind_gravity') return 'jo_wind_gravity';
  return 'other_sensory';
}

let missing = 0;
const neurons = circuit.neurons.map((n, index) => {
  const c = classById.get(String(n.id));
  if (!c) missing++;
  return {
    index,
    id: String(n.id),
    primaryType: typeById.get(String(n.id)) || null,
    superClass: c?.superClass ?? null,
    class: c?.class ?? null,
    subClass: c?.subClass ?? null,
    sensoryGroup: sensoryGroupOf(c),
  };
});

const groupCounts = {};
for (const n of neurons) if (n.sensoryGroup) groupCounts[n.sensoryGroup] = (groupCounts[n.sensoryGroup] || 0) + 1;

const out = {
  source: 'FlyWire FAFB v783 classification.csv + consolidated_cell_types.csv',
  generatedBy: 'etl_cell_annotations.mjs',
  circuitSHA256: sha256(circuitRaw),
  inputSHA256: { classification: cls.sha, consolidatedCellTypes: types.sha },
  sensoryGroups: {
    jo_auditory: 'Johnston\'s organ JO-A/B: vibration-sensitive, near-field sound (Kamikouchi et al. 2009; Yorozu et al. 2009)',
    jo_wind_gravity: 'Johnston\'s organ JO-C/D/E: deflection-sensitive, wind and gravity (Kamikouchi et al. 2009; Yorozu et al. 2009)',
    other_sensory: 'any other FlyWire sensory sub_class present in the subset',
  },
  sensoryGroupCounts: groupCounts,
  unclassified: missing,
  neurons,
};

const target = path.join(dataDir, 'circuit_annotations.json');
fs.writeFileSync(target, `${JSON.stringify(out)}\n`);
console.log(`wrote ${target}: ${neurons.length} neurons, ${missing} without a classification row`);
console.log('sensory groups:', JSON.stringify(groupCounts));
