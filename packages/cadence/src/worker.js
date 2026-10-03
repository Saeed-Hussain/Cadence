/**
 * The engine's thread. Inference never runs on the page's main thread, so the
 * interface stays at sixty frames a second while a paragraph is being spoken.
 *
 * Requests run one at a time, in order. A cancelled request stops at the next
 * sentence boundary.
 */

import { loadKokoro } from './kokoro.js';

/** @type {ReturnType<typeof loadKokoro> | null} */
let loading = null;
let queue = Promise.resolve();
const cancelled = new Set();

class Cancelled extends Error {}

self.onmessage = (/** @type {MessageEvent} */ { data }) => {
  if (data.type === 'load') {
    loading ??= loadKokoro({
      device: data.device,
      dtype: data.dtype,
      expectedMb: data.expectedMb,
      onProgress: (progress, phase) => self.postMessage({ type: 'progress', progress, phase }),
    });
    loading.then(
      () => self.postMessage({ type: 'ready' }),
      (e) => self.postMessage({ type: 'error', message: String(e?.message ?? e) }),
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
