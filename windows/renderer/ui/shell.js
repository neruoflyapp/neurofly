// shell.js — top bar, workspace rail, panel host, help, keyboard.

import { h, icon } from './dom.js';
import { t, getLanguage, num } from '../i18n.js';

export function buildShell(ctx, panels) {
  const rail = document.getElementById('rail');
  const panelHost = document.getElementById('panel');
  const status = document.getElementById('runStatus');
  const actions = document.getElementById('topActions');
  let active = null;
  let current = null;           // { el, update, dispose }
  try { active = localStorage.getItem('neurofly.workspace'); } catch { /* optional */ }
  if (!panels.some((p) => p.id === active)) active = panels[0].id;

  // ---- top bar ----
  const pill = h('span', { class: 'pill', 'data-state': 'running' }, h('span', { class: 'dot' }), h('span', { class: 'label' }));
  const session = h('span', { class: 'session' });
  const sessionTime = h('b'), sessionSeed = h('b'), sessionSpeed = h('b');
  const timeLabel = document.createTextNode(''), seedLabel = document.createTextNode('');
  const flyLabel = document.createTextNode(''), flyNumber = document.createTextNode('');
  const speedLabel = document.createTextNode('');
  const sessionGap = h('span', { style: { color: 'var(--amber, #f0c66a)' } });
  sessionGap.hidden = true;
  session.append(sessionTime, timeLabel, seedLabel, sessionSeed, flyLabel, flyNumber,
    document.createTextNode(' · '), sessionSpeed, speedLabel, sessionGap);
  const speeds = [0.25, 0.5, 1, 2, 4];
  const speedSeg = h('div', { class: 'seg', role: 'group' });
  const pauseBtn = h('button', { class: 'btn', type: 'button' });
  const recordText = h('span');
  const recordBtn = h('button', { class: 'btn', type: 'button' }, icon('record', 14), recordText);
  const snapBtn = h('button', { class: 'btn ghost icon-only', type: 'button' }, icon('camera'));
  const focusStimBtn = h('button', { id: 'focusStim', class: 'btn', type: 'button' }, icon('loom', 16), h('span', {}, t('Looming threat')));
  const focusBtn = h('button', { id: 'focusMode', class: 'btn ghost icon-only', type: 'button', 'aria-pressed': 'false' }, icon('expand'));
  const langBtn = h('button', { class: 'btn ghost small', type: 'button' });
  const inspectorBtn = h('button', { class: 'btn ghost icon-only', type: 'button' }, icon('layers'));
  const helpBtn = h('button', { class: 'btn ghost icon-only', type: 'button' }, icon('help'));
  status.append(pill, session);
  actions.append(speedSeg, pauseBtn, recordBtn, snapBtn, langBtn, inspectorBtn, focusStimBtn, focusBtn, helpBtn);

  function labelTop() {
    speedSeg.replaceChildren(...speeds.map((s) => h('button', { type: 'button', 'aria-pressed': String((ctx.snap?.speed ?? 1) === s),
      title: t('Simulation speed: {s}× real time. Faster runs need a faster CPU; the model itself is unchanged.', { s }),
      onclick: () => ctx.command('speed', { factor: s }) }, `${s}×`)));
    snapBtn.title = t('Save a picture of the window');
    langBtn.textContent = getLanguage() === 'de' ? 'EN' : 'DE';
    langBtn.title = getLanguage() === 'de' ? 'Switch to English' : 'Auf Deutsch umschalten';
    inspectorBtn.title = t('Show or hide the connectome and the explanations');
    focusBtn.title = t('Focus view: fly, activity and explanation');
    focusBtn.setAttribute('aria-label', focusBtn.title);
    focusStimBtn.querySelector('span:last-child').textContent = t('Looming threat');
    focusStimBtn.title = t('Send a brief visual looming stimulus (model)');
    helpBtn.title = t('Quick guide');
    timeLabel.nodeValue = ` ${t('neural time')} · `;
    seedLabel.nodeValue = `${t('seed')} `;
    flyLabel.nodeValue = ` · ${t('fly')} #`;
    speedLabel.nodeValue = ` ${t('real time')}`;
    sessionGap.title = t('Time not simulated for this fly during overload; not biological inactivity.');
  }
  pauseBtn.addEventListener('click', () => ctx.command('pause', { paused: !ctx.snap?.paused }));
  recordBtn.addEventListener('click', () => ctx.toggleRecording());
  snapBtn.addEventListener('click', () => ctx.save('saveSnapshot', undefined, t('Picture saved.')));
  langBtn.addEventListener('click', () => ctx.relabel(getLanguage() === 'de' ? 'en' : 'de'));
  inspectorBtn.addEventListener('click', () => {
    document.body.classList.toggle('inspector-collapsed');
    setTimeout(() => window.dispatchEvent(new Event('resize')), 50);
  });
  function setFocus(on) {
    document.body.classList.toggle('focus-mode', on);
    focusBtn.setAttribute('aria-pressed', String(on));
    focusBtn.classList.toggle('on', on);
    // Both WebGL canvases measure their parent, so reflow them after layout.
    setTimeout(() => window.dispatchEvent(new Event('resize')), 50);
  }
  focusBtn.addEventListener('click', () => setFocus(!document.body.classList.contains('focus-mode')));
  focusStimBtn.addEventListener('click', () => {
    ctx.command('stim.loom', { strength: 0.8 });
    focusStimBtn.classList.add('on');
    setTimeout(() => focusStimBtn.classList.remove('on'), 650);
  });

  ctx.toggleRecording = async () => {
    const snap = ctx.snap;
    if (!snap || ctx.state.recordingBusy) return;
    ctx.state.recordingBusy = true;
    recordBtn.disabled = true;
    try {
      if (!snap.recording.active && !snap.recording.rows) {
        const started = await ctx.command('record.start', {}, { reply: true });
        if (started) ctx.toast(t('Recording started — every measurement at 20 Hz.'), 'ok');
        else ctx.toast(t('The recording is kept in memory — save it from the Data workspace.'));
        return;
      }
      // Freeze the chosen format across asynchronous worker/dialog replies.
      const format = ctx.state.recordFormat;
      const res = await ctx.request('stopRecording', { format });
      if (!res?.rows) { ctx.toast(t('Nothing was recorded.')); return; }
      const saved = await ctx.save(format === 'bundle' ? 'saveExperiment' : 'saveRecording', res.content,
        t('{rows} rows saved.', { rows: res.rows }));
      if (saved?.ok) await ctx.request('clearRecording');
      else ctx.toast(t('The recording is kept in memory — save it from the Data workspace.'));
    } catch (error) {
      ctx.toast(error?.message || String(error), 'err');
    } finally {
      ctx.state.recordingBusy = false;
      recordBtn.disabled = false;
    }
  };

  // ---- rail and panels ----
  function renderRail() {
    rail.replaceChildren(...panels.map((p, i) => {
      const b = h('button', { type: 'button', role: 'tab', 'aria-selected': String(p.id === active), title: `${t(p.title)} (${i + 1})`,
        onclick: () => select(p.id) }, icon(p.icon, 22), h('span', {}, t(p.short ?? p.title)));
      return b;
    }));
  }

  function select(id) {
    if (!panels.some((p) => p.id === id)) return;
    active = id;
    try { localStorage.setItem('neurofly.workspace', id); } catch { /* optional */ }
    mount();
    renderRail();
  }

  function mount() {
    current?.dispose?.();
    const p = panels.find((x) => x.id === active);
    current = p.build(ctx);
    panelHost.replaceChildren(current.el);
    panelHost.scrollTop = 0;
    if (ctx.snap) {
      current.update?.(ctx.snap, {});
      updateTop(ctx.snap);
    }
  }

  let updateT = 0;
  ctx.onFrame((snap, extra) => {
    const nowMs = performance.now();
    if (extra?.pick || nowMs - updateT > 120) {
      updateT = nowMs;
      current?.update?.(snap, extra || {});
      updateTop(snap);
    }
  });

  let pauseVisual = null, pauseLanguage = null;
  function updateTop(snap) {
    const state = snap.dead ? 'dead' : snap.paused ? 'paused' : 'running';
    pill.dataset.state = state;
    pill.querySelector('.label').textContent = t(state === 'dead' ? 'Dead' : state === 'paused' ? 'Paused' : 'Live');
    const timeText = `${num(snap.neuralMs / 1000, 1)} s`;
    const seedText = String(snap.seed);
    const flyText = String(snap.individual);
    const speedText = `${num(snap.perf.simulationRealtime, 2)}×`;
    if (sessionTime.textContent !== timeText) sessionTime.textContent = timeText;
    if (sessionSeed.textContent !== seedText) sessionSeed.textContent = seedText;
    if (flyNumber.nodeValue !== flyText) flyNumber.nodeValue = flyText;
    if (sessionSpeed.textContent !== speedText) sessionSpeed.textContent = speedText;
    const lost = snap.perf.runDroppedSimulationSeconds ?? snap.perf.totalDroppedSimulationSeconds;
    sessionGap.hidden = !(lost > 0);
    if (lost > 0) sessionGap.textContent = ` · Δt ${num(lost, 2)} s`;
    const language = getLanguage();
    if (pauseVisual !== snap.paused || pauseLanguage !== language) {
      pauseBtn.replaceChildren(icon(snap.paused ? 'play' : 'pause', 16), h('span', {}, t(snap.paused ? 'Resume' : 'Pause')));
      pauseVisual = snap.paused;
      pauseLanguage = language;
    }
    pauseBtn.classList.toggle('on', snap.paused);
    pauseBtn.title = t('Pause or resume the whole simulation (Space)');
    recordText.textContent = snap.recording.active ? `${t('Stop')} · ${snap.recording.rows}`
      : snap.recording.rows ? t('Save the kept recording') : t('Record');
    recordBtn.classList.toggle('recording', snap.recording.active);
    recordBtn.title = t('Record every measurement as a CSV table at 20 Hz');
    for (const b of speedSeg.children) b.setAttribute('aria-pressed', String(b.textContent === `${snap.speed}×`));
  }

  // ---- help ----
  const help = h('dialog', { id: 'help' });
  document.body.append(help);
  function renderHelp() {
    help.replaceChildren(h('form', { method: 'dialog' },
      h('div', { class: 'eyebrow' }, t('Quick guide')),
      h('h2', {}, t('A fruit fly, neuron by neuron.')),
      h('p', {}, t('The fly in the middle is driven by a real brain wiring diagram: every movement comes from simulated neurons connected exactly as in the FlyWire connectome. On the right you see the same brain in 3D, firing. Below it, the explanation panel tells you why she did what she just did.')),
      h('dl', {},
        h('dt', {}, t('Left click the fly')), h('dd', {}, t('touch her; drag and release to flick her away')),
        h('dt', {}, t('Move the cursor fast at her')), h('dd', {}, t('a looming threat — watch the giant fiber')),
        h('dt', {}, t('Right drag · wheel')), h('dd', {}, t('orbit and zoom the camera')),
        h('dt', {}, t('Click the brain')), h('dd', {}, t('stimulate the neurons you clicked')),
        h('dt', {}, 'Space'), h('dd', {}, t('pause or resume')),
        h('dt', {}, `1 – ${panels.length}`), h('dd', {}, t('switch workspaces')),
        h('dt', {}, 'L'), h('dd', {}, t('send a looming stimulus'))),
      h('p', { class: 'note' }, t('Wiring and synapse counts are measured; neuron dynamics, senses and body are models. Every tag in the app says which is which.')),
      h('div', { class: 'row', style: { marginTop: '16px' } }, h('button', { class: 'btn primary' }, t('Start exploring')))));
  }
  helpBtn.addEventListener('click', () => { renderHelp(); help.showModal(); });
  let firstRun = true;
  try { firstRun = !localStorage.getItem('neurofly.seenHelp'); localStorage.setItem('neurofly.seenHelp', '1'); } catch { /* optional */ }
  if (firstRun) setTimeout(() => { renderHelp(); help.showModal(); }, 1400);

  document.addEventListener('keydown', (e) => {
    if (e.key === 'Escape' && document.body.classList.contains('focus-mode')) { setFocus(false); return; }
    if (e.target.closest?.('input,select,textarea,[contenteditable]') || e.ctrlKey || e.metaKey || e.altKey || help.open) return;
    if (e.code === 'Space') { e.preventDefault(); ctx.command('pause', { paused: !ctx.snap?.paused }); }
    else if (/^Digit[1-9]$/.test(e.code) && panels[Number(e.code.slice(5)) - 1]) select(panels[Number(e.code.slice(5)) - 1].id);
    else if (e.key === 'l' || e.key === 'L') ctx.command('stim.loom', { strength: 0.8 });
  });

  labelTop();
  renderRail();
  mount();
  return {
    select,
    rebuild() { labelTop(); renderRail(); mount(); },
    get active() { return active; },
  };
}
