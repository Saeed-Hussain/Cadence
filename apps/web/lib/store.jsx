'use client';

import {
  createContext, useCallback, useContext, useEffect, useMemo, useRef, useState,
} from 'react';
import { DEFAULT_VOICE_ID, SAMPLE_RATE, VOICES, createEngine } from '@cadence/engine';
import { player } from './audio.js';

/**
 * Everything the app remembers, in one place.
 *
 * The engine is created once per tab and loads after the first paint.
 * Preferences, saved voices, matched voices and the history list persist to
 * local storage; generated audio persists to the browser cache, so replaying
 * yesterday's generation never runs the model again.
 */

/** @typedef {import('@cadence/engine').Voice} Voice */
/** @typedef {{speed: number}} Settings */
/**
 * @typedef {object} HistoryEntry
 * @property {string} id
 * @property {string} text
 * @property {string} voiceId
 * @property {string} voiceName
 * @property {Settings} settings
 * @property {string} model
 * @property {number} createdAt
 * @property {number} seconds
 * @property {{rtf: number, ttfaMs: number, elapsedMs: number, backend: string}} stats
 * @property {'tts' | 'studio'} source
 */

export const DEFAULT_SETTINGS = /** @type {Settings} */ ({ speed: 1 });

const KEY = {
  favorites: 'cadence:favorites',
  custom: 'cadence:custom-voices:v2',
  history: 'cadence:history:v2',
  settings: 'cadence:settings',
  voice: 'cadence:voice:v2',
  model: 'cadence:model:v2',
};

const AUDIO_CACHE = 'cadence-history';
const audioKey = (/** @type {string} */ id) => `https://cadence.local/history/${id}`;

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

/** @param {string} id @param {Float32Array} samples */
async function keepAudio(id, samples) {
  try {
    await (await caches.open(AUDIO_CACHE)).put(audioKey(id), new Response(samples.slice().buffer));
  } catch { /* not kept */ }
}

/** @param {string} id */
async function keptAudio(id) {
  try {
    const hit = await (await caches.open(AUDIO_CACHE)).match(audioKey(id));
    return hit ? new Float32Array(await hit.arrayBuffer()) : null;
  } catch {
    return null;
  }
}

const StoreContext = createContext(/** @type {ReturnType<typeof useStoreValue> | null} */ (null));

function useStoreValue() {
  const engine = useMemo(() => createEngine(), []);
  const [engineState, setEngineState] = useState({ status: engine.status, progress: 0, phase: /** @type {'download' | 'init'} */ ('download'), model: engine.model.id, error: '' });
  const [hydrated, setHydrated] = useState(false);

  const [favorites, setFavorites] = useState(/** @type {string[]} */ ([]));
  const [custom, setCustom] = useState(/** @type {Voice[]} */ ([]));
  const [history, setHistory] = useState(/** @type {HistoryEntry[]} */ ([]));
  const [settings, setSettings] = useState(DEFAULT_SETTINGS);
  const [voiceId, setVoiceId] = useState(DEFAULT_VOICE_ID);
  const [generating, setGenerating] = useState(false);
  const [previewing, setPreviewing] = useState(/** @type {string | null} */ (null));
  const [toasts, setToasts] = useState(/** @type {{id: number, message: string, tone: string}[]} */ ([]));

  /** Audio for generations made this session, keyed by history id. */
  const cache = useRef(/** @type {Map<string, Float32Array>} */ (new Map()));
  const previewAbort = useRef(/** @type {AbortController | null} */ (null));
  const generateAbort = useRef(/** @type {AbortController | null} */ (null));

  useEffect(() => engine.subscribe(setEngineState), [engine]);

  const toast = useCallback((/** @type {string} */ message, tone = 'info') => {
    const id = Date.now() + Math.random();
    setToasts((t) => [...t, { id, message, tone }]);
    setTimeout(() => setToasts((t) => t.filter((x) => x.id !== id)), 3600);
  }, []);

  // Restore after mount, so the server render and the first client render
  // agree, then start fetching the model in the background.
  useEffect(() => {
    setFavorites(read(KEY.favorites, VOICES.slice(0, 6).map((v) => v.id)).filter((id) => id.startsWith('m-') || VOICES.some((v) => v.id === id)));
    setCustom(read(KEY.custom, []));
    setHistory(read(KEY.history, []));
    setSettings({ ...DEFAULT_SETTINGS, ...read(KEY.settings, {}) });
    setVoiceId(read(KEY.voice, DEFAULT_VOICE_ID));
    const model = read(KEY.model, 'swift');
    setHydrated(true);
    const start = model !== 'swift' ? engine.setModel(model) : engine.load();
    Promise.resolve(start).catch((e) => toast(`Model failed to load: ${e.message}`, 'error'));
  }, [engine, toast]);

  useEffect(() => { if (hydrated) write(KEY.favorites, favorites); }, [hydrated, favorites]);
  useEffect(() => { if (hydrated) write(KEY.custom, custom); }, [hydrated, custom]);
  useEffect(() => { if (hydrated) write(KEY.history, history.slice(0, 200)); }, [hydrated, history]);
  useEffect(() => { if (hydrated) write(KEY.settings, settings); }, [hydrated, settings]);
  useEffect(() => { if (hydrated) write(KEY.voice, voiceId); }, [hydrated, voiceId]);

  const voices = useMemo(() => [...custom, ...VOICES], [custom]);
  const byId = useMemo(() => new Map(voices.map((v) => [v.id, v])), [voices]);
  const voice = byId.get(voiceId) ?? VOICES[0];

  const toggleFavorite = useCallback((/** @type {string} */ id) => {
    setFavorites((f) => (f.includes(id) ? f.filter((x) => x !== id) : [id, ...f]));
  }, []);

  const setModel = useCallback((/** @type {string} */ id) => {
    write(KEY.model, id);
    engine.setModel(id).catch((e) => toast(`Model failed to load: ${e.message}`, 'error'));
  }, [engine, toast]);

  /**
   * Audition a voice. The first time renders its sample (the model must be
   * loaded); after that it plays instantly, from cache, forever.
   *
   * @param {Voice} v
   */
  const previewVoice = useCallback(async (v) => {
    const id = `preview:${v.id}`;
    if (previewing === v.id) {
      previewAbort.current?.abort();
      setPreviewing(null);
      return;
    }
    const meta = { id, kind: /** @type {const} */ ('preview'), title: v.name, subtitle: 'Voice preview', voiceId: v.id, sampleRate: SAMPLE_RATE };
    previewAbort.current?.abort();
    const ctrl = new AbortController();
    previewAbort.current = ctrl;
    const instant = await engine.hasPreview(v);
    if (!instant) setPreviewing(v.id);
    try {
      const samples = await engine.preview(v, ctrl.signal);
      if (ctrl.signal.aborted) return;
      player.toggleTrack({ ...meta, samples });
    } catch (e) {
      if (/** @type {any} */ (e)?.name !== 'AbortError') toast(`Preview failed: ${/** @type {any} */ (e).message}`, 'error');
    } finally {
      setPreviewing((p) => (p === v.id ? null : p));
    }
  }, [engine, previewing, toast]);

  /**
   * Speak `text`, streaming into the player as each sentence is ready.
   *
   * @param {{text: string, voice?: Voice, settings?: Settings, source?: 'tts' | 'studio', autoplay?: boolean}} req
   */
  const generate = useCallback(async ({ text, voice: v = voice, settings: s = settings, source = 'tts', autoplay = true }) => {
    const clean = text.trim();
    if (!clean) return null;
    previewAbort.current?.abort();
    generateAbort.current?.abort();
    const ctrl = new AbortController();
    generateAbort.current = ctrl;
    const id = `g-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 6)}`;
    const stream = autoplay
      ? player.stream({ id, kind: 'generation', title: v.name, subtitle: clean, voiceId: v.id, sampleRate: SAMPLE_RATE })
      : null;
    setGenerating(true);
    try {
      const result = await engine.synthesize({ text: clean, voice: v, settings: s, signal: ctrl.signal, onChunk: (c) => stream?.push(c) });
      stream?.end();
      if (!result) return null;
      /** @type {HistoryEntry} */
      const entry = {
        id,
        text: clean,
        voiceId: v.id,
        voiceName: v.name,
        settings: s,
        model: result.stats.model,
        createdAt: Date.now(),
        seconds: result.stats.seconds,
        stats: {
          rtf: result.stats.rtf, ttfaMs: result.stats.ttfaMs,
          elapsedMs: result.stats.elapsedMs, backend: result.stats.backend,
        },
        source,
      };
      cache.current.set(id, result.samples);
      keepAudio(id, result.samples);
      setHistory((h) => [entry, ...h]);
      return { entry, samples: result.samples };
    } catch (e) {
      stream?.fail();
      toast(`Generation failed: ${/** @type {any} */ (e).message}`, 'error');
      return null;
    } finally {
      if (generateAbort.current === ctrl) {
        generateAbort.current = null;
        setGenerating(false);
      }
    }
  }, [engine, voice, settings, toast]);

  const stop = useCallback(() => {
    generateAbort.current?.abort();
  }, []);

  /** Audio for a history row: memory, then the browser cache, then the model. */
  const audioFor = useCallback(async (/** @type {HistoryEntry} */ entry) => {
    let samples = cache.current.get(entry.id) ?? (await keptAudio(entry.id));
    if (!samples) {
      const v = byId.get(entry.voiceId) ?? VOICES[0];
      const r = await engine.synthesize({ text: entry.text, voice: v, settings: entry.settings });
      if (!r) throw new Error('cancelled');
      samples = r.samples;
      keepAudio(entry.id, samples);
    }
    cache.current.set(entry.id, samples);
    return samples;
  }, [engine, byId]);

  const playEntry = useCallback(async (/** @type {HistoryEntry} */ entry) => {
    try {
      const samples = await audioFor(entry);
      player.toggleTrack({
        id: entry.id, kind: 'generation', title: entry.voiceName, subtitle: entry.text,
        voiceId: entry.voiceId, samples, sampleRate: SAMPLE_RATE,
      });
    } catch (e) {
      toast(`Could not play: ${/** @type {any} */ (e).message}`, 'error');
    }
  }, [audioFor, toast]);

  const removeEntry = useCallback((/** @type {string} */ id) => {
    setHistory((h) => h.filter((x) => x.id !== id));
    cache.current.delete(id);
    caches.open(AUDIO_CACHE).then((c) => c.delete(audioKey(id))).catch(() => {});
  }, []);

  const clearHistory = useCallback(() => {
    setHistory([]);
    cache.current.clear();
    caches.delete(AUDIO_CACHE).catch(() => {});
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
    history, removeEntry, clearHistory, playEntry, audioFor,
    generating, generate, stop, previewVoice, previewing, setModel,
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
