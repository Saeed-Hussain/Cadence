'use client';

import {
  createContext, useCallback, useContext, useEffect, useMemo, useRef, useState,
} from 'react';
import { DEFAULT_VOICE_ID, MODELS, VOICES, createEngine } from '@cadence/engine';
import { player } from './audio.js';

/**
 * Everything the app remembers, in one place.
 *
 * The engine is created once per tab. Swift loads after the first paint; HD
 * loads only when an HD voice is first used, so nobody downloads 326 MB they
 * did not ask for.
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
 * @property {number} sampleRate
 * @property {{rtf: number, ttfaMs: number, elapsedMs: number, backend: string, gaps?: number, gapMs?: number}} stats
 * @property {'tts' | 'studio'} source
 */

export const DEFAULT_SETTINGS = /** @type {Settings} */ ({ speed: 1 });

// v3: voice ids changed when the library moved to measured Swift speakers.
const KEY = {
  favorites: 'cadence:favorites:v3',
  custom: 'cadence:custom-voices:v3',
  history: 'cadence:history:v3',
  settings: 'cadence:settings',
  voice: 'cadence:voice:v3',
};

/** @param {Voice} v */
const rateOf = (v) => (MODELS.find((m) => m.id === v.model) ?? MODELS[0]).sampleRate;

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
  const [models, setModels] = useState(() => ({ swift: engine.state('swift'), hd: engine.state('hd') }));
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

  useEffect(() => engine.subscribe(setModels), [engine]);

  const toast = useCallback((/** @type {string} */ message, tone = 'info') => {
    const id = Date.now() + Math.random();
    setToasts((t) => [...t, { id, message, tone }]);
    setTimeout(() => setToasts((t) => t.filter((x) => x.id !== id)), 3600);
  }, []);

  // Restore after mount, so the server render and the first client render
  // agree, then start fetching the model in the background.
  useEffect(() => {
    setFavorites(read(KEY.favorites, VOICES.slice(0, 6).map((v) => v.id)));
    setCustom(read(KEY.custom, []));
    setHistory(read(KEY.history, []));
    setSettings({ ...DEFAULT_SETTINGS, ...read(KEY.settings, {}) });
    setVoiceId(read(KEY.voice, DEFAULT_VOICE_ID));
    setHydrated(true);
    // Ask the browser not to evict the weights when space runs low.
    navigator.storage?.persist?.().catch(() => {});
    engine.load('swift').catch((e) => toast(`Swift failed to load: ${e.message}`, 'error'));
  }, [engine, toast]);

  /** Try a model that failed to load again. */
  const retryModel = useCallback((/** @type {'swift' | 'hd'} */ id) => {
    engine.load(id).catch((e) => toast(`${id === 'swift' ? 'Swift' : 'HD'} failed to load: ${e.message}`, 'error'));
  }, [engine, toast]);

  // A download that failed for want of a network resumes when it returns.
  useEffect(() => {
    const onOnline = () => {
      for (const id of /** @type {const} */ (['swift', 'hd'])) {
        if (engine.state(id).status === 'error') retryModel(id);
      }
    };
    addEventListener('online', onOnline);
    return () => removeEventListener('online', onOnline);
  }, [engine, retryModel]);

  // While the model works, the interface steps out of its way: the ambient
  // animations pause (see globals.css), so the CPU goes to speech.
  useEffect(() => {
    if (generating) document.documentElement.dataset.busy = '';
    else delete document.documentElement.dataset.busy;
  }, [generating]);

  // The app shell is kept by a service worker, so with the weights in cache
  // the whole playground works with the network off. Production only: in
  // development it would serve stale code.
  const [offlineReady, setOfflineReady] = useState(false);
  useEffect(() => {
    if (!('serviceWorker' in navigator)) return;
    if (process.env.NODE_ENV !== 'production') {
      // A worker left by a production run on this port would serve old code.
      navigator.serviceWorker.getRegistrations().then((rs) => rs.forEach((r) => r.unregister())).catch(() => {});
      return;
    }
    navigator.serviceWorker.register('/sw.js').then(async (reg) => {
      await navigator.serviceWorker.ready;
      // The first visit loaded its files before the worker existed; hand it the list.
      const urls = [location.pathname, ...performance.getEntriesByType('resource').map((r) => r.name)]
        .filter((u) => new URL(u, location.href).origin === location.origin);
      reg.active?.postMessage({ type: 'keep', urls });
    }).catch(() => { /* no offline shell; online use is unaffected */ });
  }, []);
  useEffect(() => {
    if (models.swift.status !== 'ready') return;
    let live = true;
    const check = () => engine.onDevice('swift').then((ok) => {
      if (live) setOfflineReady(ok && !!navigator.serviceWorker?.controller);
    });
    check();
    navigator.serviceWorker?.addEventListener('controllerchange', check);
    return () => { live = false; navigator.serviceWorker?.removeEventListener('controllerchange', check); };
  }, [engine, models.swift.status]);

  useEffect(() => { if (hydrated) write(KEY.favorites, favorites); }, [hydrated, favorites]);
  useEffect(() => { if (hydrated) write(KEY.custom, custom); }, [hydrated, custom]);
  useEffect(() => { if (hydrated) write(KEY.history, history.slice(0, 200)); }, [hydrated, history]);
  useEffect(() => { if (hydrated) write(KEY.settings, settings); }, [hydrated, settings]);
  useEffect(() => { if (hydrated) write(KEY.voice, voiceId); }, [hydrated, voiceId]);

  const voices = useMemo(() => [...custom, ...VOICES], [custom]);
  const byId = useMemo(() => new Map(voices.map((v) => [v.id, v])), [voices]);
  const voice = byId.get(voiceId) ?? VOICES[0];
  const activeModel = MODELS.find((m) => m.id === voice.model) ?? MODELS[0];
  const engineState = models[activeModel.id];

  // The HD model is large; fetch it only once an HD voice is actually chosen.
  useEffect(() => {
    if (hydrated && voice.model === 'hd') engine.load('hd').catch((e) => toast(`HD failed to load: ${e.message}`, 'error'));
  }, [hydrated, voice.model, engine, toast]);

  const toggleFavorite = useCallback((/** @type {string} */ id) => {
    setFavorites((f) => (f.includes(id) ? f.filter((x) => x !== id) : [id, ...f]));
  }, []);

  /**
   * Switch model by switching voice: to a saved voice of that model if there
   * is one, otherwise to the model's first voice.
   */
  const chooseModel = useCallback((/** @type {'swift' | 'hd'} */ id) => {
    if (voice.model === id) return;
    const next = favorites.map((f) => byId.get(f)).find((v) => v?.model === id) ?? VOICES.find((v) => v.model === id);
    if (next) setVoiceId(next.id);
  }, [voice.model, favorites, byId]);

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
    const meta = { id, kind: /** @type {const} */ ('preview'), title: v.name, subtitle: 'Voice preview', voiceId: v.id };
    previewAbort.current?.abort();
    const ctrl = new AbortController();
    previewAbort.current = ctrl;
    const instant = await engine.hasPreview(v);
    if (!instant) setPreviewing(v.id);
    try {
      const { samples, sampleRate } = await engine.preview(v, ctrl.signal);
      if (ctrl.signal.aborted) return;
      player.toggleTrack({ ...meta, samples, sampleRate });
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
      ? player.stream({ id, kind: 'generation', title: v.name, subtitle: clean, voiceId: v.id, sampleRate: rateOf(v) })
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
        sampleRate: result.sampleRate,
        stats: {
          rtf: result.stats.rtf, ttfaMs: result.stats.ttfaMs,
          elapsedMs: result.stats.elapsedMs, backend: result.stats.backend,
          ...stream?.gaps(),
        },
        source,
      };
      cache.current.set(id, result.samples);
      keepAudio(id, result.samples);
      setHistory((h) => [entry, ...h]);
      return { entry, samples: result.samples, sampleRate: result.sampleRate };
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
        voiceId: entry.voiceId, samples, sampleRate: entry.sampleRate,
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
    engine, engineState, models, activeModel, hydrated, retryModel, offlineReady,
    voices, byId, voice, voiceId, setVoiceId,
    favorites, toggleFavorite,
    custom, addClone, removeClone,
    settings, setSettings,
    history, removeEntry, clearHistory, playEntry, audioFor,
    generating, generate, stop, previewVoice, previewing, chooseModel,
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
