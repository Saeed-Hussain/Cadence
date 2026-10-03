'use client';

import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useEffect, useMemo, useRef, useState } from 'react';
import { FACETS, VOICES } from '@cadence/engine';
import { FilterSelect, Segmented } from '@/components/Controls.jsx';
import { Icon } from '@/components/Icon.jsx';
import { Orb, PreviewOrb } from '@/components/Orb.jsx';
import { cap } from '@/lib/format.js';
import { useStore } from '@/lib/store.jsx';

/** @typedef {import('@cadence/engine').Voice} Voice */

const TOP = new Set(['A', 'A-', 'B+', 'B', 'B-']);

const COLLECTIONS = [
  { key: 'top', title: 'Top rated', blurb: 'The clearest, most natural', hue: 260, pick: (/** @type {Voice} */ v) => TOP.has(v.grade) },
  { key: 'American', title: 'American', blurb: 'US English', hue: 200, pick: (/** @type {Voice} */ v) => v.accent === 'American' },
  { key: 'British', title: 'British', blurb: 'UK English', hue: 340, pick: (/** @type {Voice} */ v) => v.accent === 'British' },
  { key: 'blend', title: 'Blends', blurb: 'New voices from the embedding space', hue: 150, pick: (/** @type {Voice} */ v) => v.kind === 'blend' },
];

const PAGE = 40;

export default function Voices() {
  const { voices, favorites, voiceId } = useStore();
  const [scope, setScope] = useState(/** @type {'explore' | 'mine' | 'matched'} */ ('explore'));
  const [q, setQ] = useState('');
  const [gender, setGender] = useState('');
  const [accent, setAccent] = useState('');
  const [kind, setKind] = useState('');
  const [collection, setCollection] = useState('');
  const [shown, setShown] = useState(PAGE);
  const search = useRef(/** @type {HTMLInputElement | null} */ (null));
  const sentinel = useRef(/** @type {HTMLDivElement | null} */ (null));

  // "/" jumps to search, as it does everywhere else on the web.
  useEffect(() => {
    /** @param {KeyboardEvent} e */
    const onKey = (e) => {
      const t = /** @type {HTMLElement} */ (e.target);
      if (e.key === '/' && !t.closest('input, textarea')) { e.preventDefault(); search.current?.focus(); }
    };
    addEventListener('keydown', onKey);
    return () => removeEventListener('keydown', onKey);
  }, []);

  const list = useMemo(() => {
    const needle = q.trim().toLowerCase();
    const col = COLLECTIONS.find((c) => c.key === collection);
    let pool = voices;
    if (scope === 'mine') pool = voices.filter((v) => favorites.includes(v.id));
    if (scope === 'matched') pool = voices.filter((v) => v.source === 'cloned');
    return pool.filter((v) =>
      (!gender || v.gender === gender) &&
      (!accent || v.accent === accent) &&
      (!kind || v.kind === kind) &&
      (!col || col.pick(v)) &&
      (!needle || `${v.name} ${v.description} ${v.tags.join(' ')} ${v.accent}`.toLowerCase().includes(needle)));
  }, [voices, favorites, scope, q, gender, accent, kind, collection]);

  useEffect(() => setShown(PAGE), [list]);

  // Render rows as they scroll into view rather than all at once.
  useEffect(() => {
    const el = sentinel.current;
    if (!el) return;
    const io = new IntersectionObserver(([e]) => {
      if (e.isIntersecting) setShown((n) => n + PAGE);
    }, { rootMargin: '600px' });
    io.observe(el);
    return () => io.disconnect();
  }, [list]);

  const filtered = gender || accent || kind || collection || q;
  const clear = () => { setGender(''); setAccent(''); setKind(''); setCollection(''); setQ(''); };
  const originals = VOICES.filter((v) => v.kind === 'original').length;

  return (
    <div className="page">
      <div className="page-head">
        <div>
          <h1>Voice Library</h1>
          <p className="sub">
            {VOICES.length} voices: {originals} originals and {VOICES.length - originals} blends of them. Every voice is a few
            hundred floats, not a separate model.
          </p>
        </div>
        <div className="page-actions">
          <Link href="/voice-cloning" className="btn btn-primary"><Icon name="plus" size={16} /> Create a voice</Link>
        </div>
      </div>

      <div className="toolbar">
        <Segmented
          label="Library"
          value={scope}
          onChange={setScope}
          options={[
            { value: 'explore', label: 'Explore' },
            { value: 'mine', label: `My voices · ${favorites.length}` },
            { value: 'matched', label: 'Your voices' },
          ]}
        />
      </div>

      {scope === 'explore' && (
        <div className="collections stagger">
          {COLLECTIONS.map((c) => {
            const members = VOICES.filter(c.pick);
            return (
              <button
                key={c.key}
                type="button"
                className={`collection glass card-hover${collection === c.key ? ' on' : ''}`}
                style={/** @type {any} */ ({ '--h': c.hue })}
                onClick={() => setCollection((k) => (k === c.key ? '' : c.key))}
                aria-pressed={collection === c.key}
              >
                <span className="stack">{members.slice(0, 4).map((v) => <Orb key={v.id} voice={v} size={26} />)}</span>
                <span>
                  <b>{c.title}</b>
                  <span style={{ display: 'block' }}>{c.blurb} · {members.length}</span>
                </span>
              </button>
            );
          })}
        </div>
      )}

      <div className="toolbar">
        <div className="search">
          <Icon name="search" size={16} />
          <input
            ref={search}
            className="input"
            placeholder="Search by name, accent, or a word like “warm”…"
            value={q}
            onChange={(e) => setQ(e.target.value)}
            aria-label="Search voices"
          />
          {!q && <kbd>/</kbd>}
        </div>
        <FilterSelect label="Gender" value={gender} onChange={setGender} options={FACETS.gender} format={cap} />
        <FilterSelect label="Accent" value={accent} onChange={setAccent} options={FACETS.accent} />
        <FilterSelect label="Type" value={kind} onChange={setKind} options={FACETS.kind} format={cap} />
        {filtered && <button type="button" className="btn btn-ghost btn-sm" onClick={clear}><Icon name="x" size={14} /> Clear</button>}
      </div>

      <div className="vlist glass">
        <div className="vlist-head">
          <span>Voice · {list.length}</span>
          <span>Accent</span>
          <span>Gender</span>
          <span>Quality</span>
          <span />
        </div>
        {list.length === 0 ? (
          <div className="empty">
            <span className="empty-icon"><Icon name={scope === 'matched' ? 'mic' : 'search'} size={22} /></span>
            <b>{scope === 'matched' && !filtered ? 'No voices of your own yet' : 'No voices match'}</b>
            <p>{scope === 'matched' && !filtered ? 'Record a few seconds and Cadence will find the voice that fits it.' : 'Loosen a filter or try another word.'}</p>
            {scope === 'matched' && !filtered
              ? <Link href="/voice-cloning" className="btn btn-soft btn-sm" style={{ marginTop: 6 }}>Create a voice</Link>
              : <button type="button" className="btn btn-soft btn-sm" style={{ marginTop: 6 }} onClick={clear}>Clear filters</button>}
          </div>
        ) : (
          list.slice(0, shown).map((v) => <VoiceRow key={v.id} voice={v} current={v.id === voiceId} />)
        )}
        {shown < list.length && <div ref={sentinel} style={{ height: 1 }} />}
      </div>
    </div>
  );
}

/** @param {{voice: Voice, current: boolean}} props */
function VoiceRow({ voice, current }) {
  const { favorites, toggleFavorite, setVoiceId, toast } = useStore();
  const router = useRouter();
  const saved = favorites.includes(voice.id);

  return (
    <div className={`vrow${current ? ' current' : ''}`}>
      <div className="vrow-main">
        <PreviewOrb voice={voice} size={42} />
        <div style={{ minWidth: 0 }}>
          <div className="name">
            {voice.name}
            {voice.kind === 'original' && <span className="tag">Original</span>}
            {voice.kind === 'matched' && <span className="tag accent">Yours</span>}
            {current && <span className="tag good">In use</span>}
          </div>
          <div className="desc">{voice.description}</div>
        </div>
      </div>
      <div className="cell">{voice.accent}<small>{voice.language}</small></div>
      <div className="cell">{cap(voice.gender)}<small>{voice.pitch} Hz</small></div>
      <div className="cell">
        <span className={`tag mono${TOP.has(voice.grade) ? ' good' : ''}`}>{voice.grade}</span>
        <small style={{ display: 'inline', marginLeft: 8 }}>{voice.kind === 'blend' ? 'blend' : voice.kind}</small>
      </div>
      <div className="vrow-actions">
        <button
          type="button"
          className={`icon-btn sm${saved ? ' on' : ''}`}
          onClick={() => { toggleFavorite(voice.id); toast(saved ? `Removed ${voice.name} from My voices` : `Saved ${voice.name} to My voices`); }}
          aria-label={saved ? 'Remove from My voices' : 'Save to My voices'}
          title={saved ? 'Saved' : 'Save'}
        >
          <Icon name={saved ? 'bookmarkFilled' : 'bookmark'} size={16} />
        </button>
        <button
          type="button"
          className="btn btn-soft btn-sm"
          onClick={() => { setVoiceId(voice.id); router.push('/text-to-speech'); }}
        >
          Use voice
        </button>
      </div>
    </div>
  );
}
