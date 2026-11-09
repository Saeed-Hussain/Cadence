/**
 * Download the fast model once, to disk, and serve it from the app itself.
 * Runs before dev and build.
 *
 * The browser's cache belongs to one origin: a new port, a private window or a
 * cleared cache would otherwise fetch 79 MB from the internet again. With the
 * weights in public/models/, the app loads them from localhost instead, and
 * falls back to the internet only when they are not there.
 */

import { copyFile, mkdir, stat } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { basename, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { fetchWeights } from '@cadence/engine/node';

const KEEP = fileURLToPath(new URL('../../../.cache/models/', import.meta.url));
const OUT = fileURLToPath(new URL('../public/models/', import.meta.url));

try {
  let shown = -1;
  const files = await fetchWeights({
    dir: KEEP,
    onProgress: (f) => {
      const pct = Math.floor(f * 10) * 10;
      if (pct !== shown && f < 1) { shown = pct; process.stdout.write(`  downloading the model · ${pct}%\r`); }
    },
  });
  await mkdir(OUT, { recursive: true });
  for (const src of [files.model, files.config]) {
    const dst = join(OUT, basename(src));
    if (existsSync(dst) && (await stat(dst)).size === (await stat(src)).size) continue;
    await copyFile(src, dst);
  }
  console.log('Model ready in public/models/ — served by the app, no download in the browser');
} catch (e) {
  // No network on a first run: the app still works, loading from the internet later.
  console.warn(`Model not fetched (${/** @type {Error} */ (e).message}); the browser will download it on first use.`);
}

// HD-Fast's files, where they have been built (tools/hdfast): HD runs as
// HD-Fast when the app serves them, as Kokoro whole when it does not.
const FAST = fileURLToPath(new URL('../../../.cache/hdfast/onnx/', import.meta.url));
const files = ['kokoro-front.onnx', 'hdfast-back-q8.onnx'];
if (files.every((f) => existsSync(join(FAST, f)))) {
  await mkdir(join(OUT, 'hdfast'), { recursive: true });
  for (const f of files) {
    const src = join(FAST, f);
    const dst = join(OUT, 'hdfast', f);
    if (!existsSync(dst) || (await stat(dst)).size !== (await stat(src)).size) await copyFile(src, dst);
  }
  console.log('HD-Fast ready in public/models/hdfast/');
}
