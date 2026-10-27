/**
 * A voiceover from a text file, spoken by Cadence — the way the promo films'
 * narration was made.
 *
 *   npm run voiceover -- my-script.txt
 *   npm run voiceover -- my-script.txt --voice=bf_emma --speed=0.95 --pause=0.6
 *
 * Each paragraph (separated by a blank line) is spoken by the real
 * playground, in a headless browser, with the voice you choose — HD voices
 * included, which run on the browser's runtime. You get one WAV per paragraph
 * and the whole voiceover joined with a pause between paragraphs, in
 * voiceover/<script name>/.
 *
 * Needs a production build first: npm run build:web.
 */

import { spawn } from 'node:child_process';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { basename, extname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import puppeteer from 'puppeteer-core';
import { VOICES } from '../packages/cadence/src/voices.js';
import { encodeWav } from '../packages/cadence/src/wav.js';

const ROOT = fileURLToPath(new URL('../', import.meta.url));
const CHROME = process.env.CHROME ?? 'C:/Program Files/Google/Chrome/Application/chrome.exe';
const PORT = 3190;

const args = process.argv.slice(2);
const file = args.find((a) => !a.startsWith('--'));
const opt = (name, fallback) => (args.find((a) => a.startsWith(`--${name}=`)) ?? `--${name}=${fallback}`).split('=')[1];
if (!file) {
  console.log('Usage: npm run voiceover -- script.txt [--voice=af_heart] [--speed=1] [--pause=0.5]\n\nGood voices to start with:');
  for (const v of VOICES.filter((x) => x.model === 'hd')) console.log(`  ${v.id.padEnd(14)} ${v.description}`);
  console.log(`  ${VOICES[0].id.padEnd(14)} ${VOICES[0].description} (Swift: fast)`);
  process.exit(1);
}
const voiceId = opt('voice', 'af_heart');
const voice = VOICES.find((v) => v.id === voiceId || v.name.toLowerCase() === voiceId.toLowerCase());
if (!voice) throw new Error(`Unknown voice "${voiceId}". Run without arguments to see some.`);
const speed = Number(opt('speed', '1'));
const pause = Number(opt('pause', '0.5'));

const paragraphs = (await readFile(resolve(file), 'utf8')).split(/\r?\n\s*\r?\n/).map((p) => p.replace(/\s+/g, ' ').trim()).filter(Boolean);
const out = join(ROOT, 'voiceover', basename(file, extname(file)));
await mkdir(out, { recursive: true });
console.log(`${paragraphs.length} paragraph${paragraphs.length === 1 ? '' : 's'} · voice ${voice.name} (${voice.model === 'hd' ? 'Cadence HD' : 'Cadence Swift'}) · speed ${speed}`);

const server = spawn(process.execPath, [join(ROOT, 'node_modules/next/dist/bin/next'), 'start', '-p', String(PORT)], { cwd: join(ROOT, 'apps/web'), stdio: 'ignore' });
process.on('exit', () => server.kill());
for (let i = 0; ; i++) {
  try { if ((await fetch(`http://localhost:${PORT}/`)).ok) break; } catch { /* not up */ }
  if (i > 120) throw new Error('the app did not start — run npm run build:web first');
  await new Promise((r) => setTimeout(r, 500));
}

// The benchmark profile keeps both models' weights between runs.
const browser = await puppeteer.launch({ executablePath: CHROME, headless: true, protocolTimeout: 0, userDataDir: join(ROOT, '.cache/chrome-profile'), args: ['--no-sandbox', '--autoplay-policy=no-user-gesture-required'] });
const page = await browser.newPage();
await page.evaluateOnNewDocument((v, s) => {
  localStorage.setItem('cadence:voice:v3', JSON.stringify(v));
  localStorage.setItem('cadence:settings', JSON.stringify({ speed: s }));
}, voice.id, speed);
await page.goto(`http://localhost:${PORT}/text-to-speech`, { waitUntil: 'networkidle2' });
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
for (let i = 0; ; i++) {
  const foot = await page.$eval('.editor-foot', (e) => e.textContent ?? '').catch(() => '');
  if (/Ctrl ↵/.test(foot)) break;
  if (/failed/.test(foot)) throw new Error(foot);
  if (i % 20 === 0) console.log(`  loading the model… ${foot.replace(/.*(Downloading|Loading|Starting)/, '$1').slice(0, 50)}`);
  await sleep(500);
}

/** @type {Float32Array[]} */
const parts = [];
let rate = 24000;
for (const [i, text] of paragraphs.entries()) {
  await page.click('textarea');
  await page.keyboard.down('Control'); await page.keyboard.press('a'); await page.keyboard.up('Control');
  await page.keyboard.press('Backspace');
  await page.type('textarea', text, { delay: 0 });
  const before = await page.evaluate(() => JSON.parse(localStorage.getItem('cadence:history:v3') ?? '[]').length);
  await page.click('.editor-foot .btn-primary');
  let entry = null;
  while (!entry) {
    await sleep(250);
    entry = await page.evaluate((n) => { const h = JSON.parse(localStorage.getItem('cadence:history:v3') ?? '[]'); return h.length > n ? h[0] : null; }, before);
  }
  let b64 = null;
  for (let k = 0; k < 40 && !b64; k++) {
    b64 = await page.evaluate(async (id) => {
      const hit = await (await caches.open('cadence-history')).match(`https://cadence.local/history/${id}`);
      if (!hit) return null;
      const buf = new Uint8Array(await hit.arrayBuffer());
      let s = '';
      for (let j = 0; j < buf.length; j += 0x8000) s += String.fromCharCode(...buf.subarray(j, j + 0x8000));
      return btoa(s);
    }, entry.id);
    if (!b64) await sleep(250);
  }
  const bytes = Buffer.from(b64, 'base64');
  const samples = new Float32Array(bytes.buffer, bytes.byteOffset, bytes.length / 4);
  rate = entry.sampleRate;
  parts.push(samples);
  await writeFile(join(out, `${String(i + 1).padStart(2, '0')}.wav`), Buffer.from(encodeWav(samples, rate)));
  await page.evaluate(() => document.querySelector('.player .icon-btn[aria-label="Close player"]')?.click());
  console.log(`  ${String(i + 1).padStart(2)}. ${(samples.length / rate).toFixed(1)} s  (made in ${(entry.stats.elapsedMs / 1000).toFixed(1)} s)  ${text.slice(0, 60)}${text.length > 60 ? '…' : ''}`);
}

const gap = new Float32Array(Math.round(rate * pause));
const total = parts.reduce((n, p) => n + p.length + gap.length, 0) - gap.length;
const all = new Float32Array(Math.max(0, total));
let o = 0;
parts.forEach((p, i) => { all.set(p, o); o += p.length + (i < parts.length - 1 ? gap.length : 0); });
const whole = join(out, 'voiceover.wav');
await writeFile(whole, Buffer.from(encodeWav(all, rate)));
await browser.close();
server.kill();
console.log(`\nDone: ${whole} (${(all.length / rate).toFixed(1)} s)`);
process.exit(0);
