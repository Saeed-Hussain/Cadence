'use client';

import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useMemo, useState } from 'react';
import { Segmented } from '@/components/Controls.jsx';
import { Icon } from '@/components/Icon.jsx';
import { OrbPlay } from '@/components/Orb.jsx';
import { useIsPlaying } from '@/lib/audio.js';
import { dayLabel, downloadWav } from '@/lib/format.js';
import { useStore } from '@/lib/store.jsx';

/** @typedef {import('@/lib/store.jsx').HistoryEntry} HistoryEntry */

export default function History() {
  const { history, clearHistory, toast } = useStore();
  const [q, setQ] = useState('');
  const [source, setSource] = useState(/** @type {'all' | 'tts' | 'studio'} */ ('all'));
  const [confirming, setConfirming] = useState(false);

  const groups = useMemo(() => {
    const needle = q.trim().toLowerCase();
    const list = history.filter((h) =>
      (source === 'all' || h.source === source) &&
      (!needle || `${h.text} ${h.voiceName}`.toLowerCase().includes(needle)));
    /** @type {Map<string, HistoryEntry[]>} */
    const m = new Map();
    for (const h of list) {
      const k = dayLabel(h.createdAt);
      m.set(k, [...(m.get(k) ?? []), h]);
    }
    return [...m.entries()];
  }, [history, q, source]);

  return (
    <div className="page">
      <div className="page-head">
        <div>
          <h1>History</h1>
          <p className="sub">Everything you have generated, kept on this device.</p>
        </div>
        {history.length > 0 && (
          <div className="page-actions">
            {confirming ? (
              <>
                <span className="muted" style={{ fontSize: 13 }}>Delete all {history.length}?</span>
                <button type="button" className="btn btn-ghost btn-sm" onClick={() => setConfirming(false)}>Cancel</button>
                <button type="button" className="btn btn-soft btn-sm btn-danger" onClick={() => { clearHistory(); setConfirming(false); toast('History cleared'); }}>Delete all</button>
              </>
            ) : (
              <button type="button" className="btn btn-ghost btn-sm" onClick={() => setConfirming(true)}><Icon name="trash" size={15} /> Clear history</button>
            )}
          </div>
        )}
      </div>

      <div className="toolbar">
        <div className="search">
          <Icon name="search" size={16} />
          <input className="input" placeholder="Search your generations…" value={q} onChange={(e) => setQ(e.target.value)} aria-label="Search history" />
        </div>
        <Segmented
          label="Source"
          value={source}
          onChange={setSource}
          options={[{ value: 'all', label: 'All' }, { value: 'tts', label: 'Text to Speech' }, { value: 'studio', label: 'Studio' }]}
        />
      </div>

      {groups.length === 0 ? (
        <div className="glass" style={{ borderRadius: 'var(--radius-lg)' }}>
          <div className="empty">
            <span className="empty-icon"><Icon name="history" size={22} /></span>
            <b>{history.length ? 'Nothing matches' : 'No generations yet'}</b>
            <p>{history.length ? 'Try a different word.' : 'Everything you generate is listed here, ready to replay or download.'}</p>
            {!history.length && <Link href="/text-to-speech" className="btn btn-soft btn-sm" style={{ marginTop: 6 }}>Open Text to Speech</Link>}
          </div>
        </div>
      ) : (
        groups.map(([day, items]) => (
          <div key={day}>
            <div className="hist-day">{day}</div>
            <div className="glass stagger" style={{ borderRadius: 'var(--radius-lg)', overflow: 'hidden' }}>
              {items.map((h) => <Row key={h.id} entry={h} />)}
            </div>
          </div>
        ))
      )}
    </div>
  );
}

/** @param {{entry: HistoryEntry}} props */
function Row({ entry }) {
  const { byId, playEntry, removeEntry, audioFor, setVoiceId, setSettings } = useStore();
  const router = useRouter();
  const playing = useIsPlaying(entry.id);
  const voice = byId.get(entry.voiceId);
  const time = new Date(entry.createdAt).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });

  const reuse = () => {
    try { sessionStorage.setItem('cadence:tts-draft', entry.text); } catch { /* not kept */ }
    setVoiceId(entry.voiceId);
    setSettings(entry.settings);
    router.push('/text-to-speech');
  };

  return (
    <div className="hrow">
      {voice ? <OrbPlay voice={voice} size={38} playing={playing} onPlay={() => playEntry(entry)} /> : <span />}
      <div style={{ minWidth: 0 }}>
        <div className="text">{entry.text}</div>
        <div className="meta">
          <span style={{ color: 'var(--ink-2)', fontWeight: 540 }}>{entry.voiceName}</span>
          <span>·</span><span>{time}</span>
          <span>·</span><span className="tnum">{entry.seconds.toFixed(1)} s</span>
          <span className="tag mono">RTF {entry.stats.rtf.toFixed(3)}</span>
          {entry.source === 'studio' && <span className="tag">Studio</span>}
        </div>
      </div>
      <span />
      <div className="actions">
        <button type="button" className="icon-btn sm" title="Reuse in Text to Speech" aria-label="Reuse" onClick={reuse}><Icon name="copy" size={15} /></button>
        <button type="button" className="icon-btn sm" title="Download WAV" aria-label="Download" onClick={async () => downloadWav(await audioFor(entry), 24000, `${entry.voiceName} - ${entry.text}`)}><Icon name="download" size={15} /></button>
        <button type="button" className="icon-btn sm" title="Delete" aria-label="Delete" onClick={() => removeEntry(entry.id)}><Icon name="trash" size={15} /></button>
      </div>
    </div>
  );
}
