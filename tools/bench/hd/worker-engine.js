// The engine's own HD code (kokoro.js) in a bare page, to separate the model's
// speed from the app's: the same protocol as worker.js.
import { loadKokoro } from '/packages/cadence/src/kokoro.js';

const DIST = '/packages/cadence/node_modules/onnxruntime-web/dist/';
let kokoro;
self.onmessage = async ({ data }) => {
  try {
    if (data.type === 'load') {
      const ort = await import(`${DIST}ort.wasm.min.mjs`);
      ort.env.wasm.numThreads = data.threads;
      ort.env.wasm.wasmPaths = DIST;
      ort.env.logLevel = 'error';
      const model = new Uint8Array(await (await fetch('/.cache/models/kokoro/model.onnx')).arrayBuffer());
      kokoro = await loadKokoro({ ort, model });
      self.postMessage({ type: 'ready' });
    } else if (data.type === 'speak') {
      const t0 = performance.now();
      let n = 0;
      await kokoro.generate(data.text, { lang: 'a', mix: [['af_heart', 1]] }, 1, (s) => { n += s.length; });
      self.postMessage({ type: 'done', index: data.index, ms: performance.now() - t0, seconds: n / 24000, rms: 0, nan: 0, peak: 0 });
    }
  } catch (e) { self.postMessage({ type: 'error', message: String(e?.message ?? e).slice(0, 300) }); }
};
