/**
 * Text to phonemes for English: Cadence's own front end.
 *
 * Both models were trained on eSpeak NG's IPA. eSpeak is GPL-3.0, which would
 * pull every app that ships Cadence under the GPL; this produces the same kind
 * of IPA from permissively licensed parts instead:
 *
 *   1. normalise — numbers, money, times, ordinals, abbreviations to words
 *   2. look up   — CMUdict (BSD 2-clause), 135,000 words, in data/lexicon.bin
 *   3. derive    — plurals, possessives, -ed, -ing, compounds from known words
 *   4. guess     — letter-to-sound rules for anything left
 *   5. render    — ARPAbet to eSpeak-style IPA: stress before the vowel,
 *                  flapped t, r-coloured vowels, unstressed function words
 *
 * How close this comes to eSpeak is measured by tools/g2p/compare.js.
 */

/** Every ARPAbet phone CMUdict uses, vowels with their stress. Order is the lexicon's encoding: never reorder. */
export const PHONES = [
  ...['AA', 'AE', 'AH', 'AO', 'AW', 'AY', 'EH', 'ER', 'EY', 'IH', 'IY', 'OW', 'OY', 'UH', 'UW'].flatMap((v) => [`${v}0`, `${v}1`, `${v}2`]),
  'B', 'CH', 'D', 'DH', 'F', 'G', 'HH', 'JH', 'K', 'L', 'M', 'N', 'NG', 'P', 'R', 'S', 'SH', 'T', 'TH', 'V', 'W', 'Y', 'Z', 'ZH',
];

// ─── 1. Normalise ──────────────────────────────────────────────────────────

const ONES = ['zero', 'one', 'two', 'three', 'four', 'five', 'six', 'seven', 'eight', 'nine', 'ten', 'eleven', 'twelve',
  'thirteen', 'fourteen', 'fifteen', 'sixteen', 'seventeen', 'eighteen', 'nineteen'];
const TENS = ['', '', 'twenty', 'thirty', 'forty', 'fifty', 'sixty', 'seventy', 'eighty', 'ninety'];
const SCALES = [[1e12, 'trillion'], [1e9, 'billion'], [1e6, 'million'], [1e3, 'thousand']];

/** @param {number} n a whole number, 0 ≤ n < 10¹⁵ */
export function numberWords(n) {
  if (n < 20) return ONES[n];
  if (n < 100) return TENS[Math.floor(n / 10)] + (n % 10 ? ` ${ONES[n % 10]}` : '');
  if (n < 1000) return `${ONES[Math.floor(n / 100)]} hundred${n % 100 ? ` ${numberWords(n % 100)}` : ''}`;
  for (const [size, name] of SCALES) {
    if (n >= size) {
      const rest = n % size;
      return `${numberWords(Math.floor(n / size))} ${name}${rest ? ` ${numberWords(rest)}` : ''}`;
    }
  }
  return String(n);
}

const ORDINAL = { one: 'first', two: 'second', three: 'third', five: 'fifth', eight: 'eighth', nine: 'ninth', twelve: 'twelfth' };
/** @param {number} n */
function ordinalWords(n) {
  const words = numberWords(n).split(' ');
  const last = words.pop() ?? '';
  const ord = ORDINAL[/** @type {keyof typeof ORDINAL} */ (last)]
    ?? (last.endsWith('y') ? `${last.slice(0, -1)}ieth` : `${last}th`);
  return [...words, ord].join(' ');
}

/** 1984 → nineteen eighty four; 2005 → two thousand five; 2026 → twenty twenty six. */
function yearWords(/** @type {number} */ y) {
  if (y >= 2000 && y < 2010) return numberWords(y);
  const hi = Math.floor(y / 100);
  const lo = y % 100;
  if (lo === 0) return `${numberWords(hi)} hundred`;
  return `${numberWords(hi)} ${lo < 10 ? `oh ${ONES[lo]}` : numberWords(lo)}`;
}

/** @param {string} digits */
const digitWords = (digits) => [...digits].map((d) => ONES[+d]).join(' ');

/** @param {string} whole @param {string} [frac] */
function decimalWords(whole, frac) {
  const w = numberWords(Number(whole.replace(/,/g, '') || '0'));
  return frac ? `${w} point ${digitWords(frac)}` : w;
}

const CURRENCY = { $: ['dollar', 'dollars', 'cent', 'cents'], '£': ['pound', 'pounds', 'penny', 'pence'], '€': ['euro', 'euros', 'cent', 'cents'] };

const ABBREVIATIONS = [
  [/\bDr\.(?=\s+[A-Z])/g, 'Doctor'], [/\bMr\./g, 'Mister'], [/\bMrs\./g, 'Missus'], [/\bMs\./g, 'Miz'],
  [/\bProf\.(?=\s+[A-Z])/g, 'Professor'], [/\bSt\.(?=\s+[A-Z])/g, 'Saint'], [/\bJr\./g, 'Junior'], [/\bSr\./g, 'Senior'],
  [/\bNo\.(?=\s*\d)/g, 'number'], [/\be\.g\./gi, 'for example'], [/\bi\.e\./gi, 'that is'], [/\betc\./gi, 'et cetera'],
  [/\bvs\.?(?=\s)/gi, 'versus'], [/\bapprox\./gi, 'approximately'], [/\bDept\./g, 'Department'],
];

/**
 * Written text to speakable words. Idempotent: normalising twice changes
 * nothing, so the streaming planner and the phonemiser can both call it.
 *
 * @param {string} text
 */
export function normalize(text) {
  let s = text.replace(/[‘’]/g, "'").replace(/[“”]/g, '"').replace(/…/g, '...');
  for (const [re, to] of ABBREVIATIONS) s = s.replace(re, /** @type {string} */ (to));
  s = s
    // Money: $1,250.50, £3, €20.
    .replace(/([$£€])\s?(\d[\d,]*)(?:\.(\d{1,2}))?(\s?(?:thousand|million|billion|trillion))?\b/g, (_, cur, whole, cents, scale) => {
      const [one, many, cOne, cMany] = CURRENCY[/** @type {keyof typeof CURRENCY} */ (cur)];
      const n = Number(whole.replace(/,/g, ''));
      if (scale) return `${numberWords(n)}${scale} ${many}`;
      let out = `${numberWords(n)} ${n === 1 ? one : many}`;
      const c = cents ? Number(cents.padEnd(2, '0')) : 0;
      if (c) out += ` and ${numberWords(c)} ${c === 1 ? cOne : cMany}`;
      return out;
    })
    // Times: 7:45, 7:05, 7:00, with am/pm.
    .replace(/\b(\d{1,2}):(\d{2})\s?([ap])\.?m\.?\b/gi, (_, h, m, ap) => `${timeWords(+h, +m)} ${ap.toLowerCase() === 'a' ? 'A M' : 'P M'}`)
    .replace(/\b(\d{1,2}):(\d{2})\b/g, (_, h, m) => timeWords(+h, +m))
    // Ordinals: 1st, 22nd, 3rd, 4th.
    .replace(/\b(\d+)(st|nd|rd|th)\b/gi, (_, n) => ordinalWords(Number(n)))
    // Percentages.
    .replace(/(\d[\d,]*(?:\.\d+)?)\s?%/g, (_, n) => `${n} percent`)
    // Ranges: 3-5 → three to five.
    .replace(/\b(\d+)\s?[-–]\s?(\d+)\b/g, '$1 to $2')
    // Years: four digits from 1100 to 2099, alone (plural 1990s too).
    .replace(/\b(1[1-9]\d\d|20\d\d)(s?)\b(?![.,]\d)/g, (_, y, plural) => {
      const w = yearWords(Number(y));
      return plural ? w.replace(/(\w+)$/, (x) => (x.endsWith('y') ? `${x.slice(0, -1)}ies` : `${x}s`)) : w;
    })
    // Other numbers, with thousands separators and decimals.
    .replace(/(-)?\b(\d[\d,]*)(?:\.(\d+))?\b/g, (_, minus, whole, frac) => `${minus ? 'minus ' : ''}${decimalWords(whole, frac)}`)
    .replace(/&/g, ' and ')
    .replace(/\+/g, ' plus ')
    .replace(/@/g, ' at ')
    .replace(/[ \t]+/g, ' ');
  return s;
}

/** @param {number} h @param {number} m */
function timeWords(h, m) {
  if (m === 0) return `${numberWords(h)} o'clock`;
  return `${numberWords(h)} ${m < 10 ? `oh ${ONES[m]}` : numberWords(m)}`;
}

// ─── 2. The lexicon ────────────────────────────────────────────────────────

/** @type {Map<string, string> | null} */
let lexicon = null;
/** @type {Promise<Map<string, string>> | null} */
let loading = null;

/** Read and decode data/lexicon.bin, once. Works in a browser, a worker, or Node. */
export function loadLexicon() {
  loading ??= (async () => {
    const url = new URL('./data/lexicon.bin', import.meta.url);
    /** @type {ReadableStream<Uint8Array>} */
    let body;
    if (url.protocol === 'file:') {
      const fs = await import(/* webpackIgnore: true */ 'node:fs/promises');
      body = new Response(await fs.readFile(url)).body ?? new ReadableStream();
    } else {
      const res = await fetch(url);
      if (!res.ok || !res.body) throw new Error(`lexicon: HTTP ${res.status}`);
      body = res.body;
    }
    const text = await new Response(body.pipeThrough(new DecompressionStream('gzip'))).text();
    const map = new Map();
    for (const line of text.split('\n')) {
      const sp = line.indexOf(' ');
      if (sp > 0) map.set(line.slice(0, sp), line.slice(sp + 1));
    }
    lexicon = map;
    return map;
  })();
  loading.catch(() => { loading = null; });
  return loading;
}

/** @param {string} encoded */
const decode = (encoded) => [...encoded].map((c) => PHONES[c.charCodeAt(0) - 33]);

/** @param {string} word lowercase */
function lookup(word) {
  const hit = lexicon?.get(word) ?? lexicon?.get(american(word) ?? '');
  return hit ? decode(hit) : null;
}

/**
 * The American spelling of a British one, for an American dictionary:
 * realise → realize, colour → color, centre → center, travelled → traveled.
 *
 * @param {string} w
 */
function american(w) {
  const us = w
    .replace(/is(e|ed|es|ing|ation|ations|er|ers|able)$/, 'iz$1')
    .replace(/isation/, 'ization')
    .replace(/our(s|ed|ing|ful|ite|ites|able)?$/, (m, tail) => (w.length > 5 ? `or${tail ?? ''}` : m))
    .replace(/([^aeiou])re(s|d)?$/, (m, c, tail) => (w.length > 4 ? `${c}er${tail ?? ''}` : m))
    .replace(/([aeiou])ll(ed|ing|er)$/, '$1l$2')
    .replace(/ogue$/, 'og');
  return us === w ? null : us;
}

// ─── 3. Derive from known words ────────────────────────────────────────────

const VOICELESS = new Set(['P', 'T', 'K', 'F', 'TH']);
const SIBILANT = new Set(['S', 'Z', 'SH', 'ZH', 'CH', 'JH']);

/** @param {string[]} p */
const last = (p) => p[p.length - 1] ?? '';

/** -s and 's after a stem, by how the stem ends. @param {string[]} stem */
function plural(stem) {
  const l = last(stem);
  if (SIBILANT.has(l)) return [...stem, 'IH0', 'Z'];
  if (VOICELESS.has(l)) return [...stem, 'S'];
  return [...stem, 'Z'];
}

/** -ed after a stem. @param {string[]} stem */
function past(stem) {
  const l = last(stem);
  if (l === 'T' || l === 'D') return [...stem, 'IH0', 'D'];
  if (VOICELESS.has(l) || l === 'S' || l === 'SH' || l === 'CH') return [...stem, 'T'];
  return [...stem, 'D'];
}

/** @param {string} word lowercase letters and apostrophes */
function derive(word) {
  /** @type {(w: string) => string[] | null} */
  const known = (w) => (w.length >= 2 ? lookup(w) : null);
  let m;
  if ((m = /^(.+)'s$/.exec(word))) { const s = known(m[1]) ?? guessWord(m[1]); return plural(s); }
  if ((m = /^(.+)s'$/.exec(word))) { const s = known(m[1]); if (s) return plural(s); }
  if ((m = /^(.+?)(e?s)$/.exec(word))) {
    const s = known(m[1]) ?? (m[2] === 'es' ? known(`${m[1]}e`) : null) ?? (word.endsWith('ies') ? known(`${word.slice(0, -3)}y`) : null);
    if (s) return word.endsWith('ies') && !known(m[1]) ? [...s.slice(0, -1), 'IY0', 'Z'] : plural(s);
  }
  if ((m = /^(.+?)(e?d)$/.exec(word))) {
    const s = known(m[1]) ?? known(`${m[1]}e`) ?? (/(.)\1$/.test(m[1]) ? known(m[1].slice(0, -1)) : null) ?? (word.endsWith('ied') ? known(`${word.slice(0, -3)}y`) : null);
    if (s) return word.endsWith('ied') && !known(m[1]) ? [...s.slice(0, -1), 'IY0', 'D'] : past(s);
  }
  if ((m = /^(.+?)ing$/.exec(word))) {
    const s = known(m[1]) ?? known(`${m[1]}e`) ?? (/(.)\1$/.test(m[1]) ? known(m[1].slice(0, -1)) : null);
    if (s) return [...s, 'IH0', 'NG'];
  }
  for (const [suffix, phones] of SUFFIXES) {
    if (word.length > suffix.length + 2 && word.endsWith(suffix)) {
      const stem = word.slice(0, -suffix.length);
      const s = known(stem) ?? known(`${stem}e`) ?? (stem.endsWith('i') ? known(`${stem.slice(0, -1)}y`) : null)
        ?? (/([^aeiou])\1$/.test(stem) ? known(stem.slice(0, -1)) : null);
      if (s) return [...(stem.endsWith('i') && !known(stem) ? [...s.slice(0, -1), 'IY0'] : s), ...phones];
    }
  }
  for (const [prefix, phones] of PREFIXES) {
    if (word.length > prefix.length + 2 && word.startsWith(prefix)) {
      const s = known(word.slice(prefix.length));
      if (s) return [...phones, ...s];
    }
  }
  // Compounds: two known words of three letters or more, at least seven in all.
  for (let i = word.length - 3; i >= 3; i--) {
    if (word.length < 7) break;
    const a = known(word.slice(0, i));
    const b = a && known(word.slice(i));
    if (a && b) return [...a, ...demote(b)];
  }
  return null;
}

/** The second half of a compound carries secondary stress. @param {string[]} p */
const demote = (p) => p.map((x) => x.replace(/1$/, '2'));

/** @type {[string, string[]][]} */
const SUFFIXES = [
  ['ness', ['N', 'AH0', 'S']], ['less', ['L', 'AH0', 'S']], ['ful', ['F', 'AH0', 'L']], ['ly', ['L', 'IY0']],
  ['ment', ['M', 'AH0', 'N', 'T']], ['er', ['ER0']], ['ers', ['ER0', 'Z']], ['able', ['AH0', 'B', 'AH0', 'L']],
  ['ish', ['IH0', 'SH']], ['ism', ['IH2', 'Z', 'AH0', 'M']], ['ist', ['IH0', 'S', 'T']], ['ize', ['AY2', 'Z']],
  ['ized', ['AY2', 'Z', 'D']], ['est', ['AH0', 'S', 'T']], ['ible', ['AH0', 'B', 'AH0', 'L']],
  ['ity', ['AH0', 'T', 'IY0']], ['ation', ['EY1', 'SH', 'AH0', 'N']], ['ations', ['EY1', 'SH', 'AH0', 'N', 'Z']],
  ['ally', ['AH0', 'L', 'IY0']], ['ise', ['AY2', 'Z']], ['ised', ['AY2', 'Z', 'D']], ['y', ['IY0']],
];
/** @type {[string, string[]][]} */
const PREFIXES = [
  ['un', ['AH0', 'N']], ['re', ['R', 'IY0']], ['pre', ['P', 'R', 'IY0']], ['non', ['N', 'AA1', 'N']],
  ['over', ['OW2', 'V', 'ER0']], ['under', ['AH2', 'N', 'D', 'ER0']], ['mis', ['M', 'IH0', 'S']], ['dis', ['D', 'IH0', 'S']],
  ['anti', ['AE2', 'N', 'T', 'IY0']], ['multi', ['M', 'AH2', 'L', 'T', 'IY0']], ['self', ['S', 'EH2', 'L', 'F']],
];

// ─── 4. Letter-to-sound rules ──────────────────────────────────────────────

/**
 * Longest match first. Vowels are unstressed here; stress goes on the first
 * syllable afterwards, the commonest English pattern.
 *
 * @type {[string, string[]][]}
 */
const RULES = [
  ['tion', ['SH', 'AH0', 'N']], ['sion', ['ZH', 'AH0', 'N']], ['ture', ['CH', 'ER0']], ['ough', ['AH0', 'F']],
  ['augh', ['AO0']], ['eigh', ['EY0']], ['igh', ['AY0']], ['tch', ['CH']], ['dge', ['JH']], ['que', ['K']],
  ['ph', ['F']], ['sh', ['SH']], ['ch', ['CH']], ['th', ['TH']], ['wh', ['W']], ['ck', ['K']], ['ng', ['NG']],
  ['qu', ['K', 'W']], ['gh', []], ['kn', ['N']], ['wr', ['R']], ['mb', ['M']],
  ['ee', ['IY0']], ['ea', ['IY0']], ['oo', ['UW0']], ['ai', ['EY0']], ['ay', ['EY0']], ['oi', ['OY0']], ['oy', ['OY0']],
  ['ou', ['AW0']], ['ow', ['OW0']], ['au', ['AO0']], ['aw', ['AO0']], ['ie', ['IY0']], ['ei', ['EY0']], ['ue', ['UW0']],
  ['ew', ['UW0']], ['oa', ['OW0']], ['ar', ['AA0', 'R']], ['or', ['AO0', 'R']], ['er', ['ER0']], ['ir', ['ER0']], ['ur', ['ER0']],
  ['a', ['AE0']], ['e', ['EH0']], ['i', ['IH0']], ['o', ['AA0']], ['u', ['AH0']], ['y', ['IY0']],
  ['b', ['B']], ['c', ['K']], ['d', ['D']], ['f', ['F']], ['g', ['G']], ['h', ['HH']], ['j', ['JH']], ['k', ['K']],
  ['l', ['L']], ['m', ['M']], ['n', ['N']], ['p', ['P']], ['r', ['R']], ['s', ['S']], ['t', ['T']], ['v', ['V']],
  ['w', ['W']], ['x', ['K', 'S']], ['z', ['Z']],
];
const LONG = { a: 'EY0', e: 'IY0', i: 'AY0', o: 'OW0', u: 'UW0' };
const isVowel = (/** @type {string} */ p) => /\d$/.test(p);

/** @param {string} word lowercase letters */
export function guessWord(word) {
  const w = word.replace(/[^a-z]/g, '');
  /** @type {string[]} */
  const out = [];
  for (let i = 0; i < w.length;) {
    // A silent final e lengthens the vowel before one consonant: "cade", "lune".
    if (i === w.length - 1 && w[i] === 'e' && out.length > 1) break;
    const ch = w[i];
    if ('aeiou'.includes(ch) && /^[^aeiou]e$/.test(w.slice(i + 1)) && w.length > 3) {
      out.push(LONG[/** @type {keyof typeof LONG} */ (ch)]);
      i++;
      continue;
    }
    // Soft c and g before e, i, y.
    if ((ch === 'c' || ch === 'g') && /[eiy]/.test(w[i + 1] ?? '')) {
      out.push(ch === 'c' ? 'S' : 'JH');
      i++;
      continue;
    }
    const rule = RULES.find(([g]) => w.startsWith(g, i));
    if (!rule) { i++; continue; }
    out.push(...rule[1]);
    i += rule[0].length;
  }
  // Word-final y after a consonant in a one-syllable word is "eye": "my", "fly".
  if (/^[^aeiouy]+y$/.test(w)) out[out.length - 1] = 'AY0';
  // A final o is long: "kokoro", "piano".
  if (/[^aeiou]o$/.test(w)) out[out.length - 1] = 'OW0';
  const first = out.findIndex(isVowel);
  if (first >= 0) out[first] = out[first].replace(/0$/, '1');
  return out.length ? out : ['AH0'];
}

const LETTERS = {
  a: 'EY1', b: 'B IY1', c: 'S IY1', d: 'D IY1', e: 'IY1', f: 'EH1 F', g: 'JH IY1', h: 'EY1 CH', i: 'AY1', j: 'JH EY1',
  k: 'K EY1', l: 'EH1 L', m: 'EH1 M', n: 'EH1 N', o: 'OW1', p: 'P IY1', q: 'K Y UW1', r: 'AA1 R', s: 'EH1 S', t: 'T IY1',
  u: 'Y UW1', v: 'V IY1', w: 'D AH1 B AH0 L Y UW0', x: 'EH1 K S', y: 'W AY1', z: 'Z IY1',
};
/** @param {string} word */
/** Letter by letter, the last letter stressed the way eSpeak says it: "A-P-I". @param {string} word */
function spell(word) {
  const letters = [...word.toLowerCase()].map((c) => (LETTERS[/** @type {keyof typeof LETTERS} */ (c)] ?? '').split(' ').filter(Boolean));
  return letters.flatMap((p, i) => (i < letters.length - 1 ? p.map((x) => x.replace(/1$/, '2')) : p));
}

/** Short words that are still words when written in capitals ("NO", "YES"). */
const CAPS_WORDS = new Set(`
  OK NO GO SO DO TO IN ON IT IS AT BE WE HE ME MY BY OF OR UP AN AS IF OH HI
  THE AND YOU ARE NOT NOW NEW YES HEY WOW ALL BIG TOP FOR BUT CAN GET HOW WHY WHO
  ONE TWO SIX TEN OUT OFF OUR HER HIS ITS WAS HAS HAD SHE MAN WAY DAY BAD GOOD
  RUN BUY TRY SEE SAY FUN HOT END ANY FEW OLD LOW FAR YET ASK
`.trim().split(/\s+/));

/**
 * One written word to ARPAbet.
 *
 * @param {string} raw as written, case kept (for acronyms)
 */
export function wordPhones(raw) {
  const word = raw.toLowerCase().replace(/^'+|'+$/g, (q) => (raw.endsWith("s'") ? q : ''));
  if (/^[a-z]{2,5}$/i.test(raw) && !/[aeiouy]/i.test(raw) && !lookup(word)) return spell(raw);
  // Two and three capitals are initialisms, spelled letter by letter, even when
  // the dictionary has a word of that spelling: "AI" is A-I, not "eye"; "US"
  // is U-S. Common words written in capitals for emphasis stay words.
  const caps = /^([A-Z]{2,3})(s?)$/.exec(raw);
  if (caps && !CAPS_WORDS.has(caps[1])) return caps[2] ? [...spell(caps[1]), 'Z'] : spell(caps[1]);
  // Longer capitals are words when the dictionary knows them ("NASA"), spelled when not.
  if (/^[A-Z]{2,5}s?$/.test(raw) && (!lookup(word) || !/[AEIOUY]/.test(raw))) {
    const s = raw.endsWith('s') && raw.length > 2 ? spell(raw.slice(0, -1)) : spell(raw);
    return raw.endsWith('s') && raw.length > 2 ? [...s, 'Z'] : s;
  }
  return lookup(word) ?? derive(word) ?? guessWord(word);
}

// ─── 5. ARPAbet to eSpeak-style IPA ────────────────────────────────────────

const VOWEL_IPA = {
  AA: 'ɑː', AE: 'æ', AO: 'ɔː', AW: 'aʊ', AY: 'aɪ', EH: 'ɛ', EY: 'eɪ', IH: 'ɪ', OW: 'oʊ', OY: 'ɔɪ', UH: 'ʊ', UW: 'uː',
};
const CONSONANT_IPA = {
  B: 'b', CH: 'tʃ', D: 'd', DH: 'ð', F: 'f', G: 'ɡ', HH: 'h', JH: 'dʒ', K: 'k', L: 'l', M: 'm', N: 'n', NG: 'ŋ', P: 'p',
  R: 'ɹ', S: 's', SH: 'ʃ', T: 't', TH: 'θ', V: 'v', W: 'w', Y: 'j', Z: 'z', ZH: 'ʒ',
};

/**
 * Words eSpeak says unstressed in running speech, in the form it uses.
 * Said alone they keep their dictionary stress.
 */
const WEAK = {
  the: 'ðə', a: 'ɐ', an: 'ɐn', and: 'ænd', of: 'ʌv', to: 'tə', in: 'ɪn', is: 'ɪz', it: 'ɪt', was: 'wʌz', for: 'fɔːɹ',
  on: 'ɔn', that: 'ðæt', with: 'wɪð', as: 'æz', at: 'æt', by: 'baɪ', be: 'biː', are: 'ɑːɹ', or: 'ɔːɹ', from: 'fɹʌm',
  but: 'bʌt', his: 'hɪz', her: 'hɜː', he: 'hiː', she: 'ʃiː', we: 'wiː', you: 'juː', they: 'ðeɪ', i: 'aɪ', me: 'miː',
  my: 'maɪ', your: 'jʊɹ', our: 'aʊɚ', their: 'ðɛɹ', them: 'ðɛm', us: 'ʌs', its: 'ɪts', has: 'hɐz', have: 'hæv',
  had: 'hæd', were: 'wɜː', been: 'bɪn', will: 'wɪl', would: 'wʊd', can: 'kæn', could: 'kʊd', do: 'duː', does: 'dʌz',
  so: 'soʊ', if: 'ɪf', than: 'ðɐn', then: 'ðɛn', there: 'ðɛɹ', this: 'ðɪs', these: 'ðiːz', those: 'ðoʊz', am: 'æm',
};

/**
 * ARPAbet to IPA the way eSpeak NG writes American English.
 *
 * @param {string[]} p
 */
export function toIpa(p) {
  let out = '';
  for (let i = 0; i < p.length; i++) {
    const ph = p[i];
    const prev = p[i - 1] ?? '';
    const next = p[i + 1] ?? '';
    const vowel = /^([A-Z]+)(\d)$/.exec(ph);
    if (vowel) {
      const [, v, stress] = vowel;
      const mark = stress === '1' ? 'ˈ' : stress === '2' ? 'ˌ' : '';
      let ipa;
      if (v === 'AH') ipa = stress === '0' ? (i === 0 && p.length > 2 ? 'ɐ' : 'ə') : 'ʌ';
      else if (v === 'ER') ipa = stress === '0' ? 'ɚ' : 'ɜː';
      else if (v === 'IY') ipa = next === 'R' ? 'ɪ' : stress === '0' ? 'i' : 'iː';
      else ipa = VOWEL_IPA[/** @type {keyof typeof VOWEL_IPA} */ (v)];
      out += mark + ipa;
      continue;
    }
    if (ph === 'T') {
      const afterVowel = isVowel(prev) || prev === 'R';
      // "button": t before a syllabic n is a glottal stop.
      if (afterVowel && next === 'AH0' && p[i + 2] === 'N' && i + 3 === p.length) {
        out += 'ʔn̩';
        i += 2;
        continue;
      }
      // Flapped between a vowel and an unstressed one: "better", "water", "party".
      if (afterVowel && /^[A-Z]+0$/.test(next)) {
        out += 'ɾ';
        continue;
      }
    }
    out += CONSONANT_IPA[/** @type {keyof typeof CONSONANT_IPA} */ (ph)] ?? '';
  }
  return out;
}

/** American IPA to the British forms eSpeak's "en" voice uses. @param {string} ipa */
function toBritish(ipa) {
  return ipa
    .replace(/oʊ/g, 'əʊ')
    .replace(/ɚ/g, 'ə')
    .replace(/ɾ/g, 't')
    .replace(/ɛɹ(?![aeiouæɑɔəɛɪʊʌ])/g, 'eə')
    .replace(/ɪɹ(?![aeiouæɑɔəɛɪʊʌ])/g, 'ɪə')
    .replace(/ʊɹ(?![aeiouæɑɔəɛɪʊʌ])/g, 'ʊə')
    // Non-rhotic: no r before a consonant.
    .replace(/ɹ(?=[^aeiouæɑɔəɛɪʊʌːˈˌ\s]|$)/g, (m, at, s) => (at === s.length - 1 ? m : ''));
}

/**
 * Text to eSpeak-style IPA, one space between words. Punctuation is not
 * spoken; callers that keep it (Piper keeps pauses) split it off first.
 * The lexicon must be loaded (`await loadLexicon()`); `phonemize` does that.
 *
 * @param {string} text already normalised
 * @param {{dialect?: 'us' | 'gb'}} [options]
 */
export function phonemizeSync(text, { dialect = 'us' } = {}) {
  const words = text.split(/[^A-Za-z0-9'\-]+/).flatMap((w) => w.split('-')).filter((w) => /[A-Za-z]/.test(w));
  const ipa = words.map((w) => {
    const lower = w.toLowerCase();
    // Weak forms are for words, not initialisms: "US" is not "us".
    const weak = words.length > 1 && !/^[A-Z]{2,}$/.test(w) ? WEAK[/** @type {keyof typeof WEAK} */ (lower)] : undefined;
    return weak ?? toIpa(wordPhones(w));
  }).join(' ');
  return dialect === 'gb' ? ipa.split(' ').map(toBritish).join(' ') : ipa;
}

/**
 * Text to eSpeak-style IPA, normalising and loading the lexicon as needed.
 *
 * @param {string} text
 * @param {{dialect?: 'us' | 'gb'}} [options]
 */
export async function phonemize(text, options) {
  if (!lexicon) await loadLexicon();
  return phonemizeSync(normalize(text), options);
}

/** Punctuation Kokoro reads as prosody; kept as written, never phonemised. */
const KOKORO_PUNCT = /([;:,.!?¡¿—…"«»“”(){}[\]]+)/;

/**
 * Text to the phoneme string Kokoro was trained on: eSpeak-style IPA from
 * Cadence's own front end, punctuation kept, the same clean-ups kokoro-js
 * applies to eSpeak's output.
 *
 * @param {string} text
 * @param {'a' | 'b'} lang  American or British
 */
export function kokoroPhonemes(text, lang) {
  const dialect = lang === 'b' ? 'gb' : 'us';
  let out = normalize(text).split(KOKORO_PUNCT).map((part) => (KOKORO_PUNCT.test(part) ? part : ` ${phonemizeSync(part, { dialect })} `)).join('');
  out = out.replace(/ +/g, ' ').replace(/ ([;:,.!?…])/g, '$1').replace(/r/g, 'ɹ').trim();
  return lang === 'a' ? out.replace(/(?<=nˈaɪn)ti(?!ː)/g, 'di') : out;
}
