/**
 * Cadence — the engine interface.
 *
 * The boundary the web app is written against, and the one the hand-written
 * kernels will sit behind. Nothing here knows a web framework exists.
 *
 * Two models, chosen by M0 (docs/BENCHMARKS.md):
 *   Swift — Piper LibriTTS-R, the default. Faster than real time on the
 *           slowest target machine, 904 speakers in one model.
 *   HD    — Kokoro-82M, the opt-in higher-quality path.
 *
 * Each runs in its own Web Worker and loads only when first needed. A voice
 * belongs to one model; synthesising with a voice uses that voice's model.
 */

import { estimatePitch } from './dsp.js';
import { isCached } from './download.js';
import { chunks as planPieces } from './piper.js';
import { PREVIEW_TEXT, VOICES, matchPitch } from './voices.js';
import { SWIFT_FILES } from './weights.js';

export { FACETS, PREVIEW_TEXT, VOICES, matchPitch } from './voices.js';
export { encodeWav } from './wav.js';
export { estimatePitch } from './dsp.js';
export { chunks } from './piper.js';

/** @typedef {import('./voices.js').Voice} Voice */
/** @typedef {'swift' | 'hd'} ModelId */
/** @typedef {'idle' | 'loading' | 'ready' | 'error'} Status */
/** @typedef {'off' | 'loading' | 'active' | 'unavailable' | 'failed'} GpuState */
/** @typedef {{status: Status, progress: number, phase: 'download' | 'cache' | 'init', error: string, gpu?: GpuState}} ModelState */

/**
 * @typedef {object} Synthesis
 * @property {Float32Array} samples
 * @property {number} sampleRate
 * @property {{backend: string, model: string, seconds: number, elapsedMs: number, ttfaMs: number, rtf: number}} stats
 */

export const MODELS = /** @type {const} */ ([
  {
    id: 'swift',
    name: 'Cadence Swift',
    tagline: 'Fast · any CPU · 904 voices',
    description: 'Piper LibriTTS-R, a single-pass VITS model. Faster than real time on a 2014 laptop CPU.',
    weights: 'Piper LibriTTS-R medium · 79 MB',
    sampleRate: 22050,
  },
  {
    id: 'hd',
    name: 'Cadence HD',
    tagline: 'Highest quality · needs a fast CPU',
    description: 'Kokoro-82M in full precision. The most natural voices, slower than real time on older machines.',
    weights: 'Kokoro-82M fp32 · 326 MB',
    sampleRate: 24000,
  },
]);

/** @param {ModelId} id */
const spawn = (id) =>
  id === 'swift'
    ? new Worker(new URL('./worker-swift.js', import.meta.url), { type: 'module' })
    : new Worker(new URL('./worker-hd.js', import.meta.url), { type: 'module' });

/** Logical cores, for display. */
export function cpuThreads() {
  return typeof navigator !== 'undefined' ? navigator.hardwareConcurrency || 4 : 4;
}

/**
 * WebAssembly threads, for both models, by measurement of Swift:
 *   i5-4310U, 2 cores / 4 threads: 1 thread fastest (RTF 0.448; more were slower).
 *   Ryzen 5 7430U, 6 cores / 12 threads, three alternating rounds
 *   (tools/bench/pool): 12 threads RTF 0.105, 6 threads 0.118, 1 thread 0.27.
 * So one thread below eight logical cores, otherwise all of them, capped at
 * sixteen. This is HD's count, and Swift's when it has no pool (`swiftPool`).
 * Threads need cross-origin isolation; without it there is only one.
 */
export function swiftThreads() {
  if (typeof globalThis.crossOriginIsolated !== 'undefined' && !globalThis.crossOriginIsolated) return 1;
  const logical = cpuThreads();
  return logical >= 8 ? Math.min(16, logical) : 1;
}

/**
 * Swift's CPU pool: one main worker that speaks the first piece alone, so
 * first audio stays quick, and helper workers that each speak a different
 * piece after it. The runtime's threads scale poorly inside one inference, so
 * several small workers do more than one big one. Measured on a Ryzen 5
 * 7430U, 6 cores / 12 threads, a 100-sentence paragraph (1,575 words, 7.3
 * minutes of audio), three runs each:
 *   one worker, 12 threads            41–44 s
 *   6 threads + five helpers of 2     34–37 s
 *   4 threads + four helpers of 2     29–32 s, first audio ~320 ms
 *   six workers of 2                  30–38 s, first audio ~470 ms
 * So: four main threads and helpers of two over the rest of the cores, at
 * most four helpers (about 230 MB each), fewer on a small-memory device. None
 * below eight logical cores, where it has not been measured.
 *
 * @returns {{threads: number, helpers: number, helperThreads: number}}
 */
export function swiftPool() {
  const threads = swiftThreads();
  if (threads < 8) return { threads, helpers: 0, helperThreads: 0 };
  const memory = typeof navigator !== 'undefined' ? /** @type {any} */ (navigator).deviceMemory : undefined;
  const byMemory = memory === undefined || memory >= 8 ? 4 : memory >= 4 ? 1 : 0;
  return { threads: 4, helpers: Math.min(byMemory, Math.floor((threads - 4) / 2)), helperThreads: 2 };
}

/** Whether this environment exposes WebGPU at all. */
export function hasWebGPU() {
  return typeof navigator !== 'undefined' && 'gpu' in navigator;
}

/**
 * Whether Swift should get a GPU helper: a second worker on WebGPU that
 * speaks pieces while the CPU worker speaks others. Measured on a Ryzen 5
 * 7430U with Radeon graphics (tools/bench/pool, three alternating pairs):
 * CPU alone RTF 0.092–0.110; CPU with 10 threads plus the GPU 0.075–0.077,
 * first audio unchanged, 431 MB against 236. So: only with cores and memory to
 * spare, and only where the browser offers a hardware GPU (checked again when
 * the helper starts).
 */
export function swiftGpuPlanned() {
  if (typeof navigator === 'undefined' || !hasWebGPU()) return false;
  if (typeof globalThis.crossOriginIsolated !== 'undefined' && !globalThis.crossOriginIsolated) return false;
  const memory = /** @type {any} */ (navigator).deviceMemory;
  return cpuThreads() >= 8 && (memory === undefined || memory >= 8);
}

/**
 * @param {{wasmPaths?: string, hdWasmPaths?: string, modelPaths?: string | null, threads?: number, pool?: boolean | (() => boolean), gpu?: boolean | (() => boolean)}} [options]
 *   wasmPaths: where the app serves Swift's WebAssembly runtime (see
 *   apps/web/scripts/copy-runtime.js); hdWasmPaths: the version HD's
 *   transformers.js pins. modelPaths: where it serves the Swift weights,
 *   tried before the internet (apps/web/scripts/fetch-model.js); null to
 *   always use the internet. threads: WebAssembly threads of the main
 *   worker; by default chosen from the hardware (`swiftPool`,
 *   `swiftThreads`). pool: false to speak Swift on one worker only; by
 *   default helpers are used where `swiftPool` allows. gpu: false to never
 *   use the GPU helper; by default it is used where `swiftGpuPlanned`
 *   allows. A function is asked when Swift first loads, not when the engine
 *   is made.
 */
export function createEngine({ wasmPaths = '/ort/', hdWasmPaths = '/ort-hd/', modelPaths = '/models/', threads, pool = true, gpu = true } = {}) {
  // Decided when Swift first loads. With a GPU helper planned, the CPU worker
  // leaves two threads for it to drive the GPU with.
  let gpuPlanned = false;
  let cpuWorkerThreads = threads ?? swiftThreads();
  let helpersPlanned = 0;
  let helperThreads = 0;
  let planned = false;
  const plan = () => {
    if (planned) return;
    planned = true;
    const p = (typeof pool === 'function' ? pool() : pool) ? swiftPool() : null;
    helpersPlanned = p?.helpers ?? 0;
    helperThreads = p?.helperThreads ?? 0;
    gpuPlanned = (typeof gpu === 'function' ? gpu() : gpu) && swiftGpuPlanned();
    const main = threads ?? (helpersPlanned ? /** @type {NonNullable<typeof p>} */ (p).threads : swiftThreads());
    cpuWorkerThreads = gpuPlanned && !helpersPlanned ? Math.max(1, main - 2) : main;
  };
  /** @type {{worker: Worker | null}} */
  const helper = { worker: null };
  /** Swift's CPU helpers that have loaded (see `swiftPool`). @type {Worker[]} */
  const cpuHelpers = [];
  let helpersStarted = false;
  // Swift requests in flight, and when the last one ended: the helpers load
  // only into quiet, never beside speech they would slow down.
  let speaking = 0;
  let quietSince = 0;
  /** @type {Map<string, {worker: Worker, resolve: (s: Float32Array) => void, reject: (message: string) => void}>} */
  const pieceJobs = new Map();
  /**
   * @typedef {object} Runtime
   * @property {ModelState} state
   * @property {Worker | null} worker
   * @property {Promise<void> | null} loading
   */
  /** @type {Record<ModelId, Runtime>} */
  const runtimes = {
    swift: { state: { status: 'idle', progress: 0, phase: 'download', error: '' }, worker: null, loading: null },
    hd: { state: { status: 'idle', progress: 0, phase: 'download', error: '' }, worker: null, loading: null },
  };
  let nextId = 1;
  /** @type {Map<number, {worker: Worker, onChunk: (s: Float32Array) => void, resolve: (cancelled: boolean) => void, reject: (e: Error) => void}>} */
  const pending = new Map();
  /** @type {Set<(states: Record<ModelId, ModelState>) => void>} */
  const listeners = new Set();
  /** @type {Map<string, Promise<Float32Array>>} */
  const previews = new Map();

  const snapshot = () => ({ swift: { ...runtimes.swift.state }, hd: { ...runtimes.hd.state } });
  const emit = () => {
    const s = snapshot();
    for (const fn of listeners) fn(s);
  };

  /** @param {ModelId} id @param {Partial<ModelState>} patch */
  const update = (id, patch) => {
    runtimes[id].state = { ...runtimes[id].state, ...patch };
    emit();
  };

  const engine = {
    models: MODELS,

    /** @param {(states: Record<ModelId, ModelState>) => void} fn */
    subscribe(fn) {
      listeners.add(fn);
      fn(snapshot());
      return () => { listeners.delete(fn); };
    },

    /** @param {ModelId} id */
    state(id) {
      return runtimes[id].state;
    },

    /**
     * Download (or read from cache) and initialise one model.
     * @param {ModelId} [id]
     */
    load(id = 'swift') {
      const rt = runtimes[id];
      if (rt.loading) return rt.loading;
      if (id === 'swift') plan();
      update(id, { status: 'loading', progress: 0, phase: 'download', error: '' });
      const w = spawn(id);
      rt.worker = w;
      // A worker that dies (out of memory, a WebAssembly abort) takes its jobs
      // with it. Fail them, and leave the model loadable again.
      const crashed = (/** @type {string} */ message) => {
        if (rt.worker !== w) return;
        w.terminate();
        rt.worker = null;
        rt.loading = null;
        for (const [jobId, job] of pending) {
          if (job.worker === w) { pending.delete(jobId); job.reject(new Error(message)); }
        }
        for (const [key, job] of pieceJobs) {
          if (job.worker === w) { pieceJobs.delete(key); job.reject(message); }
        }
        update(id, { status: 'error', error: message });
        failLoad?.(new Error(message));
      };
      /** @type {((e: Error) => void) | null} */
      let failLoad = null;
      w.addEventListener('error', (e) => { e.preventDefault?.(); crashed(`The ${id === 'swift' ? 'Swift' : 'HD'} engine stopped: ${e.message || 'worker error'}`); });
      w.addEventListener('messageerror', () => crashed('The engine sent a message the page could not read'));
      w.addEventListener('message', ({ data }) => {
        if (data.type === 'progress') {
          update(id, { progress: Math.max(rt.state.progress, data.progress), phase: data.phase });
          return;
        }
        if (data.type === 'piece' || data.type === 'piece-failed') {
          const key = `${data.id}:${data.index}`;
          const pj = pieceJobs.get(key);
          pieceJobs.delete(key);
          if (data.type === 'piece') pj?.resolve(data.samples);
          else pj?.reject(data.message);
          return;
        }
        const job = pending.get(data.id);
        if (data.type === 'chunk') job?.onChunk(data.samples);
        else if (data.type === 'done') { pending.delete(data.id); job?.resolve(!!data.cancelled); }
        else if (data.type === 'failed') { pending.delete(data.id); job?.reject(new Error(data.message)); }
      });
      rt.loading = new Promise((resolve, reject) => {
        failLoad = (e) => { failLoad = null; reject(e); };
        const onReady = (/** @type {MessageEvent} */ { data }) => {
          if (data.type === 'ready') {
            w.removeEventListener('message', onReady);
            failLoad = null;
            update(id, { status: 'ready', progress: 1 });
            resolve();
            if (id === 'swift') whenQuiet(() => { startCpuHelpers(); startGpuHelper(); });
          } else if (data.type === 'error') {
            w.removeEventListener('message', onReady);
            failLoad = null;
            w.terminate();
            rt.worker = null;
            rt.loading = null;
            update(id, { status: 'error', error: data.message });
            reject(new Error(data.message));
          }
        };
        w.addEventListener('message', onReady);
      });
      w.postMessage({
        type: 'load',
        wasmPaths: new URL(id === 'swift' ? wasmPaths : hdWasmPaths, location.href).href,
        modelPaths: modelPaths ? new URL(modelPaths, location.href).href : null,
        threads: id === 'swift' ? cpuWorkerThreads : threads ?? swiftThreads(),
      });
      return rt.loading;
    },

    /**
     * Whether a model's weights are stored on this device, so it loads with
     * the network off. Only the Swift files are tracked; HD's are kept by
     * its own runtime, and report false until it has loaded once this visit.
     *
     * @param {ModelId} id
     */
    async onDevice(id) {
      if (id === 'hd') return runtimes.hd.state.status === 'ready';
      const hits = await Promise.all(SWIFT_FILES.map(isCached));
      return hits.every(Boolean);
    },

    /**
     * Speak `text` in `voice`. Audio arrives sentence by sentence through
     * `onChunk`; the promise resolves with the whole utterance, or null when
     * cancelled.
     *
     * @param {{text: string, voice?: string | Voice, settings?: {speed?: number}, onChunk?: (s: Float32Array) => void, signal?: AbortSignal}} request
     *   voice: a Voice, or its id or name; the default voice when omitted
     * @returns {Promise<Synthesis | null>}
     */
    async synthesize({ text, voice: wanted = DEFAULT_VOICE_ID, settings = {}, onChunk, signal }) {
      const voice = resolveVoice(wanted);
      const model = MODELS.find((m) => m.id === voice.model) ?? MODELS[0];
      await engine.load(model.id);
      if (model.id === 'swift') return speakSwift(text, voice, settings.speed ?? 1, onChunk, signal);
      const w = /** @type {Worker} */ (runtimes[model.id].worker);
      const id = nextId++;
      const start = performance.now();
      let ttfaMs = 0;
      /** @type {Float32Array[]} */
      const chunks = [];
      const done = new Promise((resolve, reject) => {
        pending.set(id, {
          worker: w,
          onChunk: (s) => {
            if (!ttfaMs) ttfaMs = performance.now() - start;
            chunks.push(s);
            onChunk?.(s);
          },
          resolve,
          reject,
        });
      });
      const abort = () => w.postMessage({ type: 'cancel', id });
      if (signal?.aborted) abort();
      signal?.addEventListener('abort', abort, { once: true });
      w.postMessage({
        type: 'generate',
        id,
        text,
        voice: model.id === 'swift' ? { speaker: voice.speaker } : { lang: voice.lang, mix: voice.mix },
        speed: settings.speed ?? 1,
      });
      const cancelled = await done;
      signal?.removeEventListener('abort', abort);
      if (cancelled) return null;
      const samples = concat(chunks);
      const elapsedMs = performance.now() - start;
      const seconds = samples.length / model.sampleRate;
      return {
        samples,
        sampleRate: model.sampleRate,
        stats: { backend: `wasm-simd · ${threads ?? swiftThreads()} thread${(threads ?? swiftThreads()) === 1 ? '' : 's'}`, model: model.name, seconds, elapsedMs, ttfaMs, rtf: seconds ? elapsedMs / 1000 / seconds : 0 },
      };
    },

    /**
     * A voice's audition sample, rendered once and kept — in memory, and in
     * the browser cache across visits.
     *
     * @param {Voice} voice
     * @param {AbortSignal} [signal]
     * @returns {Promise<{samples: Float32Array, sampleRate: number}>}
     */
    async preview(voice, signal) {
      const sampleRate = (MODELS.find((m) => m.id === voice.model) ?? MODELS[0]).sampleRate;
      let p = previews.get(voice.id);
      if (!p) {
        p = (async () => {
          const key = previewKey(voice);
          /** @type {Cache | undefined} */
          let cache;
          try {
            cache = await caches.open('cadence-previews');
            const hit = await cache.match(key);
            if (hit) return new Float32Array(await hit.arrayBuffer());
          } catch { /* no cache */ }
          const r = await engine.synthesize({ text: PREVIEW_TEXT, voice, signal });
          if (!r) throw new DOMException('cancelled', 'AbortError');
          try { await cache?.put(key, new Response(r.samples.slice().buffer)); } catch { /* not kept */ }
          return r.samples;
        })();
        previews.set(voice.id, p);
        p.catch(() => previews.delete(voice.id));
      }
      return { samples: await p, sampleRate };
    },

    /** Whether a voice's preview is already rendered and can play instantly. */
    async hasPreview(/** @type {Voice} */ voice) {
      if (previews.has(voice.id)) return true;
      try {
        return !!(await (await caches.open('cadence-previews')).match(previewKey(voice)));
      } catch {
        return false;
      }
    },

    /**
     * Until the cloning model exists, a recording is matched by measured
     * pitch to the nearest library speaker, and labelled as matched.
     *
     * @param {{name: string, samples: Float32Array, sampleRate: number, description?: string}} input
     * @returns {Voice}
     */
    clone({ name, samples, sampleRate, description }) {
      const pitch = estimatePitch(samples, sampleRate) || 150;
      const nearest = matchPitch(pitch);
      return {
        ...nearest,
        id: `m-${Date.now().toString(36)}`,
        name,
        kind: 'matched',
        description: description || `Matched to your recording (${pitch} Hz): closest library voice is ${nearest.name}.`,
        tags: ['matched'],
        source: 'cloned',
      };
    },
  };

  /** Run `fn` once Swift has been idle for two seconds. */
  function whenQuiet(/** @type {() => void} */ fn) {
    if (!gpuPlanned && !helpersPlanned) return;
    quietSince = quietSince || performance.now();
    const check = () => {
      if (!speaking && performance.now() - quietSince >= 2000) fn();
      else setTimeout(check, 500);
    };
    setTimeout(check, 500);
  }

  /**
   * Swift's CPU helpers: loaded in the background once the main worker is
   * ready, with progress kept quiet. One that fails, at load or later, is
   * retired and its piece goes back to the queue; the rest carry on.
   */
  function startCpuHelpers() {
    if (helpersStarted || !helpersPlanned) return;
    helpersStarted = true;
    for (let i = 0; i < helpersPlanned; i++) {
      const w = spawn('swift');
      const retire = (/** @type {string} */ why) => {
        const at = cpuHelpers.indexOf(w);
        if (at >= 0) cpuHelpers.splice(at, 1);
        w.terminate();
        for (const [key, job] of pieceJobs) if (job.worker === w) { pieceJobs.delete(key); job.reject(why); }
      };
      w.addEventListener('error', (e) => { e.preventDefault?.(); retire(e.message || 'helper worker error'); });
      w.addEventListener('message', ({ data }) => {
        if (data.type === 'ready') { cpuHelpers.push(w); return; }
        if (data.type === 'error') { retire(data.message); return; }
        if (data.type === 'piece' || data.type === 'piece-failed') {
          const key = `${data.id}:${data.index}`;
          const job = pieceJobs.get(key);
          pieceJobs.delete(key);
          if (data.type === 'piece') job?.resolve(data.samples);
          else { job?.reject(data.message); retire(data.message); }
        }
      });
      w.postMessage({
        type: 'load',
        ep: 'wasm',
        quiet: true,
        wasmPaths: new URL(wasmPaths, location.href).href,
        modelPaths: modelPaths ? new URL(modelPaths, location.href).href : null,
        threads: helperThreads,
      });
    }
  }

  /**
   * Swift's GPU helper: started once the CPU worker is ready, in the
   * background, and only on a hardware GPU. Any failure, at load or later,
   * retires it; the CPU worker carries on alone.
   */
  async function startGpuHelper() {
    if (!gpuPlanned || helper.worker || (runtimes.swift.state.gpu && runtimes.swift.state.gpu !== 'off')) return;
    update('swift', { gpu: 'loading' });
    try {
      const adapter = await /** @type {any} */ (navigator).gpu.requestAdapter({ powerPreference: 'high-performance' });
      if (!adapter || adapter.isFallbackAdapter) throw new Error('no hardware GPU');
    } catch {
      update('swift', { gpu: 'unavailable' });
      return;
    }
    const w = spawn('swift');
    const retire = (/** @type {string} */ why) => {
      if (helper.worker === w) helper.worker = null;
      w.terminate();
      for (const [key, job] of pieceJobs) if (job.worker === w) { pieceJobs.delete(key); job.reject(why); }
      update('swift', { gpu: 'failed' });
    };
    w.addEventListener('error', (e) => { e.preventDefault?.(); retire(e.message || 'GPU worker error'); });
    w.addEventListener('message', ({ data }) => {
      if (data.type === 'ready') { helper.worker = w; update('swift', { gpu: 'active' }); return; }
      if (data.type === 'error') { retire(data.message); return; }
      if (data.type === 'piece' || data.type === 'piece-failed') {
        const key = `${data.id}:${data.index}`;
        const job = pieceJobs.get(key);
        pieceJobs.delete(key);
        if (data.type === 'piece') job?.resolve(data.samples);
        else { job?.reject(data.message); retire(data.message); }
      }
    });
    w.postMessage({
      type: 'load',
      ep: 'webgpu',
      wasmPaths: new URL(wasmPaths, location.href).href,
      modelPaths: modelPaths ? new URL(modelPaths, location.href).href : null,
      threads: 1,
    });
  }

  /**
   * Swift, piece by piece over every worker it has. The first piece goes to
   * the main worker alone, so first audio is as quick as it can be; after it,
   * each free worker takes the next piece. Audio is handed on strictly in
   * order. A piece a helper drops goes back in the queue.
   *
   * @param {string} text @param {Voice} voice @param {number} speed
   * @param {((s: Float32Array) => void) | undefined} onChunk @param {AbortSignal | undefined} signal
   * @returns {Promise<Synthesis | null>}
   */
  function speakSwift(text, voice, speed, onChunk, signal) {
    const model = MODELS[0];
    const cpu = /** @type {Worker} */ (runtimes.swift.worker);
    const pieces = planPieces(text);
    const id = nextId++;
    const start = performance.now();
    /** @type {(Float32Array | undefined)[]} */
    const results = new Array(pieces.length);
    /** @type {number[]} */
    const retry = [];
    const busy = new Set();
    let next = 0;
    let emitted = 0;
    let ttfaMs = 0;
    let usedGpu = false;
    const usedHelpers = new Set();
    let over = false;

    speaking++;
    return new Promise((resolve, reject) => {
      const finish = (/** @type {Synthesis | null} */ r, /** @type {Error} */ [e] = []) => {
        if (over) return;
        over = true;
        speaking--;
        quietSince = performance.now();
        signal?.removeEventListener('abort', abort);
        if (e) reject(e); else resolve(r);
      };
      const abort = () => finish(null);
      if (signal?.aborted) return finish(null);
      signal?.addEventListener('abort', abort, { once: true });
      if (!pieces.length) return finish({ samples: new Float32Array(0), sampleRate: model.sampleRate, stats: { backend: 'wasm-simd', model: model.name, seconds: 0, elapsedMs: 0, ttfaMs: 0, rtf: 0 } });

      const flush = () => {
        while (emitted < pieces.length && results[emitted]) {
          const s = /** @type {Float32Array} */ (results[emitted++]);
          if (!ttfaMs) ttfaMs = performance.now() - start;
          onChunk?.(s);
        }
        if (emitted === pieces.length) {
          const samples = concat(/** @type {Float32Array[]} */ (results));
          const elapsedMs = performance.now() - start;
          const seconds = samples.length / model.sampleRate;
          const backend = `wasm-simd · ${cpuWorkerThreads} thread${cpuWorkerThreads === 1 ? '' : 's'}${usedHelpers.size ? ` + ${usedHelpers.size} × ${helperThreads}` : ''}${usedGpu ? ' + WebGPU' : ''}`;
          finish({ samples, sampleRate: model.sampleRate, stats: { backend, model: model.name, seconds, elapsedMs, ttfaMs, rtf: seconds ? elapsedMs / 1000 / seconds : 0 } });
        }
      };

      const send = (/** @type {Worker} */ w, /** @type {number} */ index) => {
        busy.add(w);
        if (w === helper.worker) usedGpu = true;
        else if (w !== cpu) usedHelpers.add(w);
        pieceJobs.set(`${id}:${index}`, {
          worker: w,
          resolve: (s) => { busy.delete(w); if (over) return; results[index] = s; flush(); dispatch(); },
          reject: (message) => {
            busy.delete(w);
            if (over) return;
            if (w === cpu) finish(null, [new Error(message)]);
            else { retry.unshift(index); dispatch(); }
          },
        });
        w.postMessage({ type: 'piece', id, index, text: pieces[index], speaker: voice.speaker, speed });
      };

      function dispatch() {
        if (over) return;
        for (const w of [cpu, ...cpuHelpers, helper.worker]) {
          if (!w || busy.has(w)) continue;
          // Nothing runs beside the first piece: it is the one being waited for.
          if (!results[0] && (next > 0 || w !== cpu) && !retry.includes(0)) return;
          // Helpers are slower per piece than the main worker: they take work
          // only while enough remains, so the main worker finishes the tail.
          if (w !== cpu && pieces.length - next < (w === helper.worker ? 3 : 2) && !retry.length) continue;
          const index = retry.length ? /** @type {number} */ (retry.shift()) : next < pieces.length ? next++ : -1;
          if (index < 0) return;
          send(w, index);
        }
      }
      dispatch();
    });
  }

  return engine;
}

/** @param {string | Voice} voice @returns {Voice} */
function resolveVoice(voice) {
  if (typeof voice !== 'string') return voice;
  const v = VOICES.find((x) => x.id === voice || x.name === voice);
  if (!v) throw new Error(`Unknown voice "${voice}". See VOICES for the list.`);
  return v;
}

/** Previews are keyed by what the voice is, so a changed voice gets a new one. */
function previewKey(/** @type {Voice} */ voice) {
  const what = voice.model === 'swift' ? `swift-${voice.speaker}` : `hd-${voice.mix.map(([n, w]) => `${n}${w}`).join('-')}`;
  return `https://cadence.local/preview/v2/${what}`;
}

/** @param {Float32Array[]} chunks */
function concat(chunks) {
  const out = new Float32Array(chunks.reduce((s, c) => s + c.length, 0));
  let o = 0;
  for (const c of chunks) {
    out.set(c, o);
    o += c.length;
  }
  return out;
}

export const DEFAULT_VOICE_ID = VOICES[0].id;
