/**
 * Text to phonemes for English: Cadence's own front end.
 *
 * Both models were trained on eSpeak NG's IPA. eSpeak is GPL-3.0, which would
 * pull every app that ships Cadence under the GPL; this produces the same kind
 * of IPA from permissively licensed parts instead:
 *
 *   1. normalise — numbers, money, times, dates, fractions, units, web
 *                  addresses, abbreviations to words; then words spelled the
 *                  same but said differently ("read", "live", "record") are
 *                  tagged with the sense their sentence gives them
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
  [/\bNo\.(?=\s*\d)/g, 'number'], [/\be\.g\./gi, 'for example'], [/\bi\.e\./gi, 'that is'],
  // Ending a sentence, "etc." is also its full stop.
  [/\betc\.(?=\s*$|\s+[A-Z"“])/g, 'et cetera.'], [/\betc\./gi, 'et cetera'],
  [/\bvs\.?(?=\s)/gi, 'versus'], [/\bapprox\./gi, 'approximately'], [/\bDept\./g, 'Department'],
];

/** Words written in mixed case or with symbols, as they are said. */
const SPOKEN = [
  // One word each, said as in FIXES below.
  [/\biOS\b/g, 'ios'], [/\bmacOS\b/g, 'macos'], [/\biPhone(s?)\b/g, 'iphone$1'], [/\biPad(s?)\b/g, 'ipad$1'],
  [/\biPod(s?)\b/g, 'ipod$1'], [/\biMac(s?)\b/g, 'imac$1'], [/\bWi-?Fi\b/gi, 'wifi'], [/\bOpenAI\b/g, 'open AI'],
  [/\bChatGPT\b/g, 'chat GPT'], [/\bGitHub\b/g, 'github'], [/\bYouTube\b/g, 'youtube'], [/\bLinkedIn\b/g, 'linkedin'],
];

/** How the end of a web address is said: words where people say a word, letters where they spell. */
const TLD = { com: 'com', org: 'org', net: 'net', gov: 'gov', app: 'app', dev: 'dev', info: 'info', co: 'co', me: 'me', so: 'so', biz: 'biz', xyz: 'X Y Z' };
const WEB = /\b((?:[A-Za-z0-9-]+\.)+)(com|org|net|io|ai|dev|app|co|uk|us|edu|gov|me|tv|ly|so|xyz|info|biz|pk|in|de|fr|ca|au)\b(?![.\w-]*\w)/gi;

const MONTHS = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'];

/** 1/2 → one half, 3/4 → three quarters, 5/8 → five eighths, 4/5 → four out of five. @param {number} n @param {number} d */
function fractionWords(n, d) {
  const name = d === 2 ? ['half', 'halves'] : d === 4 ? ['quarter', 'quarters'] : null;
  if (name) return `${numberWords(n)} ${name[n === 1 ? 0 : 1]}`;
  if (d === 5 || d === 10 || d === 100) return `${numberWords(n)} out of ${numberWords(d)}`;
  if (d <= 16) {
    const o = ordinalWords(d);
    return `${numberWords(n)} ${n === 1 ? o : `${o}s`}`;
  }
  return `${numberWords(n)} slash ${numberWords(d)}`;
}

/**
 * Written text to speakable words. Idempotent: normalising twice changes
 * nothing, so the streaming planner and the phonemiser can both call it.
 *
 * @param {string} text
 */
export function normalize(text) {
  let s = text.replace(/[‘’]/g, "'").replace(/[“”]/g, '"').replace(/…/g, '...');
  for (const [re, to] of SPOKEN) s = s.replace(re, /** @type {string} */ (to));
  // Web addresses: "https://www.cadence.ai" → "W W W dot cadence dot AI".
  s = s.replace(/\bhttps?:\/\//gi, '').replace(/\bwww\./gi, 'W W W dot ')
    .replace(WEB, (_, name, tld) => {
      const lower = tld.toLowerCase();
      return `${name.split('.').filter(Boolean).join(' dot ')} dot ${TLD[/** @type {keyof typeof TLD} */ (lower)] ?? lower.toUpperCase()}`;
    });
  for (const [re, to] of ABBREVIATIONS) s = s.replace(re, /** @type {string} */ (to));
  s = s
    // Dates, month first as Americans write them (day first when it must be): 03/04/2025.
    .replace(/\b(\d{1,2})\/(\d{1,2})\/(\d{4}|\d{2})\b/g, (whole, a, b, y) => {
      let [m, d] = [Number(a), Number(b)];
      if (m > 12 && d <= 12) [m, d] = [d, m];
      if (m < 1 || m > 12 || d < 1 || d > 31) return whole;
      return `${MONTHS[m - 1]} ${ordinalWords(d)}, ${y.length === 2 ? numberWords(Number(y)) : y}`;
    })
    .replace(/\b24\/7\b/g, 'twenty four seven')
    // Fractions: 1/2, 3/4, 5/8.
    .replace(/\b(\d{1,3})\/(\d{1,3})\b/g, (_, n, d) => (Number(d) > 1 ? fractionWords(Number(n), Number(d)) : `${n} slash ${d}`))
    // Temperatures and angles: 38°C, 100 °F, 90°.
    .replace(/(-?\d+(?:\.\d+)?)\s?°\s?([CF])\b/g, (_, n, u) => `${n} ${n === '1' ? 'degree' : 'degrees'} ${u === 'C' ? 'Celsius' : 'Fahrenheit'}`)
    .replace(/(\d)\s?°/g, '$1 degrees')
    // "10x faster" → ten times; Q3, MP3, 4K, 5G, 3D → letters and numbers apart.
    .replace(/\b(\d+(?:\.\d+)?)x\b/gi, '$1 times')
    .replace(/\b([A-Z]{1,3})(\d+)\b/g, '$1 $2')
    .replace(/\b(\d+)([KGD])\b/g, '$1 $2')
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
    .replace(/\b(\d{1,2}):(\d{2})\s?([ap])\.?m\.?\b/gi, (_, h, m, ap) => `${timeWords(+h, +m)} ${ap.toLowerCase() === 'a' ? 'AM' : 'PM'}`)
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
    // Other numbers, with thousands separators and decimals. A hyphen is a
    // minus sign only when no word comes before it: "COVID-19" is not minus.
    .replace(/(?:(?<!\w)(-))?\b(\d[\d,]*)(?:\.(\d+))?\b/g, (_, minus, whole, frac) => `${minus ? 'minus ' : ''}${decimalWords(whole, frac)}`)
    .replace(/&/g, ' and ')
    .replace(/\+/g, ' plus ')
    .replace(/@/g, ' at ')
    .replace(/[ \t]+/g, ' ');
  return senses(s);
}

// ─── Words spelled alike, said differently ─────────────────────────────────

/** Each sense as ARPAbet. A sense tag is written after the word: "read_past". */
const SENSES = {
  read: { present: 'R IY1 D', past: 'R EH1 D' },
  live: { verb: 'L IH1 V', adj: 'L AY1 V' },
  lives: { verb: 'L IH1 V Z', noun: 'L AY1 V Z' },
  wind: { noun: 'W IH1 N D', verb: 'W AY1 N D' },
  lead: { verb: 'L IY1 D', metal: 'L EH1 D' },
  tear: { noun: 'T IH1 R', verb: 'T EH1 R' },
  tears: { noun: 'T IH1 R Z', verb: 'T EH1 R Z' },
  close: { verb: 'K L OW1 Z', adj: 'K L OW1 S' },
  use: { verb: 'Y UW1 Z', noun: 'Y UW1 S' },
  wound: { noun: 'W UW1 N D', past: 'W AW1 N D' },
  record: { noun: 'R EH1 K ER0 D', verb: 'R IH0 K AO1 R D' },
  records: { noun: 'R EH1 K ER0 D Z', verb: 'R IH0 K AO1 R D Z' },
  present: { noun: 'P R EH1 Z AH0 N T', verb: 'P R IY0 Z EH1 N T' },
  presents: { noun: 'P R EH1 Z AH0 N T S', verb: 'P R IY0 Z EH1 N T S' },
  object: { noun: 'AA1 B JH EH0 K T', verb: 'AH0 B JH EH1 K T' },
  project: { noun: 'P R AA1 JH EH0 K T', verb: 'P R AH0 JH EH1 K T' },
  projects: { noun: 'P R AA1 JH EH0 K T S', verb: 'P R AH0 JH EH1 K T S' },
  permit: { noun: 'P ER1 M IH0 T', verb: 'P ER0 M IH1 T' },
  increase: { noun: 'IH1 N K R IY2 S', verb: 'IH0 N K R IY1 S' },
  decrease: { noun: 'D IY1 K R IY2 S', verb: 'D IH0 K R IY1 S' },
  produce: { noun: 'P R OW1 D UW0 S', verb: 'P R AH0 D UW1 S' },
  progress: { noun: 'P R AA1 G R EH2 S', verb: 'P R AH0 G R EH1 S' },
  refuse: { noun: 'R EH1 F Y UW2 S', verb: 'R AH0 F Y UW1 Z' },
  conduct: { noun: 'K AA1 N D AH0 K T', verb: 'K AH0 N D AH1 K T' },
  contract: { noun: 'K AA1 N T R AE2 K T', verb: 'K AH0 N T R AE1 K T' },
  suspect: { noun: 'S AH1 S P EH2 K T', verb: 'S AH0 S P EH1 K T' },
  conflict: { noun: 'K AA1 N F L IH0 K T', verb: 'K AH0 N F L IH1 K T' },
  convict: { noun: 'K AA1 N V IH0 K T', verb: 'K AH0 N V IH1 K T' },
  export: { noun: 'EH1 K S P AO0 R T', verb: 'IH0 K S P AO1 R T' },
  import: { noun: 'IH1 M P AO0 R T', verb: 'IH0 M P AO1 R T' },
  insult: { noun: 'IH1 N S AH0 L T', verb: 'IH0 N S AH1 L T' },
  protest: { noun: 'P R OW1 T EH2 S T', verb: 'P R AH0 T EH1 S T' },
  rebel: { noun: 'R EH1 B AH0 L', verb: 'R IH0 B EH1 L' },
  subject: { noun: 'S AH1 B JH IH0 K T', verb: 'S AH0 B JH EH1 K T' },
  desert: { noun: 'D EH1 Z ER0 T', verb: 'D IH0 Z ER1 T' },
};

const set = (/** @type {string} */ s) => new Set(s.trim().split(/\s+/));
/** Words that come before a noun. */
const DET = set(`a an the this that these those my your his her its our their no every each any some another
  one two three four five six seven eight nine ten many few several first last next new old big small good great
  best whole such what which whose`);
/** Words that come before a verb in its plain form. */
const TO_VERB = set(`to will would can could should shall must might may please let's lets don't doesn't didn't
  won't can't cannot couldn't wouldn't shouldn't never i you we they`);
const BE = set(`is was are were be been being am it's that's he's she's we're you're they're i'm there's`);
const PAST_WORDS = set('yesterday ago last earlier previously once');
const PRESENT_AUX = set(`to will would can could should shall must might may do does don't doesn't didn't please
  let's lets can't won't cannot couldn't wouldn't shouldn't i'll you'll we'll they'll he'll she'll`);
const NOT_PAST = set('need needed feed speed seed bed red indeed hundred bred shed sled shred weed breed greed proceed exceed succeed');
const LIVE_NOUNS = set(`music show shows stream streams streaming broadcast broadcasts event events concert concerts
  audience performance performances wire feed updates coverage action bait animals recording version demo chat video
  session sessions tv television radio sports match game data site mode wires ammunition`);
const METAL_NEXT = set('pipe pipes paint poisoning pencil pencils bullet bullets weight weights shot levels exposure');
const CLOSE_ADJ_NEXT = set(`to by call friend friends enough together behind relationship attention contact look eye
  second family race`);
const CLOSE_ADJ_PREV = set(`so too very quite really pretty is was are were be been get getting got stay stayed came
  come comes coming it's that's how as a`);
const OBJECT_NEXT = set('up down the a an it your my his her them this that back around through our their');

/**
 * The sense of a word in SENSES, from the words around it in its sentence.
 * Only a confident reading is tagged; otherwise the dictionary's own
 * pronunciation stands.
 *
 * @param {string[]} w the sentence's words, lowercase
 * @param {number} i
 * @returns {string | undefined}
 */
function sense(w, i) {
  const word = w[i];
  const prev = w[i - 1] ?? '';
  const prev2 = w[i - 2] ?? '';
  const next = w[i + 1] ?? '';
  const verbCue = TO_VERB.has(prev) || /'ll$|n't$/.test(prev);
  const start = i === 0 || prev === 'and' || prev === 'then';
  switch (word) {
    case 'read': {
      if (PRESENT_AUX.has(prev)) return 'present';
      if (BE.has(prev) || /^(had|has|have|already|just|i've|you've|we've|they've|i'd|you'd|he'd|she'd|we'd|they'd)$/.test(prev)) return 'past';
      // "Have you read it?": a perfect tense a word or two back.
      if (w.slice(Math.max(0, i - 3), i).some((x) => /^(have|has|had|haven't|hasn't|hadn't)$/.test(x))) return 'past';
      // "He read", not "he reads": the plain form after he, she or it is the past.
      if (/^(he|she|it)$/.test(prev)) return 'past';
      if (w.some((x) => PAST_WORDS.has(x))) return 'past';
      // A story told in the past: another verb in the sentence ends in -ed.
      if (w.some((x, k) => k !== i && /^[a-z]{3,}ed$/.test(x) && !NOT_PAST.has(x))) return 'past';
      return undefined;
    }
    case 'live':
      if (BE.has(prev) || /^(a|an|the|go|goes|going|went|gone|now)$/.test(prev)) return 'adj';
      if (LIVE_NOUNS.has(next) && !verbCue) return 'adj';
      return undefined;
    case 'lives':
      if (DET.has(prev) || /^(save|saves|saved|saving|lost|changed|change|changes|millions|thousands|of|real|daily|private|personal|busy|whose)$/.test(prev)) return 'noun';
      return 'verb';
    case 'wind':
      if (verbCue || (start && OBJECT_NEXT.has(next)) || ((next === 'up' || next === 'down') && !DET.has(prev))) return 'verb';
      return 'noun';
    case 'lead':
      if (METAL_NEXT.has(next) || (prev === 'of' && /^(made|full|piece|block|sheet|ton|tons)$/.test(prev2))) return 'metal';
      return undefined;
    case 'tear':
    case 'tears':
      if (prev === 'and' && prev2 === 'wear') return 'verb';
      if (verbCue || /^(he|she|it)$/.test(prev) || /^(up|down|apart|off|open|into|through|out|away)$/.test(next)) return 'verb';
      return 'noun';
    case 'close':
      if (CLOSE_ADJ_NEXT.has(next) || CLOSE_ADJ_PREV.has(prev)) return 'adj';
      return undefined;
    case 'use':
      if (DET.has(prev) || /^(of|in|for|much|make|makes|made|making|fair|daily|personal|commercial|what's)$/.test(prev)) return 'noun';
      return undefined;
    case 'wound':
      if (/^(i|he|she|we|they|you|it|was|were|had|has|have|then|and)$/.test(prev) && /^(up|down|the|it|around|through|his|her|its|their|my|your|back|tightly)$/.test(next)) return 'past';
      return 'noun';
    default:
      // Noun or verb, by stress: a REcord, to reCORD. "A sharp increase": a
      // describing word between the two (but "the prices increase" is a verb).
      if (DET.has(prev) || (DET.has(prev2) && !TO_VERB.has(prev) && !BE.has(prev) && !/s$/.test(prev))) return 'noun';
      if (verbCue || /^(he|she|it|who)$/.test(prev) || (start && OBJECT_NEXT.has(next))) return 'verb';
      return undefined;
  }
}

/** Tag every word in SENSES with its sense, sentence by sentence. @param {string} s */
function senses(s) {
  return s.replace(/[^.!?]+[.!?]*/g, (sentence) => {
    const found = [...sentence.matchAll(/[A-Za-z][A-Za-z']*(?:_[a-z]+)?/g)];
    const words = found.map((m) => m[0].toLowerCase());
    let out = '';
    let at = 0;
    found.forEach((m, i) => {
      if (!Object.hasOwn(SENSES, words[i])) return;
      const tag = sense(words, i);
      if (!tag) return;
      out += `${sentence.slice(at, /** @type {number} */ (m.index))}${m[0]}_${tag}`;
      at = /** @type {number} */ (m.index) + m[0].length;
    });
    return out + sentence.slice(at);
  });
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

/** Entries CMUdict gets wrong for running speech, and words it lacks. */
const FIXES = {
  thirty: 'TH ER1 T IY0',
  wifi: 'W AY1 F AY2', iphone: 'AY1 F OW2 N', ipad: 'AY1 P AE2 D', ipod: 'AY1 P AA2 D', imac: 'AY1 M AE2 K',
  ios: 'AY2 OW2 EH1 S', macos: 'M AE1 K OW2 EH2 S', github: 'G IH1 T HH AH2 B', youtube: 'Y UW1 T UW2 B',
  linkedin: 'L IH1 NG K T IH2 N',
};

/** @param {string} word lowercase */
function lookup(word) {
  const fix = FIXES[/** @type {keyof typeof FIXES} */ (word)];
  if (fix) return fix.split(' ');
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
  // A sense tag from normalising: "read_past".
  const tagged = /^([A-Za-z']+)_([a-z]+)$/.exec(raw);
  if (tagged) {
    const key = tagged[1].toLowerCase();
    const forms = Object.hasOwn(SENSES, key) ? SENSES[/** @type {keyof typeof SENSES} */ (key)] : undefined;
    const form = forms?.[/** @type {keyof typeof forms} */ (tagged[2])];
    if (form) return /** @type {string} */ (form).split(' ');
    raw = tagged[1];
  }
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
  const words = text.split(/[^A-Za-z0-9'_\-]+/).flatMap((w) => w.split('-')).filter((w) => /[A-Za-z]/.test(w));
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
