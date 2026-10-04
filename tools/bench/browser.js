/**
 * M0, browser half: run a Piper candidate inside Chrome in every execution
 * setup and compare it with the native number.
 *
 *   npm run bench:browser
 *   npm run bench:browser -- en_US-lessac-medium
 *
 * Serves the repository with the same cross-origin isolation headers the
 * app sends (without them WebAssembly gets one thread), drives Chrome
 * through each setup, and records the results beside the native ones.
 */

import { createServer } from 'node:http';
import { existsSync } from 'node:fs';
import { readFile, writeFile } from 'node:fs/promises';
import { extname, join, normalize } from 'node:path';
import os from 'node:os';
import { fileURLToPath } from 'node:url';
import puppeteer from 'puppeteer-core';
import { writeReport } from './report.js';

const ROOT = fileURLToPath(new URL('../../', import.meta.url));
const model = process.argv[2] ?? 'en_US-libritts_r-medium';
const CHROME = process.env.CHROME ?? 'C:/Program Files/Google/Chrome/Application/chrome.exe';
const TYPES = { '.html': 'text/html', '.js': 'text/javascript', '.mjs': 'text/javascript', '.json': 'application/json', '.wasm': 'application/wasm' };

const server = createServer(async (req, res) => {
  const path = normalize(decodeURIComponent(new URL(req.url ?? '/', 'http://x').pathname));
  const file = join(ROOT, path);
  if (!file.startsWith(ROOT) || !existsSync(file)) { res.writeHead(404).end(); return; }
  res.writeHead(200, {
    'Content-Type': TYPES[/** @type {keyof typeof TYPES} */ (extname(file))] ?? 'application/octet-stream',
    'Cross-Origin-Opener-Policy': 'same-origin',
    'Cross-Origin-Embedder-Policy': 'require-corp',
  });
  res.end(await readFile(file));
}).listen(0);
const port = /** @type {import('node:net').AddressInfo} */ (server.address()).port;

const threads = os.cpus().length;
const SETUPS = [
  { ep: 'wasm', threads: 1 },
  { ep: 'wasm', threads: Math.max(1, threads / 2) },
  { ep: 'wasm', threads },
  { ep: 'webgpu' },
];

const browser = await puppeteer.launch({
  executablePath: CHROME,
  headless: true,
  protocolTimeout: 0,
  args: ['--no-sandbox', '--enable-unsafe-webgpu'],
});

const results = [];
console.log(`${model} in Chrome:`);
for (const s of SETUPS) {
  const page = await browser.newPage();
  const qs = new URLSearchParams({ model, ep: s.ep, ...(s.threads ? { threads: String(s.threads) } : {}) });
  await page.goto(`http://localhost:${port}/tools/bench/browser/page.html?${qs}`);
  let r;
  while (!(r = await page.evaluate(() => /** @type {any} */ (window).__result))) await new Promise((ok) => setTimeout(ok, 500));
  await page.close();
  const label = s.ep === 'wasm' ? `wasm · ${s.threads} thread${s.threads === 1 ? '' : 's'}` : 'webgpu';
  results.push({ label, ...r });
  console.log(`  ${label.padEnd(18)}${r.error ? `error: ${r.error}` : `RTF ${r.results.long.rtf.toFixed(3)} · first audio ${Math.round(r.results.short.ttfaMs)} ms · isolated ${r.isolated}`}`);
}
const chrome = await browser.version();
await browser.close();
server.close();

// Kept beside the native results for the same machine.
const cpu = os.cpus()[0].model.replace(/\(R\)|\(TM\)|CPU|@.*$/g, '').replace(/\s+/g, ' ').trim();
const slug = cpu.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');
const out = new URL(`../../docs/bench/${slug}.browser.json`, import.meta.url);
const prev = existsSync(out) ? JSON.parse(await readFile(out, 'utf8')) : {};
prev[model] = { chrome, date: new Date().toISOString().slice(0, 10), results };
await writeFile(out, `${JSON.stringify(prev, null, 2)}\n`);
process.exit(0);
