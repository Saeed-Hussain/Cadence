import { test } from 'node:test';
import assert from 'node:assert/strict';
import { existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

// The real model, if `npm run bench:fetch` or the web app's build has put it
// on disk. CI has no weights and skips; the reference machine runs it.
const dir = fileURLToPath(new URL('../../../.cache/models/', import.meta.url));
const have = existsSync(`${dir}en_US-libritts_r-medium.onnx`) && existsSync(`${dir}en_US-libritts_r-medium.onnx.json`);
const skip = !have && 'no weights in .cache/models';

test('Node: speech in a few lines', { skip }, async () => {
  const { createEngine } = await import('../src/node.js');
  const engine = await createEngine({ dir });
  if (engine.warning) console.log(`# ${engine.warning}`);
  const pieces = [];
  const r = await engine.synthesize({ text: 'Hello from Cadence. This runs on your own machine.', onChunk: (c) => pieces.push(c.length) });
  assert.equal(r.sampleRate, 22050);
  assert.ok(r.stats.seconds > 1.5 && r.stats.seconds < 8, `${r.stats.seconds} s`);
  assert.equal(pieces.length, 2);
  assert.ok(r.stats.rtf > 0 && r.stats.rtf < 1, `RTF ${r.stats.rtf} on ${engine.backend}`);
  let peak = 0;
  for (const x of r.samples) peak = Math.max(peak, Math.abs(x));
  assert.ok(peak > 0.05, 'not silence');
  await assert.rejects(engine.synthesize({ text: 'x', voice: 'nobody' }), /Unknown voice/);
});
