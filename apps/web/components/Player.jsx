'use client';

import { player, usePlayer } from '@/lib/audio.js';
import { clock, downloadWav } from '@/lib/format.js';
import { useStore } from '@/lib/store.jsx';
import { Icon } from './Icon.jsx';
import { Orb } from './Orb.jsx';
import { Waveform } from './Waveform.jsx';

const BARS = 120;

/**
 * The bar along the bottom that plays whatever was last asked to play.
 *
 * The playhead moves sixty times a second, but the clock changes once a
 * second and the waveform once a bar; each reads the position rounded to what
 * it can show, so nothing re-renders every frame while the model works.
 */
export function Player() {
  const track = usePlayer((s) => s.track);
  const playing = usePlayer((s) => s.playing);
  const duration = usePlayer((s) => s.duration);
  const volume = usePlayer((s) => s.volume);
  const { byId } = useStore();

  if (!track) return null;
  const voice = track.voiceId ? byId.get(track.voiceId) : null;

  return (
    <div className="player glass-strong" role="region" aria-label="Player">
      <div className="player-meta">
        {voice && <Orb voice={voice} size={40} />}
        <div style={{ minWidth: 0 }}>
          <b>{track.title}</b>
          <span>{track.subtitle}</span>
        </div>
      </div>

      <div className="player-controls">
        <button type="button" className="icon-btn sm" onClick={() => player.skip(-5)} aria-label="Back 5 seconds" title="Back 5s">
          <Icon name="back" size={16} />
        </button>
        <button type="button" className="play-btn" onClick={() => player.toggle()} aria-label={playing ? 'Pause' : 'Play'}>
          <Icon name={playing ? 'pause' : 'play'} size={15} />
        </button>
        <button type="button" className="icon-btn sm" onClick={() => player.skip(5)} aria-label="Forward 5 seconds" title="Forward 5s">
          <Icon name="forward" size={16} />
        </button>
      </div>

      <div className="player-track">
        <Elapsed />
        <PlayerWave samples={track.samples} duration={duration} />
        <time className="tnum">{clock(duration)}</time>
      </div>

      <div className="player-end">
        <div className="volume">
          <button
            type="button"
            className="icon-btn sm"
            onClick={() => player.setVolume(volume > 0 ? 0 : 1)}
            aria-label={volume > 0 ? 'Mute' : 'Unmute'}
          >
            <Icon name={volume > 0 ? 'volume' : 'mute'} size={16} />
          </button>
          <input
            type="range"
            min={0}
            max={1}
            step={0.01}
            value={volume}
            onChange={(e) => player.setVolume(+e.target.value)}
            style={/** @type {any} */ ({ '--fill': `${volume * 100}%` })}
            aria-label="Volume"
          />
        </div>
        <button
          type="button"
          className="icon-btn sm"
          onClick={() => downloadWav(track.samples, track.sampleRate, `${track.title} - ${track.subtitle ?? ''}`)}
          aria-label="Download"
          title="Download WAV"
        >
          <Icon name="download" size={16} />
        </button>
        <button type="button" className="icon-btn sm" onClick={() => player.close()} aria-label="Close player" title="Close">
          <Icon name="x" size={16} />
        </button>
      </div>
    </div>
  );
}

function Elapsed() {
  const seconds = usePlayer((s) => Math.floor(s.position));
  return <time className="tnum">{clock(seconds)}</time>;
}

/** @param {{samples: Float32Array, duration: number}} props */
function PlayerWave({ samples, duration }) {
  // Rounded to whole bars: all a redraw could change.
  const progress = usePlayer((s) => (s.duration ? Math.floor((s.position / s.duration) * BARS) / BARS : 0));
  return <Waveform samples={samples} progress={progress} onSeek={(f) => player.seek(f * duration)} bars={BARS} height={36} />;
}
