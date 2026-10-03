/**
 * The candidate fast-path backend: a Piper voice (VITS, single pass).
 *
 * Proposal §3 says model size is the dial when the CPU is not fast enough.
 * VITS models are a fraction of Kokoro's compute per second of audio, which
 * is why they are measured here as the default fast path on slow machines.
 *
 * The runtime is passed in rather than imported, so the same code runs on
 * onnxruntime-node (native) and onnxruntime-web (browser).
 */

import { phonemize } from 'phonemizer';

/** Punctuation Piper keeps as pauses, and espeak would otherwise drop. */
const PUNCT = /([.,;:!?]+)/;

/**
 * @typedef {object} PiperConfig
 * @property {{sample_rate: number}} audio
 * @property {{voice: string}} espeak
 * @property {{noise_scale: number, length_scale: number, noise_w: number}} inference
 * @property {Record<string, number[]>} phoneme_id_map
 * @property {number} num_speakers
 */

/**
 * Text to Piper's phoneme ids: BOS, then every phoneme followed by the pad
 * symbol, then EOS — the layout the model was trained on.
 *
 * @param {string} text
 * @param {PiperConfig} config
 */
export async function phonemeIds(text, config) {
  const map = config.phoneme_id_map;
  const pad = map._[0];
  /** @type {number[]} */
  const ids = [map['^'][0], pad];
  const push = (/** @type {string} */ ch) => {
    const id = map[ch];
    if (id) ids.push(id[0], pad);
  };
  for (const part of text.split(PUNCT)) {
    if (!part.trim()) continue;
    if (PUNCT.test(part)) {
      for (const ch of part) push(ch);
      push(' ');
      continue;
    }
    const phonemes = (await phonemize(part, config.espeak.voice)).join(' ');
    for (const ch of phonemes) push(ch);
    push(' ');
  }
  ids.push(map.$[0]);
  return ids;
}

/**
 * @param {{ort: any, model: ArrayBuffer | Uint8Array | string, config: PiperConfig,
 *   sessionOptions?: object}} options
 */
export async function loadPiper({ ort, model, config, sessionOptions = {} }) {
  const session = await ort.InferenceSession.create(model, sessionOptions);
  const rate = config.audio.sample_rate;

  return {
    sampleRate: rate,
    speakers: config.num_speakers,

    /**
     * One sentence (or any short span) to audio.
     *
     * @param {string} text
     * @param {{speed?: number, speaker?: number}} [options]
     */
    async speak(text, { speed = 1, speaker = 0 } = {}) {
      const ids = await phonemeIds(text, config);
      const { noise_scale, length_scale, noise_w } = config.inference;
      /** @type {Record<string, any>} */
      const feeds = {
        input: new ort.Tensor('int64', BigInt64Array.from(ids, BigInt), [1, ids.length]),
        input_lengths: new ort.Tensor('int64', BigInt64Array.from([BigInt(ids.length)]), [1]),
        scales: new ort.Tensor('float32', Float32Array.from([noise_scale, length_scale / speed, noise_w]), [3]),
      };
      if (config.num_speakers > 1) feeds.sid = new ort.Tensor('int64', BigInt64Array.from([BigInt(speaker)]), [1]);
      const out = await session.run(feeds);
      return /** @type {Float32Array} */ (out.output.data);
    },
  };
}

/**
 * Sentences, the unit the engine streams in. Short enough that the first one
 * arrives quickly; long enough that the prosody holds together.
 *
 * @param {string} text
 */
export function sentences(text) {
  return (text.match(/[^.!?]+[.!?]+["')\]]*|[^.!?]+$/g) ?? [text]).map((s) => s.trim()).filter(Boolean);
}
