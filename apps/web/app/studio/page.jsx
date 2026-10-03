'use client';

import { useEffect, useMemo, useRef, useState } from 'react';
import { VOICES } from '@cadence/engine';
import { Icon } from '@/components/Icon.jsx';
import { Orb } from '@/components/Orb.jsx';
import { VoicePicker } from '@/components/VoicePicker.jsx';
import { player, useIsPlaying, usePlayer } from '@/lib/audio.js';
import { clock, downloadWav } from '@/lib/format.js';
import { useStore } from '@/lib/store.jsx';

/** @typedef {{id: string, voiceId: string, text: string}} Block */

const KEY = 'cadence:studio';
const GAP_SECONDS = 0.35;
const RATE = 24000;

const SAMPLE = {
  title: 'The Lighthouse — Chapter One',
  blocks: [
    { id: 'b1', voiceId: VOICES[2].id, text: 'The lighthouse keeper had not seen a ship in eleven years.' },
    { id: 'b2', voiceId: VOICES[2].id, text: 'So when the lamp caught a sail on the horizon, she did not believe it.' },
    { id: 'b3', voiceId: VOICES[1].id, text: 'Ahoy! Is anyone up there? We need the light — the fog is closing in!' },
    { id: 'b4', voiceId: VOICES[2].id, text: 'She climbed the hundred and twelve steps, and for the first time in eleven years, she answered.' },
  ],
};

const uid = () => Math.random().toString(36).slice(2, 9);

export default function Studio() {
  const { generate, byId, voiceId: defaultVoice, toast } = useStore();
  const [title, setTitle] = useState(SAMPLE.title);
  const [blocks, setBlocks] = useState(/** @type {Block[]} */ (SAMPLE.blocks));
  const [focus, setFocus] = useState('');
  const [busy, setBusy] = useState(/** @type {Set<string>} */ (new Set()));
  const [loaded, setLoaded] = useState(false);
  /** Rendered audio per block, invalidated when the block's text or voice changes. */
  const audio = useRef(/** @type {Map<string, {key: string, samples: Float32Array}>} */ (new Map()));
  const [, bump] = useState(0);

  useEffect(() => {
    try {
      const saved = JSON.parse(localStorage.getItem(KEY) ?? 'null');
      if (saved?.blocks?.length) { setTitle(saved.title); setBlocks(saved.blocks); }
    } catch { /* start from the sample */ }
    setLoaded(true);
  }, []);
  useEffect(() => {
    if (!loaded) return;
    try { localStorage.setItem(KEY, JSON.stringify({ title, blocks })); } catch { /* not kept */ }
  }, [loaded, title, blocks]);

  const keyOf = (/** @type {Block} */ b) => `${b.voiceId}\u0000${b.text.trim()}`;
  const isDone = (/** @type {Block} */ b) => audio.current.get(b.id)?.key === keyOf(b);

  /** @param {Block} b */
  const render = async (b) => {
    const cached = audio.current.get(b.id);
    if (cached?.key === keyOf(b)) return cached.samples;
    const voice = byId.get(b.voiceId) ?? VOICES[0];
    setBusy((s) => new Set(s).add(b.id));
    try {
      const r = await generate({ text: b.text, voice, source: 'studio', autoplay: false });
      if (!r) return null;
      audio.current.set(b.id, { key: keyOf(b), samples: r.samples });
      bump((n) => n + 1);
      return r.samples;
    } finally {
      setBusy((s) => { const n = new Set(s); n.delete(b.id); return n; });
    }
  };

  /** @param {Block} b */
  const playBlock = async (b) => {
    if (!b.text.trim()) return;
    const id = `studio:${b.id}`;
    const samples = await render(b);
    if (!samples) return;
    const v = byId.get(b.voiceId);
    player.toggleTrack({ id, kind: 'generation', title: v?.name ?? 'Voice', subtitle: b.text, voiceId: b.voiceId, samples, sampleRate: RATE });
  };

  const renderAll = async () => {
    const parts = [];
    for (const b of blocks) {
      if (!b.text.trim()) continue;
      const s = await render(b);
      if (s) parts.push(s);
    }
    const gap = Math.round(GAP_SECONDS * RATE);
    const out = new Float32Array(parts.reduce((n, p) => n + p.length + gap, 0));
    let o = 0;
    for (const p of parts) { out.set(p, o); o += p.length + gap; }
    return out;
  };

  const playAll = async () => {
    const samples = await renderAll();
    if (!samples.length) return;
    player.play({ id: 'studio:all', kind: 'generation', title, subtitle: `${blocks.length} paragraphs`, samples, sampleRate: RATE });
  };

  const exportAll = async () => {
    const samples = await renderAll();
    if (!samples.length) return;
    downloadWav(samples, RATE, title);
    toast('Exported project as WAV');
  };

  /** @param {string} id @param {Partial<Block>} patch */
  const update = (id, patch) => setBlocks((bs) => bs.map((b) => (b.id === id ? { ...b, ...patch } : b)));
  /** @param {number} at */
  const insert = (at) => {
    const prev = blocks[at - 1];
    const b = { id: uid(), voiceId: prev?.voiceId ?? defaultVoice, text: '' };
    setBlocks((bs) => [...bs.slice(0, at), b, ...bs.slice(at)]);
    setFocus(b.id);
    requestAnimationFrame(() => document.getElementById(`t-${b.id}`)?.focus());
  };
  /** @param {string} id */
  const remove = (id) => setBlocks((bs) => (bs.length > 1 ? bs.filter((b) => b.id !== id) : bs));

  const cast = useMemo(() => {
    /** @type {Map<string, number>} */
    const m = new Map();
    for (const b of blocks) m.set(b.voiceId, (m.get(b.voiceId) ?? 0) + 1);
    return [...m.entries()];
  }, [blocks]);

  const words = blocks.reduce((n, b) => n + (b.text.trim() ? b.text.trim().split(/\s+/).length : 0), 0);
  const allPlaying = useIsPlaying('studio:all');
  const working = busy.size > 0;
  const done = blocks.filter(isDone).length;

  return (
    <div className="page fill wide">
      <div className="page-head">
        <div>
          <h1>Studio</h1>
          <p className="sub">Long-form narration, a paragraph at a time. Give every line its own voice.</p>
        </div>
        <div className="page-actions">
          <button type="button" className="btn btn-soft" onClick={exportAll} disabled={working}>
            <Icon name="download" size={16} /> Export
          </button>
          <button type="button" className={`btn btn-primary${working ? ' working' : ''}`} onClick={() => (allPlaying ? player.pause() : playAll())} disabled={working}>
            <Icon name={allPlaying ? 'pause' : 'play'} size={14} /> {working ? 'Rendering…' : allPlaying ? 'Pause' : 'Play all'}
          </button>
        </div>
      </div>

      <div className="studio">
        <section className="doc glass">
          <div className="doc-head">
            <Icon name="file" size={17} className="faint" />
            <input className="doc-title" value={title} onChange={(e) => setTitle(e.target.value)} aria-label="Project title" />
            <span className="faint mono tnum" style={{ fontSize: 12 }}>{done}/{blocks.length} rendered</span>
          </div>
          <div className="doc-body">
            {blocks.map((b, i) => (
              <BlockRow
                key={b.id}
                block={b}
                focused={focus === b.id}
                busy={busy.has(b.id)}
                done={isDone(b)}
                onFocus={() => setFocus(b.id)}
                onChange={(p) => update(b.id, p)}
                onPlay={() => playBlock(b)}
                onInsert={() => insert(i + 1)}
                onRemove={() => remove(b.id)}
              />
            ))}
            <button type="button" className="add-block" onClick={() => insert(blocks.length)}>
              <Icon name="plus" size={15} /> Add paragraph
            </button>
          </div>
        </section>

        <aside style={{ display: 'grid', gap: 12, alignContent: 'start' }}>
          <div className="glass side-card">
            <h3>Project</h3>
            <div className="readout" style={{ gridTemplateColumns: '1fr 1fr' }}>
              <div><b className="tnum">{words}</b><span>Words</span></div>
              <div><b className="tnum">{clock(words / 2.6)}</b><span>Est. length</span></div>
            </div>
          </div>
          <div className="glass side-card">
            <h3>Cast · {cast.length}</h3>
            <div className="cast">
              {cast.map(([id, n]) => {
                const v = byId.get(id);
                if (!v) return null;
                return (
                  <div key={id} className="cast-row">
                    <Orb voice={v} size={30} />
                    <div className="grow"><b>{v.name}</b><div className="faint" style={{ fontSize: 12 }}>{n} paragraph{n === 1 ? '' : 's'}</div></div>
                  </div>
                );
              })}
            </div>
          </div>
          <div className="glass side-card">
            <h3>Tips</h3>
            <p className="muted" style={{ fontSize: 12.5 }}>
              Press <kbd className="mono">Enter</kbd> at the end of a paragraph to start a new one with the same voice.
              Click a voice chip to recast a line. Renders are cached until you edit.
            </p>
          </div>
        </aside>
      </div>
    </div>
  );
}

/**
 * @param {{block: Block, focused: boolean, busy: boolean, done: boolean, onFocus: () => void,
 *   onChange: (p: Partial<Block>) => void, onPlay: () => void, onInsert: () => void, onRemove: () => void}} props
 */
function BlockRow({ block, focused, busy, done, onFocus, onChange, onPlay, onInsert, onRemove }) {
  const playing = usePlayer((s) => s.playing && s.track?.id === `studio:${block.id}`);
  return (
    <div className={`block${focused ? ' focus' : ''}${playing ? ' playing' : ''}`}>
      <span className={`state${busy ? ' busy' : done ? ' done' : ''}`} />
      <VoicePicker variant="chip" value={block.voiceId} onChange={(v) => onChange({ voiceId: v.id })} />
      <textarea
        id={`t-${block.id}`}
        value={block.text}
        placeholder="Write a paragraph…"
        rows={1}
        onFocus={onFocus}
        onChange={(e) => onChange({ text: e.target.value })}
        onKeyDown={(e) => {
          const t = e.currentTarget;
          if (e.key === 'Enter' && !e.shiftKey && t.selectionStart === t.value.length) { e.preventDefault(); onInsert(); }
          if (e.key === 'Backspace' && !t.value) { e.preventDefault(); onRemove(); }
        }}
      />
      <div className="block-tools">
        <button type="button" className="icon-btn sm" onClick={onPlay} disabled={busy} aria-label={playing ? 'Pause paragraph' : 'Play paragraph'}>
          <Icon name={busy ? 'refresh' : playing ? 'pause' : 'play'} size={14} />
        </button>
        <button type="button" className="icon-btn sm" onClick={onRemove} aria-label="Delete paragraph"><Icon name="trash" size={15} /></button>
      </div>
    </div>
  );
}
