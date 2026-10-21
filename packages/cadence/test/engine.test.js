import { test } from 'node:test';
import assert from 'node:assert/strict';
import { MODELS, VOICES, encodeWav, estimatePitch, matchPitch } from '../src/index.js';
import { SPEAKERS } from '../src/data/libritts-speakers.js';

const swift = VOICES.filter((v) => v.model === 'swift');
const hd = VOICES.filter((v) => v.model === 'hd');

test('every speaker in the fast model is in the library, once', () => {
  assert.equal(SPEAKERS.length, 904);
  assert.equal(swift.length, SPEAKERS.length);
  const indices = new Set(swift.map((v) => v.speaker));
  assert.equal(indices.size, swift.length);
  for (const i of indices) assert.ok(Number.isInteger(i) && i >= 0 && i < 904, `speaker ${i}`);
});

test('the HD voices are the 28 Kokoro originals', () => {
  assert.equal(hd.length, 28);
  for (const v of hd) {
    assert.deepEqual(v.mix, [[v.id, 1]]);
    assert.ok(v.lang === 'a' || v.lang === 'b');
  }
});

test('ids and names are unique across the whole library', () => {
  assert.equal(new Set(VOICES.map((v) => v.id)).size, VOICES.length);
  assert.equal(new Set(VOICES.map((v) => v.name)).size, VOICES.length);
});

test('labels follow the measurements', () => {
  for (const v of swift) {
    if (v.gender === 'female') assert.ok(v.pitch >= 165, `${v.id} ${v.pitch}`);
    if (v.gender === 'male') assert.ok(v.pitch < 145, `${v.id} ${v.pitch}`);
  }
  // A library that is all one gender means the measurement went wrong.
  const female = swift.filter((v) => v.gender === 'female').length;
  const male = swift.filter((v) => v.gender === 'male').length;
  assert.ok(female > 100 && male > 100, `female ${female}, male ${male}`);
});

test('every voice belongs to a model the engine knows', () => {
  const ids = new Set(MODELS.map((m) => m.id));
  for (const v of VOICES) assert.ok(ids.has(v.model), v.id);
});

test('pitch matching returns the nearest Swift voice', () => {
  for (const target of [95, 130, 180, 240]) {
    const got = matchPitch(target);
    assert.equal(got.model, 'swift');
    const best = Math.min(...swift.filter((v) => v.pitch > 0).map((v) => Math.abs(v.pitch - target)));
    assert.equal(Math.abs(got.pitch - target), best);
  }
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
