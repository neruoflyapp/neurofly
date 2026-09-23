// i18n.js — English is the source language; German is a complete translation.
// t('English text', { var }) returns the text in the active language with
// {var} placeholders filled. A string missing from the German table falls
// back to English rather than to a key, so nothing ever shows blank.

import { DE } from './i18n-de.js';

const STORAGE_KEY = 'neurofly.lang';
let lang = 'en';
try {
  const saved = localStorage.getItem(STORAGE_KEY);
  if (saved === 'de' || saved === 'en') lang = saved;
  else lang = (navigator.language || 'en').toLowerCase().startsWith('de') ? 'de' : 'en';
} catch { /* storage unavailable: detect only */
  lang = (globalThis.navigator?.language || 'en').toLowerCase().startsWith('de') ? 'de' : 'en';
}

export function getLanguage() { return lang; }

export function setLanguage(next) {
  lang = next === 'de' ? 'de' : 'en';
  try { localStorage.setItem(STORAGE_KEY, lang); } catch { /* not persisted */ }
  document.documentElement.lang = lang;
}

export function t(text, vars = null) {
  let out = lang === 'de' ? (DE[text] ?? text) : text;
  if (vars) for (const [k, v] of Object.entries(vars)) out = out.split(`{${k}}`).join(String(v));
  return out;
}

// Number formatting in the active locale.
export function num(v, digits = 1) {
  if (!Number.isFinite(v)) return '—';
  return v.toLocaleString(lang === 'de' ? 'de-DE' : 'en-US', { minimumFractionDigits: digits, maximumFractionDigits: digits });
}

export function int(v) {
  if (!Number.isFinite(v)) return '—';
  return Math.round(v).toLocaleString(lang === 'de' ? 'de-DE' : 'en-US');
}
