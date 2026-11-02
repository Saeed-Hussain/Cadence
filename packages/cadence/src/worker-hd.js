/**
 * The HD path's thread: Kokoro-82M on ONNX Runtime, the same runtime as
 * Swift. Inference never runs on the page's main thread, so the interface
 * stays smooth while a paragraph is being spoken.
 *
 * Requests run one at a time, in order. A cancelled request stops at the next
 * sentence boundary.
 */

import * as ort from 'onnxruntime-web/wasm';
import { CACHE, download, forget } from './download.js';
import { loadKokoro } from './kokoro.js';
import { HD_BYTES, HD_MODEL } from './weights.js';

/** @type {ReturnType<typeof loadKokoro> | null} */
let loading = null;
let queue = Promise.resolve();
const cancelled = new Set();

class Cancelled extends Error {}

/**
 * Before Cadence ran HD itself, transformers.js downloaded the same file into
 * its own cache. Reuse that copy rather than fetch 326 MB again.
 */
async function earlierCopy() {
  try {
    const hit = await (await caches.open('transformers-cache')).match(HD_MODEL);
    return hit ? new Uint8Array(await hit.arrayBuffer()) : null;
  } catch { return null; }
}

self.onmessage = (/** @type {MessageEvent} */ { data }) => {
  if (data.type === 'load') {
    loading ??= (async () => {
      ort.env.logLevel = 'error';
      ort.env.wasm.numThreads = data.threads ?? 1;
      ort.env.wasm.wasmPaths = data.wasmPaths;
      const progress = (/** @type {number} */ p, /** @type {string} */ phase) => self.postMessage({ type: 'progress', progress: p, phase });
      for (let attempt = 1; ; attempt++) {
        const old = attempt === 1 ? await earlierCopy() : null;
        if (old?.length === HD_BYTES) progress(0.5, 'cache');
        const model = old?.length === HD_BYTES ? old : await download(HD_MODEL, {
          expectedBytes: HD_BYTES,
          onProgress: (p) => { if (p < 1) progress(p * 0.97, 'download'); },
        });
        progress(0.98, 'init');
        try {
          const kokoro = await loadKokoro({ ort, model });
          if (old) {
            // Keep it where Cadence looks next time, and free the old cache.
            try { await (await caches.open(CACHE)).put(HD_MODEL, new Response(model.slice())); await caches.delete('transformers-cache'); } catch { /* kept where it was */ }
          }
          return kokoro;
        } catch (e) {
          if (attempt > 1) throw e;
          // Weights that downloaded but will not load are damaged: drop them and fetch once more.
          await forget(HD_MODEL);
          progress(0, 'download');
        }
      }
    })();
    loading.then(
      () => self.postMessage({ type: 'ready' }),
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
        const backend = await /** @type {NonNullable<typeof loading>} */ (loading);
        await backend.generate(text, voice, speed, (samples) => {
          if (cancelled.has(id)) throw new Cancelled();
          self.postMessage({ type: 'chunk', id, samples }, { transfer: [samples.buffer] });
        });
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
