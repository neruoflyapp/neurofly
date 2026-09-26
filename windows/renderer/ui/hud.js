// hud.js — what floats over the terrarium: what she is doing now, the
// conditions she is in, the camera controls, and the latest "why".

import { h, icon } from './dom.js';
import { t, num } from '../i18n.js';
import { behaviourOf, EVENT_INFO, TRIGGER_INFO } from './labels.js';
import { setText } from './widgets.js';

export function buildHud(ctx) {
  const root = document.getElementById('hud');
  let since = 0, lastKey = null, toastTimer = 0, lastShown = null;
  let els = {};
  let chipT = 0, textT = 0, shownIcon = null, shownLabel = null, shownAlarm = null, chipKey = null;

  function build() {
    const beh = h('div', { class: 'behaviour' }, h('span', { class: 'glyph' }), h('div', {}, h('b'), h('small')));
    const chips = h('div', { class: 'chips' });
    const tl = h('div', { class: 'hud-tl' }, beh, chips);
    const camBtn = h('button', { class: 'btn small', type: 'button', onclick: () => {
      const mode = ctx.views.terrarium.toggleCameraMode();
      camBtn.replaceChildren(icon('camera', 15), h('span', {}, mode === 'follow' ? t('Follow cam') : t('Overview')));
    } }, icon('camera', 15), h('span', {}, ctx.views.terrarium.cameraMode === 'follow' ? t('Follow cam') : t('Overview')));
    camBtn.title = t('Switch between the overview and a camera that follows her');
    const zoomIn = h('button', { class: 'btn small icon-only', type: 'button', title: t('Zoom in'), onclick: () => ctx.views.terrarium.setZoom(ctx.views.terrarium.orbit.zoom - 0.15) }, '+');
    const zoomOut = h('button', { class: 'btn small icon-only', type: 'button', title: t('Zoom out'), onclick: () => ctx.views.terrarium.setZoom(ctx.views.terrarium.orbit.zoom + 0.15) }, '–');
    const tr = h('div', { class: 'hud-tr' }, camBtn, zoomIn, zoomOut);
    const br = h('div', { class: 'hud-br' }, t('Drag the fly · move the cursor at her · right-drag to orbit'));
    const toast = h('div', { class: 'why-toast', hidden: true, onclick: () => { if (lastShown) ctx.openEvent?.(lastShown); } });
    root.replaceChildren(tl, tr, br, toast);
    els = { beh, chips, toast, glyph: beh.querySelector('.glyph'), label: beh.querySelector('b'), detail: beh.querySelector('small') };
    shownIcon = null; shownLabel = null; shownAlarm = null; chipKey = null;
  }

  function chipsFor(snap) {
    const out = [];
    const e = snap.env, b = snap.body;
    out.push(h('span', { class: 'chip', title: t('Temperature where she stands') }, icon('thermo', 13), h('b', {}, `${num(b.effectiveTempC, 0)} °C`)));
    if (e.windKmh > 0) out.push(h('span', { class: 'chip' }, icon('wind', 13), `${num(e.windKmh, 0)} km/h`));
    for (const [k, label] of [['rain', 'Rain'], ['iceRain', 'Ice rain'], ['fire', 'Fire'], ['quake', 'Earthquake'], ['smoke', 'Smoke'], ['dust', 'Dust'], ['flood', 'Flood']]) {
      if (e[k]) out.push(h('span', { class: 'chip danger' }, t(label)));
    }
    if (e.dustLoad > 0.05) out.push(h('span', { class: 'chip' }, `${t('Dust on antennae')} ${Math.round(e.dustLoad * 100)}%`));
    if (snap.food.length) out.push(h('span', { class: 'chip' }, icon('drop', 13), t('{n} food drops', { n: snap.food.length })));
    if (snap.genetics.length) out.push(h('span', { class: 'chip accent' }, icon('bolt', 13), t('{n} genetic manipulations', { n: snap.genetics.length })));
    const drugs = Object.values(snap.pharmacology).filter((v) => v !== 1).length;
    if (drugs) out.push(h('span', { class: 'chip accent' }, icon('pill', 13), t('drug active')));
    if (snap.health < 99) out.push(h('span', { class: `chip ${snap.health < 40 ? 'danger' : ''}` }, `${t('Health')} ${Math.round(snap.health)}%`));
    return out;
  }

  // Snapshots arrive with every displayed frame; the page is only touched
  // when something visible changed, and the running numbers at most ten
  // times a second.
  ctx.onFrame((snap) => {
    const b = behaviourOf(snap);
    if (b.key !== lastKey) { lastKey = b.key; since = snap.t; }
    if (b.alarm !== shownAlarm) { shownAlarm = b.alarm; els.beh.classList.toggle('alarm', !!b.alarm); }
    if (b.icon !== shownIcon) { shownIcon = b.icon; els.glyph.replaceChildren(icon(b.icon, 18)); }
    if (b.label !== shownLabel) { shownLabel = b.label; els.label.textContent = b.label; }
    const now = performance.now();
    if (now - textT > 100) {
      textT = now;
      setText(els.detail, `${num(snap.t - since, 1)} s · ${num(snap.fly.speed, 0)} ${t('units/s')}`);
    }
    if (now - chipT > 500) {
      chipT = now;
      const chips = chipsFor(snap), key = chips.map((c) => c.outerHTML).join('');
      if (key !== chipKey) { chipKey = key; els.chips.replaceChildren(...chips); }
    }
    for (const e of snap.events) showEvent(e);
  });

  function showEvent(e) {
    const info = EVENT_INFO[e.kind];
    if (!info) return;
    lastShown = e;
    const trig = e.trigger ? t(TRIGGER_INFO[e.trigger.channel] ?? e.trigger.label) : t('No external trigger — her own network activity');
    els.toast.replaceChildren(
      h('div', { class: 'eyebrow' }, icon('why', 13), t('Why?')),
      h('b', {}, t(info.label)),
      h('span', {}, `${trig}${e.trigger?.latencyMs != null ? ` · ${e.trigger.latencyMs <= 8 ? '≤ 8' : e.trigger.latencyMs} ms` : ''} — ${t('click for the full chain')}`));
    els.toast.hidden = false;
    toastTimer = 6;
  }

  build();
  return {
    frame(dt) {
      if (toastTimer > 0) { toastTimer -= dt; if (toastTimer <= 0) els.toast.hidden = true; }
    },
    rebuild: build,
  };
}
