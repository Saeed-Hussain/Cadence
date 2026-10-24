'use client';

import { useEffect, useState } from 'react';
import { MODELS, VOICES, cpuThreads, hasWebGPU } from '@cadence/engine';
import { Icon } from '@/components/Icon.jsx';
import { useStore } from '@/lib/store.jsx';

/**
 * The part of the product that is the point of the project: what is running,
 * on what, and how fast. Every number here is measured in this tab.
 */

// Ordered by M0's profile of the fast model in the browser: convolution is 82%
// of the time, so it is written first.
const KERNELS = [
  { op: 'conv1d', what: 'Dilated 1-D convolution · 70% of browser time', cpu: 'next', gpu: 'planned' },
  { op: 'conv_transpose1d', what: 'Upsampling convolution · 12%', cpu: 'next', gpu: 'planned' },
  { op: 'gemm_f32', what: 'Matrix multiply microkernel', cpu: 'planned', gpu: 'planned' },
  { op: 'attention', what: 'Scaled dot-product attention', cpu: 'planned', gpu: 'planned' },
  { op: 'layernorm', what: 'Layer normalisation', cpu: 'planned', gpu: 'planned' },
  { op: 'gelu / snake', what: 'Activations', cpu: 'planned', gpu: 'planned' },
  { op: 'istft', what: 'Inverse STFT (vocoder output)', cpu: 'planned', gpu: 'planned' },
];

// The plan in docs/PROPOSAL.md §8.
const DONE = new Set(['M0', 'M2', 'M3']);
const NOW = 'M1';

const MILESTONES = [
  { id: 'M0', name: 'Measure and choose', when: '3 Oct', done: 'Every candidate measured on the reference machine; model chosen' },
  { id: 'M1', name: 'Reliable engine', when: 'built', done: 'In-app within 15% of standalone; no gaps; offline; recovers from failed downloads — reference numbers pending' },
  { id: 'M2', name: 'SDK', when: '21 Oct', done: 'Packaged engine with a documented API, types and a Node path' },
  { id: 'M3', name: 'Licensing and docs', when: '24 Oct', done: 'Apache-2.0; own phonemiser replaces eSpeak NG; notices; getting-started guide' },
  { id: 'M4', name: 'Benchmarks against alternatives', when: 'next', done: 'Speed, first audio, size, memory, quality on three hardware tiers' },
];

export default function Engine() {
  const { models, activeModel, history, chooseModel, retryModel, offlineReady } = useStore();
  const [gpu, setGpu] = useState(/** @type {boolean | null} */ (null));
  const [threads, setThreads] = useState(0);
  const [isolated, setIsolated] = useState(/** @type {boolean | null} */ (null));

  useEffect(() => {
    setGpu(hasWebGPU());
    setThreads(cpuThreads());
    setIsolated(globalThis.crossOriginIsolated ?? false);
  }, []);

  const recent = history.slice(0, 20);
  const rtf = recent.length ? recent.reduce((s, h) => s + h.stats.rtf, 0) / recent.length : null;
  const withGaps = recent.filter((h) => typeof h.stats.gaps === 'number');
  const gaps = withGaps.length ? withGaps.reduce((s, h) => s + (h.stats.gaps ?? 0), 0) : null;
  const ttfa = recent.length ? recent.reduce((s, h) => s + h.stats.ttfaMs, 0) / recent.length : null;
  // The dial reads 0 → 1; below 0.3 is the target zone.
  const fill = rtf === null ? 0 : Math.max(0.02, 1 - Math.min(rtf, 1));
  const arc = Math.PI * 80;

  return (
    <div className="page">
      <div className="page-head">
        <div>
          <h1>Engine & Benchmarks</h1>
          <p className="sub">What is running, on what hardware, and how fast — measured live in this tab.</p>
        </div>
        <span className="tag warn" style={{ height: 28, padding: '0 12px', fontSize: 12.5 }}>
          <Icon name="info" size={14} /> &nbsp;Reference weights on ONNX Runtime Web — hand-written kernels come after the MVP
        </span>
      </div>

      <div className="grid grid-2">
        <div className="glass card gauge-card">
          <div className="gauge">
            <svg viewBox="0 0 200 118">
              <defs>
                <linearGradient id="gauge-grad" x1="0" x2="1">
                  <stop offset="0" stopColor="#e0445c" />
                  <stop offset="0.55" stopColor="#f59e0b" />
                  <stop offset="1" stopColor="#10b981" />
                </linearGradient>
              </defs>
              <path className="g-track" d="M20 100 A80 80 0 0 1 180 100" fill="none" strokeWidth="14" strokeLinecap="round" />
              <path
                className="g-value"
                d="M20 100 A80 80 0 0 1 180 100"
                fill="none"
                strokeWidth="14"
                strokeLinecap="round"
                strokeDasharray={arc}
                strokeDashoffset={arc * (1 - fill)}
              />
            </svg>
            <div className="g-read">
              <b className="tnum">{rtf === null ? '—' : rtf.toFixed(3)}</b>
              <span>real-time factor</span>
            </div>
          </div>
          <div style={{ display: 'grid', gap: 12 }}>
            <div className="stat"><span>{recent.length ? `Average over the last ${recent.length} run${recent.length === 1 ? '' : 's'}` : 'Generate some speech and the numbers appear here'}</span></div>
            <div className="readout" style={{ gridTemplateColumns: '1fr 1fr' }}>
              <div><b className="tnum">{ttfa === null ? '—' : `${Math.round(ttfa)}`}<small>{ttfa === null ? '' : 'ms'}</small></b><span>Time to first audio</span></div>
              <div><b className="tnum">{rtf === null ? '—' : `${(1 / Math.max(rtf, 1e-4)).toFixed(0)}×`}</b><span>Faster than real time</span></div>
            </div>
            <p className="faint" style={{ fontSize: 12 }}>Targets: RTF &lt; 0.3 · first audio &lt; 500 ms, in the app, on the reference machine. Gaps: {gaps === null ? '—' : `${gaps} in the last ${recent.length} run${recent.length === 1 ? '' : 's'}`}.</p>
          </div>
        </div>

        <div className="glass card" style={{ display: 'grid', gap: 12 }}>
          <div className="field-label"><span>This machine</span></div>
          <Capability icon="cpu" label="CPU · WASM SIMD" value={threads ? `${threads} threads` : '…'} ok />
          <Capability icon="zap" label="GPU · WebGPU" value={gpu === null ? '…' : gpu ? 'Available' : 'Not available'} ok={!!gpu} />
          <Capability icon="layers" label="Threads · SharedArrayBuffer" value={isolated === null ? '…' : isolated ? 'Cross-origin isolated' : 'Single-thread fallback'} ok={!!isolated} />
          <Capability icon="download" label="Offline · weights and app kept" value={offlineReady ? 'Works with the network off' : 'After the model has loaded once'} ok={offlineReady} />
          <Capability icon="voices" label="Voice library" value={`${VOICES.length} voices · ${VOICES.filter((v) => v.model === 'swift').length} Swift, ${VOICES.filter((v) => v.model === 'hd').length} HD`} ok />
        </div>
      </div>

      <div className="section-title"><h2>Models</h2></div>
      <div className="grid grid-2">
        {MODELS.map((m) => {
          const active = activeModel.id === m.id;
          const st = models[m.id];
          return (
            <div key={m.id} className={`glass card${active ? '' : ' card-hover'}`} style={{ display: 'grid', gap: 12, boxShadow: active ? 'inset 0 0 0 1.5px var(--accent), var(--shadow)' : undefined }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
                <span className="model-opt" style={{ padding: 0, border: 0, background: 'none', width: 'auto' }}>
                  <span className="model-icon"><Icon name={m.id === 'swift' ? 'zap' : 'sparkles'} size={16} /></span>
                </span>
                <b style={{ fontSize: 15, fontWeight: 620 }}>{m.name}</b>
                <span className={`tag ${m.id === 'swift' ? 'good' : 'accent'}`}>{m.id === 'swift' ? 'Default' : 'HD'}</span>
                <span style={{ flex: 1 }} />
                <span className="tag">{st.status === 'ready' ? 'Loaded' : st.status === 'loading' ? `Loading ${Math.round(st.progress * 100)}%` : st.status === 'error' ? 'Failed' : 'Not loaded'}</span>
                {!active && <button type="button" className="btn btn-soft btn-sm" onClick={() => chooseModel(m.id)}>Use</button>}
              </div>
              <p className="muted" style={{ fontSize: 13 }}>{m.description}</p>
              {st.status === 'loading' && <div className="bar"><i style={{ width: `${st.progress * 100}%` }} /></div>}
              {st.status === 'error' && (
                <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
                  <p style={{ color: 'var(--bad)', fontSize: 12.5, flex: 1 }}>{st.error}</p>
                  <button type="button" className="btn btn-soft btn-sm" onClick={() => retryModel(m.id)}>Retry</button>
                </div>
              )}
              <div className="faint mono" style={{ fontSize: 12 }}>{m.weights} · downloaded once, then cached</div>
            </div>
          );
        })}
      </div>

      <div className="grid split" style={{ marginTop: 12 }}>
        <div>
          <div className="section-title"><h2>Kernel operator set</h2></div>
          <div className="glass" style={{ borderRadius: 'var(--radius-lg)', overflow: 'hidden' }}>
            {KERNELS.map((k) => (
              <div key={k.op} className="kernel">
                <div><code>{k.op}</code><div className="faint" style={{ fontSize: 12 }}>{k.what}</div></div>
                <span className="tag">CPU · {k.cpu}</span>
                <span className="tag">GPU · {k.gpu}</span>
              </div>
            ))}
          </div>
        </div>
        <div>
          <div className="section-title"><h2>MVP roadmap</h2></div>
          <div className="glass card timeline">
            {MILESTONES.map((m, i) => (
              <div key={m.id} className={`milestone${DONE.has(m.id) ? ' done' : m.id === NOW ? ' now' : ''}`}>
                <i />
                <div><b>{m.id} — {m.name}</b><div><span>{m.done}</span></div></div>
                <span className="mono">{m.when}</span>
              </div>
            ))}
          </div>
        </div>
      </div>
    </div>
  );
}

/** @param {{icon: any, label: string, value: string, ok: boolean}} props */
function Capability({ icon, label, value, ok }) {
  return (
    <div className="cast-row" style={{ padding: '6px 0' }}>
      <span className="model-icon" style={{ width: 32, height: 32, borderRadius: 10, display: 'grid', placeItems: 'center', background: 'var(--glass-strong)', border: '1px solid var(--line)' }}>
        <Icon name={icon} size={16} />
      </span>
      <div className="grow"><b>{label}</b><div className="faint" style={{ fontSize: 12 }}>{value}</div></div>
      <span className={`tag ${ok ? 'good' : 'warn'}`}>{ok ? 'Ready' : 'Fallback'}</span>
    </div>
  );
}
