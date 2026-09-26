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

// German lookups that found no entry. The display falls back to English, so
// a gap would otherwise go unnoticed; the UI test reads this set.
export const untranslated = new Set();

export function t(text, vars = null) {
  let out = text;
  if (lang === 'de') {
    const de = DE[text];
    if (de === undefined) untranslated.add(text); else out = de;
  }
  if (vars) for (const [k, v] of Object.entries(vars)) out = out.split(`{${k}}`).join(String(v));
  return out;
}

// Number formatting in the active locale. Formatters are cached: live
// readouts format dozens of numbers several times a second, and
// toLocaleString builds a new formatter on every call.
const formatters = new Map();
function formatter(digits) {
  const key = `${lang}:${digits}`;
  let f = formatters.get(key);
  if (!f) {
    f = new Intl.NumberFormat(lang === 'de' ? 'de-DE' : 'en-US', digits === null ? {} : { minimumFractionDigits: digits, maximumFractionDigits: digits });
    formatters.set(key, f);
  }
  return f;
}

export function num(v, digits = 1) {
  if (!Number.isFinite(v)) return '—';
  return formatter(digits).format(v);
}

export function int(v) {
  if (!Number.isFinite(v)) return '—';
  return formatter(null).format(Math.round(v));
}
