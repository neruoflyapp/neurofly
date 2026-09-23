// widgets.js — the building blocks panels are made of.

import { h, icon } from './dom.js';
import { t } from '../i18n.js';

export function panelHead(eyebrow, title, text) {
  return h('div', { class: 'panel-head' }, h('div', { class: 'eyebrow' }, eyebrow), h('h1', {}, title), text ? h('p', {}, text) : null);
}

// tag kinds: measured (data), model (assumption), observer (view only), real (the real animal)
export function tag(kind, label) {
  const titles = {
    measured: t('Measured: comes from the FlyWire / MaleCNS data or is counted in the running simulation.'),
    model: t('Model: a modelling choice, stated so it can be checked.'),
    observer: t('View only: changes how you see the fly, never what she experiences.'),
    real: t('The real animal: published findings about living fruit flies.'),
  };
  return h('span', { class: `tag ${kind}`, title: titles[kind] ?? '' }, label ?? t({ measured: 'measured', model: 'model', observer: 'view only', real: 'real fly' }[kind] ?? kind));
}

export function card(title, { tagEl = null, iconName = null } = {}, ...children) {
  return h('div', { class: 'card' }, h('h3', {}, iconName ? icon(iconName, 16) : null, title, tagEl), ...children);
}

export function slider({ label, min, max, step = 1, value, format = (v) => String(v), title = '', onInput, onChange }) {
  const out = h('output', {}, format(value));
  const input = h('input', { type: 'range', min, max, step, value, title, 'aria-label': label });
  input.addEventListener('input', () => { const v = Number(input.value); out.textContent = format(v); onInput?.(v); });
  if (onChange) input.addEventListener('change', () => onChange(Number(input.value)));
  const el = h('div', { class: 'field', title }, h('div', { class: 'field-label' }, h('span', {}, label), out), input);
  return { el, input, set(v) { if (document.activeElement !== input) { input.value = v; out.textContent = format(v); } } };
}

export function action(iconName, title, desc, onclick, { disabled = false, hint = '' } = {}) {
  return h('button', { class: 'action', type: 'button', disabled, title: hint || desc, onclick }, icon(iconName, 18), h('b', {}, title), desc ? h('small', {}, desc) : null);
}

export function meter(label) {
  const val = h('span');
  const fill = h('div', { class: 'meter-fill' });
  const el = h('div', { class: 'meter' }, h('div', { class: 'meter-head' }, h('span', {}, label), val), h('div', { class: 'meter-track' }, fill));
  return { el, set(fraction, text) { fill.style.width = `${Math.max(0, Math.min(1, fraction)) * 100}%`; val.textContent = text; } };
}

export function toggle(label, pressed, onclick, title = '') {
  const b = h('button', { class: 'toggle', type: 'button', 'aria-pressed': String(!!pressed), title, onclick: () => onclick(b) }, label);
  return b;
}

export function check(label, checked, onchange, title = '') {
  const input = h('input', { type: 'checkbox' });
  input.checked = !!checked;
  input.addEventListener('change', () => onchange(input.checked));
  return { el: h('label', { class: 'check', title }, input, h('span', {}, label)), input };
}

export function kv(pairs) {
  return h('dl', { class: 'kv' }, ...pairs.flatMap(([k, v]) => [h('dt', {}, k), h('dd', {}, v)]));
}

export function link(href, text) {
  const a = h('a', { href: '#', title: href }, text);
  a.addEventListener('click', (e) => { e.preventDefault(); window.flyAPI?.openExternal?.(href); });
  return a;
}
