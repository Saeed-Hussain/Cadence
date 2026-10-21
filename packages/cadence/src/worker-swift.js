/**
 * The fast path's thread: Piper LibriTTS-R on onnxruntime-web.
 *
 * Threads are chosen by the engine (`swiftThreads` in index.js): one on small
 * machines, where one measured fastest, more on machines with the cores.
 *
 * Same protocol as the HD worker: load with progress, then generate requests
 * answered piece by piece (see `chunks`), cancellable between pieces.
 */

import * as ort from 'onnxruntime-web/wasm';
import { download, forget, isCached } from './download.js';
import { chunks, loadPiper } from './piper.js';
import { SWIFT_BASE as BASE, SWIFT_BYTES as MODEL_BYTES, SWIFT_NAME } from './weights.js';

/** Silence after each piece, by how it ends: a clause, a full stop, a question; a piece cut between words gets none. */
const PAUSE = { '.': 0.28, '!': 0.32, '?': 0.34, ',': 0.14, ';': 0.18, ':': 0.18, '—': 0.14, default: 0.02 };

/** @type {Promise<Awaited<ReturnType<typeof loadPiper>>> | null} */
let loading = null;
let queue = Promise.resolve();
const cancelled = new Set();

class Cancelled extends Error {}

self.onmessage = (/** @type {MessageEvent} */ { data }) => {
  if (data.type === 'load') {
    ort.env.wasm.numThreads = data.threads ?? 1;
    ort.env.wasm.wasmPaths = data.wasmPaths;
    loading ??= (async () => {
      const local = data.modelPaths ? new URL(SWIFT_NAME, data.modelPaths).href : null;
      for (let attempt = 1; ; attempt++) {
        // Read from this device's cache: say so, rather than "downloading".
        if (await isCached(`${BASE}.onnx`)) self.postMessage({ type: 'progress', progress: 0.5, phase: 'cache' });
        const config = JSON.parse(new TextDecoder().decode(await download(`${BASE}.onnx.json`, { mirror: local && `${local}.onnx.json` })));
        const model = await download(`${BASE}.onnx`, {
          mirror: local && `${local}.onnx`,
          expectedBytes: MODEL_BYTES,
          onProgress: (p) => { if (p < 1) self.postMessage({ type: 'progress', progress: p * 0.97, phase: 'download' }); },
        });
        self.postMessage({ type: 'progress', progress: 0.98, phase: 'init' });
        try {
          return await loadPiper({ ort, model, config, sessionOptions: { executionProviders: ['wasm'], graphOptimizationLevel: 'all' } });
        } catch (e) {
          if (attempt > 1) throw e;
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

  if (data.type === 'cancel') {
    cancelled.add(data.id);
    return;
  }

  if (data.type === 'generate') {
    const { id, text, voice, speed } = data;
    queue = queue.then(async () => {
      if (cancelled.delete(id)) return self.postMessage({ type: 'done', id, cancelled: true });
      try {
        const piper = await /** @type {NonNullable<typeof loading>} */ (loading);
        for (const piece of chunks(text)) {
          if (cancelled.has(id)) throw new Cancelled();
          const audio = await piper.speak(piece, { speaker: voice.speaker, speed });
          const end = /** @type {keyof typeof PAUSE} */ (piece.replace(/["')]]+$/, '').slice(-1));
          const gap = Math.round(piper.sampleRate * (PAUSE[end] ?? PAUSE.default) / speed);
          const out = new Float32Array(audio.length + gap);
          out.set(audio);
          self.postMessage({ type: 'chunk', id, samples: out }, { transfer: [out.buffer] });
        }
        self.postMessage({ type: 'done', id });
      } catch (e) {
        if (e instanceof Cancelled) self.postMessage({ type: 'done', id, cancelled: true });
        else self.postMessage({ type: 'failed', id, message: String(/** @type {any} */ (e)?.message ?? e) });
      } finally {
        cancelled.delete(id);
      }
    });
  }
};
