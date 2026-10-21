// In a bundled web app (Next, Vite, webpack). Serve onnxruntime-web's
// ort-wasm-simd-threaded.{wasm,mjs} at /ort/ — see apps/web/scripts/copy-runtime.js.
import { createEngine } from '@cadence/engine';

const engine = createEngine();
const ctx = new AudioContext();
let at = ctx.currentTime;

// Each piece plays the moment it exists, scheduled end to end.
await engine.synthesize({
  text: 'Hello from Cadence. Every word of this was made in your browser.',
  onChunk(samples) {
    const buf = ctx.createBuffer(1, samples.length, 22050);
    buf.copyToChannel(samples, 0);
    const src = ctx.createBufferSource();
    src.buffer = buf;
    src.connect(ctx.destination);
    at = Math.max(at, ctx.currentTime + 0.02);
    src.start(at);
    at += buf.duration;
  },
});
