/**
 * Cadence on Node: the same voices and the same model, on the native runtime
 * (onnxruntime-node), which measured 3× faster than the browser on the
 * reference machine (docs/BENCHMARKS.md).
 *
 *   import { createEngine } from '@cadence/engine/node';
 *   const engine = await createEngine();
 *   const { samples, sampleRate } = await engine.synthesize({ text: 'Hello.' });
 *
 * Weights are downloaded once into a folder on disk (by default
 * ~/.cache/cadence) and read from there every time after.
 */

import { existsSync } from 'node:fs';
import { mkdir, readFile, rename, rm, stat, writeFile } from 'node:fs/promises';
import os from 'node:os';
import { join } from 'node:path';
import { chunks, loadPiper } from './piper.js';
import { VOICES } from './voices.js';
import { encodeWav } from './wav.js';
import { SWIFT_BASE, SWIFT_BYTES, SWIFT_NAME } from './weights.js';

export { FACETS, PREVIEW_TEXT, VOICES } from './voices.js';
export { encodeWav } from './wav.js';
export { chunks } from './piper.js';

/** Where weights are kept unless told otherwise. */
export const DEFAULT_DIR = process.env.CADENCE_MODELS ?? join(os.homedir(), '.cache', 'cadence');

/**
 * Make sure the fast model's files are in `dir`, downloading only what is
 * missing or incomplete. Returns their paths.
 *
 * @param {{dir?: string, onProgress?: (fraction: number) => void, tries?: number}} [options]
 * @returns {Promise<{model: string, config: string}>}
 */
export async function fetchWeights({ dir = DEFAULT_DIR, onProgress, tries = 4 } = {}) {
  await mkdir(dir, { recursive: true });
  const model = join(dir, `${SWIFT_NAME}.onnx`);
  const config = join(dir, `${SWIFT_NAME}.onnx.json`);
  if (!(await complete(config, 0))) await fetchFile(`${SWIFT_BASE}.onnx.json`, config, { tries });
  // Progress is reported only for a real download, never for files already on disk.
  if (!(await complete(model, SWIFT_BYTES))) {
    await fetchFile(`${SWIFT_BASE}.onnx`, model, { tries, expectedBytes: SWIFT_BYTES, onProgress });
    onProgress?.(1);
  }
  return { model, config };
}

/** @param {string} path @param {number} bytes */
async function complete(path, bytes) {
  if (!existsSync(path)) return false;
  return !bytes || (await stat(path)).size === bytes;
}

/**
 * Written under a temporary name and renamed when whole, so an interrupted
 * download never leaves a truncated file that looks complete.
 *
 * @param {string} url @param {string} target
 * @param {{tries: number, expectedBytes?: number, onProgress?: (f: number) => void}} options
 */
async function fetchFile(url, target, { tries, expectedBytes = 0, onProgress }) {
  for (let attempt = 1; ; attempt++) {
    try {
      const res = await fetch(url);
      if (!res.ok || !res.body) throw new Error(`${url}: HTTP ${res.status}`);
      const total = Number(res.headers.get('content-length')) || expectedBytes;
      const parts = [];
      let got = 0;
      for await (const part of /** @type {any} */ (res.body)) {
        parts.push(part);
        got += part.length;
        if (total) onProgress?.(Math.min(0.99, got / total));
      }
      if (total && got !== total) throw new Error(`${url}: closed at ${got} of ${total} bytes`);
      await writeFile(`${target}.part`, Buffer.concat(parts));
      await rename(`${target}.part`, target);
      return;
    } catch (e) {
      await rm(`${target}.part`, { force: true });
      if (attempt >= tries) throw e;
      await new Promise((r) => setTimeout(r, 1500 * attempt));
    }
  }
}

/** Silence after each piece, by how it ends (the same as the browser engine). */
const PAUSE = { '.': 0.28, '!': 0.32, '?': 0.34, ',': 0.14, ';': 0.18, ':': 0.18, '—': 0.14, default: 0.02 };

/**
 * @typedef {import('./voices.js').Voice} Voice
 * @typedef {{samples: Float32Array, sampleRate: number, stats: {seconds: number, elapsedMs: number, ttfaMs: number, rtf: number}}} Synthesis
 */

/**
 * The native runtime when it loads; otherwise the WebAssembly one, which is
 * slower but needs nothing installed. `backend` says which, `warning` why.
 *
 * @param {'auto' | 'native' | 'wasm'} want
 * @returns {Promise<{ort: any, backend: 'native' | 'wasm', warning: string}>}
 */
async function runtime(want) {
  let warning = '';
  if (want !== 'wasm') {
    try {
      return { ort: await import('onnxruntime-node'), backend: 'native', warning };
    } catch (e) {
      const err = /** @type {any} */ (e);
      // On Windows the usual cause is a missing Visual C++ runtime (vcruntime140_1.dll).
      warning = err?.code === 'ERR_MODULE_NOT_FOUND'
        ? 'onnxruntime-node is not installed (npm install onnxruntime-node for full speed).'
        : `onnxruntime-node would not load: ${String(err?.message).split('\n')[0].trim().replace(/\.+$/, '')}.${process.platform === 'win32' ? ' Install the Microsoft Visual C++ 2015–2022 x64 redistributable.' : ''}`;
      if (want === 'native') throw new Error(warning);
      warning += ' Using WebAssembly instead, about 3× slower.';
    }
  }
  const ort = await import('onnxruntime-web');
  ort.env.wasm.numThreads = 1;
  return { ort, backend: 'wasm', warning };
}

/**
 * Load the fast model, on the native runtime when it is available.
 *
 * @param {{dir?: string, threads?: number, onProgress?: (fraction: number) => void, runtime?: 'auto' | 'native' | 'wasm'}} [options]
 */
export async function createEngine({ dir, threads, onProgress, runtime: want = 'auto' } = {}) {
  const { ort, backend, warning } = await runtime(want);
  const files = await fetchWeights({ dir, onProgress });
  const config = JSON.parse(await readFile(files.config, 'utf8'));
  const piper = await loadPiper({
    ort,
    model: await readFile(files.model),
    config,
    sessionOptions: backend === 'native' && threads ? { intraOpNumThreads: threads } : {},
  });

  return {
    /** 'native' (onnxruntime-node) or 'wasm' (onnxruntime-web). */
    backend,
    /** Why the engine is not on the native runtime, when it is not. */
    warning,
    sampleRate: piper.sampleRate,
    voices: VOICES.filter((v) => v.model === 'swift'),

    /**
     * Speak `text`. Audio arrives piece by piece through `onChunk`; the
     * promise resolves with the whole utterance.
     *
     * @param {{text: string, voice?: string | Voice, speed?: number, onChunk?: (s: Float32Array) => void, signal?: AbortSignal}} request
     * @returns {Promise<Synthesis>}
     */
    async synthesize({ text, voice = VOICES[0].id, speed = 1, onChunk, signal }) {
      const v = resolveVoice(voice);
      const start = performance.now();
      let ttfaMs = 0;
      /** @type {Float32Array[]} */
      const parts = [];
      for (const piece of chunks(text)) {
        signal?.throwIfAborted();
        const audio = await piper.speak(piece, { speaker: v.speaker, speed });
        const end = /** @type {keyof typeof PAUSE} */ (piece.replace(/["')\]]+$/, '').slice(-1));
        const out = new Float32Array(audio.length + Math.round(piper.sampleRate * (PAUSE[end] ?? PAUSE.default) / speed));
        out.set(audio);
        if (!ttfaMs) ttfaMs = performance.now() - start;
        parts.push(out);
        onChunk?.(out);
      }
      const samples = new Float32Array(parts.reduce((n, p) => n + p.length, 0));
      let o = 0;
      for (const p of parts) { samples.set(p, o); o += p.length; }
      const elapsedMs = performance.now() - start;
      const seconds = samples.length / piper.sampleRate;
      return { samples, sampleRate: piper.sampleRate, stats: { seconds, elapsedMs, ttfaMs, rtf: seconds ? elapsedMs / 1000 / seconds : 0 } };
    },

    /**
     * Speak `text` straight into a WAV file.
     *
     * @param {string} path
     * @param {{text: string, voice?: string | Voice, speed?: number}} request
     */
    async toFile(path, request) {
      const r = await this.synthesize(request);
      await writeFile(path, Buffer.from(encodeWav(r.samples, r.sampleRate)));
      return r;
    },
  };
}

/** @param {string | Voice} voice */
function resolveVoice(voice) {
  const v = typeof voice === 'string' ? VOICES.find((x) => x.id === voice || x.name === voice) : voice;
  if (!v) throw new Error(`Unknown voice "${voice}". See VOICES for the list.`);
  if (v.model !== 'swift') throw new Error(`"${v.name}" is an HD voice; the Node engine runs the Swift model only.`);
  return v;
}
