/**
 * List every file the built app needs, for the service worker to keep, so
 * the playground opens with the network off after one visit. Runs after
 * build.
 *
 * The page cannot tell the worker this itself: the engine's workers and their
 * chunks are fetched before the service worker controls the first visit.
 * The build knows, so the build writes it down.
 */

import { readdir, readFile, stat, writeFile } from 'node:fs/promises';
import { join, relative, sep } from 'node:path';
import { fileURLToPath } from 'node:url';

const WEB = fileURLToPath(new URL('../', import.meta.url));
const STATIC = join(WEB, '.next', 'static');

// The pages, so any of them opens offline, not only the ones visited.
const ROUTES = ['/', '/text-to-speech', '/voices', '/voice-cloning', '/studio', '/history', '/engine', '/voice-changer'];
// The Swift runtime. The WebGPU build (.jsep) is only for HD and is kept the
// first time HD uses it, rather than costing every visitor its download.
const RUNTIME = ['/ort/ort-wasm-simd-threaded.wasm', '/ort/ort-wasm-simd-threaded.mjs'];

/** @param {string} dir @returns {Promise<string[]>} */
async function walk(dir) {
  const out = [];
  for (const e of await readdir(dir, { withFileTypes: true })) {
    const p = join(dir, e.name);
    if (e.isDirectory()) out.push(...(await walk(p)));
    else out.push(p);
  }
  return out;
}

const version = (await readFile(join(WEB, '.next', 'BUILD_ID'), 'utf8')).trim();
const paths = await walk(STATIC);
const files = paths.map((f) => `/_next/static/${relative(STATIC, f).split(sep).join('/')}`);
const bytes = (await Promise.all(paths.map((f) => stat(f).then((s) => s.size)))).reduce((a, b) => a + b, 0);

await writeFile(join(WEB, 'public', 'sw-manifest.json'), `${JSON.stringify({ version, urls: [...ROUTES, ...RUNTIME, ...files] }, null, 1)}\n`);
console.log(`Offline manifest: ${ROUTES.length} pages, ${files.length} static files (${(bytes / 1e6).toFixed(1)} MB) and the runtime`);
