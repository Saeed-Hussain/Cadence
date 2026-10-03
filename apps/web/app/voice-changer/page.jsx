import Link from 'next/link';
import { Icon } from '@/components/Icon.jsx';

export const metadata = { title: 'Voice Changer' };

export default function VoiceChanger() {
  return (
    <div className="page">
      <div className="page-head">
        <div>
          <h1>Voice Changer</h1>
          <p className="sub">Speech in, a different voice out — same conditioning as synthesis, a different encoder.</p>
        </div>
      </div>
      <div className="glass" style={{ borderRadius: 'var(--radius-lg)' }}>
        <div className="empty" style={{ padding: '80px 20px' }}>
          <span className="empty-icon"><Icon name="refresh" size={22} /></span>
          <b>Arrives in Phase 2</b>
          <p>Speech-to-speech is built on the trained speaker-embedding space (milestone M9). Until then, clone a voice and use it in Text to Speech.</p>
          <div style={{ display: 'flex', gap: 8, marginTop: 8 }}>
            <Link href="/voice-cloning" className="btn btn-soft btn-sm">Clone a voice</Link>
            <Link href="/engine" className="btn btn-ghost btn-sm">See the roadmap</Link>
          </div>
        </div>
      </div>
    </div>
  );
}
