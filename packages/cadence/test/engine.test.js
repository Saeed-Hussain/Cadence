import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createEngine, VOICES, encodeWav, SAMPLE_RATE } from '../src/index.js';
import { estimatePitch, render } from '../src/stub.js';

test('library has 200+ unique voices', () => {
  assert.ok(VOICES.length >= 200);
  assert.equal(new Set(VOICES.map((v) => v.id)).size, VOICES.length);
});

test('synthesis is finite, bounded, and deterministic', async () => {
  const engine = createEngine();
  const req = { text: 'Hello there. How are you today?', voice: VOICES[0] };
  const a = await engine.synthesize(req);
  const b = await engine.synthesize(req);
  assert.ok(a.samples.length > SAMPLE_RATE * 0.5);
  assert.ok(a.samples.every((x) => Number.isFinite(x) && Math.abs(x) <= 1));
  assert.deepEqual(a.samples, b.samples);
  assert.ok(a.stats.rtf > 0);
});

test('pitch estimate recovers the voice it was rendered with', () => {
  for (const pitch of [110, 210]) {
    const s = render('aaaa oooo aaaa', { pitch, brightness: 1, breath: 0, pace: 1 });
    const est = estimatePitch(s, SAMPLE_RATE);
    assert.ok(Math.abs(est - pitch) / pitch < 0.15, `${pitch} -> ${est}`);
  }
});

test('wav header is well formed', () => {
  const wav = encodeWav(new Float32Array(100), 24000);
  assert.equal(wav.length, 244);
  assert.equal(String.fromCharCode(...wav.slice(0, 4)), 'RIFF');
});
