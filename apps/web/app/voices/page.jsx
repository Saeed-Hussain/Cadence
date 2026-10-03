'use client';

import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useEffect, useMemo, useRef, useState } from 'react';
import { FACETS, VOICES } from '@cadence/engine';
import { FilterSelect, Segmented } from '@/components/Controls.jsx';
import { Icon } from '@/components/Icon.jsx';
import { Orb, OrbPlay } from '@/components/Orb.jsx';
import { useIsPlaying } from '@/lib/audio.js';
import { cap } from '@/lib/format.js';
import { useStore } from '@/lib/store.jsx';

/** @typedef {import('@cadence/engine').Voice} Voice */

const COLLECTIONS = [
  { category: 'Narration', title: 'Storytellers', blurb: 'Immersive narration', hue: 260 },
  { category: 'Conversational', title: 'Conversational', blurb: 'Natural, everyday', hue: 190 },
  { category: 'Characters', title: 'Characters', blurb: 'Animation & games', hue: 330 },
  { category: 'Meditation', title: 'Calm & grounded', blurb: 'Meditation & wellness', hue: 150 },
];

const PAGE = 40;

export default function Voices() {
  const { voices, favorites, voiceId } = useStore();
  const [scope, setScope] = useState(/** @type {'explore' | 'mine' | 'cloned'} */ ('explore'));
  const [q, setQ] = useState('');
  const [gender, setGender] = useState('');
  const [age, setAge] = useState('');
  const [accent, setAccent] = useState('');
  const [category, setCategory] = useState('');
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
    let pool = voices;
    if (scope === 'mine') pool = voices.filter((v) => favorites.includes(v.id));
    if (scope === 'cloned') pool = voices.filter((v) => v.source === 'cloned');
    return pool.filter((v) =>
      (!gender || v.gender === gender) &&
      (!age || v.age === age) &&
      (!accent || v.accent === accent) &&
      (!category || v.category === category) &&
      (!needle || `${v.name} ${v.description} ${v.tags.join(' ')} ${v.accent} ${v.category}`.toLowerCase().includes(needle)));
  }, [voices, favorites, scope, q, gender, age, accent, category]);

  useEffect(() => setShown(PAGE), [list]);

  // Render rows as they scroll into view rather than all two hundred at once.
  useEffect(() => {
    const el = sentinel.current;
    if (!el) return;
    const io = new IntersectionObserver(([e]) => {
      if (e.isIntersecting) setShown((n) => n + PAGE);
    }, { rootMargin: '600px' });
    io.observe(el);
    return () => io.disconnect();
  }, [list]);

  const filtered = gender || age || accent || category || q;
  const clear = () => { setGender(''); setAge(''); setAccent(''); setCategory(''); setQ(''); };

  return (
    <div className="page">
      <div className="page-head">
        <div>
          <h1>Voice Library</h1>
          <p className="sub">{VOICES.length} built-in voices, each a few hundred floats — not a model. Audition any of them instantly.</p>
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
            { value: 'cloned', label: 'Cloned' },
          ]}
        />
      </div>

      {scope === 'explore' && !filtered && (
        <div className="collections stagger">
          {COLLECTIONS.map((c) => {
            const members = VOICES.filter((v) => v.category === c.category);
            return (
              <button
                key={c.category}
                type="button"
                className="collection glass card-hover"
                style={/** @type {any} */ ({ '--h': c.hue })}
                onClick={() => setCategory(c.category)}
              >
                <span className="stack">{members.slice(0, 4).map((v) => <Orb key={v.id} voice={v} size={26} />)}</span>
                <span>
                  <b>{c.title}</b>
                  <span style={{ display: 'block' }}>{c.blurb} · {members.length} voices</span>
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
        <FilterSelect label="Age" value={age} onChange={setAge} options={FACETS.age} format={cap} />
        <FilterSelect label="Accent" value={accent} onChange={setAccent} options={FACETS.accent} />
        <FilterSelect label="Use case" value={category} onChange={setCategory} options={FACETS.category} />
        {filtered && <button type="button" className="btn btn-ghost btn-sm" onClick={clear}><Icon name="x" size={14} /> Clear</button>}
      </div>

      <div className="vlist glass">
        <div className="vlist-head">
          <span>Voice · {list.length}</span>
          <span>Accent</span>
          <span>Age</span>
          <span>Use case</span>
          <span />
        </div>
        {list.length === 0 ? (
          <div className="empty">
            <span className="empty-icon"><Icon name={scope === 'cloned' ? 'mic' : 'search'} size={22} /></span>
            <b>{scope === 'cloned' && !filtered ? 'No cloned voices yet' : 'No voices match'}</b>
            <p>{scope === 'cloned' && !filtered ? 'Clone a voice from a short recording and it will live here.' : 'Loosen a filter or try another word.'}</p>
            {scope === 'cloned' && !filtered
              ? <Link href="/voice-cloning" className="btn btn-soft btn-sm" style={{ marginTop: 6 }}>Clone a voice</Link>
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
  const { previewVoice, favorites, toggleFavorite, setVoiceId, toast } = useStore();
  const router = useRouter();
  const playing = useIsPlaying(`preview:${voice.id}`);
  const saved = favorites.includes(voice.id);

  return (
    <div className={`vrow${current ? ' current' : ''}`}>
      <div className="vrow-main">
        <OrbPlay voice={voice} size={42} playing={playing} onPlay={() => previewVoice(voice)} />
        <div style={{ minWidth: 0 }}>
          <div className="name">
            {voice.name}
            {voice.source === 'cloned' && <span className="tag accent">Cloned</span>}
            {current && <span className="tag good">In use</span>}
          </div>
          <div className="desc">{voice.description}</div>
        </div>
      </div>
      <div className="cell">{voice.accent}<small>{voice.language}</small></div>
      <div className="cell">{cap(voice.age)}<small>{cap(voice.gender)}</small></div>
      <div className="cell">{voice.category}<small>{voice.tags.join(' · ')}</small></div>
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
