// panel-circuit.js — the connectome as an instrument: identified populations
// with live rates, virtual genetics (silence / activate any population or
// FlyWire cell type), in-silico pharmacology, and a single-neuron inspector.

import { h, icon } from './dom.js';
import { t, num, int } from '../i18n.js';
import { panelHead, card, slider, tag, kv } from './widgets.js';
import { POPULATION_RATE, POPULATION_COLOR, POPULATION_BRAIN_GROUP, hexToRgb01 } from './labels.js';

const DRUGS = [
  { cls: 'exc', label: 'Excitatory synapses (acetylcholine)' },
  { cls: 'inh', label: 'Inhibitory synapses (GABA + glutamate)' },
  { cls: 'da', label: 'Dopamine synapses' },
  { cls: 'ser', label: 'Serotonin synapses' },
  { cls: 'oct', label: 'Octopamine synapses' },
];
const PRESETS = [
  { label: 'GABA/GluCl block (picrotoxin-like)', set: { inh: 0.2 } },
  { label: 'Nicotinic block (mecamylamine-like)', set: { exc: 0.5 } },
  { label: 'Enhanced inhibition (GABA agonist-like)', set: { inh: 2 } },
  { label: 'Octopamine boost', set: { oct: 3 } },
];

export const circuitPanel = {
  id: 'circuit', icon: 'circuit', title: 'Circuit', short: 'Circuit',
  build(ctx) {
    const pops = ctx.info.populations;
    const rows = new Map();
    const genetic = () => ctx.snap?.genetics ?? [];
    const isOn = (population, mode) => genetic().some((g) => g.population === population && g.mode === mode);
    const highlight = (key) => {
      const group = POPULATION_BRAIN_GROUP[key];
      if (group) ctx.highlight({ groups: [group], color: hexToRgb01(POPULATION_COLOR[key] ?? '#ffffff'), duration: 10 });
      else ctx.request('populationIndices', { population: key }).then((idx) => idx && ctx.highlight({ indices: idx, color: [1, 1, 1], duration: 10 }));
    };
    const setGenetic = (population, mode, on) => ctx.command('genetics.set', { population, mode, on, strength: 0.05 }, { reply: true })
      .then((r) => { if (r && !r.ok) ctx.toast(r.reason, 'err'); });

    function popRow(key, label, count, color) {
      const hz = h('span', { class: 'hz' });
      const sil = h('button', { type: 'button', class: 'silence', title: t('Silence: hold these neurons at rest, like expressing Kir2.1') }, t('Silence'));
      const act = h('button', { type: 'button', title: t('Activate: tonic depolarising drive, like CsChrimson under red light') }, t('Activate'));
      const hl = h('button', { type: 'button', title: t('Show them in the 3D connectome') }, icon('target', 12));
      sil.addEventListener('click', () => setGenetic(key, 'silence', !isOn(key, 'silence')));
      act.addEventListener('click', () => setGenetic(key, 'activate', !isOn(key, 'activate')));
      hl.addEventListener('click', () => highlight(key));
      const row = h('div', { class: 'pop-row' }, h('span', { class: 'sw', style: { background: color } }),
        h('span', {}, t(label), ' ', h('small', {}, `· ${int(count)}`)), hz, h('span', { class: 'acts' }, hl, sil, act));
      rows.set(key, { row, hz, sil, act });
      return row;
    }

    const popList = h('div', { class: 'list' }, ...pops.map((p) => popRow(p.key, p.label, p.count, POPULATION_COLOR[p.key] ?? '#8ea39d')));
    const genetics = card(t('Virtual genetics'), { iconName: 'bolt', tagEl: tag('model', t('intervention')) },
      h('p', { class: 'note', style: { marginTop: 0 } }, t('Silence or activate identified neurons and watch what changes — the same logic as a Kir2.1 or CsChrimson experiment, on the real wiring. Conditions stay until you remove them, also across a new fly.')),
      h('div', { style: { marginTop: '10px' } }, popList));

    // cell type search
    const search = h('input', { type: 'search', placeholder: t('FlyWire cell type, e.g. DNp01, LC4, PAM, CB0762'), 'aria-label': t('Search FlyWire cell types') });
    const results = h('div', { class: 'list', style: { marginTop: '8px' } });
    let searchTimer = null;
    search.addEventListener('input', () => {
      clearTimeout(searchTimer);
      searchTimer = setTimeout(async () => {
        const found = await ctx.request('cellTypes', { query: search.value });
        results.replaceChildren(...(found || []).slice(0, 25).map((r) => popRow(r.key, r.label, r.count, '#c9d6d1')));
        if (search.value.trim() && !(found || []).length) results.replaceChildren(h('p', { class: 'note' }, t('No simulated neuron has that type.')));
      }, 180);
    });
    const typeCard = card(t('Any FlyWire cell type'), { iconName: 'search' },
      search, results, h('p', { class: 'note' }, t('Searches the real FlyWire v783 cell-type annotation of every simulated neuron.')));

    const active = h('div', { class: 'chips' });
    const clearAll = h('button', { class: 'btn small ghost', type: 'button', onclick: () => ctx.command('genetics.clear') }, t('Remove all'));
    const conditions = card(t('Active conditions'), { tagEl: tag('model', t('recorded')) }, active, h('div', { class: 'row', style: { marginTop: '8px' } }, clearAll),
      h('p', { class: 'note' }, t('Every condition is written into recordings and the run manifest.')));

    // pharmacology
    const drugSliders = DRUGS.map((d) => {
      const s = slider({ label: t(d.label), min: 0, max: 3, step: 0.05, value: ctx.snap?.pharmacology?.[d.cls] ?? 1, format: (v) => `${num(v, 2)}×`,
        onChange: (v) => ctx.command('pharma.set', { cls: d.cls, gain: v }) });
      return { ...d, s };
    });
    const pharma = card(t('Pharmacology'), { iconName: 'pill', tagEl: tag('model', t('synaptic efficacy')) },
      ...drugSliders.map((d) => d.s.el),
      h('div', { class: 'grid2', style: { marginTop: '10px' } },
        ...PRESETS.map((p) => h('button', { class: 'btn small', type: 'button', onclick: () => { ctx.command('pharma.reset'); for (const [cls, gain] of Object.entries(p.set)) ctx.command('pharma.set', { cls, gain }); } }, t(p.label))),
        h('button', { class: 'btn small ghost', type: 'button', onclick: () => ctx.command('pharma.reset') }, t('Wash out'))),
      h('p', { class: 'note' }, t('Scales every synapse of one transmitter class, as a receptor agonist or antagonist would at the level of synaptic strength. No pharmacokinetics; GABA and glutamate share the inhibitory class in the extracted data.')));

    // single neuron
    const probeInput = h('input', { type: 'text', placeholder: t('#index or FlyWire ID — or click the brain'), 'aria-label': t('Neuron') });
    const probeOut = h('div', {});
    let probeIndex = ctx.state.selectedNeuron;
    const doProbe = async (q) => {
      const r = await ctx.request('findNeuron', { query: q });
      if (!r) { probeOut.replaceChildren(h('p', { class: 'note' }, t('Not found.'))); return; }
      probeIndex = r.index;
      renderProbe(r);
    };
    function renderProbe(r) {
      probeOut.replaceChildren(
        kv([[t('FlyWire ID'), r.id], [t('Cell type'), r.type || '—'], [t('Class'), r.superClass], [t('Role / side'), `${r.role} / ${r.side ?? '—'}`],
          [t('Pathway'), r.extension ? `${r.extension}${r.group ? ` · ${r.group}` : ''}` : t('core circuit')],
          [t('Inputs / outputs'), `${int(r.incoming)} / ${int(r.outgoing)}`], [t('Membrane'), `${num(r.membrane, 3)} / ${num(r.threshold, 2)}`],
          [t('Silenced'), r.silenced ? t('yes') : t('no')]]),
        h('div', { class: 'note', style: { marginTop: '8px' } }, h('b', {}, t('Strongest inputs by type: ')), r.topInputs.map((x) => `${x.type} ${x.weight > 0 ? '+' : ''}${num(x.weight * 1000, 1)}`).join(' · ') || '—'),
        h('div', { class: 'note' }, h('b', {}, t('Strongest outputs by type: ')), r.topOutputs.map((x) => `${x.type} ${x.weight > 0 ? '+' : ''}${num(x.weight * 1000, 1)}`).join(' · ') || '—'),
        h('div', { class: 'row', style: { marginTop: '8px' } },
          h('button', { class: 'btn small', type: 'button', onclick: () => ctx.command('stim.cells', { indices: [r.index], strength: 1.2, durationMs: 5, label: `neuron #${r.index}` }) }, t('Make it spike')),
          h('button', { class: 'btn small', type: 'button', onclick: () => ctx.highlight({ indices: [r.index], color: [1, 1, 1], duration: 10 }) }, t('Show'))),
        h('p', { class: 'note' }, t('Weights in thousandths of the spike threshold per spike (signed by transmitter). Membrane in model units.')));
    }
    probeInput.addEventListener('keydown', (e) => { if (e.key === 'Enter') doProbe(probeInput.value); });
    const probeCard = card(t('Single neuron'), { iconName: 'target', tagEl: tag('measured') }, probeInput, h('div', { style: { marginTop: '8px' } }, probeOut));
    if (probeIndex !== null && probeIndex !== undefined) doProbe(`#${probeIndex}`);

    const el = h('div', {}, panelHead(t('Circuit'), t('Open the brain like a neuroscientist.'),
      t('Every population below is a set of real, identified FlyWire neurons. Switch them off or on, change the synapses pharmacologically, or inspect a single cell.')),
    genetics, conditions, typeCard, pharma, probeCard);

    let probeT = 0;
    return {
      el,
      update(snap, extra) {
        for (const [key, r] of rows) {
          const rk = POPULATION_RATE[key];
          r.hz.textContent = rk ? `${num(snap.rates[rk] ?? 0, 1)} Hz` : '';
          r.sil.classList.toggle('on', isOn(key, 'silence'));
          r.act.classList.toggle('on', isOn(key, 'activate'));
        }
        active.replaceChildren(...(snap.genetics.length ? snap.genetics.map((g) => h('span', { class: 'chip accent' }, `${g.mode === 'silence' ? t('silenced') : t('activated')}: ${t(g.label)} (${g.count})`))
          : [h('span', { class: 'note' }, t('None — the connectome is intact.'))]));
        for (const d of drugSliders) d.s.set(snap.pharmacology[d.cls]);
        if (extra?.pick) doProbe(`#${extra.pick.nearest}`);
        const now = performance.now();
        if (probeIndex !== null && probeIndex !== undefined && now - probeT > 1000) { probeT = now; ctx.request('probe', { index: probeIndex }).then((r) => r && renderProbe(r)); }
      },
    };
  },
};
