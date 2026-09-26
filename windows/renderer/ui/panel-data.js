// panel-data.js — recordings, exports and the intervention journal.

import { h, icon } from './dom.js';
import { t, int } from '../i18n.js';
import { panelHead, card, tag } from './widgets.js';

export const dataPanel = {
  id: 'data', icon: 'data', title: 'Data', short: 'Data',
  build(ctx) {
    const s = ctx.state;
    const format = h('select', { 'aria-label': t('Format') },
      h('option', { value: 'csv', selected: s.recordFormat === 'csv' }, t('Measurement table (CSV)')),
      h('option', { value: 'bundle', selected: s.recordFormat === 'bundle' }, t('Experiment package (JSON: CSV + start and end context)')));
    format.addEventListener('change', () => { s.recordFormat = format.value; });
    const recBtn = h('button', { class: 'btn primary block', type: 'button', onclick: () => ctx.toggleRecording() });
    const recInfo = h('p', { class: 'note' });
    const recording = card(t('Recording'), { iconName: 'record', tagEl: tag('observer', t('reads only')) },
      format, h('div', { class: 'field' }, recBtn), recInfo,
      h('p', { class: 'note' }, t('20 samples per simulated second: every population rate, the sensory input, body, environment, genetic and pharmacological conditions, seed and data fingerprints. Recording never changes the run.')));

    const exp = (label, what, fn) => h('button', { class: 'btn block', type: 'button', onclick: fn }, icon('download', 15), t(label), h('span', { class: 'note', style: { margin: '0 0 0 auto' } }, what));
    const exports = card(t('Exports'), { iconName: 'download' },
      h('div', { class: 'list' },
        exp('Run manifest', 'JSON', async () => {
          const m = await ctx.request('manifest');
          ctx.save('saveManifest', `${JSON.stringify(m, null, 2)}\n`, t('Manifest saved.'));
        }),
        exp('Learning trace (changed synapses)', 'CSV', async () => {
          const csv = await ctx.request('learningCSV');
          if (!csv) { ctx.toast(t('No synapse has changed — switch the learning rule on and train first.')); return; }
          ctx.save('saveLearningRecord', csv, t('Learning trace saved.'));
        }),
        exp('Spatial map', 'CSV', async () => {
          const csv = await ctx.request('mapCSV');
          if (!csv) { ctx.toast(t('Nothing measured yet.')); return; }
          ctx.save('saveRecording', csv, t('Map saved.'));
        }),
        exp('Picture of the window', 'PNG', () => ctx.save('saveSnapshot', undefined, t('Picture saved.')))),
      h('p', { class: 'note' }, t('The manifest records model version, seed, data SHA-256 fingerprints, conditions, the intervention journal and measured performance — what a reader needs to reproduce or audit a run.')));

    const seedInput = h('input', { type: 'number', min: 1, max: 4294967295, step: 1, 'aria-label': t('Neural seed') });
    const plastic = h('input', { type: 'checkbox' });
    const neural = card(t('Reproducible runs'), { iconName: 'repeat', tagEl: tag('model') },
      h('div', { class: 'row' }, h('div', { class: 'grow' }, seedInput),
        h('button', { class: 'btn small', type: 'button', onclick: () => ctx.command('respawn', { seed: Number(seedInput.value) || undefined, plasticity: plastic.checked }) }, t('New fly with this seed'))),
      h('label', { class: 'check' }, plastic, h('span', {}, t('Experimental learning rule (bounded STDP at sensory → command synapses)'))),
      h('div', { class: 'grid2', style: { marginTop: '8px' } },
        h('button', { class: 'btn small', type: 'button', onclick: async () => {
          const r = await ctx.command('learning.start', { order: 'pre-before-post' }, { reply: true });
          ctx.toast(r?.ok ? t('16 pairings scheduled: visual threat → giant fiber.') : (r?.reason ? t(r.reason) : t('Switch the learning rule on first.')), r?.ok ? 'ok' : 'err');
        } }, t('Pair visual → escape (16×)')),
        h('button', { class: 'btn small', type: 'button', onclick: async () => {
          const r = await ctx.command('learning.start', { order: 'post-before-pre' }, { reply: true });
          ctx.toast(r?.ok ? t('16 reversed pairings scheduled (control).') : (r?.reason ? t(r.reason) : t('Switch the learning rule on first.')), r?.ok ? 'ok' : 'err');
        } }, t('Reversed control (16×)'))),
      h('p', { class: 'note' }, t('The same seed and the same neural input reproduce the neural trajectory exactly. The learning rule is a hypothesis to test, not the fly\'s own learning mechanism (see Sentience, criterion 7).')));
    const learnInfo = h('p', { class: 'note' });
    neural.append(learnInfo);

    const journal = h('ol', { style: { margin: 0, paddingLeft: '18px', fontSize: '11.5px', color: 'var(--ink-2)', lineHeight: 1.55 } });
    const journalCard = card(t('Intervention journal'), { iconName: 'data', tagEl: tag('observer', t('reads only')) }, journal,
      h('p', { class: 'note' }, t('Every control you use is logged with neural time; up to 512 entries go into the manifest.')));

    const el = h('div', {}, panelHead(t('Data'), t('Take the evidence with you.'),
      t('Everything the simulation measures can leave as a file you can analyse, share or cite — with the provenance to reproduce it.')),
    recording, exports, neural, journalCard);

    let journalT = 0;
    return {
      el,
      update(snap) {
        recBtn.disabled = Boolean(ctx.state.recordingBusy);
        format.disabled = Boolean(ctx.state.recordingBusy);
        recBtn.replaceChildren(icon('record', 14), snap.recording.active ? t('Stop and save ({rows} rows)', { rows: int(snap.recording.rows) }) : snap.recording.rows ? t('Save the kept recording') : t('Start recording'));
        recBtn.classList.toggle('recording', snap.recording.active);
        recInfo.textContent = snap.recording.active ? t('Recording · {s} s', { s: int(snap.recording.rows / 20) }) : '';
        if (document.activeElement !== seedInput && !seedInput.value) seedInput.value = String(snap.seed);
        const p = snap.plasticity;
        plastic.checked = plastic.checked || p.enabled;
        learnInfo.textContent = p.enabled
          ? t('Learning rule on: {eligible} eligible synapses, {updates} changes so far.', { eligible: int(p.eligibleEdges), updates: int(p.updates) })
            + (snap.learning.active ? ` ${t('Pairing in progress: {pct}%', { pct: Math.round(snap.learning.progress * 100) })}` : '')
          : t('Fixed wiring: the learning rule is off.');
        const now = performance.now();
        if (now - journalT > 1500) {
          journalT = now;
          ctx.request('journal').then((j) => {
            if (!j) return;
            journal.replaceChildren(...j.events.slice(-12).reverse().map((e) => h('li', {}, `${e.neuralMs ?? '—'} ms · ${e.kind}${e.details?.control ? ` · ${e.details.control}${e.details.value !== undefined ? ` = ${e.details.value}` : ''}` : ''}`)));
          });
        }
      },
    };
  },
};
