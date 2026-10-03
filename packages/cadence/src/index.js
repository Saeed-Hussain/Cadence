/**
 * Cadence — the engine interface.
 *
 * This is the boundary the web app is written against, and the one the real
 * kernels will sit behind. Nothing here knows a web framework exists; it runs
 * in Node, in a browser tab and in Electron alike.
 *
 * Today the backend is the stub in `stub.js`. The shape of every call — load
 * with progress, synthesise with timing, preview before load, clone from audio
 * — is the shape the real engine keeps.
 */

import { SAMPLE_RATE, estimatePitch, render } from './stub.js';
import { PREVIEW_TEXT, VOICES } from './voices.js';

export { FACETS, PREVIEW_TEXT, VOICES } from './voices.js';
export { encodeWav } from './wav.js';
export { SAMPLE_RATE };

/** @typedef {import('./voices.js').Voice} Voice */

/**
 * @typedef {object} Settings
 * @property {number} [speed]      0.7–1.2
 * @property {number} [stability]  0–1
 * @property {number} [similarity] 0–1
 * @property {number} [style]      0–1
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
    tagline: 'Fast path · runs on any CPU',
    description: 'Small, single-pass model. Faster than real time with no GPU. Every built-in voice.',
    sizeMb: 38,
  },
  {
    id: 'clone',
    name: 'Cadence Clone',
    backend: 'gpu',
    tagline: 'Cloning path · WebGPU',
    description: 'Larger, cloning-capable model. Any voice from ~10 seconds of audio. Slower, still local.',
    sizeMb: 212,
  },
];

/** Whether this environment exposes WebGPU at all. */
export function hasWebGPU() {
  return typeof navigator !== 'undefined' && 'gpu' in navigator;
}

/** Logical cores available to the SIMD thread pool. */
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
  /** @type {Promise<void> | null} */
  let loading = null;
  /** @type {Set<(e: {status: Status, progress: number, model: string}) => void>} */
  const listeners = new Set();
  let progress = 0;

  const emit = () => {
    for (const fn of listeners) fn({ status, progress, model: model.id });
  };

  const engine = {
    get status() { return status; },
    get progress() { return progress; },
    get model() { return model; },
    backendName: 'stub',

    /** @param {(e: {status: Status, progress: number, model: string}) => void} fn */
    subscribe(fn) {
      listeners.add(fn);
      fn({ status, progress, model: model.id });
      return () => listeners.delete(fn);
    },

    /**
     * Fetch and prepare the weights. The stub pretends, at a believable pace,
     * so the loading states in the UI are exercised the way the real download
     * will exercise them.
     */
    load() {
      if (loading) return loading;
      status = 'loading';
      progress = 0;
      emit();
      loading = new Promise((resolve) => {
        const start = performance.now();
        const duration = 1400 + model.sizeMb * 12;
        const tick = () => {
          const t = Math.min((performance.now() - start) / duration, 1);
          progress = 1 - (1 - t) ** 2.4;
          emit();
          if (t < 1) setTimeout(tick, 60);
          else {
            status = 'ready';
            progress = 1;
            emit();
            resolve();
          }
        };
        tick();
      });
      return loading;
    },

    /** @param {string} id */
    async setModel(id) {
      const next = MODELS.find((m) => m.id === id);
      if (!next || next.id === model.id) return;
      model = next;
      loading = null;
      status = 'idle';
      progress = 0;
      emit();
      await engine.load();
    },

    /**
     * @param {{text: string, voice: Voice, settings?: Settings, seed?: number}} request
     * @returns {Promise<Synthesis>}
     */
    async synthesize({ text, voice, settings = {}, seed = 1 }) {
      await engine.load();
      const start = performance.now();
      // Sentence by sentence, as the streaming path will: the first chunk's
      // time is the time to first audio.
      const sentences = text.match(/[^.!?]+[.!?]*/g) ?? [text];
      /** @type {Float32Array[]} */
      const chunks = [];
      let ttfaMs = 0;
      for (const [i, sentence] of sentences.entries()) {
        if (!sentence.trim()) continue;
        chunks.push(render(sentence, voice, settings, seed + i));
        if (!ttfaMs) ttfaMs = performance.now() - start;
        // Yield so a long render never freezes the page.
        await new Promise((r) => setTimeout(r, 0));
      }
      const samples = concat(chunks);
      const elapsedMs = performance.now() - start;
      const seconds = samples.length / SAMPLE_RATE;
      return {
        samples,
        sampleRate: SAMPLE_RATE,
        stats: {
          backend: model.backend === 'gpu' && hasWebGPU() ? 'webgpu (stub)' : 'cpu (stub)',
          model: model.name,
          seconds,
          elapsedMs,
          ttfaMs,
          rtf: seconds ? elapsedMs / 1000 / seconds : 0,
        },
      };
    },

    /**
     * A voice's audition sample. In the finished product these are
     * pre-rendered files, playable before the model loads; the stub renders
     * them directly and likewise never waits for `load()`.
     *
     * @param {Voice} voice
     * @param {string} [text]
     */
    preview(voice, text = PREVIEW_TEXT) {
      return { samples: render(text, voice, {}, 7), sampleRate: SAMPLE_RATE };
    },

    /**
     * Instant cloning: reference audio in, speaker embedding out. The stub's
     * "embedding" is the speaker's measured pitch, which is enough to hear
     * that the new voice came from the recording.
     *
     * @param {{name: string, samples: Float32Array, sampleRate: number, description?: string}} input
     * @returns {Voice}
     */
    clone({ name, samples, sampleRate, description }) {
      const pitch = estimatePitch(samples, sampleRate) || 150;
      const hue = Math.floor(Math.random() * 360);
      return {
        id: `c-${Date.now().toString(36)}`,
        name,
        gender: pitch > 165 ? 'female' : 'male',
        age: 'middle-aged',
        accent: 'Custom',
        language: 'English',
        category: 'Cloned',
        tags: ['cloned'],
        description: description || `Instant clone · measured pitch ${pitch} Hz`,
        pitch,
        brightness: pitch > 165 ? 1.12 : 0.97,
        breath: 0.12,
        pace: 1,
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
