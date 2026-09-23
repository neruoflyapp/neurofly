// app.js — NeuroFly's page: boots the data, starts the simulation thread, and
// draws what it reports. Everything that simulates lives in the workers
// (sim-worker.js for the live fly, lab-worker.js for experiments); this page
// renders the terrarium and the connectome, hosts the panels, and turns the
// user's actions into commands.

import { SimClient } from './sim-client.js';
import { TerrariumView } from './view/terrarium.js';
import { BrainView } from './view/brain.js';
import { t, getLanguage, setLanguage } from './i18n.js';
import { h, icon } from './ui/dom.js';
import { buildShell } from './ui/shell.js';
import { buildDock } from './ui/dock.js';
import { buildInspector } from './ui/inspector.js';
import { buildHud } from './ui/hud.js';
import { livePanel } from './ui/panel-live.js';
import { stimulatePanel } from './ui/panel-stimulate.js';
import { circuitPanel } from './ui/panel-circuit.js';
import { experimentsPanel } from './ui/panel-experiments.js';
import { sentiencePanel } from './ui/panel-sentience.js';
import { dataPanel } from './ui/panel-data.js';
import { modelPanel } from './ui/panel-model.js';
import { specimensPanel } from './ui/panel-specimens.js';
import { AdaptiveRenderQuality } from '../src/performance.js';

const api = window.flyAPI;
const bootLine = document.getElementById('bootLine');
const bootBar = document.getElementById('bootBar');
const boot = (text, fraction) => { bootLine.textContent = t(text); bootBar.style.width = `${Math.round(fraction * 100)}%`; };
document.documentElement.lang = getLanguage();

// ---- shared context for every panel -------------------------------------------------
const ctx = {
  api, t,
  client: null,
  snap: null,
  info: null,
  data: null,
  views: {},
  state: {
    mapVisible: false, mapField: 'occupancy', recordFormat: 'csv', selectedNeuron: null,
    experiments: new Map(),        // protocolId -> { status, fraction, eta, result }
    lastEvents: [],
  },
  listeners: new Set(),
  onFrame(fn) { this.listeners.add(fn); return () => this.listeners.delete(fn); },
  command(name, args, opts) { return this.client.command(name, args, opts); },
  request(what, args) { return this.client.request(what, args); },
  toast(message, kind = '') {
    const el = h('div', { class: `toast ${kind}` }, message);
    document.getElementById('toasts').append(el);
    setTimeout(() => el.remove(), 4200);
  },
  async save(kind, payload, okText) {
    try {
      const res = await api?.[kind]?.(payload);
      if (res?.ok) this.toast(okText ?? t('Saved.'), 'ok');
      else if (res?.reason !== 'canceled') this.toast(t('Saving failed: {reason}', { reason: res?.reason ?? t('no access') }), 'err');
      return res;
    } catch (error) {
      this.toast(t('Saving failed: {reason}', { reason: t(error.message) }), 'err');
      return { ok: false };
    }
  },
  highlight(spec) { this.views.brain?.setHighlight(spec); },
};

// With NEUROFLY_DEBUG=1 the context is reachable from the dev tools.
if (new URLSearchParams(location.search).get('debug') === '1') window.__nf = ctx;

const panels = [livePanel, stimulatePanel, circuitPanel, experimentsPanel, sentiencePanel, dataPanel, modelPanel, specimensPanel];

(async () => {
  boot('Loading the connectome…', 0.08);
  const data = await api.getBrainData();
  if (!data) {
    boot('No connectome data found. Run the ETL scripts first (see README).', 1);
    return;
  }
  ctx.data = data;
  boot('Starting the simulation on its own core…', 0.35);
  const client = new SimClient(new URL('./sim-worker.js', import.meta.url));
  ctx.client = client;
  const terrariumEl = document.getElementById('terrarium');
  const bounds = { width: Math.max(300, terrariumEl.clientWidth), height: Math.max(200, terrariumEl.clientHeight) };
  let info;
  try {
    info = await client.init(data, bounds, undefined, undefined);
  } catch (error) {
    boot(`${t('The simulation could not start:')} ${error.message}`, 1);
    return;
  }
  ctx.info = info;
  boot('Building the terrarium and the brain view…', 0.7);

  ctx.views.terrarium = new TerrariumView(terrariumEl, {
    layout: info.layout,
    onPointer: (p) => client.input({ pointer: p }),
    onCommand: (name, args) => client.command(name, args),
    onVision: (v) => client.input({ vision: v }),
    onTap: (p) => client.command('tap', p),
  });
  ctx.views.brain = new BrainView(document.getElementById('brain'), {
    points: data.points, circuit: data.circuit,
    onPick: (pick) => {
      client.command('stim.cells', { indices: pick.cluster, strength: 0.25, durationMs: 400, label: t('brain-view stimulation') });
      ctx.state.selectedNeuron = pick.nearest;
      ctx.toast(t('Stimulated {n} neurons near {group}.', { n: pick.cluster.length, group: pick.groupLabel ? t(pick.groupLabel) : t('the click') }));
      for (const fn of ctx.listeners) fn(ctx.snap, { pick });
    },
  });

  // ---- layout: shell, panels, dock, inspector, HUD ----
  const shell = buildShell(ctx, panels);
  ctx.shell = shell;
  const dock = buildDock(ctx);
  const inspector = buildInspector(ctx);
  const hud = buildHud(ctx);

  // ambient OS signals and tray commands from the main process
  api.onAmbient((a) => client.input({ ambient: { typing: a.typing, sleepy: a.sleepy, activity: a.activity } }));
  api.onCommand((c) => {
    if (c.name === 'pause') { client.command('pause', { paused: c.value }); }
    else if (['addFly', 'removeFly', 'scareAll'].includes(c.name)) client.command(c.name);
  });

  // ---- frames from the simulation ----
  const quality = new AdaptiveRenderQuality({ minPixelRatio: 0.75, maxPixelRatio: Math.min(window.devicePixelRatio || 1, 1.5) });
  let fpsFrames = 0, fpsT = performance.now(), fps = 0;
  client.onFrame((snap) => {
    ctx.snap = snap;
    ctx.views.terrarium.applySnapshot(snap);
    ctx.views.brain.addSpikes(snap.spikes);
    ctx.views.brain.setFear(snap.rates);
    if (snap.map) ctx.views.terrarium.paintMap(snap.map);
    if (snap.events.length) {
      ctx.state.lastEvents.push(...snap.events);
      // This is a UI convenience buffer, not the recording or scientific journal.
      if (ctx.state.lastEvents.length > 500) ctx.state.lastEvents.splice(0, ctx.state.lastEvents.length - 500);
    }
    for (const fn of ctx.listeners) fn(snap, {});
  });

  // ---- render loop (the page draws; it never simulates) ----
  let last = null;
  const frame = (tMs) => {
    requestAnimationFrame(frame);
    const now = tMs / 1000;
    const dt = last === null ? 1 / 60 : Math.min(0.1, now - last);
    last = now;
    fpsFrames++;
    if (tMs - fpsT >= 1000) {
      fps = fpsFrames * 1000 / (tMs - fpsT); fpsFrames = 0; fpsT = tMs;
      ctx.fps = fps;
      const perf = ctx.snap?.perf;
      const next = quality.observe({ fps, simulationRealtime: perf && !ctx.snap.paused ? Math.min(perf.simulationRealtime / Math.max(0.1, ctx.snap.speed), 1) : 1, droppedSecondsPerSecond: ctx.snap?.paused ? 0 : (perf?.droppedSecondsPerSecond ?? 0) });
      ctx.views.terrarium.setPixelRatio(next);
      ctx.pixelRatio = next;
    }
    ctx.views.terrarium.frame(dt, now);
    ctx.views.brain.frame(tMs);
    dock.frame(dt);
    hud.frame(dt);
  };
  requestAnimationFrame(frame);

  // ---- resize: the terrarium's arena follows its pane ----
  let resizeTimer = null;
  new ResizeObserver(() => {
    clearTimeout(resizeTimer);
    resizeTimer = setTimeout(() => {
      if (ctx.views.terrarium.resize()) client.command('resize', ctx.views.terrarium.bounds);
    }, 120);
  }).observe(terrariumEl);

  inspector.ready();
  boot('Ready.', 1);
  setTimeout(() => document.getElementById('boot').classList.add('done'), 250);
  setTimeout(() => document.getElementById('boot').remove(), 900);
  console.info(`NeuroFly: ${data.circuit.neurons.length} brain neurons, ${data.locomotor?.neurons?.length ?? 0} nerve-cord neurons; simulation in a worker at 120 Hz`);

  // language switch rebuilds the interface in place; the simulation continues
  ctx.relabel = (lang) => {
    setLanguage(lang);
    shell.rebuild();
    dock.rebuild();
    inspector.rebuild();
    hud.rebuild();
  };
  void icon;
})();
