'use client';

import { useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import Link from 'next/link';
import { useIsPlaying } from '@/lib/audio.js';
import { cap } from '@/lib/format.js';
import { useStore } from '@/lib/store.jsx';
import { Icon } from './Icon.jsx';
import { Orb, OrbPlay } from './Orb.jsx';
import { Segmented } from './Controls.jsx';

/** @typedef {import('@cadence/engine').Voice} Voice */

/**
 * The quick voice switcher: search, audition, pick — without leaving the page.
 *
 * @param {{value: string, onChange: (v: Voice) => void, variant?: 'full' | 'chip'}} props
 */
export function VoicePicker({ value, onChange, variant = 'full' }) {
  const { byId } = useStore();
  const [open, setOpen] = useState(false);
  const anchor = useRef(/** @type {HTMLButtonElement | null} */ (null));
  const voice = byId.get(value);

  return (
    <>
      <button
        ref={anchor}
        type="button"
        className={variant === 'full' ? 'voice-trigger' : 'block-voice'}
        onClick={() => setOpen((o) => !o)}
        aria-haspopup="listbox"
        aria-expanded={open}
      >
        {voice && <Orb voice={voice} size={variant === 'full' ? 36 : 22} />}
        {variant === 'full' ? (
          <>
            <span className="grow">
              <b>{voice?.name ?? 'Choose a voice'}</b>
              <span>{voice ? `${cap(voice.gender)} · ${voice.accent} · ${voice.category}` : ''}</span>
            </span>
            <Icon name="chevronDown" size={16} className="faint" />
          </>
        ) : (
          <span>{voice?.name ?? 'Voice'}</span>
        )}
      </button>
      {open && anchor.current && (
        <PickerPanel
          anchor={anchor.current}
          value={value}
          onPick={(v) => { onChange(v); setOpen(false); }}
          onClose={() => setOpen(false)}
        />
      )}
    </>
  );
}

/**
 * @param {{anchor: HTMLElement, value: string, onPick: (v: Voice) => void, onClose: () => void}} props
 */
function PickerPanel({ anchor, value, onPick, onClose }) {
  const { voices, favorites } = useStore();
  const panel = useRef(/** @type {HTMLDivElement | null} */ (null));
  const input = useRef(/** @type {HTMLInputElement | null} */ (null));
  const [q, setQ] = useState('');
  const [scope, setScope] = useState(/** @type {'all' | 'mine'} */ ('mine'));
  const [pos, setPos] = useState({ top: 0, left: 0, up: false });
  const [hot, setHot] = useState(0);

  useLayoutEffect(() => {
    const place = () => {
      const r = anchor.getBoundingClientRect();
      const width = Math.min(380, innerWidth - 32);
      const up = r.bottom + 480 > innerHeight && r.top > innerHeight / 2;
      setPos({
        top: up ? r.top - 8 : r.bottom + 8,
        left: Math.max(16, Math.min(r.right - width, innerWidth - width - 16, r.left)),
        up,
      });
    };
    place();
    addEventListener('resize', place);
    addEventListener('scroll', place, true);
    return () => { removeEventListener('resize', place); removeEventListener('scroll', place, true); };
  }, [anchor]);

  useEffect(() => {
    input.current?.focus({ preventScroll: true });
    /** @param {PointerEvent} e */
    const away = (e) => {
      const t = /** @type {Node} */ (e.target);
      if (!panel.current?.contains(t) && !anchor.contains(t)) onClose();
    };
    /** @param {KeyboardEvent} e */
    const esc = (e) => { if (e.key === 'Escape') onClose(); };
    addEventListener('pointerdown', away);
    addEventListener('keydown', esc);
    return () => { removeEventListener('pointerdown', away); removeEventListener('keydown', esc); };
  }, [anchor, onClose]);

  const list = useMemo(() => {
    const needle = q.trim().toLowerCase();
    const pool = scope === 'mine' && !needle ? voices.filter((v) => favorites.includes(v.id)) : voices;
    return needle
      ? pool.filter((v) => `${v.name} ${v.accent} ${v.gender} ${v.category} ${v.tags.join(' ')}`.toLowerCase().includes(needle))
      : pool;
  }, [q, scope, voices, favorites]);

  useEffect(() => setHot(0), [q, scope]);

  /** @param {React.KeyboardEvent} e */
  const onKey = (e) => {
    if (e.key === 'ArrowDown') { e.preventDefault(); setHot((h) => Math.min(h + 1, list.length - 1)); }
    if (e.key === 'ArrowUp') { e.preventDefault(); setHot((h) => Math.max(h - 1, 0)); }
    if (e.key === 'Enter' && list[hot]) onPick(list[hot]);
  };

  useEffect(() => {
    panel.current?.querySelector('.menu-item.hot')?.scrollIntoView({ block: 'nearest' });
  }, [hot]);

  return createPortal(
    <div
      ref={panel}
      className="popover glass-strong picker"
      style={{
        position: 'fixed',
        left: pos.left,
        ...(pos.up ? { bottom: innerHeight - pos.top, transformOrigin: 'bottom center' } : { top: pos.top }),
      }}
      role="dialog"
      aria-label="Choose a voice"
    >
      <div className="picker-head">
        <div className="search">
          <Icon name="search" size={16} />
          <input
            ref={input}
            className="input"
            placeholder="Search 200+ voices…"
            value={q}
            onChange={(e) => setQ(e.target.value)}
            onKeyDown={onKey}
          />
        </div>
        {!q && (
          <Segmented
            small
            label="Voice set"
            value={scope}
            onChange={setScope}
            options={[{ value: 'mine', label: 'My voices' }, { value: 'all', label: 'All voices' }]}
          />
        )}
      </div>
      <div className="picker-list" role="listbox">
        {list.length === 0 && (
          <div className="empty" style={{ padding: '30px 10px' }}>
            <b>No voices match</b>
            <p>Try an accent, a gender or a word like “warm”.</p>
          </div>
        )}
        {list.slice(0, 120).map((v, i) => (
          <PickerRow key={v.id} voice={v} selected={v.id === value} hot={i === hot} onPick={onPick} onHover={() => setHot(i)} />
        ))}
      </div>
      <div style={{ padding: '6px 4px 2px', borderTop: '1px solid var(--line)' }}>
        <Link href="/voices" className="menu-item" style={{ fontSize: 13, color: 'var(--ink-2)' }} onClick={onClose}>
          <Icon name="voices" size={16} /> Browse the full library
          <Icon name="arrowRight" size={14} className="faint" />
        </Link>
      </div>
    </div>,
    document.body,
  );
}

/** @param {{voice: Voice, selected: boolean, hot: boolean, onPick: (v: Voice) => void, onHover: () => void}} props */
function PickerRow({ voice, selected, hot, onPick, onHover }) {
  const { previewVoice } = useStore();
  const playing = useIsPlaying(`preview:${voice.id}`);
  return (
    <div
      className={`menu-item${hot ? ' hot' : ''}${selected ? ' on' : ''}`}
      role="option"
      aria-selected={selected}
      onClick={() => onPick(voice)}
      onMouseEnter={onHover}
      style={{ cursor: 'pointer' }}
    >
      <OrbPlay voice={voice} size={34} playing={playing} onPlay={() => previewVoice(voice)} />
      <span style={{ flex: 1, minWidth: 0 }}>
        <b style={{ display: 'block', fontSize: 13.5, fontWeight: 600 }}>{voice.name}</b>
        <span style={{ display: 'block', fontSize: 12, color: 'var(--ink-3)', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>
          {cap(voice.gender)} · {voice.accent} · {voice.tags.join(', ')}
        </span>
      </span>
      {selected && <Icon name="check" size={16} />}
    </div>
  );
}
