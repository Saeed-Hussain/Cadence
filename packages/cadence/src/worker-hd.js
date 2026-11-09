/**
 * The HD path's thread: Kokoro-82M on ONNX Runtime, the same runtime as
 * Swift; as HD-Fast where the app serves its files (see `loadKokoro`).
 * Inference never runs on the page's main thread, so the interface stays
 * smooth while a paragraph is being spoken.
 *
 * It speaks one piece of a text at a time, in the order asked (the engine's
 * `speakPool`).
 */

import * as ort from 'onnxruntime-web/wasm';
import { CACHE, download, forget, isCached } from './download.js';
import { loadKokoro } from './kokoro.js';
import { HD_BYTES, HD_MODEL, HDFAST_BYTES, HDFAST_FILES } from './weights.js';

/** @type {ReturnType<typeof loadKokoro> | null} */
let loading = null;

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

/** HD-Fast's two files, where the app serves them; null where it does not. */
async function fastFiles(/** @type {string | null} */ modelPaths) {
  if (!modelPaths) return null;
  const urls = { front: new URL(HDFAST_FILES.front, modelPaths).href, back: new URL(HDFAST_FILES.back, modelPaths).href };
  const here = await Promise.all(Object.values(urls).map(async (u) => (await isCached(u)) || (await fetch(u, { method: 'HEAD' }).then((r) => r.ok, () => false))));
  return here.every(Boolean) ? urls : null;
}

/**
 * HD-Fast's back half in a worker of its own (worker-hd-back.js), as the
 * function `loadKokoro` calls for each piece. A 100-sentence paragraph (8.1
 * minutes of speech) on a Ryzen 5 7430U, 12 threads, in the app: both halves
 * in one worker 56–69 s; split 6 and 6, 36–40 s once warm (46–57 s for the
 * first paragraph after the page opens); split 8 and 4, 39–57 s.
 *
 * @param {Uint8Array} model @param {number} threads @param {string} wasmPaths
 * @returns {Promise<(inputs: import('./kokoro.js').BackInputs) => Promise<Float32Array>>}
 */
async function backThread(model, threads, wasmPaths) {
  const w = new Worker(new URL('./worker-hd-back.js', import.meta.url), { type: 'module' });
  /** @type {Map<number, {resolve: (s: Float32Array) => void, reject: (e: Error) => void}>} */
  const jobs = new Map();
  let next = 0;
  /** @type {(e: Error) => void} */
  let failed = () => {};
  const fail = (/** @type {string} */ message) => {
    failed(new Error(message));
    for (const job of jobs.values()) job.reject(new Error(message));
    jobs.clear();
    // Without its back half this worker cannot speak: stop it, so the engine
    // retires it and loads HD afresh next time instead of waiting on it.
    setTimeout(() => { throw new Error(message); });
  };
  w.addEventListener('error', (e) => { e.preventDefault?.(); fail(`HD-Fast's back half stopped: ${e.message || 'worker error'}`); });
  await new Promise((resolve, reject) => {
    failed = reject;
    w.onmessage = ({ data }) => {
      if (data.type === 'ready') resolve(undefined);
      else if (data.type === 'error') reject(new Error(data.message));
      else if (data.type === 'done' || data.type === 'failed') {
        const job = jobs.get(data.id);
        jobs.delete(data.id);
        if (data.type === 'done') job?.resolve(data.samples);
        else job?.reject(new Error(data.message));
      }
    };
    w.postMessage({ type: 'load', model, threads, wasmPaths }, { transfer: [model.buffer] });
  });
  failed = () => {};
  const plain = (/** @type {import('onnxruntime-web').Tensor} */ t) => ({ data: /** @type {Float32Array} */ (t.data), dims: [...t.dims] });
  return (inputs) => new Promise((resolve, reject) => {
    const id = next++;
    jobs.set(id, { resolve, reject });
    w.postMessage({ type: 'run', id, asr: plain(inputs.asr), f0: plain(inputs.f0), n: plain(inputs.n), style: plain(inputs.style) });
  });
}

/**
 * @param {{front: string, back: string}} urls @param {(p: number, phase: string) => void} progress
 * @param {number} threads @param {string} wasmPaths
 */
async function loadFast(urls, progress, threads, wasmPaths) {
  if (await isCached(urls.front) && await isCached(urls.back)) progress(0.5, 'cache');
  const total = HDFAST_BYTES.front + HDFAST_BYTES.back;
  const got = { front: 0, back: 0 };
  const each = /** @type {const} */ (['front', 'back']).map((k) => download(urls[k], {
    expectedBytes: HDFAST_BYTES[k],
    onProgress: (p) => { got[k] = p * HDFAST_BYTES[k]; if (p < 1) progress(((got.front + got.back) / total) * 0.97, 'download'); },
  }));
  const [front, back] = await Promise.all(each);
  progress(0.98, 'init');
  try {
    // With the threads to share, the back half gets a thread of its own and
    // half of them, so the two halves of consecutive pieces overlap.
    if (threads < 4) return await loadKokoro({ ort, fast: { front, back } });
    ort.env.wasm.numThreads = Math.ceil(threads / 2);
    return await loadKokoro({ ort, fast: { front, back: await backThread(back, threads - Math.ceil(threads / 2), wasmPaths) } });
  } catch (e) {
    // Damaged on this device: fetched again next time.
    await forget(urls.front); await forget(urls.back);
    throw e;
  }
}

self.onmessage = (/** @type {MessageEvent} */ { data }) => {
  if (data.type === 'load') {
    loading ??= (async () => {
      ort.env.logLevel = 'error';
      ort.env.wasm.numThreads = data.threads ?? 1;
      ort.env.wasm.wasmPaths = data.wasmPaths;
      const progress = (/** @type {number} */ p, /** @type {string} */ phase) => self.postMessage({ type: 'progress', progress: p, phase });
      const fast = data.fast ? await fastFiles(data.modelPaths) : null;
      if (fast) {
        try {
          const kokoro = await loadFast(fast, progress, data.threads ?? 1, data.wasmPaths);
          self.postMessage({ type: 'variant', variant: 'fast' });
          return kokoro;
        } catch { progress(0, 'download'); /* Kokoro whole, below */ }
      }
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

  if (data.type === 'piece') {
    // Not queued here: `loadKokoro` takes pieces in turn at each half, so the
    // next piece's front half can start while this one's back half runs.
    const { id, index, text, voice, speed } = data;
    (async () => {
      try {
        const kokoro = await /** @type {NonNullable<typeof loading>} */ (loading);
        const samples = await kokoro.piece(text, voice, speed);
        self.postMessage({ type: 'piece', id, index, samples }, { transfer: [samples.buffer] });
      } catch (e) {
        self.postMessage({ type: 'piece-failed', id, index, message: String(/** @type {any} */ (e)?.message ?? e) });
      }
    })();
  }
};
