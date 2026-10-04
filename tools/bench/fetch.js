/**
 * Download the Piper candidates' weights into .cache/models/, skipping any
 * already there. Retries, because the connection this was measured on drops.
 *
 *   npm run bench:fetch
 */

import { existsSync } from 'node:fs';
import { mkdir, rename, writeFile } from 'node:fs/promises';
import { CANDIDATES, MODELS_DIR, PIPER_BASE } from './candidates.js';

await mkdir(MODELS_DIR, { recursive: true });

for (const c of CANDIDATES) {
  if (c.family !== 'piper' || !c.file || !c.path) continue;
  for (const ext of ['onnx.json', 'onnx']) {
    const target = new URL(`${c.file}.${ext}`, MODELS_DIR);
    if (existsSync(target)) continue;
    const url = `${PIPER_BASE}${c.path}/${c.file}.${ext}`;
    process.stdout.write(`  ${c.file}.${ext} `);
    for (let attempt = 1; ; attempt++) {
      try {
        const res = await fetch(url);
        if (!res.ok) throw new Error(`HTTP ${res.status}`);
        const body = new Uint8Array(await res.arrayBuffer());
        // Written under a temporary name first, so an interrupted download
        // never leaves a truncated model that looks complete.
        const part = new URL(`${c.file}.${ext}.part`, MODELS_DIR);
        await writeFile(part, body);
        await rename(part, target);
        console.log(`${(body.length / 1e6).toFixed(1)} MB`);
        break;
      } catch (e) {
        if (attempt >= 4) throw e;
        process.stdout.write('· retry ');
        await new Promise((r) => setTimeout(r, 2000 * attempt));
      }
    }
  }
}
console.log('Models ready in .cache/models/');
