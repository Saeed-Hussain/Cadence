/**
 * The reference backend: Kokoro-82M, open weights (Apache-2.0).
 *
 * Phase 1 of the proposal validates the engine against existing open weights,
 * used as data and as a correctness reference. Kokoro is the right one to
 * start from: a single-pass, non-autoregressive model small enough to run
 * faster than real time on a CPU — the architecture section 3 commits to.
 *
 * Its voices are style embeddings (510 × 256 floats each, one row per input
 * length), which is exactly the "a voice is a vector, not a model" claim in
 * section 4.1. Blending embeddings gives new voices that belong to nobody; the
 * library is built that way on top of the 28 English originals.
 *
 * This file runs wherever the engine runs — a Web Worker in the browser, or
 * Node for tests. It never touches the DOM.
 */

import { KokoroTTS, TextSplitterStream } from 'kokoro-js';

export const MODEL_ID = 'onnx-community/Kokoro-82M-v1.0-ONNX';
export const SAMPLE_RATE = 24000;
const VOICE_URL = (name) => `https://huggingface.co/${MODEL_ID}/resolve/main/voices/${name}.bin`;
const STYLE = 256;

/** @typedef {{lang: 'a' | 'b', mix: [string, number][]}} VoiceSpec */

/** @type {Map<string, Promise<Float32Array>>} */
const base = new Map();

/** One original voice's full embedding table, fetched once and cached. */
function original(name) {
  let p = base.get(name);
  if (!p) {
    p = (async () => {
      const url = VOICE_URL(name);
      /** @type {Cache | undefined} */
      let cache;
      try {
        cache = typeof caches !== 'undefined' ? await caches.open('cadence-voices') : undefined;
        const hit = await cache?.match(url);
        if (hit) return new Float32Array(await hit.arrayBuffer());
      } catch { /* no cache, fetch below */ }
      // Node: kokoro-js ships the voice files; read them, no network needed.
      if (typeof process !== 'undefined' && process.versions?.node && typeof window === 'undefined' && typeof importScripts === 'undefined') {
        const fs = await import(/* webpackIgnore: true */ 'node:fs/promises');
        const file = new URL(`../../../node_modules/kokoro-js/voices/${name}.bin`, import.meta.url);
        const { buffer } = await fs.readFile(file);
        return new Float32Array(buffer.slice(0));
      }
      const buf = await download(url);
      try { await cache?.put(url, new Response(buf.slice(0))); } catch { /* not cached */ }
      return new Float32Array(buf);
    })();
    base.set(name, p);
    p.catch(() => base.delete(name));
  }
  return p;
}

/** A flaky connection should cost a retry, not a voice. */
async function download(/** @type {string} */ url, tries = 3) {
  for (let i = 1; ; i++) {
    try {
      const res = await fetch(url);
      if (!res.ok) throw new Error(`${url}: HTTP ${res.status}`);
      return await res.arrayBuffer();
    } catch (e) {
      if (i >= tries) throw e;
      await new Promise((r) => setTimeout(r, 600 * i));
    }
  }
}

/** @type {Map<string, Promise<Float32Array>>} */
const blended = new Map();

/**
 * The embedding table for a voice spec: one original, or a weighted blend.
 * @param {VoiceSpec} spec
 */
export function embedding(spec) {
  const key = spec.mix.map(([n, w]) => `${n}:${w}`).join('+');
  let p = blended.get(key);
  if (!p) {
    p = (async () => {
      const tables = await Promise.all(spec.mix.map(([n]) => original(n)));
      if (tables.length === 1) return tables[0];
      const total = spec.mix.reduce((s, [, w]) => s + w, 0);
      const out = new Float32Array(tables[0].length);
      tables.forEach((t, i) => {
        const w = spec.mix[i][1] / total;
        for (let j = 0; j < out.length; j++) out[j] += t[j] * w;
      });
      return out;
    })();
    blended.set(key, p);
    p.catch(() => blended.delete(key));
  }
  return p;
}

/**
 * @param {{device?: 'wasm' | 'webgpu' | 'cpu', dtype?: 'fp32' | 'fp16' | 'q8' | 'q4' | 'q4f16',
 *   expectedMb?: number, onProgress?: (fraction: number, phase: 'download' | 'init') => void}} options
 */
export async function loadKokoro({ device = 'wasm', dtype = 'q8', expectedMb = 92, onProgress } = {}) {
  /** @type {Map<string, {loaded: number, total: number}>} */
  const files = new Map();
  const tts = await KokoroTTS.from_pretrained(MODEL_ID, {
    device,
    dtype,
    progress_callback: (/** @type {any} */ e) => {
      // The weights host does not always send a length, so progress is
      // measured against the size the weights are known to be.
      if (e.status === 'progress') {
        files.set(e.file, { loaded: e.loaded ?? 0, total: e.total ?? 0 });
        let loaded = 0;
        let total = 0;
        for (const f of files.values()) { loaded += f.loaded; total += f.total; }
        total = Math.max(total, expectedMb * 1e6);
        onProgress?.(Math.min(0.99, loaded / total), 'download');
      } else if (e.status === 'done' && /\.onnx$/.test(e.file ?? '')) {
        onProgress?.(0.99, 'init');
      }
    },
  });

  // Kokoro only knows voices by name. Teach this instance to take a spec — a
  // blend of named voices — so the library is not limited to the originals.
  const t = /** @type {any} */ (tts);
  t._validate_voice = (/** @type {VoiceSpec} */ spec) => spec.lang;
  t.generate_from_ids = async (/** @type {any} */ ids, /** @type {{voice: VoiceSpec, speed: number}} */ { voice, speed = 1 }) => {
    const table = await embedding(voice);
    const row = STYLE * Math.min(Math.max(ids.dims.at(-1) - 2, 0), 509);
    const Tensor = ids.constructor;
    const { waveform } = await tts.model({
      input_ids: ids,
      style: new Tensor('float32', table.slice(row, row + STYLE), [1, STYLE]),
      speed: new Tensor('float32', [speed], [1]),
    });
    return { audio: /** @type {Float32Array} */ (waveform.data), sampling_rate: SAMPLE_RATE };
  };

  return {
    /**
     * Synthesise sentence by sentence, handing each chunk over as soon as it
     * exists — the first one is the time to first audio.
     *
     * @param {string} text
     * @param {VoiceSpec} voice
     * @param {number} speed
     * @param {(samples: Float32Array, sentence: string) => void} onChunk
     */
    async generate(text, voice, speed, onChunk) {
      // A string passed to stream() leaves its splitter open and the last
      // sentence never arrives; a closed splitter flushes it.
      const sentences = new TextSplitterStream();
      sentences.push(text);
      sentences.close();
      for await (const part of tts.stream(sentences, { voice: /** @type {any} */ (voice), speed })) {
        const audio = /** @type {any} */ (part.audio).audio;
        onChunk(trim(audio), part.text);
      }
    },
  };
}

/**
 * Kokoro pads each sentence with a little silence at both ends. Keep a short,
 * even breath between sentences instead of an uneven gap.
 *
 * @param {Float32Array} a
 */
function trim(a) {
  const floor = 0.004;
  let s = 0;
  let e = a.length - 1;
  while (s < e && Math.abs(a[s]) < floor) s++;
  while (e > s && Math.abs(a[e]) < floor) e--;
  const lead = Math.round(SAMPLE_RATE * 0.04);
  const tail = Math.round(SAMPLE_RATE * 0.22);
  return a.slice(Math.max(0, s - lead), Math.min(a.length, e + tail));
}
