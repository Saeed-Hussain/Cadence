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
import { PREVIEW_TEXT, VOICES, matchPitch } from './voices.js';
import { SWIFT_FILES } from './weights.js';

export { FACETS, PREVIEW_TEXT, VOICES, matchPitch } from './voices.js';
export { encodeWav } from './wav.js';
export { estimatePitch } from './dsp.js';
export { chunks } from './piper.js';

/** @typedef {import('./voices.js').Voice} Voice */
/** @typedef {'swift' | 'hd'} ModelId */
/** @typedef {'idle' | 'loading' | 'ready' | 'error'} Status */
/** @typedef {{status: Status, progress: number, phase: 'download' | 'cache' | 'init', error: string}} ModelState */

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
 *   Ryzen 5 7430U, 6 cores / 12 threads: 6 threads RTF 0.105, 12 threads 0.127, 1 thread 0.225.
 * So one thread below eight logical cores, otherwise half of them (the
 * physical cores, roughly), capped at eight. Threads need cross-origin
 * isolation; without it there is only one.
 */
export function swiftThreads() {
  if (typeof globalThis.crossOriginIsolated !== 'undefined' && !globalThis.crossOriginIsolated) return 1;
  const logical = cpuThreads();
  return logical >= 8 ? Math.min(8, Math.floor(logical / 2)) : 1;
}

/** Whether this environment exposes WebGPU at all. */
export function hasWebGPU() {
  return typeof navigator !== 'undefined' && 'gpu' in navigator;
}

/**
 * @param {{wasmPaths?: string, modelPaths?: string | null, threads?: number}} [options]
 *   wasmPaths: where the app serves the WebAssembly runtime files (see
 *   apps/web/scripts/copy-runtime.js). modelPaths: where it serves the Swift
 *   weights, tried before the internet (apps/web/scripts/fetch-model.js);
 *   null to always use the internet. threads: WebAssembly threads for both models;
 *   by default chosen from the hardware (`swiftThreads`).
 */
export function createEngine({ wasmPaths = '/ort/', modelPaths = '/models/', threads = swiftThreads() } = {}) {
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
        wasmPaths: new URL(wasmPaths, location.href).href,
        modelPaths: modelPaths ? new URL(modelPaths, location.href).href : null,
        threads,
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
        stats: { backend: `wasm-simd · ${threads} thread${threads === 1 ? '' : 's'}`, model: model.name, seconds, elapsedMs, ttfaMs, rtf: seconds ? elapsedMs / 1000 / seconds : 0 },
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
