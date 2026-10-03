/**
 * The stub backend.
 *
 * A small formant synthesiser standing in for the neural model until the real
 * kernels exist. It does not produce words — it produces the *shape* of speech:
 * syllables, pitch contour, pauses at punctuation, a voice that is recognisably
 * higher or lower, brighter or breathier. That is enough to build and judge
 * every piece of the product around it: streaming, the player, the waveform,
 * history, the picker. When the real backend lands, it replaces this file and
 * nothing above the engine interface changes.
 */

export const SAMPLE_RATE = 24000;

/** Vowel formants F1, F2, F3 in Hz (adult male reference). */
const VOWELS = {
  a: [730, 1090, 2440],
  e: [530, 1840, 2480],
  i: [270, 2290, 3010],
  o: [570, 840, 2410],
  u: [300, 870, 2240],
  y: [300, 2100, 2800],
};
const NASAL = [280, 1300, 2500];
const FRICATIVES = new Set(['s', 'z', 'f', 'v', 'h', 'c', 'x', 'j']);
const PLOSIVES = new Set(['p', 'b', 't', 'd', 'k', 'g', 'q']);

/**
 * @typedef {object} Segment
 * @property {'voiced' | 'noise' | 'silence'} kind
 * @property {number} dur      seconds
 * @property {number[]} [f]     formant targets
 * @property {number} [amp]
 * @property {number} [hiss]   noise centre frequency
 */

/**
 * Text to a flat list of segments. A letter-level caricature of G2P — the real
 * front end (M1) replaces it with normalisation and phonemes.
 *
 * @param {string} text
 * @param {number} rate
 * @returns {{segments: Segment[], phrases: number[]}}
 */
function segment(text, rate) {
  /** @type {Segment[]} */
  const out = [];
  /** @type {number[]} */
  const phrases = [0];
  const k = 1 / rate;

  for (const token of text.toLowerCase().match(/[a-z']+|[.!?]+|[,;:—-]+|\d+/g) ?? []) {
    if (/^[.!?]/.test(token)) {
      out.push({ kind: 'silence', dur: 0.38 * k });
      phrases.push(out.length);
      continue;
    }
    if (/^[,;:—-]/.test(token)) {
      out.push({ kind: 'silence', dur: 0.2 * k });
      continue;
    }
    const word = /^\d+$/.test(token) ? 'numa'.repeat(Math.min(token.length, 4)) : token;
    for (const ch of word) {
      const v = VOWELS[/** @type {keyof typeof VOWELS} */ (ch)];
      if (v) out.push({ kind: 'voiced', dur: 0.095 * k, f: v, amp: 1 });
      else if (FRICATIVES.has(ch)) out.push({ kind: 'noise', dur: 0.07 * k, amp: 0.22, hiss: ch === 's' || ch === 'z' || ch === 'c' ? 5200 : 2600 });
      else if (PLOSIVES.has(ch)) {
        out.push({ kind: 'silence', dur: 0.028 * k });
        out.push({ kind: 'noise', dur: 0.018 * k, amp: 0.3, hiss: 1800 });
      } else if (ch !== "'") out.push({ kind: 'voiced', dur: 0.055 * k, f: NASAL, amp: 0.45 });
    }
    out.push({ kind: 'silence', dur: 0.045 * k });
  }
  return { segments: out, phrases };
}

/**
 * @param {string} text
 * @param {{pitch: number, brightness: number, breath: number, pace: number}} voice
 * @param {{speed?: number, stability?: number, style?: number}} [settings]
 * @param {number} [seed]
 * @returns {Float32Array}
 */
export function render(text, voice, settings = {}, seed = 1) {
  const speed = settings.speed ?? 1;
  const stability = settings.stability ?? 0.5;
  const style = settings.style ?? 0;
  const rate = speed * voice.pace;
  const { segments } = segment(text, rate);

  const total = segments.reduce((s, x) => s + x.dur, 0) + 0.15;
  const n = Math.ceil(total * SAMPLE_RATE);
  const out = new Float32Array(n);

  let noiseState = seed * 2654435761 >>> 0;
  const noise = () => {
    noiseState ^= noiseState << 13; noiseState >>>= 0;
    noiseState ^= noiseState >>> 17;
    noiseState ^= noiseState << 5; noiseState >>>= 0;
    return noiseState / 2147483648 - 1;
  };

  // Resonator state for three formants plus one noise band.
  const y1 = [0, 0, 0, 0];
  const y2 = [0, 0, 0, 0];
  const cur = [500, 1500, 2500];
  const bw = [80, 110, 160];
  const gains = [1, 0.55, 0.28];
  let amp = 0;
  let voicedMix = 0;
  let hissF = 3000;
  let phase = 0;

  const jitter = (1 - stability) * 0.06;
  const swing = 0.08 + style * 0.22;
  let drift = 0;

  let pos = 0;
  let t = 0;
  for (const seg of segments) {
    const len = Math.round(seg.dur * SAMPLE_RATE);
    const targetF = seg.f ? seg.f.map((f) => f * voice.brightness) : cur;
    const targetAmp = seg.kind === 'silence' ? 0 : seg.amp ?? 1;
    const targetVoiced = seg.kind === 'voiced' ? 1 : 0;
    if (seg.hiss) hissF = seg.hiss;
    if (seg.kind === 'voiced' && noise() > 0.4) drift += (noise() * jitter);

    for (let j = 0; j < len && pos < n; j++, pos++) {
      t = pos / SAMPLE_RATE;
      // Glide toward targets — coarticulation, crudely.
      for (let q = 0; q < 3; q++) cur[q] += (targetF[q] - cur[q]) * 0.0022;
      amp += (targetAmp - amp) * 0.004;
      voicedMix += (targetVoiced - voicedMix) * 0.004;

      // Declination across the utterance plus a slow intonation wave.
      const contour = 1 + swing * Math.sin(t * 2.1 + seed) * 0.5 - 0.05 * Math.min(t / total, 1) + drift;
      const f0 = voice.pitch * contour * (1 + 0.004 * Math.sin(t * 34));
      phase += f0 / SAMPLE_RATE;
      if (phase >= 1) phase -= 1;

      // Glottal source: a soft sawtooth, rolled off.
      const glottal = (1 - 2 * phase) * 0.6 + voice.breath * noise() * 0.35;
      const src = glottal * voicedMix;
      const hiss = noise() * (1 - voicedMix);

      let v = 0;
      for (let q = 0; q < 3; q++) {
        const r = Math.exp(-Math.PI * bw[q] / SAMPLE_RATE);
        const c = 2 * r * Math.cos((2 * Math.PI * cur[q]) / SAMPLE_RATE);
        const y = (1 - r) * src + c * y1[q] - r * r * y2[q];
        y2[q] = y1[q];
        y1[q] = y;
        v += y * gains[q];
      }
      const rh = Math.exp(-Math.PI * 900 / SAMPLE_RATE);
      const ch = 2 * rh * Math.cos((2 * Math.PI * hissF) / SAMPLE_RATE);
      const yh = (1 - rh) * hiss + ch * y1[3] - rh * rh * y2[3];
      y2[3] = y1[3];
      y1[3] = yh;

      out[pos] = (v * 3.2 + yh * 1.6) * amp;
    }
  }

  // Normalise and soften the edges.
  let peak = 0;
  for (let i = 0; i < n; i++) peak = Math.max(peak, Math.abs(out[i]));
  const g = peak > 0 ? 0.82 / peak : 0;
  const fade = Math.min(480, n >> 2);
  for (let i = 0; i < n; i++) {
    let e = 1;
    if (i < fade) e = i / fade;
    else if (i > n - fade) e = (n - i) / fade;
    out[i] *= g * e;
  }
  return out;
}

/**
 * Mean pitch of a recording, by autocorrelation over its loudest frames.
 * Real enough to make a "cloned" stub voice sit where the speaker does.
 *
 * @param {Float32Array} samples
 * @param {number} sampleRate
 * @returns {number} Hz, or 0 when nothing voiced was found
 */
export function estimatePitch(samples, sampleRate) {
  const frame = Math.round(sampleRate * 0.04);
  const minLag = Math.floor(sampleRate / 400);
  const maxLag = Math.floor(sampleRate / 70);
  /** @type {{energy: number, start: number}[]} */
  const frames = [];
  for (let s = 0; s + frame + maxLag < samples.length; s += frame) {
    let e = 0;
    for (let i = 0; i < frame; i++) e += samples[s + i] ** 2;
    frames.push({ energy: e, start: s });
  }
  frames.sort((a, b) => b.energy - a.energy);
  const found = [];
  for (const { start } of frames.slice(0, 40)) {
    let best = 0;
    let bestLag = 0;
    for (let lag = minLag; lag <= maxLag; lag++) {
      let c = 0;
      let e = 0;
      for (let i = 0; i < frame; i++) {
        c += samples[start + i] * samples[start + i + lag];
        e += samples[start + i + lag] ** 2;
      }
      const score = e > 0 ? c / Math.sqrt(e) : 0;
      if (score > best) { best = score; bestLag = lag; }
    }
    if (bestLag) found.push(sampleRate / bestLag);
  }
  if (!found.length) return 0;
  found.sort((a, b) => a - b);
  return Math.round(found[found.length >> 1]);
}
