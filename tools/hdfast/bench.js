/**
 * HD-Fast against Cadence HD on this machine: the same passage, piece by
 * piece, through Kokoro whole and through Kokoro's front half plus HD-Fast's
 * back half, on onnxruntime-web (WebAssembly, as in the app).
 *
 *   node tools/hdfast/bench.js [threads=4] [voice=af_heart]
 *
 * Reads .cache/models/kokoro/model.onnx and .cache/hdfast/onnx/{kokoro-front,
 * hdfast-back}.onnx; writes both readings to output/hdfast/bench/.
 */

import { existsSync } from 'node:fs';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { createRequire } from 'node:module';
import { join } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { KOKORO_VOCAB } from '../../packages/cadence/src/data/kokoro-vocab.js';
import { kokoroPhonemes, loadLexicon } from '../../packages/cadence/src/g2p.js';
import { chunks } from '../../packages/cadence/src/piper.js';

const ROOT = fileURLToPath(new URL('../../', import.meta.url));
const OUT = join(ROOT, 'output/hdfast/bench');
const SR = 24000;
const args = Object.fromEntries(process.argv.slice(2).map((a) => a.split('=')));
const threads = Number(args.threads ?? 4);
const voice = args.voice ?? 'af_heart';
const TEXT = 'The old lighthouse keeper climbed the stairs every evening, counting each step as his father had taught him. '
  + 'On clear nights, he could see the lights of three villages across the bay. '
  + 'Did anyone still remember why the lamp had been built so high? '
  + 'He doubted it, but he lit it anyway, because ships still passed, and someone had to keep watch. '
  + 'By morning, the fog had lifted, and the harbour was full of boats again.';

const ort = await import(pathToFileURL(createRequire(join(ROOT, 'packages/cadence/package.json')).resolve('onnxruntime-web')).href);
ort.env.wasm.numThreads = threads;
await loadLexicon();
await mkdir(OUT, { recursive: true });

const cached = join(ROOT, `.cache/hdfast/voices/${voice}.bin`);
if (!existsSync(cached)) {
  await mkdir(join(ROOT, '.cache/hdfast/voices'), { recursive: true });
  const res = await fetch(`https://huggingface.co/onnx-community/Kokoro-82M-v1.0-ONNX/resolve/main/voices/${voice}.bin`);
  await writeFile(cached, Buffer.from(await res.arrayBuffer()));
}
const buf = await readFile(cached);
const table = new Float32Array(buf.buffer, buf.byteOffset, buf.byteLength / 4);

const open = async (/** @type {string} */ f) => ort.InferenceSession.create(await readFile(join(ROOT, f)), { executionProviders: ['wasm'], graphOptimizationLevel: 'all' });
const whole = await open('.cache/models/kokoro/model.onnx');
const front = await open('.cache/hdfast/onnx/kokoro-front.onnx');
const back = await open('.cache/hdfast/onnx/hdfast-back.onnx');

const inputs = (/** @type {string} */ phonemes) => {
  const ids = [0];
  for (const ch of phonemes) { const id = KOKORO_VOCAB[ch]; if (id !== undefined) ids.push(id); }
  ids.push(0);
  // Kokoro's row for a sentence: its phoneme count less one (what HD-Fast was trained with).
  const row = 256 * Math.min(Math.max(ids.length - 3, 0), 509);
  return {
    input_ids: new ort.Tensor('int64', BigInt64Array.from(ids, BigInt), [1, ids.length]),
    style: new ort.Tensor('float32', table.slice(row, row + 256), [1, 256]),
    speed: new ort.Tensor('float32', new Float32Array([1]), [1]),
  };
};
const hd = async (/** @type {any} */ x) => /** @type {Float32Array} */ ((await whole.run(x)).waveform.data);
const fast = async (/** @type {any} */ x) => {
  const f = await front.run(x);
  return /** @type {Float32Array} */ ((await back.run({ asr: f.asr, f0: f.f0, n: f.n, style: x.style })).waveform.data);
};

// Warm both up, so neither pays for the runtime's first call.
const warm = inputs(kokoroPhonemes('Ready.', 'a'));
await hd(warm); await fast(warm);

const pieces = [...chunks(TEXT, { first: 30 })];
const result = {};
for (const [name, run] of /** @type {const} */ ([['hd', hd], ['fast', fast]])) {
  const audio = [];
  let took = 0;
  let first = 0;
  for (const piece of pieces) {
    const x = inputs(kokoroPhonemes(piece, 'a'));
    const t = performance.now();
    audio.push(await run(x));
    took += performance.now() - t;
    first ||= took;
  }
  const all = new Float32Array(audio.reduce((n, a) => n + a.length, 0));
  audio.reduce((o, a) => (all.set(a, o), o + a.length), 0);
  await writeFile(join(OUT, `${name}-${voice}.wav`), wav(all));
  result[name] = { seconds: all.length / SR, took: took / 1000, first: first / 1000 };
  console.log(`${name.padEnd(4)}  ${(all.length / SR).toFixed(1)} s of speech in ${(took / 1000).toFixed(1)} s  ·  ${(took / 1000 / (all.length / SR)).toFixed(3)} of real time  ·  first piece ${(first / 1000).toFixed(2)} s`);
}
console.log(`\nHD-Fast is ${(result.hd.took / result.fast.took).toFixed(1)}× faster on ${threads} threads (${pieces.length} pieces). Audio: ${OUT}`);

function wav(/** @type {Float32Array} */ a) {
  const b = Buffer.alloc(44 + a.length * 2);
  b.write('RIFF', 0); b.writeUInt32LE(36 + a.length * 2, 4); b.write('WAVEfmt ', 8);
  b.writeUInt32LE(16, 16); b.writeUInt16LE(1, 20); b.writeUInt16LE(1, 22); b.writeUInt32LE(SR, 24);
  b.writeUInt32LE(SR * 2, 28); b.writeUInt16LE(2, 32); b.writeUInt16LE(16, 34); b.write('data', 36); b.writeUInt32LE(a.length * 2, 40);
  a.forEach((v, i) => b.writeInt16LE(Math.round(Math.max(-1, Math.min(1, v)) * 32767), 44 + i * 2));
  return b;
}
