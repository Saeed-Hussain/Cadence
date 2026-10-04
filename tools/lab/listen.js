/**
 * Render a listening set: the same passage in several LibriTTS-R speakers,
 * and one speaker at several expressiveness settings.
 *
 * Quality is judged by ear, so this produces files to listen to rather than
 * a number. Same passage every time, so a change is the only difference.
 *
 *   node tools/lab/listen.js                      default set
 *   node tools/lab/listen.js --speakers 0,12,400  chosen speakers
 */

import { mkdir, readFile, writeFile } from 'node:fs/promises';
import * as ort from 'onnxruntime-node';
import { loadPiper, sentences } from '../../packages/cadence/src/piper.js';
import { encodeWav } from '../../packages/cadence/src/wav.js';

const PASSAGE =
  'Have you ever wondered what your own voice sounds like to someone else? ' +
  'It is stranger than you think. Most people hate the first recording they hear of themselves, ' +
  'but after a while, it simply sounds like you.';

const arg = (name) => {
  const i = process.argv.indexOf(`--${name}`);
  return i > 0 ? process.argv[i + 1] : undefined;
};

const MODEL = new URL('../../.cache/models/en_US-libritts_r-medium', import.meta.url).href;
const OUT = new URL('../../.cache/lab/', import.meta.url);

const config = JSON.parse(await readFile(new URL(`${MODEL}.onnx.json`), 'utf8'));
const speakers = (arg('speakers') ?? '0,57,131,240,388,512,690,871').split(',').map(Number);

/** Expressiveness settings for speaker 0: noise_scale / noise_w. */
const VARIANTS = [
  { name: 'steady', noise_scale: 0.2, noise_w: 0.2 },
  { name: 'default', noise_scale: config.inference.noise_scale, noise_w: config.inference.noise_w },
  { name: 'lively', noise_scale: 0.6, noise_w: 0.8 },
];

await mkdir(OUT, { recursive: true });
const model = await readFile(new URL(`${MODEL}.onnx`));

/** @param {any} cfg @param {number} speaker @param {string} file */
async function render(cfg, speaker, file) {
  const piper = await loadPiper({ ort, model, config: cfg });
  const parts = [];
  for (const s of sentences(PASSAGE)) parts.push(await piper.speak(s, { speaker }));
  const pause = new Float32Array(Math.round(piper.sampleRate * 0.25));
  const all = new Float32Array(parts.reduce((n, p) => n + p.length + pause.length, 0));
  let o = 0;
  for (const p of parts) { all.set(p, o); o += p.length + pause.length; }
  await writeFile(new URL(file, OUT), encodeWav(all, piper.sampleRate));
  console.log(`  ${file}  ${(all.length / piper.sampleRate).toFixed(1)} s`);
}

console.log('Speakers:');
for (const s of speakers) {
  const reader = Object.entries(config.speaker_id_map).find(([, i]) => i === s)?.[0];
  await render(config, s, `speaker-${String(s).padStart(3, '0')}-reader-${reader}.wav`);
}
console.log('Speaker 0, expressiveness:');
for (const v of VARIANTS) {
  await render({ ...config, inference: { ...config.inference, noise_scale: v.noise_scale, noise_w: v.noise_w } }, 0, `speaker-000-${v.name}.wav`);
}
console.log(`\nWritten to ${OUT.pathname.replace(/^\/([A-Z]:)/, '$1')}`);
