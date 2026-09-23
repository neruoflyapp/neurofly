// panel-sentience.js — "Does she feel?" The eight evidence criteria for
// sentience, for the real fly and for this model, with the experiments that
// test each one.

import { h, icon } from './dom.js';
import { t, int } from '../i18n.js';
import { panelHead, card, tag, link } from './widgets.js';
import { assessSentience, SENTIENCE_RESEARCH_SOURCES } from '../../src/sentience.js';
import { runExperiment } from './panel-experiments.js';
import { PROTOCOLS } from '../../src/experiments.js';

const LEVEL = { VH: ['vh', 'very high'], H: ['h', 'high'], M: ['m', 'medium'], L: ['l', 'low'], VL: ['vl', 'no research found'] };
const STATUS_LABEL = { present: ['present', 'present'], partial: ['partial', 'partly in the model'], experimental: ['partial', 'experimental'], absent: ['absent', 'not in the model'] };

const ANIMAL_TEXT = {
  nociception: 'Many studies show adult flies have nociceptors for noxious heat, mechanical and chemical stimuli.',
  'sensory-integration': 'The mushroom bodies and central complex integrate information across senses.',
  'integrated-nociception': 'Noxious input reaches integrative regions; flies learn from noxious stimuli.',
  analgesia: 'Endogenous and pharmacological modulation of nociception is documented in flies.',
  'motivational-tradeoffs': 'Flies trade aversive stimuli against food and other rewards.',
  'flexible-self-protection': 'No study of wound-directed behaviour in adult flies was found.',
  'associative-learning': 'Flies learn to avoid odours paired with shock — the classic memory assay.',
  'analgesia-preference': 'No study of injured flies seeking analgesics was found.',
};

function modelText(c) {
  const m = c.model || {}, a = c.anatomy || {};
  switch (c.id) {
    case 'nociception': return t('No classic nociceptors: body and leg nociceptors enter through the nerve cord, which the brain dataset does not contain. The model does contain the brain\'s own aversive and thermal sensors: {hot} hot cells, {cold} cold cells and {bitter} bitter taste neurons, with their real wiring.', m);
    case 'sensory-integration': return t('{cx} central-complex and {mb} mushroom-body neurons are part of the simulated circuit; {learn} of them belong to the mushroom body\'s learning circuitry (Kenyon cells, PAM/PPL dopamine neurons).', { cx: m.centralComplex, mb: m.mushroomBody, learn: m.mushroomBodyLearningCells });
    case 'integrated-nociception': {
      if (!a.hotToMushroomBody) return t('The full-connectome pathway analysis is not loaded.');
      return t('Measured in the complete FlyWire brain: hot cells reach the mushroom body across {hs} synapses ({hn} mushroom-body cells within two), bitter taste neurons across {bs} ({bn} cells within three); hot cells reach the central complex across {cs}. The simulation contains these routes only up to two or three synapses.', {
        hs: a.hotToMushroomBody.minSynapses, hn: int(a.hotToMushroomBody.within2), bs: a.bitterToMushroomBody.minSynapses,
        bn: int(a.bitterToMushroomBody.within3), cs: a.hotToCentralComplex?.minSynapses ?? '—' });
    }
    case 'analgesia': return t('In-silico pharmacology can scale any transmitter class, and inhibition measurably gates the escape response. There is no endogenous analgesic system (opioid-like, nociceptin) in the model.');
    case 'motivational-tradeoffs': return t('{sugar} sugar and {bitter} bitter taste neurons converge on {mn} proboscis and feeding motor neurons: bitter can override sugar. A reflex-level trade-off — the model has no hunger state that could shift it.', m);
    case 'flexible-self-protection': return t('Dust on the antennae drives {jof} JO-F neurons, DNg12 and head grooming aimed at the dusted body part, which stops once it is clean. Stimulus-directed self-care — not wound-directed care.', { jof: m.joF });
    case 'associative-learning': return t('The fly\'s learning centre, the dopamine-gated mushroom body, is not in the simulated circuit ({learn} learning-circuit cells). An experimental timing rule can be switched on and tested; so far it does not produce associative learning.', { learn: m.mushroomBodyLearningCells });
    case 'analgesia-preference': return t('No injury state in the nervous system and no analgesic she could seek.');
    default: return '';
  }
}

export const sentiencePanel = {
  id: 'sentience', icon: 'sentience', title: 'Sentience', short: 'Sentience',
  build(ctx) {
    const audit = assessSentience({ circuit: ctx.data.circuit, provenance: ctx.data.provenance, pathways: ctx.data.pathways, hasPlasticity: true });
    const list = h('div', {});

    function verdictChip(protocolId) {
      const st = ctx.state.experiments.get(protocolId);
      if (!st) return null;
      if (st.status === 'running') return h('span', { class: 'chip' }, `${t('running')} ${Math.round((st.fraction || 0) * 100)}%`);
      if (st.status === 'done') {
        const good = ['threshold', 'soundEscapes', 'tradeoff', 'necessary', 'gates', 'learns', 'prefers', 'habituates', 'bothMatter'].includes(st.result.verdict.code);
        return h('span', { class: `chip ${good ? 'accent' : 'danger'}` }, good ? t('reproduced in the model') : t('not reproduced in the model'));
      }
      return null;
    }

    function render() {
      list.replaceChildren(...audit.criteria.map((c) => {
        const [lvlCls, lvlText] = LEVEL[c.animal];
        const [stCls, stText] = STATUS_LABEL[c.status];
        const protocol = c.protocol ? PROTOCOLS.find((p) => p.id === c.protocol) : null;
        const chip = protocol ? verdictChip(protocol.id) : null;
        return h('div', { class: 'crit' },
          h('div', { class: 'crit-head' }, h('span', { class: 'crit-num' }, String(c.n)),
            h('div', {}, h('b', {}, t(c.name)), h('small', {}, t(c.question)))),
          h('div', { class: 'crit-cols' },
            h('div', { class: 'crit-col' }, h('div', { class: 'k' }, t('Real flies'), tag('real', 'Gibbons 2022')),
              h('span', { class: `level ${lvlCls}` }, t(lvlText)), h('div', { style: { marginTop: '4px' } }, t(ANIMAL_TEXT[c.id]))),
            h('div', { class: 'crit-col' }, h('div', { class: 'k' }, t('This model'), c.anatomy ? tag('measured', t('full connectome')) : null),
              h('span', { class: `level ${stCls}` }, t(stText)), h('div', { style: { marginTop: '4px' } }, modelText(c)))),
          protocol ? h('div', { class: 'row run' },
            h('button', { class: 'btn small', type: 'button', onclick: () => { runExperiment(ctx, protocol.id, {}); ctx.shell.select('experiments'); } },
              icon('play', 13), t('Test it: {name}', { name: t(protocol.title) })), chip) : null);
      }));
    }

    const summary = card(t('The evidence, in one line'), { iconName: 'sentience' },
      h('div', { class: 'grid2' },
        h('div', {}, h('div', { class: 'eyebrow' }, t('Real adult flies')), h('b', { style: { fontSize: '22px' } }, `${audit.animalStrong} / 8`),
          h('p', { class: 'note' }, t('criteria met with high or very high confidence — "strong evidence" of the capacity for pain in the framework\'s grading (Gibbons et al. 2022).'))),
        h('div', {}, h('div', { class: 'eyebrow' }, t('This model')), h('b', { style: { fontSize: '22px' } }, `${audit.modelled} / 8`),
          h('p', { class: 'note' }, t('criteria with a corresponding mechanism in the simulated circuit — each one testable below.')))));

    const sources = card(t('Sources'), { iconName: 'data' },
      h('ul', { class: 'lit', style: { margin: 0, paddingLeft: '16px', fontSize: '11px', color: 'var(--muted)' } },
        ...SENTIENCE_RESEARCH_SOURCES.map((s) => h('li', { style: { marginTop: '5px' } }, link(s.url, s.label), ` — ${t(s.point)}`))));

    const scope = card(t('What a model can and cannot show'), { tagEl: tag('model') },
      h('p', { class: 'note', style: { marginTop: 0 } }, t('The criteria are evidence used to judge whether an animal can feel pain. Reproducing a capacity here shows that the real wiring, plus the model\'s stated assumptions, is enough for that capacity. Whether anything is felt cannot be measured from spikes — in the model or in the fly.')));

    const el = h('div', {}, panelHead(t('Sentience'), t('Can a fly feel? The evidence, criterion by criterion.'),
      t('Science weighs sentience with eight criteria (Birch et al. 2021). For each one: what is known about real flies, what the connectome shows, what this model contains — and an experiment you can run to test it.')),
    summary, list, scope, sources);
    render();
    const listener = () => { if (list.isConnected) render(); };
    ctx.experimentListeners ??= new Set();
    ctx.experimentListeners.add(listener);
    return { el, dispose() { ctx.experimentListeners.delete(listener); } };
  },
};
