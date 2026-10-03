import { test } from 'node:test';
import assert from 'node:assert/strict';
import { phonemeIds, sentences } from '../src/piper.js';

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
