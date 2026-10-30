/**
 * Everything the film needs from the real product, made by the real product:
 *
 *   npm run build:web && node tools/video/prepare.js
 *
 * 1. The voiceover: each line of script.js typed into the playground and
 *    spoken by Cadence HD (voice Heart), the audio read back out of the
 *    app's own history cache and written as WAV.
 * 2. The screenshots: the playground in its dark theme, at 2× for zooming.
 *
 * Writes .cache/video/assets/ (narration WAVs, PNGs, manifest.json).
 */

import { spawn } from 'node:child_process';
import { existsSync } from 'node:fs';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import puppeteer from 'puppeteer-core';
import { encodeWav } from '../../packages/cadence/src/wav.js';
// FORMAT=reel makes the vertical reel's assets: its own script, and the app
// at phone size, which is its mobile layout.
const REEL = process.env.FORMAT === 'reel';
const { DEMO_TEXT, NARRATOR, SCENES } = await import(REEL ? './script-reel.js' : './script.js');

const PORT = 3179;
const ROOT = new URL('../../', import.meta.url);
const OUT = new URL(REEL ? '.cache/video/assets-reel/' : '.cache/video/assets/', ROOT);
const CHROME = process.env.CHROME ?? 'C:/Program Files/Google/Chrome/Application/chrome.exe';
const SWIFT_VOICE = 's-3922';
const only = process.argv.slice(2);

await mkdir(OUT, { recursive: true });
const server = spawn(process.execPath, [fileURLToPath(new URL('node_modules/next/dist/bin/next', ROOT)), 'start', '-p', String(PORT)], { cwd: fileURLToPath(new URL('apps/web/', ROOT)), stdio: 'ignore' });
process.on('exit', () => server.kill());
for (let i = 0; ; i++) {
  try { if ((await fetch(`http://localhost:${PORT}/`)).ok) break; } catch { /* not up */ }
  if (i > 120) throw new Error('server did not start');
  await new Promise((r) => setTimeout(r, 500));
}

// The benchmark profile already holds both models' weights.
const browser = await puppeteer.launch({
  executablePath: CHROME, headless: true, protocolTimeout: 0,
  userDataDir: fileURLToPath(new URL('.cache/chrome-profile/', ROOT)),
  args: ['--no-sandbox', '--autoplay-policy=no-user-gesture-required', '--hide-scrollbars'],
});
const page = await browser.newPage();
const VIEW = REEL ? { width: 430, height: 932, deviceScaleFactor: 3, isMobile: true, hasTouch: true } : { width: 1920, height: 1080, deviceScaleFactor: 2 };
await page.setViewport(VIEW);
page.on('pageerror', (e) => console.log('  page error:', e.message));
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

/** Open a page of the app with a voice chosen, light theme, and nothing left over. */
async function open(path, voice) {
  await page.evaluateOnNewDocument((v) => {
    localStorage.setItem('cadence:theme', 'light');
    localStorage.setItem('cadence:voice:v3', JSON.stringify(v));
    sessionStorage.removeItem('cadence:tts-draft');
  }, voice);
  await page.goto(`http://localhost:${PORT}${path}`, { waitUntil: 'networkidle2' });
}

async function waitReady() {
  for (let i = 0; i < 1200; i++) {
    const foot = await page.$eval('.editor-foot', (e) => e.textContent ?? '').catch(() => '');
    if (/Ctrl ↵/.test(foot)) return;
    if (/failed/.test(foot)) throw new Error(foot);
    await sleep(500);
  }
  throw new Error('model never became ready');
}

async function typeText(text) {
  await page.click('textarea');
  await page.keyboard.down('Control'); await page.keyboard.press('a'); await page.keyboard.up('Control');
  await page.keyboard.press('Backspace');
  await page.type('textarea', text, { delay: 0 });
}

/** Generate `text` and return the samples the app made, read from its cache. */
async function speak(text) {
  await typeText(text);
  const before = await page.evaluate(() => JSON.parse(localStorage.getItem('cadence:history:v3') ?? '[]').length);
  await page.click('.editor-foot .btn-primary');
  for (let i = 0; i < 2400; i++) {
    const entry = await page.evaluate((n) => {
      const h = JSON.parse(localStorage.getItem('cadence:history:v3') ?? '[]');
      return h.length > n ? h[0] : null;
    }, before);
    if (entry) {
      // The history cache is written just after the entry; give it a moment.
      for (let j = 0; j < 40; j++) {
        const b64 = await page.evaluate(async (id) => {
          const hit = await (await caches.open('cadence-history')).match(`https://cadence.local/history/${id}`);
          if (!hit) return null;
          const buf = new Uint8Array(await hit.arrayBuffer());
          let s = '';
          for (let k = 0; k < buf.length; k += 0x8000) s += String.fromCharCode(...buf.subarray(k, k + 0x8000));
          return btoa(s);
        }, entry.id);
        if (b64) {
          const bytes = Buffer.from(b64, 'base64');
          return { entry, samples: new Float32Array(bytes.buffer, bytes.byteOffset, bytes.length / 4) };
        }
        await sleep(250);
      }
      throw new Error('audio not in cache');
    }
    await sleep(250);
  }
  throw new Error('generation timed out');
}

// A partial run (voice or shots) keeps what the other part made before.
const MANIFEST = new URL('manifest.json', OUT);
/** @type {Record<string, any>} */
const manifest = existsSync(MANIFEST)
  ? JSON.parse(await readFile(MANIFEST, 'utf8'))
  : { narrator: NARRATOR, sampleRate: 24000, scenes: [], shots: {}, geo: {} };
manifest.geo ??= {};

if (!only.length || only.includes('voice')) {
  console.log('Voiceover, Cadence HD, voice Heart:');
  await open('/text-to-speech', NARRATOR);
  await waitReady();
  manifest.scenes = [];
  for (const s of SCENES) {
    const { entry, samples } = await speak(s.text);
    await page.evaluate(() => document.querySelector('.player .icon-btn[aria-label="Close player"]')?.click());
    const file = `vo-${s.id}.wav`;
    await writeFile(new URL(file, OUT), Buffer.from(encodeWav(samples, entry.sampleRate)));
    manifest.sampleRate = entry.sampleRate;
    manifest.scenes.push({ ...s, file, seconds: samples.length / entry.sampleRate, rtf: entry.stats.rtf });
    console.log(`  ${s.id.padEnd(8)} ${(samples.length / entry.sampleRate).toFixed(2)} s  (RTF ${entry.stats.rtf.toFixed(2)})`);
  }
}

/** @param {string} name */
async function shot(name) {
  await sleep(1200);
  await page.screenshot({ path: fileURLToPath(new URL(`${name}.png`, OUT)) });
  manifest.shots[name] = `${name}.png`;
  console.log(`  ${name}.png`);
}

if (!only.length || only.includes('shots')) {
  console.log('Screenshots:');
  await open('/', SWIFT_VOICE);
  await shot('home');

  await open('/text-to-speech', SWIFT_VOICE);
  await page.evaluate(() => document.querySelector('.player .icon-btn[aria-label="Close player"]')?.click());
  await waitReady();
  await shot('tts-empty');
  await typeText(DEMO_TEXT);
  await shot('tts-typed');
  // Where things are, in 1920 × 1080 page pixels, for the film's cursor and crops.
  manifest.geo.generate = await page.$eval('.editor-foot .btn-primary', (b) => { const r = b.getBoundingClientRect(); return [r.x + r.width / 2, r.y + r.height / 2]; });
  manifest.view = { width: VIEW.width, height: VIEW.height };
  await page.click('.editor-foot .btn-primary');
  // Mid-playback: the waveform part played, the orb alive.
  await sleep(1900);
  await page.screenshot({ path: fileURLToPath(new URL('tts-playing.png', OUT)) });
  manifest.shots['tts-playing'] = 'tts-playing.png';
  console.log('  tts-playing.png');
  await sleep(5000);

  await open('/voices', SWIFT_VOICE);
  await shot('voices');

  await open('/text-to-speech', NARRATOR);
  await waitReady();
  // On a phone the settings sit below the editor.
  if (REEL) await page.evaluate(() => document.querySelector('.model-opt')?.scrollIntoView({ block: 'center' }));
  await shot('tts-hd');
  manifest.geo.models = await page.evaluate(() => {
    const opts = [...document.querySelectorAll('.model-opt')];
    const field = opts[0].closest('.field');
    const r = field.getBoundingClientRect();
    return [r.x - 16, r.y - 16, r.width + 32, r.height + 32];
  });

  await open('/engine', SWIFT_VOICE);
  await shot('engine');

  await open('/studio', SWIFT_VOICE);
  await shot('studio');
}

await writeFile(new URL('manifest.json', OUT), `${JSON.stringify(manifest, null, 2)}\n`);
await browser.close();
server.kill();
console.log(`Assets in ${fileURLToPath(OUT)}`);
process.exit(0);
