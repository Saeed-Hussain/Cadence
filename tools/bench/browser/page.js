/**
 * The browser half of the benchmark: the same candidate, the same passages,
 * the same median-of-five, inside Chrome. Configured by the query string:
 *
 *   ?model=en_US-libritts_r-medium&ep=wasm&threads=4
 *   ?model=en_US-libritts_r-medium&ep=webgpu
 *
 * Writes its result to `window.__result` for the driver to collect.
 */

import * as ort from 'onnxruntime-web';
import { loadPiper, phonemeIds, sentences } from '/packages/cadence/src/piper.js';
import { CORPUS } from '../candidates.js';

const RUNS = 5;
const q = new URLSearchParams(location.search);
const file = q.get('model') ?? 'en_US-libritts_r-medium';
const ep = q.get('ep') ?? 'wasm';
const threads = Number(q.get('threads') ?? navigator.hardwareConcurrency);

try {
  ort.env.wasm.numThreads = threads;
  ort.env.wasm.wasmPaths = '/node_modules/onnxruntime-web/dist/';

  const loadStart = performance.now();
  const [config, model] = await Promise.all([
    fetch(`/.cache/models/${file}.onnx.json`).then((r) => r.json()),
    fetch(`/.cache/models/${file}.onnx`).then((r) => r.arrayBuffer()),
  ]);
  const piper = await loadPiper({
    ort,
    model: new Uint8Array(model),
    config,
    sessionOptions: { executionProviders: [ep], graphOptimizationLevel: 'all' },
  });
  const loadMs = performance.now() - loadStart;

  const speak = async (/** @type {string} */ text, /** @type {(s: Float32Array) => void} */ onChunk) => {
    for (const s of sentences(text)) onChunk(await piper.speak(s));
  };
  await speak(CORPUS.short, () => {});

  // ?profile: where one short sentence's time goes, phonemes versus model.
  if (q.has('profile')) {
    const rows = [];
    for (let i = 0; i < 5; i++) {
      let t = performance.now();
      await phonemeIds(CORPUS.short, config);
      const phonemesMs = performance.now() - t;
      t = performance.now();
      await piper.speak(CORPUS.short);
      rows.push({ phonemesMs, speakMs: performance.now() - t });
    }
    window.__result = { ep, threads, profile: rows };
    throw 'done';
  }

  /** @type {Record<string, any>} */
  const results = {};
  for (const [name, text] of Object.entries(CORPUS)) {
    const runs = [];
    for (let r = 0; r < RUNS; r++) {
      let samples = 0;
      let ttfa = 0;
      const start = performance.now();
      await speak(text, (s) => {
        if (!ttfa) ttfa = performance.now() - start;
        samples += s.length;
      });
      const wallMs = performance.now() - start;
      const audioS = samples / piper.sampleRate;
      runs.push({ rtf: wallMs / 1000 / audioS, ttfaMs: ttfa, audioS, wallMs });
    }
    runs.sort((a, b) => a.rtf - b.rtf);
    results[name] = runs[Math.floor(RUNS / 2)];
  }
  window.__result = {
    ep, threads: ep === 'wasm' ? threads : null, isolated: crossOriginIsolated, loadMs, results,
    memoryMb: /** @type {any} */ (performance).memory ? Math.round(/** @type {any} */ (performance).memory.usedJSHeapSize / 1e6) : null,
  };
} catch (e) {
  if (e === 'done') { /* profile finished */ } else window.__result = { ep, threads, error: String(/** @type {any} */ (e)?.message ?? e).slice(0, 300) };
}
