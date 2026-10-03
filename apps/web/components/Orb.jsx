'use client';

import { useEffect, useRef } from 'react';
import { getLevel, usePlayer } from '@/lib/audio.js';
import { Icon } from './Icon.jsx';

/**
 * A voice's face: a slowly turning gradient in the voice's own three hues.
 * While that voice is speaking it spins faster and swells with the loudness of
 * what is coming out of the speakers.
 *
 * @param {{voice: {id: string, hues: number[]}, size?: number, className?: string}} props
 */
export function Orb({ voice, size = 40, className = '' }) {
  const ref = useRef(/** @type {HTMLSpanElement | null} */ (null));
  const live = usePlayer((s) => s.playing && s.track?.voiceId === voice.id);

  useEffect(() => {
    if (!live) {
      ref.current?.style.setProperty('--level', '0');
      return;
    }
    // Written straight to the element: no React render per frame.
    let raf = 0;
    const loop = () => {
      ref.current?.style.setProperty('--level', getLevel().toFixed(3));
      raf = requestAnimationFrame(loop);
    };
    raf = requestAnimationFrame(loop);
    return () => cancelAnimationFrame(raf);
  }, [live]);

  const [h1, h2, h3] = voice.hues;
  return (
    <span
      ref={ref}
      className={`orb${live ? ' live' : ''} ${className}`}
      style={/** @type {any} */ ({ '--size': `${size}px`, '--h1': h1, '--h2': h2, '--h3': h3 })}
      aria-hidden="true"
    />
  );
}

/**
 * An orb that is also the voice's play button.
 *
 * @param {{voice: any, size?: number, onPlay: () => void, playing: boolean}} props
 */
export function OrbPlay({ voice, size = 40, onPlay, playing }) {
  return (
    <button
      type="button"
      className={`orb-play${playing ? ' playing' : ''}`}
      onClick={(e) => { e.stopPropagation(); onPlay(); }}
      aria-label={playing ? `Pause ${voice.name}` : `Play ${voice.name} preview`}
    >
      <Orb voice={voice} size={size} />
      <span className="orb-icon">
        <Icon name={playing ? 'pause' : 'play'} size={Math.round(size * 0.38)} />
      </span>
    </button>
  );
}
