// One Kokoro-82M instance on the engine's ONNX Runtime, ep wasm or webgpu,
// T threads. (Against transformers.js's pinned 1.22 it measured RTF 0.69–0.77
// to this runtime's 0.66–0.68; that runtime is no longer installed.)
import { kokoroPhonemes, loadLexicon } from '/packages/cadence/src/g2p.js';

const DIST = '/packages/cadence/node_modules/onnxruntime-web/dist/';
const MODEL = '/.cache/models/kokoro/';
let ort, session, back, vocab, table;

self.onmessage = async ({ data }) => {
  try { await handle(data); } catch (e) { self.postMessage({ type: 'error', message: String(e?.message ?? e).slice(0, 300) }); }
};

async function handle(data) {
  if (data.type === 'load') {
    const dist = DIST;
    ort = await import(`${dist}${data.ep === 'webgpu' ? 'ort.webgpu.min.mjs' : 'ort.wasm.min.mjs'}`);
    ort.env.wasm.numThreads = data.threads;
    ort.env.wasm.wasmPaths = dist;
    ort.env.logLevel = 'error';
    const [tok, model, voice] = await Promise.all([
      fetch(`${MODEL}tokenizer.json`).then((r) => r.json()),
      fetch(data.fast ? '/.cache/hdfast/onnx/kokoro-front.onnx' : `${MODEL}${data.file ?? 'model.onnx'}`).then((r) => r.arrayBuffer()),
      fetch(`${MODEL}af_heart.bin`).then((r) => r.arrayBuffer()),
      loadLexicon(),
    ]);
    vocab = tok.model.vocab;
    table = new Float32Array(voice);
    session = await ort.InferenceSession.create(new Uint8Array(model), {
      executionProviders: [data.ep === 'webgpu' ? 'webgpu' : 'wasm'],
      graphOptimizationLevel: 'all',
    });
    // HD-Fast (tools/hdfast): Kokoro's front half, then HD-Fast's back half.
    if (data.fast) {
      const b = await (await fetch('/.cache/hdfast/onnx/hdfast-back.onnx')).arrayBuffer();
      back = await ort.InferenceSession.create(new Uint8Array(b), { executionProviders: ['wasm'], graphOptimizationLevel: 'all' });
    }
    await speak('Ready.');
    self.postMessage({ type: 'ready', inputs: session.inputNames, outputs: session.outputNames });
  } else if (data.type === 'speak') {
    const t0 = performance.now();
    const audio = await speak(data.text);
    const ms = performance.now() - t0;
    let sum = 0, nan = 0, peak = 0;
    for (const x of audio) { if (Number.isNaN(x)) nan++; else { sum += x * x; peak = Math.max(peak, Math.abs(x)); } }
    self.postMessage({ type: 'done', index: data.index, ms, seconds: audio.length / 24000, rms: Math.sqrt(sum / audio.length), nan, peak });
  }
}

async function speak(text) {
  const phonemes = kokoroPhonemes(text, 'a');
  const ids = [0, ...[...phonemes].map((c) => vocab[c]).filter((v) => v !== undefined), 0];
  const row = 256 * Math.min(Math.max(ids.length - 2, 0), 509);
  const style = new ort.Tensor('float32', table.slice(row, row + 256), [1, 256]);
  const out = await session.run({
    input_ids: new ort.Tensor('int64', BigInt64Array.from(ids.map(BigInt)), [1, ids.length]),
    style,
    speed: new ort.Tensor('float32', new Float32Array([1]), [1]),
  });
  if (back) return (await back.run({ asr: out.asr, f0: out.f0, n: out.n, style })).waveform.data;
  return out[session.outputNames[0]].data;
}
