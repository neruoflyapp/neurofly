// panel-live.js — "Live": what she is doing, one-click experiences, the view.

import { h, icon } from './dom.js';
import { t, num } from '../i18n.js';
import { panelHead, card, action, meter, slider, check, tag } from './widgets.js';
import { behaviourOf } from './labels.js';
import { mapColor } from '../view/terrarium.js';

const MAP_FIELDS = [
  ['occupancy', 'Time spent'], ['fear', 'Giant fiber (escape alarm)'], ['loom', 'Looming detectors'],
  ['sens', "Johnston's organ"], ['hot', 'Hot cells'], ['cold', 'Cold cells'], ['proboscis', 'Proboscis motor neurons'],
  ['dng12', 'Head-grooming DNg12'], ['temp', 'Temperature she met'], ['events', 'Takeoffs per minute'],
];
const MAP_UNITS = { occupancy: 's', fear: 'Hz', loom: 'Hz', sens: 'Hz', hot: 'Hz', cold: 'Hz', proboscis: 'Hz', dng12: 'Hz', temp: '°C', events: '/min' };

export const livePanel = {
  id: 'live', icon: 'live', title: 'Live', short: 'Live',
  build(ctx) {
    const s = ctx.state;
    const glyph = h('div', { class: 'glyph' });
    const stateName = h('b');
    const stateSub = h('small');
    const meters = {
      walk: meter(t('Walking command · DNp09')),
      escape: meter(t('Escape command · giant fiber')),
      threat: meter(t('Threat detectors · LC4/LPLC2')),
      groom: meter(t('Grooming commands · DNg11 / DNg12')),
      proboscis: meter(t('Proboscis motor neurons')),
      arousal: meter(t('Whole-brain activity')),
      health: meter(t('Health (body model)')),
    };
    const now = card(t('Right now'), { tagEl: tag('measured') },
      h('div', { class: 'state-big' }, glyph, h('div', {}, stateName, stateSub)),
      h('div', { style: { marginTop: '12px' } }, ...Object.values(meters).map((m) => m.el)));

    const cmd = (name, args) => ctx.command(name, args);
    const tryIt = card(t('Try it'), { iconName: 'spark' },
      h('div', { class: 'grid2' },
        action('loom', t('Looming threat'), t('An object rushes at her eyes'), () => cmd('stim.loom', { strength: 0.8 })),
        action('wind', t('Air puff'), t('A sudden gust at her antennae'), () => cmd('stim.burst', { channel: 'puff', level: 0.8, durationS: 0.3, label: t('air puff') })),
        action('sound', t('Buzz'), t('Near-field sound — hearing neurons'), () => cmd('stim.burst', { channel: 'sound', level: 0.8, durationS: 0.6, label: t('sound') })),
        action('groom', t('Dust her antennae'), t('Watch her clean her head'), () => cmd('antenna.dust', { amount: 1 })),
        action('drop', t('Taste sugar'), t('Sugar on her mouthparts'), () => cmd('taste.offer', { sugar: 0.8, bitter: 0, durationS: 2.5 })),
        action('drop', t('Taste bitter'), t('Bitter on her mouthparts'), () => cmd('taste.offer', { sugar: 0, bitter: 0.9, durationS: 2.5 })),
        action('drop', t('Sugar drop'), t('A drop in front of her'), () => cmd('food.add', { kind: 'sugar', conc: 0.8 })),
        action('drop', t('Sugar + bitter drop'), t('Will she still eat?'), () => cmd('food.add', { kind: 'mixed', conc: 0.8, bitter: 0.6 }))),
      h('p', { class: 'note' }, t('Every button drives real sensory neurons of the connectome; what happens next is decided by the wiring. The explanation panel on the right shows why.')));

    const bright = slider({ label: t('View brightness'), min: 0.5, max: 2.5, step: 0.05, value: ctx.views.terrarium.viewBrightness, format: (v) => `${num(v, 2)}×`,
      title: t('Camera exposure only. Her own eye always renders at the fixed physical exposure.'),
      onInput: (v) => ctx.views.terrarium.setViewBrightness(v) });
    const night = check(t('Lift the night automatically'), ctx.views.terrarium.autoNightLift, (v) => ctx.views.terrarium.setAutoNightLift(v),
      t('Opens the exposure at night like a camera; the scene lighting itself stays as dark as the real clock says.'));
    const mapToggle = check(t('Show the spatial map'), s.mapVisible, (v) => { s.mapVisible = v; ctx.views.terrarium.setMapVisible(v); ctx.client.input({ map: v ? { field: s.mapField } : null }); },
      t('Where she spends her time, and what her neurons did there. Drawn on a layer her own eye cannot see.'));
    const mapSelect = h('select', { 'aria-label': t('Map quantity') }, ...MAP_FIELDS.map(([k, label]) => h('option', { value: k, selected: k === s.mapField }, t(label))));
    mapSelect.addEventListener('change', () => { s.mapField = mapSelect.value; if (s.mapVisible) ctx.client.input({ map: { field: s.mapField } }); });
    const legend = h('canvas', { width: 64, height: 1, style: { width: '100%', height: '8px', borderRadius: '3px', imageRendering: 'auto' } });
    const lctx = legend.getContext('2d'), img = lctx.createImageData(64, 1);
    for (let x = 0; x < 64; x++) mapColor(x / 63, img.data, x * 4);
    lctx.putImageData(img, 0, 0);
    const mapInfo = h('p', { class: 'note' }, t('Switch the map on to start reading it; it measures continuously.'));
    const mapButtons = h('div', { class: 'row' },
      h('button', { class: 'btn small', type: 'button', onclick: async () => {
        const csv = await ctx.request('mapCSV');
        if (!csv) { ctx.toast(t('Nothing measured yet.')); return; }
        ctx.save('saveRecording', csv, t('Map saved.'));
      } }, icon('download', 14), t('Export CSV')),
      h('button', { class: 'btn small ghost', type: 'button', onclick: () => ctx.command('map.reset') }, t('Reset')));
    const view = card(t('View'), { tagEl: tag('observer') },
      bright.el, night.el, mapToggle.el, h('div', { class: 'field' }, mapSelect), h('div', { class: 'field' }, legend), mapInfo, h('div', { class: 'field' }, mapButtons));

    const el = h('div', {},
      panelHead(t('Live'), t('A fly, running on her connectome.'),
        t('{n} real FlyWire neurons and {m} nerve-cord neurons decide what she does — 120 times a second, on a CPU core of their own.', {
          n: ctx.data.circuit.neurons.length.toLocaleString(), m: (ctx.data.locomotor?.neurons?.length ?? 0).toLocaleString() })),
      now, tryIt, view);

    return {
      el,
      update(snap) {
        const b = behaviourOf(snap);
        glyph.replaceChildren(icon(b.icon, 22));
        stateName.textContent = b.label;
        stateSub.textContent = `${t('fly')} #${snap.individual} · ${t('seed')} ${snap.seed}`;
        const r = snap.rates;
        meters.walk.set(r.fwd / 15, `${num(r.fwd, 1)} Hz`);
        meters.escape.set(r.gf / 40, `${num(r.gf, 1)} Hz`);
        meters.threat.set(r.loom / 120, `${num(r.loom, 1)} Hz`);
        meters.groom.set(Math.max(r.groom / 10, r.dng12 / 150), `${num(r.groom, 1)} / ${num(r.dng12, 0)} Hz`);
        meters.proboscis.set(r.proboscis / 150, `${num(r.proboscis, 0)} Hz`);
        meters.arousal.set(r.pop / 20, `${num(r.pop, 1)} Hz`);
        meters.health.set(snap.health / 100, `${Math.round(snap.health)}%`);
        if (s.mapVisible && snap.map) {
          const m = snap.map;
          const unit = MAP_UNITS[m.field] ?? '';
          let text = t('{min} min measured · maximum {peak} {unit}', { min: num(m.totalTime / 60, 1), peak: num(m.peak, m.peak < 10 ? 1 : 0), unit });
          if (m.field !== 'occupancy') {
            text += m.preference === null
              ? ` · ${t('about 10 min are needed before a spatial preference can be read')}`
              : ` · ${t('{pct}% of her time in the half with the lower values', { pct: Math.round(m.preference * 100) })}`;
          }
          mapInfo.textContent = text;
        }
      },
    };
  },
};
