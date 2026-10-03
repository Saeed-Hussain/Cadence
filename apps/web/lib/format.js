import { encodeWav } from '@cadence/engine';

/** @param {number} s */
export function clock(s) {
  if (!Number.isFinite(s) || s < 0) s = 0;
  const m = Math.floor(s / 60);
  const r = Math.floor(s % 60);
  return `${m}:${String(r).padStart(2, '0')}`;
}

/** @param {number} ts */
export function ago(ts) {
  const d = (Date.now() - ts) / 1000;
  if (d < 45) return 'just now';
  if (d < 3600) return `${Math.round(d / 60)} min ago`;
  if (d < 86400) return `${Math.round(d / 3600)} h ago`;
  if (d < 86400 * 7) return `${Math.round(d / 86400)} d ago`;
  return new Date(ts).toLocaleDateString(undefined, { month: 'short', day: 'numeric' });
}

/** @param {number} ts */
export function dayLabel(ts) {
  const d = new Date(ts);
  const today = new Date();
  const yesterday = new Date(Date.now() - 86400000);
  if (d.toDateString() === today.toDateString()) return 'Today';
  if (d.toDateString() === yesterday.toDateString()) return 'Yesterday';
  return d.toLocaleDateString(undefined, { weekday: 'long', month: 'short', day: 'numeric' });
}

/**
 * @param {Float32Array} samples
 * @param {number} sampleRate
 * @param {string} name
 */
export function downloadWav(samples, sampleRate, name) {
  const blob = new Blob([encodeWav(samples, sampleRate)], { type: 'audio/wav' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = `${name.replace(/[^\w\- ]+/g, '').trim().slice(0, 48) || 'cadence'}.wav`;
  a.click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

/**
 * Downsample to `bars` peak values in 0–1, for drawing.
 *
 * @param {Float32Array} samples
 * @param {number} bars
 */
export function peaks(samples, bars) {
  const out = new Float32Array(bars);
  const step = Math.max(1, Math.floor(samples.length / bars));
  let max = 0;
  for (let b = 0; b < bars; b++) {
    let p = 0;
    const start = b * step;
    for (let i = start; i < start + step && i < samples.length; i += 4) {
      const v = Math.abs(samples[i]);
      if (v > p) p = v;
    }
    out[b] = p;
    if (p > max) max = p;
  }
  if (max > 0) for (let b = 0; b < bars; b++) out[b] = Math.pow(out[b] / max, 0.7);
  return out;
}

/** @param {string} s */
export const cap = (s) => s.charAt(0).toUpperCase() + s.slice(1);
