// Lists English UI texts that have no German translation in renderer/i18n-de.js.
//   node tools/check-i18n.mjs          report
//   node tools/check-i18n.mjs --strict exit 1 if anything is missing (for tests)
//
// Sources: every t('…') / t("…") literal in the renderer and src, plus the
// protocol texts in src/experiments.js and the verdict, statistic and
// behaviour labels in the Lab panel, which reach t() through variables.
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const { DE } = await import(pathToFileURL(path.join(ROOT, 'renderer/i18n-de.js')).href);
const { PROTOCOLS } = await import(pathToFileURL(path.join(ROOT, 'src/experiments.js')).href);

const files = [];
for (const dir of ['renderer', 'renderer/ui', 'renderer/view', 'src']) {
  for (const f of fs.readdirSync(path.join(ROOT, dir))) if (f.endsWith('.js') && f !== 'i18n-de.js' && f !== 'i18n.js') files.push(path.join(ROOT, dir, f));
}

const texts = new Map();   // text -> where it was found
const add = (text, where) => { if (text && /[A-Za-z]/.test(text) && !texts.has(text)) texts.set(text, where); };

// JS string literal contents: '…' or "…" with backslash escapes; `…` only without ${}.
const unquote = (s) => s.slice(1, -1).replace(/\\(['"\\`])/g, '$1').replace(/\\n/g, '\n');
const LITERAL = String.raw`('(?:[^'\\\n]|\\.)*'|"(?:[^"\\\n]|\\.)*"|` + '`[^`$]*`)';
const T_CALL = new RegExp(String.raw`\bt\(\s*` + LITERAL, 'g');
for (const file of files) {
  const src = fs.readFileSync(file, 'utf8');
  const rel = path.relative(ROOT, file);
  for (const m of src.matchAll(T_CALL)) add(unquote(m[1]), rel);
  // l('Deutsch', 'English') pairs translate themselves; nothing to check.
}

// Protocol texts.
for (const p of PROTOCOLS) {
  for (const key of ['title', 'question', 'measures', 'category']) add(p[key], `protocol ${p.id}.${key}`);
  for (const l of p.literature || []) add(l.finding, `protocol ${p.id} literature`);
  for (const m of Object.values(p.metrics || {})) if (m.unit) add(m.unit, `protocol ${p.id} metric`);
}

// Labels in panel-experiments.js object literals (VERDICTS, STAT_LABELS, BEHAVIOUR_LABEL).
const lab = fs.readFileSync(path.join(ROOT, 'renderer/ui/panel-experiments.js'), 'utf8');
const block = (name) => lab.slice(lab.indexOf(`const ${name}`), lab.indexOf('};', lab.indexOf(`const ${name}`)));
for (const m of block('VERDICTS').matchAll(new RegExp(String.raw`(?:title|text):\s*` + LITERAL, 'g'))) add(unquote(m[1]), 'Lab verdicts');
for (const name of ['STAT_LABELS', 'BEHAVIOUR_LABEL']) {
  for (const m of block(name).matchAll(new RegExp(String.raw`:\s*` + LITERAL, 'g'))) add(unquote(m[1]), `Lab ${name}`);
}

// Chart labels of the protocols (a run is needed for those built in run()).
const chartLabels = fs.readFileSync(path.join(ROOT, 'src/experiments.js'), 'utf8')
  .matchAll(new RegExp(String.raw`(?:xLabel|yLabel|label):\s*` + LITERAL, 'g'));
for (const m of chartLabels) add(unquote(m[1]), 'protocol chart');

const missing = [...texts].filter(([text]) => !(text in DE));
for (const [text, where] of missing) console.log(`${where}: ${JSON.stringify(text)}`);
console.log(`${texts.size} texts, ${missing.length} without a German translation`);
if (process.argv.includes('--strict') && missing.length) process.exit(1);
