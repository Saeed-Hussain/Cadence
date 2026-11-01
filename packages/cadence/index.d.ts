/**
 * @cadence/engine — speech synthesis that runs on the user's own device.
 *
 * Browser entry. Inference runs in Web Workers; the page never blocks.
 * For Node, import '@cadence/engine/node'.
 */

export type ModelId = 'swift' | 'hd';
export type Status = 'idle' | 'loading' | 'ready' | 'error';

export interface Voice {
  id: string;
  name: string;
  model: ModelId;
  gender: 'female' | 'male' | 'unclear';
  accent: string;
  language: string;
  kind: 'original' | 'blend' | 'matched';
  /** Quality grade where one is published, else '—'. */
  grade: string;
  /** Measured mean pitch, Hz. */
  pitch: number;
  description: string;
  tags: string[];
  /** Three hues for drawing the voice. */
  hues: [number, number, number];
  source: 'library' | 'cloned';
  /** Swift: speaker index in the model. */
  speaker?: number;
  /** Swift: measured pace. */
  wordsPerMinute?: number;
  /** HD: American ('a') or British ('b') phonemiser. */
  lang?: 'a' | 'b';
  /** HD: embedding ids and weights. */
  mix?: [string, number][];
}

export interface ModelState {
  status: Status;
  /** 0–1. */
  progress: number;
  /** Downloading, reading from this device's cache, or starting the model. */
  phase: 'download' | 'cache' | 'init';
  error: string;
}

export interface ModelInfo {
  id: ModelId;
  name: string;
  tagline: string;
  description: string;
  weights: string;
  sampleRate: number;
}

export interface Stats {
  backend: string;
  model: string;
  /** Seconds of audio. */
  seconds: number;
  elapsedMs: number;
  /** Time to first audio. */
  ttfaMs: number;
  /** Real-time factor: seconds of compute per second of audio. Under 1 is faster than real time. */
  rtf: number;
}

export interface Synthesis {
  samples: Float32Array;
  sampleRate: number;
  stats: Stats;
}

export interface SynthesizeRequest {
  text: string;
  /** A Voice, or a voice's id or name. The default voice when omitted. */
  voice?: string | Voice;
  settings?: { speed?: number };
  /** Called with each piece of audio as soon as it exists, in order. */
  onChunk?: (samples: Float32Array) => void;
  signal?: AbortSignal;
}

export interface EngineOptions {
  /** Where the app serves the ONNX Runtime WebAssembly files. Default '/ort/'. */
  wasmPaths?: string;
  /** Where the app serves the Swift weights, tried before the internet. Default '/models/'; null to skip. */
  /** WebAssembly threads of HD and of Swift's main worker. Default: from the hardware (swiftPool, swiftThreads). */
  threads?: number;
  /** Where the app serves the runtime HD pins. Default '/ort-hd/'. */
  hdWasmPaths?: string;
  /** false: never use the GPU helper. A function is asked when Swift first loads. Default: use it where the hardware allows. */
  gpu?: boolean | (() => boolean);
  /** false to speak Swift on one worker; by default helper workers are used where swiftPool allows. */
  pool?: boolean | (() => boolean);
  modelPaths?: string | null;
}

export interface Engine {
  models: readonly ModelInfo[];
  /** Called now and on every change. Returns an unsubscribe function. */
  subscribe(fn: (states: Record<ModelId, ModelState>) => void): () => void;
  state(id: ModelId): ModelState;
  /** Download (or read from cache) and start a model. Safe to call again after a failure. */
  load(id?: ModelId): Promise<void>;
  /** Whether a model's weights are stored on this device. */
  onDevice(id: ModelId): Promise<boolean>;
  /** Speak text. Resolves with the whole utterance, or null when cancelled through `signal`. */
  synthesize(request: SynthesizeRequest): Promise<Synthesis | null>;
  /** A voice's audition sample, rendered once and cached. */
  preview(voice: Voice, signal?: AbortSignal): Promise<{ samples: Float32Array; sampleRate: number }>;
  hasPreview(voice: Voice): Promise<boolean>;
  /** Match a recording to the nearest library voice by pitch (a stand-in for cloning). */
  clone(input: { name: string; samples: Float32Array; sampleRate: number; description?: string }): Voice;
}

export function createEngine(options?: EngineOptions): Engine;

export const MODELS: readonly ModelInfo[];
export const VOICES: Voice[];
export const DEFAULT_VOICE_ID: string;
export const PREVIEW_TEXT: string;
export const FACETS: Record<string, unknown>;

/** 16-bit PCM WAV bytes. */
export function encodeWav(samples: Float32Array, sampleRate: number): Uint8Array;
export function estimatePitch(samples: Float32Array, sampleRate: number): number;
export function matchPitch(pitch: number): Voice;
/** The pieces text is streamed in. */
export function chunks(text: string, options?: { first?: number; growth?: number; max?: number }): string[];
export function cpuThreads(): number;
export function hasWebGPU(): boolean;
/** The default thread count for Swift on this machine. */
export function swiftThreads(): number;
/** Swift's CPU pool for this hardware: main worker threads, helper workers, and threads each. */
export function swiftPool(): { threads: number; helpers: number; helperThreads: number };
