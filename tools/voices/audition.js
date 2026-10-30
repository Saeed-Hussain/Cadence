/**
 * Audition every Swift voice, so the library can be curated from evidence:
 * each of the 904 speakers says the same passage in the real app, and the
 * recording is scored for the faults that make a voice unusable.
 *
 *   npm run build:web && npm run voices:audition
 *   LIMIT=40 npm run voices:audition      (a quick look at the first 40)
 *
 * Writes output/voices/: one WAV per voice, scores.json, and index.html, a
 * ranked listening page (open it in a browser).
 *
 * The scores are signal measurements, not a judgement of beauty:
 *   snr      speech against the noise between words; low means hiss or room
 *   warble   frame-to-frame pitch jumps; high means a rough, glitchy voice
 *   melody   pitch range (middle 70%) over the passage; low means monotone
 *   pace     words a minute; far from the middle is rushed or dragging
 *   clip     samples at full scale
 * A listener still picks the final set: the score decides what is worth
 * listening to.
 */

import { spawn } from 'node:child_process';
import { mkdir, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import puppeteer from 'puppeteer-core';
import { VOICES } from '../../packages/cadence/src/voices.js';
import { encodeWav } from '../../packages/cadence/src/wav.js';

const ROOT = fileURLToPath(new URL('../../', import.meta.url));
const CHROME = process.env.CHROME ?? 'C:/Program Files/Google/Chrome/Application/chrome.exe';
const PORT = 3191;
const OUT = join(ROOT, 'output', 'voices');
const TEXT = 'Hello there! I can read your stories, your lessons, and your messages aloud. Does this sound natural to you? On Tuesday, the twenty-fourth of March, the quiet library finally reopened.';
const WORDS = TEXT.split(/\s+/).length;

const swift = VOICES.filter((v) => v.model === 'swift').slice(0, Number(process.env.LIMIT ?? Infinity));
await mkdir(join(OUT, 'wav'), { recursive: true });

const server = spawn(process.execPath, [join(ROOT, 'node_modules/next/dist/bin/next'), 'start', '-p', String(PORT)], { cwd: join(ROOT, 'apps/web'), stdio: 'ignore' });
process.on('exit', () => server.kill());
for (let i = 0; ; i++) {
  try { if ((await fetch(`http://localhost:${PORT}/`)).ok) break; } catch { /* not up */ }
  if (i > 120) throw new Error('the app did not start — run npm run build:web first');
  await new Promise((r) => setTimeout(r, 500));
}

const browser = await puppeteer.launch({ executablePath: CHROME, headless: true, protocolTimeout: 0, userDataDir: join(ROOT, '.cache/chrome-profile'), args: ['--no-sandbox'] });
const page = await browser.newPage();
await page.goto(`http://localhost:${PORT}/text-to-speech`, { waitUntil: 'networkidle2' });
await page.waitForFunction(() => /** @type {any} */ (window).cadence, { timeout: 0 });
await page.evaluate(() => /** @type {any} */ (window).cadence.load('swift'));

const results = [];
const start = performance.now();
for (const [n, voice] of swift.entries()) {
  const { b64, rate } = await page.evaluate(async (id, text) => {
    const r = await /** @type {any} */ (window).cadence.synthesize({ text, voice: id });
    const buf = new Uint8Array(r.samples.buffer, r.samples.byteOffset, r.samples.byteLength);
    let s = '';
    for (let j = 0; j < buf.length; j += 0x8000) s += String.fromCharCode(...buf.subarray(j, j + 0x8000));
    return { b64: btoa(s), rate: r.sampleRate };
  }, voice.id, TEXT);
  const bytes = Buffer.from(b64, 'base64');
  const samples = new Float32Array(bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.length));
  await writeFile(join(OUT, 'wav', `${voice.id}.wav`), Buffer.from(encodeWav(samples, rate)));
  results.push({ id: voice.id, name: voice.name, gender: voice.gender, ...measure(samples, rate) });
  if (n % 50 === 49 || n === swift.length - 1) {
    const s = (performance.now() - start) / 1000;
    console.log(`  ${n + 1}/${swift.length} · ${s.toFixed(0)} s · ~${((s / (n + 1)) * (swift.length - n - 1) / 60).toFixed(1)} min left`);
  }
}
await browser.close();
server.kill();

score(results);
results.sort((a, b) => b.score - a.score);
await writeFile(join(OUT, 'scores.json'), `${JSON.stringify(results, null, 1)}\n`);
await writeFile(join(OUT, 'index.html'), html(results));

const flagged = results.filter((r) => r.faults.length);
console.log(`\n${results.length} voices · ${flagged.length} with a fault · ${results.length - flagged.length} clean`);
for (const f of ['noisy', 'warbly', 'monotone', 'rushed', 'dragging', 'clipped', 'quiet', 'garbled']) {
  console.log(`  ${f.padEnd(9)} ${results.filter((r) => r.faults.includes(f)).length}`);
}
console.log('\nTop 15:');
for (const r of results.slice(0, 15)) console.log(`  ${r.name.padEnd(12)} ${r.gender.padEnd(7)} score ${r.score.toFixed(2)}  snr ${r.snr} dB · warble ${r.warble} · melody ${r.melody} st · ${r.wpm} wpm`);
console.log(`\nListen: ${join(OUT, 'index.html')}`);
process.exit(0);

// ─── Measurement ──────────────────────────────────────────────────────────

/** @param {Float32Array} x @param {number} rate */
function measure(x, rate) {
  const hop = Math.round(rate * 0.01);
  const win = Math.round(rate * 0.03);
  const minLag = Math.floor(rate / 400);
  const maxLag = Math.floor(rate / 60);
  const energy = [];
  const pitch = [];
  for (let s = 0; s + win + maxLag < x.length; s += hop) {
    let e = 0;
    for (let i = 0; i < win; i++) e += x[s + i] ** 2;
    energy.push(e / win);
    // Normalised autocorrelation: a frame counts as voiced when it repeats well.
    let best = 0, lag0 = 0;
    for (let lag = minLag; lag <= maxLag; lag++) {
      let c = 0, a = 0, b = 0;
      for (let i = 0; i < win; i++) { c += x[s + i] * x[s + i + lag]; a += x[s + i] ** 2; b += x[s + i + lag] ** 2; }
      const r = a && b ? c / Math.sqrt(a * b) : 0;
      if (r > best) { best = r; lag0 = lag; }
    }
    pitch.push(best > 0.75 && e / win > 1e-5 ? rate / lag0 : 0);
  }
  // The engine's pauses between pieces are exact silence: only frames the
  // model actually made count towards the noise floor.
  const db = energy.filter((e) => e > 1e-9).map((e) => 10 * Math.log10(e));
  const sorted = [...db].sort((a, b) => a - b);
  const pct = (p) => sorted[Math.min(sorted.length - 1, Math.floor(p * sorted.length))];
  // Noise is the quiet between words, speech the loud part.
  const snr = pct(0.95) - pct(0.1);
  const loud = pct(0.95);

  const st = pitch.map((f) => (f ? 12 * Math.log2(f / 100) : null));
  const jumps = [];
  for (let i = 1; i < st.length; i++) if (st[i] != null && st[i - 1] != null) jumps.push(Math.abs(st[i] - st[i - 1]));
  jumps.sort((a, b) => a - b);
  // Octave errors are the tracker's, not the voice's: ignore jumps over 5 st.
  const small = jumps.filter((j) => j < 5);
  const warble = small.length ? small.reduce((s, j) => s + j, 0) / small.length : 0;
  const voiced = st.filter((v) => v != null).sort((a, b) => a - b);
  const q = (p) => voiced[Math.floor(p * (voiced.length - 1))] ?? 0;
  const melody = q(0.85) - q(0.15);
  const f0 = voiced.length ? 100 * 2 ** (q(0.5) / 12) : 0;

  let a = 0, b = x.length - 1;
  while (a < b && Math.abs(x[a]) < 0.01) a++;
  while (b > a && Math.abs(x[b]) < 0.01) b--;
  const wpm = (WORDS / ((b - a) / rate)) * 60;
  let clipped = 0;
  for (let i = 0; i < x.length; i++) if (Math.abs(x[i]) > 0.99) clipped++;

  return {
    seconds: +(x.length / rate).toFixed(2),
    snr: +snr.toFixed(1),
    loud: +loud.toFixed(1),
    warble: +warble.toFixed(2),
    melody: +melody.toFixed(1),
    f0: Math.round(f0),
    voicedRatio: +(voiced.length / Math.max(1, st.length)).toFixed(2),
    wpm: Math.round(wpm),
    clip: clipped,
  };
}

/** Faults by absolute thresholds and against the library's own spread. */
function score(rs) {
  const stat = (k) => {
    const v = rs.map((r) => r[k]).sort((a, b) => a - b);
    const med = v[v.length >> 1];
    const mad = v.map((x) => Math.abs(x - med)).sort((a, b) => a - b)[v.length >> 1] || 1;
    return { med, mad };
  };
  const S = Object.fromEntries(['snr', 'warble', 'melody', 'wpm', 'loud', 'voicedRatio'].map((k) => [k, stat(k)]));
  const z = (r, k) => (r[k] - S[k].med) / (1.4826 * S[k].mad);
  for (const r of rs) {
    const f = [];
    if (z(r, 'snr') < -2) f.push('noisy');
    if (z(r, 'warble') > 2) f.push('warbly');
    if (z(r, 'melody') < -2) f.push('monotone');
    if (z(r, 'wpm') > 2.5) f.push('rushed');
    if (z(r, 'wpm') < -2.5) f.push('dragging');
    if (r.clip > 20) f.push('clipped');
    if (z(r, 'loud') < -2.5) f.push('quiet');
    if (z(r, 'voicedRatio') < -2.5) f.push('garbled');
    r.faults = f;
    // Higher is better: clean, smooth, expressive, mid-paced.
    r.score = +(0.35 * clamp(z(r, 'snr')) - 0.3 * clamp(z(r, 'warble')) + 0.2 * clamp(z(r, 'melody')) - 0.15 * Math.abs(clamp(z(r, 'wpm'))) - f.length).toFixed(3);
  }
}
function clamp(v) { return Math.max(-3, Math.min(3, v)); }

function html(rs) {
  const row = (r, i) => `<tr data-g="${r.gender}" data-f="${r.faults.length ? 'bad' : 'ok'}"><td>${i + 1}</td><td><b>${r.name}</b><br><small>${r.id}</small></td><td>${r.gender}</td><td>${r.score.toFixed(2)}</td><td>${r.snr}</td><td>${r.warble}</td><td>${r.melody}</td><td>${r.wpm}</td><td>${r.f0}</td><td class="f">${r.faults.join(', ')}</td><td><audio controls preload="none" src="wav/${r.id}.wav"></audio></td><td><input type="checkbox" data-id="${r.id}"></td></tr>`;
  return `<!doctype html><meta charset="utf-8"><title>Swift voice audition</title>
<style>body{font:14px system-ui;margin:24px;background:#fbfaf8;color:#222}table{border-collapse:collapse;width:100%}td,th{padding:6px 8px;border-bottom:1px solid #e6e3de;text-align:left;vertical-align:middle}th{position:sticky;top:0;background:#fbfaf8;cursor:pointer}.f{color:#b4442c}small{color:#888}audio{height:32px}.bar{display:flex;gap:12px;align-items:center;margin-bottom:12px;flex-wrap:wrap}textarea{width:100%;height:60px}</style>
<h1>Swift voice audition</h1>
<p>Every voice says: “${TEXT}” Ranked by score (higher is cleaner and more expressive). Tick the ones you like; your picks collect below.</p>
<div class="bar"><label>Gender <select id="g"><option value="">all</option><option>female</option><option>male</option><option>unclear</option></select></label><label><input type="checkbox" id="clean"> clean only</label><span id="count"></span></div>
<table><thead><tr><th>#</th><th>Voice</th><th>Gender</th><th>Score</th><th>SNR dB</th><th>Warble</th><th>Melody st</th><th>WPM</th><th>Pitch Hz</th><th>Faults</th><th>Listen</th><th>Pick</th></tr></thead><tbody>${rs.map(row).join('')}</tbody></table>
<h2>Your picks</h2><textarea id="picks" readonly></textarea>
<script>
const rows=[...document.querySelectorAll('tbody tr')];
function filter(){const g=document.getElementById('g').value,c=document.getElementById('clean').checked;let n=0;for(const r of rows){const show=(!g||r.dataset.g===g)&&(!c||r.dataset.f==='ok');r.style.display=show?'':'none';n+=show}document.getElementById('count').textContent=n+' shown'}
document.getElementById('g').onchange=filter;document.getElementById('clean').onchange=filter;filter();
let picks=[];try{picks=JSON.parse(localStorage.getItem('picks')||'[]')}catch{}
const boxes=[...document.querySelectorAll('input[data-id]')];
function sync(){document.getElementById('picks').value=picks.join(', ');try{localStorage.setItem('picks',JSON.stringify(picks))}catch{}}
for(const b of boxes){b.checked=picks.includes(b.dataset.id);b.onchange=()=>{picks=b.checked?[...picks,b.dataset.id]:picks.filter(p=>p!==b.dataset.id);sync()}}sync();
document.addEventListener('play',e=>{for(const a of document.querySelectorAll('audio'))if(a!==e.target)a.pause()},true);
</script>`;
}
