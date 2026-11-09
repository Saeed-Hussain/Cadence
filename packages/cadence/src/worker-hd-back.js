/**
 * HD-Fast's back half on its own thread (see `loadKokoro`): the HD worker runs
 * Kokoro's front half for one piece while this one turns the piece before it
 * into sound. Each half has its own share of the cores, and neither is held
 * twice in memory.
 *
 * Pieces are run one at a time, in the order they arrive.
 */

import * as ort from 'onnxruntime-web/wasm';

/** @type {Promise<import('onnxruntime-web').InferenceSession> | null} */
let session = null;
let queue = Promise.resolve();

self.onmessage = (/** @type {MessageEvent} */ { data }) => {
  if (data.type === 'load') {
    ort.env.logLevel = 'error';
    ort.env.wasm.numThreads = data.threads ?? 1;
    ort.env.wasm.wasmPaths = data.wasmPaths;
    session = ort.InferenceSession.create(data.model, { executionProviders: ['wasm'], graphOptimizationLevel: 'all' });
    session.then(() => self.postMessage({ type: 'ready' }), (e) => self.postMessage({ type: 'error', message: String(e?.message ?? e) }));
    return;
  }
  if (data.type === 'run') {
    const { id, asr, f0, n, style } = data;
    queue = queue.then(async () => {
      try {
        const s = await /** @type {NonNullable<typeof session>} */ (session);
        const tensor = (/** @type {{data: Float32Array, dims: number[]}} */ t) => new ort.Tensor('float32', t.data, t.dims);
        const out = await s.run({ asr: tensor(asr), f0: tensor(f0), n: tensor(n), style: tensor(style) });
        const samples = /** @type {Float32Array} */ (out.waveform.data);
        self.postMessage({ type: 'done', id, samples }, { transfer: [samples.buffer] });
      } catch (e) {
        self.postMessage({ type: 'failed', id, message: String(/** @type {any} */ (e)?.message ?? e) });
      }
    });
  }
};
