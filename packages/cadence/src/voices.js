/**
 * The voice library, as data.
 *
 * A voice is a speaker in a model, not a model of its own (proposal §4.1).
 *
 *   Swift voices are the 904 speakers of Piper LibriTTS-R — LibriVox
 *   readers, each an index into one 79 MB model. Every label comes from
 *   measuring the speaker (tools/voices/measure.js), not from guessing.
 *
 *   HD voices are Kokoro-82M's 28 English originals, with the quality grades
 *   published alongside the weights.
 *
 * Naming and cutting the Swift set down to the best few hundred is M4b's
 * curation work; until then every speaker is listed under its reader number.
 */

import { SPEAKERS } from './data/libritts-speakers.js';

/** @typedef {'swift' | 'hd'} Model */

/**
 * @typedef {object} Voice
 * @property {string} id
 * @property {string} name
 * @property {Model} model
 * @property {'female' | 'male' | 'unclear'} gender
 * @property {string} accent
 * @property {string} language
 * @property {'original' | 'matched'} kind
 * @property {string} grade          quality grade where one is published, else '—'
 * @property {number} pitch          measured mean pitch, Hz
 * @property {string} description
 * @property {string[]} tags
 * @property {[number, number, number]} hues  orb colours
 * @property {'library' | 'cloned'} source
 * @property {number} [speaker]      Swift: speaker index in the model
 * @property {number} [wordsPerMinute] Swift: measured pace
 * @property {'a' | 'b'} [lang]      HD: American or British phonemiser
 * @property {[string, number][]} [mix]  HD: embedding ids and weights
 */

/** Orb colours from the id, so a voice always wears the same face. */
function hues(/** @type {string} */ id) {
  let h = 2166136261;
  for (let i = 0; i < id.length; i++) h = Math.imul(h ^ id.charCodeAt(i), 16777619);
  const a = (h >>> 0) % 360;
  return /** @type {[number, number, number]} */ ([a, (a + 50 + ((h >>> 9) % 60)) % 360, (a + 180 + ((h >>> 17) % 40)) % 360]);
}

/** @param {number[]} xs @param {number} q */
function quantile(xs, q) {
  const s = [...xs].sort((a, b) => a - b);
  return s[Math.min(s.length - 1, Math.floor(q * s.length))];
}

// Labels from the measured distribution. Pitch between the two bands is left
// unlabelled rather than forced into a gender the data does not support.
const FEMALE_FROM = 165;
const MALE_UNDER = 145;
const SLOW_UNDER = quantile(SPEAKERS.map((s) => s.wordsPerMinute), 1 / 3);
const BRISK_FROM = quantile(SPEAKERS.map((s) => s.wordsPerMinute), 2 / 3);

/** @returns {Voice[]} */
function swift() {
  return SPEAKERS.map((s) => {
    const gender = s.pitch >= FEMALE_FROM ? 'female' : s.pitch > 0 && s.pitch < MALE_UNDER ? 'male' : 'unclear';
    const pace = s.wordsPerMinute < SLOW_UNDER ? 'unhurried' : s.wordsPerMinute >= BRISK_FROM ? 'brisk' : 'steady';
    const register = gender === 'female'
      ? (s.pitch >= 215 ? 'high' : 'warm')
      : gender === 'male' ? (s.pitch < 110 ? 'deep' : 'mid-range') : 'mid-range';
    const id = `s-${s.reader}`;
    return {
      id,
      name: `Reader ${s.reader}`,
      model: /** @type {const} */ ('swift'),
      gender,
      accent: 'Unlabelled',
      language: 'English',
      kind: /** @type {const} */ ('original'),
      grade: '—',
      pitch: s.pitch,
      wordsPerMinute: s.wordsPerMinute,
      description: `${cap(register)} ${gender === 'unclear' ? '' : `${gender} `}voice, ${pace} pace (${s.wordsPerMinute} words a minute, ${s.pitch} Hz). LibriVox reader ${s.reader}.`,
      tags: [register, pace],
      hues: hues(id),
      source: /** @type {const} */ ('library'),
      speaker: s.speaker,
    };
  });
}

/**
 * Kokoro's originals: [id, name, grade, measured pitch, words].
 * Grades are the ones published with the weights.
 */
const HD = /** @type {const} */ ([
  ['af_heart', 'Heart', 'A', 194, 'warm, expressive'],
  ['af_bella', 'Bella', 'A-', 192, 'bright, lively'],
  ['af_nicole', 'Nicole', 'B-', 140, 'soft, intimate'],
  ['bf_emma', 'Emma', 'B-', 179, 'polished, warm'],
  ['af_aoede', 'Aoede', 'C+', 189, 'smooth, even'],
  ['af_kore', 'Kore', 'C+', 147, 'clear, steady'],
  ['af_sarah', 'Sarah', 'C+', 189, 'friendly, light'],
  ['am_fenrir', 'Fenrir', 'C+', 129, 'deep, strong'],
  ['am_michael', 'Michael', 'C+', 113, 'warm, grounded'],
  ['am_puck', 'Puck', 'C+', 130, 'playful, bright'],
  ['af_alloy', 'Alloy', 'C', 143, 'neutral, crisp'],
  ['af_nova', 'Nova', 'C', 156, 'bright, quick'],
  ['bf_isabella', 'Isabella', 'C', 207, 'refined, clear'],
  ['bm_george', 'George', 'C', 147, 'mature, rich'],
  ['bm_fable', 'Fable', 'C', 123, 'storyteller'],
  ['af_sky', 'Sky', 'C-', 173, 'airy, young'],
  ['bm_lewis', 'Lewis', 'D+', 87, 'measured'],
  ['af_jessica', 'Jessica', 'D', 211, 'casual'],
  ['af_river', 'River', 'D', 189, 'calm'],
  ['am_echo', 'Echo', 'D', 102, 'even'],
  ['am_eric', 'Eric', 'D', 154, 'plain'],
  ['am_liam', 'Liam', 'D', 133, 'young'],
  ['am_onyx', 'Onyx', 'D', 90, 'deep'],
  ['bf_alice', 'Alice', 'D', 233, 'light'],
  ['bf_lily', 'Lily', 'D', 188, 'gentle'],
  ['bm_daniel', 'Daniel', 'D', 132, 'calm'],
  ['am_santa', 'Santa', 'D-', 190, 'jolly, old'],
  ['am_adam', 'Adam', 'F+', 114, 'rough'],
]);

/** @returns {Voice[]} */
function hd() {
  return HD.map(([id, name, grade, pitch, words]) => {
    const accent = id[0] === 'b' ? 'British' : 'American';
    const gender = id[1] === 'f' ? 'female' : 'male';
    return {
      id,
      name,
      model: /** @type {const} */ ('hd'),
      gender,
      accent,
      language: 'English',
      kind: /** @type {const} */ ('original'),
      grade,
      pitch,
      description: `${cap(words)} ${accent} ${gender} voice. HD, quality grade ${grade}.`,
      tags: words.split(', '),
      hues: hues(id),
      source: /** @type {const} */ ('library'),
      lang: /** @type {'a' | 'b'} */ (id[0]),
      mix: /** @type {[string, number][]} */ ([[id, 1]]),
    };
  });
}

/** @param {string} s */
const cap = (s) => s.charAt(0).toUpperCase() + s.slice(1);

export const VOICES = /** @type {Voice[]} */ ([...swift(), ...hd()]);

export const FACETS = {
  model: ['swift', 'hd'],
  gender: ['female', 'male', 'unclear'],
  accent: ['American', 'British', 'Unlabelled'],
  pace: ['unhurried', 'steady', 'brisk'],
};

/** The sentence every preview says, so voices are directly comparable. */
export const PREVIEW_TEXT = 'Hi! This is how I sound, made entirely on your own machine.';

/**
 * The Swift voice whose measured pitch is closest to `pitch`. Stands in for
 * cloning until the cloning model exists.
 *
 * @param {number} pitch
 * @returns {Voice}
 */
export function matchPitch(pitch) {
  let best = VOICES[0];
  for (const v of VOICES) {
    if (v.model === 'swift' && v.pitch > 0 && Math.abs(v.pitch - pitch) < Math.abs(best.pitch - pitch)) best = v;
  }
  return best;
}
