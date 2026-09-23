// labels.js — the words and colours shared by the HUD, the explanation feed
// and the panels, so the same thing is always called the same.

import { t } from '../i18n.js';

export function behaviourOf(snap) {
  const f = snap.fly;
  if (snap.dead) return { key: 'dead', label: t('Dead'), icon: 'close', alarm: true };
  if (f.state === 'flying') return { key: 'flying', label: t('Flying'), icon: 'wind', alarm: snap.rates.gf > 2 };
  if (f.state === 'feeding') return { key: 'feeding', label: t('Feeding'), icon: 'drop' };
  if (f.state === 'grooming') return f.groomMode === 'head'
    ? { key: 'headGroom', label: t('Head grooming'), icon: 'groom' } : { key: 'legGroom', label: t('Leg rubbing'), icon: 'groom' };
  if (f.backward) return { key: 'backward', label: t('Walking backward'), icon: 'repeat' };
  if (f.state === 'walking') return { key: 'walking', label: f.speed > 90 ? t('Darting') : t('Walking'), icon: 'body' };
  if (f.state === 'sleeping') return { key: 'sleeping', label: t('Sleeping'), icon: 'model' };
  if (f.proboscis > 0.5) return { key: 'per', label: t('Proboscis extended'), icon: 'drop' };
  return { key: 'idle', label: t('Resting'), icon: 'target' };
}

export const EVENT_INFO = {
  takeoff: { label: 'Escape takeoff', icon: 'bolt', groups: ['loom', 'gf'] },
  spontaneousFlight: { label: 'Took off on her own', icon: 'wind', groups: [] },
  headGrooming: { label: 'Head grooming', icon: 'groom', groups: ['joF', 'groomRelay', 'dng12'] },
  legGrooming: { label: 'Leg rubbing', icon: 'groom', groups: ['groom'] },
  backward: { label: 'Walked backward', icon: 'repeat', groups: ['mdn'] },
  walk: { label: 'Started walking', icon: 'body', groups: ['fwd'] },
  turnLeft: { label: 'Turned left', icon: 'repeat', groups: ['dna'] },
  turnRight: { label: 'Turned right', icon: 'repeat', groups: ['dna'] },
  proboscis: { label: 'Extended her proboscis', icon: 'drop', groups: ['sugar', 'tasteRelay', 'proboscis'] },
  feeding: { label: 'Started to feed', icon: 'drop', groups: ['sugar', 'tasteRelay', 'proboscis'] },
  dart: { label: 'Darted away', icon: 'loom', groups: ['loom'] },
  death: { label: 'Died', icon: 'close', groups: [] },
};

export const SOURCE_INFO = {
  loomL: { label: 'LC4/LPLC2, left eye', color: '#28d9ff' },
  loomR: { label: 'LC4/LPLC2, right eye', color: '#6fb8ff' },
  joAuditory: { label: 'JO-A/B hearing neurons', color: '#9dff5c' },
  joWind: { label: 'JO-C/D/E wind neurons', color: '#5cffc8' },
  joF: { label: 'JO-F antennal touch neurons', color: '#66ffd9' },
  thermo: { label: 'Hot and cold cells', color: '#ff7a45' },
  thermoRelay: { label: 'Thermosensory relays', color: '#e6b380' },
  sugar: { label: 'Sugar taste neurons', color: '#ffdb4d' },
  bitter: { label: 'Bitter taste neurons', color: '#7ee55a' },
  tasteRelay: { label: 'Taste relay neurons', color: '#e8c070' },
  groomRelay: { label: 'Grooming relay neurons', color: '#8ce0cf' },
  ascending: { label: 'Body feedback (ascending)', color: '#b28cff' },
  command: { label: 'Other command neurons', color: '#ff8ad8' },
  visual: { label: 'Other visual neurons', color: '#4f86c6' },
  central: { label: 'Central-brain interneurons', color: '#6f8580' },
  external: { label: 'Direct stimulation', color: '#ffffff' },
};

export const TRIGGER_INFO = {
  loomL: 'Something loomed on her left', loomR: 'Something loomed on her right', puff: 'An air puff',
  wind: 'Steady wind', sound: 'Sound nearby', hot: 'Warming', cold: 'Cooling', sugar: 'Sugar at her mouthparts',
  bitter: 'Bitter at her mouthparts', dust: 'Dust on her antennae', touch: 'A touch', stim: 'You stimulated her neurons',
};

export const LOOM_SOURCE = {
  cursor: 'your cursor', world: 'a nearby object or firefly', fire: 'the fire', vision: 'motion in her own eye', stimulus: 'a looming stimulus',
};

export const COMMAND_INFO = {
  gf: 'giant fiber (DNp01)', dnaL: 'left steering neurons (DNa01/02)', dnaR: 'right steering neurons (DNa01/02)',
  mdn: 'moonwalker neurons (MDN)', fwd: 'walking command (DNp09)', groom: 'leg-rubbing command (DNg11)',
  escw: 'escape-wing neurons', dng12: 'head-grooming command (DNg12)', proboscis: 'proboscis motor neurons',
};

// Populations whose meaning the panels spell out (key -> label, rate key).
export const POPULATION_RATE = {
  loomL: 'loomL', loomR: 'loomR', lc4: 'loom', lplc2: 'loom', gf: 'gf', dnaL: 'dnaL', dnaR: 'dnaR', mdn: 'mdn', fwd: 'fwd',
  groom: 'groom', escw: 'escw', joA: 'joA', joW: 'joW', ascend: 'ascend', hot: 'hot', cold: 'cold',
  thermoRelay: null, sugar: 'sugar', bitter: 'bitter', tasteRelay: 'tasteRelay', proboscisMN: 'proboscis',
  ingestionMN: 'ingestion', joF: 'joF', groomRelay: 'groomRelay', dng12: 'dng12',
};
export const POPULATION_COLOR = {
  loomL: '#28d9ff', loomR: '#6fb8ff', lc4: '#28d9ff', lplc2: '#28d9ff', gf: '#fff266', dnaL: '#ff8c1a', dnaR: '#ff8c1a',
  mdn: '#ff33cc', fwd: '#40ff59', groom: '#bf8cff', escw: '#ff5940', joA: '#9dff5c', joW: '#5cffc8', ascend: '#b28cff',
  hot: '#ff4714', cold: '#5999ff', thermoRelay: '#e6b380', sugar: '#ffdb4d', bitter: '#73e659', tasteRelay: '#d9bf73',
  proboscisMN: '#ff9926', ingestionMN: '#ffb366', joF: '#66ffd9', groomRelay: '#8ce0cf', dng12: '#cc73ff',
};
// brain-view group for a population key (for highlighting)
export const POPULATION_BRAIN_GROUP = {
  loomL: 'loom', loomR: 'loom', lc4: 'loom', lplc2: 'loom', gf: 'gf', dnaL: 'dna', dnaR: 'dna', mdn: 'mdn', fwd: 'fwd', groom: 'groom',
  escw: 'escw', hot: 'hot', cold: 'cold', thermoRelay: 'thermoRelay', sugar: 'sugar', bitter: 'bitter', tasteRelay: 'tasteRelay',
  proboscisMN: 'proboscis', ingestionMN: 'proboscis', joF: 'joF', groomRelay: 'groomRelay', dng12: 'dng12',
};

export function hexToRgb01(hex) {
  const v = parseInt(hex.slice(1), 16);
  return [((v >> 16) & 255) / 255, ((v >> 8) & 255) / 255, (v & 255) / 255];
}
