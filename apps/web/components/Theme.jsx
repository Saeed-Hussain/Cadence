'use client';

import { useEffect, useState } from 'react';
import { Icon } from './Icon.jsx';

/**
 * Light and dark, remembered. The stylesheet reads only `data-theme` on the
 * root element; nothing else in the app knows which theme is on.
 */

export const NO_FLASH = `
(function () {
  try {
    var saved = localStorage.getItem('cadence:theme');
    var dark = matchMedia('(prefers-color-scheme: dark)').matches;
    document.documentElement.dataset.theme = saved || (dark ? 'dark' : 'light');
  } catch (e) {
    document.documentElement.dataset.theme = 'dark';
  }
})();
`;

export function ThemeToggle() {
  const [theme, setTheme] = useState('dark');

  useEffect(() => {
    setTheme(document.documentElement.dataset.theme === 'light' ? 'light' : 'dark');
  }, []);

  /** @param {React.MouseEvent<HTMLButtonElement>} event */
  const flip = (event) => {
    const next = theme === 'dark' ? 'light' : 'dark';
    const apply = () => {
      document.documentElement.dataset.theme = next;
      setTheme(next);
      try { localStorage.setItem('cadence:theme', next); } catch { /* not remembered */ }
    };

    const reduce = matchMedia('(prefers-reduced-motion: reduce)').matches;
    // The new theme grows as a circle from the button that was pressed.
    if (!('startViewTransition' in document) || reduce) return apply();
    const rect = event.currentTarget.getBoundingClientRect();
    const x = rect.left + rect.width / 2;
    const y = rect.top + rect.height / 2;
    const r = Math.hypot(Math.max(x, innerWidth - x), Math.max(y, innerHeight - y));
    const transition = /** @type {any} */ (document).startViewTransition(apply);
    transition.ready.then(() => {
      document.documentElement.animate(
        { clipPath: [`circle(0px at ${x}px ${y}px)`, `circle(${r}px at ${x}px ${y}px)`] },
        { duration: 700, easing: 'cubic-bezier(0.22, 0.8, 0.24, 1)', pseudoElement: '::view-transition-new(root)' },
      );
    });
  };

  const dark = theme === 'dark';
  return (
    <button
      type="button"
      className="icon-btn"
      onClick={flip}
      aria-label={dark ? 'Switch to light theme' : 'Switch to dark theme'}
      title={dark ? 'Light theme' : 'Dark theme'}
    >
      <Icon name={dark ? 'sun' : 'moon'} />
    </button>
  );
}
