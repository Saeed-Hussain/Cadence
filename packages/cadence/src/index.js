/**
 * Cadence — the engine interface.
 *
 * The boundary the web app is written against, and the one the hand-written
 * kernels will sit behind. Nothing here knows a web framework exists.
 *
 * The backend today is the Kokoro-82M reference weights running in a Web
 * Worker (`worker.js` → `kokoro.js`). The shape of every call — load with
 * progress, synthesise as a stream with timing, preview, clone — is the shape
 * the finished engine keeps.
 */

import { estimatePitch } from './dsp.js';
import { PREVIEW_TEXT, VOICES, matchPitch } from './voices.js';

export { FACETS, ORIGINAL_IDS, PREVIEW_TEXT, VOICES, matchPitch } from './voices.js';
export { encodeWav } from './wav.js';
export { estimatePitch } from './dsp.js';

export const SAMPLE_RATE = 24000;

/** @typedef {import('./voices.js').Voice} Voice */

/**
 * @typedef {object} Settings
 * @property {number} [speed]  0.7–1.2
 */

/**
 * @typedef {object} Synthesis
 * @property {Float32Array} samples
 * @property {number} sampleRate
 * @property {{backend: string, model: string, seconds: number, elapsedMs: number, ttfaMs: number, rtf: number}} stats
 */

/** @typedef {'idle' | 'loading' | 'ready' | 'error'} Status */

export const MODELS = [
  {
    id: 'swift',
    name: 'Cadence Swift',
    backend: 'cpu',
    device: 'wasm',
    dtype: 'q8',
    tagline: 'Fast path · runs on any CPU',
    description: 'Single-pass model, 8-bit weights, WebAssembly SIMD on every core. Works on any machine.',
    sizeMb: 92,
  },
  {
    id: 'swift-gpu',
    name: 'Cadence Swift GPU',
    backend: 'gpu',
    device: 'webgpu',
    dtype: 'fp32',
    tagline: 'Same model · WebGPU',
    description: 'The same model in full precision on the graphics card. Much faster where WebGPU is available.',
    sizeMb: 326,
  },
];

/** Whether this environment exposes WebGPU at all. */
export function hasWebGPU() {
  return typeof navigator !== 'undefined' && 'gpu' in navigator;
}

/** Logical cores available to the thread pool. */
export function cpuThreads() {
  return typeof navigator !== 'undefined' ? navigator.hardwareConcurrency || 4 : 4;
}

/**
 * @param {{model?: string}} [options]
 */
export function createEngine(options = {}) {
  /** @type {Status} */
  let status = 'idle';
  let model = MODELS.find((m) => m.id === options.model) ?? MODELS[0];
  let progress = 0;
  let error = '';
  /** @type {'download' | 'init'} */
  let phase = 'download';
  /** @type {Worker | null} */
  let worker = null;
  /** @type {Promise<void> | null} */
  let loading = null;
  let nextId = 1;
  /** @type {Map<number, {onChunk: (s: Float32Array) => void, resolve: (cancelled: boolean) => void, reject: (e: Error) => void}>} */
  const pending = new Map();
  /** @type {Set<(e: {status: Status, progress: number, phase: 'download' | 'init', model: string, error: string}) => void>} */
  const listeners = new Set();
  /** @type {Map<string, Promise<Float32Array>>} */
  const previews = new Map();

  const emit = () => {
    for (const fn of listeners) fn({ status, progress, phase, model: model.id, error });
  };

  const spawn = () => {
    const w = new Worker(new URL('./worker.js', import.meta.url), { type: 'module' });
    w.onmessage = ({ data }) => {
      if (data.type === 'progress') { progress = Math.max(progress, data.progress); phase = data.phase; emit(); return; }
      const job = pending.get(data.id);
      if (data.type === 'chunk') job?.onChunk(data.samples);
      else if (data.type === 'done') { pending.delete(data.id); job?.resolve(!!data.cancelled); }
      else if (data.type === 'failed') { pending.delete(data.id); job?.reject(new Error(data.message)); }
    };
    return w;
  };

  const engine = {
    get status() { return status; },
    get progress() { return progress; },
    get model() { return model; },
    get error() { return error; },
    backendName: 'kokoro-82m',

    /** @param {(e: {status: Status, progress: number, phase: 'download' | 'init', model: string, error: string}) => void} fn */
    subscribe(fn) {
      listeners.add(fn);
      fn({ status, progress, phase, model: model.id, error });
      return () => { listeners.delete(fn); };
    },

    /** Download (or read from cache) and initialise the weights. */
    load() {
      if (loading) return loading;
      status = 'loading';
      progress = 0;
      phase = 'download';
      error = '';
      emit();
      const gpu = model.device === 'webgpu' && hasWebGPU();
      worker = spawn();
      const w = worker;
      loading = new Promise((resolve, reject) => {
        const onReady = (/** @type {MessageEvent} */ { data }) => {
          if (data.type === 'ready') {
            w.removeEventListener('message', onReady);
            status = 'ready';
            progress = 1;
            emit();
            resolve();
          } else if (data.type === 'error') {
            w.removeEventListener('message', onReady);
            status = 'error';
            error = data.message;
            loading = null;
            emit();
            reject(new Error(data.message));
          }
        };
        w.addEventListener('message', onReady);
      });
      // Diagnostic override for benchmarking weight formats in a real browser.
      let dtype = gpu ? model.dtype : 'q8';
      try { dtype = localStorage.getItem('cadence:dtype') || dtype; } catch { /* default */ }
      w.postMessage({ type: 'load', device: gpu ? 'webgpu' : 'wasm', dtype, expectedMb: dtype === 'fp32' ? 326 : dtype === 'q4' ? 305 : 92 });
      return loading;
    },

    /** @param {string} id */
    async setModel(id) {
      const next = MODELS.find((m) => m.id === id);
      if (!next || next.id === model.id) return;
      for (const job of pending.values()) job.resolve(true);
      pending.clear();
      worker?.terminate();
      worker = null;
      loading = null;
      model = next;
      status = 'idle';
      progress = 0;
      emit();
      await engine.load();
    },

    /**
     * Speak `text`. Audio arrives sentence by sentence through `onChunk`; the
     * promise resolves with the whole utterance.
     *
     * @param {{text: string, voice: Voice, settings?: Settings, onChunk?: (s: Float32Array) => void, signal?: AbortSignal}} request
     * @returns {Promise<Synthesis | null>} null when cancelled
     */
    async synthesize({ text, voice, settings = {}, onChunk, signal }) {
      await engine.load();
      const w = /** @type {Worker} */ (worker);
      const id = nextId++;
      const start = performance.now();
      let ttfaMs = 0;
      /** @type {Float32Array[]} */
      const chunks = [];
      const done = new Promise((resolve, reject) => {
        pending.set(id, {
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
      signal?.addEventListener('abort', abort, { once: true });
      w.postMessage({ type: 'generate', id, text, voice: { lang: voice.lang, mix: voice.mix }, speed: settings.speed ?? 1 });
      const cancelled = await done;
      signal?.removeEventListener('abort', abort);
      if (cancelled) return null;
      const samples = concat(chunks);
      const elapsedMs = performance.now() - start;
      const seconds = samples.length / SAMPLE_RATE;
      return {
        samples,
        sampleRate: SAMPLE_RATE,
        stats: {
          backend: model.device === 'webgpu' && hasWebGPU() ? 'webgpu' : 'wasm-simd',
          model: model.name,
          seconds,
          elapsedMs,
          ttfaMs,
          rtf: seconds ? elapsedMs / 1000 / seconds : 0,
        },
      };
    },

    /**
     * A voice's audition sample, rendered once and kept (in memory, and in
     * the browser cache across visits).
     *
     * @param {Voice} voice
     * @param {AbortSignal} [signal]
     */
    preview(voice, signal) {
      let p = previews.get(voice.id);
      if (!p) {
        p = (async () => {
          const key = `https://cadence.local/preview/v1/${voice.id}`;
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
      return p;
    },

    /** Whether a voice's preview is already rendered and can play instantly. */
    async hasPreview(/** @type {Voice} */ voice) {
      if (previews.has(voice.id)) return true;
      try {
        return !!(await (await caches.open('cadence-previews')).match(`https://cadence.local/preview/v1/${voice.id}`));
      } catch {
        return false;
      }
    },

    /**
     * Until the cloning model exists, a recording is matched — by measured
     * pitch — to the nearest blend of the original voices. Honest about it:
     * the voice's kind is "matched", not "cloned".
     *
     * @param {{name: string, samples: Float32Array, sampleRate: number, description?: string}} input
     * @returns {Voice}
     */
    clone({ name, samples, sampleRate, description }) {
      const pitch = estimatePitch(samples, sampleRate) || 150;
      const { mix, lang, gender } = matchPitch(pitch);
      const hue = Math.floor(Math.random() * 360);
      const recipe = mix.map(([id, w]) => `${Math.round(w * 100)}% ${VOICES.find((v) => v.id === id)?.name}`).join(' · ');
      return {
        id: `m-${Date.now().toString(36)}`,
        name,
        gender,
        accent: lang === 'b' ? 'British' : 'American',
        language: 'English',
        kind: 'matched',
        grade: '—',
        lang,
        mix,
        description: description || `Matched to your recording (${pitch} Hz): ${recipe}.`,
        tags: ['matched'],
        pitch,
        hues: [hue, (hue + 70) % 360, (hue + 190) % 360],
        source: 'cloned',
      };
    },
  };

  return engine;
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
