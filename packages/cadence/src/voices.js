/**
 * The voice library, as data.
 *
 * In the finished engine a voice is a speaker embedding — a few hundred floats
 * — plus the labels curation gives it. Until the curation pipeline exists
 * (M4b), the library is generated deterministically from a seed so the picker,
 * the filters and the previews have something real-shaped to work against.
 * Same seed, same two hundred voices, on every machine.
 */

/** @typedef {'female' | 'male' | 'neutral'} Gender */
/** @typedef {'young' | 'middle-aged' | 'old'} Age */

/**
 * @typedef {object} Voice
 * @property {string} id
 * @property {string} name
 * @property {Gender} gender
 * @property {Age} age
 * @property {string} accent
 * @property {string} language
 * @property {string} category    what the voice is good for
 * @property {string[]} tags       timbre words
 * @property {string} description
 * @property {number} pitch        mean fundamental frequency, Hz
 * @property {number} brightness   formant scale, ~0.9–1.2
 * @property {number} breath       aspiration noise, 0–1
 * @property {number} pace         natural speaking rate, ~0.85–1.15
 * @property {[number, number, number]} hues  orb colours
 * @property {'library' | 'cloned'} source
 */

const FEMALE = [
  'Aria', 'Maya', 'Isla', 'Nora', 'Leah', 'Zara', 'Ivy', 'Elena', 'Sofia', 'Ada',
  'Clara', 'Hazel', 'Iris', 'June', 'Lena', 'Mira', 'Nadia', 'Opal', 'Quinn', 'Rhea',
  'Sage', 'Tessa', 'Uma', 'Vera', 'Willa', 'Yara', 'Amara', 'Bea', 'Celine', 'Dahlia',
  'Esme', 'Fern', 'Greta', 'Hana', 'Imani', 'Jade', 'Kira', 'Lila', 'Mina', 'Noor',
  'Odette', 'Pia', 'Rosa', 'Selin', 'Talia', 'Una', 'Viola', 'Wren', 'Xenia', 'Yumi',
  'Zoe', 'Anika', 'Brielle', 'Cora', 'Delphine', 'Elodie', 'Farah', 'Gia', 'Helena',
  'Ines', 'Juno', 'Kaia', 'Lucia', 'Marlowe', 'Nia', 'Oona', 'Paloma', 'Ruby', 'Saoirse',
  'Thea', 'Valentina', 'Winona', 'Ayla', 'Bianca', 'Camille', 'Daria', 'Eden', 'Freya',
  'Gwen', 'Harper', 'Ilse', 'Jasmine', 'Keira', 'Lorelei', 'Margot', 'Neve', 'Olive',
  'Priya', 'Romy', 'Stella', 'Tamsin', 'Vivian', 'Aurora', 'Blythe', 'Carmen', 'Dina',
  'Emilia', 'Fleur', 'Giselle', 'Hope', 'Indira',
];

const MALE = [
  'Atlas', 'Beck', 'Caleb', 'Dorian', 'Ezra', 'Felix', 'Gideon', 'Hugo', 'Idris', 'Jonah',
  'Kai', 'Leo', 'Milo', 'Nico', 'Otto', 'Pierce', 'Rafe', 'Silas', 'Theo', 'Ulric',
  'Victor', 'Wes', 'Xander', 'Yusuf', 'Zane', 'Arlo', 'Bram', 'Callum', 'Dante', 'Emil',
  'Finn', 'Grant', 'Hector', 'Ivan', 'Jasper', 'Knox', 'Luca', 'Marcus', 'Nolan', 'Omar',
  'Pax', 'Reid', 'Soren', 'Tobias', 'Upton', 'Vance', 'Walt', 'Yann', 'Zeke', 'Adrian',
  'Basil', 'Cyrus', 'Dmitri', 'Elias', 'Fraser', 'Gray', 'Harlan', 'Isaac', 'Jude',
  'Kenji', 'Lorenzo', 'Mateo', 'Nash', 'Orion', 'Phoenix', 'Rowan', 'Sebastian', 'Tariq',
  'Vito', 'Wolfe', 'Aziz', 'Blake', 'Conrad', 'Declan', 'Everett', 'Florian', 'Gus',
  'Hamish', 'Ibrahim', 'Joaquin', 'Kofi', 'Lars', 'Magnus', 'Nathaniel', 'Oscar',
  'Percy', 'Rhys', 'Stellan', 'Thatcher', 'Vaughn', 'Anders', 'Bruno', 'Cassius',
  'Desmond', 'Enzo', 'Ford', 'Gael', 'Henrik', 'Ike', 'Jett',
];

const NEUTRAL = ['Ash', 'Blue', 'Cyan', 'Echo', 'Indigo', 'Lumen', 'River', 'Sky', 'Nova', 'Onyx'];

const ACCENTS = [
  ['American', 'English'], ['British', 'English'], ['Australian', 'English'],
  ['Irish', 'English'], ['Scottish', 'English'], ['Canadian', 'English'],
  ['South African', 'English'], ['Indian', 'English'], ['Nigerian', 'English'],
  ['Transatlantic', 'English'],
];

const AGES = /** @type {Age[]} */ (['young', 'middle-aged', 'old']);

const CATEGORIES = [
  'Narration', 'Conversational', 'Characters', 'News', 'Social media',
  'Audiobook', 'Educational', 'Advertisement', 'Meditation', 'Gaming',
];

const TIMBRE = [
  'warm', 'deep', 'bright', 'raspy', 'calm', 'crisp', 'smooth', 'airy', 'rich',
  'gravelly', 'velvety', 'soft', 'confident', 'playful', 'authoritative', 'gentle',
  'energetic', 'husky', 'clear', 'measured',
];

const PHRASES = {
  Narration: 'a steady, immersive storyteller',
  Conversational: 'natural and easy, like talking to a friend',
  Characters: 'expressive, with range for animation and games',
  News: 'polished and neutral, built for headlines',
  'Social media': 'upbeat and punchy for short-form video',
  Audiobook: 'patient pacing for long listening sessions',
  Educational: 'clear and encouraging, made for explainers',
  Advertisement: 'persuasive with a confident edge',
  Meditation: 'slow, grounded and soothing',
  Gaming: 'bold and dramatic for in-game dialogue',
};

/** Mulberry32. Small, fast, and identical everywhere. */
function rng(seed) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/**
 * @template T
 * @param {() => number} r
 * @param {readonly T[]} list
 * @returns {T}
 */
const pick = (r, list) => list[Math.floor(r() * list.length)];

/** @returns {Voice[]} */
function build() {
  const r = rng(0xca_de_c3);
  /** @type {Voice[]} */
  const voices = [];

  const add = (/** @type {string} */ name, /** @type {Gender} */ gender, /** @type {number} */ i) => {
    const age = pick(r, AGES);
    const [accent, language] = pick(r, ACCENTS);
    const category = pick(r, CATEGORIES);
    const a = pick(r, TIMBRE);
    let b = pick(r, TIMBRE);
    while (b === a) b = pick(r, TIMBRE);

    const base = gender === 'female' ? 205 : gender === 'male' ? 112 : 158;
    const ageShift = age === 'young' ? 1.08 : age === 'old' ? 0.9 : 1;
    const deep = a === 'deep' || b === 'deep' ? 0.86 : 1;
    const pitch = Math.round(base * ageShift * deep * (0.86 + r() * 0.28));

    const hue = Math.floor(r() * 360);
    voices.push({
      id: `v${String(i).padStart(3, '0')}-${name.toLowerCase()}`,
      name,
      gender,
      age,
      accent,
      language,
      category,
      tags: [a, b],
      description: `${cap(a)} and ${b} ${accent} ${gender === 'neutral' ? '' : gender + ' '}voice — ${PHRASES[/** @type {keyof typeof PHRASES} */ (category)]}.`
        .replace('  ', ' '),
      pitch,
      brightness: +(gender === 'female' ? 1.1 + r() * 0.1 : gender === 'male' ? 0.92 + r() * 0.1 : 1 + r() * 0.1).toFixed(3),
      breath: +(a === 'airy' || b === 'airy' || a === 'husky' || b === 'husky' ? 0.35 + r() * 0.2 : r() * 0.18).toFixed(3),
      pace: +(category === 'Meditation' ? 0.84 : category === 'Social media' ? 1.12 : 0.92 + r() * 0.16).toFixed(3),
      hues: [hue, (hue + 40 + Math.floor(r() * 60)) % 360, (hue + 180 + Math.floor(r() * 40)) % 360],
      source: 'library',
    });
  };

  let i = 0;
  const f = [...FEMALE];
  const m = [...MALE];
  const n = [...NEUTRAL];
  // Interleave so the default ordering is not a wall of one gender.
  while (f.length || m.length || n.length) {
    if (f.length) add(/** @type {string} */ (f.shift()), 'female', i++);
    if (m.length) add(/** @type {string} */ (m.shift()), 'male', i++);
    if (n.length && (i % 20 === 0 || (!f.length && !m.length))) add(/** @type {string} */ (n.shift()), 'neutral', i++);
  }
  return voices;
}

/** @param {string} s */
const cap = (s) => s.charAt(0).toUpperCase() + s.slice(1);

export const VOICES = build();

export const FACETS = {
  gender: ['female', 'male', 'neutral'],
  age: AGES,
  accent: ACCENTS.map(([accent]) => accent),
  category: CATEGORIES,
};

/** The sentence every preview says, so voices are directly comparable. */
export const PREVIEW_TEXT =
  'Hello! This is how I sound. Every word you hear was made on your own machine.';
