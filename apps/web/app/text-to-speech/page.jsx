'use client';

import { useEffect, useRef, useState } from 'react';
import { MODELS } from '@cadence/engine';
import { Segmented, Slider } from '@/components/Controls.jsx';
import { Icon } from '@/components/Icon.jsx';
import { OrbPlay } from '@/components/Orb.jsx';
import { VoicePicker } from '@/components/VoicePicker.jsx';
import { useIsPlaying } from '@/lib/audio.js';
import { ago } from '@/lib/format.js';
import { DEFAULT_SETTINGS, useStore } from '@/lib/store.jsx';

const LIMIT = 5000;

const STARTERS = [
  { icon: 'book', label: 'Narrate a story', text: 'The lighthouse keeper had not seen a ship in eleven years. So when the lamp caught a sail on the horizon that night, she did not believe it — until the bell began to ring.' },
  { icon: 'smile', label: 'Tell a silly joke', text: 'Why did the speech engine refuse to go to the cloud? Because it already had everything it needed right here, on your own machine!' },
  { icon: 'megaphone', label: 'Record an ad', text: 'Introducing Cadence. Lifelike speech that runs on your own device. No servers. No limits. No monthly bill. Just press play.' },
  { icon: 'film', label: 'Direct a movie scene', text: 'Stop. Listen to me. We have exactly ninety seconds before that door opens, and when it does, you run. Do not look back. Do you understand?' },
  { icon: 'gamepad', label: 'Voice a game character', text: 'Traveller! You look weary. Rest by my fire a while — the road north is long, and the wolves are hungry this winter.' },
  { icon: 'podcast', label: 'Introduce a podcast', text: 'Welcome back to Deep Signal, the show about the systems underneath everything. I am your host, and today we are going inside a speech engine.' },
  { icon: 'leaf', label: 'Guide a meditation', text: 'Close your eyes. Breathe in slowly, and let the air fill you completely. Hold it for a moment. Now breathe out, and let everything go.' },
];

export default function TextToSpeech() {
  const {
    voiceId, setVoiceId, settings, setSettings, generate, generating, stop,
    engineState, engine, setModel, history, playEntry, toast,
  } = useStore();
  const [text, setText] = useState('');
  const [tab, setTab] = useState(/** @type {'settings' | 'history'} */ ('settings'));
  const [last, setLast] = useState(/** @type {import('@/lib/store.jsx').HistoryEntry | null} */ (null));
  const area = useRef(/** @type {HTMLTextAreaElement | null} */ (null));

  useEffect(() => {
    try {
      const draft = sessionStorage.getItem('cadence:tts-draft');
      if (draft) setText(draft);
    } catch { /* no draft */ }
  }, []);
  useEffect(() => {
    try { sessionStorage.setItem('cadence:tts-draft', text); } catch { /* not kept */ }
  }, [text]);

  const loading = engineState.status !== 'ready';
  const over = text.length > LIMIT;
  const canGo = text.trim().length > 0 && !over && !generating;

  const run = async () => {
    if (!canGo) return;
    const result = await generate({ text });
    if (result) setLast(result.entry);
  };

  /** @param {React.KeyboardEvent} e */
  const onKey = (e) => {
    if ((e.metaKey || e.ctrlKey) && e.key === 'Enter') { e.preventDefault(); run(); }
  };

  /** @param {Partial<typeof settings>} patch */
  const patch = (patch) => setSettings((s) => ({ ...s, ...patch }));
  const mine = history.filter((h) => h.source === 'tts');

  return (
    <div className="page fill wide">
      <div className="page-head">
        <div>
          <h1>Text to Speech</h1>
          <p className="sub">Turn any text into lifelike speech — synthesised on this device, as fast as you can type.</p>
        </div>
      </div>

      <div className="tts">
        <section className="editor glass">
          <div className="editor-body">
            <textarea
              ref={area}
              className="textarea"
              placeholder="Start typing here or paste any text you want to turn into lifelike speech…"
              value={text}
              onChange={(e) => setText(e.target.value)}
              onKeyDown={onKey}
              aria-label="Text to speak"
              spellCheck
            />
            {!text && (
              <div className="starters">
                <p>Get started with</p>
                <div className="chips">
                  {STARTERS.map((s) => (
                    <button
                      key={s.label}
                      type="button"
                      className="chip"
                      onClick={() => { setText(s.text); area.current?.focus(); }}
                    >
                      <Icon name={/** @type {any} */ (s.icon)} size={15} /> {s.label}
                    </button>
                  ))}
                </div>
              </div>
            )}
          </div>
          <div className="editor-foot">
            <span className={`count tnum${over ? ' over' : ''}`}>{text.length.toLocaleString()} / {LIMIT.toLocaleString()}</span>
            {text && (
              <button type="button" className="btn btn-ghost btn-sm" onClick={() => setText('')}>Clear</button>
            )}
            <span style={{ flex: 1 }} />
            <span className="faint" style={{ fontSize: 12 }}>
              {engineState.status === 'error' ? 'Model failed to load' : loading ? (engineState.phase === 'init' ? 'Starting model…' : `Downloading model · ${Math.round(engineState.progress * 100)}%`) : 'Ctrl ↵'}
            </span>
            {generating ? (
              <button type="button" className="btn btn-primary working" onClick={stop}>
                <Icon name="stop" size={13} /> Stop
              </button>
            ) : (
              <button type="button" className="btn btn-primary" onClick={run} disabled={!canGo}>
                Generate speech
              </button>
            )}
          </div>
        </section>

        <aside className="settings glass">
          <div className="settings-tabs">
            <Segmented
              label="Panel"
              value={tab}
              onChange={setTab}
              options={[{ value: 'settings', label: 'Settings' }, { value: 'history', label: 'History' }]}
            />
          </div>

          {tab === 'settings' ? (
            <>
              <div className="settings-body" key="settings">
                <div className="field">
                  <span className="field-label">Voice</span>
                  <VoicePicker value={voiceId} onChange={(v) => setVoiceId(v.id)} />
                </div>

                <div className="field">
                  <span className="field-label">Model</span>
                  {MODELS.map((m) => (
                    <button
                      key={m.id}
                      type="button"
                      className={`model-opt${engine.model.id === m.id ? ' on' : ''}`}
                      onClick={() => { if (engine.model.id !== m.id) { setModel(m.id); toast(`Switching to ${m.name}`); } }}
                    >
                      <span className="model-icon"><Icon name={m.backend === 'gpu' ? 'zap' : 'cpu'} size={16} /></span>
                      <span>
                        <b>{m.name} <span className={`tag ${m.backend === 'cpu' ? 'good' : 'accent'}`} style={{ display: 'inline-flex', marginTop: 0 }}>{m.backend.toUpperCase()}</span></b>
                        <span>{m.tagline}</span>
                      </span>
                    </button>
                  ))}
                </div>

                <Slider label="Speed" value={settings.speed} min={0.7} max={1.2} step={0.01}
                  left="Slower" right="Faster" format={(v) => `${v.toFixed(2)}×`} onChange={(speed) => patch({ speed })} />
                <p className="faint" style={{ fontSize: 12, marginTop: -10 }}>
                  Stability, similarity and style controls arrive with Cadence&apos;s own model. The reference weights
                  take only speed, and a control that does nothing would be lying to you.
                </p>

                {last && (
                  <div className="field">
                    <span className="field-label">Last generation <span className="faint mono" style={{ fontWeight: 500 }}>{last.stats.backend}</span></span>
                    <div className="readout">
                      <div><b className="tnum">{last.stats.rtf.toFixed(3)}</b><span>RTF</span></div>
                      <div><b className="tnum">{Math.round(last.stats.ttfaMs)}<small>ms</small></b><span>First audio</span></div>
                      <div><b className="tnum">{last.seconds.toFixed(1)}<small>s</small></b><span>Duration</span></div>
                    </div>
                  </div>
                )}
              </div>
              <div className="settings-foot">
                <button type="button" className="btn btn-ghost btn-sm" onClick={() => setSettings(DEFAULT_SETTINGS)}>
                  <Icon name="refresh" size={14} /> Reset values
                </button>
              </div>
            </>
          ) : (
            <div className="settings-body" key="history" style={{ gap: 6 }}>
              {mine.length === 0 ? (
                <div className="empty" style={{ padding: '40px 10px' }}>
                  <span className="empty-icon"><Icon name="history" size={22} /></span>
                  <b>No history yet</b>
                  <p>Generations from this page will show up here.</p>
                </div>
              ) : (
                mine.slice(0, 40).map((h) => (
                  <MiniHistory key={h.id} entry={h} onPlay={() => playEntry(h)} onUse={() => { setText(h.text); setVoiceId(h.voiceId); setSettings(h.settings); setTab('settings'); }} />
                ))
              )}
            </div>
          )}
        </aside>
      </div>
    </div>
  );
}

/** @param {{entry: import('@/lib/store.jsx').HistoryEntry, onPlay: () => void, onUse: () => void}} props */
function MiniHistory({ entry, onPlay, onUse }) {
  const { byId } = useStore();
  const playing = useIsPlaying(entry.id);
  const v = byId.get(entry.voiceId);
  return (
    <div className="sample-row">
      {v && <OrbPlay voice={v} size={32} playing={playing} onPlay={onPlay} />}
      <div className="grow">
        <b>{entry.text}</b>
        <span>{entry.voiceName} · {ago(entry.createdAt)}</span>
      </div>
      <button type="button" className="icon-btn sm" onClick={onUse} title="Reuse text and settings" aria-label="Reuse">
        <Icon name="copy" size={15} />
      </button>
    </div>
  );
}
