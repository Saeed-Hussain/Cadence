// HD (Kokoro-82M) on a runtime of our choosing, measured in Chrome.
//   node tools/bench/hd/run.js "threads=12" "threads=6.6" "threads=12.g" ...
// Each argument is one page: ep=wasm|webgpu, threads=6.6 (one
// number per worker, g for a WebGPU worker), first=N, repeat=N.
// Needs the weights in .cache/models/kokoro/ (model.onnx, tokenizer.json, af_heart.bin).
import { createServer } from 'node:http';
import { existsSync } from 'node:fs';
import { readFile } from 'node:fs/promises';
import { extname, join, normalize } from 'node:path';
import { fileURLToPath } from 'node:url';
import puppeteer from 'puppeteer-core';

const ROOT = fileURLToPath(new URL('../../../', import.meta.url));
const TYPES = { '.html': 'text/html', '.js': 'text/javascript', '.mjs': 'text/javascript', '.json': 'application/json', '.wasm': 'application/wasm' };
const server = createServer(async (req, res) => {
  const file = join(ROOT, normalize(decodeURIComponent(new URL(req.url, 'http://x').pathname)));
  if (!file.startsWith(ROOT) || !existsSync(file)) { res.writeHead(404).end(); return; }
  res.writeHead(200, { 'Content-Type': TYPES[extname(file)] ?? 'application/octet-stream', 'Cross-Origin-Opener-Policy': 'same-origin', 'Cross-Origin-Embedder-Policy': 'require-corp' });
  res.end(await readFile(file));
}).listen(0);
const port = server.address().port;
const browser = await puppeteer.launch({ executablePath: process.env.CHROME ?? 'C:/Program Files/Google/Chrome/Application/chrome.exe', headless: true, protocolTimeout: 0, args: ['--no-sandbox', '--enable-unsafe-webgpu'] });

for (const q of process.argv.slice(2)) {
  const page = await browser.newPage();
  page.on('pageerror', (e) => console.log('  error', e.message));
  await page.goto(`http://localhost:${port}/tools/bench/hd/page.html?${q}`);
  let r;
  while (!(r = await page.evaluate(() => window.__result))) await new Promise((ok) => setTimeout(ok, 500));
  if (r.error) console.log(`${q.padEnd(34)} error: ${r.error}`);
  else console.log(`${q.padEnd(34)} RTF ${r.rtf.toFixed(3)} · ${r.wall.toFixed(1)} s for ${r.audio.toFixed(1)} s · first ${Math.round(r.firstMs)} ms · rms ${r.rms.toFixed(3)} nan ${r.nan} · pieces/worker ${r.per.map((p) => p.pieces).join('/')}`);
  await page.close();
}
await browser.close();
server.close();
