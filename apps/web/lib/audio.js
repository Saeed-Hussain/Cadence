'use client';

import { useSyncExternalStore } from 'react';

/**
 * One audio output for the whole app.
 *
 * Every play button — a voice preview in the library, a generation, a history
 * row — routes through here, so only one thing ever speaks at a time and the
 * player bar always shows what that thing is. It lives outside React: the
 * position ticks sixty times a second while playing, and only the components
 * that select it re-render.
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
 * @property {number} position   seconds
 * @property {number} duration   seconds
 * @property {number} volume
 * @property {number} level      0–1, loudness right now
 */

/** @type {PlayerState} */
let state = { track: null, playing: false, position: 0, duration: 0, volume: 1, level: 0 };
const listeners = new Set();

/** @type {AudioContext | null} */
let ctx = null;
/** @type {GainNode | null} */
let gain = null;
/** @type {AnalyserNode | null} */
let analyser = null;
/** @type {AudioBufferSourceNode | null} */
let source = null;
/** @type {AudioBuffer | null} */
let buffer = null;
let startedAt = 0;
let offset = 0;
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
  return ctx;
}

function tick() {
  if (!ctx || !state.playing) return;
  const position = Math.min(offset + ctx.currentTime - startedAt, state.duration);
  let level = 0;
  if (analyser) {
    scratch ??= new Float32Array(analyser.fftSize);
    analyser.getFloatTimeDomainData(scratch);
    let sum = 0;
    for (const x of scratch) sum += x * x;
    level = Math.min(1, Math.sqrt(sum / scratch.length) * 3.2);
  }
  set({ position, level });
  raf = requestAnimationFrame(tick);
}

function startSource(at = 0) {
  const c = context();
  if (!buffer || !gain) return;
  stopSource();
  const node = c.createBufferSource();
  node.buffer = buffer;
  node.connect(gain);
  node.onended = () => {
    if (source !== node) return;
    source = null;
    offset = 0;
    cancelAnimationFrame(raf);
    set({ playing: false, position: state.duration, level: 0 });
  };
  node.start(0, at);
  source = node;
  startedAt = c.currentTime;
  offset = at;
  cancelAnimationFrame(raf);
  set({ playing: true, position: at });
  raf = requestAnimationFrame(tick);
}

function stopSource() {
  if (source) {
    const s = source;
    source = null;
    try { s.stop(); } catch { /* already stopped */ }
  }
  cancelAnimationFrame(raf);
}

export const player = {
  /** @param {Track} track */
  play(track) {
    const c = context();
    if (c.state === 'suspended') c.resume();
    buffer = c.createBuffer(1, track.samples.length, track.sampleRate);
    buffer.copyToChannel(new Float32Array(track.samples), 0);
    set({ track, duration: buffer.duration, position: 0 });
    startSource(0);
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
    stopSource();
    offset = position;
    set({ playing: false, position, level: 0 });
  },

  resume() {
    if (!state.track) return;
    const c = context();
    if (c.state === 'suspended') c.resume();
    const at = state.position >= state.duration - 0.02 ? 0 : state.position;
    startSource(at);
  },

  /** @param {number} seconds */
  seek(seconds) {
    const at = Math.max(0, Math.min(seconds, state.duration));
    if (state.playing) startSource(at);
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
    stopSource();
    buffer = null;
    offset = 0;
    set({ track: null, playing: false, position: 0, duration: 0, level: 0 });
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
