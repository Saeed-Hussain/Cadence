'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { useEffect, useState } from 'react';
import { Icon } from './Icon.jsx';
import { ThemeToggle } from './Theme.jsx';
import { Player } from './Player.jsx';
import { player, usePlayer } from '@/lib/audio.js';
import { useStore } from '@/lib/store.jsx';

const NAV = [
  { items: [{ href: '/', label: 'Home', icon: 'home' }] },
  {
    label: 'Playground',
    items: [
      { href: '/text-to-speech', label: 'Text to Speech', icon: 'speech' },
      { href: '/voice-changer', label: 'Voice Changer', icon: 'refresh', badge: 'Soon' },
    ],
  },
  {
    label: 'Voices',
    items: [
      { href: '/voices', label: 'Voice Library', icon: 'voices' },
      { href: '/voice-cloning', label: 'Voice Cloning', icon: 'mic' },
    ],
  },
  {
    label: 'Create',
    items: [
      { href: '/studio', label: 'Studio', icon: 'studio' },
      { href: '/history', label: 'History', icon: 'history' },
    ],
  },
  {
    label: 'Engine',
    items: [{ href: '/engine', label: 'Engine & Benchmarks', icon: 'cpu' }],
  },
];

/** @param {{children: React.ReactNode}} props */
export function Shell({ children }) {
  const pathname = usePathname();
  const [collapsed, setCollapsed] = useState(false);
  const [drawer, setDrawer] = useState(false);
  const hasTrack = usePlayer((s) => s.track !== null);
  const speaking = usePlayer((s) => s.playing);

  useEffect(() => {
    try { setCollapsed(localStorage.getItem('cadence:sidebar') === 'collapsed'); } catch { /* default */ }
  }, []);

  useEffect(() => setDrawer(false), [pathname]);

  // Space plays and pauses, unless someone is typing.
  useEffect(() => {
    /** @param {KeyboardEvent} e */
    const onKey = (e) => {
      const t = /** @type {HTMLElement} */ (e.target);
      if (e.code !== 'Space' || t.closest('input, textarea, select, button, [contenteditable]')) return;
      e.preventDefault();
      player.toggle();
    };
    addEventListener('keydown', onKey);
    return () => removeEventListener('keydown', onKey);
  }, []);

  const toggleCollapsed = () => {
    setCollapsed((c) => {
      try { localStorage.setItem('cadence:sidebar', c ? 'open' : 'collapsed'); } catch { /* not remembered */ }
      return !c;
    });
  };

  return (
    <>
      <div className={`backdrop${speaking ? ' speaking' : ''}`} aria-hidden="true">
        <div className="blob b1" />
        <div className="blob b2" />
        <div className="blob b3" />
        <div className="blob b4" />
        <div className="grain" />
      </div>

      <div className={`app${collapsed ? ' collapsed' : ''}${drawer ? ' drawer' : ''}`}>
        <aside className="sidebar glass">
          <div className="brand">
            <Logo />
            <span className="brand-name">Cadence</span>
            <button
              type="button"
              className="icon-btn sm collapse-btn"
              onClick={toggleCollapsed}
              aria-label={collapsed ? 'Expand sidebar' : 'Collapse sidebar'}
              title={collapsed ? 'Expand' : 'Collapse'}
            >
              <Icon name="panel" size={17} />
            </button>
          </div>

          <nav className="nav" aria-label="Main">
            {NAV.map((group, i) => (
              <div key={i}>
                {group.label && <div className="nav-label">{group.label}</div>}
                {group.items.map((item) => {
                  const active = item.href === '/' ? pathname === '/' : pathname.startsWith(item.href);
                  return (
                    <Link
                      key={item.href}
                      href={item.href}
                      className={`nav-item${active ? ' active' : ''}`}
                      title={collapsed ? item.label : undefined}
                      aria-current={active ? 'page' : undefined}
                    >
                      <Icon name={/** @type {any} */ (item.icon)} />
                      <span className="nav-text">{item.label}</span>
                      {item.badge && <span className="nav-badge">{item.badge}</span>}
                    </Link>
                  );
                })}
              </div>
            ))}
          </nav>

          <div className="sidebar-foot">
            <EnginePill />
            <div className="sidebar-row">
              <ThemeToggle />
            </div>
          </div>
        </aside>

        <div className="scrim" onClick={() => setDrawer(false)} />

        <main className="main surface">
          <div className="mobile-bar glass-strong">
            <button type="button" className="icon-btn" onClick={() => setDrawer(true)} aria-label="Open menu">
              <Icon name="menu" />
            </button>
            <Logo />
            <span className="brand-name">Cadence</span>
            <span style={{ flex: 1 }} />
            <ThemeToggle />
          </div>
          <div className="main-scroll" id="main-scroll">
            {children}
            {hasTrack && <div className="player-spacer" />}
          </div>
          <Player />
        </main>
      </div>

      <Toasts />
    </>
  );
}

function Logo() {
  return (
    <span className="brand-mark" aria-hidden="true">
      <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.6" strokeLinecap="round">
        <path d="M4 10v4M8.5 6.5v11M13 3.5v17M17.5 8v8M22 11v2" />
      </svg>
    </span>
  );
}

function EnginePill() {
  const { engineState, engine } = useStore();
  const loading = engineState.status === 'loading' || engineState.status === 'idle';
  const pct = Math.round(engineState.progress * 100);
  const c = 2 * Math.PI * 9;
  return (
    <Link href="/engine" className="engine-pill" title="Engine status">
      {loading ? (
        <svg className="ring" viewBox="0 0 24 24" aria-hidden="true">
          <circle className="track" cx="12" cy="12" r="9" />
          <circle className="value" cx="12" cy="12" r="9" strokeDasharray={c} strokeDashoffset={c * (1 - engineState.progress)} />
        </svg>
      ) : (
        <span className="dot" aria-hidden="true" />
      )}
      <span className="engine-meta">
        <b>{engine.model.name}</b>
        <span>{loading ? `Loading model · ${pct}%` : `Ready · on-device · ${engine.model.backend.toUpperCase()}`}</span>
      </span>
    </Link>
  );
}

function Toasts() {
  const { toasts } = useStore();
  return (
    <div className="toasts" role="status" aria-live="polite">
      {toasts.map((t) => (
        <div key={t.id} className="toast glass-strong">
          <span className="ok"><Icon name={t.tone === 'error' ? 'info' : 'check'} size={16} /></span>
          {t.message}
        </div>
      ))}
    </div>
  );
}
