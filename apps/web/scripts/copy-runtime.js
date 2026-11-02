/**
 * Copy the WebAssembly inference runtimes into public/, so the app serves
 * them itself instead of loading them from a CDN. Runs before dev and build.
 *
 * public/ort/ holds onnxruntime-web as the engine depends on it, for both
 * models: the CPU build, and the builds Swift's WebGPU helper may ask for.
 */

import { copyFile, mkdir } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { createRequire } from 'node:module';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = fileURLToPath(new URL('../../../', import.meta.url));

/** The dist folder of onnxruntime-web as `fromPackage` would resolve it. */
function dist(fromPackage) {
  const require = createRequire(join(ROOT, fromPackage, 'package.json'));
  // The package exports no package.json; its entry point sits in dist/.
  return dirname(require.resolve('onnxruntime-web'));
}

const RUNTIME = ['ort-wasm-simd-threaded', 'ort-wasm-simd-threaded.jsep', 'ort-wasm-simd-threaded.asyncify', 'ort-wasm-simd-threaded.jspi'];

for (const [from, to] of [['packages/cadence', 'ort']]) {
  const src = dist(from);
  const out = new URL(`../public/${to}/`, import.meta.url);
  await mkdir(out, { recursive: true });
  for (const base of RUNTIME) {
    for (const ext of ['.wasm', '.mjs']) {
      const file = join(src, base + ext);
      if (existsSync(file)) await copyFile(file, new URL(base + ext, out));
    }
  }
}
console.log('Inference runtime copied to public/ort/');
