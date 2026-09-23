// dock.js — the measurement strip under the terrarium: live population
// traces, the body and its legs, and what her own eye sees.

import { h, icon } from './dom.js';
import { t, num } from '../i18n.js';
import { Scope } from './charts.js';

const CHANNELS = [
  { key: 'gf', label: 'Giant fiber', color: '#fff266', max: 20, on: true },
  { key: 'loomL', label: 'Looming L', color: '#28d9ff', max: 40, on: true },
  { key: 'loomR', label: 'Looming R', color: '#6fb8ff', max: 40, on: true },
  { key: 'joA', label: 'JO hearing', color: '#9dff5c', max: 40, on: true },
  { key: 'fwd', label: 'Walk DNp09', color: '#40ff59', max: 15, on: true },
  { key: 'dng12', label: 'Head groom DNg12', color: '#cc73ff', max: 60, on: true },
  { key: 'proboscis', label: 'Proboscis MNs', color: '#ff9926', max: 60, on: true },
  { key: 'groom', label: 'Leg rub DNg11', color: '#bf8cff', max: 10, on: false },
  { key: 'mdn', label: 'Backward MDN', color: '#ff33cc', max: 15, on: false },
  { key: 'dnaL', label: 'Steer L', color: '#ff8c1a', max: 15, on: false },
  { key: 'dnaR', label: 'Steer R', color: '#ffb366', max: 15, on: false },
  { key: 'joW', label: 'JO wind', color: '#5cffc8', max: 40, on: false },
  { key: 'joF', label: 'JO-F touch', color: '#66ffd9', max: 40, on: false },
  { key: 'sugar', label: 'Sugar GRN', color: '#ffdb4d', max: 60, on: false },
  { key: 'bitter', label: 'Bitter GRN', color: '#73e659', max: 60, on: false },
  { key: 'hot', label: 'Hot cells', color: '#ff4714', max: 40, on: false },
  { key: 'cold', label: 'Cold cells', color: '#5999ff', max: 40, on: false },
  { key: 'ascend', label: 'Body feedback', color: '#b28cff', max: 20, on: false },
  { key: 'pop', label: 'Whole brain', color: '#c9d6d1', max: 15, on: false },
];

export function buildDock(ctx) {
  const root = document.getElementById('dock');
  let enabled = new Set(CHANNELS.filter((c) => c.on).map((c) => c.key));
  try { const saved = JSON.parse(localStorage.getItem('neurofly.channels')); if (Array.isArray(saved) && saved.length) enabled = new Set(saved); } catch { /* optional */ }
  let tab = 'signals';
  let els = {};
  const scope = { obj: null };
  const pendingSamples = [];
  // Footfall history for the gait diagram: simulated time and which feet
  // touch the ground (the observable, as in a real footfall diagram).
  const gait = [];
  const GAIT_SECONDS = 3;
  // Tripods one above the other: RF, LM, RH step together, then LF, RM, LH.
  const GAIT_ROWS = [0, 3, 4, 1, 2, 5], LEG_NAMES = ['RF', 'LF', 'RM', 'LM', 'RH', 'LH'];

  function build() {
    const tabs = [['signals', t('Neural activity')], ['body', t('Body & legs')], ['eye', t("Her eye")]];
    const tabBar = h('div', { class: 'dock-tabs', role: 'tablist' }, ...tabs.map(([k, label]) => h('button', { type: 'button', role: 'tab', 'aria-selected': String(k === tab), onclick: () => { tab = k; build(); } }, label)));
    const right = h('div', { class: 'right' });
    tabBar.append(right);
    const body = h('div', { class: 'dock-body' });
    if (tab === 'signals') {
      const canvas = h('canvas', { class: 'scope' });
      const toggles = h('div', { class: 'channel-toggles' }, ...CHANNELS.map((c) => h('button', { type: 'button', 'aria-pressed': String(enabled.has(c.key)), style: { borderLeft: `3px solid ${c.color}` },
        onclick: (e) => { if (enabled.has(c.key)) enabled.delete(c.key); else enabled.add(c.key); e.currentTarget.setAttribute('aria-pressed', String(enabled.has(c.key)));
          try { localStorage.setItem('neurofly.channels', JSON.stringify([...enabled])); } catch { /* optional */ }
          applyChannels(); } }, t(c.label))));
      const togglePane = h('div', { class: 'dock-page', style: { left: 'auto', width: '210px', borderLeft: '1px solid var(--line)', padding: '10px' } },
        h('div', { class: 'note', style: { margin: '0 0 6px' } }, t('Traces: firing rate per neuron, last 20 simulated seconds.')), toggles);
      const scopePane = h('div', { class: 'dock-page', style: { right: '210px', padding: '6px 8px' } }, canvas);
      body.append(scopePane, togglePane);
      const prev = scope.obj;
      scope.obj = new Scope(canvas, { seconds: 20, hz: 20 });
      if (prev) { scope.obj.times = prev.times; scope.obj.data = prev.data; }
      applyChannels();
    } else if (tab === 'body') {
      const legRows = ['RF', 'LF', 'RM', 'LM', 'RH', 'LH'].map((name, i) => h('tr', {}, h('td', {}, name), h('td', { dataset: { k: `c${i}` } }), h('td', { dataset: { k: `l${i}` } }), h('td', { dataset: { k: `h${i}` } }), h('td', { dataset: { k: `n${i}` } })));
      const legs = h('table', { class: 'leg-table' }, h('thead', {}, h('tr', {}, h('th', {}, t('Leg')), h('th', {}, t('Contact')), h('th', {}, t('Load')), h('th', {}, t('Hip')), h('th', {}, t('Knee')))), h('tbody', {}, legRows));
      const kv = h('dl', { class: 'kv' });
      const gaitCanvas = h('canvas', { class: 'gait', width: 600, height: 132,
        'aria-label': t('Footfall diagram: when each foot touches the ground (filled) over the last {s} simulated seconds', { s: GAIT_SECONDS }) });
      const gaitInfo = h('div', { class: 'note', style: { margin: '4px 0 0' } });
      body.append(h('div', { class: 'dock-page' }, h('div', { class: 'dock-cols' },
        h('div', {}, h('div', { class: 'note', style: { margin: '0 0 4px' } }, t('Leg mechanics, computed live (modelled joints; MaleCNS nerve-cord commands)')), legs,
          h('div', { class: 'note', style: { margin: '10px 0 4px' } }, t('Footfalls — ground contact filled (stepping rules: model; path to the muscles: measured cord)')), gaitCanvas, gaitInfo),
        h('div', {}, h('div', { class: 'note', style: { margin: '0 0 4px' } }, t('Brain ↔ nerve cord and body state')), kv))));
      els.legs = legs; els.kv = kv; els.gait = gaitCanvas; els.gaitInfo = gaitInfo;
    } else {
      const raw = h('canvas', { width: 64, height: 24 });
      const motion = h('canvas', { width: 64, height: 24 });
      body.append(h('div', { class: 'dock-page' }, h('div', { class: 'eye-wrap' },
        h('div', {}, h('p', { class: 'cap' }, t('What she sees — a real render from her head, 64 × 24 samples, 150°')), raw),
        h('div', {}, h('p', { class: 'cap' }, t('What reaches LC4/LPLC2 — motion energy after centre-surround')), motion)),
        h('p', { class: 'note' }, t('Left half: her left eye. Only what lights up on the right drives the looming neurons; broad self-motion is cancelled by the centre-surround stage.')),
        h('div', { class: 'row', style: { marginTop: '6px' } }, h('span', { class: 'note', dataset: { k: 'eyeval' } }))));
      ctx.views.terrarium.visionPreview = { rawCtx: raw.getContext('2d'), motionCtx: motion.getContext('2d') };
      els.eyeVal = body.querySelector('[data-k=eyeval]');
    }
    if (tab !== 'eye') ctx.views.terrarium.visionPreview = null;
    root.replaceChildren(tabBar, body);
    void right; void icon;
  }

  function applyChannels() {
    scope.obj?.setChannels(CHANNELS.filter((c) => enabled.has(c.key)).map((c) => ({ ...c, label: t(c.label) })));
  }

  function drawGait(snap) {
    const canvas = els.gait;
    if (!canvas?.isConnected) return;
    const g = canvas.getContext('2d'), W = canvas.width, H = canvas.height;
    const label = 52, rowH = H / 6, now = snap.t;
    g.clearRect(0, 0, W, H);
    g.font = '600 19px "Cascadia Mono", Consolas, monospace';
    g.textBaseline = 'middle';
    GAIT_ROWS.forEach((leg, row) => {
      const y = row * rowH;
      g.fillStyle = row < 3 ? '#8ea39d' : '#5f736d';
      g.fillText(LEG_NAMES[leg], 4, y + rowH / 2);
      g.fillStyle = '#152020';
      g.fillRect(label, y + 3, W - label, rowH - 6);
    });
    g.fillStyle = '#00ff41';
    let touchdowns = 0, since = null;
    for (let k = 1; k < gait.length; k++) {
      const a = gait[k - 1], b = gait[k];
      const x0 = label + (1 - (now - a.t) / GAIT_SECONDS) * (W - label), x1 = label + (1 - (now - b.t) / GAIT_SECONDS) * (W - label);
      if (x1 <= label) continue;
      since ??= a.t;
      GAIT_ROWS.forEach((leg, row) => {
        if (a.contact[leg]) g.fillRect(Math.max(label, x0), row * rowH + 4, Math.max(1, x1 - Math.max(label, x0)), rowH - 8);
        if (b.contact[leg] && !a.contact[leg]) touchdowns++;
      });
    }
    g.fillStyle = '#22302d';
    g.fillRect(label, H / 2 - 0.5, W - label, 1);
    const span = since === null ? 0 : now - since;
    const rate = span > 1 ? touchdowns / 6 / span : 0;
    els.gaitInfo.textContent = !snap.stepping ? t('Stepping rules off (no matching rhythm decoder): the cord runs on its measured wiring alone.')
      : snap.fly.state === 'walking' && snap.stepping.active ? t('{hz} steps per second per leg · {dir}', { hz: num(rate, 1), dir: snap.stepping.direction < 0 ? t('backward') : t('forward') })
        : t('Not walking.');
  }

  let bodyT = 0, drawT = 0, gaitT = 0;
  ctx.onFrame((snap) => {
    if (snap.legs?.length === 6) {
      if (gait.length && snap.t < gait.at(-1).t) gait.length = 0;     // reset or new run
      gait.push({ t: snap.t, contact: snap.legs.map((f) => f.contact) });
      while (gait.length > 2 && snap.t - gait[1].t > GAIT_SECONDS + 0.5) gait.shift();
    }
    if (snap.trace.length) {
      pendingSamples.push(...snap.trace);
      if (scope.obj) { scope.obj.push(pendingSamples.splice(0)); }
    }
    const now = performance.now();
    if (tab === 'body' && now - bodyT > 200) {
      bodyT = now;
      snap.legs.forEach((f, i) => {
        const set = (k, v, on) => { const td = els.legs.querySelector(`[data-k=${k}${i}]`); if (td) { td.textContent = v; if (on !== undefined) td.classList.toggle('on', on); } };
        set('c', f.contact ? '●' : '—', f.contact);
        set('l', `${Math.round(f.load * 100)}%`);
        set('h', `${Math.round(f.hip * 57.3)}°`);
        set('n', `${Math.round(f.knee * 57.3)}°`);
      });
      const hh = snap.hierarchy, b = snap.body;
      const rows = [
        [t('↓ walking command to nerve cord'), `${num(hh.cordFwd, 1)} Hz`], [t('↓ steering'), `${num(hh.cordSteer, 1)} Hz`],
        [t('↓ backward'), `${num(hh.cordBack, 1)} Hz`], [t('nerve-cord sensory neurons'), `${num(hh.vncSens, 1)} Hz`],
        [t('nerve-cord motor neurons'), `${num(hh.vncMotor, 1)} Hz`], [t('↑ arriving in the brain'), `${num(hh.brainAscend, 1)} Hz`],
        [t('life support (cold × oxygen)'), `${Math.round(b.lifeSupport * 100)}%`], [t('wetness'), `${Math.round(b.wetness * 100)}%`],
        [t('temperature tempo'), `${num(b.tempo, 2)}×`], [t('scent here (no olfactory neurons)'), `${Math.round(b.smell * 100)}%`],
      ];
      els.kv.replaceChildren(...rows.flatMap(([k, v]) => [h('dt', {}, k), h('dd', {}, v)]));
    }
    if (tab === 'body' && now - gaitT > 50) { gaitT = now; drawGait(snap); }
    if (tab === 'eye' && els.eyeVal) els.eyeVal.textContent = `${t('motion energy')} L ${num(snap.inputs.visionL * 100, 2)} · R ${num(snap.inputs.visionR * 100, 2)}`;
    void drawT;
  });

  build();
  return {
    frame() {
      const now = performance.now();
      if (tab === 'signals' && scope.obj && now - drawT > 45) { drawT = now; scope.obj.draw(); }
    },
    rebuild: build,
  };
}
