/**
 * Record the film to MP4.
 *
 *   node tools/video/prepare.js && node tools/video/record.js
 *
 * Serves the repository locally, opens tools/video/film.html in Chrome at
 * 1920 × 1080, and has the page record itself: the tab's picture and the
 * film's own sound mix, H.264 and AAC, streamed to disk as it is made.
 */

import { createServer } from 'node:http';
import { createWriteStream, existsSync } from 'node:fs';
import { mkdir, readFile } from 'node:fs/promises';
import { extname, join, normalize } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import puppeteer from 'puppeteer-core';

const ROOT = fileURLToPath(new URL('../../', import.meta.url));
const OUT = process.argv[2] ?? join(ROOT, 'output', 'films', 'Cadence - Still paying for ElevenLabs.mp4');
const CHROME = process.env.CHROME ?? 'C:/Program Files/Google/Chrome/Application/chrome.exe';
const TYPES = { '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css', '.json': 'application/json', '.png': 'image/png', '.wav': 'audio/wav', '.mp4': 'video/mp4' };

export function serve() {
  const server = createServer(async (req, res) => {
    const path = normalize(decodeURIComponent(new URL(req.url ?? '/', 'http://x').pathname));
    const file = join(ROOT, path);
    if (!file.startsWith(ROOT) || !existsSync(file)) { res.writeHead(404).end(); return; }
    res.writeHead(200, { 'Content-Type': TYPES[extname(file)] ?? 'application/octet-stream', 'Cache-Control': 'no-store' });
    res.end(await readFile(file));
  }).listen(0);
  return { server, port: /** @type {import('node:net').AddressInfo} */ (server.address()).port };
}

if (import.meta.url === pathToFileURL(process.argv[1]).href) {
  const { server, port } = serve();
  await mkdir(join(ROOT, 'output', 'films'), { recursive: true });
  const out = createWriteStream(OUT);
  let bytes = 0;

  // A real window: headless tab capture repeats its first frame.
  const browser = await puppeteer.launch({
    executablePath: CHROME,
    headless: process.env.HEADLESS === '1',
    protocolTimeout: 0,
    defaultViewport: { width: 1920, height: 1080 },
    args: [
      '--no-sandbox', '--window-size=1920,1080', '--hide-scrollbars',
      '--autoplay-policy=no-user-gesture-required',
      '--auto-accept-this-tab-capture', '--auto-select-tab-capture-source-by-title=Cadence Film',
      '--force-device-scale-factor=1', '--window-position=0,0', '--start-fullscreen',
      '--disable-background-timer-throttling', '--disable-renderer-backgrounding', '--disable-backgrounding-occluded-windows',
    ],
  });
  const page = await browser.newPage();
  page.on('pageerror', (e) => console.log('page error:', e.message));
  page.on('console', (m) => { if (m.type() === 'error') console.log('console:', m.text()); });
  await page.exposeFunction('__chunk', (b64) => { const b = Buffer.from(b64, 'base64'); bytes += b.length; out.write(b); });
  await page.goto(`http://localhost:${port}/tools/video/film.html${process.env.SCENES ? `?scenes=${process.env.SCENES}` : ''}`, { waitUntil: 'networkidle0' });
  await page.waitForSelector('body[data-ready]', { timeout: 120000 });
  const total = await page.evaluate(() => window.film.TOTAL);
  console.log(`Recording ${total.toFixed(1)} s of film…`);

  await page.evaluate(() => {
    document.getElementById('go').onclick = async (e) => {
      e.currentTarget.remove();
      const sink = (u8) => {
        let s = '';
        for (let i = 0; i < u8.length; i += 0x8000) s += String.fromCharCode(...u8.subarray(i, i + 0x8000));
        return window.__chunk(btoa(s));
      };
      try { window.result = await window.film.record(sink); } catch (err) { window.result = { error: String(err?.stack ?? err) }; }
    };
  });
  await page.click('#go');
  const started = Date.now();
  let result = null;
  let lastLog = 0;
  while (!result) {
    await new Promise((r) => setTimeout(r, 1000));
    result = await page.evaluate(() => window.result ?? null);
    const s = (Date.now() - started) / 1000;
    if (s - lastLog >= 20) { lastLog = s; console.log(`  ${s.toFixed(0)} s · ${(bytes / 1e6).toFixed(1)} MB`); }
  }
  await new Promise((r) => out.end(r));
  await browser.close();
  server.close();
  if (result.error) { console.log(`Failed: ${result.error}`); process.exit(1); }
  console.log(`Saved ${OUT} (${(bytes / 1e6).toFixed(1)} MB)`);
  process.exit(0);
}
