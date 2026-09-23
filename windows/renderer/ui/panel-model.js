// panel-model.js — where every number comes from, what is assumed, how fast
// it runs, and who to cite.

import { h } from './dom.js';
import { t, num, int } from '../i18n.js';
import { panelHead, card, tag, kv, link } from './widgets.js';
import { LITERATURE } from '../../src/experiments.js';
import { MODEL_VERSION } from '../../src/provenance.js';
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
      h('p', { class: 'note' }, t('Every connection is a real, signed synapse count from the published connectomes. Extensions are locked to the exact files they extend by SHA-256; a mismatched file is rejected, never silently applied.')));

    const assumptions = card(t('What is measured, what is modelled'), { iconName: 'model' },
      h('div', { class: 'list' },
        h('div', {}, tag('measured'), ' ', t('which neurons exist, where they sit, which cell type they are, and every synapse count and transmitter sign between them')),
        h('div', {}, tag('measured'), ' ', t('every spike, rate, attribution and behavioural event reported by the running simulation')),
        h('div', {}, tag('model'), ' ', t('leaky integrate-and-fire dynamics at 1 ms, 20 ms membrane time constant, noise and tonic drive')),
        h('div', {}, tag('model'), ' ', t('per-synapse strength: 0.0002 of threshold in the core circuit; 0.0062 in the taste and grooming pathways, peak-matched to the whole-brain FlyWire model of Shiu et al. (2024)')),
        h('div', {}, tag('model'), ' ', t('how light, sound, wind, heat, taste and dust are turned into receptor drive')),
        h('div', {}, tag('model'), ' ', t('the brain–nerve-cord interface (female brain, male nerve cord: a population-rate bridge, no cross-specimen synapses)')),
        h('div', {}, tag('model'), ' ', t('the body: legs, flight, grooming and feeding animation, health'))),
      h('p', { class: 'note' }, t('Everything tagged "model" is a stated assumption, written down in the code and the documentation, so it can be checked and changed.')));

    const perfGrid = h('dl', { class: 'kv' });
    const perf = card(t('Performance'), { iconName: 'spark', tagEl: tag('measured') }, perfGrid,
      h('p', { class: 'note' }, t('The live fly runs on her own CPU core; experiments on another. The display only draws.')));

    const refs = card(t('References'), { iconName: 'data' },
      h('ul', { style: { margin: 0, paddingLeft: '16px', fontSize: '11px', color: 'var(--muted)', lineHeight: 1.6 } },
        h('li', {}, link('https://doi.org/10.1038/s41586-024-07558-y', 'Dorkenwald et al. (2024) Nature 634:124 — FlyWire whole-brain connectome')),
        h('li', {}, link('https://doi.org/10.1038/s41586-024-07686-5', 'Schlegel et al. (2024) Nature 634:139 — FlyWire annotation and cell types')),
        h('li', {}, link('https://male-cns.janelia.org/download/', 'MaleCNS v1.0 — FlyEM at HHMI Janelia, University of Cambridge and collaborators')),
        ...Object.values(LITERATURE).map((l) => h('li', {}, link(l.doi, l.cite)))));

    const about = card(t('About'), {},
      kv([[t('Version'), MODEL_VERSION], [t('Code'), 'PolyForm Noncommercial 1.0.0'], [t('FlyWire data'), 'CC BY-NC 4.0'], [t('MaleCNS data'), 'CC BY 4.0'], [t('Website'), 'neurofly.app']]),
      h('p', { class: 'note' }, t('Because the FlyWire data are licensed for non-commercial use, NeuroFly is free and carries no advertising.')));

    const el = h('div', {}, panelHead(t('Model'), t('Where every number comes from.'),
      t('NeuroFly is a model built on measured anatomy. This page separates what was measured from what was assumed.')),
    specimenNotice, data, assumptions, perf, refs, about);

    return {
      el,
      update(snap) {
        const pr = snap.perf;
        perfGrid.replaceChildren(...[
          [t('Display'), `${num(ctx.fps ?? 0, 0)} fps`],
          [t('Simulation vs real time'), `${num(pr.simulationRealtime, 2)}×`],
          [t('Neural core speed'), `${num(pr.coreRealtime, 1)}× ${t('real time')}`],
          [t('Simulation thread load'), `${Math.round(pr.loopLoad * 100)}%`],
          [t('Spikes per second'), int(pr.spikesPerSecond)],
          [t('Synaptic events per second'), int(pr.deliveriesPerSecond)],
          [t('Render resolution'), `${num(ctx.pixelRatio ?? 1, 2)}×`],
        ].flatMap(([k, v]) => [h('dt', {}, k), h('dd', {}, v)]));
      },
    };
  },
};
