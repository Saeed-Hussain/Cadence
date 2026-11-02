// Speaks the benchmark passage with HD over K workers. ?ep=wasm|webgpu
// &threads=6.6 (one number per worker; "g" for a WebGPU worker, e.g. 8.g)
import { chunks } from '/packages/cadence/src/piper.js';
import { CORPUS } from '/tools/bench/candidates.js';

const q = new URLSearchParams(location.search);
const spec = (q.get('threads') ?? '12').split('.');
const text = Array(Number(q.get('repeat') ?? 1)).fill(CORPUS.long).join(' ');
const pieces = q.get('whole') ? [text] : chunks(text, q.get('first') ? { first: Number(q.get('first')) } : undefined);

const workers = spec.map((t) => {
  const w = new Worker(q.get('engine') ? 'worker-engine.js' : 'worker.js', { type: 'module' });
  w.postMessage({ type: 'load', ep: t === 'g' ? 'webgpu' : (q.get('ep') ?? 'wasm'), threads: t === 'g' ? 1 : Number(t), file: q.get('file') ?? undefined });
  return w;
});
const ready = await Promise.all(workers.map((w) => new Promise((ok, no) => {
  w.onmessage = ({ data }) => (data.type === 'ready' ? ok(data) : no(new Error(data.message)));
}))).catch((e) => ({ error: e.message }));
if (ready.error) { window.__result = { error: ready.error }; throw new Error(ready.error); }

const t0 = performance.now();
let next = 0, firstMs = 0, audio = 0, nan = 0, rms = 0, peak = 0;
const per = workers.map(() => ({ pieces: 0, ms: 0 }));
await Promise.all(workers.map((w, i) => (async () => {
  // The first piece runs alone on the first worker, as the engine does.
  if (i > 0) while (!firstMs) await new Promise((ok) => setTimeout(ok, 5));
  while (next < pieces.length) {
    const index = next++;
    const r = await new Promise((ok, no) => {
      w.onmessage = ({ data }) => (data.type === 'done' ? ok(data) : no(new Error(data.message)));
      w.postMessage({ type: 'speak', index, text: pieces[index] });
    });
    if (index === 0) firstMs = performance.now() - t0;
    audio += r.seconds; nan += r.nan; rms = Math.max(rms, r.rms); peak = Math.max(peak, r.peak);
    per[i].pieces++; per[i].ms += r.ms;
  }
})()));
const wall = (performance.now() - t0) / 1000;
window.__result = { rtf: wall / audio, wall, audio, firstMs, nan, rms, peak, pieces: pieces.length, per };
