'use client';

import { useSyncExternalStore } from 'react';

/**
 * One audio output for the whole app.
 *
 * Every play button — a voice preview, a generation, a history row — routes
 * through here, so only one thing ever speaks at a time and the player bar
 * always shows what that thing is. It lives outside React: the position ticks
 * sixty times a second while playing, and only the components that select it
 * re-render.
 *
 * A track can be a stream: playback starts on the first sentence while the
 * engine is still producing the rest, and each new sentence is scheduled to
 * begin exactly where the previous one ends.
 */

/**
 * @typedef {object} Track
 * @property {string} id
 * @property {string} title
 * @property {string} [subtitle]
 * @property {string} [voiceId]
 * @property {'preview' | 'generation'} kind
 * @property {Float32Array} samples
 * @property {number} sampleRate
 */

/**
 * @typedef {object} PlayerState
 * @property {Track | null} track
 * @property {boolean} playing
 * @property {boolean} streaming  more audio is still on its way
 * @property {boolean} waiting    playing, but caught up with the engine
 * @property {number} position   seconds
 * @property {number} duration   seconds
 * @property {number} volume
 * @property {number} level      0–1, loudness right now
 */

/** @type {PlayerState} */
let state = { track: null, playing: false, streaming: false, waiting: false, position: 0, duration: 0, volume: 1, level: 0 };
const listeners = new Set();

/** @type {AudioContext | null} */
let ctx = null;
/** @type {GainNode | null} */
let gain = null;
/** @type {AnalyserNode | null} */
let analyser = null;
/** @type {Set<AudioBufferSourceNode>} */
const sources = new Set();
/** @type {AudioBuffer | null} */
let buffer = null;
let bufferFor = /** @type {Float32Array | null} */ (null);
/** Context time at which `offset` seconds of the track were (or will be) heard. */
let startedAt = 0;
let offset = 0;
/** Context time at which everything scheduled so far finishes. */
let scheduledEnd = 0;
let raf = 0;
/** @type {Float32Array<ArrayBuffer> | null} */
let scratch = null;

/** @param {Partial<PlayerState>} patch */
function set(patch) {
  state = { ...state, ...patch };
  for (const fn of listeners) fn();
}

function context() {
  if (!ctx) {
    ctx = new AudioContext();
    gain = ctx.createGain();
    analyser = ctx.createAnalyser();
    analyser.fftSize = 512;
    gain.connect(analyser);
    analyser.connect(ctx.destination);
    gain.gain.value = state.volume;
  }
  if (ctx.state === 'suspended') ctx.resume();
  return ctx;
}

/** The whole track so far as one AudioBuffer, rebuilt only when it grew. */
function fullBuffer() {
  const t = state.track;
  if (!t || !t.samples.length) return null;
  if (buffer && bufferFor === t.samples) return buffer;
  const c = context();
  buffer = c.createBuffer(1, t.samples.length, t.sampleRate);
  buffer.copyToChannel(new Float32Array(t.samples), 0);
  bufferFor = t.samples;
  return buffer;
}

/** @param {AudioBuffer} buf @param {number} when @param {number} [from] */
function schedule(buf, when, from = 0) {
  const c = context();
  const node = c.createBufferSource();
  node.buffer = buf;
  node.connect(/** @type {GainNode} */ (gain));
  node.onended = () => sources.delete(node);
  node.start(when, from);
  sources.add(node);
}

function stopAll() {
  for (const s of sources) {
    try { s.stop(); } catch { /* already stopped */ }
  }
  sources.clear();
  cancelAnimationFrame(raf);
}

function tick() {
  if (!ctx || !state.playing) return;
  const position = Math.min(offset + ctx.currentTime - startedAt, state.duration);
  const atEnd = position >= state.duration - 0.01;
  if (atEnd && !state.streaming) {
    stopAll();
    offset = 0;
    set({ playing: false, waiting: false, position: state.duration, level: 0 });
    return;
  }
  let level = 0;
  if (analyser) {
    scratch ??= new Float32Array(analyser.fftSize);
    analyser.getFloatTimeDomainData(scratch);
    let sum = 0;
    for (const x of scratch) sum += x * x;
    level = Math.min(1, Math.sqrt(sum / scratch.length) * 3.2);
  }
  set({ position, level, waiting: atEnd && state.streaming });
  raf = requestAnimationFrame(tick);
}

/** @param {number} at seconds into the track */
function startAt(at) {
  const c = context();
  stopAll();
  const buf = fullBuffer();
  const now = c.currentTime + 0.01;
  startedAt = now;
  offset = at;
  scheduledEnd = now + Math.max(0, state.duration - at);
  if (buf && at < state.duration) schedule(buf, now, at);
  set({ playing: true, position: at });
  raf = requestAnimationFrame(tick);
}

export const player = {
  /** @param {Track} track */
  play(track) {
    stopAll();
    set({ track, streaming: false, waiting: false, duration: track.samples.length / track.sampleRate, position: 0 });
    startAt(0);
  },

  /**
   * Start a track whose audio has not been made yet. Push each piece as it
   * arrives; call `end` when there is no more.
   *
   * @param {Omit<Track, 'samples'>} meta
   */
  stream(meta) {
    stopAll();
    const c = context();
    set({ track: { ...meta, samples: new Float32Array(0) }, streaming: true, waiting: true, duration: 0, position: 0, playing: true });
    startedAt = c.currentTime;
    offset = 0;
    scheduledEnd = startedAt;
    raf = requestAnimationFrame(tick);

    const mine = () => state.track?.id === meta.id;
    return {
      /** @param {Float32Array} chunk */
      push(chunk) {
        if (!mine() || !state.track) return;
        const prev = state.track.samples;
        const next = new Float32Array(prev.length + chunk.length);
        next.set(prev);
        next.set(chunk, prev.length);
        const duration = next.length / meta.sampleRate;
        set({ track: { ...state.track, samples: next }, duration });
        if (!state.playing) return;
        const cc = context();
        const piece = cc.createBuffer(1, chunk.length, meta.sampleRate);
        piece.copyToChannel(new Float32Array(chunk), 0);
        const when = Math.max(scheduledEnd, cc.currentTime + 0.02);
        // The engine fell behind: the clock ran on through silence. Move the
        // track's origin so the playhead does not count the gap as audio.
        startedAt += when - scheduledEnd;
        schedule(piece, when);
        scheduledEnd = when + piece.duration;
      },
      end() {
        if (mine()) set({ streaming: false });
      },
      /** The engine gave up; keep what arrived. */
      fail() {
        if (mine()) set({ streaming: false });
      },
    };
  },

  /** Play `track`, or pause it if it is the one already playing. */
  /** @param {Track} track */
  toggleTrack(track) {
    if (state.track?.id === track.id) player.toggle();
    else player.play(track);
  },

  toggle() {
    if (!state.track) return;
    if (state.playing) player.pause();
    else player.resume();
  },

  pause() {
    if (!ctx || !state.playing) return;
    const position = Math.min(offset + ctx.currentTime - startedAt, state.duration);
    stopAll();
    offset = position;
    set({ playing: false, waiting: false, position, level: 0 });
  },

  resume() {
    if (!state.track) return;
    const at = state.position >= state.duration - 0.02 && !state.streaming ? 0 : state.position;
    startAt(at);
  },

  /** @param {number} seconds */
  seek(seconds) {
    const at = Math.max(0, Math.min(seconds, state.duration));
    if (state.playing) startAt(at);
    else {
      offset = at;
      set({ position: at });
    }
  },

  /** @param {number} delta */
  skip(delta) {
    player.seek(state.position + delta);
  },

  /** @param {number} volume */
  setVolume(volume) {
    if (gain) gain.gain.value = volume;
    set({ volume });
  },

  close() {
    stopAll();
    buffer = null;
    bufferFor = null;
    offset = 0;
    set({ track: null, playing: false, streaming: false, waiting: false, position: 0, duration: 0, level: 0 });
  },
};

/** Loudness right now, 0–1, read without subscribing. */
export const getLevel = () => state.level;

/** @param {() => void} fn */
function subscribe(fn) {
  listeners.add(fn);
  return () => listeners.delete(fn);
}

const SERVER = state;

/**
 * Subscribe to one slice of the player. Return a primitive from `select` and
 * the component re-renders only when that primitive changes.
 *
 * @template T
 * @param {(s: PlayerState) => T} select
 * @returns {T}
 */
export function usePlayer(select) {
  return useSyncExternalStore(subscribe, () => select(state), () => select(SERVER));
}

/** Whether the track with this id is the one playing right now. */
/** @param {string} id */
export function useIsPlaying(id) {
  return usePlayer((s) => s.playing && s.track?.id === id);
}
