// panel-experiments.js — standardised experiments with statistics, run on a
// separate virtual fly in the background (renderer/lab-worker.js).

import { h, icon } from './dom.js';
import { t, num } from '../i18n.js';
import { panelHead, tag, link } from './widgets.js';
import { drawResult } from './charts.js';
import { PROTOCOLS } from '../../src/experiments.js';

// One lab worker per window, created the first time an experiment runs.
function labFor(ctx) {
  if (ctx.lab) return ctx.lab;
  const worker = new Worker(new URL('../lab-worker.js', import.meta.url), { type: 'module' });
  const lab = { worker, ready: null, runs: new Map(), current: null };
  lab.ready = new Promise((resolve) => {
    worker.onmessage = (e) => {
      const m = e.data;
      if (m.type === 'ready') { resolve(); return; }
      const run = lab.runs.get(m.runId);
      if (!run) return;
      const st = ctx.state.experiments.get(run.protocolId) || {};
      if (m.type === 'progress') Object.assign(st, { status: 'running', fraction: m.fraction, eta: m.etaSeconds });
      else if (m.type === 'result') { Object.assign(st, { status: 'done', fraction: 1, result: m.result }); lab.current = null; ctx.toast(t('Experiment finished: {name}', { name: t(run.title) }), 'ok'); }
      else if (m.type === 'cancelled') { Object.assign(st, { status: 'idle', fraction: 0 }); lab.current = null; }
      else if (m.type === 'failed') { Object.assign(st, { status: 'failed', error: m.message }); lab.current = null; ctx.toast(`${t('Experiment failed')}: ${m.message}`, 'err'); }
      ctx.state.experiments.set(run.protocolId, st);
      for (const fn of ctx.experimentListeners ?? []) fn();
    };
  });
  worker.postMessage({ type: 'init', data: ctx.data });
  ctx.lab = lab;
  return lab;
}

export async function runExperiment(ctx, protocolId, params = {}) {
  const lab = labFor(ctx);
  await lab.ready;
  if (lab.current) { ctx.toast(t('Another experiment is still running.')); return; }
  const p = PROTOCOLS.find((x) => x.id === protocolId);
  const runId = `${protocolId}-${Date.now()}`;
  const seed = (params.seed ?? Math.floor(Math.random() * 0xffffffff)) >>> 0 || 1;
  lab.runs.set(runId, { protocolId, title: p.title });
  lab.current = runId;
  ctx.state.experiments.set(protocolId, { status: 'running', fraction: 0, eta: null, seed });
  for (const fn of ctx.experimentListeners ?? []) fn();
  lab.worker.postMessage({ type: 'run', runId, protocolId, params, seed });
}

const VERDICTS = {
  threshold: { cls: 'consistent', title: 'A sharp escape threshold', text: 'Below a looming intensity of about {x50} she stays; above it the giant fiber fires within milliseconds and she takes off — a threshold, as in real flies.' },
  noTransition: { cls: 'differs', title: 'No clear threshold in this range', text: 'Takeoff probability did not cross 50% within the tested intensities.' },
  soundEscapes: { cls: 'consistent', title: 'The wiring decides', text: 'Sound, reaching JO-A/B, drives the giant fiber; wind of the same strength, reaching JO-C/D/E, does not. Nothing in the model treats them differently except which neurons they reach.' },
  noDifference: { cls: 'differs', title: 'No significant difference', text: 'Sound and wind drove the giant fiber similarly in this run.' },
  tradeoff: { cls: 'consistent', title: 'Reward weighed against aversion', text: 'More sugar makes proboscis extension more likely, and adding bitter suppresses it — the integration found in the whole-brain FlyWire model and in real flies. Here it happens at the level of a reflex; the model has no hunger state.' },
  sugarOnly: { cls: 'differs', title: 'Sugar works, bitter did not suppress significantly', text: 'Proboscis extension rose with sugar, but bitter did not reduce it significantly in this run.' },
  noPer: { cls: 'differs', title: 'No dose-response', text: 'Proboscis extension did not follow the sugar concentration in this run.' },
  necessary: { cls: 'consistent', title: 'Directed self-care, through the real pathway', text: 'Dust makes her groom her head, and silencing the JO-F neurons abolishes it: the behaviour needs exactly the sensory cells the literature identifies.' },
  groomsNotNecessary: { cls: 'differs', title: 'Grooming without JO-F', text: 'She groomed, but silencing JO-F did not abolish it significantly.' },
  noGrooming: { cls: 'differs', title: 'No grooming response', text: 'Dust did not reliably trigger head grooming in this run.' },
  screen: { cls: 'consistent', title: '{matches} of {total} cell types behave as published', text: 'Each cell type was switched on alone; the table shows which behaviour it added over the control. Mismatches are reported as they are — they show where the extracted circuit or the body model falls short.' },
  bothMatter: { cls: 'consistent', title: 'Both looming pathways feed the escape', text: 'Silencing LPLC2 or LC4 each reduces the giant fiber\'s response significantly, and silencing both abolishes it.' },
  redundant: { cls: 'differs', title: 'Redundant pathways', text: 'Only silencing both pathways had a significant effect.' },
  noEffect: { cls: 'differs', title: 'No significant effect', text: 'Silencing did not change the response significantly.' },
  gates: { cls: 'consistent', title: 'Inhibition gates the escape', text: 'Weaker inhibitory synapses let the looming signal recruit the giant fiber more strongly; stronger inhibition holds it back — and near threshold it decides whether she escapes.' },
  noTrend: { cls: 'differs', title: 'No significant trend', text: 'Changing inhibition did not change the giant fiber\'s response significantly.' },
  habituates: { cls: 'consistent', title: 'The response habituates', text: 'Repeated looms drew a steadily weaker giant-fiber response.' },
  sensitizes: { cls: 'differs', title: 'The response grows instead', text: 'With the experimental timing rule on, repeated looms strengthen the giant-fiber response (sensitisation) — the opposite of the habituation real flies show. The fixed-wiring model does neither. Real habituation needs a mechanism this model does not contain.' },
  noHabituation: { cls: 'differs', title: 'No habituation', text: 'The giant fiber answered the 20th loom like the first. Real flies habituate; this model has no mechanism for it.' },
  learns: { cls: 'consistent', title: 'Pairing changed the response', text: 'After paired training the weak loom drove the giant fiber harder than after reversed-order training.' },
  noLearning: { cls: 'differs', title: 'No associative learning', text: 'Paired and reversed training changed the response equally. Real flies learn in the mushroom body with dopamine — a circuit this model does not contain; its generic timing rule does not reproduce it.' },
  prefers: { cls: 'consistent', title: 'She finds the comfortable zone', text: 'In the gradient she spent more time near 25 °C than in the flat control.' },
  noPreference: { cls: 'differs', title: 'No thermal preference', text: 'She did not spend more time near 25 °C in the gradient than in the flat control. Real flies do — using internal warmth sensors (AC neurons) that are not in this circuit.' },
};

const STAT_LABELS = {
  threshold: 'Threshold (50% takeoff)', latencyAtMax: 'GF latency at maximum', spontaneous: 'Takeoffs without looming',
  takeoffSound: 'Takeoffs to sound', takeoffWind: 'Takeoffs to wind', fisherP: 'p (Fisher exact)', mannWhitneyP: 'p (Mann-Whitney U)',
  sugarThreshold: 'Sugar at 50% extension', perSugarOnly: 'Extension, sugar alone', perWithBitter: 'Extension, sugar + max bitter',
  groomFullDust: 'Head grooming, full dust', groomJoFSilenced: 'Head grooming, JO-F silenced', groomDng12Silenced: 'Head grooming, DNg12 silenced',
  matches: 'Cell types as published', gfSpikesFor: 'GF spikes: {condition}', pVsControlFor: 'p vs intact: {condition}',
  gfSpikesLowInhibition: 'GF spikes at 0.25× inhibition', gfSpikesHighInhibition: 'GF spikes at 4× inhibition', ic50Gain: 'Half-maximal inhibitory gain', slope: 'Slope', trendP: 'p (trend)',
  slopeFixed: 'Trend, fixed wiring', slopeLearning: 'Trend, learning rule', indexPaired: 'Learning index, paired', indexReversed: 'Learning index, reversed',
  comfortGradient: 'Near 25 °C, gradient', comfortFlat: 'Near 25 °C, flat control',
};
const BEHAVIOUR_LABEL = { takeoff: 'takeoff', backward: 'walking backward', headGroom: 'head grooming', legGroom: 'leg rubbing', per: 'proboscis extension',
  walk: 'walking', turnLeft: 'left turn', turnRight: 'right turn', none: 'no change', baseline: '—' };

function fmtStat(s) {
  const v = s.value;
  if (v === null || v === undefined || (typeof v === 'number' && !Number.isFinite(v))) return '—';
  switch (s.format) {
    case 'pct': return `${Math.round(v * 100)}%`;
    case 'p': return v < 0.001 ? '< 0.001' : num(v, 3);
    case 'fixed1': return `${num(v, 1)}${s.unit ? ` ${s.unit}` : ''}`;
    case 'fixed2': return num(v, 2);
    case 'fixed3': return num(v, 3);
    default: return String(v);
  }
}

export function renderResult(result, protocol) {
  const canvas = h('canvas');
  const v = VERDICTS[result.verdict?.code] ?? { cls: '', title: result.verdict?.code ?? '', text: '' };
  const params = result.verdict?.params ?? {};
  const statsEl = h('dl', { class: 'stats' }, ...result.stats.flatMap((s) => [h('dt', {}, t(STAT_LABELS[s.key] ?? s.key, s.params)), h('dd', {}, fmtStat(s))]));
  const table = result.table ? h('table', { class: 'table' },
    h('tr', {}, h('th', {}, t('Cell type')), h('th', {}, t('Published')), h('th', {}, t('Model')), h('th', {}, '')),
    ...result.table.map((r) => h('tr', {}, h('td', {}, r.target), h('td', {}, t(BEHAVIOUR_LABEL[r.expect] ?? r.expect)),
      h('td', {}, t(BEHAVIOUR_LABEL[r.observed] ?? r.observed)), h('td', { class: r.match ? 'ok' : 'miss' }, r.match ? '✓' : '✗')))) : null;
  const el = h('div', { class: 'result' }, canvas,
    h('div', { class: `verdict ${v.cls}` }, h('b', {}, t(v.title, params)), t(v.text, params)),
    statsEl, table,
    h('p', { class: 'note' }, t('Seed {seed} · {sim} s simulated in {wall} s · {trials} trials per condition · model {v}', {
      seed: result.meta.seed, sim: num(result.meta.simulatedSeconds, 0), wall: num(result.meta.wallSeconds, 0),
      trials: result.meta.params.trials, v: result.meta.modelVersion })));
  requestAnimationFrame(() => drawResult(canvas, result.chart, { t }));
  void protocol;
  return el;
}

export const experimentsPanel = {
  id: 'experiments', icon: 'experiments', title: 'Experiments', short: 'Lab',
  build(ctx) {
    const open = new Set(ctx.state.openExperiments || ['escape-threshold']);
    ctx.state.openExperiments = open;
    const list = h('div', {});
    const trialsChoice = new Map();

    function card(p) {
      const st = ctx.state.experiments.get(p.id) || { status: 'idle' };
      const unavailable = (p.requires === 'taste' && !ctx.info.hasTaste) || (p.requires === 'grooming' && !ctx.info.hasGrooming);
      const isOpen = open.has(p.id);
      const head = h('div', { class: 'exp-head', onclick: () => { if (isOpen) open.delete(p.id); else open.add(p.id); render(); } },
        h('div', { class: 'glyph' }, icon(p.icon, 18)),
        h('div', {}, h('div', { class: 'cat' }, t(p.category)), h('b', {}, t(p.title)), h('small', {}, t(p.question))));
      const cardEl = h('div', { class: 'exp' }, head);
      if (!isOpen) {
        if (st.status === 'running') cardEl.append(h('div', { class: 'exp-body' }, h('div', { class: 'progress' }, h('span', { style: { width: `${(st.fraction || 0) * 100}%` } }))));
        return cardEl;
      }
      const defaults = p.defaults.trials;
      const trials = trialsChoice.get(p.id) ?? defaults;
      const trialSel = h('select', { style: { width: 'auto' }, 'aria-label': t('Trials per condition') },
        ...[Math.max(2, Math.round(defaults / 2)), defaults, defaults * 2].map((n) => h('option', { value: n, selected: n === trials }, t('{n} per condition', { n }))));
      trialSel.addEventListener('change', () => trialsChoice.set(p.id, Number(trialSel.value)));
      const est = p.estimateSeconds({ ...p.defaults, trials });
      const running = st.status === 'running';
      const runBtn = h('button', { class: `btn ${running ? '' : 'primary'} small`, type: 'button', disabled: unavailable || (!!ctx.lab?.current && !running),
        onclick: () => {
          if (running) { ctx.lab?.worker.postMessage({ type: 'cancel' }); return; }
          runExperiment(ctx, p.id, { trials: Number(trialSel.value) });
        } }, icon(running ? 'close' : 'play', 14), running ? t('Cancel') : t('Run'));
      const body = h('div', { class: 'exp-body' },
        h('p', { class: 'note', style: { marginTop: 0 } }, h('b', {}, t('Measured: ')), t(p.measures)),
        h('ul', { class: 'lit' }, ...p.literature.map((l) => h('li', {}, tag('real'), ' ', link(l.doi, l.cite), ` — ${t(l.finding)}`))),
        h('div', { class: 'row', style: { marginTop: '10px' } }, runBtn, trialSel, h('span', { class: 'note', style: { margin: 0 } }, t('≈ {s} s of simulated time', { s: Math.round(est) }))),
        unavailable ? h('p', { class: 'note' }, t('Needs the taste/grooming extension data (etl_sensory_extension.mjs).')) : null);
      if (running) {
        body.append(h('div', { class: 'progress' }, h('span', { style: { width: `${(st.fraction || 0) * 100}%` } })),
          h('p', { class: 'note' }, st.eta != null ? t('{pct}% · about {s} s left', { pct: Math.round((st.fraction || 0) * 100), s: Math.round(st.eta) }) : t('Starting…')));
      }
      if (st.status === 'done' && st.result) {
        body.append(renderResult(st.result, p),
          h('div', { class: 'row', style: { marginTop: '8px' } },
            h('button', { class: 'btn small', type: 'button', onclick: () => ctx.save('saveRecording', st.result.csv, t('Trial table saved.')) }, icon('download', 14), t('Trials as CSV')),
            h('button', { class: 'btn small', type: 'button', onclick: () => { const { csv, ...rest } = st.result; void csv; ctx.save('saveManifest', `${JSON.stringify(rest, null, 2)}\n`, t('Result saved.')); } }, icon('download', 14), t('Result as JSON'))));
      }
      cardEl.append(body);
      return cardEl;
    }

    function render() {
      list.replaceChildren(...PROTOCOLS.map(card));
    }
    const listener = () => { if (list.isConnected) render(); };
    ctx.experimentListeners ??= new Set();
    ctx.experimentListeners.add(listener);

    const el = h('div', {}, panelHead(t('Experiments'), t('Run the classic fly experiments.'),
      t('Each protocol runs on a separate virtual fly in a bare arena — many trials, as fast as your CPU allows — while your live fly carries on. You get the statistics, and a comparison with the published finding. Every run is reproducible from its seed.')),
    list);
    render();
    return { el, dispose() { ctx.experimentListeners.delete(listener); } };
  },
};
