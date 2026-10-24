import { test } from 'node:test';
import assert from 'node:assert/strict';
import { guessWord, kokoroPhonemes, normalize, numberWords, phonemize, toIpa } from '../src/g2p.js';

test('numbers, money, times, ordinals and years become words', () => {
  assert.equal(numberWords(1250), 'one thousand two hundred fifty');
  assert.equal(numberWords(42), 'forty two');
  assert.equal(normalize('$1,250.50'), 'one thousand two hundred fifty dollars and fifty cents');
  assert.equal(normalize('£1'), 'one pound');
  assert.equal(normalize('7:45'), 'seven forty five');
  assert.equal(normalize('9:05'), 'nine oh five');
  assert.equal(normalize('3rd and 21st'), 'third and twenty first');
  assert.equal(normalize('in 2026'), 'in twenty twenty six');
  assert.equal(normalize('in 2005'), 'in two thousand five');
  assert.equal(normalize('the 1990s'), 'the nineteen nineties');
  assert.equal(normalize('45%'), 'forty five percent');
  assert.equal(normalize('Dr. Patel'), 'Doctor Patel');
  assert.equal(normalize('3.14'), 'three point one four');
});

test('normalising twice changes nothing', () => {
  const once = normalize('On March 3rd, 2026, Dr. Patel paid $1,250 at 7:45.');
  assert.equal(normalize(once), once);
});

test('dictionary words come out the way eSpeak writes them', async () => {
  assert.equal(await phonemize('hello'), 'həlˈoʊ');
  assert.equal(await phonemize('world'), 'wˈɜːld');
  assert.equal(await phonemize('better'), 'bˈɛɾɚ');
  assert.equal(await phonemize('button'), 'bˈʌʔn̩');
  assert.equal(await phonemize('I read the book'), 'aɪ ɹˈiːd ðə bˈʊk');
});

test('unknown words are derived or guessed, never dropped', async () => {
  assert.match(await phonemize('normalisation'), /zˈeɪʃən$/);
  assert.equal(await phonemize("Cadence's"), 'kˈeɪdənsɪz');
  assert.ok((await phonemize('zorblax')).length > 4);
  assert.ok(guessWord('kokoro').at(-1) === 'OW0');
  // Spelled, as eSpeak spells it.
  assert.equal(await phonemize('CPU'), 'sˌiːpˌiːjˈuː');
  assert.equal(await phonemize('src'), 'ˈɛsˈɑːɹsˈiː');
});

test('flap and syllabic n follow the stress', () => {
  assert.equal(toIpa(['W', 'AO1', 'T', 'ER0']), 'wˈɔːɾɚ');
  assert.equal(toIpa(['AH0', 'T', 'AE1', 'K']), 'ɐtˈæk');
});

test('British voices get non-rhotic forms', async () => {
  assert.equal(await phonemize('hello', { dialect: 'gb' }), 'həlˈəʊ');
  assert.equal(await phonemize('water', { dialect: 'gb' }), 'wˈɔːtə');
});

test('Kokoro input keeps punctuation as written', async () => {
  await phonemize('warm');
  assert.equal(kokoroPhonemes('Hello, world!', 'a'), 'həlˈoʊ, wˈɜːld!');
});
