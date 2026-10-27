/**
 * The Cadence promo film: sixteen scenes timed to Cadence's own narration.
 *
 * Every scene starts when its voice line starts (minus a lead-in) and lasts
 * as long as the line plus a breath. Reveals inside a scene land on the word
 * they illustrate: a phrase's moment is estimated from where it falls in the
 * line, which for steady narration is within a syllable or two.
 *
 * Sound: the narration (Cadence HD, voice Heart), a quiet synthesized music
 * bed that ducks under the voice, and soft transitions — all mixed in one
 * AudioContext, which is also what the recorder records.
 */

const EASE = 'cubic-bezier(0.22, 0.8, 0.24, 1)';
const SPRING = 'cubic-bezier(0.34, 1.4, 0.5, 1)';
const LEAD = 0.45; // seconds of picture before the voice in each scene
const XFADE = 0.55;

// ?export: the film runs on a clock the exporter steps frame by frame, with
// every animation held at exactly that instant: no dropped frames, however
// heavy a scene is to paint.
const EXPORT = new URLSearchParams(location.search).has('export');
// ?reel: the vertical cut, 1080 × 1920, for TikTok, Reels and Shorts.
const REEL = new URLSearchParams(location.search).has('reel');
const ASSETS = REEL ? '/video/assets-reel/' : '/video/assets/';
if (REEL) document.documentElement.classList.add('reel');
// The words the click and the closing beat land on.
const CLICK_PHRASE = REEL ? 'tap generate' : 'press generate';
const CTA_PHRASE = REEL ? 'Try Cadence' : 'Start building';
let clockT = 0; // film time, in export mode
let creating = 0; // the film time new animations count from, in export mode
const born = new WeakMap();
/** @type {[number, () => void][]} */
const pending = [];
if (EXPORT) {
  const animate = Element.prototype.animate;
  Element.prototype.animate = function (...args) {
    const a = animate.apply(this, args);
    a.pause();
    born.set(a, creating);
    return a;
  };
}
/** Run `fn` `sec` seconds from now, on whichever clock drives the film. */
function later(sec, fn) {
  if (EXPORT) pending.push([creating + sec, fn]);
  else setTimeout(fn, sec * 1000);
}

// ─── Icons (the playground's line style) ─────────────────────────────────
const P = {
  dollar: '<path d="M12 2v20M17 5.5H9.5a3.5 3.5 0 0 0 0 7h5a3.5 3.5 0 0 1 0 7H6"/>',
  upload: '<path d="M16 16l-4-4-4 4M12 12v9"/><path d="M20.4 18.6A5 5 0 0 0 18 9h-1.3A8 8 0 1 0 3 16.3"/>',
  wifiOff: '<path d="M2 2l20 20M8.5 16.5a5 5 0 0 1 7 0M5 12.9a10 10 0 0 1 5.2-2.8M19 12.9a10 10 0 0 0-2.3-1.7M2 8.8a15 15 0 0 1 4.2-2.7M22 8.8A15 15 0 0 0 11 4.6M12 20h.01"/>',
  wifi: '<path d="M5 12.6a10 10 0 0 1 14 0M8.5 16.1a5 5 0 0 1 7 0M2 8.8a15 15 0 0 1 20 0M12 20h.01"/>',
  lock: '<rect x="4" y="11" width="16" height="10" rx="2.5"/><path d="M8 11V7a4 4 0 0 1 8 0v4"/>',
  zap: '<path d="M13 2 4 14h7l-1 8 9-12h-7l1-8z"/>',
  noBill: '<path d="M5 3h14v18l-3-2-2 2-2-2-2 2-2-2-3 2V3z"/><path d="M9 8h6M9 12h4"/><path d="M3 3l18 18"/>',
  check: '<path d="M20 6 9 17l-5-5"/>',
  x: '<path d="M18 6 6 18M6 6l12 12"/>',
  shield: '<path d="M12 22s8-3.5 8-10V5l-8-3-8 3v7c0 6.5 8 10 8 10z"/><path d="m9 12 2 2 4-4"/>',
  cpu: '<rect x="6" y="6" width="12" height="12" rx="2"/><path d="M9 2v3M15 2v3M9 19v3M15 19v3M2 9h3M2 15h3M19 9h3M19 15h3"/>',
  globe: '<circle cx="12" cy="12" r="9"/><path d="M3 12h18M12 3a14 14 0 0 1 0 18M12 3a14 14 0 0 0 0 18"/>',
  terminal: '<path d="m5 8 4 4-4 4M12 16h7"/>',
  heart: '<path d="M20.8 4.6a5.5 5.5 0 0 0-7.8 0L12 5.7l-1-1.1a5.5 5.5 0 0 0-7.8 7.8L12 21l8.8-8.6a5.5 5.5 0 0 0 0-7.8z"/>',
  sparkles: '<path d="M12 3l1.8 4.7L18.5 9.5l-4.7 1.8L12 16l-1.8-4.7L5.5 9.5l4.7-1.8L12 3z"/><path d="M19 15l.8 2.2L22 18l-2.2.8L19 21l-.8-2.2L16 18l2.2-.8L19 15z"/>',
  github: '<path d="M9 19c-4.3 1.4-4.3-2.5-6-3m12 5v-3.5c0-1 .1-1.4-.5-2 2.8-.3 5.5-1.4 5.5-6a4.6 4.6 0 0 0-1.3-3.2 4.2 4.2 0 0 0-.1-3.2s-1.1-.3-3.5 1.3a12.3 12.3 0 0 0-6.2 0C6.5 2.8 5.4 3.1 5.4 3.1a4.2 4.2 0 0 0-.1 3.2A4.6 4.6 0 0 0 4 9.5c0 4.6 2.7 5.7 5.5 6-.6.6-.6 1.2-.5 2V21"/>',
  speech: '<path d="M4 10v4M8.5 6.5v11M13 3.5v17M17.5 8v8M22 11v2"/>',
};
const icon = (name, extra = '') => `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.9" stroke-linecap="round" stroke-linejoin="round" ${extra}>${P[name]}</svg>`;
const MARK = `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.6" stroke-linecap="round" class="eq"><path d="M4 10v4"/><path d="M8.5 6.5v11"/><path d="M13 3.5v17"/><path d="M17.5 8v8"/><path d="M22 11v2"/></svg>`;

// Built in the page's own document: nodes from a <template> belong to an
// inert document with no animation timeline, and their animations never run.
const el = (html) => {
  const d = document.createElement('div');
  d.innerHTML = html.trim();
  return /** @type {HTMLElement} */ (d.firstElementChild);
};

// ─── Motion presets ──────────────────────────────────────────────────────
const PRESETS = {
  up: [{ opacity: 0, transform: 'translateY(46px)', filter: 'blur(14px)' }, { opacity: 1, transform: 'none', filter: 'blur(0)' }],
  pop: [{ opacity: 0, transform: 'scale(0.82)', filter: 'blur(10px)' }, { opacity: 1, transform: 'none', filter: 'blur(0)' }],
  fade: [{ opacity: 0 }, { opacity: 1 }],
  blur: [{ opacity: 0, filter: 'blur(28px)', transform: 'scale(1.06)' }, { opacity: 1, filter: 'blur(0)', transform: 'none' }],
  left: [{ opacity: 0, transform: 'translateX(-60px)', filter: 'blur(10px)' }, { opacity: 1, transform: 'none', filter: 'blur(0)' }],
  right: [{ opacity: 0, transform: 'translateX(60px)', filter: 'blur(10px)' }, { opacity: 1, transform: 'none', filter: 'blur(0)' }],
};

/** Animate in at `at` seconds after the scene started. */
function show(node, at, kind = 'up', dur = 0.8) {
  if (!node) return;
  node.animate(PRESETS[kind], { delay: Math.max(0, at) * 1000, duration: dur * 1000, easing: kind === 'pop' ? SPRING : EASE, fill: 'both' });
}

// ─── Assets ──────────────────────────────────────────────────────────────
const manifest = await (await fetch(`${ASSETS}manifest.json`)).json();
// ?scenes=3 plays only the first three, for quick checks.
const limit = Number(new URLSearchParams(location.search).get('scenes')) || manifest.scenes.length;
manifest.scenes = manifest.scenes.slice(0, limit);
const SCENE_DATA = Object.fromEntries(manifest.scenes.map((s) => [s.id, s]));
const shot = (name) => `${ASSETS}${manifest.shots[name]}`;
const GEO = manifest.geo ?? {};

await Promise.all(Object.keys(manifest.shots).map((n) => new Promise((r) => { const i = new Image(); i.onload = r; i.onerror = r; i.src = shot(n); })));
await document.fonts.ready;

// ─── Timeline ────────────────────────────────────────────────────────────
// The live context drives the picture: its clock is the film's clock and its
// analyser moves the orbs. The soundtrack itself is rendered offline from the
// same score, sample-exact, for export.
const ctx = new AudioContext({ sampleRate: 48000 });
const voices = await Promise.all(manifest.scenes.map(async (s) => ctx.decodeAudioData(await (await fetch(`${ASSETS}${s.file}`)).arrayBuffer())));

let t = 0.9;
const plan = manifest.scenes.map((s, i) => {
  const start = t;
  const vo = start + LEAD;
  const end = vo + voices[i].duration + s.pad;
  t = end - XFADE * 0.5;
  return { ...s, index: i, start, vo, end, voDur: voices[i].duration };
});
const TOTAL = plan.at(-1).end + 0.9;

/** When a phrase is spoken, in seconds after its scene started. */
function phraseAt(p, phrase) {
  const i = p.text.indexOf(phrase);
  const frac = i < 0 ? 0 : i / p.text.length;
  return LEAD + frac * p.voDur;
}
const sceneOf = (id) => plan.find((p) => p.id === id);

// ─── Sound ───────────────────────────────────────────────────────────────
const NOTE = (n) => 440 * Math.pow(2, (n - 69) / 12);
// A slow four-chord bed: Am9 · Fmaj9 · Cmaj9 · G6.
const CHORDS = [[57, 60, 64, 67, 71], [53, 57, 60, 64, 67], [48, 52, 55, 59, 62], [55, 59, 62, 64, 67]];
const BAR = 4.8;

/**
 * The whole mix, built on any audio context: narration with a touch of
 * presence, a music bed that ducks under it, and soft transitions.
 *
 * @param {BaseAudioContext} ac
 */
function createSound(ac) {
  const master = ac.createGain();
  master.gain.value = 0.95;
  const comp = ac.createDynamicsCompressor();
  comp.threshold.value = -14; comp.knee.value = 10; comp.ratio.value = 3; comp.attack.value = 0.004; comp.release.value = 0.2;
  master.connect(comp);

  const voiceBus = ac.createGain();
  voiceBus.gain.value = 1.05;
  const warmth = ac.createBiquadFilter();
  warmth.type = 'lowshelf'; warmth.frequency.value = 180; warmth.gain.value = 1.5;
  const presence = ac.createBiquadFilter();
  presence.type = 'peaking'; presence.frequency.value = 3200; presence.Q.value = 0.8; presence.gain.value = 2.5;
  voiceBus.connect(warmth).connect(presence).connect(master);

  const musicBus = ac.createGain();
  musicBus.gain.value = 0;
  musicBus.connect(master);
  const fxBus = ac.createGain();
  fxBus.gain.value = 0.5;
  fxBus.connect(master);

  // A room for the music, from decaying noise.
  const room = ac.createConvolver();
  const rlen = ac.sampleRate * 3.2;
  const rbuf = ac.createBuffer(2, rlen, ac.sampleRate);
  for (let ch = 0; ch < 2; ch++) {
    const d = rbuf.getChannelData(ch);
    for (let i = 0; i < rlen; i++) d[i] = (Math.random() * 2 - 1) * Math.pow(1 - i / rlen, 2.6);
  }
  room.buffer = rbuf;
  const roomGain = ac.createGain();
  roomGain.gain.value = 0.55;
  room.connect(roomGain).connect(musicBus);

  function pad(freq, when, dur, gain) {
    const g = ac.createGain();
    g.gain.setValueAtTime(0, when);
    g.gain.linearRampToValueAtTime(gain, when + 1.6);
    g.gain.setValueAtTime(gain, when + dur - 0.2);
    g.gain.linearRampToValueAtTime(0, when + dur + 1.8);
    const lp = ac.createBiquadFilter();
    lp.type = 'lowpass'; lp.frequency.value = 1100; lp.Q.value = 0.5;
    for (const det of [-7, 6]) {
      const o = ac.createOscillator();
      o.type = 'sawtooth'; o.frequency.value = freq; o.detune.value = det;
      o.connect(lp);
      o.start(when); o.stop(when + dur + 2);
    }
    lp.connect(g);
    g.connect(musicBus);
    g.connect(room);
  }

  function pluck(freq, when, gain) {
    const o = ac.createOscillator();
    const g = ac.createGain();
    o.type = 'triangle'; o.frequency.value = freq;
    g.gain.setValueAtTime(0, when);
    g.gain.linearRampToValueAtTime(gain, when + 0.01);
    g.gain.exponentialRampToValueAtTime(0.0001, when + 1.4);
    o.connect(g); g.connect(room); g.connect(musicBus);
    o.start(when); o.stop(when + 1.5);
  }

  function bass(freq, when, dur) {
    const o = ac.createOscillator();
    const g = ac.createGain();
    o.type = 'sine'; o.frequency.value = freq;
    g.gain.setValueAtTime(0, when);
    g.gain.linearRampToValueAtTime(0.16, when + 0.8);
    g.gain.linearRampToValueAtTime(0, when + dur + 0.6);
    o.connect(g).connect(musicBus);
    o.start(when); o.stop(when + dur + 0.8);
  }

  function whoosh(when, gain = 0.07) {
    const len = Math.round(ac.sampleRate * 1.1);
    const buf = ac.createBuffer(1, len, ac.sampleRate);
    const d = buf.getChannelData(0);
    for (let i = 0; i < len; i++) d[i] = Math.random() * 2 - 1;
    const src = ac.createBufferSource();
    src.buffer = buf;
    const bp = ac.createBiquadFilter();
    bp.type = 'bandpass'; bp.Q.value = 1.1;
    bp.frequency.setValueAtTime(300, when);
    bp.frequency.exponentialRampToValueAtTime(3800, when + 0.55);
    bp.frequency.exponentialRampToValueAtTime(900, when + 1.05);
    const g = ac.createGain();
    g.gain.setValueAtTime(0, when);
    g.gain.linearRampToValueAtTime(gain, when + 0.45);
    g.gain.exponentialRampToValueAtTime(0.0001, when + 1.05);
    src.connect(bp).connect(g).connect(fxBus);
    src.start(when);
  }

  function shimmer(when, gain = 0.04) {
    for (const [i, n] of [81, 88, 93, 100].entries()) {
      const o = ac.createOscillator();
      const g = ac.createGain();
      o.type = 'sine'; o.frequency.value = NOTE(n);
      g.gain.setValueAtTime(0, when + i * 0.06);
      g.gain.linearRampToValueAtTime(gain, when + i * 0.06 + 0.02);
      g.gain.exponentialRampToValueAtTime(0.0001, when + i * 0.06 + 1.6);
      o.connect(g); g.connect(room); g.connect(fxBus);
      o.start(when + i * 0.06); o.stop(when + i * 0.06 + 1.7);
    }
  }

  function boom(when, gain = 0.4) {
    const o = ac.createOscillator();
    const g = ac.createGain();
    o.type = 'sine';
    o.frequency.setValueAtTime(90, when);
    o.frequency.exponentialRampToValueAtTime(34, when + 1.3);
    g.gain.setValueAtTime(0, when);
    g.gain.linearRampToValueAtTime(gain, when + 0.02);
    g.gain.exponentialRampToValueAtTime(0.0001, when + 1.6);
    o.connect(g).connect(fxBus);
    o.start(when); o.stop(when + 1.7);
    shimmer(when, 0.05);
  }

  function tick(when) {
    const o = ac.createOscillator();
    const g = ac.createGain();
    o.type = 'sine'; o.frequency.value = 1800;
    g.gain.setValueAtTime(0, when);
    g.gain.linearRampToValueAtTime(0.06, when + 0.003);
    g.gain.exponentialRampToValueAtTime(0.0001, when + 0.08);
    o.connect(g).connect(fxBus);
    o.start(when); o.stop(when + 0.1);
  }

  /** Everything, scheduled from the film's start at context time t0. */
  function score(t0) {
    for (let bar = 0, at = t0; at < t0 + TOTAL; bar++, at += BAR) {
      const ch = CHORDS[bar % CHORDS.length];
      for (const n of ch) pad(NOTE(n), at, BAR, 0.018);
      bass(NOTE(ch[0] - 12), at, BAR);
      // A sparse arpeggio from the second time round.
      if (bar >= 2) for (let k = 0; k < 4; k++) pluck(NOTE(ch[(k * 2 + bar) % ch.length] + 12), at + k * (BAR / 4) + 0.3, 0.035);
    }
    // Duck the bed under the narration; let it rise between lines.
    const g = musicBus.gain;
    g.setValueAtTime(0, t0);
    g.linearRampToValueAtTime(0.9, t0 + 1.2);
    for (const p of plan) {
      g.setTargetAtTime(0.32, t0 + p.vo - 0.25, 0.12);
      g.setTargetAtTime(0.85, t0 + p.vo + p.voDur + 0.1, 0.35);
    }
    g.setTargetAtTime(0.0001, t0 + TOTAL - 1.4, 0.4);
    plan.forEach((p, i) => {
      const src = ac.createBufferSource();
      src.buffer = voices[i];
      src.connect(voiceBus);
      src.start(t0 + p.vo);
      if (i > 0 && !['logo', 'cta'].includes(p.id)) whoosh(t0 + p.start - 0.35, p.id === 'turn' ? 0.05 : 0.07);
    });
    boom(t0 + plan[0].vo - 0.05, 0.35);
    const logo = sceneOf('logo');
    if (logo) boom(t0 + logo.start + LEAD - 0.15, 0.42);
    const cta = sceneOf('cta');
    if (cta) boom(t0 + cta.start + phraseAt(cta, CTA_PHRASE) - 0.1, 0.3);
    const demo = sceneOf('demo');
    if (demo) tick(t0 + demo.start + phraseAt(demo, CLICK_PHRASE) + 0.35);
  }

  return { out: comp, voice: presence, score };
}

const liveSound = createSound(ctx);
liveSound.out.connect(ctx.destination);
const analyser = ctx.createAnalyser();
analyser.fftSize = 1024;
liveSound.voice.connect(analyser);

/** The soundtrack, rendered offline: stereo, 48 kHz, film time 0 at sample 0. */
async function renderSoundtrack() {
  const off = new OfflineAudioContext(2, Math.ceil(TOTAL * 48000), 48000);
  const snd = createSound(off);
  snd.out.connect(off.destination);
  snd.score(0);
  const buf = await off.startRendering();
  return [buf.getChannelData(0), buf.getChannelData(1)];
}

// ─── Live values: narrator loudness, counters ────────────────────────────
const scratch = new Float32Array(analyser.fftSize);
let level = 0;
const live = new Set();
function setLevel(target) {
  level += (target - level) * (target > level ? 0.5 : 0.12);
  document.documentElement.style.setProperty('--level', level.toFixed(3));
}
function frame() {
  analyser.getFloatTimeDomainData(scratch);
  let sum = 0;
  for (const x of scratch) sum += x * x;
  setLevel(Math.min(1, Math.sqrt(sum / scratch.length) * 4.2));
  for (const fn of live) fn(now());
  requestAnimationFrame(frame);
}

// ─── Captions ────────────────────────────────────────────────────────────
const captions = document.querySelector('.captions');
function caption(p, t0) {
  const words = p.text.split(' ');
  const node = el(`<div class="caption">${words.map((w) => `<span class="w">${w}</span>`).join(' ')}</div>`);
  captions.replaceChildren(node);
  node.animate([{ opacity: 0, transform: 'translateY(14px)' }, { opacity: 1, transform: 'none' }], { delay: (p.vo - p.start) * 1000, duration: 350, easing: EASE, fill: 'both' });
  const spans = [...node.children];
  let offset = 0;
  const starts = words.map((w) => { const s = offset / p.text.length; offset += w.length + 1; return s; });
  const fn = (n) => {
    const into = (n - t0 - p.vo) / p.voDur;
    spans.forEach((s, i) => s.classList.toggle('on', into >= starts[i] - 0.01));
    if (n > t0 + p.vo + p.voDur + 0.35) {
      live.delete(fn);
      node.animate([{ opacity: 1 }, { opacity: 0 }], { duration: 300, fill: 'forwards' });
    }
  };
  live.add(fn);
}

// ─── Helpers for scenes ──────────────────────────────────────────────────
/** A number that counts from `a` to `b` between two moments of the film. */
function counter(node, a, b, from, to, format) {
  const fn = (n) => {
    const k = Math.min(1, Math.max(0, (n - from) / (to - from)));
    const e = 1 - Math.pow(1 - k, 3);
    node.textContent = format(a + (b - a) * e);
    if (k >= 1) live.delete(fn);
  };
  live.add(fn);
  fn(from);
}

const corner = document.querySelector('.corner');
const field = document.querySelector('.field');

/** The real app, framed. */
function device(name, width) {
  return el(`<div class="device" style="width:${width}px;height:${Math.round(width * 9 / 16)}px"><img src="${shot(name)}" alt=""></div>`);
}

/** Point the cursor at a spot on a framed screenshot and click it. */
function cursorClick(frame, xy, at, onClick) {
  const c = el(`<svg class="cursor" viewBox="0 0 24 24"><path d="M5 3l14 7-6 2-2 6z" fill="#0b0c12" stroke="#fff" stroke-width="1.4" stroke-linejoin="round"/></svg>`);
  const r = el('<div class="ripple"></div>');
  frame.append(c, r);
  // The declared width: the scene is not in the page yet, so nothing has been laid out.
  const w = parseFloat(frame.style.width) / 1920;
  const x = xy[0] * w;
  const y = xy[1] * w;
  c.animate([{ opacity: 0, transform: `translate(${x + 260}px, ${y + 180}px)` }, { opacity: 1, transform: `translate(${x + 200}px, ${y + 140}px)`, offset: 0.25 }, { opacity: 1, transform: `translate(${x - 4}px, ${y - 4}px)` }],
    { delay: (at - 1.1) * 1000, duration: 1100, easing: EASE, fill: 'both' });
  c.animate([{ transform: `translate(${x - 4}px, ${y - 4}px) scale(1)` }, { transform: `translate(${x - 4}px, ${y - 4}px) scale(0.82)` }, { transform: `translate(${x - 4}px, ${y - 4}px) scale(1)` }],
    { delay: at * 1000, duration: 260, fill: 'forwards', composite: 'replace' });
  r.animate([{ opacity: 0.9, transform: `translate(${x - 15}px, ${y - 15}px) scale(0.4)` }, { opacity: 0, transform: `translate(${x - 15}px, ${y - 15}px) scale(3.2)` }],
    { delay: at * 1000, duration: 650, easing: EASE, fill: 'both' });
  later(at, onClick);
}

// ─── The scenes ──────────────────────────────────────────────────────────
/** @type {Record<string, (p: any, t0: number) => HTMLElement>} */
const SCENES = {
  hook(p, t0) {
    const s = el(`<div class="scene"><div class="center">
      <div class="sub" style="font-size:58px">Still paying for</div>
      <div class="h-xl grad-warm" style="font-size:190px">ElevenLabs?</div>
      <div class="glass-strong" style="margin-top:34px;display:flex;gap:56px;padding:26px 44px;border-radius:26px;align-items:center">
        <div style="text-align:left"><div style="font-size:21px;color:var(--ink-3);letter-spacing:.12em;text-transform:uppercase">Characters metered</div><div class="n1 mono" style="font-size:52px;font-weight:600">0</div></div>
        <div style="width:1px;height:70px;background:var(--line-2)"></div>
        <div style="text-align:left"><div style="font-size:21px;color:var(--ink-3);letter-spacing:.12em;text-transform:uppercase">Your bill, still running</div><div class="n2 mono" style="font-size:52px;font-weight:600;color:var(--bad)">$0.00</div></div>
      </div></div></div>`);
    const [a, b, m] = s.querySelector('.center').children;
    show(a, phraseAt(p, 'Still'), 'up');
    show(b, phraseAt(p, 'ElevenLabs') - 0.1, 'blur', 1.0);
    show(m, p.voDur * 0.85 + LEAD, 'up');
    const from = t0 + p.vo + p.voDur * 0.85;
    counter(s.querySelector('.n1'), 0, 2480000, from, from + 2.2, (v) => Math.round(v).toLocaleString('en-US'));
    counter(s.querySelector('.n2'), 0, 412.8, from, from + 2.2, (v) => `$${v.toFixed(2)}`);
    return s;
  },

  pain(p) {
    const s = el(`<div class="scene"><div class="center" style="gap:56px">
      <div class="h-md" style="color:var(--ink-2)">The cloud keeps <span class="grad-warm">charging you.</span></div>
      <div class="row">
        <div class="card glass"><div class="icon-tile bad">${icon('dollar')}</div><b>Pay per character</b><span>Every word you generate is metered and billed.</span></div>
        <div class="card glass"><div class="icon-tile bad">${icon('upload')}</div><b>Your text leaves</b><span>Every request is sent to someone else's servers.</span></div>
        <div class="card glass"><div class="icon-tile bad">${icon('wifiOff')}</div><b>Offline? Silence.</b><span>No connection means no voice at all.</span></div>
      </div></div></div>`);
    const [h, row] = s.querySelector('.center').children;
    show(h, 0.15, 'up');
    const cards = [...row.children];
    show(cards[0], phraseAt(p, 'Every character') - 0.1, 'up');
    show(cards[1], phraseAt(p, 'Every request') - 0.1, 'up');
    show(cards[2], phraseAt(p, 'And when') - 0.1, 'up');
    return s;
  },

  turn(p) {
    field.classList.add('dim');
    const s = el(`<div class="scene"><div class="center"><div class="h-lg">There is a <span class="grad">better way.</span></div></div></div>`);
    show(s.querySelector('.h-lg'), LEAD - 0.1, 'blur', 1.2);
    return s;
  },

  logo(p, t0) {
    field.classList.remove('dim');
    field.classList.add('bright');
    const s = el(`<div class="scene"><div class="center" style="gap:40px">
      <div class="mark big">${MARK}</div>
      <div class="h-xl grad" style="font-size:210px">Cadence</div>
      <div class="sub" style="font-size:40px;max-width:1200px">Natural AI voices that run entirely on <b style="color:var(--ink)">your own device.</b></div>
    </div></div>`);
    const [m, w, sub] = s.querySelector('.center').children;
    show(m, LEAD - 0.15, 'pop', 1.0);
    show(w, LEAD + 0.1, 'blur', 1.1);
    show(sub, phraseAt(p, 'Natural'), 'up');
    // The mark's bars move with the narrator.
    const bars = [...m.querySelectorAll('path')];
    const fn = (n) => {
      bars.forEach((b, i) => { b.style.transform = `scaleY(${0.55 + level * (0.9 + 0.5 * Math.sin(n * 9 + i * 1.7))})`; b.style.transformOrigin = 'center'; b.style.transformBox = 'fill-box'; });
      if (n > t0 + p.end + 0.5) live.delete(fn);
    };
    live.add(fn);
    return s;
  },

  pillars(p) {
    corner.animate([{ opacity: 0 }, { opacity: 1 }], { duration: 800, fill: 'forwards' });
    const s = el(`<div class="scene"><div class="center" style="gap:44px">
      <div class="kicker">Why Cadence</div>
      <div class="row" style="flex-wrap:wrap;max-width:1700px;gap:26px">
        <div class="chip glass">${icon('wifiOff')} Offline</div>
        <div class="chip glass">${icon('lock')} Private</div>
        <div class="chip glass">${icon('zap')} Fast</div>
        <div class="chip glass">${icon('noBill')} No API bill</div>
      </div>
      <div class="sub" style="font-size:36px">Free, forever. On the hardware you already own.</div>
    </div></div>`);
    const [k, row, sub] = s.querySelector('.center').children;
    show(k, 0.1, 'fade');
    const chips = [...row.children];
    ['Offline', 'Private', 'Fast', 'And no API'].forEach((w, i) => show(chips[i], phraseAt(p, w) - 0.08, 'pop', 0.7));
    show(sub, phraseAt(p, 'ever') + 0.3, 'up');
    return s;
  },

  demo(p, t0) {
    field.classList.remove('bright');
    // Lifted clear of the captions, so the click on Generate is seen.
    const s = el(`<div class="scene"><div class="persp" style="position:relative;transform:translateY(-78px)"></div></div>`);
    const holder = s.firstElementChild;
    const d = device('tts-typed', 1380);
    holder.append(d);
    d.animate([{ transform: 'rotateX(18deg) translateY(80px) scale(0.92)', opacity: 0 }, { transform: 'rotateX(0) translateY(0) scale(1)', opacity: 1 }], { duration: 1300, easing: EASE, fill: 'both' });
    const playing = el(`<img src="${shot('tts-playing')}" alt="" style="position:absolute;inset:0;width:100%;height:100%;object-fit:cover;opacity:0">`);
    d.append(playing);
    const clickAt = phraseAt(p, 'press generate') + 0.35;
    cursorClick(d, GEO.generate ?? [1700, 990], clickAt, () => {
      playing.animate([{ opacity: 0 }, { opacity: 1 }], { duration: 450, fill: 'forwards' });
    });
    // Then lean in on the result.
    d.animate([{ transform: 'scale(1)' }, { transform: 'scale(1.05)' }], { delay: (clickAt + 0.6) * 1000, duration: 4200, easing: EASE, fill: 'forwards', composite: 'add' });
    const call = el(`<div class="callout glass-strong good" style="right:-70px;top:110px"><b>451 ms</b><span>to first audio, in the browser</span></div>`);
    holder.append(call);
    show(call, phraseAt(p, 'under half a second') - 0.1, 'pop');
    const call2 = el(`<div class="callout glass-strong" style="left:-80px;bottom:190px"><b style="font-size:34px">No server</b><span>made on this device</span></div>`);
    holder.append(call2);
    show(call2, phraseAt(p, 'No server') - 0.05, 'pop');
    return s;
  },

  stream(p) {
    const n = 64;
    const bars = Array.from({ length: n }, (_, i) => `<i style="height:${18 + Math.round(120 * Math.abs(Math.sin(i * 0.61) * Math.cos(i * 0.23)))}px"></i>`).join('');
    const s = el(`<div class="scene"><div class="center" style="gap:48px">
      <div class="h-md">Streams as it <span class="grad">speaks.</span></div>
      <div class="glass-strong" style="padding:40px 48px;border-radius:32px;display:grid;gap:28px;width:1500px">
        <div class="wave">${bars}</div>
        <div style="display:flex;gap:18px;justify-content:space-between">
          <div class="pill"><i></i> Sentence 1 · playing</div>
          <div class="pill acc s2"><i></i> Sentence 2 · ready</div>
          <div class="pill acc s3"><i></i> Sentence 3 · generating</div>
          <div class="chip sm glass gaps" style="font-size:26px">${icon('check')} 0 gaps</div>
        </div>
      </div>
      <div class="sub">Playback starts before the paragraph is finished.</div>
    </div></div>`);
    const [h, panel, sub] = s.querySelector('.center').children;
    show(h, 0.1, 'up');
    show(panel, 0.35, 'up');
    const pills = [...panel.querySelectorAll('.pill, .chip')];
    show(pills[0], phraseAt(p, 'sentence by sentence'), 'pop', 0.6);
    show(pills[1], phraseAt(p, 'so playback'), 'pop', 0.6);
    show(pills[2], phraseAt(p, 'while the rest'), 'pop', 0.6);
    show(pills[3], phraseAt(p, 'without a single gap') - 0.05, 'pop', 0.7);
    show(sub, phraseAt(p, 'without') + 0.4, 'up');
    const is = [...panel.querySelectorAll('.wave i')];
    const sceneStart = p.start;
    const fn = (now0) => {
      const k = (now0 - (filmT0 + sceneStart + LEAD)) / (p.voDur + p.pad);
      const on = Math.floor(Math.max(0, k) * n * 1.05);
      is.forEach((b, i) => b.classList.toggle('on', i < on));
      if (k > 1.2) live.delete(fn);
    };
    live.add(fn);
    return s;
  },

  voices(p, t0) {
    const s = el(`<div class="scene"><div style="display:grid;grid-template-columns:1180px 520px;gap:70px;align-items:center">
      <div class="persp"></div>
      <div style="display:grid;gap:34px">
        <div class="stat"><b class="grad cnt">0</b><span>voices, all on one 79 MB model</span></div>
        <div style="display:flex;flex-wrap:wrap;gap:14px">
          <div class="chip sm glass">Warm</div><div class="chip sm glass">Bright</div><div class="chip sm glass">Calm</div><div class="chip sm glass">Deep</div>
        </div>
        <div class="chip sm glass" style="justify-self:start">${icon('speech')} Preview any voice in one click</div>
      </div></div></div>`);
    const holder = s.querySelector('.persp');
    const d = device('voices', 1180);
    holder.append(d);
    d.animate([{ opacity: 0, transform: 'rotateY(14deg) translateX(-40px)' }, { opacity: 1, transform: 'none' }], { duration: 1200, easing: EASE, fill: 'both' });
    d.querySelector('img').animate([{ transform: 'scale(1) translate(0,0)' }, { transform: 'scale(1.18) translate(-3%, 4%)' }], { duration: (p.end - p.start) * 1000, easing: 'ease-in-out', fill: 'both' });
    const right = s.querySelector('.stat').parentElement;
    const [stat, tags, prev] = right.children;
    show(stat, phraseAt(p, 'more than') - 0.2, 'right');
    counter(stat.querySelector('.cnt'), 0, 904, t0 + p.start + phraseAt(p, 'more than'), t0 + p.start + phraseAt(p, 'more than') + 1.8, (v) => String(Math.round(v)));
    const chips = [...tags.children];
    ['Warm', 'bright', 'calm', 'or deep'].forEach((w, i) => show(chips[i], phraseAt(p, w) - 0.05, 'pop', 0.6));
    show(prev, phraseAt(p, 'Preview') - 0.05, 'up');
    return s;
  },

  hd(p) {
    const s = el(`<div class="scene"><div style="display:grid;grid-template-columns:980px 620px;gap:90px;align-items:center">
      <div class="crop"></div>
      <div class="center" style="gap:30px">
        <div class="orb" style="--size:300px;--h1:262;--h2:300;--h3:200"></div>
        <div class="pill acc" style="font-size:26px;padding:12px 22px">${icon('sparkles', 'width="24" height="24"')} Cadence HD</div>
        <div class="h-md" style="font-size:56px">Narrator: <span class="grad">Heart</span></div>
        <div class="sub" style="font-size:28px">Grade A · Kokoro-82M · on this laptop</div>
      </div></div></div>`);
    // The model chooser, cropped from the real app.
    const g = GEO.models ?? [1395, 320, 500, 260];
    const scale = 980 / g[2];
    const crop = s.querySelector('.crop');
    crop.className = 'device';
    crop.style.cssText = `width:980px;height:${Math.round(g[3] * scale)}px`;
    crop.innerHTML = `<img src="${shot('tts-hd')}" alt="" style="position:absolute;width:${1920 * scale}px;height:${1080 * scale}px;max-width:none;left:${-g[0] * scale}px;top:${-g[1] * scale}px">`;
    show(crop, 0.15, 'left', 1.0);
    const [orb, pill, name, sub] = s.querySelector('.center').children;
    show(orb, phraseAt(p, 'Switch') - 0.1, 'pop', 1.0);
    show(pill, phraseAt(p, 'Cadence HD') - 0.05, 'pop');
    show(name, phraseAt(p, 'like the one') - 0.1, 'up');
    show(sub, phraseAt(p, 'hearing') + 0.1, 'up');
    return s;
  },

  speed(p, t0) {
    const arc = Math.PI * 250;
    const s = el(`<div class="scene"><div style="display:grid;grid-template-columns:640px 820px;gap:110px;align-items:center">
      <div class="gauge"><svg viewBox="0 0 600 340">
        <defs><linearGradient id="gg" x1="0" x2="1"><stop offset="0" stop-color="#fb7185"/><stop offset=".55" stop-color="#fbbf24"/><stop offset="1" stop-color="#34d399"/></linearGradient></defs>
        <path class="track" d="M50 300 A250 250 0 0 1 550 300" fill="none" stroke-width="34" stroke-linecap="round"/>
        <path class="value" d="M50 300 A250 250 0 0 1 550 300" fill="none" stroke-width="34" stroke-linecap="round" stroke-dasharray="${arc}" stroke-dashoffset="${arc}"/>
      </svg><div class="read"><b class="rtf">1.000</b><span>real-time factor · lower is faster</span></div></div>
      <div style="display:grid;gap:40px">
        <div class="stat"><b class="grad x">0×</b><span>faster than real time, in the browser</span></div>
        <div class="bars">
          <div><div class="lbl"><span>One minute of speech, spoken aloud</span><b>60 s</b></div><div class="t"><i class="slow"></i></div></div>
          <div><div class="lbl"><span>Made by Cadence</span><b>5.6 s</b></div><div class="t"><i class="fast"></i></div></div>
        </div>
        <div class="chip sm glass" style="justify-self:start">${icon('cpu')} 2014 laptop · faster than real time <span class="ok">${icon('check')}</span></div>
      </div></div></div>`);
    const [gauge, right] = s.firstElementChild.children;
    show(gauge, 0.1, 'pop', 1.0);
    const val = gauge.querySelector('.value');
    const from = t0 + p.start + phraseAt(p, 'fast');
    const to = from + 2.4;
    const rtf = gauge.querySelector('.rtf');
    const fn = (n) => {
      const k = Math.min(1, Math.max(0, (n - from) / (to - from)));
      const e = 1 - Math.pow(1 - k, 3);
      const r = 1 - (1 - 0.093) * e;
      rtf.textContent = r.toFixed(3);
      val.setAttribute('stroke-dashoffset', String(arc * (1 - Math.max(0.02, 1 - r))));
      if (k >= 1) live.delete(fn);
    };
    live.add(fn);
    const [stat, bars, chip] = right.children;
    show(stat, phraseAt(p, 'more than ten') - 0.2, 'right');
    counter(stat.querySelector('.x'), 0, 10.7, t0 + p.start + phraseAt(p, 'more than ten'), t0 + p.start + phraseAt(p, 'more than ten') + 1.6, (v) => `${v.toFixed(1)}×`);
    show(bars, phraseAt(p, 'real time') + 0.2, 'up');
    const [slow, fast] = bars.querySelectorAll('.t i');
    const barsAt = phraseAt(p, 'real time') + 0.6;
    slow.animate([{ width: '0%' }, { width: '100%' }], { delay: barsAt * 1000, duration: 2600, easing: 'linear', fill: 'both' });
    fast.animate([{ width: '0%' }, { width: '9.3%' }], { delay: barsAt * 1000, duration: 500, easing: EASE, fill: 'both' });
    show(chip, phraseAt(p, 'Even a laptop') - 0.05, 'pop');
    return s;
  },

  offline(p, t0) {
    const bars = Array.from({ length: 34 }, () => '<i></i>').join('');
    const s = el(`<div class="scene"><div class="center" style="gap:46px">
      <div style="display:flex;gap:90px;align-items:center">
        <svg class="wifi" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round">${P.wifi}<path class="slash" d="M3 3l18 18"/></svg>
        <div class="mini glass-strong">
          <div class="top"><div class="orb" style="--size:72px;--h1:262;--h2:300;--h3:200"></div><div style="flex:1"><b>Still speaking</b><span>Network: off</span></div><div class="pill">Offline</div></div>
          <div class="wave mini-wave" style="height:90px;gap:8px">${bars}</div>
        </div>
      </div>
      <div class="chip glass lockchip">${icon('lock')} Nothing you type ever leaves your device</div>
    </div></div>`);
    const [top, lock] = s.querySelector('.center').children;
    const [wifi, mini] = top.children;
    show(wifi, 0.1, 'pop', 0.9);
    wifi.querySelector('.slash').animate([{ strokeDashoffset: 40 }, { strokeDashoffset: 0 }], { delay: phraseAt(p, 'switched off') * 1000, duration: 500, easing: EASE, fill: 'both' });
    wifi.animate([{ color: '#464a58' }, { color: '#a9adbd' }], { delay: phraseAt(p, 'switched off') * 1000, duration: 500, fill: 'both' });
    show(mini, phraseAt(p, 'keeps working') - 0.1, 'right');
    show(lock, phraseAt(p, 'nothing you type') - 0.1, 'up');
    const is = [...mini.querySelectorAll('.mini-wave i')];
    const fn = (n) => {
      is.forEach((b, i) => { b.style.height = `${10 + Math.round((0.25 + level) * 70 * Math.abs(Math.sin(n * 5 + i * 0.7)))}px`; b.style.background = 'var(--ink)'; });
      if (n > t0 + p.end + 0.5) live.delete(fn);
    };
    live.add(fn);
    return s;
  },

  code(p, t0) {
    const s = el(`<div class="scene"><div class="center" style="gap:38px">
      <div class="term glass"><span class="p">$</span><span>npm install @cadence/engine</span></div>
      <div class="code glass-strong"><div class="top"><i></i><i></i><i></i><span>speak.js</span></div><pre></pre></div>
      <div class="row" style="gap:18px"><div class="chip sm glass">${icon('globe')} Browser</div><div class="chip sm glass">${icon('terminal')} Node.js</div><div class="chip sm glass">${icon('shield')} Typed</div></div>
    </div></div>`);
    const [term, code, chips] = s.querySelector('.center').children;
    show(term, 0.1, 'up');
    show(code, phraseAt(p, 'three lines') - 0.3, 'up');
    const SRC = [
      ['k', 'import'], ['', ' { createEngine } '], ['k', 'from'], ['s', " '@cadence/engine'"], ['', ';\n\n'],
      ['k', 'const'], ['', ' engine = '], ['f', 'createEngine'], ['', '();\n'],
      ['k', 'const'], ['', ' { samples } = '], ['k', 'await'], ['', ' engine.'], ['f', 'synthesize'], ['', '({ text: '], ['s', "'Hello!'"], ['', ' });\n'],
      ['f', 'play'], ['', '(samples); '], ['c', '// that is it'],
    ];
    const total = SRC.reduce((n, [, x]) => n + x.length, 0);
    const pre = code.querySelector('pre');
    const from = t0 + p.start + phraseAt(p, 'three lines');
    const to = t0 + p.start + phraseAt(p, 'In the browser');
    let shown = -1;
    const fn = (n) => {
      const k = Math.min(1, Math.max(0, (n - from) / (to - from)));
      const count = Math.floor(k * total);
      if (count !== shown) {
        shown = count;
        let left = count;
        let html = '';
        for (const [cls, text] of SRC) {
          if (left <= 0) break;
          const part = text.slice(0, left);
          left -= part.length;
          const safe = part.replace(/&/g, '&amp;').replace(/</g, '&lt;');
          html += cls ? `<span class="${cls}">${safe}</span>` : safe;
        }
        pre.innerHTML = `${html}<span class="caret"></span>`;
      }
      if (n > t0 + p.end) live.delete(fn);
    };
    live.add(fn);
    const cs = [...chips.children];
    show(cs[0], phraseAt(p, 'In the browser') - 0.05, 'pop');
    show(cs[1], phraseAt(p, 'Node') - 0.1, 'pop');
    show(cs[2], phraseAt(p, 'Node') + 0.35, 'pop');
    return s;
  },

  compare(p) {
    const no = (t) => `<div class="no">${icon('x')} <span class="them">${t}</span></div>`;
    const yes = (t) => `<div class="yes">${icon('check')} ${t}</div>`;
    const rows = [
      ['Pricing', 'Per character', 'Free, unlimited', 'No per-character'],
      ['Quotas', 'Monthly limits', 'None', 'No quotas'],
      ['API keys', 'Required', 'None to leak', 'No API keys'],
      ['Latency', 'Server round trip', 'On your device', 'No round trip'],
      ['Works offline', 'No', 'Yes', 'server.'],
      ['Your text', 'Sent to their servers', 'Never leaves', 'server.'],
    ];
    const s = el(`<div class="scene"><div class="table glass-strong">
      <div class="tr th"><div></div><div>Cloud TTS</div><div class="us">Cadence</div></div>
      ${rows.map(([f, a, b]) => `<div class="tr"><div class="feat">${f}</div>${no(a)}${yes(b)}</div>`).join('')}
    </div></div>`);
    const table = s.firstElementChild;
    show(table, 0.05, 'up', 0.7);
    const trs = [...table.querySelectorAll('.tr')].slice(1);
    rows.forEach((r, i) => show(trs[i], phraseAt(p, r[3]) - 0.05 + (i === 5 ? 0.35 : 0), 'left', 0.55));
    return s;
  },

  open(p) {
    corner.animate([{ opacity: 1 }, { opacity: 1 }], { duration: 10, fill: 'forwards' });
    const s = el(`<div class="scene"><div class="center" style="gap:40px">
      <div class="glass-strong" style="display:flex;gap:30px;align-items:center;padding:36px 54px;border-radius:34px">
        <div class="icon-tile good" style="width:110px;height:110px;border-radius:30px">${icon('shield', 'style="width:58px;height:58px"')}</div>
        <div style="text-align:left"><div style="font-size:24px;color:var(--ink-3);letter-spacing:.14em;text-transform:uppercase">Open source</div><div class="h-md" style="font-size:84px">Apache-2.0</div></div>
      </div>
      <div class="row" style="gap:18px"><div class="chip sm glass">${icon('check')} Free for commercial use</div><div class="chip sm glass">${icon('check')} No copyleft</div><div class="chip sm glass">${icon('check')} Own your stack</div></div>
      <div class="url">${icon('github', 'width="30" height="30" style="vertical-align:-6px;margin-right:12px"')}github.com/Saeed-Hussain/Cadence</div>
    </div></div>`);
    const [badge, chips, url] = s.querySelector('.center').children;
    show(badge, phraseAt(p, 'open source') - 0.15, 'pop', 0.9);
    const cs = [...chips.children];
    show(cs[0], phraseAt(p, 'Free for') - 0.05, 'pop');
    show(cs[1], phraseAt(p, 'commercial') + 0.2, 'pop');
    show(cs[2], phraseAt(p, 'projects'), 'pop');
    show(url, phraseAt(p, 'projects') + 0.4, 'up');
    return s;
  },

  credit(p) {
    const s = el(`<div class="scene"><div class="center" style="gap:40px">
      <div class="orb" style="--size:340px;--h1:262;--h2:300;--h3:200"></div>
      <div class="h-md">Narrated entirely by <span class="grad">Cadence.</span></div>
      <div class="sub">Voice: Heart · Cadence HD · generated on a laptop · no cloud</div>
    </div></div>`);
    const [orb, h, sub] = s.querySelector('.center').children;
    show(orb, 0.1, 'pop', 1.1);
    show(h, phraseAt(p, 'spoken by'), 'up');
    show(sub, phraseAt(p, 'without the cloud') - 0.2, 'up');
    return s;
  },

  cta(p, t0) {
    corner.animate([{ opacity: 1 }, { opacity: 0 }], { duration: 600, fill: 'forwards' });
    field.classList.add('bright');
    const s = el(`<div class="scene"><div class="center" style="gap:34px">
      <div class="mark big" style="width:132px;height:132px;border-radius:38px">${MARK}</div>
      <div class="h-md" style="color:var(--ink-2)">Stop paying per character.</div>
      <div class="h-lg">Start building with <span class="grad">Cadence.</span></div>
      <div class="term glass" style="margin-top:16px"><span class="p">$</span><span>npm install @cadence/engine</span></div>
      <div class="url">github.com/Saeed-Hussain/Cadence</div>
    </div></div>`);
    const [m, a, b, term, url] = s.querySelector('.center').children;
    show(m, 0.05, 'pop', 1.0);
    show(a, phraseAt(p, 'Stop') - 0.1, 'up');
    show(b, phraseAt(p, 'Start building') - 0.1, 'blur', 1.0);
    show(term, phraseAt(p, 'Cadence') + 0.5, 'up');
    show(url, phraseAt(p, 'Cadence') + 0.8, 'up');
    return s;
  },
};

// ─── The reel's scenes (1080 × 1920) ─────────────────────────────────────
/** A phone around one of the app's mobile screenshots; `width` is the phone's outer width. */
function phone(name, width) {
  const view = manifest.view ?? { width: 430, height: 932 };
  const inner = width - 32;
  const h = Math.round(inner * (view.height / view.width));
  return el(`<div class="phone" style="width:${width}px"><div class="notch"></div><div class="screen" style="height:${h}px"><img src="${shot(name)}" alt=""></div></div>`);
}

/** A finger tap on a spot of a phone screenshot (page pixels of the app's mobile view). */
function tapAt(ph, xy, at, onTap) {
  const view = manifest.view ?? { width: 430, height: 932 };
  const screen = ph.querySelector('.screen');
  const k = (parseFloat(ph.style.width) - 32) / view.width;
  const x = 16 + xy[0] * k - 35;
  const y = 16 + xy[1] * k - 35;
  const dot = el('<div class="tap"></div>');
  const ring = el('<div class="ripple" style="width:70px;height:70px;border-width:4px"></div>');
  ph.append(dot, ring);
  dot.animate([{ opacity: 0, transform: `translate(${x}px, ${y}px) scale(1.4)` }, { opacity: 1, transform: `translate(${x}px, ${y}px) scale(1)`, offset: 0.4 }, { opacity: 1, transform: `translate(${x}px, ${y}px) scale(0.85)`, offset: 0.7 }, { opacity: 0, transform: `translate(${x}px, ${y}px) scale(0.85)` }],
    { delay: (at - 0.35) * 1000, duration: 900, easing: EASE, fill: 'both' });
  ring.animate([{ opacity: 0.9, transform: `translate(${x}px, ${y}px) scale(0.6)` }, { opacity: 0, transform: `translate(${x}px, ${y}px) scale(2.6)` }],
    { delay: at * 1000, duration: 700, easing: EASE, fill: 'both' });
  later(at, onTap);
  return screen;
}

/** @type {Record<string, (p: any, t0: number) => HTMLElement>} */
const REEL_SCENES = {
  hook(p, t0) {
    const s = el(`<div class="scene"><div class="center" style="gap:30px">
      <div class="sub" style="font-size:66px">Still paying for</div>
      <div class="h-xl grad-warm" style="font-size:168px;line-height:1.05">ElevenLabs?</div>
      <div class="glass-strong" style="margin-top:50px;display:grid;gap:26px;padding:36px 48px;border-radius:32px;text-align:left;width:780px">
        <div><div style="font-size:26px;color:var(--ink-3);letter-spacing:.12em;text-transform:uppercase">Characters metered</div><div class="n1 mono" style="font-size:66px;font-weight:600">0</div></div>
        <div style="height:1px;background:var(--line-2)"></div>
        <div><div style="font-size:26px;color:var(--ink-3);letter-spacing:.12em;text-transform:uppercase">Your bill, still running</div><div class="n2 mono" style="font-size:66px;font-weight:600;color:var(--bad)">$0.00</div></div>
      </div></div></div>`);
    const [a, b, m] = s.querySelector('.center').children;
    show(a, phraseAt(p, 'Still'), 'up');
    show(b, phraseAt(p, 'ElevenLabs') - 0.1, 'blur', 1.0);
    show(m, LEAD + p.voDur * 0.85, 'up');
    const from = t0 + p.vo + p.voDur * 0.85;
    counter(s.querySelector('.n1'), 0, 2480000, from, from + 2.0, (v) => Math.round(v).toLocaleString('en-US'));
    counter(s.querySelector('.n2'), 0, 412.8, from, from + 2.0, (v) => '$' + v.toFixed(2));
    return s;
  },

  pain(p) {
    const s = el(`<div class="scene"><div class="center" style="gap:46px">
      <div class="h-md" style="color:var(--ink-2)">The cloud keeps<br><span class="grad-warm">charging you.</span></div>
      <div style="display:grid;gap:26px">
        <div class="card glass"><div class="icon-tile bad">${icon('dollar')}</div><b>Pay per character</b><span>Every word is metered and billed.</span></div>
        <div class="card glass"><div class="icon-tile bad">${icon('upload')}</div><b>Your words leave</b><span>Sent to someone else's servers.</span></div>
      </div></div></div>`);
    const [h, list] = s.querySelector('.center').children;
    show(h, 0.1, 'up');
    show(list.children[0], phraseAt(p, 'Every character') - 0.05, 'up');
    show(list.children[1], phraseAt(p, 'every word') - 0.05, 'up');
    return s;
  },

  logo(p, t0) {
    field.classList.add('bright');
    const s = el(`<div class="scene"><div class="center" style="gap:44px">
      <div class="mark big" style="width:190px;height:190px;border-radius:52px">${MARK}</div>
      <div class="h-xl grad" style="font-size:200px">Cadence</div>
      <div class="sub" style="font-size:46px;max-width:880px">Natural AI voices that run on <b style="color:var(--ink)">your own device.</b></div>
      <div class="chip sm glass">${icon('check')} Free · open source</div>
    </div></div>`);
    const [m, w, sub, chip] = s.querySelector('.center').children;
    show(m, LEAD - 0.15, 'pop', 1.0);
    show(w, LEAD + 0.1, 'blur', 1.1);
    show(sub, phraseAt(p, 'Natural'), 'up');
    show(chip, phraseAt(p, 'for free') - 0.05, 'pop');
    const bars = [...m.querySelectorAll('path')];
    const fn = (n) => {
      bars.forEach((b, i) => { b.style.transform = `scaleY(${0.55 + level * (0.9 + 0.5 * Math.sin(n * 9 + i * 1.7))})`; b.style.transformOrigin = 'center'; b.style.transformBox = 'fill-box'; });
      if (n > t0 + p.end + 0.5) live.delete(fn);
    };
    live.add(fn);
    corner.animate([{ opacity: 0 }, { opacity: 1 }], { delay: (p.end - p.start - 0.3) * 1000, duration: 600, fill: 'both' });
    return s;
  },

  demo(p) {
    field.classList.remove('bright');
    const s = el(`<div class="scene"><div style="position:relative"></div></div>`);
    const holder = s.firstElementChild;
    // Sized to the space between the top bar and the captions.
    const ph = phone('tts-typed', 470);
    holder.append(ph);
    ph.animate([{ opacity: 0, transform: 'translateY(140px) rotate(-4deg) scale(0.92)' }, { opacity: 1, transform: 'none' }], { duration: 1200, easing: EASE, fill: 'both' });
    const playing = el(`<img src="${shot('tts-playing')}" alt="" style="position:absolute;inset:0;width:100%;height:100%;object-fit:cover;opacity:0">`);
    ph.querySelector('.screen').append(playing);
    tapAt(ph, GEO.generate ?? [300, 600], phraseAt(p, 'tap generate') + 0.35, () => {
      playing.animate([{ opacity: 0 }, { opacity: 1 }], { duration: 400, fill: 'forwards' });
    });
    const call = el(`<div class="callout glass-strong good" style="right:-190px;top:150px"><b>451 ms</b><span>to first audio</span></div>`);
    holder.append(call);
    show(call, phraseAt(p, 'under half a second') - 0.1, 'pop');
    return s;
  },

  voices(p, t0) {
    const s = el(`<div class="scene"><div class="center" style="gap:26px">
      <div class="stat"><b class="grad cnt" style="font-size:150px">0</b><span>voices · one 79 MB model</span></div>
      <div class="ph"></div>
      <div style="display:flex;gap:16px;flex-wrap:wrap;justify-content:center"><div class="chip sm glass">Warm</div><div class="chip sm glass">Bright</div><div class="chip sm glass">Calm</div><div class="chip sm glass">Deep</div></div>
    </div></div>`);
    const [stat, slot, tags] = s.querySelector('.center').children;
    const ph = phone('voices', 330);
    slot.replaceWith(ph);
    ph.animate([{ opacity: 0, transform: 'translateY(80px) scale(0.94)' }, { opacity: 1, transform: 'none' }], { duration: 1000, easing: EASE, fill: 'both' });
    ph.querySelector('img').animate([{ transform: 'translateY(0)' }, { transform: 'translateY(-6%) scale(1.06)' }], { duration: (p.end - p.start) * 1000, easing: 'ease-in-out', fill: 'both' });
    show(stat, phraseAt(p, 'Nine') - 0.2, 'up');
    counter(stat.querySelector('.cnt'), 0, 904, t0 + p.start + phraseAt(p, 'Nine'), t0 + p.start + phraseAt(p, 'Nine') + 1.6, (v) => String(Math.round(v)));
    ['Warm', 'bright', 'calm', 'or deep'].forEach((w, i) => show(tags.children[i], phraseAt(p, w) - 0.05, 'pop', 0.6));
    return s;
  },

  offline(p, t0) {
    const bars = Array.from({ length: 30 }, () => '<i></i>').join('');
    const s = el(`<div class="scene"><div class="center" style="gap:56px">
      <svg class="wifi" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" style="width:300px;height:300px">${P.wifi}<path class="slash" d="M3 3l18 18"/></svg>
      <div class="mini glass-strong" style="width:880px">
        <div class="top"><div class="orb" style="--size:80px;--h1:262;--h2:300;--h3:200"></div><div style="flex:1"><b>Still speaking</b><span>Network: off</span></div><div class="pill">Offline</div></div>
        <div class="wave mini-wave" style="height:100px;gap:9px">${bars}</div>
      </div>
      <div class="chip sm glass">${icon('lock')} Nothing you type leaves your device</div>
    </div></div>`);
    const [wifi, mini, lock] = s.querySelector('.center').children;
    show(wifi, 0.1, 'pop', 0.9);
    wifi.querySelector('.slash').animate([{ strokeDashoffset: 40 }, { strokeDashoffset: 0 }], { delay: phraseAt(p, 'No internet') * 1000 + 300, duration: 500, easing: EASE, fill: 'both' });
    wifi.animate([{ color: '#464a58' }, { color: '#a9adbd' }], { delay: phraseAt(p, 'No internet') * 1000 + 300, duration: 500, fill: 'both' });
    show(mini, phraseAt(p, 'It still works') - 0.1, 'up');
    show(lock, phraseAt(p, 'nothing you type') - 0.1, 'up');
    const is = [...mini.querySelectorAll('.mini-wave i')];
    const fn = (n) => {
      is.forEach((b, i) => { b.style.height = `${12 + Math.round((0.25 + level) * 78 * Math.abs(Math.sin(n * 5 + i * 0.7)))}px`; b.style.background = 'var(--ink)'; });
      if (n > t0 + p.end + 0.5) live.delete(fn);
    };
    live.add(fn);
    return s;
  },

  speed(p, t0) {
    const arc = Math.PI * 250;
    const s = el(`<div class="scene"><div class="center" style="gap:50px">
      <div class="gauge"><svg viewBox="0 0 600 340">
        <defs><linearGradient id="gg" x1="0" x2="1"><stop offset="0" stop-color="#e0445c"/><stop offset=".55" stop-color="#f59e0b"/><stop offset="1" stop-color="#10b981"/></linearGradient></defs>
        <path class="track" d="M50 300 A250 250 0 0 1 550 300" fill="none" stroke-width="34" stroke-linecap="round"/>
        <path class="value" d="M50 300 A250 250 0 0 1 550 300" fill="none" stroke-width="34" stroke-linecap="round" stroke-dasharray="${arc}" stroke-dashoffset="${arc}"/>
      </svg><div class="read"><b class="rtf" style="font-size:130px">1.000</b><span>real-time factor · lower is faster</span></div></div>
      <div class="stat"><b class="grad x">0×</b><span>faster than real time, in the browser</span></div>
      <div class="bars">
        <div><div class="lbl"><span>One minute of speech, spoken aloud</span><b>60 s</b></div><div class="t"><i class="slow"></i></div></div>
        <div><div class="lbl"><span>Made by Cadence</span><b>5.6 s</b></div><div class="t"><i class="fast"></i></div></div>
      </div>
    </div></div>`);
    const [gauge, stat, bars] = s.querySelector('.center').children;
    show(gauge, 0.1, 'pop', 1.0);
    const val = gauge.querySelector('.value');
    const rtf = gauge.querySelector('.rtf');
    const from = t0 + p.start + LEAD;
    const to = from + 2.4;
    const fn = (n) => {
      const k = Math.min(1, Math.max(0, (n - from) / (to - from)));
      const e = 1 - Math.pow(1 - k, 3);
      const r = 1 - (1 - 0.093) * e;
      rtf.textContent = r.toFixed(3);
      val.setAttribute('stroke-dashoffset', String(arc * (1 - Math.max(0.02, 1 - r))));
      if (k >= 1) live.delete(fn);
    };
    live.add(fn);
    show(stat, phraseAt(p, 'more than ten') - 0.2, 'up');
    counter(stat.querySelector('.x'), 0, 10.7, t0 + p.start + phraseAt(p, 'more than ten'), t0 + p.start + phraseAt(p, 'more than ten') + 1.5, (v) => `${v.toFixed(1)}×`);
    show(bars, phraseAt(p, 'real time') + 0.1, 'up');
    const [slow, fast] = bars.querySelectorAll('.t i');
    const barsAt = phraseAt(p, 'real time') + 0.4;
    slow.animate([{ width: '0%' }, { width: '100%' }], { delay: barsAt * 1000, duration: 2400, easing: 'linear', fill: 'both' });
    fast.animate([{ width: '0%' }, { width: '9.3%' }], { delay: barsAt * 1000, duration: 500, easing: EASE, fill: 'both' });
    return s;
  },

  code(p, t0) {
    const s = el(`<div class="scene"><div class="center" style="gap:40px">
      <div class="term glass"><span class="p">$</span><span>npm install @cadence/engine</span></div>
      <div class="code glass-strong"><div class="top"><i></i><i></i><i></i><span>speak.js</span></div><pre></pre></div>
      <div class="row" style="gap:16px"><div class="chip sm glass">${icon('globe')} Browser</div><div class="chip sm glass">${icon('terminal')} Node.js</div></div>
    </div></div>`);
    const [term, code, chips] = s.querySelector('.center').children;
    show(term, 0.1, 'up');
    show(code, 0.35, 'up');
    const SRC = [
      ['k', 'import'], ['', ' { createEngine }\n  '], ['k', 'from'], ['s', " '@cadence/engine'"], ['', ';\n\n'],
      ['k', 'const'], ['', ' engine = '], ['f', 'createEngine'], ['', '();\n'],
      ['k', 'const'], ['', ' { samples } = '], ['k', 'await'], ['', ' engine\n  .'], ['f', 'synthesize'], ['', '({ text: '], ['s', "'Hello!'"], ['', ' });'],
    ];
    const total = SRC.reduce((n, [, x]) => n + x.length, 0);
    const pre = code.querySelector('pre');
    // Typed while the line is spoken, done before it ends.
    const from = t0 + p.start + 0.3;
    const to = t0 + p.start + LEAD + p.voDur * 0.8;
    let shown = -1;
    const fn = (n) => {
      const k = Math.min(1, Math.max(0, (n - from) / (to - from)));
      const count = Math.floor(k * total);
      if (count !== shown) {
        shown = count;
        let left = count;
        let html = '';
        for (const [cls, text] of SRC) {
          if (left <= 0) break;
          const part = text.slice(0, left);
          left -= part.length;
          const safe = part.replace(/&/g, '&amp;').replace(/</g, '&lt;');
          html += cls ? `<span class="${cls}">${safe}</span>` : safe;
        }
        pre.innerHTML = `${html}<span class="caret"></span>`;
      }
      if (n > t0 + p.end) live.delete(fn);
    };
    live.add(fn);
    show(chips.children[0], phraseAt(p, 'three lines'), 'pop');
    show(chips.children[1], phraseAt(p, 'JavaScript'), 'pop');
    return s;
  },

  open(p) {
    const s = el(`<div class="scene"><div class="center" style="gap:44px">
      <div class="glass-strong" style="display:grid;justify-items:center;gap:20px;padding:44px 60px;border-radius:40px">
        <div class="icon-tile good" style="width:130px;height:130px;border-radius:36px">${icon('shield', 'style="width:68px;height:68px"')}</div>
        <div style="font-size:28px;color:var(--ink-3);letter-spacing:.14em;text-transform:uppercase">Open source</div>
        <div class="h-md" style="font-size:104px">Apache-2.0</div>
      </div>
      <div style="display:grid;gap:16px;justify-items:center"><div class="chip sm glass">${icon('check')} Free for commercial use</div><div class="chip sm glass">${icon('check')} No copyleft</div></div>
      <div class="url">github.com/Saeed-Hussain/Cadence</div>
    </div></div>`);
    const [badge, chips, url] = s.querySelector('.center').children;
    show(badge, phraseAt(p, 'Open source') - 0.1, 'pop', 0.9);
    show(chips.children[0], phraseAt(p, 'Free for') - 0.05, 'pop');
    show(chips.children[1], phraseAt(p, 'commercial') + 0.25, 'pop');
    show(url, phraseAt(p, 'commercial use') + 0.5, 'up');
    return s;
  },

  credit(p) {
    const s = el(`<div class="scene"><div class="center" style="gap:46px">
      <div class="orb" style="--size:420px;--h1:262;--h2:300;--h3:200"></div>
      <div class="h-md">This voiceover?<br>Made by <span class="grad">Cadence.</span></div>
      <div class="sub" style="font-size:34px">Voice: Heart · Cadence HD · no cloud</div>
    </div></div>`);
    const [orb, h, sub] = s.querySelector('.center').children;
    show(orb, 0.1, 'pop', 1.1);
    show(h, phraseAt(p, 'Made by') - 0.3, 'up');
    show(sub, phraseAt(p, 'Cadence') + 0.3, 'up');
    return s;
  },

  cta(p) {
    corner.animate([{ opacity: 1 }, { opacity: 0 }], { duration: 600, fill: 'forwards' });
    field.classList.add('bright');
    const s = el(`<div class="scene"><div class="center" style="gap:40px">
      <div class="mark big" style="width:170px;height:170px;border-radius:48px">${MARK}</div>
      <div class="h-md" style="color:var(--ink-2)">Stop paying<br>per character.</div>
      <div class="h-lg">Try <span class="grad">Cadence</span><br>today.</div>
      <div class="term glass" style="margin-top:10px"><span class="p">$</span><span>npm install @cadence/engine</span></div>
      <div class="url" style="font-size:30px">github.com/Saeed-Hussain/Cadence</div>
    </div></div>`);
    const [m, a, b, term, url] = s.querySelector('.center').children;
    show(m, 0.05, 'pop', 1.0);
    show(a, phraseAt(p, 'Stop') - 0.1, 'up');
    show(b, phraseAt(p, 'Try Cadence') - 0.1, 'blur', 1.0);
    show(term, phraseAt(p, 'today') + 0.4, 'up');
    show(url, phraseAt(p, 'today') + 0.7, 'up');
    return s;
  },
};

// ─── Running the film ────────────────────────────────────────────────────
const stage = document.querySelector('.stage');
let filmT0 = 0;
const now = () => (EXPORT ? clockT : ctx.currentTime);

function runScene(p) {
  const prev = stage.lastElementChild;
  if (prev) {
    prev.animate([{ opacity: 1, transform: 'none', filter: 'blur(0)' }, { opacity: 0, transform: 'scale(1.035)', filter: 'blur(10px)' }], { duration: XFADE * 1000, easing: EASE, fill: 'forwards' });
    later(XFADE + 0.05, () => prev.remove());
  }
  const node = (REEL ? REEL_SCENES : SCENES)[p.id](p, filmT0);
  node.animate([{ opacity: 0 }, { opacity: 1 }], { duration: XFADE * 1000, easing: EASE, fill: 'forwards' });
  stage.append(node);
  caption(p, filmT0);
}

/**
 * Play the whole film once. Resolves when the last frame has faded.
 * `film.startedAt` is the wall-clock time (ms since the epoch) of film time
 * zero, for timing captured frames against the soundtrack.
 */
export async function play() {
  await ctx.resume();
  filmT0 = ctx.currentTime + 0.4;
  film.startedAt = performance.timeOrigin + performance.now() + (filmT0 - ctx.currentTime) * 1000;
  liveSound.score(filmT0);
  requestAnimationFrame(frame);
  // Scene changes are driven by the audio clock, so picture follows sound.
  for (const p of plan) {
    await waitUntil(filmT0 + p.start);
    runScene(p);
  }
  await waitUntil(filmT0 + TOTAL - 1.1);
  document.querySelector('.fade-black').animate([{ opacity: 0 }, { opacity: 1 }], { duration: 1000, fill: 'forwards' });
  await waitUntil(filmT0 + TOTAL);
}

function waitUntil(time) {
  return new Promise((resolve) => {
    const check = () => (ctx.currentTime >= time ? resolve() : setTimeout(check, 8));
    check();
  });
}

/**
 * The soundtrack as AAC in MP4, the only AAC encoder this browser offers
 * being MediaRecorder's. The offline render is played into it behind a short
 * marker tone, so where the music starts in the encoded file can be found to
 * the sample afterwards (`MARKER_AT`, `MIX_AT`, seconds into the recording's
 * own timeline).
 */
const MARKER_AT = 0.5;
const MIX_AT = 1.0;
export async function encodeSoundtrack(sink) {
  const [l, r] = await renderSoundtrack();
  const rate = 48000;
  const ac = new AudioContext({ sampleRate: rate });
  const len = Math.ceil(MIX_AT * rate) + l.length + rate;
  const buf = ac.createBuffer(2, len, rate);
  for (const [ch, data] of [[0, l], [1, r]]) {
    const d = buf.getChannelData(ch);
    for (let i = 0; i < Math.round(0.02 * rate); i++) d[Math.round(MARKER_AT * rate) + i] = 0.8 * Math.sin((2 * Math.PI * 1000 * i) / rate);
    d.set(data, Math.round(MIX_AT * rate));
  }
  const dest = ac.createMediaStreamDestination();
  const rec = new MediaRecorder(dest.stream, { mimeType: 'audio/mp4;codecs=mp4a.40.2', audioBitsPerSecond: 256000 });
  const pending = [];
  rec.ondataavailable = (e) => { if (e.data.size) pending.push(e.data.arrayBuffer().then((b) => sink(new Uint8Array(b)))); };
  const stopped = new Promise((res) => { rec.onstop = res; });
  rec.start(1000);
  await new Promise((res) => setTimeout(res, 300));
  const src = ac.createBufferSource();
  src.buffer = buf;
  src.connect(dest);
  src.start(ac.currentTime + 0.05);
  await new Promise((res) => { src.onended = res; });
  await new Promise((res) => setTimeout(res, 300));
  rec.stop();
  await stopped;
  await Promise.all(pending);
  return { MARKER_AT, MIX_AT, seconds: TOTAL };
}

/** Where the marker tone landed in an encoded soundtrack, by decoding it. */
export async function findMarker(url) {
  const ac = new OfflineAudioContext(1, 48000, 48000);
  const a = await ac.decodeAudioData(await (await fetch(url)).arrayBuffer());
  const d = a.getChannelData(0);
  for (let i = 0; i < d.length; i++) if (Math.abs(d[i]) > 0.3) return { at: i / a.sampleRate, rate: a.sampleRate };
  return null;
}

// ─── Export: the film, one exact frame at a time ──────────────────────────
/** The narrator's loudness, sixty times a second, as the live analyser would read it. */
function voiceEnvelope() {
  const env = new Float32Array(Math.ceil(TOTAL * 60) + 1);
  plan.forEach((p, i) => {
    const d = voices[i].getChannelData(0);
    const rate = voices[i].sampleRate;
    const win = Math.round(rate / 60);
    for (let k = 0; k * win < d.length; k++) {
      let sum = 0;
      const end = Math.min(d.length, (k + 1) * win);
      for (let s = k * win; s < end; s++) sum += d[s] * d[s];
      const at = Math.floor((p.vo + k / 60) * 60);
      if (at < env.length) env[at] = Math.min(1, Math.sqrt(sum / (end - k * win)) * 4.2);
    }
  });
  return env;
}

let envelope = null;
let nextScene = 0;
let faded = false;
/** Put the film at time t (seconds) and wait until that frame is painted. */
export async function seek(t) {
  envelope ??= voiceEnvelope();
  clockT = t;
  while (nextScene < plan.length && plan[nextScene].start <= t) {
    creating = plan[nextScene].start;
    runScene(plan[nextScene++]);
  }
  if (!faded && t >= TOTAL - 1.1) {
    faded = true;
    creating = TOTAL - 1.1;
    document.querySelector('.fade-black').animate([{ opacity: 0 }, { opacity: 1 }], { duration: 1000, fill: 'forwards' });
  }
  pending.sort((a, b) => a[0] - b[0]);
  while (pending.length && pending[0][0] <= t) {
    const [at, fn] = pending.shift();
    creating = at;
    fn();
  }
  creating = t;
  const target = envelope[Math.min(envelope.length - 1, Math.floor(t * 60))];
  setLevel(target);
  setLevel(target);
  for (const fn of live) fn(t);
  for (const a of document.getAnimations()) {
    if (!born.has(a)) { born.set(a, t); a.pause(); }
    a.currentTime = Math.max(0, (t - born.get(a)) * 1000);
  }
  await new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(r)));
}

const film = { play, seek, encodeSoundtrack, findMarker, renderSoundtrack, TOTAL, plan, startedAt: 0 };
window.film = film;
document.body.dataset.ready = '1';
