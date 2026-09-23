// panel-stimulate.js — every sense, the world and the body, as controls.
// Everything here changes what she experiences (unlike the view settings).

import { h, icon } from './dom.js';
import { t, num } from '../i18n.js';
import { panelHead, card, slider, toggle, action, tag } from './widgets.js';

export const stimulatePanel = {
  id: 'stimulate', icon: 'stimulate', title: 'Stimulate', short: 'Stimulate',
  build(ctx) {
    const cmd = (name, args) => ctx.command(name, args);
    const env = ctx.snap?.env ?? {};
    const set = (key) => (v) => cmd('env.set', { key, value: v });

    // vision
    let loomStrength = 0.6;
    const loom = slider({ label: t('Looming strength'), min: 0.05, max: 1, step: 0.01, value: loomStrength, format: (v) => num(v, 2), onInput: (v) => { loomStrength = v; } });
    const vision = card(t('Vision'), { iconName: 'loom', tagEl: tag('model', t('transduction model')) },
      loom.el,
      h('div', { class: 'grid3', style: { marginTop: '10px' } },
        h('button', { class: 'btn small', type: 'button', onclick: () => cmd('stim.burst', { channel: 'loomL', level: loomStrength, durationS: 0.3, label: t('loom, left eye') }) }, t('Left eye')),
        h('button', { class: 'btn small primary', type: 'button', onclick: () => { cmd('stim.burst', { channel: 'loomL', level: loomStrength, durationS: 0.3, label: t('loom, both eyes') }); cmd('stim.burst', { channel: 'loomR', level: loomStrength, durationS: 0.3, label: t('loom, both eyes') }); } }, t('Both eyes')),
        h('button', { class: 'btn small', type: 'button', onclick: () => cmd('stim.burst', { channel: 'loomR', level: loomStrength, durationS: 0.3, label: t('loom, right eye') }) }, t('Right eye'))),
      h('p', { class: 'note' }, t('Drives the 314 real LC4/LPLC2 looming neurons of one or both eyes for 300 ms. Her rendered eye also feeds them continuously: move the cursor at her, or drag an object towards her face.')));

    // antenna
    const wind = slider({ label: t('Wind'), min: 0, max: 80, step: 1, value: env.windKmh ?? 0, format: (v) => `${v} km/h`, onInput: set('windKmh'),
      title: t('Pushes her body and deflects the arista: drives JO-C/D/E wind neurons, not the hearing neurons.') });
    const windDir = slider({ label: t('Wind direction'), min: 0, max: 359, step: 1, value: env.windDirDeg ?? 90, format: (v) => `${v}°`, onInput: set('windDirDeg') });
    const antenna = card(t("Antennae · Johnston's organ"), { iconName: 'antenna', tagEl: tag('measured', t('real JO neurons')) },
      h('div', { class: 'grid3' },
        h('button', { class: 'btn small', type: 'button', onclick: () => cmd('stim.burst', { channel: 'puff', level: 0.8, durationS: 0.3, label: t('air puff') }) }, t('Air puff')),
        h('button', { class: 'btn small', type: 'button', onclick: () => cmd('stim.burst', { channel: 'sound', level: 0.8, durationS: 0.6, label: t('sound') }) }, t('Sound')),
        h('button', { class: 'btn small', type: 'button', onclick: () => cmd('antenna.dust', { amount: 1 }) }, t('Dust'))),
      wind.el, windDir.el,
      h('p', { class: 'note' }, t('Sound reaches JO-A/B (176 neurons, strongly wired to the giant fiber); wind reaches JO-C/D/E (18); dust reaches the JO-F grooming neurons (204). Same strength, different neurons — the wiring decides the outcome.')));

    // temperature
    const temp = slider({ label: t('Temperature'), min: -10, max: 45, step: 1, value: env.tempC ?? 24, format: (v) => `${v} °C`, onInput: set('tempC'),
      title: t('Reaches the real hot and cold cells; below 10 °C cold torpor slows her nervous system.') });
    const grad = slider({ label: t('Thermal gradient (west → east)'), min: 0, max: 40, step: 1, value: env.tempGradientC ?? 0, format: (v) => (v ? `±${v / 2} °C` : t('off')), onInput: set('tempGradientC') });
    const thermo = card(t('Temperature'), { iconName: 'thermo', tagEl: tag('measured', t('real thermosensors')) }, temp.el, grad.el,
      h('p', { class: 'note' }, t('7 hot and 9 cold cells from FlyWire, with their real downstream wiring. They respond mainly to temperature change (Gallio et al. 2011) — walking along the gradient is what changes their input.')));

    // taste
    let sugar = 0.7, bitter = 0;
    const sug = slider({ label: t('Sugar'), min: 0, max: 1, step: 0.05, value: sugar, format: (v) => num(v, 2), onInput: (v) => { sugar = v; } });
    const bit = slider({ label: t('Bitter'), min: 0, max: 1, step: 0.05, value: bitter, format: (v) => num(v, 2), onInput: (v) => { bitter = v; } });
    const taste = card(t('Taste'), { iconName: 'drop', tagEl: tag('measured', t('real taste neurons')) }, sug.el, bit.el,
      h('div', { class: 'grid2', style: { marginTop: '10px' } },
        h('button', { class: 'btn small primary', type: 'button', onclick: () => cmd('taste.offer', { sugar, bitter, durationS: 2.5 }) }, t('Offer to her mouthparts')),
        h('button', { class: 'btn small', type: 'button', onclick: () => cmd('food.add', { kind: bitter > 0 && sugar > 0 ? 'mixed' : bitter > 0 ? 'bitter' : 'sugar', conc: Math.max(sugar, bitter), bitter }) }, t('Place a drop')),
        h('button', { class: 'btn small ghost', type: 'button', onclick: () => cmd('food.clear') }, t('Remove drops'))),
      h('p', { class: 'note' }, t('129 sugar/water and 65 bitter taste neurons of the labellum, and the 56 proboscis and feeding motor neurons, joined by the strongest real paths between them. Drops can be dragged.')));

    // weather and hazards
    const hazardButtons = {};
    const hz = (key, label, title) => {
      const b = toggle(t(label), env[key], (btn) => { cmd('env.toggle', { key }); btn.setAttribute('aria-pressed', String(btn.getAttribute('aria-pressed') !== 'true')); }, t(title));
      hazardButtons[key] = b;
      return b;
    };
    const gravity = slider({ label: t('Gravity'), min: 1, max: 5, step: 0.1, value: env.gravity ?? 1, format: (v) => `${num(v, 1)}×`, onInput: set('gravity'),
      title: t('Above 2.5× she cannot fly; the load her leg sensors report rises.') });
    const oxygen = slider({ label: t('Oxygen'), min: 0, max: 100, step: 1, value: env.oxygenPct ?? 100, format: (v) => `${v}%`, onInput: set('oxygenPct'),
      title: t('Scales the neural baseline drive; below 10% her network falls almost silent.') });
    const world = card(t('Weather & hazards'), { iconName: 'world', tagEl: tag('model', t('world model')) },
      h('div', { class: 'toggles' },
        hz('rain', 'Rain', 'Wets her wings; droplets tap her antennae.'), hz('iceRain', 'Ice rain', 'Rain plus cold.'),
        hz('fire', 'Fire', 'Local heat to her thermosensors plus a bright looming object. Drag it.'),
        hz('quake', 'Earthquake', 'Repeated startles through the antennae and eyes.'), hz('smoke', 'Smoke', 'Displaces oxygen.'),
        hz('dust', 'Dust storm', 'Dust settles on her antennae — the grooming circuit is for exactly this.'), hz('flood', 'Flood', 'Rising water: wet, then no air.')),
      gravity.el, oxygen.el);

    // body
    const body = card(t('Body'), { iconName: 'body', tagEl: tag('model', t('body model')) },
      h('div', { class: 'grid2' },
        h('button', { class: 'btn small', type: 'button', onclick: () => cmd('body.removeLeg') }, t('Remove a leg')),
        h('button', { class: 'btn small', type: 'button', onclick: () => cmd('body.wing') }, t('Damage a wing')),
        h('button', { class: 'btn small', type: 'button', onclick: () => cmd('body.freeze') }, t('Hold in place')),
        h('button', { class: 'btn small danger', type: 'button', onclick: () => cmd('body.squeeze') }, t('Squeeze')),
        h('button', { class: 'btn small', type: 'button', onclick: () => cmd('body.reset') }, t('Heal body')),
        h('button', { class: 'btn small', type: 'button', onclick: () => cmd('respawn', {}) }, t('New fly'))),
      h('p', { class: 'note' }, t('A missing leg stops sending contact and load to the real nerve-cord circuit. There are no nociceptors in this brain dataset, so injuries act through the body and its feedback, not through a pain channel.')));

    // command neurons
    const stims = [['walk', 'Walk', 'DNp09'], ['escape', 'Escape', 'giant fiber DNp01'], ['backward', 'Back up', 'MDN'], ['groom', 'Rub legs', 'DNg11'],
      ['headGroom', 'Groom head', 'DNg12'], ['proboscis', 'Proboscis', 'motor neurons'], ['steerLeft', 'Turn left', 'DNa01/02 L'], ['steerRight', 'Turn right', 'DNa01/02 R'],
      ['wings', 'Escape wings', 'DNp02/04/11']];
    const direct = card(t('Command neurons'), { iconName: 'bolt', tagEl: tag('measured', t('identified cells')) },
      h('div', { class: 'grid3' }, ...stims.map(([key, label, cells]) => h('button', { class: 'action', type: 'button', style: { minHeight: '54px' }, title: cells,
        onclick: () => cmd('stim.group', { name: key }) }, h('b', {}, t(label)), h('small', {}, cells)))),
      h('p', { class: 'note' }, t('Direct, brief stimulation of identified descending neurons — the in-silico version of an optogenetic pulse. For silencing, tonic activation and any FlyWire cell type, use Circuit.')));

    const el = h('div', {}, panelHead(t('Stimulate'), t('Every sense, the world, her body.'),
      t('These controls change what she experiences. Each one reaches the neurons that really transduce it.')),
    vision, antenna, taste, thermo, world, body, direct);
    return {
      el,
      update(snap) {
        wind.set(snap.env.windKmh); windDir.set(snap.env.windDirDeg); temp.set(snap.env.tempC); grad.set(snap.env.tempGradientC);
        gravity.set(snap.env.gravity); oxygen.set(snap.env.oxygenPct);
        for (const [key, b] of Object.entries(hazardButtons)) b.setAttribute('aria-pressed', String(!!snap.env[key]));
      },
    };
  },
};
void icon; void action;
