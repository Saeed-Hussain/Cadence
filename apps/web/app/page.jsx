'use client';

import Link from 'next/link';
import { useEffect, useState } from 'react';
import { VOICES } from '@cadence/engine';
import { Icon } from '@/components/Icon.jsx';
import { Orb, OrbPlay } from '@/components/Orb.jsx';
import { useIsPlaying } from '@/lib/audio.js';
import { ago, cap } from '@/lib/format.js';
import { useStore } from '@/lib/store.jsx';

const TOOLS = [
  { href: '/text-to-speech', icon: 'speech', title: 'Text to Speech', body: 'Type anything and hear it in any of 200+ voices, instantly.', tone: '#6b5cff' },
  { href: '/voices', icon: 'voices', title: 'Voice Library', body: 'Browse, audition and save voices — before the model even loads.', tone: '#0ea5e9' },
  { href: '/voice-cloning', icon: 'mic', title: 'Voice Cloning', body: 'Ten seconds of audio in, a new voice out. Never leaves your machine.', tone: '#ec4899' },
  { href: '/studio', icon: 'studio', title: 'Studio', body: 'Long-form narration with a different voice on every line.', tone: '#f59e0b' },
];

const FEATURED = [0, 3, 8, 13, 21, 34, 55, 89].map((i) => VOICES[i]);

export default function Home() {
  const { history, engineState, engine, playEntry, previewVoice } = useStore();
  const [greeting, setGreeting] = useState('Welcome');
  useEffect(() => {
    const h = new Date().getHours();
    setGreeting(h < 5 ? 'Good night' : h < 12 ? 'Good morning' : h < 18 ? 'Good afternoon' : 'Good evening');
  }, []);

  const ready = engineState.status === 'ready';
  const spoken = history.reduce((s, h) => s + h.seconds, 0);
  const bestRtf = history.length ? Math.min(...history.map((h) => h.stats.rtf)) : null;

  return (
    <div className="page">
      <section className="hero glass">
        <div>
          <span className="eyebrow">
            <span className={`dot${ready ? '' : ' loading'}`} style={{ margin: '0 2px 0 4px' }} />
            {ready ? `${engine.model.name} is ready — running on this device` : `Loading ${engine.model.name} · ${Math.round(engineState.progress * 100)}%`}
          </span>
          <h1>{greeting}.<br />What should we say today?</h1>
          <p>
            Cadence is a speech engine that runs entirely on your machine. No account, no key, no quota —
            the inference is yours, so it is unlimited.
          </p>
          <div className="hero-actions">
            <Link href="/text-to-speech" className="btn btn-primary btn-lg">
              <Icon name="sparkles" size={17} /> Start speaking
            </Link>
            <Link href="/voices" className="btn btn-soft btn-lg">Explore voices</Link>
          </div>
        </div>
        <Orb voice={{ id: '__hero', hues: [258, 196, 322] }} size={168} className="hero-orb" />
      </section>

      <div className="section-title"><h2>Create</h2></div>
      <div className="grid grid-4 stagger">
        {TOOLS.map((t) => (
          <Link key={t.href} href={t.href} className="glass card card-hover tool-card">
            <span className="tool-icon" style={/** @type {any} */ ({ '--tone': t.tone })}>
              <Icon name={/** @type {any} */ (t.icon)} size={20} />
            </span>
            <div>
              <h3>{t.title}</h3>
              <p style={{ marginTop: 4 }}>{t.body}</p>
            </div>
            <span className="go">Open <Icon name="arrowRight" size={14} /></span>
          </Link>
        ))}
      </div>

      <div className="section-title">
        <h2>Featured voices</h2>
        <Link href="/voices">View all <Icon name="chevronRight" size={14} /></Link>
      </div>
      <div className="rail stagger">
        {FEATURED.map((v) => <FeaturedVoice key={v.id} voice={v} onPlay={() => previewVoice(v)} />)}
      </div>

      <div className="grid grid-3" style={{ marginTop: 20 }}>
        <div className="glass card stat">
          <span>Audio generated</span>
          <b className="tnum">{spoken < 60 ? `${spoken.toFixed(1)} s` : `${(spoken / 60).toFixed(1)} min`}</b>
          <span>across {history.length} generation{history.length === 1 ? '' : 's'}</span>
        </div>
        <div className="glass card stat">
          <span>Best real-time factor</span>
          <b className="tnum mono">{bestRtf === null ? '—' : bestRtf.toFixed(3)}</b>
          <span>lower is faster · target &lt; 0.3 on CPU</span>
        </div>
        <div className="glass card stat">
          <span>Cost so far</span>
          <b className="tnum">$0.00</b>
          <span>it runs on your hardware, forever</span>
        </div>
      </div>

      <div className="section-title">
        <h2>Recent generations</h2>
        {history.length > 0 && <Link href="/history">History <Icon name="chevronRight" size={14} /></Link>}
      </div>
      <div className="glass" style={{ borderRadius: 'var(--radius-lg)', overflow: 'hidden' }}>
        {history.length === 0 ? (
          <div className="empty">
            <span className="empty-icon"><Icon name="speech" size={22} /></span>
            <b>Nothing generated yet</b>
            <p>Your generations appear here, ready to replay or download.</p>
            <Link href="/text-to-speech" className="btn btn-soft btn-sm" style={{ marginTop: 6 }}>Generate your first</Link>
          </div>
        ) : (
          history.slice(0, 5).map((h) => <RecentRow key={h.id} entry={h} onPlay={() => playEntry(h)} />)
        )}
      </div>
    </div>
  );
}

/** @param {{voice: import('@cadence/engine').Voice, onPlay: () => void}} props */
function FeaturedVoice({ voice, onPlay }) {
  const playing = useIsPlaying(`preview:${voice.id}`);
  return (
    <div className="glass voice-card card-hover">
      <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
        <OrbPlay voice={voice} size={46} playing={playing} onPlay={onPlay} />
        <div style={{ minWidth: 0 }}>
          <b>{voice.name}</b>
          <div className="faint" style={{ fontSize: 12 }}>{cap(voice.gender)} · {voice.accent}</div>
        </div>
      </div>
      <p>{voice.description}</p>
      <div style={{ display: 'flex', gap: 6 }}>
        <span className="tag">{voice.category}</span>
        <span className="tag">{voice.tags[0]}</span>
      </div>
    </div>
  );
}

/** @param {{entry: import('@/lib/store.jsx').HistoryEntry, onPlay: () => void}} props */
function RecentRow({ entry, onPlay }) {
  const { byId } = useStore();
  const playing = useIsPlaying(entry.id);
  const voice = byId.get(entry.voiceId);
  return (
    <div className="hrow">
      {voice ? <OrbPlay voice={voice} size={36} playing={playing} onPlay={onPlay} /> : <span />}
      <div style={{ minWidth: 0 }}>
        <div className="text">{entry.text}</div>
        <div className="meta"><span>{entry.voiceName}</span>·<span>{entry.seconds.toFixed(1)} s</span>·<span>{ago(entry.createdAt)}</span></div>
      </div>
      <span className="tag mono">RTF {entry.stats.rtf.toFixed(3)}</span>
      <span />
    </div>
  );
}
