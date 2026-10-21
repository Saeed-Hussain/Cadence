/**
 * The fast path measured inside the real app, not a test page.
 *
 *   npm run build:web && npm run bench:app
 *
 * Starts the production server, opens Text to Speech in Chrome, generates the
 * benchmark's long passage five times with the default (Swift) voice, and
 * reads the app's own timing from its history. If this is meaningfully slower
 * than `npm run bench:browser`, the app is adding overhead of its own.
 */

import { spawn } from 'node:child_process';
import { existsSync } from 'node:fs';
import { readFile, writeFile } from 'node:fs/promises';
import os from 'node:os';
import { fileURLToPath } from 'node:url';
import puppeteer from 'puppeteer-core';
import { CORPUS } from './candidates.js';
import { writeReport } from './report.js';

const RUNS = Number(process.env.RUNS ?? 5);
// Diagnostic runs change the page, so their numbers are printed, never saved.
const DIAGNOSTIC = Boolean(process.env.REDUCED_MOTION || process.env.INJECT_CSS);
const PORT = 3170;
const CHROME = process.env.CHROME ?? 'C:/Program Files/Google/Chrome/Application/chrome.exe';
const WEB = fileURLToPath(new URL('../../apps/web/', import.meta.url));
const PROFILE = fileURLToPath(new URL('../../.cache/chrome-profile/', import.meta.url));

const server = spawn(process.execPath, [fileURLToPath(new URL('../../node_modules/next/dist/bin/next', import.meta.url)), 'start', '-p', String(PORT)], { cwd: WEB, stdio: 'ignore' });
const stop = () => { try { server.kill(); } catch { /* gone */ } };
process.on('exit', stop);

for (let i = 0; ; i++) {
  try { if ((await fetch(`http://localhost:${PORT}/`)).ok) break; } catch { /* not up yet */ }
  if (i > 120) throw new Error('server did not start');
  await new Promise((r) => setTimeout(r, 500));
}

// A persistent profile keeps the downloaded weights between runs, so this
// measures generation, not the network.
const browser = await puppeteer.launch({
  executablePath: CHROME,
  headless: true,
  protocolTimeout: 0,
  userDataDir: PROFILE,
  args: ['--no-sandbox', '--autoplay-policy=no-user-gesture-required'],
});
const page = await browser.newPage();
const errors = [];
page.on('pageerror', (e) => errors.push(e.message));
page.on('console', (m) => { if (m.type() === 'error') errors.push(m.text().slice(0, 200)); });
await page.evaluateOnNewDocument(() => {
  for (const k of Object.keys(localStorage)) if (k.startsWith('cadence:')) localStorage.removeItem(k);
  sessionStorage.clear();
});
await page.setViewport({ width: 1440, height: 900 });
// REDUCED_MOTION=1 measures the app with its animations off, to separate the
// cost of the interface from the cost of the model.
if (process.env.REDUCED_MOTION) await page.emulateMediaFeatures([{ name: 'prefers-reduced-motion', value: 'reduce' }]);

const loadStart = Date.now();
await page.goto(`http://localhost:${PORT}/text-to-speech`, { waitUntil: 'networkidle2' });
let foot = '';
for (;;) {
  foot = await page.$eval('.editor-foot', (e) => e.textContent ?? '');
  if (/Ctrl ↵|failed/.test(foot)) break;
  await new Promise((r) => setTimeout(r, 500));
}
const readyMs = Date.now() - loadStart;
if (/failed/.test(foot)) {
  const toasts = await page.$$eval('.toast', (ts) => ts.map((t) => t.textContent));
  console.log(`Model failed to load.\n  ${[...toasts, ...errors].join('\n  ')}`);
  await browser.close();
  stop();
  process.exit(1);
}
console.log(`Swift ready after ${(readyMs / 1000).toFixed(1)} s`);
// INJECT_CSS switches individual effects off, to find what each one costs.
if (process.env.INJECT_CSS) await page.addStyleTag({ content: process.env.INJECT_CSS });

const voice = await page.$eval('.voice-trigger b', (e) => e.textContent);
const runs = [];
for (let r = 0; r < RUNS; r++) {
  await page.$eval('textarea', (t) => { /** @type {HTMLTextAreaElement} */ (t).value = ''; });
  await page.click('textarea');
  await page.keyboard.down('Control'); await page.keyboard.press('a'); await page.keyboard.up('Control');
  await page.keyboard.press('Backspace');
  await page.type('textarea', CORPUS.long, { delay: 0 });
  const before = await page.evaluate(() => JSON.parse(localStorage.getItem('cadence:history:v3') ?? '[]').length);
  const m0 = await page.metrics();
  const t0 = Date.now();
  await page.click('.editor-foot .btn-primary');
  /** @type {any} */
  let entry;
  for (;;) {
    entry = await page.evaluate((n) => {
      const h = JSON.parse(localStorage.getItem('cadence:history:v3') ?? '[]');
      return h.length > n ? h[0] : null;
    }, before);
    if (entry) break;
    await new Promise((res) => setTimeout(res, 250));
  }
  const m1 = await page.metrics();
  const wall = (Date.now() - t0) / 1000;
  const busy = (k) => ((m1[k] - m0[k]) / wall) * 100;
  const mainThread = { task: busy('TaskDuration'), script: busy('ScriptDuration'), style: busy('RecalcStyleDuration'), layout: busy('LayoutDuration') };
  runs.push({ rtf: entry.stats.rtf, ttfaMs: entry.stats.ttfaMs, audioS: entry.seconds, gaps: entry.stats.gaps ?? null, gapMs: entry.stats.gapMs ?? null, mainThread });
  console.log(`  run ${r + 1}: RTF ${entry.stats.rtf.toFixed(3)} · first audio ${Math.round(entry.stats.ttfaMs)} ms · gaps ${entry.stats.gaps ?? '?'} (${entry.stats.gapMs ?? '?'} ms) · main thread busy ${mainThread.task.toFixed(0)}% (script ${mainThread.script.toFixed(0)}%, style ${mainThread.style.toFixed(0)}%, layout ${mainThread.layout.toFixed(0)}%)`);
}
const chrome = await browser.version();
await browser.close();
stop();

runs.sort((a, b) => a.rtf - b.rtf);
const median = runs[Math.floor(RUNS / 2)];
console.log(`Median: RTF ${median.rtf.toFixed(3)} · first audio ${Math.round(median.ttfaMs)} ms`);
if (errors.length) console.log(`Console errors:\n  ${errors.join('\n  ')}`);

const cpu = os.cpus()[0].model.replace(/\(R\)|\(TM\)|CPU|@.*$/g, '').replace(/\s+/g, ' ').trim();
const slug = cpu.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');
if (DIAGNOSTIC) process.exit(0);
const out = new URL(`../../docs/bench/${slug}.app.json`, import.meta.url);
const prev = existsSync(out) ? JSON.parse(await readFile(out, 'utf8')) : {};
prev.swift = { chrome, date: new Date().toISOString().slice(0, 10), voice, readyMs, median, runs, consoleErrors: errors.length };
await writeFile(out, `${JSON.stringify(prev, null, 2)}\n`);
await writeReport();
process.exit(0);
