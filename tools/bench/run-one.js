/**
 * Measure one candidate, natively, and print the result as JSON.
 *
 * Runs in its own process so its memory is its own and the previous
 * candidate's threads are not still warm.
 *
 *   node tools/bench/run-one.js <candidate-id>
 */

import { readFile, writeFile, mkdir } from 'node:fs/promises';
import { CANDIDATES, CORPUS, MODELS_DIR } from './candidates.js';
import { encodeWav } from '../../packages/cadence/src/wav.js';

// Five, because a laptop with a browser open is a noisy place to time anything.
const RUNS = 5;
const id = process.argv[2];
const candidate = CANDIDATES.find((c) => c.id === id);
if (!candidate) throw new Error(`unknown candidate ${id}`);

let peakRss = 0;
const sampler = setInterval(() => { peakRss = Math.max(peakRss, process.memoryUsage().rss); }, 20);

/** @type {{rate: number, speak: (text: string, onChunk: (s: Float32Array) => void) => Promise<void>}} */
let engine;
const loadStart = performance.now();

if (candidate.family === 'piper') {
  const ort = await import('onnxruntime-node');
  const { loadPiper, sentences } = await import('../../packages/cadence/src/piper.js');
  const base = new URL(candidate.file ?? '', MODELS_DIR);
  const config = JSON.parse(await readFile(new URL(`${base.href}.onnx.json`), 'utf8'));
  const model = await readFile(new URL(`${base.href}.onnx`));
  const piper = await loadPiper({ ort, model, config });
  engine = {
    rate: piper.sampleRate,
    async speak(text, onChunk) {
      for (const s of sentences(text)) onChunk(await piper.speak(s));
    },
  };
} else {
  const { loadKokoro } = await import('../../packages/cadence/src/kokoro.js');
  const kokoro = await loadKokoro({ device: 'cpu', dtype: /** @type {any} */ (candidate.dtype) });
  const voice = { lang: /** @type {'a'} */ ('a'), mix: /** @type {[string, number][]} */ ([['af_heart', 1]]) };
  engine = {
    rate: 24000,
    speak: (text, onChunk) => kokoro.generate(text, voice, 1, (s) => onChunk(s)),
  };
}
const loadMs = performance.now() - loadStart;

// One untimed pass: first-run allocation and kernel selection are not what a
// user waiting on their second sentence experiences.
await engine.speak(CORPUS.short, () => {});

/** @type {Record<string, {rtf: number, ttfaMs: number, audioS: number, wallMs: number}>} */
const results = {};
for (const [name, text] of Object.entries(CORPUS)) {
  const runs = [];
  /** @type {Float32Array[]} */
  let audio = [];
  for (let r = 0; r < RUNS; r++) {
    const parts = [];
    const start = performance.now();
    let ttfa = 0;
    await engine.speak(text, (s) => {
      if (!ttfa) ttfa = performance.now() - start;
      parts.push(s);
    });
    const wallMs = performance.now() - start;
    const audioS = parts.reduce((n, p) => n + p.length, 0) / engine.rate;
    runs.push({ rtf: wallMs / 1000 / audioS, ttfaMs: ttfa, audioS, wallMs });
    audio = parts;
  }
  runs.sort((a, b) => a.rtf - b.rtf);
  results[name] = runs[Math.floor(RUNS / 2)];

  if (name === 'medium') {
    const all = new Float32Array(audio.reduce((n, p) => n + p.length, 0));
    let o = 0;
    for (const p of audio) { all.set(p, o); o += p.length; }
    const dir = new URL('../../.cache/bench/samples/', import.meta.url);
    await mkdir(dir, { recursive: true });
    await writeFile(new URL(`${candidate.id}.wav`, dir), encodeWav(all, engine.rate));
  }
}

clearInterval(sampler);
process.stdout.write(`${JSON.stringify({ id: candidate.id, loadMs, peakRssMb: Math.round(peakRss / 1e6), results })}\n`);
process.exit(0);
