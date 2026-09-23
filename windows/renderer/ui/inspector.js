// inspector.js — the connectome and the explanations, side by side.
//
// Each behavioural event from the simulation becomes a card: what changed in
// the world, which sensory neurons it reached, which command neurons decided
// and how their input divided among source populations, and the rule that
// turned that into movement. Opening a card lights the populations it names
// in the 3D connectome above.

import { h, icon } from './dom.js';
import { t, num, int } from '../i18n.js';
import { EVENT_INFO, SOURCE_INFO, TRIGGER_INFO, LOOM_SOURCE, COMMAND_INFO, hexToRgb01 } from './labels.js';
import { GROUP_COLORS } from '../view/brain.js';

export function buildInspector(ctx) {
  const brainEl = document.getElementById('brain');
  const whyEl = document.getElementById('why');
  const events = [];
  let openId = null, seq = 0;
  let legendOpen = false;
  let els = {};

  function buildBrainBar() {
    brainEl.querySelectorAll('.brain-bar,.legend,.brain-hint').forEach((n) => n.remove());
    const legendBtn = h('button', { class: `btn small ${legendOpen ? 'on' : ''}`, type: 'button', title: t('Choose which neuron groups are shown, with their live firing rates') }, icon('layers', 14), h('span', {}, t('Groups')));
    const synBtn = h('button', { class: `btn small ${ctx.views.brain.synapsesVisible ? 'on' : ''}`, type: 'button', title: t('Show the synapses (a sample at rest; every synapse that fires lights up)') }, t('Synapses'));
    const clearBtn = h('button', { class: 'btn small', type: 'button', title: t('Clear the highlight') }, icon('close', 13));
    const bar = h('div', { class: 'brain-bar' },
      h('div', { class: 'title' }, h('b', {}, h('span', { class: 'pill', 'data-state': 'running', style: { padding: '0 6px 0 4px', border: '0', background: 'transparent' } }, h('span', { class: 'dot' })), t('Connectome')),
        h('small', {}, t('{n} simulated neurons at their real positions', { n: int(ctx.data.circuit.neurons.length) }))),
      h('div', { class: 'tools' }, legendBtn, synBtn, clearBtn));
    const legend = h('div', { class: 'legend', hidden: !legendOpen });
    const hint = h('div', { class: 'brain-hint' }, t('Drag to turn · wheel to zoom · click to stimulate'));
    brainEl.append(bar, legend, hint);
    legendBtn.addEventListener('click', () => { legendOpen = !legendOpen; legend.hidden = !legendOpen; legendBtn.classList.toggle('on', legendOpen); if (legendOpen) renderLegend(); });
    synBtn.addEventListener('click', () => { ctx.views.brain.setSynapsesVisible(!ctx.views.brain.synapsesVisible); synBtn.classList.toggle('on', ctx.views.brain.synapsesVisible); });
    clearBtn.addEventListener('click', () => { ctx.highlight(null); openId = null; renderEvents(); });
    els.legend = legend;
    if (legendOpen) renderLegend();
  }

  function renderLegend() {
    const bv = ctx.views.brain;
    const tiers = [['named', t('Identified cell types')], ['other', t('Unnamed partner neurons')], ['bg', t('Anatomical context (not simulated)')]];
    els.legend.replaceChildren();
    for (const [tier, title] of tiers) {
      els.legend.append(h('h4', {}, title));
      bv.groups.forEach((g, gi) => {
        if (g.tier !== tier) return;
        const cb = h('input', { type: 'checkbox' });
        cb.checked = bv.visible.has(gi);
        cb.addEventListener('change', () => bv.setGroupVisible(gi, cb.checked));
        const c = g.color.map((v) => Math.round(Math.min(1, v + 0.2) * 255));
        els.legend.append(h('label', {}, cb, h('span', { class: 'sw', style: { background: `rgb(${c.join(',')})` } }),
          h('span', {}, g.suffix ? `${t(g.label)} — ${t(g.suffix)}` : t(g.label)), h('span', { class: 'hz', dataset: { key: g.key } }, tier === 'named' ? '' : int(g.count))));
      });
    }
  }

  function buildWhy() {
    const list = h('div', { class: 'why-list' });
    whyEl.replaceChildren(h('div', { class: 'why-head' }, icon('why', 16), h('b', {}, t('Why did she do that?')), h('span', { class: 'tag measured', title: t('Built from spike counts and synaptic input the simulation measured') }, t('from the simulation'))), list);
    els.list = list;
    renderEvents();
  }

  const sourceName = (s) => t(SOURCE_INFO[s]?.label ?? s);

  function chainFor(e) {
    const steps = [];
    if (e.kind === 'death') {
      steps.push(h('div', { class: 'step' }, h('div', { class: 'k' }, t('Body')), h('div', { class: 'v' }, t('Her survival budget reached zero. Her network receives no input from here on.'))));
      return steps;
    }
    // 1 trigger
    let trig;
    const others = (e.concurrent || []).map((c) => t(TRIGGER_INFO[c.channel] ?? c.label));
    const along = (e.contributing || []).map((c) => t(TRIGGER_INFO[c.channel] ?? c.label));
    if (!e.trigger && others.length) trig = t('No input reached the deciding neurons directly: they crossed threshold through her central network.');
    else if (!e.trigger) trig = t('No change in her surroundings preceded it: the command neurons crossed threshold from her own ongoing network activity.');
    else {
      const base = t(TRIGGER_INFO[e.trigger.channel] ?? e.trigger.label);
      const src = e.trigger.source && LOOM_SOURCE[e.trigger.source] ? ` (${t(LOOM_SOURCE[e.trigger.source])})` : '';
      const when = e.trigger.sustained ? t(', ongoing') : e.trigger.latencyMs != null
        ? `, ${e.trigger.latencyMs <= 8 ? t('within the same 8 ms step') : t('{ms} ms earlier', { ms: e.trigger.latencyMs })}` : '';
      trig = `${base}${src}${when}.`;
    }
    steps.push(h('div', { class: 'step' }, h('div', { class: 'k' }, t('Trigger'), h('span', { class: 'tag' }, e.trigger?.channel === 'stim' ? t('you') : t('input'))), h('div', { class: 'v' }, trig),
      along.length ? h('div', { class: 'note' }, t('Together with: {list} — its receptors also fed the deciding neurons.', { list: along.join(', ') })) : null,
      others.length ? h('div', { class: 'note' }, t('Also present at the time: {list}. Any influence it had ran through central neurons and is not traced here, so it is not named as the cause.', { list: others.join(', ') })) : null));
    // 2 sensory
    const sens = Object.entries(e.sensory || {});
    if (sens.length) {
      const names = { loomL: 'LC4/LPLC2 left', loomR: 'LC4/LPLC2 right', joA: 'JO-A/B', joW: 'JO-C/D/E', hot: t('hot cells'), cold: t('cold cells'),
        sugar: t('sugar neurons'), bitter: t('bitter neurons'), joF: 'JO-F' };
      steps.push(h('div', { class: 'step' }, h('div', { class: 'k' }, t('Sensory neurons'), h('span', { class: 'tag measured' }, t('measured'))),
        h('div', { class: 'v' }, sens.map(([k, v]) => `${names[k] ?? k}: ${num(v, 0)} Hz`).join(' · '))));
    }
    // 3 command input
    if (e.command) {
      const total = e.inputs.reduce((s, i) => s + i.value, 0);
      const bar = h('div', { class: 'shares' }, ...e.inputs.map((i) => h('span', { style: { width: `${(i.value / Math.max(1e-9, total)) * 100}%`, background: SOURCE_INFO[i.source]?.color ?? '#888' }, title: `${sourceName(i.source)} ${Math.round(i.share * 100)}%` })));
      const legend = h('div', { class: 'share-legend' }, ...e.inputs.slice(0, 4).map((i) => h('span', {}, h('i', { style: { background: SOURCE_INFO[i.source]?.color ?? '#888' } }), `${sourceName(i.source)} ${Math.round(i.share * 100)}%`)));
      const inhib = e.inhibition?.length ? t('Strongest inhibition from {src}.', { src: sourceName(e.inhibition[0].source) }) : '';
      steps.push(h('div', { class: 'step' }, h('div', { class: 'k' }, t('Decision'), h('span', { class: 'tag measured' }, t('measured'))),
        h('div', { class: 'v' }, t('The {cmd} fired {n} spikes in the last {ms} ms ({hz} Hz). Their excitatory input came from:', {
          cmd: t(COMMAND_INFO[e.command.group] ?? e.command.group), n: e.command.spikes, ms: e.command.windowMs, hz: num(e.commandRateHz ?? 0, 0) })),
        bar, legend, inhib ? h('div', { class: 'note' }, inhib) : null));
    } else if (e.kind === 'dart') {
      steps.push(h('div', { class: 'step' }, h('div', { class: 'k' }, t('Decision'), h('span', { class: 'tag measured' }, t('measured'))),
        h('div', { class: 'v' }, t('Her looming detectors fired at {hz} Hz, but the giant fiber stayed silent.', { hz: num(e.loomHz ?? 0, 0) }))));
    } else if (e.kind === 'spontaneousFlight') {
      steps.push(h('div', { class: 'step' }, h('div', { class: 'k' }, t('State'), h('span', { class: 'tag measured' }, t('measured'))),
        h('div', { class: 'v' }, t('Whole-brain activity was {hz} Hz per neuron.', { hz: num(e.populationHz ?? 0, 1) }))));
    }
    // 4 rule
    steps.push(h('div', { class: 'step' }, h('div', { class: 'k' }, t('Behaviour'), h('span', { class: 'tag model' }, t('body model'))), h('div', { class: 'v' }, t(e.rule))));
    return steps;
  }

  function highlightFor(e) {
    const info = EVENT_INFO[e.kind];
    const groups = [...(info?.groups || [])];
    const map = { loomL: 'loom', loomR: 'loom', hot: 'hot', cold: 'cold', sugar: 'sugar', bitter: 'bitter', dust: 'joF' };
    if (e.trigger && map[e.trigger.channel] && !groups.includes(map[e.trigger.channel])) groups.unshift(map[e.trigger.channel]);
    const key = groups[groups.length - 1];
    return { groups, color: GROUP_COLORS[key] ?? [1, 1, 1], duration: 12 };
  }

  function renderEvents() {
    if (!els.list) return;
    if (!events.length) {
      els.list.replaceChildren(h('div', { class: 'why-empty' },
        t('Every time she does something — takes off, grooms, backs up, extends her proboscis — the causal chain appears here: the trigger, the sensory neurons, the synaptic input to the neurons that decided, and the rule that made it movement.'),
        h('br'), h('br'), t('Try: move the cursor quickly at her, or press L.')));
      return;
    }
    els.list.replaceChildren(...events.slice().reverse().map((e) => {
      const info = EVENT_INFO[e.kind] ?? { label: e.kind, icon: 'spark' };
      const open = e._id === openId;
      const card = h('div', { class: `event ${open ? 'open' : ''}` },
        h('div', { class: 'event-head' }, h('span', { class: 'glyph' }, icon(info.icon, 16)), h('b', {}, t(info.label)), h('small', {}, `${num(e.t, 1)} s`)),
        h('div', { class: 'event-sub' }, e.trigger ? t(TRIGGER_INFO[e.trigger.channel] ?? e.trigger.label) : t('No external trigger')),
        open ? h('div', { class: 'chain' }, ...chainFor(e)) : null);
      card.addEventListener('click', () => {
        openId = open ? null : e._id;
        ctx.highlight(open ? null : highlightFor(e));
        renderEvents();
      });
      return card;
    }));
  }

  ctx.openEvent = (e) => {
    document.body.classList.remove('inspector-collapsed');
    openId = e._id;
    ctx.highlight(highlightFor(e));
    renderEvents();
    els.list.scrollTop = 0;
  };

  let legendT = 0;
  ctx.onFrame((snap) => {
    if (snap.events.length) {
      for (const e of snap.events) { e._id = ++seq; events.push(e); }
      while (events.length > 40) events.shift();
      renderEvents();
    }
    const now = performance.now();
    if (legendOpen && now - legendT > 250) {
      legendT = now;
      for (const g of ctx.views.brain.groupRates(snap.rates)) {
        const el = els.legend.querySelector(`.hz[data-key="${g.key}"]`);
        if (el) el.textContent = `${num(g.hz, 1)} Hz`;
      }
    }
  });

  return {
    ready() { buildBrainBar(); buildWhy(); },
    rebuild() { buildBrainBar(); buildWhy(); },
  };
}
void hexToRgb01;
