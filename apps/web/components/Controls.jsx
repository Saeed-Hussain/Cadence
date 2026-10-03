'use client';

import { useLayoutEffect, useRef, useState } from 'react';
import { Icon } from './Icon.jsx';

/**
 * @param {{label: string, value: number, min?: number, max?: number, step?: number,
 *   left?: string, right?: string, format?: (v: number) => string, onChange: (v: number) => void}} props
 */
export function Slider({ label, value, min = 0, max = 1, step = 0.01, left, right, format, onChange }) {
  const fill = ((value - min) / (max - min)) * 100;
  return (
    <div className="slider">
      <div className="slider-head">
        <span>{label}</span>
        <output className="tnum">{format ? format(value) : `${Math.round(fill)}%`}</output>
      </div>
      <input
        type="range"
        min={min}
        max={max}
        step={step}
        value={value}
        aria-label={label}
        onChange={(e) => onChange(+e.target.value)}
        style={/** @type {any} */ ({ '--fill': `${fill}%` })}
      />
      {(left || right) && (
        <div className="slider-ends"><span>{left}</span><span>{right}</span></div>
      )}
    </div>
  );
}

/**
 * @param {{checked: boolean, onChange: (v: boolean) => void, label: string}} props
 */
export function Switch({ checked, onChange, label }) {
  return (
    <button
      type="button"
      role="switch"
      aria-checked={checked}
      aria-label={label}
      className="switch"
      onClick={() => onChange(!checked)}
    />
  );
}

/**
 * Segmented control whose highlight slides to the chosen option.
 *
 * @template {string} T
 * @param {{options: {value: T, label: React.ReactNode}[], value: T, onChange: (v: T) => void, small?: boolean, label?: string}} props
 */
export function Segmented({ options, value, onChange, small, label }) {
  const root = useRef(/** @type {HTMLDivElement | null} */ (null));
  const [thumb, setThumb] = useState({ left: 3, width: 0 });

  useLayoutEffect(() => {
    const el = root.current?.querySelector(`[data-v="${CSS.escape(value)}"]`);
    if (el instanceof HTMLElement) setThumb({ left: el.offsetLeft, width: el.offsetWidth });
  }, [value, options.length]);

  return (
    <div ref={root} className={`seg${small ? ' small' : ''}`} role="tablist" aria-label={label}>
      <span className="seg-thumb" style={{ left: thumb.left, width: thumb.width, opacity: thumb.width ? 1 : 0 }} />
      {options.map((o) => (
        <button
          key={o.value}
          type="button"
          role="tab"
          data-v={o.value}
          aria-selected={o.value === value}
          onClick={() => onChange(o.value)}
        >
          {o.label}
        </button>
      ))}
    </div>
  );
}

/**
 * A filter dropdown that looks like a chip, and fills in when set.
 *
 * @param {{label: string, value: string, options: string[], onChange: (v: string) => void, format?: (v: string) => string}} props
 */
export function FilterSelect({ label, value, options, onChange, format = (v) => v }) {
  return (
    <label className={`select${value ? ' on' : ''}`}>
      <span className="sr-only">{label}</span>
      <select value={value} onChange={(e) => onChange(e.target.value)}>
        <option value="">{label}</option>
        {options.map((o) => <option key={o} value={o}>{format(o)}</option>)}
      </select>
      <Icon name="chevronDown" size={14} />
    </label>
  );
}
