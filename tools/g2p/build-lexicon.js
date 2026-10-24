/**
 * Build the engine's pronunciation lexicon from CMUdict (BSD 2-clause).
 *
 *   node tools/g2p/build-lexicon.js
 *
 * Downloads CMUdict once into .cache/g2p/, keeps one pronunciation per word
 * (the dictionary's first, except a few homographs where the other reading is
 * the commoner one), encodes each phone as one character, and writes
 * packages/cadence/src/data/lexicon.bin, gzipped. The engine decodes it with
 * the same table (PHONES in packages/cadence/src/g2p.js).
 */

import { existsSync } from 'node:fs';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { gzipSync } from 'node:zlib';
import { PHONES } from '../../packages/cadence/src/g2p.js';

const CACHE = new URL('../../.cache/g2p/', import.meta.url);
const SRC = 'https://raw.githubusercontent.com/cmusphinx/cmudict/master/cmudict.dict';
const OUT = new URL('../../packages/cadence/src/data/lexicon.bin', import.meta.url);

// The reading people mean more often, where CMUdict lists the other first.
const PREFER = {
  read: 'R IY1 D', live: 'L IH1 V', lead: 'L IY1 D', wind: 'W IH1 N D', close: 'K L OW1 Z',
  use: 'Y UW1 Z', record: 'R EH1 K ER0 D', present: 'P R EH1 Z AH0 N T', object: 'AA1 B JH EH0 K T',
  the: 'DH AH0', a: 'AH0', an: 'AE1 N', and: 'AE1 N D', to: 'T UW1', of: 'AH1 V', for: 'F AO1 R',
  data: 'D EY1 T AH0', either: 'IY1 DH ER0', route: 'R UW1 T', tomato: 'T AH0 M EY1 T OW2',
};

await mkdir(CACHE, { recursive: true });
const file = new URL('cmudict.dict', CACHE);
if (!existsSync(file)) {
  const res = await fetch(SRC);
  if (!res.ok) throw new Error(`CMUdict: HTTP ${res.status}`);
  await writeFile(file, Buffer.from(await res.arrayBuffer()));
}

const code = new Map(PHONES.map((p, i) => [p, String.fromCharCode(33 + i)]));
/** @type {Map<string, string>} */
const words = new Map();
for (const line of (await readFile(file, 'utf8')).split('\n')) {
  const clean = line.split('#')[0].trim();
  if (!clean) continue;
  const [head, ...phones] = clean.split(/\s+/);
  const word = head.replace(/\(\d+\)$/, '');
  if (words.has(word)) continue;
  const pron = (Object.hasOwn(PREFER, word) ? PREFER[word] : phones.join(' ')).split(' ');
  const enc = pron.map((p) => {
    const c = code.get(p);
    if (!c) throw new Error(`unknown phone ${p} in ${word}`);
    return c;
  }).join('');
  words.set(word, enc);
}
const text = [...words].map(([w, p]) => `${w} ${p}`).join('\n');
const gz = gzipSync(Buffer.from(text), { level: 9 });
await writeFile(OUT, gz);
console.log(`Lexicon: ${words.size} words, ${(text.length / 1e6).toFixed(1)} MB → ${(gz.length / 1e6).toFixed(2)} MB gzipped`);
