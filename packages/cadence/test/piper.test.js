import { test } from 'node:test';
import assert from 'node:assert/strict';
import { chunks, phonemeIds, sentences } from '../src/piper.js';

// A tiny map in Piper's format: every symbol to a list of one id.
const map = Object.fromEntries(
  ['_', '^', '$', ' ', '.', ',', ...'həlˈoʊwɛkmtədns'].map((ch, i) => [ch, [i]]),
);
const config = /** @type {any} */ ({ phoneme_id_map: map, espeak: { voice: 'en-us' } });

test('ids are BOS, then each phoneme followed by the pad, then EOS', async () => {
  const ids = await phonemeIds('Hello.', config);
  assert.equal(ids[0], map['^'][0]);
  assert.equal(ids.at(-1), map.$[0]);
  const body = ids.slice(1, -1);
  // Pad first, then strictly alternating symbol, pad.
  assert.equal(body[0], map._[0]);
  for (let i = 2; i < body.length; i += 2) assert.equal(body[i], map._[0], `pad at ${i}`);
  assert.ok(body.includes(map['.'][0]), 'punctuation survives phonemisation');
});

test('sentences split on terminal punctuation and keep it', () => {
  assert.deepEqual(sentences('One. Two! Three? Four'), ['One.', 'Two!', 'Three?', 'Four']);
  assert.deepEqual(sentences('No ending'), ['No ending']);
});

test('chunks keep short sentences whole and lose no words', () => {
  assert.deepEqual(chunks('One. Two! Three?'), ['One.', 'Two!', 'Three?']);
  const long = 'The lighthouse keeper had not seen a ship in eleven years, and the village below had long since stopped asking her about it, because the answer never changed and the question only made her sad. '.repeat(3);
  const got = chunks(long);
  assert.equal(got.join(' ').replace(/\s+/g, ' '), long.trim().replace(/\s+/g, ' '));
  assert.ok(got[0].length <= 60, `first piece ${got[0].length}`);
  for (const c of got) assert.ok(c.length <= 260, `piece ${c.length}`);
});

test('long sentences split at clauses before words', () => {
  const s = `${'word '.repeat(20).trim()}, ${'more '.repeat(20).trim()}.`;
  const [a] = chunks(s, { first: 120 });
  assert.ok(a.endsWith(','), a);
});
