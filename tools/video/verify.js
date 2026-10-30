/**
 * Watch the finished film the way a viewer would, and report.
 *
 *   node tools/video/verify.js [video.mp4]
 *
 * Opens the MP4 in Chrome, reads its duration and resolution, grabs a frame
 * from the middle of every scene (video/check/*.png, to look at), and decodes
 * the soundtrack to find any stretch of silence or clipping.
 */

import { mkdir, writeFile } from 'node:fs/promises';
import { join, relative } from 'node:path';
import { fileURLToPath } from 'node:url';
import puppeteer from 'puppeteer-core';
import { serve } from './record.js';

const ROOT = fileURLToPath(new URL('../../', import.meta.url));
const FILE = process.argv[2] ?? join(ROOT, 'output', 'films', 'Cadence - Still paying for ElevenLabs.mp4');
const CHECK = join(ROOT, '.cache', 'video', 'check');
const CHROME = process.env.CHROME ?? 'C:/Program Files/Google/Chrome/Application/chrome.exe';

await mkdir(CHECK, { recursive: true });
const { server, port } = serve();
const url = `/${relative(ROOT, FILE).split('\\').join('/')}`;
const browser = await puppeteer.launch({ executablePath: CHROME, headless: true, protocolTimeout: 0, args: ['--no-sandbox', '--autoplay-policy=no-user-gesture-required'] });
const page = await browser.newPage();
await page.goto(`http://localhost:${port}/tools/video/film.css`);

const info = await page.evaluate(async (src) => {
  const v = document.createElement('video');
  v.src = src;
  v.muted = true;
  v.style.cssText = 'position:fixed;left:0;top:0;width:960px;height:540px';
  document.body.append(v);
  await new Promise((r, j) => { v.onloadedmetadata = r; v.onerror = () => j(new Error('cannot load video')); });
  // MediaRecorder MP4s can report Infinity until seeked to the end.
  if (!Number.isFinite(v.duration)) { v.currentTime = 1e9; await new Promise((r) => { v.ondurationchange = r; setTimeout(r, 3000); }); }
  window.v = v;
  return { duration: v.duration, width: v.videoWidth, height: v.videoHeight };
}, url);
console.log(`Video: ${info.width}×${info.height}, ${info.duration.toFixed(1)} s`);

const audio = await page.evaluate(async (src) => {
  const buf = await (await fetch(src)).arrayBuffer();
  const ctx = new OfflineAudioContext(1, 48000, 48000);
  const a = await ctx.decodeAudioData(buf);
  const d = a.getChannelData(0);
  const per = [];
  for (let s = 0; s < a.duration; s += 0.5) {
    let sum = 0, peak = 0;
    const from = Math.floor(s * a.sampleRate), to = Math.min(d.length, Math.floor((s + 0.5) * a.sampleRate));
    for (let i = from; i < to; i++) { sum += d[i] * d[i]; peak = Math.max(peak, Math.abs(d[i])); }
    per.push({ t: s, rms: Math.sqrt(sum / Math.max(1, to - from)), peak });
  }
  return { duration: a.duration, channels: a.numberOfChannels, rate: a.sampleRate, per };
}, url);
const silent = audio.per.filter((x) => x.rms < 0.002 && x.t > 1 && x.t < audio.duration - 2);
const clipped = audio.per.filter((x) => x.peak > 0.99);
console.log(`Audio: ${audio.duration.toFixed(1)} s, ${audio.channels} ch @ ${audio.rate} Hz · loudest ${Math.max(...audio.per.map((x) => x.peak)).toFixed(2)} · silent half-seconds inside: ${silent.length} · clipped: ${clipped.length}`);

const times = (process.env.TIMES ?? '').split(',').filter(Boolean).map(Number);
const at = times.length ? times : Array.from({ length: Math.floor(info.duration / 4) }, (_, i) => 2 + i * 4);
for (const t of at) {
  const png = await page.evaluate(async (time) => {
    const v = window.v;
    v.currentTime = time;
    await new Promise((r) => { v.onseeked = r; });
    // Wait until the frame at that time has actually been decoded and shown.
    await new Promise((r) => { v.requestVideoFrameCallback(() => r()); setTimeout(r, 1500); });
    const c = document.createElement('canvas');
    c.width = 960; c.height = 540;
    c.getContext('2d').drawImage(v, 0, 0, 960, 540);
    return c.toDataURL('image/png').split(',')[1];
  }, t);
  await writeFile(join(CHECK, `t${String(t.toFixed(1)).padStart(5, '0')}.png`), Buffer.from(png, 'base64'));
}
console.log(`Frames: ${at.length} in video/check/`);
await browser.close();
server.close();
process.exit(0);
