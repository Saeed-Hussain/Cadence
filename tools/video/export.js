/**
 * Export the film to MP4, headless and sample-exact.
 *
 *   node tools/video/prepare.js && node tools/video/export.js
 *
 * 1. Sound: the soundtrack is rendered offline from the film's score and
 *    encoded to AAC (behind a marker tone, so its start is known exactly).
 * 2. Picture: the film is stepped frame by frame in headless Chrome at
 *    1920 × 1080, 30 fps, each frame held at its exact instant and captured.
 * 3. Encode: the frames go through Chrome's H.264 encoder (WebCodecs), each
 *    stamped with its time in the film.
 * 4. Mux: picture and sound into one fast-start MP4, the audio lined up by an
 *    edit list.
 *
 * Writes video/Cadence - Still paying for ElevenLabs.mp4.
 */

import { createWriteStream } from 'node:fs';
import { mkdir, readFile, rm, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import puppeteer from 'puppeteer-core';
import { avc1Stsd, readTrack, writeMp4 } from './mp4.js';
import { serve } from './record.js';
import { remux } from './remux.js';

const ROOT = fileURLToPath(new URL('../../', import.meta.url));
const WORK = join(ROOT, '.cache', 'video');
const FRAMES = join(WORK, 'frames');
// FORMAT=reel renders the vertical cut for TikTok, Instagram Reels and Shorts.
const REEL = process.env.FORMAT === 'reel';
const [W, H] = REEL ? [1080, 1920] : [1920, 1080];
const OUT = process.argv[2] ?? join(ROOT, 'video', REEL ? 'Cadence - Reel (1080x1920).mp4' : 'Cadence - Still paying for ElevenLabs.mp4');
const CHROME = process.env.CHROME ?? 'C:/Program Files/Google/Chrome/Application/chrome.exe';
const PARAMS = [REEL ? 'reel' : '', process.env.SCENES ? `scenes=${process.env.SCENES}` : ''].filter(Boolean);
const QUERY = PARAMS.length ? `?${PARAMS.join('&')}` : '';
const BITRATE = 10_000_000;

await rm(FRAMES, { recursive: true, force: true });
await mkdir(FRAMES, { recursive: true });
const { server, port } = serve();
const base = `http://localhost:${port}`;
const browser = await puppeteer.launch({
  executablePath: CHROME, headless: true, protocolTimeout: 0,
  defaultViewport: { width: W, height: H, deviceScaleFactor: 1 },
  args: ['--no-sandbox', '--autoplay-policy=no-user-gesture-required', '--hide-scrollbars', '--force-device-scale-factor=1'],
});
const log = (...a) => console.log(new Date().toISOString().slice(11, 19), ...a);

async function openFilm() {
  const page = await browser.newPage();
  page.on('pageerror', (e) => log('page error:', e.message));
  await page.goto(`${base}/tools/video/film.html${QUERY}`, { waitUntil: 'networkidle0' });
  await page.waitForSelector('body[data-ready]', { timeout: 120000 });
  return page;
}

// ─── 1. Sound ───────────────────────────────────────────────────────────────
log('Sound: rendering and encoding the soundtrack…');
const audioRaw = join(WORK, 'audio-raw.mp4');
const audioFlat = join(WORK, 'audio.mp4');
{
  const page = await openFilm();
  const stream = createWriteStream(audioRaw);
  await page.exposeFunction('__chunk', (b64) => { stream.write(Buffer.from(b64, 'base64')); });
  const info = await page.evaluate(async () => {
    const sink = (u8) => {
      let s = '';
      for (let i = 0; i < u8.length; i += 0x8000) s += String.fromCharCode(...u8.subarray(i, i + 0x8000));
      return window.__chunk(btoa(s));
    };
    return window.film.encodeSoundtrack(sink);
  });
  await new Promise((r) => stream.end(r));
  remux(audioRaw, audioFlat);
  const marker = await page.evaluate((u) => window.film.findMarker(u), `/.cache/video/audio.mp4`);
  if (!marker) throw new Error('marker tone not found in the encoded soundtrack');
  await page.close();
  globalThis.audioStart = marker.at + (info.MIX_AT - info.MARKER_AT);
  globalThis.total = info.seconds;
  log(`Sound: ${info.seconds.toFixed(2)} s; film starts ${globalThis.audioStart.toFixed(4)} s into the encoded audio`);
}

// ─── 2. Picture ─────────────────────────────────────────────────────────────
// Frame by frame on the film's own clock: each frame is set to its exact
// instant, painted, then captured. Constant 30 fps, nothing dropped.
const FPS = 30;
const total = globalThis.total;
const count = Math.round(total * FPS);
log(`Picture: rendering ${count} frames at ${FPS} fps…`);
{
  const page = await browser.newPage();
  page.on('pageerror', (e) => log('page error:', e.message));
  await page.goto(`${base}/tools/video/film.html?export${QUERY ? `&${QUERY.slice(1)}` : ''}`, { waitUntil: 'networkidle0' });
  await page.waitForSelector('body[data-ready]', { timeout: 120000 });
  const cdp = await page.createCDPSession();
  const started = Date.now();
  for (let k = 0; k < count; k++) {
    await page.evaluate((t) => window.film.seek(t), k / FPS);
    const { data } = await cdp.send('Page.captureScreenshot', { format: 'jpeg', quality: 95, optimizeForSpeed: false });
    await writeFile(join(FRAMES, `${String(k).padStart(6, '0')}.jpg`), Buffer.from(data, 'base64'));
    if (k % 300 === 0 && k) log(`  ${k}/${count} frames · ${((Date.now() - started) / k).toFixed(0)} ms each`);
  }
  await page.close();
}
const timed = Array.from({ length: count }, (_, k) => ({ file: `${String(k).padStart(6, '0')}.jpg`, t: k / FPS }));

// ─── 3. Encode ──────────────────────────────────────────────────────────────
log(`Encode: H.264 ${W}×${H}…`);
/** @type {{data: Buffer, size: number, key: boolean, ts: number}[]} */
const chunks = [];
let avcC = null;
{
  const page = await browser.newPage();
  await page.goto(`${base}/tools/video/film.css`);
  await page.exposeFunction('__out', (b64, key, ts, desc) => {
    const data = Buffer.from(b64, 'base64');
    chunks.push({ data, size: data.length, key, ts });
    if (desc && !avcC) avcC = Buffer.from(desc, 'base64');
  });
  const list = timed.map((f, i) => ({ url: `/.cache/video/frames/${f.file}`, t: f.t, d: (timed[i + 1]?.t ?? total) - f.t }));
  await page.evaluate(async (list, bitrate, W, H) => {
    const b64 = (u8) => { let s = ''; for (let i = 0; i < u8.length; i += 0x8000) s += String.fromCharCode(...u8.subarray(i, i + 0x8000)); return btoa(s); };
    const sends = [];
    const enc = new VideoEncoder({
      output: (chunk, meta) => {
        const buf = new Uint8Array(chunk.byteLength);
        chunk.copyTo(buf);
        const desc = meta?.decoderConfig?.description ? b64(new Uint8Array(meta.decoderConfig.description)) : null;
        sends.push(window.__out(b64(buf), chunk.type === 'key', chunk.timestamp, desc));
      },
      error: (e) => { throw e; },
    });
    enc.configure({ codec: 'avc1.640028', width: W, height: H, bitrate, framerate: 30, bitrateMode: 'variable', latencyMode: 'quality', avc: { format: 'avc' } });
    // RGB to BT.709 limited-range I420 here, not in the encoder: the
    // encoder's own conversion produced full-range values that players read
    // as limited, washing the picture out.
    const canvas = new OffscreenCanvas(W, H);
    const g = canvas.getContext('2d', { willReadFrequently: true });
    const yuv = new Uint8Array(W * H * 3 / 2);
    const toI420 = (rgba) => {
      const Y = yuv.subarray(0, W * H), U = yuv.subarray(W * H, W * H * 5 / 4), V = yuv.subarray(W * H * 5 / 4);
      for (let i = 0, p = 0; i < W * H; i++, p += 4) {
        Y[i] = 16 + ((46.559 * rgba[p] + 156.629 * rgba[p + 1] + 15.812 * rgba[p + 2]) / 255 + 0.5) | 0;
      }
      for (let y = 0; y < H; y += 2) {
        for (let x = 0; x < W; x += 2) {
          const a = (y * W + x) * 4, b2 = a + W * 4;
          const r = (rgba[a] + rgba[a + 4] + rgba[b2] + rgba[b2 + 4]) / 4;
          const gg = (rgba[a + 1] + rgba[a + 5] + rgba[b2 + 1] + rgba[b2 + 5]) / 4;
          const bb = (rgba[a + 2] + rgba[a + 6] + rgba[b2 + 2] + rgba[b2 + 6]) / 4;
          const o = (y / 2) * (W / 2) + x / 2;
          U[o] = 128 + ((-25.664 * r - 86.336 * gg + 112 * bb) / 255 + 0.5) | 0;
          V[o] = 128 + ((112 * r - 101.730 * gg - 10.270 * bb) / 255 + 0.5) | 0;
        }
      }
      return yuv;
    };
    let lastKey = -10;
    for (const f of list) {
      const bmp = await createImageBitmap(await (await fetch(f.url)).blob());
      g.drawImage(bmp, 0, 0, W, H);
      const data = toI420(g.getImageData(0, 0, W, H).data);
      const frame = new VideoFrame(data, {
        format: 'I420', codedWidth: W, codedHeight: H,
        timestamp: Math.round(f.t * 1e6), duration: Math.max(1, Math.round(f.d * 1e6)),
        colorSpace: { primaries: 'bt709', transfer: 'bt709', matrix: 'bt709', fullRange: false },
      });
      const key = f.t - lastKey >= 2;
      if (key) lastKey = f.t;
      enc.encode(frame, { keyFrame: key });
      frame.close();
      bmp.close();
      while (enc.encodeQueueSize > 6) await new Promise((r) => setTimeout(r, 2));
    }
    await enc.flush();
    await Promise.all(sends);
  }, list, BITRATE, W, H);
  await page.close();
}
if (!avcC) throw new Error('encoder gave no avcC');
chunks.sort((a, b) => a.ts - b.ts);
log(`Encode: ${chunks.length} samples, ${(chunks.reduce((n, c) => n + c.size, 0) / 1e6).toFixed(1)} MB`);

// ─── 4. Mux ─────────────────────────────────────────────────────────────────
const SCALE = 90000;
const vSamples = chunks.map((c, i) => {
  const next = chunks[i + 1]?.ts ?? Math.round(total * 1e6);
  return { data: c.data, size: c.size, key: c.key, duration: Math.max(1, Math.round(((next - c.ts) / 1e6) * SCALE)) };
});
const audio = readTrack(audioFlat, 'soun');
writeMp4({
  out: OUT,
  movieDuration: total,
  video: { stsd: avc1Stsd(avcC, W, H), scale: SCALE, width: W, height: H, samples: vSamples },
  audio: { ...audio, skip: Math.round(globalThis.audioStart * audio.scale) },
});
await browser.close();
server.close();
log(`Saved ${OUT}`);
process.exit(0);
