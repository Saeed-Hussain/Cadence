/**
 * Does running several model instances side by side beat one instance with
 * all the threads? ?workers=K&threads=T. Pieces are handed to whichever
 * worker is free; audio is counted in order.
 */
import { chunks } from '/packages/cadence/src/piper.js';
import { CORPUS } from '../candidates.js';

const q = new URLSearchParams(location.search);
// ?threads=6.3.3: one worker per number, each with that many threads;
// a "g" is a worker on the GPU (WebGPU), e.g. 12.g.
const SPECS = (q.get('threads') ?? '1').split('.');
const SIZES = SPECS.map((x) => (x === 'g' ? 1 : Number(x)));
const K = SIZES.length;
const T = SIZES.join('.');
// ?lead: the first piece goes to the first worker alone, at full speed.
const LEAD = q.has('lead');
// ?first=60: the first piece's length cap, in characters.
const FIRST = Number(q.get('first') ?? 120);
const TEXT = `${CORPUS.long} ${CORPUS.long} ${CORPUS.long}`;

let workers0 = 0;
const workers = await Promise.all(Array.from({ length: K }, () => new Promise((resolve) => {
  const w = new Worker(new URL('./worker.js', import.meta.url), { type: 'module' });
  w.onmessage = ({ data }) => {
    if (data.type === 'ready') resolve(w);
    if (data.type === 'error') { window.__result = { error: data.message }; }
  };
  const spec = SPECS[workers0];
  w.postMessage({ type: 'load', threads: SIZES[workers0++], ort: q.get('ort'), ep: spec === 'g' ? 'webgpu' : (q.get('ep') ?? 'wasm') });
})));

async function run(text) {
  const pieces = chunks(text, { first: FIRST });
  let next = 0, samples = 0, firstMs = 0;
  const ready = [], dur = [];
  const start = performance.now();
  if (LEAD) {
    await new Promise((resolve) => {
      workers[0].onmessage = ({ data }) => { samples += data.samples; firstMs = performance.now() - start; ready[0] = firstMs; dur[0] = data.samples / 22050 * 1000; resolve(); };
      workers[0].postMessage({ type: 'speak', index: 0, text: pieces[0] });
    });
    next = 1;
  }
  await Promise.all(workers.map((w) => new Promise((resolve) => {
    const take = () => {
      if (next >= pieces.length) return resolve();
      const index = next++;
      w.onmessage = ({ data }) => {
        samples += data.samples;
        ready[data.index] = performance.now() - start;
        dur[data.index] = data.samples / 22050 * 1000;
        if (data.index === 0) firstMs = ready[0];
        take();
      };
      w.postMessage({ type: 'speak', index, text: pieces[index] });
    };
    take();
  })));
  const wall = performance.now() - start;
  // Playback starts when piece 0 is ready; each later piece must be ready before the one ahead ends.
  let clock = ready[0], gapMs = 0, gaps = 0;
  for (let i = 0; i < pieces.length; i++) {
    if (ready[i] > clock) { gapMs += ready[i] - clock; gaps++; clock = ready[i]; }
    clock += dur[i];
  }
  return { rtf: wall / 1000 / (samples / 22050), firstMs, gaps, gapMs: Math.round(gapMs) };
}

// ?check: the same sentences on every worker, to compare what each produces.
if (q.has('check')) {
  const SENT = ['Hello, and welcome to Cadence.', 'The lighthouse keeper had not seen a ship in eleven years.', 'Natural AI voices, made on your own device.'];
  const out = [];
  for (const [wi, w] of workers.entries()) {
    for (const s of SENT) {
      const r = await new Promise((resolve) => { w.onmessage = ({ data }) => resolve(data); w.postMessage({ type: 'speak', index: 0, text: s }); });
      out.push(`${SPECS[wi]}: ${(r.samples / 22050).toFixed(2)} s, rms ${r.rms.toFixed(3)}, peak ${r.peak.toFixed(2)}, NaN ${r.nan}`);
    }
  }
  window.__result = { check: out };
  throw new Error('checked');
}
const runs = [];
for (let r = 0; r < 3; r++) runs.push(await run(TEXT));
runs.sort((a, b) => a.rtf - b.rtf);
let memMb = null;
try { const m = await performance.measureUserAgentSpecificMemory(); memMb = Math.round(m.bytes / 1e6); } catch (e) { memMb = String(e).slice(0, 60); }
window.__result = { K, T, isolated: crossOriginIsolated, memMb, ...runs[1] };
