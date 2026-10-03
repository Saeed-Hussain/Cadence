/**
 * One icon set, drawn on a 24-unit grid with a single stroke weight, so every
 * glyph in the app sits on the same optical baseline.
 */

const FILLED = { fill: 'currentColor', stroke: 'none' };

const PATHS = {
  home: <><path d="M3.5 10.2 12 3.5l8.5 6.7" /><path d="M5.5 9v10.5a1 1 0 0 0 1 1H10v-5.5h4v5.5h3.5a1 1 0 0 0 1-1V9" /></>,
  speech: <path d="M3 10.5v3M7 7v10M11 4v16M15 8.5v7M19 6v12" />,
  voices: <><circle cx="9" cy="8" r="3.6" /><path d="M2.8 20c.6-3.4 3.2-5.5 6.2-5.5s5.6 2.1 6.2 5.5" /><path d="M15.5 4.8a3.5 3.5 0 0 1 0 6.5M18 14.8c1.8.8 3 2.6 3.3 5.2" /></>,
  mic: <><rect x="9" y="2.8" width="6" height="11.5" rx="3" /><path d="M18.5 10.5v.8a6.5 6.5 0 0 1-13 0v-.8M12 17.8v3.4" /></>,
  studio: <><path d="M3 5h5.5A3.5 3.5 0 0 1 12 8.5V20a2.8 2.8 0 0 0-2.8-2.8H3z" /><path d="M21 5h-5.5A3.5 3.5 0 0 0 12 8.5V20a2.8 2.8 0 0 1 2.8-2.8H21z" /></>,
  history: <><path d="M3.5 12a8.5 8.5 0 1 0 2.6-6.1L3.5 8.3" /><path d="M3.5 3.8v4.5H8" /><path d="M12 7.5V12l3.2 2" /></>,
  cpu: <><rect x="5" y="5" width="14" height="14" rx="2.5" /><rect x="9" y="9" width="6" height="6" rx="1" /><path d="M9 2.5V5M15 2.5V5M9 19v2.5M15 19v2.5M2.5 9H5M2.5 15H5M19 9h2.5M19 15h2.5" /></>,
  search: <><circle cx="11" cy="11" r="6.8" /><path d="m20.5 20.5-4.7-4.7" /></>,
  play: <path {...FILLED} d="M7.5 4.9v14.2a1.1 1.1 0 0 0 1.7.93l11.1-7.1a1.1 1.1 0 0 0 0-1.86L9.2 3.97a1.1 1.1 0 0 0-1.7.93Z" />,
  pause: <><rect {...FILLED} x="6" y="4.5" width="4.2" height="15" rx="1.3" /><rect {...FILLED} x="13.8" y="4.5" width="4.2" height="15" rx="1.3" /></>,
  stop: <rect {...FILLED} x="6" y="6" width="12" height="12" rx="2.5" />,
  record: <circle {...FILLED} cx="12" cy="12" r="6.5" />,
  plus: <path d="M12 5v14M5 12h14" />,
  check: <path d="m5 12.5 4.5 4.5L19.5 7" />,
  x: <path d="M17.5 6.5l-11 11M6.5 6.5l11 11" />,
  chevronDown: <path d="m6.5 9.5 5.5 5.5 5.5-5.5" />,
  chevronRight: <path d="m9.5 6.5 5.5 5.5-5.5 5.5" />,
  chevronLeft: <path d="m14.5 6.5-5.5 5.5 5.5 5.5" />,
  arrowRight: <path d="M4.5 12h15m-6-6 6 6-6 6" />,
  arrowUpRight: <path d="M7 17 17 7M8.5 7H17v8.5" />,
  download: <path d="M12 3.5v11.5m0 0-4.2-4.2M12 15l4.2-4.2M4.5 16.5v2a2 2 0 0 0 2 2h11a2 2 0 0 0 2-2v-2" />,
  upload: <path d="M12 15.5V4m0 0L7.8 8.2M12 4l4.2 4.2M4.5 16.5v2a2 2 0 0 0 2 2h11a2 2 0 0 0 2-2v-2" />,
  trash: <><path d="M4 6.5h16M9 6.5V4.8a1 1 0 0 1 1-1h4a1 1 0 0 1 1 1v1.7" /><path d="m18.2 6.5-.8 12.3a2 2 0 0 1-2 1.9H8.6a2 2 0 0 1-2-1.9L5.8 6.5" /></>,
  sparkles: <><path d="M11 3.5 12.9 8.6 18 10.5l-5.1 1.9L11 17.5l-1.9-5.1L4 10.5l5.1-1.9Z" /><path d="m18.5 15 .8 2.2 2.2.8-2.2.8-.8 2.2-.8-2.2-2.2-.8 2.2-.8Z" /></>,
  sun: <><circle cx="12" cy="12" r="4.2" /><path d="M12 2.6v2.2M12 19.2v2.2M21.4 12h-2.2M4.8 12H2.6M18.6 5.4 17 7M7 17l-1.6 1.6M18.6 18.6 17 17M7 7 5.4 5.4" /></>,
  moon: <path d="M20 14.2A8.4 8.4 0 0 1 9.8 4a8.4 8.4 0 1 0 10.2 10.2Z" />,
  panel: <><rect x="3" y="4" width="18" height="16" rx="3" /><path d="M9.5 4v16" /></>,
  sliders: <path d="M4 20.5V14M4 10V3.5M12 20.5V12M12 8V3.5M20 20.5V16M20 12V3.5M1.5 14h5M9.5 8h5M17.5 16h5" />,
  bookmark: <path d="M18.5 20.5 12 16.7l-6.5 3.8V5.5a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2z" />,
  bookmarkFilled: <path {...FILLED} d="M18.5 20.5 12 16.7l-6.5 3.8V5.5a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2z" />,
  volume: <><path d="M11 5.5 6.5 9.2H3.5v5.6h3l4.5 3.7z" /><path d="M15.5 9a4.2 4.2 0 0 1 0 6M18.3 6.3a8 8 0 0 1 0 11.4" /></>,
  mute: <><path d="M11 5.5 6.5 9.2H3.5v5.6h3l4.5 3.7z" /><path d="m16 9.5 5 5M21 9.5l-5 5" /></>,
  back: <><path d="M3.5 12a8.5 8.5 0 1 0 2.6-6.1L3.5 8.3" /><path d="M3.5 3.8v4.5H8" /></>,
  forward: <><path d="M20.5 12a8.5 8.5 0 1 1-2.6-6.1l2.6 2.4" /><path d="M20.5 3.8v4.5H16" /></>,
  zap: <path d="M13.5 2.5 4.5 13.8h6.8l-1 7.7 9.2-11.3h-6.8z" />,
  globe: <><circle cx="12" cy="12" r="8.8" /><path d="M3.2 12h17.6M12 3.2c2.4 2.4 3.6 5.3 3.6 8.8s-1.2 6.4-3.6 8.8c-2.4-2.4-3.6-5.3-3.6-8.8S9.6 5.6 12 3.2z" /></>,
  wand: <><path d="m4 20 11-11M13.5 7.5l3 3" /><path d="M18 2.5v3M16.5 4h3M20.5 9v2M19.5 10h2M9 3.5v2M8 4.5h2" /></>,
  gauge: <><path d="M4.2 17.5a8.8 8.8 0 1 1 15.6 0" /><path d="m12 13.5 4-5" /><circle cx="12" cy="14" r="1.4" /></>,
  layers: <><path d="m12 3.5 9 4.8-9 4.8-9-4.8z" /><path d="m3 12.3 9 4.8 9-4.8M3 16.3l9 4.8 9-4.8" /></>,
  file: <><path d="M14 3.5H7a2 2 0 0 0-2 2v13a2 2 0 0 0 2 2h10a2 2 0 0 0 2-2V8.5z" /><path d="M14 3.5v5h5M8.5 13h7M8.5 16.5h5" /></>,
  more: <><circle {...FILLED} cx="5.5" cy="12" r="1.6" /><circle {...FILLED} cx="12" cy="12" r="1.6" /><circle {...FILLED} cx="18.5" cy="12" r="1.6" /></>,
  menu: <path d="M4 7h16M4 12h16M4 17h16" />,
  copy: <><rect x="8.5" y="8.5" width="12" height="12" rx="2.5" /><path d="M15.5 8.5V6a2.5 2.5 0 0 0-2.5-2.5H6A2.5 2.5 0 0 0 3.5 6v7A2.5 2.5 0 0 0 6 15.5h2.5" /></>,
  refresh: <><path d="M20.5 12a8.5 8.5 0 0 1-14.8 5.7M3.5 12A8.5 8.5 0 0 1 18.3 6.3" /><path d="M20.5 3.5v4.5H16M3.5 20.5V16H8" /></>,
  shield: <><path d="M12 3 4.5 6v5.5c0 4.5 3.2 8.2 7.5 9.5 4.3-1.3 7.5-5 7.5-9.5V6z" /><path d="m8.8 12 2.2 2.2 4.4-4.4" /></>,
  info: <><circle cx="12" cy="12" r="8.8" /><path d="M12 11v5.5M12 7.8v.2" /></>,
  filter: <path d="M4 5.5h16l-6.2 7.3v5.4l-3.6 1.8v-7.2z" />,
  grid: <><rect x="4" y="4" width="6.5" height="6.5" rx="1.5" /><rect x="13.5" y="4" width="6.5" height="6.5" rx="1.5" /><rect x="4" y="13.5" width="6.5" height="6.5" rx="1.5" /><rect x="13.5" y="13.5" width="6.5" height="6.5" rx="1.5" /></>,
  list: <path d="M9 6.5h11M9 12h11M9 17.5h11M4.5 6.5h.01M4.5 12h.01M4.5 17.5h.01" />,
  book: <><path d="M5 19.5V5a1.5 1.5 0 0 1 1.5-1.5H19v14H6.5A1.5 1.5 0 0 0 5 19a1.5 1.5 0 0 0 1.5 1.5H19" /></>,
  smile: <><circle cx="12" cy="12" r="8.8" /><path d="M8.5 14.2c.9 1.3 2.1 2 3.5 2s2.6-.7 3.5-2M9 9.5h.01M15 9.5h.01" /></>,
  megaphone: <><path d="M3.5 10v4a1 1 0 0 0 1 1h2l8.5 4.5V4.5L6.5 9h-2a1 1 0 0 0-1 1z" /><path d="M7 15l1.3 5h2.2l-.9-4M18.5 9.5a3.5 3.5 0 0 1 0 5" /></>,
  film: <><rect x="3.5" y="4" width="17" height="16" rx="2.5" /><path d="M7.5 4v16M16.5 4v16M3.5 9h4M3.5 15h4M16.5 9h4M16.5 15h4" /></>,
  gamepad: <><rect x="2.5" y="7" width="19" height="11" rx="5.5" /><path d="M7.5 10.5v4M5.5 12.5h4M15.5 11.5h.01M18 13.5h.01" /></>,
  podcast: <><circle cx="12" cy="10" r="2.5" /><path d="M12 14.5v6M7.2 14.8a6.8 6.8 0 1 1 9.6 0M4.5 17.3a10.3 10.3 0 1 1 15 0" /></>,
  leaf: <><path d="M5 19c0-8 5-14 15-14.5C19.5 14.5 13.5 19 5 19z" /><path d="M5 19c3-4 6-6.5 9.5-8" /></>,
  keyboard: <><rect x="2.5" y="5.5" width="19" height="13" rx="2.5" /><path d="M6.5 9.5h.01M10 9.5h.01M14 9.5h.01M17.5 9.5h.01M7.5 14.5h9" /></>,
};

/**
 * @param {{name: keyof typeof PATHS, size?: number, className?: string, strokeWidth?: number}} props
 */
export function Icon({ name, size = 18, className, strokeWidth = 1.75 }) {
  return (
    <svg
      className={className}
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth={strokeWidth}
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
    >
      {PATHS[name]}
    </svg>
  );
}
