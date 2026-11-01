/**
 * The fast path's thread: Piper LibriTTS-R on onnxruntime-web.
 *
 * The engine plans text into pieces (`chunks`) and hands each piece to
 * whichever Swift worker is free. There is always one on the CPU; on capable
 * machines a second runs on the GPU (WebGPU) beside it, and the two speak
 * different pieces at once. Threads are chosen by the engine (`swiftThreads`
 * in index.js).
 *
 * Protocol: `load` with progress, answered `ready` or `error`; then `piece`
 * requests, each answered `piece` (the audio, with its trailing pause) or
 * `piece-failed`.
 */

import { download, forget, isCached } from './download.js';
import { loadPiper } from './piper.js';
import { SWIFT_BASE as BASE, SWIFT_BYTES as MODEL_BYTES, SWIFT_NAME } from './weights.js';

/** Silence after each piece, by how it ends: a clause, a full stop, a question; a piece cut between words gets none. */
const PAUSE = { '.': 0.28, '!': 0.32, '?': 0.34, ',': 0.14, ';': 0.18, ':': 0.18, '—': 0.14, default: 0.02 };

/** @type {Promise<Awaited<ReturnType<typeof loadPiper>>> | null} */
let loading = null;
let queue = Promise.resolve();

self.onmessage = (/** @type {MessageEvent} */ { data }) => {
  if (data.type === 'load') {
    const ep = data.ep ?? 'wasm';
    loading ??= (async () => {
      // The GPU build of the runtime only when this worker is the GPU one.
      const ort = ep === 'webgpu' ? await import('onnxruntime-web/webgpu') : await import('onnxruntime-web/wasm');
      // On the GPU a few integer nodes run on the CPU by design; that is not worth a warning.
      ort.env.logLevel = 'error';
      ort.env.wasm.numThreads = data.threads ?? 1;
      ort.env.wasm.wasmPaths = data.wasmPaths;
      const local = data.modelPaths ? new URL(SWIFT_NAME, data.modelPaths).href : null;
      const quiet = ep === 'webgpu' || !!data.quiet; // helpers load in the background; progress belongs to the main worker
      for (let attempt = 1; ; attempt++) {
        // Read from this device's cache: say so, rather than "downloading".
        if (!quiet && await isCached(`${BASE}.onnx`)) self.postMessage({ type: 'progress', progress: 0.5, phase: 'cache' });
        const config = JSON.parse(new TextDecoder().decode(await download(`${BASE}.onnx.json`, { mirror: local && `${local}.onnx.json` })));
        const model = await download(`${BASE}.onnx`, {
          mirror: local && `${local}.onnx`,
          expectedBytes: MODEL_BYTES,
          onProgress: (p) => { if (!quiet && p < 1) self.postMessage({ type: 'progress', progress: p * 0.97, phase: 'download' }); },
        });
        if (!quiet) self.postMessage({ type: 'progress', progress: 0.98, phase: 'init' });
        try {
          const piper = await loadPiper({ ort, model, config, sessionOptions: { executionProviders: [ep], graphOptimizationLevel: 'all' } });
          // One silent inference now, so the first one the user asks for does
          // not also pay for the runtime's first-call setup.
          await piper.speak('Ready.');
          return piper;
        } catch (e) {
          if (attempt > 1 || quiet) throw e;
          // Weights that downloaded but will not load are damaged: drop them and fetch once more.
          await forget(`${BASE}.onnx`);
          await forget(`${BASE}.onnx.json`);
          self.postMessage({ type: 'progress', progress: 0, phase: 'download' });
        }
      }
    })();
    loading.then(
      (piper) => self.postMessage({ type: 'ready', sampleRate: piper.sampleRate }),
      (e) => { loading = null; self.postMessage({ type: 'error', message: String(e?.message ?? e) }); },
    );
    return;
  }

  if (data.type === 'piece') {
    const { id, index, text, speaker, speed } = data;
    queue = queue.then(async () => {
      try {
        const piper = await /** @type {NonNullable<typeof loading>} */ (loading);
        const audio = await piper.speak(text, { speaker, speed });
        const end = /** @type {keyof typeof PAUSE} */ (text.replace(/["')\]]+$/, '').slice(-1));
        const gap = Math.round(piper.sampleRate * (PAUSE[end] ?? PAUSE.default) / speed);
        const out = new Float32Array(audio.length + gap);
        out.set(audio);
        self.postMessage({ type: 'piece', id, index, samples: out }, { transfer: [out.buffer] });
      } catch (e) {
        self.postMessage({ type: 'piece-failed', id, index, message: String(/** @type {any} */ (e)?.message ?? e) });
      }
    });
  }
};
