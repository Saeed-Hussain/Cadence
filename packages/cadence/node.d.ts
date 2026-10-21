/**
 * @cadence/engine/node — the Swift model on the native runtime
 * (onnxruntime-node, a peer dependency).
 */

import type { Voice } from './index.js';

export type { Voice } from './index.js';

export interface NodeSynthesis {
  samples: Float32Array;
  sampleRate: number;
  stats: { seconds: number; elapsedMs: number; ttfaMs: number; rtf: number };
}

export interface NodeRequest {
  text: string;
  /** A Swift voice, or its id or name. The default voice when omitted. */
  voice?: string | Voice;
  /** 0.7–1.2 is natural. Default 1. */
  speed?: number;
  onChunk?: (samples: Float32Array) => void;
  signal?: AbortSignal;
}

export interface NodeEngine {
  sampleRate: number;
  /** native: onnxruntime-node. wasm: onnxruntime-web, slower, used when the native runtime is missing or will not load. */
  backend: 'native' | 'wasm';
  /** Why the engine is not native, when it is not. */
  warning: string;
  /** The voices this engine can speak with. */
  voices: Voice[];
  synthesize(request: NodeRequest): Promise<NodeSynthesis>;
  /** Speak straight into a WAV file. */
  toFile(path: string, request: Omit<NodeRequest, 'onChunk'>): Promise<NodeSynthesis>;
}

export interface NodeOptions {
  /** Where the weights are kept. Default $CADENCE_MODELS, else ~/.cache/cadence. */
  dir?: string;
  /** Threads for the runtime. Default: the runtime's choice. */
  threads?: number;
  /** Download progress, 0–1, the first time only. */
  onProgress?: (fraction: number) => void;
  /** auto (default): native, else WebAssembly. native: fail rather than fall back. */
  runtime?: 'auto' | 'native' | 'wasm';
}

/** Download the weights if they are missing, then load the model. */
export function createEngine(options?: NodeOptions): Promise<NodeEngine>;
/** Make sure the weights are on disk; returns their paths. */
export function fetchWeights(options?: { dir?: string; onProgress?: (fraction: number) => void; tries?: number }): Promise<{ model: string; config: string }>;

export const DEFAULT_DIR: string;
export const VOICES: Voice[];
export const PREVIEW_TEXT: string;
export const FACETS: Record<string, unknown>;
export function encodeWav(samples: Float32Array, sampleRate: number): Uint8Array;
export function chunks(text: string, options?: { first?: number; growth?: number; max?: number }): string[];
