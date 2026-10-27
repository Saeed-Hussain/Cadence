/**
 * Decode chosen frames straight from an MP4's H.264 stream with WebCodecs —
 * no <video> element, no seeking — and save them as PNGs. The ground truth
 * for what a viewer will see.
 *
 *   node tools/video/frames.js video.mp4 2,10,30
 */

import { closeSync, openSync, readSync } from 'node:fs';
import { mkdir, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import puppeteer from 'puppeteer-core';
import { serve } from './record.js';

const ROOT = fileURLToPath(new URL('../../', import.meta.url));
const FILE = process.argv[2] ?? join(ROOT, 'video', 'Cadence - Still paying for ElevenLabs.mp4');
const TIMES = (process.argv[3] ?? '2,10,30').split(',').map(Number);
const OUT = join(ROOT, 'video', 'check');
const CHROME = process.env.CHROME ?? 'C:/Program Files/Google/Chrome/Application/chrome.exe';

const fd = openSync(FILE, 'r');
const read = (pos, len) => { const b = Buffer.alloc(len); readSync(fd, b, 0, len, pos); return b; };
const ftyp = read(0, 8).readUInt32BE(0);
const moovSize = read(ftyp, 8).readUInt32BE(0);
const moov = read(ftyp, moovSize);

function boxes(b, s, e) {
  const out = [];
  for (let o = s; o + 8 <= e;) { const sz = b.readUInt32BE(o); out.push({ type: b.toString('latin1', o + 4, o + 8), body: o + 8, end: o + sz, start: o }); o += sz; }
  return out;
}
const find = (s, e, path) => {
  let cur = { body: s, end: e };
  for (const t of path) cur = boxes(moov, cur.body, cur.end).find((x) => x.type === t);
  return cur;
};
const trak = boxes(moov, 8, moovSize).filter((x) => x.type === 'trak').find((t) => {
  const hdlr = find(t.body, t.end, ['mdia', 'hdlr']);
  return moov.toString('latin1', hdlr.body + 8, hdlr.body + 12) === 'vide';
});
const stbl = find(trak.body, trak.end, ['mdia', 'minf', 'stbl']);
const kid = (t) => boxes(moov, stbl.body, stbl.end).find((x) => x.type === t);
const mdhd = find(trak.body, trak.end, ['mdia', 'mdhd']);
const scale = moov.readUInt32BE(mdhd.body + (moov[mdhd.body] === 1 ? 20 : 12));

const stsd = kid('stsd');
const avc1 = stsd.body + 8;
const avcC = boxes(moov, avc1 + 8 + 78, moov.readUInt32BE(avc1) + avc1).find((x) => x.type === 'avcC');
const description = moov.subarray(avcC.body, avcC.end);
const codec = `avc1.${[...description.subarray(1, 4)].map((x) => x.toString(16).padStart(2, '0')).join('')}`;

const stsz = kid('stsz');
const n = moov.readUInt32BE(stsz.body + 8);
const sizes = Array.from({ length: n }, (_, i) => moov.readUInt32BE(stsz.body + 12 + i * 4));
const stts = kid('stts');
const durs = [];
for (let i = 0, e = moov.readUInt32BE(stts.body + 4); i < e; i++) {
  const c = moov.readUInt32BE(stts.body + 8 + i * 8), d = moov.readUInt32BE(stts.body + 12 + i * 8);
  for (let k = 0; k < c; k++) durs.push(d);
}
const stss = kid('stss');
const sync = new Set(stss ? Array.from({ length: moov.readUInt32BE(stss.body + 4) }, (_, i) => moov.readUInt32BE(stss.body + 8 + i * 4) - 1) : sizes.map((_, i) => i));
const co = kid('co64');
const chunks = Array.from({ length: moov.readUInt32BE(co.body + 4) }, (_, i) => Number(moov.readBigUInt64BE(co.body + 8 + i * 8)));
const stsc = kid('stsc');
const sc = Array.from({ length: moov.readUInt32BE(stsc.body + 4) }, (_, i) => [moov.readUInt32BE(stsc.body + 8 + i * 12), moov.readUInt32BE(stsc.body + 12 + i * 12)]);
const offsets = [];
for (let c = 0, s = 0; c < chunks.length; c++) {
  const per = sc.filter(([first]) => first <= c + 1).at(-1)[1];
  let o = chunks[c];
  for (let k = 0; k < per && s < n; k++, s++) { offsets.push(o); o += sizes[s]; }
}
const times = [];
for (let i = 0, t = 0; i < n; i++) { times.push(t / scale); t += durs[i]; }

await mkdir(OUT, { recursive: true });
const browser = await puppeteer.launch({ executablePath: CHROME, headless: true, args: ['--no-sandbox'] });
const page = await browser.newPage();
const { server, port } = serve();
await page.goto(`http://localhost:${port}/tools/video/film.css`);
for (const want of TIMES) {
  let idx = times.findIndex((t) => t > want) - 1;
  if (idx < 0) idx = n - 1;
  let key = idx;
  while (!sync.has(key)) key--;
  const samples = [];
  for (let i = key; i <= idx; i++) samples.push([read(offsets[i], sizes[i]).toString('base64'), sync.has(i), Math.round(times[i] * 1e6)]);
  const png = await page.evaluate(async (codec, desc, samples) => {
    const frames = [];
    const dec = new VideoDecoder({ output: (f) => frames.push(f), error: (e) => { throw e; } });
    dec.configure({ codec, description: Uint8Array.from(atob(desc), (c) => c.charCodeAt(0)) });
    for (const [b64, key, ts] of samples) dec.decode(new EncodedVideoChunk({ type: key ? 'key' : 'delta', timestamp: ts, data: Uint8Array.from(atob(b64), (c) => c.charCodeAt(0)) }));
    await dec.flush();
    const f = frames.at(-1);
    const c = new OffscreenCanvas(960, 540);
    c.getContext('2d').drawImage(f, 0, 0, 960, 540);
    frames.forEach((x) => x.close());
    const blob = await c.convertToBlob({ type: 'image/png' });
    const buf = new Uint8Array(await blob.arrayBuffer());
    let s = ''; for (let i = 0; i < buf.length; i += 0x8000) s += String.fromCharCode(...buf.subarray(i, i + 0x8000));
    return btoa(s);
  }, codec, description.toString('base64'), samples);
  const name = `f${String(want.toFixed(1)).padStart(5, '0')}.png`;
  await writeFile(join(OUT, name), Buffer.from(png, 'base64'));
  console.log(`${name} ← frame ${idx} (${times[idx].toFixed(2)} s)`);
}
await browser.close();
server.close();
closeSync(fd);
