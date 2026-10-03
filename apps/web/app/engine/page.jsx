'use client';

import { useEffect, useState } from 'react';
import { MODELS, VOICES, cpuThreads, hasWebGPU } from '@cadence/engine';
import { Icon } from '@/components/Icon.jsx';
import { useStore } from '@/lib/store.jsx';

/**
 * The part of the product that is the point of the project: what is running,
 * on what, and how fast. Every number here is measured in this tab.
 */

const KERNELS = [
  { op: 'gemm_f32', what: 'Matrix multiply microkernel', cpu: 'planned', gpu: 'planned' },
  { op: 'gemm_q8', what: 'Int8 quantised GEMM', cpu: 'planned', gpu: 'planned' },
  { op: 'conv1d', what: 'Dilated 1-D convolution', cpu: 'planned', gpu: 'planned' },
  { op: 'attention', what: 'Scaled dot-product attention', cpu: 'planned', gpu: 'planned' },
  { op: 'layernorm', what: 'Layer normalisation', cpu: 'planned', gpu: 'planned' },
  { op: 'gelu / snake', what: 'Activations', cpu: 'planned', gpu: 'planned' },
  { op: 'istft', what: 'Inverse STFT (vocoder output)', cpu: 'planned', gpu: 'planned' },
];

const MILESTONES = [
  { id: 'M0', name: 'The spike', week: 2, done: 'Real-time factor measured on the target CPU' },
  { id: 'M1', name: 'It speaks', week: 6, done: 'Normalisation and G2P pass a held-out set' },
  { id: 'M2', name: 'It is fast', week: 10, done: 'SIMD GEMM ≥ 10× the naive kernel' },
  { id: 'M3', name: 'It is audible', week: 14, done: 'End-to-end synthesis streaming to an AudioWorklet' },
  { id: 'M4', name: 'It is portable', week: 16, done: 'GPU backend passes the CPU operator tests' },
  { id: 'M4b', name: 'It has voices', week: 18, done: '200+ curated voices with samples' },
  { id: 'M5', name: 'It ships', week: 18, done: 'Cloning, editor, deployed demo, benchmarks' },
];

export default function Engine() {
  const { engine, engineState, history, setModel } = useStore();
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
          <Icon name="info" size={14} /> &nbsp;Reference weights on ONNX Runtime Web — hand-written kernels replace it at M2
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
            <p className="faint" style={{ fontSize: 12 }}>Targets: RTF &lt; 0.3 on 4 CPU threads · first audio &lt; 200 ms.</p>
          </div>
        </div>

        <div className="glass card" style={{ display: 'grid', gap: 12 }}>
          <div className="field-label"><span>This machine</span></div>
          <Capability icon="cpu" label="CPU · WASM SIMD" value={threads ? `${threads} threads` : '…'} ok />
          <Capability icon="zap" label="GPU · WebGPU" value={gpu === null ? '…' : gpu ? 'Available' : 'Not available'} ok={!!gpu} />
          <Capability icon="layers" label="Threads · SharedArrayBuffer" value={isolated === null ? '…' : isolated ? 'Cross-origin isolated' : 'Single-thread fallback'} ok={!!isolated} />
          <Capability icon="voices" label="Voice library" value={`${VOICES.length} voices · ${VOICES.filter((v) => v.kind === 'original').length} originals + blends`} ok />
        </div>
      </div>

      <div className="section-title"><h2>Models</h2></div>
      <div className="grid grid-2">
        {MODELS.map((m) => {
          const active = engine.model.id === m.id;
          return (
            <div key={m.id} className={`glass card${active ? '' : ' card-hover'}`} style={{ display: 'grid', gap: 12, boxShadow: active ? 'inset 0 0 0 1.5px var(--accent), var(--shadow)' : undefined }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
                <span className="model-opt" style={{ padding: 0, border: 0, background: 'none', width: 'auto' }}>
                  <span className="model-icon"><Icon name={m.backend === 'gpu' ? 'zap' : 'cpu'} size={16} /></span>
                </span>
                <b style={{ fontSize: 15, fontWeight: 620 }}>{m.name}</b>
                <span className={`tag ${m.backend === 'cpu' ? 'good' : 'accent'}`}>{m.backend.toUpperCase()}</span>
                <span style={{ flex: 1 }} />
                {active
                  ? <span className="tag">{engineState.status === 'ready' ? 'Active' : `Loading ${Math.round(engineState.progress * 100)}%`}</span>
                  : <button type="button" className="btn btn-soft btn-sm" onClick={() => setModel(m.id)}>Switch</button>}
              </div>
              <p className="muted" style={{ fontSize: 13 }}>{m.description}</p>
              {active && engineState.status !== 'ready' && <div className="bar"><i style={{ width: `${engineState.progress * 100}%` }} /></div>}
              <div className="faint mono" style={{ fontSize: 12 }}>Kokoro-82M · {m.sizeMb} MB weights · {m.dtype === 'q8' ? 'int8 quantised' : 'fp32'} · downloaded once, then cached</div>
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
          <div className="section-title"><h2>Phase 1 roadmap</h2></div>
          <div className="glass card timeline">
            {MILESTONES.map((m, i) => (
              <div key={m.id} className={`milestone${i === 0 ? ' now' : ''}`}>
                <i />
                <div><b>{m.id} — {m.name}</b><div><span>{m.done}</span></div></div>
                <span className="mono">wk {m.week}</span>
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
