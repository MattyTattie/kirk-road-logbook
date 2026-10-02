// =====================================================================
// icons.js — the little line icons used around the app.
// =====================================================================
// Each icon is a 24x24 SVG path drawn with "currentColor", so it takes the
// colour of the text around it. They are plain strings in this file — no
// icon font, no download, so they work offline and cost almost nothing.
//
//   icon('wrench')        -> <span class="ico">…svg…</span>
//   icon('bolt', 28)      -> same, 28px

const PATHS = {
  home: 'M3.5 10.2 12 3.5l8.5 6.7V19a1.5 1.5 0 0 1-1.5 1.5h-4.2v-6h-5.6v6H5A1.5 1.5 0 0 1 3.5 19z',
  list: 'M8 6h12M8 12h12M8 18h12M4 6h.01M4 12h.01M4 18h.01',
  plus: 'M12 5v14M5 12h14',
  bolt: 'M13 2.5 4.5 13.5h6.5l-1 8 8.5-11h-6.5z',
  wrench: 'M14.7 6.3a1 1 0 0 0 0 1.4l1.6 1.6a1 1 0 0 0 1.4 0l3.77-3.77a6 6 0 0 1-7.94 7.94l-6.91 6.91a2.12 2.12 0 0 1-3-3l6.91-6.91a6 6 0 0 1 7.94-7.94l-3.76 3.76z',
  receipt: 'M5.5 3h13v18l-2.6-1.6L13.3 21 12 20.2 10.7 21l-2.6-1.6L5.5 21zM9 8h6M9 12h6M9 16h3.5',
  shield: 'M12 3l7.5 2.8v5.7c0 4.6-3.2 8-7.5 9.5-4.3-1.5-7.5-4.9-7.5-9.5V5.8zM9 12l2.2 2.2L15.5 10',
  file: 'M14 3H6.5A1.5 1.5 0 0 0 5 4.5v15A1.5 1.5 0 0 0 6.5 21h11a1.5 1.5 0 0 0 1.5-1.5V8zM14 3v5h5',
  download: 'M12 3.5v11M7 10l5 5 5-5M5 20.5h14',
  upload: 'M12 15.5v-11M7 9l5-5 5 5M5 20.5h14',
  backup: 'M7 18.5a4.5 4.5 0 0 1-.6-8.96A6 6 0 0 1 18 8.5a4 4 0 0 1-.5 7.97M12 21v-8M9 16l3-3 3 3',
  search: 'M11 4a7 7 0 1 0 0 14 7 7 0 0 0 0-14zM20 20l-4-4',
  back: 'M15 18l-6-6 6-6',
  chevron: 'M9 18l6-6-6-6',
  calendar: 'M4.5 6.5A1.5 1.5 0 0 1 6 5h12a1.5 1.5 0 0 1 1.5 1.5V19a1.5 1.5 0 0 1-1.5 1.5H6A1.5 1.5 0 0 1 4.5 19zM4.5 10h15M8.5 3v4M15.5 3v4',
  clock: 'M12 3a9 9 0 1 0 0 18 9 9 0 0 0 0-18zM12 7.5V12l3 2',
  pencil: 'M4 20h4L19 9l-4-4L4 16zM13.5 6.5l4 4',
  trash: 'M4 7h16M9.5 7V4.5h5V7M6 7l1 13h10l1-13M10 11v5.5M14 11v5.5',
  camera: 'M4 8.5A1.5 1.5 0 0 1 5.5 7h2.8l1.7-2.5h4L15.7 7h2.8A1.5 1.5 0 0 1 20 8.5v10a1.5 1.5 0 0 1-1.5 1.5h-13A1.5 1.5 0 0 1 4 18.5zM12 10a3.5 3.5 0 1 0 0 7 3.5 3.5 0 0 0 0-7z',
  image: 'M4.5 5.5h15v13h-15zM4.5 15.5l4.5-4.5 4 4 2.5-2.5 4 4M15.5 9h.01',
  printer: 'M7 9V3.5h10V9M7 17H5.5A1.5 1.5 0 0 1 4 15.5v-5A1.5 1.5 0 0 1 5.5 9h13a1.5 1.5 0 0 1 1.5 1.5v5a1.5 1.5 0 0 1-1.5 1.5H17M7 14h10v6.5H7z',
  alert: 'M12 3.5 2.5 20h19zM12 10v4.5M12 17.5h.01',
  sun: 'M12 8a4 4 0 1 0 0 8 4 4 0 0 0 0-8zM12 2.5v2M12 19.5v2M4.6 4.6 6 6M18 18l1.4 1.4M2.5 12h2M19.5 12h2M4.6 19.4 6 18M18 6l1.4-1.4',
  moon: 'M20 14.5A8 8 0 0 1 9.5 4a8 8 0 1 0 10.5 10.5z',
  auto: 'M12 3a9 9 0 1 0 0 18zM12 3a9 9 0 0 1 0 18',
  x: 'M6 6l12 12M18 6 6 18',
  check: 'M5 12.5l4.5 4.5L19 7.5',
  chart: 'M4 20h16M7 16.5v-5M12 16.5V7M17 16.5v-8',
  lock: 'M6 11h12v9.5H6zM8.5 11V8a3.5 3.5 0 0 1 7 0v3',
  phone: 'M8 2.5h8A1.5 1.5 0 0 1 17.5 4v16a1.5 1.5 0 0 1-1.5 1.5H8A1.5 1.5 0 0 1 6.5 20V4A1.5 1.5 0 0 1 8 2.5zM11 18h2',
  scan: 'M4 8V5.5A1.5 1.5 0 0 1 5.5 4H8M16 4h2.5A1.5 1.5 0 0 1 20 5.5V8M20 16v2.5a1.5 1.5 0 0 1-1.5 1.5H16M8 20H5.5A1.5 1.5 0 0 1 4 18.5V16M7.5 12h9M9 8.5h6M9 15.5h4',
  sparkle: 'M12 3l1.8 5.2L19 10l-5.2 1.8L12 17l-1.8-5.2L5 10l5.2-1.8zM19 15.5l.8 2.2 2.2.8-2.2.8-.8 2.2-.8-2.2-2.2-.8 2.2-.8z',
  umbrella: 'M3 12a9 9 0 0 1 18 0zM12 3v-.5M12 12v6.5a2 2 0 0 1-4 0',
  gauge: 'M4.5 17a8 8 0 1 1 15 0M12 13l3.5-4',
};

export function icon(name, size = 22) {
  const span = document.createElement('span');
  span.className = 'ico';
  span.setAttribute('aria-hidden', 'true');
  // Safe: PATHS are fixed strings from this file, never user data.
  span.innerHTML = `<svg viewBox="0 0 24 24" width="${size}" height="${size}" fill="none" stroke="currentColor" stroke-width="1.9" stroke-linecap="round" stroke-linejoin="round"><path d="${PATHS[name] || PATHS.file}"/></svg>`;
  return span;
}
