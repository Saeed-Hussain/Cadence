/**
 * M1's offline criterion, checked end to end:
 *
 *   npm run build:web && npm run check:offline
 *
 * Visits the app once with the network on (but Hugging Face unreachable, so
 * the weights must come from the app's own /models/) and waits for the model, then
 * stops the server, relaunches Chrome with every hostname unresolvable, and
 * generates speech. Passes only if the page opens and speaks with nothing
 * reachable at all.
 */

import { spawn } from 'node:child_process';
import { rm } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import puppeteer from 'puppeteer-core';

const PORT = 3171;
const CHROME = process.env.CHROME ?? 'C:/Program Files/Google/Chrome/Application/chrome.exe';
const WEB = fileURLToPath(new URL('../../apps/web/', import.meta.url));
// A fresh profile: the first visit must be a real first visit.
const PROFILE = fileURLToPath(new URL('../../.cache/chrome-offline/', import.meta.url));
const URL_ = `http://localhost:${PORT}/text-to-speech`;

await rm(PROFILE, { recursive: true, force: true });
const server = spawn(process.execPath, [fileURLToPath(new URL('../../node_modules/next/dist/bin/next', import.meta.url)), 'start', '-p', String(PORT)], { cwd: WEB, stdio: 'ignore' });
for (let i = 0; ; i++) {
  try { if ((await fetch(`http://localhost:${PORT}/`)).ok) break; } catch { /* not up */ }
  if (i > 120) throw new Error('server did not start');
  await new Promise((r) => setTimeout(r, 500));
}

const launch = (args = []) => puppeteer.launch({ executablePath: CHROME, headless: true, protocolTimeout: 0, userDataDir: PROFILE, args: ['--no-sandbox', '--autoplay-policy=no-user-gesture-required', ...args] });
const waitFoot = async (page, re, ms = 600_000) => {
  const t0 = Date.now();
  for (;;) {
    const foot = await page.$eval('.editor-foot', (e) => e.textContent ?? '').catch(() => '');
    if (re.test(foot)) return foot;
    if (Date.now() - t0 > ms) throw new Error(`timed out; footer says "${foot}"`);
    await new Promise((r) => setTimeout(r, 500));
  }
};

// 1. Online, first visit.
// Hugging Face is blocked: the weights must come from the app itself.
let browser = await launch(['--host-resolver-rules=MAP huggingface.co ~NOTFOUND']);
let page = await browser.newPage();
await page.goto(URL_, { waitUntil: 'networkidle2' });
await waitFoot(page, /Ctrl ↵|failed/);
await page.evaluate(() => navigator.serviceWorker.ready);
// Let the worker finish keeping the shell.
await new Promise((r) => setTimeout(r, 4000));
console.log('online: model ready, offline shell installed');
await browser.close();
server.kill();

// 2. Nothing reachable.
browser = await launch(['--host-resolver-rules=MAP * ~NOTFOUND']);
page = await browser.newPage();
const errors = [];
page.on('pageerror', (e) => errors.push(e.message));
let ok = false;
try {
  await page.goto(URL_, { waitUntil: 'load', timeout: 30_000 });
  await waitFoot(page, /Ctrl ↵|failed/, 120_000);
  await page.type('textarea', 'This sentence was spoken with the network switched off.');
  await page.click('.editor-foot .btn-primary');
  for (let i = 0; i < 240 && !ok; i++) {
    ok = await page.evaluate(() => JSON.parse(localStorage.getItem('cadence:history:v3') ?? '[]').length > 0);
    if (!ok) await new Promise((r) => setTimeout(r, 250));
  }
} catch (e) {
  errors.push(String(e));
}
await browser.close();
console.log(ok ? 'offline: page opened and spoke — PASS' : `offline: FAIL\n  ${errors.join('\n  ')}`);
process.exit(ok ? 0 : 1);
