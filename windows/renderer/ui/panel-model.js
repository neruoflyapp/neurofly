// panel-model.js — where every number comes from, what is assumed, how fast
// it runs, and who to cite.

import { h } from './dom.js';
import { t, num, int } from '../i18n.js';
import { panelHead, card, tag, kv, link } from './widgets.js';
import { LITERATURE } from '../../src/experiments.js';
import { MODEL_VERSION } from '../../src/provenance.js';
import { classifyRunTiming } from '../../src/performance.js';
import { getLanguage } from '../i18n.js';

export const modelPanel = {
  id: 'model', icon: 'model', title: 'Model', short: 'Model',
  build(ctx) {
    const d = ctx.data, p = d.provenance || {};
    const th = p.thermoExtension, se = p.sensoryExtension;
    const de = getLanguage() === 'de';
    const specimenNotice = card(de ? 'Tierherkunft des laufenden Modells' : 'Specimens in the running model', { iconName: 'body' },
      kv([[de ? 'Gehirn' : 'Brain', '♀ FAFB v783'], [de ? 'Nervenstrang' : 'Nerve cord', '♂ MaleCNS v1.0'],
        [de ? 'Verbindung' : 'Interface', de ? 'Tierübergreifendes Populationsmodell' : 'Cross-specimen population model']]),
      h('p', { class: 'note' }, de ? 'Kein durchgehend zusammengehöriges Tier. Der Körper ist modelliert; ein biologisches Geschlecht des gesamten Laufs ist nicht belegt. BANC und MaleCNS lassen sich im Bereich Tiere getrennt anatomisch untersuchen.' : 'Not a single-specimen animal. The body is modelled; no biological sex is established for the combined run. Inspect BANC and MaleCNS separately in Specimens.'),
      h('button', { type: 'button', class: 'btn', onclick: () => ctx.shell.select('specimens') }, de ? '♀ / ♂ Datenbestände öffnen' : 'Open female / male datasets'));
    const short = (x) => (x ? `${x.slice(0, 12)}…` : '—');
    const data = card(t('The data'), { iconName: 'data', tagEl: tag('measured') },
      kv([
        [t('Brain circuit (FlyWire FAFB v783)'), `${int(p.brainAudit?.neurons)} ${t('neurons')} · ${int(p.brainAudit?.edges)} ${t('connections')}`],
        [t('+ thermosensory extension'), th ? `${th.hotCells} + ${th.coldCells} ${t('sensors')}, ${th.relayNeurons} ${t('relays')}, ${int(th.addedEdges)} ${t('connections')}` : t('not loaded')],
        [t('+ taste extension'), se ? `${se.sugarCells} + ${se.bitterCells} ${t('taste neurons')}, ${se.proboscisMotorNeurons + se.ingestionMotorNeurons} ${t('motor neurons')}, ${se.tasteRelays} ${t('relays')}` : t('not loaded')],
        [t('+ antennal grooming extension'), se ? `${se.joFCells} JO-F, ${se.dng12} DNg12, ${se.groomingRelays} ${t('relays')}` : t('not loaded')],
        [t('Running brain'), `${int(d.circuit.neurons.length)} ${t('neurons')} · ${int(d.circuit.edges.length)} ${t('connections')}`],
        [t('Nerve cord (MaleCNS v1.0)'), `${int(d.locomotor?.neurons?.length)} ${t('neurons')} · ${int(d.locomotor?.edges?.length)} ${t('connections')}`],
        [t('Anatomical context'), `${int(d.points?.points?.length)} ${t('FlyWire somata')}`],
        ['circuit.json SHA-256', short(p.brainCircuitSHA256)],
        ['sensory_extension SHA-256', short(p.sensoryExtensionSHA256)],
      ]),
      h('p', { class: 'note' }, t('Anatomical endpoints and contact counts come from documented connectome extracts. Transmitter identity and sign use predictions; functional synaptic strength is modelled. Extensions are locked to their source files by SHA-256; mismatches are rejected.')));

    const assumptions = card(t('What is measured, what is modelled'), { iconName: 'model' },
      h('div', { class: 'list' },
        h('div', {}, tag('measured'), ' ', t('which included neurons exist, where they sit, their annotated cell types, and their anatomical contact counts')),
        h('div', {}, tag('measured'), ' ', t('every spike, rate, attribution and behavioural event reported by the running simulation')),
        h('div', {}, tag('model'), ' ', t('leaky integrate-and-fire dynamics at 1 ms, 20 ms membrane time constant, noise and tonic drive')),
        h('div', {}, tag('model'), ' ', t('per-synapse strength: 0.0002 of threshold in the core circuit; 0.0062 in the taste and grooming pathways, peak-matched to the whole-brain FlyWire model of Shiu et al. (2024)')),
        h('div', {}, tag('model'), ' ', t('how light, sound, wind, heat, taste and dust are turned into receptor drive')),
        h('div', {}, tag('model'), ' ', t('the brain–nerve-cord interface (female brain, male nerve cord: a population-rate bridge, no cross-specimen synapses)')),
        h('div', {}, tag('model'), ' ', t('the body: legs, flight, grooming and feeding animation, health'))),
      h('p', { class: 'note' }, t('Everything tagged "model" is a stated assumption, written down in the code and the documentation, so it can be checked and changed.')));

    const perfFields = [
      'Display', 'Requested speed', 'Simulation vs real time', 'Neural core speed',
      'Simulation thread load', 'Unsimulated time (this fly)', 'Unsimulated time (session)', 'Spikes per second',
      'Synaptic events per second', 'Render resolution',
    ];
    const perfValues = perfFields.map(() => h('dd', {}, '—'));
    const perfGrid = h('dl', { class: 'kv' },
      ...perfFields.flatMap((label, i) => [h('dt', {}, t(label)), perfValues[i]]));
    const timingStatus = h('p', { class: 'timing-status', role: 'status', 'aria-live': 'polite' });
    const perf = card(t('Performance'), { iconName: 'spark', tagEl: tag('measured') },
      timingStatus, perfGrid,
      h('p', { class: 'note' }, t('The live fly and experiments use separate worker threads; the display only draws. CPU cores are assigned by the operating system.')));

    const readiness = card(t('Research readiness'), { iconName: 'model', tagEl: tag('model') },
      h('p', { class: 'note' }, t('A measured wiring diagram constrains hypotheses; it does not by itself validate drug effects or establish subjective experience.')),
      h('div', { class: 'list' },
        h('div', {}, t('Now: run repeatable virtual interventions and export their seeds, model assumptions and timing gaps.')),
        h('div', {}, t('Next: fit receptor-specific physiology and neural dynamics to experimental recordings.')),
        h('div', {}, t('Then: test predictions prospectively against independent perturbation and behavioural data.')),
        h('div', {}, t('For drug studies: add measured target expression, exposure and dose-response data before claiming predictive validity.'))),
      h('div', { class: 'row', style: { marginTop: '10px' } },
        h('button', { type: 'button', class: 'btn', onclick: () => ctx.shell.select('experiments') }, t('Open experiments')),
        h('button', { type: 'button', class: 'btn ghost', onclick: () => ctx.shell.select('sentience') }, t('Open sentience evidence'))));

    const refs = card(t('References'), { iconName: 'data' },
      h('ul', { style: { margin: 0, paddingLeft: '16px', fontSize: '11px', color: 'var(--muted)', lineHeight: 1.6 } },
        h('li', {}, link('https://doi.org/10.1038/s41586-024-07558-y', 'Dorkenwald et al. (2024) Nature 634:124 — FlyWire whole-brain connectome')),
        h('li', {}, link('https://doi.org/10.1038/s41586-024-07686-5', 'Schlegel et al. (2024) Nature 634:139 — FlyWire annotation and cell types')),
        h('li', {}, link('https://male-cns.janelia.org/download/', 'MaleCNS v1.0 — FlyEM at HHMI Janelia, University of Cambridge and collaborators')),
        h('li', {}, link('https://doi.org/10.1038/s41586-024-07982-0', 'The fly connectome reveals a path to the effectome — causal dynamics need perturbation data')),
        h('li', {}, link('https://journals.biologists.com/jeb/article/224/21/jeb242740/272599/A-connectome-is-not-enough-what-is-still-needed-to', 'A connectome is not enough — receptor and physiological data remain essential')),
        ...Object.values(LITERATURE).map((l) => h('li', {}, link(l.doi, l.cite)))));

    const about = card(t('About'), {},
      kv([[t('Version'), MODEL_VERSION], [t('Code'), 'PolyForm Noncommercial 1.0.0'], [t('FlyWire data'), 'CC BY-NC 4.0'], [t('MaleCNS data'), 'CC BY 4.0'], [t('Website'), 'neurofly.app']]),
      h('p', { class: 'note' }, t('Because the FlyWire data are licensed for non-commercial use, NeuroFly is free and carries no advertising.')));

    const el = h('div', {}, panelHead(t('Model'), t('Where every number comes from.'),
      t('NeuroFly is a model built on measured anatomy. This page separates what was measured from what was assumed.')),
    specimenNotice, perf, data, assumptions, readiness, refs, about);

    return {
      el,
      update(snap) {
        const pr = snap.perf || {};
        const state = classifyRunTiming({ paused: snap.paused, speed: snap.speed, perf: pr });
        const messages = {
          paused: 'Paused — no simulation time is advancing.',
          gap: 'This fly has simulation gaps. Do not interpret missing time as biological inactivity; reduce speed for the next run.',
          measuring: 'Measuring simulation timing…',
          behind: 'Below requested speed. Compare results by simulated time, not wall-clock time.',
          'on-pace': 'Simulation is keeping pace with the requested speed.',
        };
        const message = t(messages[state]);
        if (timingStatus.dataset.state !== state) timingStatus.dataset.state = state;
        if (timingStatus.textContent !== message) timingStatus.textContent = message;
        const values = [
          `${num(ctx.fps ?? 0, 0)} fps`,
          `${num(snap.speed ?? 1, 2)}×`,
          `${num(pr.simulationRealtime ?? 0, 2)}×`,
          `${num(pr.coreRealtime ?? 0, 1)}× ${t('real time')}`,
          `${Math.round((pr.loopLoad ?? 0) * 100)}%`,
          `${num(pr.runDroppedSimulationSeconds ?? 0, 3)} s`,
          `${num(pr.totalDroppedSimulationSeconds ?? 0, 3)} s`,
          int(pr.spikesPerSecond),
          int(pr.deliveriesPerSecond),
          `${num(ctx.pixelRatio ?? 1, 2)}×`,
        ];
        for (let i = 0; i < values.length; i++) {
          if (perfValues[i].textContent !== values[i]) perfValues[i].textContent = values[i];
        }
      },
    };
  },
};
