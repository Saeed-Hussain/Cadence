/**
 * How close Cadence's front end comes to eSpeak NG, the phonemiser both
 * models were trained with. eSpeak is used here only as the reference; it is
 * a development dependency and never ships.
 *
 *   node tools/g2p/compare.js
 *
 * Every distinct word of the project's own prose (proposal, READMEs, the
 * playground's sample texts, the benchmark passages) is phonemised by both,
 * and compared: exact matches, and the phoneme error rate (edits per
 * reference phoneme), with and without stress marks.
 */

import { readFile, writeFile } from 'node:fs/promises';
import { phonemize as espeak } from 'phonemizer';
import { loadLexicon, phonemizeSync } from '../../packages/cadence/src/g2p.js';
import { CORPUS } from '../bench/candidates.js';

const root = new URL('../../', import.meta.url);
const sources = ['docs/PROPOSAL.md', 'README.md', 'packages/cadence/README.md', 'apps/web/app/text-to-speech/page.jsx', 'apps/web/app/studio/page.jsx'];
let text = Object.values(CORPUS).join(' ');
for (const s of sources) text += ` ${await readFile(new URL(s, root), 'utf8')}`;

// Words as people write them: letters with an inner apostrophe, no code.
const words = [...new Set(text.match(/\b[A-Za-z][a-z]+(?:'[a-z]+)?\b/g) ?? [])].sort();
await loadLexicon();

/** Phonemes as units: a letter plus any length mark or diacritic after it. */
const units = (/** @type {string} */ s, stress = true) => (stress ? s : s.replace(/[ˈˌ]/g, '')).match(/[ˈˌ]|.[ːʰ̩]*/gu) ?? [];

/** @param {string[]} a @param {string[]} b */
function edits(a, b) {
  const d = Array.from({ length: a.length + 1 }, (_, i) => [i, ...Array(b.length).fill(0)]);
  for (let j = 1; j <= b.length; j++) d[0][j] = j;
  for (let i = 1; i <= a.length; i++) {
    for (let j = 1; j <= b.length; j++) {
      d[i][j] = Math.min(d[i - 1][j] + 1, d[i][j - 1] + 1, d[i - 1][j - 1] + (a[i - 1] === b[j - 1] ? 0 : 1));
    }
  }
  return d[a.length][b.length];
}

let exact = 0;
let exactNoStress = 0;
let err = 0;
let errNoStress = 0;
let ref = 0;
let refNoStress = 0;
const worst = [];
for (const w of words) {
  const mine = phonemizeSync(w);
  const theirs = (await espeak(w, 'en-us')).join(' ').trim();
  if (mine === theirs) exact++;
  const a = units(mine, false);
  const b = units(theirs, false);
  if (a.join('') === b.join('')) exactNoStress++;
  const e = edits(units(mine), units(theirs));
  const en = edits(a, b);
  err += e;
  errNoStress += en;
  ref += units(theirs).length;
  refNoStress += b.length;
  if (en > 1) worst.push({ w, mine, theirs, en });
}

const pct = (x) => `${(x * 100).toFixed(1)}%`;
const lines = [
  `Words compared: ${words.length}`,
  `Identical to eSpeak: ${pct(exact / words.length)} (ignoring stress marks: ${pct(exactNoStress / words.length)})`,
  `Phoneme error rate: ${pct(err / ref)} (ignoring stress marks: ${pct(errNoStress / refNoStress)})`,
];
console.log(lines.join('\n'));
worst.sort((x, y) => y.en - x.en);
console.log('\nLargest differences:');
for (const x of worst.slice(0, 25)) console.log(`  ${x.w.padEnd(18)} ours ${x.mine.padEnd(22)} eSpeak ${x.theirs}`);
if (process.argv.includes('--write')) {
  await writeFile(new URL('docs/g2p.json', root), `${JSON.stringify({ date: new Date().toISOString().slice(0, 10), words: words.length, exact: exact / words.length, exactNoStress: exactNoStress / words.length, per: err / ref, perNoStress: errNoStress / refNoStress }, null, 2)}\n`);
}
