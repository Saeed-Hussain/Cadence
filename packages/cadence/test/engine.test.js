import { test } from 'node:test';
import assert from 'node:assert/strict';
import { VOICES, ORIGINAL_IDS, encodeWav, estimatePitch, matchPitch } from '../src/index.js';

test('library has 200+ unique voices built on the 28 originals', () => {
  assert.ok(VOICES.length >= 200, `${VOICES.length}`);
  assert.equal(new Set(VOICES.map((v) => v.id)).size, VOICES.length);
  assert.equal(new Set(VOICES.map((v) => v.name)).size, VOICES.length, 'names are unique');
  assert.equal(ORIGINAL_IDS.length, 28);
  for (const v of VOICES) {
    assert.ok(v.mix.length >= 1);
    for (const [id, w] of v.mix) assert.ok(ORIGINAL_IDS.includes(id) && w > 0, `${v.id}: ${id}`);
    assert.ok(Math.abs(v.mix.reduce((s, [, w]) => s + w, 0) - 1) < 0.01, `${v.id} weights sum to 1`);
  }
});

test('blends never mix genders', () => {
  for (const v of VOICES) for (const [id] of v.mix) assert.equal(id[1] === 'f', v.gender === 'female', v.id);
});

test('pitch matching picks the right side of the voice range', () => {
  assert.equal(matchPitch(210).gender, 'female');
  assert.equal(matchPitch(100).gender, 'male');
});

test('pitch estimate recovers a pure tone', () => {
  for (const f of [110, 210]) {
    const s = new Float32Array(24000).map((_, i) => Math.sin((2 * Math.PI * f * i) / 24000) + 0.4 * Math.sin((4 * Math.PI * f * i) / 24000));
    const est = estimatePitch(s, 24000);
    assert.ok(Math.abs(est - f) / f < 0.05, `${f} -> ${est}`);
  }
});

test('wav header is well formed', () => {
  const wav = encodeWav(new Float32Array(100), 24000);
  assert.equal(wav.length, 244);
  assert.equal(String.fromCharCode(...wav.slice(0, 4)), 'RIFF');
});
