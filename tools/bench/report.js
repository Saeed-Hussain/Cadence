/**
 * docs/BENCHMARKS.md, regenerated from the measurements in docs/bench/.
 *
 * Called by both benchmarks after they write their numbers, and runnable on
 * its own (`npm run bench:report`). The markdown is never edited by hand, so
 * it cannot drift from the data.
 */

import { readdir, readFile, writeFile } from 'node:fs/promises';
import { CORPUS } from './candidates.js';

const DOCS = new URL('../../docs/', import.meta.url);

const mark = (/** @type {number} */ rtf) => (rtf < 0.3 ? ' ✅' : rtf < 1 ? ' ✔︎' : ' ✗');

export async function writeReport() {
  const all = await readdir(new URL('bench/', DOCS));
  const machines = all.filter((f) => f.endsWith('.json') && !f.includes('.browser.'));

  let md = `# Benchmarks

Every number here is measured on named hardware and regenerated from \`docs/bench/*.json\`.
Every candidate is shown, including the ones that lose. Do not edit by hand.

**RTF** is real-time factor: seconds of compute per second of audio. Under 1 is faster
than real time; the proposal's target is under 0.3. **First audio** is the time until the
first sentence of the short passage is ready.

Text: short "${CORPUS.short}" · medium, two sentences · long, four sentences.
Median of five runs after one warm-up.

## Keeping these honest

CI runs on GitHub's machines, not on the target, so it cannot gate speed. Instead: any
change to the engine or its models is merged only with \`npm run bench\` (and, for browser
paths, \`npm run bench:browser\`) re-run on the slowest target machine, and this file
regenerated in the same commit. A slower number is published, not hidden.
`;

  for (const f of machines) {
    const { machine: m, runs } = JSON.parse(await readFile(new URL(`bench/${f}`, DOCS), 'utf8'));
    md += `\n## ${m.cpu} · ${m.threads} threads · ${m.ramGb} GB RAM\n\n${m.os} · Node ${m.node}\n`;

    md += '\n### Native (onnxruntime-node)\n\n';
    md += '| Model | Params | RTF long | RTF short | First audio | Load | Peak memory |\n|---|---|---|---|---|---|---|\n';
    const sorted = [...runs].sort((a, b) => (a.results?.long.rtf ?? 99) - (b.results?.long.rtf ?? 99));
    for (const r of sorted) {
      if (r.error) { md += `| ${r.label} | ${r.params} | failed: ${r.error} | | | | |\n`; continue; }
      const rtf = r.results.long.rtf;
      md += `| ${r.label} | ${r.params} | **${rtf.toFixed(3)}**${mark(rtf)} | ${r.results.short.rtf.toFixed(3)} | ${Math.round(r.results.short.ttfaMs)} ms | ${(r.loadMs / 1000).toFixed(1)} s | ${r.peakRssMb} MB |\n`;
    }

    const browserFile = f.replace(/\.json$/, '.browser.json');
    if (all.includes(browserFile)) {
      const browser = JSON.parse(await readFile(new URL(`bench/${browserFile}`, DOCS), 'utf8'));
      for (const [model, { chrome, date, results }] of Object.entries(browser)) {
        const native = runs.find((r) => r.id === `piper-${model.replace(/^en_US-/, '')}`);
        md += `\n### Browser (onnxruntime-web) · ${model}\n\n${chrome.replace('/', ' ')} · ${date}`;
        if (native?.results) md += ` · native for comparison: RTF ${native.results.long.rtf.toFixed(3)}, first audio ${Math.round(native.results.short.ttfaMs)} ms`;
        md += '\n\n| Setup | RTF long | RTF short | First audio | Load | vs native |\n|---|---|---|---|---|---|\n';
        for (const r of results) {
          if (r.error) { md += `| ${r.label} | failed: ${r.error} | | | | |\n`; continue; }
          const rtf = r.results.long.rtf;
          const ratio = native?.results ? `${(rtf / native.results.long.rtf).toFixed(1)}× slower` : '';
          md += `| ${r.label} | **${rtf.toFixed(3)}**${mark(rtf)} | ${r.results.short.rtf.toFixed(3)} | ${Math.round(r.results.short.ttfaMs)} ms | ${(r.loadMs / 1000).toFixed(1)} s | ${ratio} |\n`;
        }
      }
    }
  }

  md += '\n✅ meets the target (< 0.3) · ✔︎ faster than real time · ✗ slower than real time\n';
  await writeFile(new URL('BENCHMARKS.md', DOCS), md);
}

if (import.meta.url === `file:///${process.argv[1]?.replace(/\\/g, '/').replace(/^\//, '')}`) await writeReport();
