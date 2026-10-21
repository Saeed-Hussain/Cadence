/**
 * Copy the WebAssembly inference runtime into public/ort/, so the app serves
 * it itself instead of loading it from a CDN. Runs before dev and build.
 *
 * Both engines use these: Swift directly, HD through transformers.js. The
 * `.jsep` pair is the build with WebGPU support that transformers.js asks for.
 */

import { copyFile, mkdir } from 'node:fs/promises';
import { createRequire } from 'node:module';
import { dirname, join } from 'node:path';

const require = createRequire(import.meta.url);
// The package exports no package.json; its entry point sits in dist/.
const dist = dirname(require.resolve('onnxruntime-web'));
const out = new URL('../public/ort/', import.meta.url);

await mkdir(out, { recursive: true });
for (const f of [
  'ort-wasm-simd-threaded.wasm',
  'ort-wasm-simd-threaded.mjs',
  'ort-wasm-simd-threaded.jsep.wasm',
  'ort-wasm-simd-threaded.jsep.mjs',
]) {
  await copyFile(join(dist, f), new URL(f, out));
}
console.log('Inference runtime copied to public/ort/');
