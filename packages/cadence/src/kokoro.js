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
 * It runs on whatever ONNX Runtime it is handed (the same one as Swift), called
 * directly. Through transformers.js the same passage (about 20 s of speech)
 * took 26–31 s in the app on a Ryzen 5 7430U; direct, 20–22 s, and first audio
 * about 2 s instead of 4–7 (tools/bench/hd). It never touches the DOM.
 */

import { KOKORO_VOCAB } from './data/kokoro-vocab.js';
import { kokoroPhonemes, loadLexicon } from './g2p.js';

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
 * Kokoro on a given ONNX Runtime: whole (`model`), or as HD-Fast (`fast`).
 *
 * HD-Fast keeps Kokoro's front half, everything up to its decoder (reading,
 * pacing, pitch, the voice), and replaces the decoder, 94% of Kokoro's time,
 * with a small network trained to predict the spectrogram Kokoro's decoder
 * would make, and Vocos to turn that into sound (tools/hdfast). The same
 * passage on a Ryzen 5 7430U, four threads: 26 s whole, 3.1 s as HD-Fast;
 * first audio 3.6 s and 0.45 s (tools/hdfast/bench.js).
 *
 * The back half can run elsewhere (`fast.back` a function, as the HD worker
 * does with a thread of its own): then the front half of one piece runs
 * while the back half of the piece before it does.
 *
 * @typedef {Record<'asr' | 'f0' | 'n' | 'style', import('onnxruntime-web').Tensor>} BackInputs
 * @param {{ort: typeof import('onnxruntime-web'), model?: Uint8Array,
 *   fast?: {front: Uint8Array, back: Uint8Array | ((inputs: BackInputs) => Promise<Float32Array>)},
 *   sessionOptions?: import('onnxruntime-web').InferenceSession.SessionOptions}} options
 */
export async function loadKokoro({ ort, model, fast, sessionOptions = { executionProviders: ['wasm'], graphOptimizationLevel: 'all' } }) {
  const create = (/** @type {Uint8Array} */ m) => ort.InferenceSession.create(m, sessionOptions);
  const local = fast && !(typeof fast.back === 'function');
  const [sessions] = await Promise.all([
    Promise.all(fast ? [create(fast.front), ...(local ? [create(/** @type {Uint8Array} */ (fast.back))] : [])] : [create(/** @type {Uint8Array} */ (model))]),
    loadLexicon(),
  ]);
  const [session, backSession] = sessions;
  /** @type {((inputs: BackInputs) => Promise<Float32Array>) | null} */
  const back = !fast ? null : backSession
    ? async (inputs) => /** @type {Float32Array} */ ((await backSession.run(inputs)).waveform.data)
    : /** @type {(inputs: BackInputs) => Promise<Float32Array>} */ (fast.back);
  // A session runs one inference at a time: pieces take turns at the front half.
  let turn = Promise.resolve();

  /** @param {number[]} ids @param {Float32Array} style @param {number} speed */
  const run = async (ids, style, speed) => {
    const inputs = {
      input_ids: new ort.Tensor('int64', BigInt64Array.from(ids, BigInt), [1, ids.length]),
      style: new ort.Tensor('float32', style, [1, STYLE]),
      speed: new ort.Tensor('float32', new Float32Array([speed]), [1]),
    };
    const mine = turn.then(() => session.run(inputs));
    turn = mine.then(() => {}, () => {});
    const out = await mine;
    if (!back) return /** @type {Float32Array} */ (out.waveform.data);
    return back({ asr: out.asr, f0: out.f0, n: out.n, style: inputs.style });
  };

  /** @param {string} phonemes @param {VoiceSpec} voice @param {number} speed */
  const speak = async (phonemes, voice, speed) => {
    // Id 0 pads both ends; symbols outside the vocabulary are dropped.
    const ids = [0];
    for (const ch of phonemes) { const id = KOKORO_VOCAB[ch]; if (id !== undefined) ids.push(id); }
    ids.push(0);
    const table = await embedding(voice);
    // One style row per input length: the phoneme count less one, as in Kokoro's reference.
    const row = STYLE * Math.min(Math.max(ids.length - 3, 0), 509);
    return run(ids, table.slice(row, row + STYLE), speed);
  };

  // One short inference now, so the first one asked for does not also pay
  // for the runtime's first-call setup. A blank style: no voice to fetch.
  const ready = [KOKORO_VOCAB['ɹ'], KOKORO_VOCAB['ˈ'], KOKORO_VOCAB['ɛ'], KOKORO_VOCAB['d'], KOKORO_VOCAB['i'], KOKORO_VOCAB['.']];
  await run([0, ...ready, 0], new Float32Array(STYLE), 1);
  // And one as long as the longest piece, so the runtime has grown its
  // memory to that size before a paragraph needs it.
  await run([0, ...Array(40).fill(ready).flat(), 0], new Float32Array(STYLE), 1);

  return {
    /**
     * One piece of a text (`chunks` with `HD_PIECES`), trimmed, with the
     * pause its punctuation asks for after it.
     *
     * @param {string} piece @param {VoiceSpec} voice @param {number} speed
     */
    async piece(piece, voice, speed) {
      return trim(await speak(kokoroPhonemes(piece, voice.lang), voice, speed), piece, speed);
    },
  };
}

/** Silence after a piece, by how it ends, in seconds: the same breaths as Swift's. */
const PAUSE = { '.': 0.28, '!': 0.32, '?': 0.34, ',': 0.14, ';': 0.18, ':': 0.18, '—': 0.14 };

/**
 * Kokoro pads each piece with uneven silence at both ends. Cut it to the
 * voice, then add the breath a reader takes at that punctuation: a short one
 * at a comma, a longer one at a full stop or a question.
 *
 * @param {Float32Array} a @param {string} piece @param {number} speed
 */
function trim(a, piece, speed) {
  const floor = 0.004;
  let s = 0;
  let e = a.length - 1;
  while (s < e && Math.abs(a[s]) < floor) s++;
  while (e > s && Math.abs(a[e]) < floor) e--;
  const lead = Math.round(SAMPLE_RATE * 0.04);
  // The last sound fades below the floor: keep its tail.
  const fade = Math.round(SAMPLE_RATE * 0.05);
  const voice = a.subarray(Math.max(0, s - lead), Math.min(a.length, e + fade));
  const end = /** @type {keyof typeof PAUSE} */ (piece.replace(/["')]]+$/, '').slice(-1));
  const out = new Float32Array(voice.length + Math.round((SAMPLE_RATE * (PAUSE[end] ?? 0.02)) / speed));
  out.set(voice);
  return out;
}
