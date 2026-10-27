// One model instance with T threads; answers piece requests by index.
// ?ort=130 loads onnxruntime-web 1.30 from .cache/ort130; ?ep=webgpu runs on the GPU.
let ort;
import { loadPiper } from '/packages/cadence/src/piper.js';

let piper;
self.onmessage = async ({ data }) => {
  try { await handle(data); } catch (e) { self.postMessage({ type: 'error', message: String(e?.message ?? e).slice(0, 300) }); }
};
async function handle(data) {
  if (data.type === 'load') {
    const dist = data.ort === '130' ? '/.cache/ort130/node_modules/onnxruntime-web/dist/' : '/node_modules/onnxruntime-web/dist/';
    ort = await import(`${dist}${data.ep === 'webgpu' ? 'ort.webgpu.min.mjs' : 'ort.wasm.min.mjs'}`);
    ort.env.wasm.numThreads = data.threads;
    ort.env.wasm.wasmPaths = dist;
    const [config, model] = await Promise.all([
      fetch('/.cache/models/en_US-libritts_r-medium.onnx.json').then((r) => r.json()),
      fetch('/.cache/models/en_US-libritts_r-medium.onnx').then((r) => r.arrayBuffer()),
    ]);
    piper = await loadPiper({ ort, model: new Uint8Array(model), config, sessionOptions: { executionProviders: data.ep === 'webgpu' ? ['webgpu'] : ['wasm'], graphOptimizationLevel: 'all' } });
    await piper.speak('Warming up.');
    self.postMessage({ type: 'ready' });
  } else if (data.type === 'speak') {
    const audio = await piper.speak(data.text);
    let sum = 0, nan = 0, peak = 0;
    for (const x of audio) { if (Number.isNaN(x)) nan++; else { sum += x * x; peak = Math.max(peak, Math.abs(x)); } }
    self.postMessage({ type: 'done', index: data.index, samples: audio.length, rms: Math.sqrt(sum / audio.length), nan, peak });
  }
}
