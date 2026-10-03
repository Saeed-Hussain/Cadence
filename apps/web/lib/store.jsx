'use client';

import {
  createContext, useCallback, useContext, useEffect, useMemo, useRef, useState,
} from 'react';
import { DEFAULT_VOICE_ID, VOICES, createEngine } from '@cadence/engine';
import { player } from './audio.js';

/**
 * Everything the app remembers, in one place.
 *
 * The engine is created once per tab. Preferences, saved voices, cloned voices
 * and the history list persist to local storage; generated audio does not —
 * the stub is deterministic, so a history row re-renders its audio on demand
 * from the request it recorded, and the real engine will cache instead.
 */

/** @typedef {import('@cadence/engine').Voice} Voice */
/** @typedef {{speed: number, stability: number, similarity: number, style: number, boost: boolean}} Settings */
/**
 * @typedef {object} HistoryEntry
 * @property {string} id
 * @property {string} text
 * @property {string} voiceId
 * @property {string} voiceName
 * @property {Settings} settings
 * @property {string} model
 * @property {number} seed
 * @property {number} createdAt
 * @property {number} seconds
 * @property {{rtf: number, ttfaMs: number, elapsedMs: number, backend: string}} stats
 * @property {'tts' | 'studio'} source
 */

export const DEFAULT_SETTINGS = /** @type {Settings} */ ({
  speed: 1, stability: 0.5, similarity: 0.75, style: 0, boost: true,
});

const KEY = {
  favorites: 'cadence:favorites',
  custom: 'cadence:custom-voices',
  history: 'cadence:history',
  settings: 'cadence:settings',
  voice: 'cadence:voice',
  model: 'cadence:model',
};

/** @template T @param {string} key @param {T} fallback @returns {T} */
function read(key, fallback) {
  try {
    const raw = localStorage.getItem(key);
    return raw ? JSON.parse(raw) : fallback;
  } catch {
    return fallback;
  }
}

/** @param {string} key @param {unknown} value */
function write(key, value) {
  try {
    localStorage.setItem(key, JSON.stringify(value));
  } catch {
    // Storage off or full. The session still works; it just forgets.
  }
}

const StoreContext = createContext(/** @type {ReturnType<typeof useStoreValue> | null} */ (null));

function useStoreValue() {
  const engine = useMemo(() => createEngine(), []);
  const [engineState, setEngineState] = useState({ status: engine.status, progress: 0, model: engine.model.id });
  const [hydrated, setHydrated] = useState(false);

  const [favorites, setFavorites] = useState(/** @type {string[]} */ ([]));
  const [custom, setCustom] = useState(/** @type {Voice[]} */ ([]));
  const [history, setHistory] = useState(/** @type {HistoryEntry[]} */ ([]));
  const [settings, setSettings] = useState(DEFAULT_SETTINGS);
  const [voiceId, setVoiceId] = useState(DEFAULT_VOICE_ID);
  const [generating, setGenerating] = useState(false);
  const [toasts, setToasts] = useState(/** @type {{id: number, message: string, tone: string}[]} */ ([]));

  /** Audio for generations made this session, keyed by history id. */
  const cache = useRef(/** @type {Map<string, Float32Array>} */ (new Map()));
  const previews = useRef(/** @type {Map<string, Float32Array>} */ (new Map()));

  useEffect(() => engine.subscribe(setEngineState), [engine]);

  // Restore after mount, so the server render and the first client render
  // agree, then start fetching the model — the picker works meanwhile.
  useEffect(() => {
    setFavorites(read(KEY.favorites, VOICES.slice(0, 6).map((v) => v.id)));
    setCustom(read(KEY.custom, []));
    setHistory(read(KEY.history, []));
    setSettings({ ...DEFAULT_SETTINGS, ...read(KEY.settings, {}) });
    setVoiceId(read(KEY.voice, DEFAULT_VOICE_ID));
    const model = read(KEY.model, 'swift');
    setHydrated(true);
    if (model !== 'swift') engine.setModel(model);
    else engine.load();
  }, [engine]);

  useEffect(() => { if (hydrated) write(KEY.favorites, favorites); }, [hydrated, favorites]);
  useEffect(() => { if (hydrated) write(KEY.custom, custom); }, [hydrated, custom]);
  useEffect(() => { if (hydrated) write(KEY.history, history.slice(0, 200)); }, [hydrated, history]);
  useEffect(() => { if (hydrated) write(KEY.settings, settings); }, [hydrated, settings]);
  useEffect(() => { if (hydrated) write(KEY.voice, voiceId); }, [hydrated, voiceId]);

  const voices = useMemo(() => [...custom, ...VOICES], [custom]);
  const byId = useMemo(() => new Map(voices.map((v) => [v.id, v])), [voices]);
  const voice = byId.get(voiceId) ?? VOICES[0];

  const toast = useCallback((/** @type {string} */ message, tone = 'info') => {
    const id = Date.now() + Math.random();
    setToasts((t) => [...t, { id, message, tone }]);
    setTimeout(() => setToasts((t) => t.filter((x) => x.id !== id)), 3200);
  }, []);

  const toggleFavorite = useCallback((/** @type {string} */ id) => {
    setFavorites((f) => (f.includes(id) ? f.filter((x) => x !== id) : [id, ...f]));
  }, []);

  const setModel = useCallback((/** @type {string} */ id) => {
    write(KEY.model, id);
    engine.setModel(id);
  }, [engine]);

  /** @param {Voice} v */
  const previewVoice = useCallback((v) => {
    const id = `preview:${v.id}`;
    let samples = previews.current.get(v.id);
    if (!samples) {
      samples = engine.preview(v).samples;
      previews.current.set(v.id, samples);
    }
    player.toggleTrack({
      id, kind: 'preview', title: v.name, subtitle: 'Voice preview', voiceId: v.id,
      samples, sampleRate: 24000,
    });
  }, [engine]);

  /**
   * @param {{text: string, voice?: Voice, settings?: Settings, source?: 'tts' | 'studio', autoplay?: boolean}} req
   */
  const generate = useCallback(async ({ text, voice: v = voice, settings: s = settings, source = 'tts', autoplay = true }) => {
    const clean = text.trim();
    if (!clean) return null;
    setGenerating(true);
    try {
      const seed = Math.floor(Math.random() * 1e6);
      const result = await engine.synthesize({ text: clean, voice: v, settings: s, seed });
      /** @type {HistoryEntry} */
      const entry = {
        id: `g-${Date.now().toString(36)}-${seed.toString(36)}`,
        text: clean,
        voiceId: v.id,
        voiceName: v.name,
        settings: s,
        model: result.stats.model,
        seed,
        createdAt: Date.now(),
        seconds: result.stats.seconds,
        stats: {
          rtf: result.stats.rtf, ttfaMs: result.stats.ttfaMs,
          elapsedMs: result.stats.elapsedMs, backend: result.stats.backend,
        },
        source,
      };
      cache.current.set(entry.id, result.samples);
      setHistory((h) => [entry, ...h]);
      if (autoplay) {
        player.play({
          id: entry.id, kind: 'generation', title: v.name, subtitle: clean,
          voiceId: v.id, samples: result.samples, sampleRate: result.sampleRate,
        });
      }
      return { entry, samples: result.samples };
    } finally {
      setGenerating(false);
    }
  }, [engine, voice, settings]);

  /** Audio for a history row, rendered again if this session never made it. */
  const audioFor = useCallback(async (/** @type {HistoryEntry} */ entry) => {
    let samples = cache.current.get(entry.id);
    if (!samples) {
      const v = byId.get(entry.voiceId) ?? VOICES[0];
      samples = (await engine.synthesize({ text: entry.text, voice: v, settings: entry.settings, seed: entry.seed })).samples;
      cache.current.set(entry.id, samples);
    }
    return samples;
  }, [engine, byId]);

  const playEntry = useCallback(async (/** @type {HistoryEntry} */ entry) => {
    const samples = await audioFor(entry);
    player.toggleTrack({
      id: entry.id, kind: 'generation', title: entry.voiceName, subtitle: entry.text,
      voiceId: entry.voiceId, samples, sampleRate: 24000,
    });
  }, [audioFor]);

  const removeEntry = useCallback((/** @type {string} */ id) => {
    setHistory((h) => h.filter((x) => x.id !== id));
    cache.current.delete(id);
  }, []);

  const addClone = useCallback((/** @type {Voice} */ v) => {
    setCustom((c) => [v, ...c]);
    setFavorites((f) => [v.id, ...f]);
    setVoiceId(v.id);
  }, []);

  const removeClone = useCallback((/** @type {string} */ id) => {
    setCustom((c) => c.filter((x) => x.id !== id));
    setFavorites((f) => f.filter((x) => x !== id));
    setVoiceId((cur) => (cur === id ? DEFAULT_VOICE_ID : cur));
  }, []);

  return {
    engine, engineState, hydrated,
    voices, byId, voice, voiceId, setVoiceId,
    favorites, toggleFavorite,
    custom, addClone, removeClone,
    settings, setSettings,
    history, setHistory, removeEntry, playEntry, audioFor,
    generating, generate, previewVoice, setModel,
    toasts, toast,
  };
}

/** @param {{children: React.ReactNode}} props */
export function StoreProvider({ children }) {
  const value = useStoreValue();
  return <StoreContext.Provider value={value}>{children}</StoreContext.Provider>;
}

export function useStore() {
  const value = useContext(StoreContext);
  if (!value) throw new Error('useStore outside StoreProvider');
  return value;
}
