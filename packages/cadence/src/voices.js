/**
 * The voice library, as data.
 *
 * A voice is a speaker in a model, not a model of its own (proposal §4.1).
 *
 *   Swift voices are the 904 speakers of Piper LibriTTS-R — LibriVox
 *   readers, each an index into one 79 MB model. Every label comes from
 *   measuring the speaker (tools/voices/measure.js), not from guessing.
 *
 *   HD voices are Kokoro-82M's 28 English originals, plus 22 blends of the
 *   best of them (BLENDS, below). The originals carry the quality grades
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
 * @property {'original' | 'blend' | 'matched'} kind
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

/**
 * More HD voices, each a blend of two originals of the same accent and
 * gender: a voice is a style vector, and a weighted mix of two good ones is a
 * new voice that belongs to nobody. Built from the best-graded originals, so
 * the blends keep their naturalness.
 *
 * [id, name, [[original, weight], [original, weight]], words]
 */
const BLENDS = /** @type {const} */ ([
  ['hd_aurora', 'Aurora', [['af_heart', 0.6], ['af_bella', 0.4]], 'warm, radiant'],
  ['hd_june', 'June', [['af_heart', 0.5], ['af_sarah', 0.5]], 'friendly, warm'],
  ['hd_willow', 'Willow', [['af_heart', 0.6], ['af_nicole', 0.4]], 'soft, warm'],
  ['hd_maya', 'Maya', [['af_bella', 0.6], ['af_nova', 0.4]], 'bright, energetic'],
  ['hd_clara', 'Clara', [['af_heart', 0.5], ['af_kore', 0.5]], 'clear, warm'],
  ['hd_iris', 'Iris', [['af_bella', 0.5], ['af_aoede', 0.5]], 'smooth, lively'],
  ['hd_ruby', 'Ruby', [['af_heart', 0.7], ['af_sky', 0.3]], 'airy, expressive'],
  ['hd_hazel', 'Hazel', [['af_nicole', 0.6], ['af_aoede', 0.4]], 'gentle, calm'],
  ['hd_stella', 'Stella', [['af_bella', 0.5], ['af_kore', 0.5]], 'confident, clear'],
  ['hd_atlas', 'Atlas', [['am_michael', 0.6], ['am_fenrir', 0.4]], 'deep, warm'],
  ['hd_rowan', 'Rowan', [['am_michael', 0.5], ['am_puck', 0.5]], 'friendly, bright'],
  ['hd_jasper', 'Jasper', [['am_fenrir', 0.6], ['am_puck', 0.4]], 'strong, lively'],
  ['hd_owen', 'Owen', [['am_michael', 0.7], ['am_echo', 0.3]], 'calm, grounded'],
  ['hd_miles', 'Miles', [['am_michael', 0.6], ['am_liam', 0.4]], 'young, warm'],
  ['hd_grant', 'Grant', [['am_fenrir', 0.5], ['am_onyx', 0.5]], 'deep, commanding'],
  ['hd_eleanor', 'Eleanor', [['bf_emma', 0.6], ['bf_isabella', 0.4]], 'polished, refined'],
  ['hd_charlotte', 'Charlotte', [['bf_emma', 0.7], ['bf_lily', 0.3]], 'warm, gentle'],
  ['hd_harriet', 'Harriet', [['bf_isabella', 0.6], ['bf_alice', 0.4]], 'bright, crisp'],
  ['hd_arthur', 'Arthur', [['bm_george', 0.6], ['bm_fable', 0.4]], 'rich, storyteller'],
  ['hd_oliver', 'Oliver', [['bm_fable', 0.6], ['bm_daniel', 0.4]], 'warm, narrator'],
  ['hd_edward', 'Edward', [['bm_george', 0.6], ['bm_lewis', 0.4]], 'measured, mature'],
  ['hd_henry', 'Henry', [['bm_george', 0.5], ['bm_daniel', 0.5]], 'calm, rich'],
]);

/** @param {Voice[]} originals @returns {Voice[]} */
function blends(originals) {
  const byId = new Map(originals.map((v) => [v.id, v]));
  return BLENDS.map(([id, name, mix, words]) => {
    const parts = mix.map(([o]) => /** @type {Voice} */ (byId.get(o)));
    const first = parts[0];
    // Pitch as the mix would put it: the weighted mean of the two.
    const pitch = Math.round(mix.reduce((s, [, w], i) => s + w * parts[i].pitch, 0));
    return {
      id,
      name,
      model: /** @type {const} */ ('hd'),
      gender: first.gender,
      accent: first.accent,
      language: 'English',
      kind: /** @type {const} */ ('blend'),
      grade: 'Blend',
      pitch,
      description: `${cap(words)} ${first.accent} ${first.gender} voice, a blend of ${parts.map((p) => p.name).join(' and ')}. HD.`,
      tags: words.split(', '),
      hues: hues(id),
      source: /** @type {const} */ ('library'),
      lang: /** @type {'a' | 'b'} */ (first.lang),
      mix: /** @type {[string, number][]} */ (mix.map(([o, w]) => [o, w])),
    };
  });
}

/** @param {string} s */
const cap = (s) => s.charAt(0).toUpperCase() + s.slice(1);

const ORIGINALS = hd();
export const VOICES = /** @type {Voice[]} */ ([...swift(), ...ORIGINALS, ...blends(ORIGINALS)]);

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
