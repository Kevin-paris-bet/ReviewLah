// Small inline icons (24 × 24, stroke). No icon library: the dashboard ships almost no JavaScript.
const PATHS = {
  home: 'M3 11.5 12 4l9 7.5M5.5 10v9.5h13V10M10 19.5v-5h4v5',
  chart: 'M4 20V10M10 20V4M16 20v-8M22 20H2',
  compare: 'M7 4v16M17 4v16M3 8l4-4 4 4M13 16l4 4 4-4',
  link: 'M10 14a4 4 0 0 0 5.66 0l3-3a4 4 0 0 0-5.66-5.66l-1 1M14 10a4 4 0 0 0-5.66 0l-3 3a4 4 0 0 0 5.66 5.66l1-1',
  card: 'M3 6.5h18v11H3zM3 10.5h18M7 14.5h4',
  user: 'M12 12a4 4 0 1 0 0-8 4 4 0 0 0 0 8ZM4.5 20a7.5 7.5 0 0 1 15 0',
  help: 'M12 21a9 9 0 1 0 0-18 9 9 0 0 0 0 18ZM9.5 9.5a2.5 2.5 0 1 1 3.6 2.2c-.7.4-1.1.9-1.1 1.8M12 16.8v.2',
  star: 'm12 3.5 2.6 5.4 5.9.8-4.3 4.1 1 5.9L12 16.9l-5.2 2.8 1-5.9-4.3-4.1 5.9-.8Z',
  plate: 'M5 3.5h14a1.5 1.5 0 0 1 1.5 1.5v14A1.5 1.5 0 0 1 19 20.5H5A1.5 1.5 0 0 1 3.5 19V5A1.5 1.5 0 0 1 5 3.5ZM8 8h3v3H8zM13 8h3M13 11h3M8 14h8M8 16.5h5',
  external: 'M14 4h6v6M20 4l-9 9M18 13.5V19a1 1 0 0 1-1 1H5a1 1 0 0 1-1-1V7a1 1 0 0 1 1-1h5.5',
  download: 'M12 4v11M7.5 10.5 12 15l4.5-4.5M4.5 19.5h15',
  settings: 'M12 15a3 3 0 1 0 0-6 3 3 0 0 0 0 6ZM19 12a7 7 0 0 0-.1-1.2l2-1.5-2-3.4-2.3.9a7 7 0 0 0-2-1.2L14.2 3h-4l-.4 2.6a7 7 0 0 0-2 1.2l-2.3-.9-2 3.4 2 1.5a7 7 0 0 0 0 2.4l-2 1.5 2 3.4 2.3-.9a7 7 0 0 0 2 1.2l.4 2.6h4l.4-2.6a7 7 0 0 0 2-1.2l2.3.9 2-3.4-2-1.5c.1-.4.1-.8.1-1.2Z',
  whatsapp: 'M4 20l1.3-4.2A8 8 0 1 1 8.4 19ZM9 8.5c0 3 3.5 6.5 6.5 6.5l1.2-1.5-2-1.2-.9.8c-1-.5-1.9-1.4-2.4-2.4l.8-.9-1.2-2Z',
  menu: 'M6 3.5h12v17H6zM9 8h6M9 12h6M9 16h4',
  calendar: 'M4 6.5h16v13.5H4zM4 10.5h16M8 4v4M16 4v4',
  phone: 'M6.5 3.5h3l1.5 4-2 1.5a11 11 0 0 0 6 6l1.5-2 4 1.5v3a2 2 0 0 1-2 2A15.5 15.5 0 0 1 4.5 5.5a2 2 0 0 1 2-2Z',
  mail: 'M3.5 6h17v12h-17zM3.5 7l8.5 6.5L20.5 7',
  globe: 'M12 21a9 9 0 1 0 0-18 9 9 0 0 0 0 18ZM3 12h18M12 3c2.5 2.5 3.8 5.6 3.8 9s-1.3 6.5-3.8 9c-2.5-2.5-3.8-5.6-3.8-9S9.5 5.5 12 3Z',
  instagram: 'M7.5 3.5h9a4 4 0 0 1 4 4v9a4 4 0 0 1-4 4h-9a4 4 0 0 1-4-4v-9a4 4 0 0 1 4-4ZM12 15.5a3.5 3.5 0 1 0 0-7 3.5 3.5 0 0 0 0 7ZM17 6.8v.2',
  facebook: 'M14 8.5V7a1.5 1.5 0 0 1 1.5-1.5H17V3h-2.5A3.5 3.5 0 0 0 11 6.5v2H8.5V11H11v10h3V11h2.5l.5-2.5Z',
  tiktok: 'M14 3.5v11.5a3.5 3.5 0 1 1-3.5-3.5M14 3.5c.3 2.5 2 4.2 4.5 4.5',
  check: 'm5 12.5 4.5 4.5L19 7.5',
  lock: 'M6 10.5h12v9.5H6zM8.5 10.5V8a3.5 3.5 0 0 1 7 0v2.5',
  arrow: 'M5 12h14M13 6l6 6-6 6',
};

export function Icon({ name, size }) {
  const d = PATHS[name] || PATHS.link;
  return (
    <svg
      viewBox="0 0 24 24"
      width={size}
      height={size}
      aria-hidden="true"
      focusable="false"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.8"
      strokeLinecap="round"
      strokeLinejoin="round"
    >
      <path d={d} />
    </svg>
  );
}

const LINK_ICONS = {
  menu: 'menu', whatsapp: 'whatsapp', booking: 'calendar', instagram: 'instagram', facebook: 'facebook',
  tiktok: 'tiktok', website: 'globe', phone: 'phone', email: 'mail', other: 'link',
};

export function linkIcon(kind) {
  return LINK_ICONS[kind] || 'link';
}
