'use client';

import { useEffect, useMemo, useRef, useState } from 'react';
import { peaks } from '@/lib/format.js';

/**
 * Rounded bars drawn to a canvas, filled up to the playhead. Click or drag to
 * seek. Colours come from the theme tokens, so it follows light and dark.
 *
 * @param {{samples: Float32Array, progress: number, onSeek?: (fraction: number) => void, bars?: number, height?: number}} props
 */
export function Waveform({ samples, progress, onSeek, bars = 140, height = 40 }) {
  const canvas = useRef(/** @type {HTMLCanvasElement | null} */ (null));
  const [hover, setHover] = useState(-1);
  const [size, setSize] = useState({ w: 0, dpr: 1 });
  const [theme, setTheme] = useState(0);
  const data = useMemo(() => peaks(samples, bars), [samples, bars]);

  useEffect(() => {
    const el = canvas.current;
    if (!el) return;
    const ro = new ResizeObserver(([e]) => setSize({ w: e.contentRect.width, dpr: devicePixelRatio || 1 }));
    ro.observe(el);
    const mo = new MutationObserver(() => setTheme((t) => t + 1));
    mo.observe(document.documentElement, { attributes: true, attributeFilter: ['data-theme'] });
    return () => { ro.disconnect(); mo.disconnect(); };
  }, []);

  useEffect(() => {
    const el = canvas.current;
    if (!el || !size.w) return;
    const { w, dpr } = size;
    el.width = Math.round(w * dpr);
    el.height = Math.round(height * dpr);
    const g = el.getContext('2d');
    if (!g) return;
    g.scale(dpr, dpr);
    g.clearRect(0, 0, w, height);

    const css = getComputedStyle(document.documentElement);
    const played = css.getPropertyValue('--ink').trim();
    const rest = css.getPropertyValue('--ink-4').trim();
    const accent = css.getPropertyValue('--accent').trim();

    const gap = 2;
    const bw = Math.max(1.5, (w - gap * (bars - 1)) / bars);
    for (let i = 0; i < bars; i++) {
      const x = i * (bw + gap);
      const frac = i / bars;
      const h = Math.max(3, data[i] * (height - 4));
      g.fillStyle = frac < progress ? played : hover >= 0 && frac < hover ? accent : rest;
      g.globalAlpha = frac < progress ? 1 : hover >= 0 && frac < hover ? 0.55 : 0.7;
      g.beginPath();
      g.roundRect(x, (height - h) / 2, bw, h, bw / 2);
      g.fill();
    }
  }, [data, progress, size, hover, height, bars, theme]);

  /** @param {React.PointerEvent} e */
  const fraction = (e) => {
    const r = /** @type {HTMLElement} */ (e.currentTarget).getBoundingClientRect();
    return Math.max(0, Math.min(1, (e.clientX - r.left) / r.width));
  };

  return (
    <div
      className="wave"
      style={{ height }}
      role="slider"
      aria-label="Seek"
      aria-valuemin={0}
      aria-valuemax={100}
      aria-valuenow={Math.round(progress * 100)}
      tabIndex={onSeek ? 0 : -1}
      onPointerDown={(e) => {
        if (!onSeek) return;
        e.currentTarget.setPointerCapture(e.pointerId);
        onSeek(fraction(e));
      }}
      onPointerMove={(e) => {
        setHover(fraction(e));
        if (onSeek && e.buttons === 1) onSeek(fraction(e));
      }}
      onPointerLeave={() => setHover(-1)}
      onKeyDown={(e) => {
        if (!onSeek) return;
        if (e.key === 'ArrowRight') onSeek(Math.min(1, progress + 0.05));
        if (e.key === 'ArrowLeft') onSeek(Math.max(0, progress - 0.05));
      }}
    >
      <canvas ref={canvas} />
    </div>
  );
}
