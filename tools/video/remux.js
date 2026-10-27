/**
 * Fragmented MP4 (what Chrome's MediaRecorder writes) to a regular,
 * fast-start MP4: one moov with full sample tables at the front, then one
 * mdat. Same encoded samples, copied byte for byte — no re-encoding — but a
 * file every player knows the length of and can seek in.
 *
 *   node tools/video/remux.js in.mp4 out.mp4
 */

import { closeSync, fstatSync, openSync, readSync, writeSync } from 'node:fs';

/** @param {number} fd @param {number} pos @param {number} len */
function read(fd, pos, len) {
  const b = Buffer.alloc(len);
  readSync(fd, b, 0, len, pos);
  return b;
}

/** Child boxes of a buffer region. @param {Buffer} b */
function boxes(b, start = 0, end = b.length) {
  const out = [];
  for (let o = start; o + 8 <= end;) {
    let size = b.readUInt32BE(o);
    const type = b.toString('latin1', o + 4, o + 8);
    let head = 8;
    if (size === 1) { size = Number(b.readBigUInt64BE(o + 8)); head = 16; }
    if (size === 0) size = end - o;
    out.push({ type, start: o, size, body: o + head, end: o + size });
    o += size;
  }
  return out;
}
const child = (b, parent, type) => boxes(b, parent.body, parent.end).find((x) => x.type === type);

/** @param {string} type @param {...Buffer} parts */
function box(type, ...parts) {
  const body = Buffer.concat(parts);
  const h = Buffer.alloc(8);
  h.writeUInt32BE(8 + body.length, 0);
  h.write(type, 4, 'latin1');
  return Buffer.concat([h, body]);
}
/** A full box: version and flags first. */
function fbox(type, version, flags, ...parts) {
  const vf = Buffer.alloc(4);
  vf.writeUInt32BE(((version & 0xff) << 24) | (flags & 0xffffff), 0);
  return box(type, vf, ...parts);
}
const u32 = (n) => { const b = Buffer.alloc(4); b.writeUInt32BE(n >>> 0, 0); return b; };
const i32 = (n) => { const b = Buffer.alloc(4); b.writeInt32BE(n, 0); return b; };
const u64 = (n) => { const b = Buffer.alloc(8); b.writeBigUInt64BE(BigInt(n), 0); return b; };

export function remux(input, output) {
  const fd = openSync(input, 'r');
  const size = fstatSync(fd).size;

  // Top level: ftyp, moov, then (moof, mdat) pairs.
  /** @type {{type: string, start: number, size: number}[]} */
  const top = [];
  for (let pos = 0; pos < size;) {
    const h = read(fd, pos, 16);
    let s = h.readUInt32BE(0);
    if (s === 1) s = Number(h.readBigUInt64BE(8));
    if (s === 0) s = size - pos;
    top.push({ type: h.toString('latin1', 4, 8), start: pos, size: s });
    pos += s;
  }
  const ftypBox = top.find((x) => x.type === 'ftyp');
  const moovBox = top.find((x) => x.type === 'moov');
  const moov = read(fd, moovBox.start, moovBox.size);
  const mroot = boxes(moov)[0];

  const mvhd = child(moov, mroot, 'mvhd');
  const movieScale = moov[mvhd.body] === 1 ? moov.readUInt32BE(mvhd.body + 20) : moov.readUInt32BE(mvhd.body + 12);

  // Tracks, and the defaults each one's fragments fall back on.
  const traks = boxes(moov, mroot.body, mroot.end).filter((x) => x.type === 'trak');
  const mvex = child(moov, mroot, 'mvex');
  const trex = new Map();
  for (const t of boxes(moov, mvex.body, mvex.end).filter((x) => x.type === 'trex')) {
    const p = t.body + 4;
    trex.set(moov.readUInt32BE(p), { duration: moov.readUInt32BE(p + 8), size: moov.readUInt32BE(p + 12), flags: moov.readUInt32BE(p + 16) });
  }
  const tracks = traks.map((t) => {
    const tkhd = child(moov, t, 'tkhd');
    const id = moov.readUInt32BE(tkhd.body + (moov[tkhd.body] === 1 ? 20 : 12));
    const mdia = child(moov, t, 'mdia');
    const mdhd = child(moov, mdia, 'mdhd');
    const scale = moov.readUInt32BE(mdhd.body + (moov[mdhd.body] === 1 ? 20 : 12));
    const hdlr = child(moov, mdia, 'hdlr');
    const handler = moov.toString('latin1', hdlr.body + 8, hdlr.body + 12);
    return { id, t, tkhd, mdia, mdhd, scale, handler, samples: /** @type {any[]} */ ([]), runs: /** @type {{offset: number, count: number, bytes: number}[]} */ ([]) };
  });
  const byId = new Map(tracks.map((x) => [x.id, x]));

  // Every sample of every fragment, in file order.
  for (const f of top.filter((x) => x.type === 'moof')) {
    const moof = read(fd, f.start, f.size);
    const root = boxes(moof)[0];
    for (const traf of boxes(moof, root.body, root.end).filter((x) => x.type === 'traf')) {
      const tfhd = child(moof, traf, 'tfhd');
      const tflags = moof.readUInt32BE(tfhd.body) & 0xffffff;
      let p = tfhd.body + 4;
      const id = moof.readUInt32BE(p); p += 4;
      const tr = byId.get(id);
      const def = { ...trex.get(id) };
      let base = f.start; // default-base-is-moof, or the moof when nothing is said
      if (tflags & 0x1) { base = Number(moof.readBigUInt64BE(p)); p += 8; }
      if (tflags & 0x2) p += 4;
      if (tflags & 0x8) { def.duration = moof.readUInt32BE(p); p += 4; }
      if (tflags & 0x10) { def.size = moof.readUInt32BE(p); p += 4; }
      if (tflags & 0x20) { def.flags = moof.readUInt32BE(p); p += 4; }
      for (const trun of boxes(moof, traf.body, traf.end).filter((x) => x.type === 'trun')) {
        const version = moof[trun.body];
        const rflags = moof.readUInt32BE(trun.body) & 0xffffff;
        let q = trun.body + 4;
        const count = moof.readUInt32BE(q); q += 4;
        let dataOffset = 0;
        if (rflags & 0x1) { dataOffset = moof.readInt32BE(q); q += 4; }
        let first = null;
        if (rflags & 0x4) { first = moof.readUInt32BE(q); q += 4; }
        let offset = base + dataOffset;
        const runStart = offset;
        let runBytes = 0;
        for (let i = 0; i < count; i++) {
          let duration = def.duration, sz = def.size, flags = def.flags, cto = 0;
          if (rflags & 0x100) { duration = moof.readUInt32BE(q); q += 4; }
          if (rflags & 0x200) { sz = moof.readUInt32BE(q); q += 4; }
          if (rflags & 0x400) { flags = moof.readUInt32BE(q); q += 4; }
          if (rflags & 0x800) { cto = version === 0 ? moof.readUInt32BE(q) : moof.readInt32BE(q); q += 4; }
          if (i === 0 && first !== null) flags = first;
          tr.samples.push({ duration, size: sz, sync: !(flags & 0x10000), cto });
          offset += sz;
          runBytes += sz;
        }
        tr.runs.push({ offset: runStart, count, bytes: runBytes, track: id });
      }
    }
  }

  // Runs in file order, so the new mdat keeps the same interleaving.
  const runs = tracks.flatMap((tr) => tr.runs.map((r) => ({ ...r, tr }))).sort((a, b) => a.offset - b.offset);
  const durations = new Map(tracks.map((tr) => [tr.id, tr.samples.reduce((s, x) => s + x.duration, 0)]));
  const movieDuration = Math.max(...tracks.map((tr) => Math.round((durations.get(tr.id) / tr.scale) * movieScale)));

  /** The sample tables for one track, given where each of its runs lands. */
  function stbl(tr, offsets) {
    const stbl0 = child(moov, child(moov, child(moov, tr.mdia, 'minf'), 'stbl'), 'stsd');
    const stsd = moov.subarray(stbl0.start, stbl0.end);
    const sttsE = [];
    for (const s of tr.samples) {
      const last = sttsE.at(-1);
      if (last && last[1] === s.duration) last[0]++; else sttsE.push([1, s.duration]);
    }
    const parts = [stsd, fbox('stts', 0, 0, u32(sttsE.length), ...sttsE.flatMap(([c, d]) => [u32(c), u32(d)]))];
    if (tr.samples.some((s) => s.cto)) {
      const e = [];
      for (const s of tr.samples) { const l = e.at(-1); if (l && l[1] === s.cto) l[0]++; else e.push([1, s.cto]); }
      parts.push(fbox('ctts', 1, 0, u32(e.length), ...e.flatMap(([c, o]) => [u32(c), i32(o)])));
    }
    if (tr.samples.some((s) => !s.sync)) {
      const sync = tr.samples.map((s, i) => (s.sync ? i + 1 : 0)).filter(Boolean);
      parts.push(fbox('stss', 0, 0, u32(sync.length), ...sync.map(u32)));
    }
    const stsc = [];
    tr.runs.forEach((r, i) => { const l = stsc.at(-1); if (!l || l[1] !== r.count) stsc.push([i + 1, r.count]); });
    parts.push(fbox('stsc', 0, 0, u32(stsc.length), ...stsc.flatMap(([c, n]) => [u32(c), u32(n), u32(1)])));
    parts.push(fbox('stsz', 0, 0, u32(0), u32(tr.samples.length), ...tr.samples.map((s) => u32(s.size))));
    parts.push(fbox('co64', 0, 0, u32(offsets.length), ...offsets.map(u64)));
    return box('stbl', ...parts);
  }

  /** The whole moov, given the run offsets in the new file. */
  function buildMoov(runOffsets) {
    const mvhdBuf = Buffer.from(moov.subarray(mvhd.start, mvhd.end));
    if (mvhdBuf[8] === 1) mvhdBuf.writeBigUInt64BE(BigInt(movieDuration), 8 + 4 + 16 + 4);
    else mvhdBuf.writeUInt32BE(movieDuration, 8 + 4 + 8 + 4);
    const trakBufs = tracks.map((tr) => {
      const tkhd = Buffer.from(moov.subarray(tr.tkhd.start, tr.tkhd.end));
      const tdur = Math.round((durations.get(tr.id) / tr.scale) * movieScale);
      if (tkhd[8] === 1) tkhd.writeBigUInt64BE(BigInt(tdur), 8 + 4 + 16 + 4 + 4); else tkhd.writeUInt32BE(tdur, 8 + 4 + 8 + 4 + 4);
      const mdhd = Buffer.from(moov.subarray(tr.mdhd.start, tr.mdhd.end));
      if (mdhd[8] === 1) mdhd.writeBigUInt64BE(BigInt(durations.get(tr.id)), 8 + 4 + 16 + 4); else mdhd.writeUInt32BE(durations.get(tr.id), 8 + 4 + 8 + 4);
      const minf = child(moov, tr.mdia, 'minf');
      const keep = boxes(moov, minf.body, minf.end).filter((x) => x.type !== 'stbl').map((x) => moov.subarray(x.start, x.end));
      const hdlr = child(moov, tr.mdia, 'hdlr');
      const mdia = box('mdia', mdhd, moov.subarray(hdlr.start, hdlr.end), box('minf', ...keep, stbl(tr, runOffsets.get(tr.id))));
      return box('trak', tkhd, mdia);
    });
    return box('moov', mvhdBuf, ...trakBufs);
  }

  const ftyp = read(fd, ftypBox.start, ftypBox.size);
  // Offsets are 64-bit, so the moov's size does not depend on their values.
  const dummy = new Map(tracks.map((tr) => [tr.id, tr.runs.map(() => 0)]));
  const moovSize = buildMoov(dummy).length;
  const mdatBytes = runs.reduce((s, r) => s + r.bytes, 0);
  const mdatHead = 16;
  let cursor = ftyp.length + moovSize + mdatHead;
  const offsets = new Map(tracks.map((tr) => [tr.id, []]));
  for (const r of runs) { offsets.get(r.tr.id).push(cursor); cursor += r.bytes; }
  const newMoov = buildMoov(offsets);
  if (newMoov.length !== moovSize) throw new Error('moov size changed');

  const out = openSync(output, 'w');
  writeSync(out, ftyp);
  writeSync(out, newMoov);
  const mh = Buffer.alloc(16);
  mh.writeUInt32BE(1, 0); mh.write('mdat', 4, 'latin1'); mh.writeBigUInt64BE(BigInt(16 + mdatBytes), 8);
  writeSync(out, mh);
  for (const r of runs) {
    for (let done = 0; done < r.bytes;) {
      const n = Math.min(8 << 20, r.bytes - done);
      writeSync(out, read(fd, r.offset + done, n));
      done += n;
    }
  }
  closeSync(out);
  closeSync(fd);
  return { seconds: movieDuration / movieScale, tracks: tracks.map((tr) => ({ handler: tr.handler, samples: tr.samples.length, seconds: durations.get(tr.id) / tr.scale })) };
}

if (process.argv[1]?.endsWith('remux.js')) {
  const [input, output] = process.argv.slice(2);
  const r = remux(input, output);
  console.log(`Remuxed: ${r.seconds.toFixed(2)} s · ${r.tracks.map((t) => `${t.handler} ${t.samples} samples ${t.seconds.toFixed(2)} s`).join(' · ')}`);
}
