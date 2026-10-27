// node tools/bench/pool/run.js — every K × T on this machine.
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
const browser = await puppeteer.launch({ executablePath: 'C:/Program Files/Google/Chrome/Application/chrome.exe', headless: true, protocolTimeout: 0, args: ['--no-sandbox', '--enable-unsafe-webgpu', '--enable-features=Vulkan'] });
const configs = (process.argv[2] ?? '6,6.6,6.3.3,4.4.4,6.2.2.2,3.3.3.3').split(',');
const lead = process.argv.includes('--lead');
const first = (process.argv.find((a) => a.startsWith('--first=')) ?? '--first=120').slice(8);
const extra = (process.argv.find((a) => a.startsWith('--q=')) ?? '--q=').slice(4);
for (const T of configs) {
  const page = await browser.newPage();
  page.on('pageerror', (e) => console.log('error', e.message));
  await page.goto(`http://localhost:${port}/tools/bench/pool/page.html?threads=${T}${lead ? '&lead' : ''}&first=${first}${extra ? `&${extra}` : ''}`);
  let r;
  while (!(r = await page.evaluate(() => window.__result))) await new Promise((ok) => setTimeout(ok, 300));
  if (r.check) { console.log(r.check.join(String.fromCharCode(10))); await page.close(); continue; }
  if (r.error) { console.log(`${T} ${extra}: error ${r.error}`); await page.close(); continue; }
  console.log(`${extra.padEnd(16)} ${(lead ? 'lead ' : '     ') + T.padEnd(9)} RTF ${r.rtf.toFixed(3)}  first ${Math.round(r.firstMs)} ms  gaps ${r.gaps} (${r.gapMs} ms)  first cap ${first}  memory ${r.memMb} MB`);
  await page.close();
}
await browser.close(); server.close();
