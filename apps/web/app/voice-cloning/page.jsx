'use client';

import Link from 'next/link';
import { useEffect, useRef, useState } from 'react';
import { Icon } from '@/components/Icon.jsx';
import { OrbPlay } from '@/components/Orb.jsx';
import { player, useIsPlaying } from '@/lib/audio.js';
import { clock } from '@/lib/format.js';
import { useStore } from '@/lib/store.jsx';

/** @typedef {{id: string, name: string, samples: Float32Array, sampleRate: number}} Sample */

const MIN_SECONDS = 5;
const GOOD_SECONDS = 10;

export default function VoiceCloning() {
  const { engine, addClone, custom, removeClone, previewVoice, toast } = useStore();
  const [samples, setSamples] = useState(/** @type {Sample[]} */ ([]));
  const [name, setName] = useState('');
  const [description, setDescription] = useState('');
  const [consent, setConsent] = useState(false);
  const [over, setOver] = useState(false);
  const [busy, setBusy] = useState(false);
  const file = useRef(/** @type {HTMLInputElement | null} */ (null));

  const total = samples.reduce((s, x) => s + x.samples.length / x.sampleRate, 0);
  const ready = total >= MIN_SECONDS && name.trim() && consent && !busy;

  /** @param {FileList | null} files */
  const addFiles = async (files) => {
    if (!files) return;
    for (const f of Array.from(files)) {
      if (!f.type.startsWith('audio/') && !/\.(wav|mp3|m4a|ogg|webm|flac)$/i.test(f.name)) {
        toast(`${f.name} is not an audio file`, 'error');
        continue;
      }
      try {
        const decoded = await decode(await f.arrayBuffer());
        setSamples((s) => [...s, { id: crypto.randomUUID(), name: f.name, ...decoded }]);
      } catch {
        toast(`Could not read ${f.name}`, 'error');
      }
    }
  };

  const create = async () => {
    if (!ready) return;
    setBusy(true);
    // Let the button's state paint before the analysis runs.
    await new Promise((r) => setTimeout(r, 450));
    const rate = samples[0].sampleRate;
    const joined = new Float32Array(samples.reduce((s, x) => s + x.samples.length, 0));
    let o = 0;
    for (const s of samples) { joined.set(s.samples, o); o += s.samples.length; }
    const voice = engine.clone({ name: name.trim(), description: description.trim(), samples: joined, sampleRate: rate });
    addClone(voice);
    setBusy(false);
    setSamples([]);
    setName('');
    setDescription('');
    setConsent(false);
    toast(`${voice.name} is ready — added to My voices`);
    previewVoice(voice);
  };

  return (
    <div className="page">
      <div className="page-head">
        <div>
          <h1>Voice Cloning</h1>
          <p className="sub">Create a voice from a short recording. The audio is analysed on this device and never uploaded anywhere.</p>
        </div>
      </div>

      <div className="clone">
        <section className="glass card" style={{ display: 'grid', gap: 18 }}>
          <Recorder onDone={(s) => setSamples((x) => [...x, s])} />

          <div
            className={`drop${over ? ' over' : ''}`}
            onClick={() => file.current?.click()}
            onDragOver={(e) => { e.preventDefault(); setOver(true); }}
            onDragLeave={() => setOver(false)}
            onDrop={(e) => { e.preventDefault(); setOver(false); addFiles(e.dataTransfer.files); }}
            role="button"
            tabIndex={0}
            onKeyDown={(e) => { if (e.key === 'Enter' || e.key === ' ') file.current?.click(); }}
          >
            <span className="drop-icon"><Icon name="upload" size={20} /></span>
            <b>Drop audio files or click to upload</b>
            <span>WAV, MP3, M4A, OGG or FLAC · one clear speaker · no music</span>
            <input ref={file} type="file" accept="audio/*" multiple hidden onChange={(e) => { addFiles(e.target.files); e.target.value = ''; }} />
          </div>

          {samples.length > 0 && (
            <div style={{ display: 'grid', gap: 8 }}>
              <div className="field-label">
                <span>Samples · {clock(total)}</span>
                <span className={total >= GOOD_SECONDS ? '' : 'faint'} style={{ color: total >= GOOD_SECONDS ? 'var(--good)' : undefined }}>
                  {total < MIN_SECONDS ? `${(MIN_SECONDS - total).toFixed(0)} s more needed` : total < GOOD_SECONDS ? 'Enough — more improves quality' : 'Great length'}
                </span>
              </div>
              <div className="bar"><i style={{ width: `${Math.min(100, (total / GOOD_SECONDS) * 100)}%` }} /></div>
              {samples.map((s) => (
                <SampleRow key={s.id} sample={s} onRemove={() => setSamples((x) => x.filter((y) => y.id !== s.id))} />
              ))}
            </div>
          )}

          <div className="grid grid-2">
            <div className="field">
              <label htmlFor="vname">Name</label>
              <input id="vname" className="input" placeholder="e.g. My narration voice" value={name} onChange={(e) => setName(e.target.value)} maxLength={40} />
            </div>
            <div className="field">
              <label htmlFor="vdesc">Description <span className="faint" style={{ fontWeight: 400 }}>optional</span></label>
              <input id="vdesc" className="input" placeholder="Warm, calm, slightly raspy…" value={description} onChange={(e) => setDescription(e.target.value)} maxLength={120} />
            </div>
          </div>

          <div
            className={`check${consent ? ' on' : ''}`}
            role="checkbox"
            aria-checked={consent}
            tabIndex={0}
            onClick={() => setConsent((c) => !c)}
            onKeyDown={(e) => { if (e.key === ' ' || e.key === 'Enter') { e.preventDefault(); setConsent((c) => !c); } }}
          >
            <span className="box"><Icon name="check" size={13} strokeWidth={2.6} /></span>
            <span>
              I confirm this is my own voice, or I have the explicit permission of the person speaking to create a voice from it.
              Every clip Cadence produces carries an inaudible watermark.
            </span>
          </div>

          <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 8 }}>
            <button type="button" className={`btn btn-primary btn-lg${busy ? ' working' : ''}`} disabled={!ready} onClick={create}>
              <Icon name="wand" size={17} /> {busy ? 'Analysing voice…' : 'Create voice'}
            </button>
          </div>
        </section>

        <aside style={{ display: 'grid', gap: 12 }}>
          <div className="glass card" style={{ display: 'grid', gap: 16 }}>
            <h3 style={{ fontSize: 14, fontWeight: 600 }}>For the best clone</h3>
            <ol className="steps">
              <li><div><b>Record 10–60 seconds</b>More audio gives the speaker encoder more to work with.</div></li>
              <li><div><b>One voice, no music</b>Background sound gets cloned too. A quiet room beats a good mic.</div></li>
              <li><div><b>Speak naturally</b>The clone copies delivery as well as timbre — read like you talk.</div></li>
            </ol>
          </div>

          <div className="glass card" style={{ display: 'flex', gap: 12 }}>
            <span className="tool-icon" style={/** @type {any} */ ({ '--tone': '#0f9f6e', width: 36, height: 36, borderRadius: 11, flex: 'none', display: 'grid', placeItems: 'center', color: '#fff', background: 'linear-gradient(145deg, #34d399, #0f9f6e)' })}>
              <Icon name="shield" size={18} />
            </span>
            <div>
              <b style={{ fontSize: 13.5 }}>Private by construction</b>
              <p className="muted" style={{ fontSize: 12.5, marginTop: 3 }}>
                Cloning runs the reference audio through the speaker encoder on your GPU. There is no server to send it to.
              </p>
            </div>
          </div>

          <div className="glass card" style={{ display: 'grid', gap: 10 }}>
            <div className="field-label"><span>Your cloned voices</span><span className="faint">{custom.length}</span></div>
            {custom.length === 0 && <p className="faint" style={{ fontSize: 12.5 }}>Voices you create appear here and in My voices.</p>}
            {custom.map((v) => <ClonedRow key={v.id} voice={v} onPlay={() => previewVoice(v)} onRemove={() => { removeClone(v.id); toast(`Deleted ${v.name}`); }} />)}
            {custom.length > 0 && <Link href="/text-to-speech" className="btn btn-soft btn-sm" style={{ justifySelf: 'start' }}>Use in Text to Speech <Icon name="arrowRight" size={14} /></Link>}
          </div>
        </aside>
      </div>
    </div>
  );
}

/** @param {{onDone: (s: Sample) => void}} props */
function Recorder({ onDone }) {
  const [on, setOn] = useState(false);
  const [elapsed, setElapsed] = useState(0);
  const [levels, setLevels] = useState(() => new Array(32).fill(0));
  const [error, setError] = useState('');
  const rec = useRef(/** @type {{stop: () => void} | null} */ (null));

  useEffect(() => () => rec.current?.stop(), []);

  const start = async () => {
    setError('');
    let stream;
    try {
      stream = await navigator.mediaDevices.getUserMedia({ audio: { echoCancellation: false, noiseSuppression: true } });
    } catch {
      setError('Microphone access was blocked. Allow it in the address bar, or upload a file instead.');
      return;
    }
    player.pause();
    const ctx = new AudioContext();
    const src = ctx.createMediaStreamSource(stream);
    const an = ctx.createAnalyser();
    an.fftSize = 256;
    src.connect(an);
    const buf = new Uint8Array(an.frequencyBinCount);
    const media = new MediaRecorder(stream);
    /** @type {Blob[]} */
    const chunks = [];
    media.ondataavailable = (e) => chunks.push(e.data);
    const began = performance.now();
    let raf = 0;
    const loop = () => {
      an.getByteFrequencyData(buf);
      const bars = [];
      for (let i = 0; i < 32; i++) bars.push(buf[i + 2] / 255);
      setLevels(bars);
      setElapsed((performance.now() - began) / 1000);
      raf = requestAnimationFrame(loop);
    };
    media.onstop = async () => {
      cancelAnimationFrame(raf);
      stream.getTracks().forEach((t) => t.stop());
      ctx.close();
      setOn(false);
      setLevels(new Array(32).fill(0));
      try {
        const decoded = await decode(await new Blob(chunks).arrayBuffer());
        onDone({ id: crypto.randomUUID(), name: `Recording ${new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}`, ...decoded });
      } catch {
        setError('That recording could not be decoded. Try again, or upload a file.');
      }
    };
    media.start();
    rec.current = { stop: () => media.state !== 'inactive' && media.stop() };
    setOn(true);
    setElapsed(0);
    raf = requestAnimationFrame(loop);
  };

  return (
    <div style={{ display: 'grid', gap: 8 }}>
      <div className="rec">
        <button
          type="button"
          className={`rec-btn${on ? ' on' : ''}`}
          onClick={() => (on ? rec.current?.stop() : start())}
          aria-label={on ? 'Stop recording' : 'Start recording'}
        >
          <Icon name={on ? 'stop' : 'mic'} size={20} />
        </button>
        <div style={{ minWidth: 110 }}>
          <b style={{ fontSize: 13.5, display: 'block' }}>{on ? 'Recording…' : 'Record your voice'}</b>
          <span className="faint mono tnum" style={{ fontSize: 12 }}>{on ? clock(elapsed) : 'Read anything, naturally'}</span>
        </div>
        <div className="meter" aria-hidden="true">
          {levels.map((l, i) => <i key={i} style={{ height: `${Math.max(8, l * 100)}%`, opacity: on ? 0.4 + l * 0.6 : 0.25 }} />)}
        </div>
      </div>
      {error && <p style={{ color: 'var(--bad)', fontSize: 12.5 }}>{error}</p>}
    </div>
  );
}

/** @param {{sample: Sample, onRemove: () => void}} props */
function SampleRow({ sample, onRemove }) {
  const id = `sample:${sample.id}`;
  const playing = useIsPlaying(id);
  return (
    <div className="sample-row">
      <button
        type="button"
        className="play-btn ghost"
        onClick={() => player.toggleTrack({ id, kind: 'preview', title: sample.name, subtitle: 'Reference audio', samples: sample.samples, sampleRate: sample.sampleRate })}
        aria-label={playing ? 'Pause' : 'Play'}
      >
        <Icon name={playing ? 'pause' : 'play'} size={13} />
      </button>
      <div className="grow">
        <b>{sample.name}</b>
        <span className="mono tnum">{clock(sample.samples.length / sample.sampleRate)}</span>
      </div>
      <button type="button" className="icon-btn sm" onClick={onRemove} aria-label="Remove sample"><Icon name="trash" size={15} /></button>
    </div>
  );
}

/** @param {{voice: import('@cadence/engine').Voice, onPlay: () => void, onRemove: () => void}} props */
function ClonedRow({ voice, onPlay, onRemove }) {
  const playing = useIsPlaying(`preview:${voice.id}`);
  return (
    <div className="cast-row">
      <OrbPlay voice={voice} size={34} playing={playing} onPlay={onPlay} />
      <div className="grow">
        <b style={{ display: 'block' }}>{voice.name}</b>
        <span className="faint" style={{ fontSize: 12 }}>{voice.pitch} Hz · {voice.gender}</span>
      </div>
      <button type="button" className="icon-btn sm" onClick={onRemove} aria-label={`Delete ${voice.name}`}><Icon name="trash" size={15} /></button>
    </div>
  );
}

/**
 * Any browser-decodable audio to mono float samples.
 *
 * @param {ArrayBuffer} data
 */
async function decode(data) {
  const ctx = new AudioContext();
  try {
    const buf = await ctx.decodeAudioData(data);
    const out = new Float32Array(buf.length);
    for (let c = 0; c < buf.numberOfChannels; c++) {
      const ch = buf.getChannelData(c);
      for (let i = 0; i < ch.length; i++) out[i] += ch[i] / buf.numberOfChannels;
    }
    return { samples: out, sampleRate: buf.sampleRate };
  } finally {
    ctx.close();
  }
}
