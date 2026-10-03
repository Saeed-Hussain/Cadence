'use client';

import { useEffect, useRef } from 'react';
import { getLevel, useIsPlaying, usePlayer } from '@/lib/audio.js';
import { useStore } from '@/lib/store.jsx';
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
 * @param {{voice: any, size?: number, onPlay: () => void, playing: boolean, loading?: boolean}} props
 */
export function OrbPlay({ voice, size = 40, onPlay, playing, loading = false }) {
  return (
    <button
      type="button"
      className={`orb-play${playing ? ' playing' : ''}${loading ? ' loading' : ''}`}
      aria-busy={loading}
      onClick={(e) => { e.stopPropagation(); onPlay(); }}
      aria-label={playing ? `Pause ${voice.name}` : `Play ${voice.name} preview`}
    >
      <Orb voice={voice} size={size} />
      <span className="orb-icon">
        {loading
          ? <span className="spinner" style={{ width: Math.round(size * 0.42), height: Math.round(size * 0.42) }} />
          : <Icon name={playing ? 'pause' : 'play'} size={Math.round(size * 0.38)} />}
      </span>
    </button>
  );
}

/**
 * A voice's orb wired to its audition sample, with a spinner while the sample
 * is rendered for the first time.
 *
 * @param {{voice: import('@cadence/engine').Voice, size?: number}} props
 */
export function PreviewOrb({ voice, size = 40 }) {
  const { previewVoice, previewing } = useStore();
  const playing = useIsPlaying(`preview:${voice.id}`);
  return <OrbPlay voice={voice} size={size} playing={playing} loading={previewing === voice.id} onPlay={() => previewVoice(voice)} />;
}
