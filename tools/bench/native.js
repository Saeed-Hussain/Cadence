/**
 * M0: measure every candidate on this machine and publish the numbers.
 *
 *   npm run bench                      every candidate whose weights are here
 *   npm run bench -- piper-lessac-low  just the named ones
 *
 * Writes docs/bench/<cpu>.json and regenerates docs/BENCHMARKS.md from every
 * machine's file, losses included.
 */

import { execFile } from 'node:child_process';
import { existsSync } from 'node:fs';
import { mkdir, readdir, readFile, writeFile } from 'node:fs/promises';
import os from 'node:os';
import { CANDIDATES, CORPUS, MODELS_DIR } from './candidates.js';

const only = process.argv.slice(2);
const DOCS = new URL('../../docs/', import.meta.url);

const cpu = os.cpus()[0].model.replace(/\(R\)|\(TM\)|CPU|@.*$/g, '').replace(/\s+/g, ' ').trim();
const machine = {
  cpu,
  threads: os.cpus().length,
  ramGb: Math.round(os.totalmem() / 2 ** 30),
  os: `${os.type()} ${os.release()}`,
  node: process.version,
  date: new Date().toISOString().slice(0, 10),
};
const slug = cpu.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');

/** @param {string} id */
function runOne(id) {
  return new Promise((resolve) => {
    execFile(process.execPath, [new URL('./run-one.js', import.meta.url).pathname.replace(/^\/([A-Z]:)/, '$1'), id],
      { maxBuffer: 1 << 24, timeout: 30 * 60 * 1000 },
      (err, stdout, stderr) => {
        const line = stdout.trim().split('\n').pop() ?? '';
        try { resolve(JSON.parse(line)); } catch {
          resolve({ id, error: (err?.message ?? stderr.split('\n').find((l) => /Error/.test(l)) ?? 'failed').slice(0, 200) });
        }
      });
  });
}

const available = (/** @type {import('./candidates.js').Candidate} */ c) =>
  c.family === 'kokoro' || existsSync(new URL(`${c.file}.onnx`, MODELS_DIR));

const file = new URL(`bench/${slug}.json`, DOCS);
/** @type {{machine: typeof machine, runs: any[]}} */
const previous = existsSync(file) ? JSON.parse(await readFile(file, 'utf8')) : { machine, runs: [] };
const runs = new Map(previous.runs.map((r) => [r.id, r]));

console.log(`${machine.cpu} · ${machine.threads} threads · ${machine.ramGb} GB · ${machine.node}`);
for (const c of CANDIDATES) {
  if (only.length && !only.includes(c.id)) continue;
  if (!available(c)) { console.log(`  skip ${c.id} (weights not downloaded)`); continue; }
  process.stdout.write(`  ${c.id.padEnd(26)}`);
  const r = /** @type {any} */ (await runOne(c.id));
  runs.set(c.id, { ...r, label: c.label, params: c.params, measured: machine.date });
  console.log(r.error ? `error: ${r.error}` : `RTF ${r.results.long.rtf.toFixed(3)} · first audio ${Math.round(r.results.short.ttfaMs)} ms · ${r.peakRssMb} MB`);
}

await mkdir(new URL('bench/', DOCS), { recursive: true });
await writeFile(file, `${JSON.stringify({ machine, runs: [...runs.values()] }, null, 2)}\n`);
await writeMarkdown();

async function writeMarkdown() {
  const files = (await readdir(new URL('bench/', DOCS))).filter((f) => f.endsWith('.json') && !f.endsWith('.browser.json'));
  let md = `# Benchmarks

Measured with \`npm run bench\`, natively (onnxruntime-node), on named hardware. Every
candidate is shown, including the ones that lose. Regenerated from \`docs/bench/*.json\`;
do not edit by hand.

**RTF** is real-time factor: seconds of compute per second of audio. Under 1 is faster
than real time. The proposal's target is under 0.3. **First audio** is the time until
the first sentence of the short passage is ready.

Text: short "${CORPUS.short}" · medium, two sentences · long, four sentences.
Median of five runs after one warm-up.
`;
  for (const f of files) {
    const { machine: m, runs: rs } = JSON.parse(await readFile(new URL(`bench/${f}`, DOCS), 'utf8'));
    md += `\n## ${m.cpu} · ${m.threads} threads · ${m.ramGb} GB RAM\n\n${m.os} · Node ${m.node}\n\n`;
    md += '| Model | Params | RTF long | RTF short | First audio | Load | Peak memory |\n|---|---|---|---|---|---|---|\n';
    const sorted = [...rs].sort((a, b) => (a.results?.long.rtf ?? 99) - (b.results?.long.rtf ?? 99));
    for (const r of sorted) {
      if (r.error) { md += `| ${r.label} | ${r.params} | failed: ${r.error} | | | | |\n`; continue; }
      const rtf = r.results.long.rtf;
      const mark = rtf < 0.3 ? ' ✅' : rtf < 1 ? ' ✔︎' : ' ✗';
      md += `| ${r.label} | ${r.params} | **${rtf.toFixed(3)}**${mark} | ${r.results.short.rtf.toFixed(3)} | ${Math.round(r.results.short.ttfaMs)} ms | ${(r.loadMs / 1000).toFixed(1)} s | ${r.peakRssMb} MB |\n`;
    }
  }
  md += '\n✅ meets the target (< 0.3) · ✔︎ faster than real time · ✗ slower than real time\n';
  await writeFile(new URL('BENCHMARKS.md', DOCS), md);
}
