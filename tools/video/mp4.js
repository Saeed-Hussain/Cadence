/**
 * Just enough MP4 to write the film: read the sample tables of a regular
 * MP4, and write a fast-start MP4 from a video track (H.264 samples and their
 * avcC) and an audio track (samples copied from another file), with an edit
 * list that lines the audio up to the picture.
 */

import { closeSync, openSync, readSync, writeSync } from 'node:fs';

const read = (fd, pos, len) => { const b = Buffer.alloc(len); readSync(fd, b, 0, len, pos); return b; };

function boxes(b, s, e) {
  const out = [];
  for (let o = s; o + 8 <= e;) {
    const sz = b.readUInt32BE(o);
    out.push({ type: b.toString('latin1', o + 4, o + 8), start: o, body: o + 8, end: o + sz });
    if (sz < 8) break;
    o += sz;
  }
  return out;
}

/**
 * One track of a regular (non-fragmented) MP4: its sample entry, timescale,
 * and every sample's offset, size and duration.
 *
 * @param {string} path @param {'vide' | 'soun'} handler
 */
export function readTrack(path, handler) {
  const fd = openSync(path, 'r');
  const ftyp = read(fd, 0, 8).readUInt32BE(0);
  const size = read(fd, ftyp, 8).readUInt32BE(0);
  const moov = read(fd, ftyp, size);
  const find = (box, path2) => {
    let cur = box;
    for (const t of path2) cur = boxes(moov, cur.body, cur.end).find((x) => x.type === t);
    return cur;
  };
  const root = { body: 8, end: size };
  const trak = boxes(moov, root.body, root.end).filter((x) => x.type === 'trak').find((t) => {
    const h = find(t, ['mdia', 'hdlr']);
    return moov.toString('latin1', h.body + 8, h.body + 12) === handler;
  });
  const mdhd = find(trak, ['mdia', 'mdhd']);
  const scale = moov.readUInt32BE(mdhd.body + (moov[mdhd.body] === 1 ? 20 : 12));
  const stbl = find(trak, ['mdia', 'minf', 'stbl']);
  const kid = (t) => boxes(moov, stbl.body, stbl.end).find((x) => x.type === t);
  const stsd = kid('stsd');
  const stsz = kid('stsz');
  const n = moov.readUInt32BE(stsz.body + 8);
  const fixed = moov.readUInt32BE(stsz.body + 4);
  const sizes = Array.from({ length: n }, (_, i) => fixed || moov.readUInt32BE(stsz.body + 12 + i * 4));
  const stts = kid('stts');
  const durations = [];
  for (let i = 0, e = moov.readUInt32BE(stts.body + 4); i < e; i++) {
    const c = moov.readUInt32BE(stts.body + 8 + i * 8);
    const d = moov.readUInt32BE(stts.body + 12 + i * 8);
    for (let k = 0; k < c; k++) durations.push(d);
  }
  const co = kid('co64') ?? kid('stco');
  const wide = co.type === 'co64';
  const chunks = Array.from({ length: moov.readUInt32BE(co.body + 4) }, (_, i) => (wide ? Number(moov.readBigUInt64BE(co.body + 8 + i * 8)) : moov.readUInt32BE(co.body + 8 + i * 4)));
  const stsc = kid('stsc');
  const sc = Array.from({ length: moov.readUInt32BE(stsc.body + 4) }, (_, i) => [moov.readUInt32BE(stsc.body + 8 + i * 12), moov.readUInt32BE(stsc.body + 12 + i * 12)]);
  const offsets = [];
  for (let c = 0, s = 0; c < chunks.length; c++) {
    const per = sc.filter(([first]) => first <= c + 1).at(-1)[1];
    let o = chunks[c];
    for (let k = 0; k < per && s < n; k++, s++) { offsets.push(o); o += sizes[s]; }
  }
  return { fd, scale, stsd: moov.subarray(stsd.start, stsd.end), samples: sizes.map((sz, i) => ({ size: sz, duration: durations[i], offset: offsets[i] })) };
}

// ─── Writing ──────────────────────────────────────────────────────────────
const box = (type, ...parts) => {
  const body = Buffer.concat(parts);
  const h = Buffer.alloc(8);
  h.writeUInt32BE(8 + body.length, 0);
  h.write(type, 4, 'latin1');
  return Buffer.concat([h, body]);
};
const fbox = (type, version, flags, ...parts) => {
  const vf = Buffer.alloc(4);
  vf.writeUInt32BE(((version & 0xff) << 24) | (flags & 0xffffff), 0);
  return box(type, vf, ...parts);
};
const u8 = (n) => Buffer.from([n & 0xff]);
const u16 = (n) => { const b = Buffer.alloc(2); b.writeUInt16BE(n & 0xffff, 0); return b; };
const u32 = (n) => { const b = Buffer.alloc(4); b.writeUInt32BE(n >>> 0, 0); return b; };
const i32 = (n) => { const b = Buffer.alloc(4); b.writeInt32BE(n, 0); return b; };
const u64 = (n) => { const b = Buffer.alloc(8); b.writeBigUInt64BE(BigInt(n), 0); return b; };
const zeros = (n) => Buffer.alloc(n);
const MATRIX = Buffer.concat([u32(0x00010000), u32(0), u32(0), u32(0), u32(0x00010000), u32(0), u32(0), u32(0), u32(0x40000000)]);

/** H.264 sample entry around the encoder's avcC. */
export function avc1Stsd(avcC, width, height) {
  const entry = box('avc1',
    zeros(6), u16(1), // reserved, data reference index
    u16(0), u16(0), zeros(12), // pre-defined, reserved
    u16(width), u16(height),
    u32(0x00480000), u32(0x00480000), u32(0), u16(1),
    zeros(32), u16(0x0018), u16(0xffff),
    box('avcC', avcC));
  return fbox('stsd', 0, 0, u32(1), entry);
}

/**
 * @param {{
 *   out: string, movieDuration: number,
 *   video: {stsd: Buffer, scale: number, width: number, height: number, samples: {data?: Buffer, size: number, duration: number, key: boolean}[]},
 *   audio: {stsd: Buffer, scale: number, fd: number, samples: {offset: number, size: number, duration: number}[], skip: number},
 * }} spec  movieDuration in seconds; audio.skip in audio timescale units
 */
export function writeMp4({ out, movieDuration, video, audio }) {
  const MOVIE = 1000;
  const dur = Math.round(movieDuration * MOVIE);

  // Interleave half-second runs of each track, in time order.
  const runs = [];
  const group = (track, kind) => {
    let at = 0, cur = null;
    track.samples.forEach((s, i) => {
      const sec = at / track.scale;
      if (!cur || sec >= cur.until) { cur = { kind, first: i, count: 0, bytes: 0, time: sec, until: sec + 0.5 }; runs.push(cur); }
      cur.count++;
      cur.bytes += s.size;
      at += s.duration;
    });
  };
  group(video, 'v');
  group(audio, 'a');
  runs.sort((a, b) => a.time - b.time || (a.kind === 'v' ? -1 : 1));

  const tables = (track, kind, offsets) => {
    const stts = [];
    for (const s of track.samples) { const l = stts.at(-1); if (l && l[1] === s.duration) l[0]++; else stts.push([1, s.duration]); }
    const myRuns = runs.filter((r) => r.kind === kind);
    const stsc = [];
    myRuns.forEach((r, i) => { const l = stsc.at(-1); if (!l || l[1] !== r.count) stsc.push([i + 1, r.count]); });
    const parts = [track.stsd,
      fbox('stts', 0, 0, u32(stts.length), ...stts.flatMap(([c, d]) => [u32(c), u32(d)]))];
    if (kind === 'v') {
      const keys = track.samples.map((s, i) => (s.key ? i + 1 : 0)).filter(Boolean);
      parts.push(fbox('stss', 0, 0, u32(keys.length), ...keys.map(u32)));
    }
    parts.push(fbox('stsc', 0, 0, u32(stsc.length), ...stsc.flatMap(([c, n]) => [u32(c), u32(n), u32(1)])));
    parts.push(fbox('stsz', 0, 0, u32(0), u32(track.samples.length), ...track.samples.map((s) => u32(s.size))));
    parts.push(fbox('co64', 0, 0, u32(offsets.length), ...offsets.map(u64)));
    return box('stbl', ...parts);
  };

  const trak = (id, kind, track, offsets) => {
    const mediaDur = track.samples.reduce((n, s) => n + s.duration, 0);
    const isV = kind === 'v';
    const tkhd = fbox('tkhd', 0, 3, u32(0), u32(0), u32(id), u32(0), u32(dur), zeros(8), u16(0), u16(0), u16(isV ? 0 : 0x0100), u16(0), MATRIX,
      u32(isV ? track.width << 16 : 0), u32(isV ? track.height << 16 : 0));
    const mdhd = fbox('mdhd', 0, 0, u32(0), u32(0), u32(track.scale), u32(mediaDur), u16(0x55c4), u16(0));
    const hdlr = fbox('hdlr', 0, 0, u32(0), Buffer.from(isV ? 'vide' : 'soun', 'latin1'), zeros(12), Buffer.from(isV ? 'Cadence video\0' : 'Cadence voice\0', 'latin1'));
    const head = isV ? fbox('vmhd', 0, 1, zeros(8)) : fbox('smhd', 0, 0, u16(0), u16(0));
    const dinf = box('dinf', fbox('dref', 0, 0, u32(1), fbox('url ', 0, 1)));
    const minf = box('minf', head, dinf, tables(track, kind, offsets));
    // The audio's edit list skips what came before film time zero.
    const edts = !isV && track.skip
      ? box('edts', fbox('elst', 0, 0, u32(1), u32(dur), i32(track.skip), u16(1), u16(0)))
      : Buffer.alloc(0);
    return box('trak', tkhd, edts, box('mdia', mdhd, hdlr, minf));
  };

  const moov = (vOff, aOff) => box('moov',
    fbox('mvhd', 0, 0, u32(0), u32(0), u32(MOVIE), u32(dur), u32(0x00010000), u16(0x0100), zeros(10), MATRIX, zeros(24), u32(3)),
    trak(1, 'v', video, vOff), trak(2, 'a', audio, aOff));

  const ftyp = box('ftyp', Buffer.from('isom', 'latin1'), u32(0x200), Buffer.from('isomiso2avc1mp41', 'latin1'));
  const count = (k) => runs.filter((r) => r.kind === k).length;
  const size = moov(Array(count('v')).fill(0), Array(count('a')).fill(0)).length;
  let cursor = ftyp.length + size + 16;
  const vOff = [], aOff = [];
  for (const r of runs) { (r.kind === 'v' ? vOff : aOff).push(cursor); cursor += r.bytes; }
  const head = moov(vOff, aOff);
  if (head.length !== size) throw new Error('moov size changed');

  const fd = openSync(out, 'w');
  writeSync(fd, ftyp);
  writeSync(fd, head);
  const mdatBytes = runs.reduce((n, r) => n + r.bytes, 0);
  const mh = Buffer.alloc(16);
  mh.writeUInt32BE(1, 0); mh.write('mdat', 4, 'latin1'); mh.writeBigUInt64BE(BigInt(16 + mdatBytes), 8);
  writeSync(fd, mh);
  for (const r of runs) {
    for (let i = r.first; i < r.first + r.count; i++) {
      if (r.kind === 'v') writeSync(fd, video.samples[i].data);
      else { const s = audio.samples[i]; writeSync(fd, read(audio.fd, s.offset, s.size)); }
    }
  }
  closeSync(fd);
}
