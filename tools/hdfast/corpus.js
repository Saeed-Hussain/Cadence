/**
 * The text HD-Fast learns from: public-domain books, modern sentences full of
 * the things books lack (numbers, dates, money, technology), and the
 * project's own prose. Every sentence is phonemised by Cadence's own front
 * end, because those are the phonemes the model will be given in the app.
 *
 *   node tools/hdfast/corpus.js
 *
 * Books are fetched once from Project Gutenberg into .cache/hdfast/books/.
 * Writes .cache/hdfast/dataset/corpus.jsonl (training) and test.jsonl
 * (held out for the final comparison against Cadence HD), one line each:
 *   {"id", "text", "voice", "lang", "phonemes"}
 */

import { existsSync } from 'node:fs';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { KOKORO_VOCAB } from '../../packages/cadence/src/data/kokoro-vocab.js';
import { kokoroPhonemes, loadLexicon } from '../../packages/cadence/src/g2p.js';
import { sentences } from '../../packages/cadence/src/piper.js';
import { VOICES } from '../../packages/cadence/src/voices.js';

const ROOT = fileURLToPath(new URL('../../', import.meta.url));
const BOOKS = join(ROOT, '.cache/hdfast/books');
const OUT = join(ROOT, '.cache/hdfast/dataset');
/** Project Gutenberg ids: novels, stories and essays, all public domain. */
const IDS = [1342, 1661, 84, 11, 2701, 98, 1260, 345, 76, 74, 1400, 120, 43, 5200, 2591, 205, 1952, 158, 768, 174, 16, 1184, 2852, 219, 1080, 55];
const PER_BOOK = 900;
const MODERN = 4000;
const TEST = 300;

// A seeded random, so the corpus is the same every time it is built.
let seed = 20261102;
const random = () => ((seed = (seed * 1664525 + 1013904223) >>> 0) / 2 ** 32);
const pick = (/** @type {any[]} */ a) => a[Math.floor(random() * a.length)];
const shuffle = (/** @type {any[]} */ a) => { for (let i = a.length - 1; i > 0; i--) { const j = Math.floor(random() * (i + 1)); [a[i], a[j]] = [a[j], a[i]]; } return a; };

await mkdir(BOOKS, { recursive: true });
await mkdir(OUT, { recursive: true });
await loadLexicon();

/** A book's sentences, without the Gutenberg header, footer, headings and italics marks. */
async function book(/** @type {number} */ id) {
  const file = join(BOOKS, `pg${id}.txt`);
  if (!existsSync(file)) {
    const res = await fetch(`https://www.gutenberg.org/cache/epub/${id}/pg${id}.txt`);
    if (!res.ok) return [];
    await writeFile(file, await res.text());
  }
  let text = (await readFile(file, 'utf8')).replace(/\r\n/g, '\n');
  const start = text.search(/\*\*\* ?START OF (THE|THIS) PROJECT GUTENBERG/i);
  const end = text.search(/\*\*\* ?END OF (THE|THIS) PROJECT GUTENBERG/i);
  if (start >= 0) text = text.slice(text.indexOf('\n', start) + 1, end > start ? end : undefined);
  const paragraphs = text.split(/\n\s*\n/)
    .map((p) => p.replace(/\s*\n\s*/g, ' ').replace(/_/g, '').replace(/\[[^\]]*\]/g, '').trim())
    // Headings, tables of contents and verse lines are not running prose.
    .filter((p) => p.length > 60 && !/^(CHAPTER|BOOK|PART|ACT|SCENE|STAVE)\b/i.test(p) && p !== p.toUpperCase());
  return paragraphs.flatMap((p) => sentences(p)).filter(clean);
}

/** Running prose of a speakable length, in characters a reader would meet. */
function clean(/** @type {string} */ s) {
  return s.length >= 25 && s.length <= 220 && /^[A-Z"'“‘(]/.test(s) && /[.!?]["'”’)]?$/.test(s)
    && !/[^A-Za-z0-9 .,;:!?'"“”‘’()\-—–&%$£€°/]/.test(s) && !/\b[A-Z]{4,}\b/.test(s);
}

/** Sentences of the kind people type into Cadence today. */
function modern() {
  const names = ['Maya', 'Omar', 'Lena', 'Raj', 'Sofia', 'Daniel', 'Aisha', 'Tom', 'Grace', 'Ken', 'Fatima', 'Leo'];
  const things = ['the report', 'the invoice', 'your order', 'the update', 'the presentation', 'the new app', 'the contract', 'the podcast', 'the video', 'the meeting notes'];
  const months = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'];
  const tech = ['Wi-Fi', 'iPhone', 'Bluetooth', 'the browser', 'the AI model', 'the API', 'the GPU', 'your laptop', 'YouTube', 'the cloud', 'iOS', 'the CPU'];
  const n = (lo, hi) => lo + Math.floor(random() * (hi - lo + 1));
  const templates = [
    () => `${pick(names)} paid $${n(2, 999)}.${String(n(0, 99)).padStart(2, '0')} for ${pick(things)} on ${pick(months)} ${n(1, 28)}.`,
    () => `The meeting starts at ${n(1, 12)}:${pick(['00', '15', '30', '45'])} ${pick(['am', 'pm'])}, so please don't be late.`,
    () => `Sales grew ${n(2, 60)}.${n(0, 9)}% in Q${n(1, 4)} ${n(2019, 2026)}, the best quarter so far.`,
    () => `Can you send ${pick(things)} to ${pick(names)} before ${pick(['Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday'])}?`,
    () => `It was ${n(-10, 40)}°C outside, and ${pick(tech)} stopped working twice.`,
    () => `Version ${n(1, 9)}.${n(0, 9)} is ${n(2, 20)}x faster, and it runs on ${pick(tech)}.`,
    () => `We read ${n(2, 40)} books last year, and ${pick(names)} read even more.`,
    () => `Call ${pick(names)} at ${n(200, 999)}-${n(100, 999)}-${n(1000, 9999)} if ${pick(things)} is late.`,
    () => `Only ${n(1, 9)}/${pick([2, 3, 4, 5, 8, 10])} of the team could join the call on ${n(1, 12)}/${n(1, 28)}/${n(2020, 2026)}.`,
    () => `${pick(names)} said, "I'll record ${pick(things)} tonight, and we can listen tomorrow."`,
    () => `Please close the door, turn off ${pick(tech)}, and check ${pick(things)} again.`,
    () => `The project costs about £${n(1, 900)},${String(n(0, 999)).padStart(3, '0')}, which is ${n(5, 95)}% of the budget.`,
    () => `Visit ${pick(['cadence.ai', 'example.com', 'openlibrary.org', 'news.bbc.co.uk'])} for ${pick(things)}.`,
    () => `Wow! ${pick(names)} won the race in ${n(9, 59)}.${n(10, 99)} seconds, a new record.`,
    () => `Wait... did ${pick(names)} really fix ${pick(tech)} in ${n(2, 59)} minutes?`,
    () => `Step ${n(1, 9)}: open ${pick(tech)}, choose a voice, and press play.`,
  ];
  return Array.from({ length: MODERN }, () => pick(templates)());
}

/** Sentences of the project's own writing (its README and proposal). */
async function own() {
  const out = [];
  for (const f of ['README.md', 'docs/PROPOSAL.md', 'docs/GETTING_STARTED.md']) {
    const md = await readFile(join(ROOT, f), 'utf8').catch(() => '');
    const prose = md.split(/\n\s*\n/).filter((p) => !/^(#|\||```|\s*[-*] |\s*\d+\. |<)/.test(p))
      .map((p) => p.replace(/\s*\n\s*/g, ' ').replace(/`[^`]*`/g, '').replace(/\[([^\]]+)\]\([^)]+\)/g, '$1').replace(/[*_]/g, ''));
    out.push(...prose.flatMap((p) => sentences(p)).filter(clean));
  }
  return out;
}

const voices = VOICES.filter((v) => v.model === 'hd' && v.kind === 'original');
const all = [];
for (const id of IDS) {
  const got = shuffle(await book(id)).slice(0, PER_BOOK);
  all.push(...got);
  console.log(`  book ${String(id).padStart(5)}: ${got.length} sentences`);
}
const ours = await own();
all.push(...modern(), ...ours);
console.log(`  modern: ${MODERN}, project prose: ${ours.length}`);

const seen = new Set();
const rows = [];
let dropped = 0;
for (const text of shuffle(all)) {
  if (seen.has(text)) continue;
  seen.add(text);
  const voice = voices[rows.length % voices.length];
  const phonemes = kokoroPhonemes(text, /** @type {'a' | 'b'} */ (voice.lang));
  // Kokoro reads at most 510 symbols; a symbol outside its vocabulary would be dropped silently.
  if ([...phonemes].some((c) => KOKORO_VOCAB[c] === undefined) || phonemes.length > 500 || phonemes.length < 10) { dropped++; continue; }
  rows.push({ id: `s${String(rows.length).padStart(5, '0')}`, text, voice: voice.id, lang: voice.lang, phonemes });
}
const test = rows.slice(0, TEST);
const train = rows.slice(TEST);
await writeFile(join(OUT, 'corpus.jsonl'), `${train.map((r) => JSON.stringify(r)).join('\n')}\n`);
await writeFile(join(OUT, 'test.jsonl'), `${test.map((r) => JSON.stringify(r)).join('\n')}\n`);
const chars = train.reduce((n, r) => n + r.text.length, 0);
console.log(`\n${train.length} training sentences (${(chars / 1e6).toFixed(2)} M characters, about ${(chars / 15 / 3600).toFixed(0)} hours of speech), ${test.length} held out, ${dropped} dropped, ${voices.length} voices`);
