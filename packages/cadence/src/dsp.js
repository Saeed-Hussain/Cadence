/**
 * Small signal-processing helpers that run on the main thread.
 */

/**
 * Mean pitch of a recording, by autocorrelation over its loudest frames.
 * Used to match a recording to the nearest voice in the library.
 *
 * @param {Float32Array} samples
 * @param {number} sampleRate
 * @returns {number} Hz, or 0 when nothing voiced was found
 */
export function estimatePitch(samples, sampleRate) {
  const frame = Math.round(sampleRate * 0.04);
  const minLag = Math.floor(sampleRate / 400);
  const maxLag = Math.floor(sampleRate / 70);
  /** @type {{energy: number, start: number}[]} */
  const frames = [];
  for (let s = 0; s + frame + maxLag < samples.length; s += frame) {
    let e = 0;
    for (let i = 0; i < frame; i++) e += samples[s + i] ** 2;
    frames.push({ energy: e, start: s });
  }
  frames.sort((a, b) => b.energy - a.energy);
  const found = [];
  for (const { start } of frames.slice(0, 40)) {
    let best = 0;
    let bestLag = 0;
    for (let lag = minLag; lag <= maxLag; lag++) {
      let c = 0;
      let e = 0;
      for (let i = 0; i < frame; i++) {
        c += samples[start + i] * samples[start + i + lag];
        e += samples[start + i + lag] ** 2;
      }
      const score = e > 0 ? c / Math.sqrt(e) : 0;
      if (score > best) { best = score; bestLag = lag; }
    }
    if (bestLag) found.push(sampleRate / bestLag);
  }
  if (!found.length) return 0;
  found.sort((a, b) => a - b);
  return Math.round(found[found.length >> 1]);
}
