/**
 * The voice library, as data.
 *
 * A voice is a speaker embedding, not a model (proposal §4.1). The library is
 * built from the 28 English originals that ship with the reference weights,
 * plus blends of them — weighted averages in the embedding space, which give
 * voices that belong to no real person. Each blend says what it is made of;
 * nothing here pretends to labels nobody has curated yet (that is M4b).
 *
 * Deterministic: the same library, in the same order, on every machine.
 */

/** @typedef {'female' | 'male'} Gender */
/** @typedef {'original' | 'blend' | 'matched'} Kind */

/**
 * @typedef {object} Voice
 * @property {string} id
 * @property {string} name
 * @property {Gender} gender
 * @property {string} accent
 * @property {string} language
 * @property {Kind} kind
 * @property {string} grade        quality grade, A best
 * @property {'a' | 'b'} lang      phonemiser: American or British English
 * @property {[string, number][]} mix  original voice ids and weights
 * @property {string} description
 * @property {string[]} tags
 * @property {number} pitch        measured mean pitch, Hz
 * @property {[number, number, number]} hues  orb colours
 * @property {'library' | 'cloned'} source
 */

/**
 * The originals, with the quality grades published alongside the weights and
 * the mean pitch measured from each voice saying the same sentence.
 * [id, name, grade, pitch, words]
 */
const ORIGINALS = /** @type {const} */ ([
  ['af_heart', 'Heart', 'A', 194, 'warm, expressive'],
  ['af_bella', 'Bella', 'A-', 192, 'bright, lively'],
  ['af_nicole', 'Nicole', 'B-', 140, 'soft, intimate'],
  ['af_aoede', 'Aoede', 'C+', 189, 'smooth, even'],
  ['af_kore', 'Kore', 'C+', 147, 'clear, steady'],
  ['af_sarah', 'Sarah', 'C+', 189, 'friendly, light'],
  ['af_alloy', 'Alloy', 'C', 143, 'neutral, crisp'],
  ['af_nova', 'Nova', 'C', 156, 'bright, quick'],
  ['af_sky', 'Sky', 'C-', 173, 'airy, young'],
  ['af_jessica', 'Jessica', 'D', 211, 'casual'],
  ['af_river', 'River', 'D', 189, 'calm'],
  ['am_fenrir', 'Fenrir', 'C+', 129, 'deep, strong'],
  ['am_michael', 'Michael', 'C+', 113, 'warm, grounded'],
  ['am_puck', 'Puck', 'C+', 130, 'playful, bright'],
  ['am_echo', 'Echo', 'D', 102, 'even'],
  ['am_eric', 'Eric', 'D', 154, 'plain'],
  ['am_liam', 'Liam', 'D', 133, 'young'],
  ['am_onyx', 'Onyx', 'D', 90, 'deep'],
  ['am_santa', 'Santa', 'D-', 190, 'jolly, old'],
  ['am_adam', 'Adam', 'F+', 114, 'rough'],
  ['bf_emma', 'Emma', 'B-', 179, 'polished, warm'],
  ['bf_isabella', 'Isabella', 'C', 207, 'refined, clear'],
  ['bf_alice', 'Alice', 'D', 233, 'light'],
  ['bf_lily', 'Lily', 'D', 188, 'gentle'],
  ['bm_george', 'George', 'C', 147, 'mature, rich'],
  ['bm_fable', 'Fable', 'C', 123, 'storyteller'],
  ['bm_lewis', 'Lewis', 'D+', 87, 'measured'],
  ['bm_daniel', 'Daniel', 'D', 132, 'calm'],
]);

const SCORE = { A: 10, 'A-': 9, 'B+': 8, B: 7, 'B-': 6, 'C+': 5, C: 4, 'C-': 3, 'D+': 2, D: 1.5, 'D-': 1, 'F+': 0.5 };
const LETTERS = Object.entries(SCORE).sort((a, b) => b[1] - a[1]);
/** @param {number} s */
const letter = (s) => (LETTERS.find(([, v]) => s >= v - 0.5) ?? LETTERS[LETTERS.length - 1])[0];

const BLEND_NAMES = {
  female: [
    'Aria', 'Maya', 'Isla', 'Nora', 'Leah', 'Zara', 'Ivy', 'Elena', 'Sofia', 'Ada', 'Clara', 'Hazel', 'Iris', 'June',
    'Lena', 'Mira', 'Nadia', 'Opal', 'Quinn', 'Rhea', 'Sage', 'Tessa', 'Uma', 'Vera', 'Willa', 'Yara', 'Amara', 'Bea',
    'Celine', 'Dahlia', 'Esme', 'Fern', 'Greta', 'Hana', 'Imani', 'Jade', 'Kira', 'Lila', 'Mina', 'Noor', 'Odette',
    'Pia', 'Rosa', 'Selin', 'Talia', 'Una', 'Viola', 'Wren', 'Xenia', 'Yumi', 'Zoe', 'Anika', 'Brielle', 'Cora',
    'Delphine', 'Elodie', 'Farah', 'Gia', 'Helena', 'Ines', 'Juno', 'Kaia', 'Lucia', 'Marlowe', 'Nia', 'Oona',
    'Paloma', 'Ruby', 'Saoirse', 'Thea', 'Valentina', 'Winona', 'Ayla', 'Bianca', 'Camille', 'Daria', 'Eden', 'Freya',
    'Gwen', 'Harper', 'Ilse', 'Jasmine', 'Keira', 'Lorelei', 'Margot', 'Neve', 'Olive', 'Priya', 'Romy', 'Stella',
    'Tamsin', 'Vivian', 'Aurora', 'Blythe', 'Carmen', 'Dina', 'Emilia', 'Fleur', 'Giselle', 'Hope', 'Indira', 'Joelle',
    'Kalani', 'Liesel', 'Maren', 'Nell', 'Orla', 'Petra', 'Rosalind', 'Sienna', 'Tove', 'Ursa', 'Vesna', 'Yasmin',
    'Zelda', 'Astrid', 'Bryony', 'Cleo', 'Dorothea', 'Edie', 'Fiona', 'Gemma', 'Hollis', 'Ingrid', 'Juliet', 'Kenna',
    'Lark', 'Mabel', 'Nina', 'Ophelia', 'Phoebe', 'Rania', 'Signe', 'Tilda',
  ],
  male: [
    'Atlas', 'Beck', 'Caleb', 'Dorian', 'Ezra', 'Felix', 'Gideon', 'Hugo', 'Idris', 'Jonah', 'Kai', 'Leo', 'Milo',
    'Nico', 'Otto', 'Pierce', 'Rafe', 'Silas', 'Theo', 'Ulric', 'Victor', 'Wes', 'Xander', 'Yusuf', 'Zane', 'Arlo',
    'Bram', 'Callum', 'Dante', 'Emil', 'Finn', 'Grant', 'Hector', 'Ivan', 'Jasper', 'Knox', 'Luca', 'Marcus', 'Nolan',
    'Omar', 'Pax', 'Reid', 'Soren', 'Tobias', 'Vance', 'Walt', 'Yann', 'Zeke', 'Basil', 'Cyrus', 'Dmitri', 'Elias',
    'Fraser', 'Gray', 'Harlan', 'Isaac', 'Jude', 'Kenji', 'Lorenzo', 'Mateo', 'Nash', 'Orion', 'Rowan', 'Sebastian',
    'Tariq', 'Vito', 'Wolfe', 'Aziz', 'Blake', 'Conrad', 'Declan', 'Everett',
  ],
};

/** Orb colours from the id, so a voice always wears the same face. */
function hues(/** @type {string} */ id) {
  let h = 2166136261;
  for (let i = 0; i < id.length; i++) h = Math.imul(h ^ id.charCodeAt(i), 16777619);
  const a = (h >>> 0) % 360;
  return /** @type {[number, number, number]} */ ([a, (a + 50 + ((h >>> 9) % 60)) % 360, (a + 180 + ((h >>> 17) % 40)) % 360]);
}

/** @returns {Voice[]} */
function build() {
  const byId = new Map(ORIGINALS.map((o) => [o[0], o]));
  const accentOf = (/** @type {string} */ id) => (id[0] === 'b' ? 'British' : 'American');
  const genderOf = (/** @type {string} */ id) => /** @type {Gender} */ (id[1] === 'f' ? 'female' : 'male');

  /** @type {Voice[]} */
  const originals = ORIGINALS.map(([id, name, grade, pitch, words]) => ({
    id,
    name,
    gender: genderOf(id),
    accent: accentOf(id),
    language: 'English',
    kind: 'original',
    grade,
    lang: /** @type {'a' | 'b'} */ (id[0]),
    mix: [[id, 1]],
    description: `${cap(words)} ${accentOf(id)} ${genderOf(id)} voice. One of the original voices shipped with the weights.`,
    tags: words.split(', '),
    pitch,
    hues: hues(id),
    source: 'library',
  }));

  /** @type {Voice[]} */
  const blends = [];
  const used = new Set(originals.map((v) => v.name));
  /** @type {Record<Gender, number>} */
  const nameAt = { female: 0, male: 0 };

  /** @param {[string, number][]} mix */
  const add = (mix) => {
    const gender = genderOf(mix[0][0]);
    let name;
    do name = BLEND_NAMES[gender][nameAt[gender]++ % BLEND_NAMES[gender].length];
    while (used.has(name) && nameAt[gender] < BLEND_NAMES[gender].length * 2);
    used.add(name);
    const total = mix.reduce((s, [, w]) => s + w, 0);
    const [lead] = [...mix].sort((a, b) => b[1] - a[1]);
    const british = mix.reduce((s, [id, w]) => s + (id[0] === 'b' ? w : 0), 0) / total;
    const accent = british > 0.6 ? 'British' : british < 0.4 ? 'American' : 'Transatlantic';
    const score = mix.reduce((s, [id, w]) => s + SCORE[/** @type {keyof typeof SCORE} */ (byId.get(id)?.[2] ?? 'C')] * w, 0) / total;
    const pitch = Math.round(mix.reduce((s, [id, w]) => s + (byId.get(id)?.[3] ?? 150) * w, 0) / total);
    const recipe = mix.map(([id, w]) => `${Math.round((w / total) * 100)}% ${byId.get(id)?.[1]}`).join(' · ');
    const words = [...new Set(mix.flatMap(([id]) => (byId.get(id)?.[4] ?? '').split(', ')))].slice(0, 2);
    const id = `blend-${mix.map(([v, w]) => `${v}${Math.round((w / total) * 100)}`).join('-')}`;
    blends.push({
      id,
      name,
      gender,
      accent,
      language: 'English',
      kind: 'blend',
      grade: letter(score),
      lang: /** @type {'a' | 'b'} */ (british > 0.5 ? 'b' : 'a'),
      mix: mix.map(([v, w]) => [v, +(w / total).toFixed(3)]),
      description: `${cap(words.join(' and '))} ${accent} ${gender} voice, blended from ${recipe}. Belongs to no real person.`,
      tags: words,
      pitch,
      hues: hues(id),
      source: 'library',
    });
    void lead;
  };

  const good = (/** @type {Gender} */ g, min = 3) =>
    ORIGINALS.filter(([id, , grade]) => genderOf(id) === g && SCORE[/** @type {keyof typeof SCORE} */ (grade)] >= min).map(([id]) => id);

  // Female: every pair of the well-graded voices, leaning each way.
  const f = good('female');
  for (let i = 0; i < f.length; i++) {
    for (let j = i + 1; j < f.length; j++) {
      add([[f[i], 0.65], [f[j], 0.35]]);
      add([[f[j], 0.65], [f[i], 0.35]]);
    }
  }
  // Female: threes from the very best, in equal parts.
  const top = f.slice(0, 6);
  for (let a = 0; a < top.length; a++)
    for (let b = a + 1; b < top.length; b++)
      for (let c = b + 1; c < top.length; c++) add([[top[a], 1], [top[b], 1], [top[c], 1]]);

  // Male: the well-graded voices with each other in three proportions, and
  // each of them lending its quality to one of the weaker voices.
  const m = good('male');
  const weak = ORIGINALS.filter(([id, , grade]) => genderOf(id) === 'male' && !m.includes(id) && grade !== 'F+').map(([id]) => id);
  for (let i = 0; i < m.length; i++) {
    for (let j = i + 1; j < m.length; j++) {
      add([[m[i], 0.5], [m[j], 0.5]]);
      add([[m[i], 0.7], [m[j], 0.3]]);
      add([[m[j], 0.7], [m[i], 0.3]]);
    }
    for (const w of weak) add([[m[i], 0.7], [w, 0.3]]);
  }

  // Originals first, best first; then blends interleaved by gender.
  originals.sort((a, b) => SCORE[/** @type {keyof typeof SCORE} */ (b.grade)] - SCORE[/** @type {keyof typeof SCORE} */ (a.grade)]);
  const fb = blends.filter((v) => v.gender === 'female');
  const mb = blends.filter((v) => v.gender === 'male');
  const mixed = [];
  while (fb.length || mb.length) {
    if (fb.length) mixed.push(/** @type {Voice} */ (fb.shift()));
    if (fb.length) mixed.push(/** @type {Voice} */ (fb.shift()));
    if (mb.length) mixed.push(/** @type {Voice} */ (mb.shift()));
  }
  return [...originals, ...mixed];
}

/** @param {string} s */
const cap = (s) => s.charAt(0).toUpperCase() + s.slice(1);

export const VOICES = build();
export const ORIGINAL_IDS = ORIGINALS.map(([id]) => id);

export const FACETS = {
  gender: ['female', 'male'],
  accent: ['American', 'British', 'Transatlantic'],
  kind: ['original', 'blend'],
};

/** The sentence every preview says, so voices are directly comparable. */
export const PREVIEW_TEXT = 'Hi! This is how I sound, made entirely on your own machine.';

/**
 * The library voice nearest a measured pitch: the two closest originals of
 * the matching gender, blended toward the closer one. Stands in for cloning
 * until the cloning model exists.
 *
 * @param {number} pitch
 * @returns {{mix: [string, number][], lang: 'a' | 'b', gender: Gender}}
 */
export function matchPitch(pitch) {
  // The originals overlap between 140 and 155 Hz; split in the middle.
  const gender = pitch >= 150 ? 'female' : 'male';
  const pool = ORIGINALS
    .filter(([id, , grade]) => (id[1] === 'f') === (gender === 'female') && SCORE[/** @type {keyof typeof SCORE} */ (grade)] >= 3)
    .map(([id, , , p]) => ({ id, d: Math.abs(p - pitch) }))
    .sort((a, b) => a.d - b.d);
  const [a, b] = pool;
  const wa = b.d + a.d === 0 ? 0.5 : b.d / (a.d + b.d);
  return { mix: [[a.id, +wa.toFixed(3)], [b.id, +(1 - wa).toFixed(3)]], lang: /** @type {'a' | 'b'} */ (a.id[0]), gender };
}
