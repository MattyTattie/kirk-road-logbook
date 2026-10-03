// =====================================================================
// house.js — the "living" house picture at the top of the home screen.
// =====================================================================
// One simple, generic house seen straight on (v12): a single front wall,
// pitched roof, chimney, a door and four windows. Drawn as SVG so it's
// sharp, tiny and works offline.
// It reacts to your logbook:
//   • the sky follows the time of day: dawn, day, dusk, evening, and a
//     deep blue starry night from 22:00 to 05:00;
//   • the windows glow brighter when the latest electricity bill is above
//     your average, dimmer when it's below;
//   • a little flag flies on the roof when something is due within 30 days;
//   • a battery gauge beside the house, only once there's battery data
//     (a meter entry with "battery" in its title and the unit "%").
// Tap the flag → Coming up, a window → Electricity bills, the door → Logbook.
// Colours come from CSS (styles.css, "House picture") so dark mode works.

// Which sky? By the clock only: 'night' (22:00–05:00, stars), 'dawn',
// 'day', 'dusk', 'evening'.
export function skyPhase(date) {
  const h = date.getHours() + date.getMinutes() / 60;
  if (h >= 22 || h < 5) return 'night';
  if (h >= 5 && h < 8) return 'dawn';
  if (h >= 8 && h < 17) return 'day';
  if (h >= 17 && h < 20) return 'dusk';
  return 'evening';
}

// 0 (well below average) … 1 (well above). 0.5 = about average or no data.
export function glowLevel(latest, average) {
  if (!(latest > 0) || !(average > 0)) return 0.5;
  const r = latest / average; // 0.7 → 0, 1.0 → 0.5, 1.3 → 1
  return Math.round(Math.max(0, Math.min(1, (r - 0.7) / 0.6)) * 100) / 100;
}

const STARS = [[24, 36, 1.2], [58, 52, 0.9], [92, 32, 1.4], [130, 58, 0.8], [168, 38, 1.1], [205, 30, 0.9], [244, 48, 1.3], [282, 34, 0.8], [318, 56, 1.1], [342, 30, 0.9], [40, 76, 0.7], [300, 78, 0.7], [112, 80, 0.6], [228, 72, 0.6]];

/**
 * houseSVG({ phase, glow, due, battery, labels }) → SVG markup string.
 *   due:     number of things due within 30 days (0 = no flag)
 *   battery: null, or { pct: 0–100 }
 */
let uid = 0;
export function houseSVG({ phase = 'day', glow = 0.5, due = 0, battery = null } = {}) {
  const sky = `hb-sky-${++uid}`;
  const lit = phase !== 'day';
  // Window light: brighter with a bigger bill; faint by day.
  const glass = lit ? (0.38 + 0.62 * glow).toFixed(2) : (0.08 + 0.3 * glow).toFixed(2);
  const halo = lit ? (0.12 + 0.5 * glow).toFixed(2) : '0';
  const win = (x, y, w, h, i) => `
      <g class="hw-win" style="--d:${i}">
        <rect x="${x - 3}" y="${y - 3}" width="${w + 6}" height="${h + 6}" rx="3" class="hw-halo" opacity="${halo}"/>
        <rect x="${x}" y="${y}" width="${w}" height="${h}" rx="2" class="hw-frame"/>
        <rect x="${x + 2}" y="${y + 2}" width="${w - 4}" height="${h - 4}" rx="1" class="hw-glass"/>
        <rect x="${x + 2}" y="${y + 2}" width="${w - 4}" height="${h - 4}" rx="1" class="hw-light" opacity="${glass}"/>
        <path d="M${x + w / 2} ${y + 2}V${y + h - 2}M${x + 2} ${y + h / 2}H${x + w - 2}" class="hw-bars"/>
        <rect x="${x - 2}" y="${y + h}" width="${w + 4}" height="3" rx="1" class="hw-sill"/>
      </g>`;
  const pct = battery && isFinite(battery.pct) ? Math.max(0, Math.min(100, Math.round(battery.pct))) : null;
  return `<svg class="house-svg" viewBox="0 26 360 144" role="group" aria-label="Your house" data-phase="${phase}" xmlns="http://www.w3.org/2000/svg">
    <defs>
      <linearGradient id="${sky}" x1="0" y1="0" x2="0" y2="1">
        <stop offset="0" class="sky-top"/><stop offset="1" class="sky-bottom"/>
      </linearGradient>
    </defs>
    <rect width="360" height="190" fill="url(#${sky})" class="h-sky"/>
    <g class="h-stars" aria-hidden="true">${STARS.map(([x, y, r], i) => `<circle cx="${x}" cy="${y}" r="${r}" style="--d:${i % 5}"/>`).join('')}</g>
    <circle cx="118" cy="44" r="11" class="h-moon" aria-hidden="true"/><circle cx="123.5" cy="40" r="9" class="h-moon-cut" aria-hidden="true"/>
    <circle cx="62" cy="50" r="14" class="h-sun" aria-hidden="true"/>
    <path d="M0 150 C 60 128 120 140 180 134 S 300 124 360 140 V190 H0Z" class="h-hill" aria-hidden="true"/>
    <rect x="0" y="160" width="360" height="30" class="h-ground" aria-hidden="true"/>

    <!-- a simple tree on the left -->
    <g class="h-tree" aria-hidden="true"><rect x="70" y="128" width="5" height="32" rx="1" class="h-trunk"/><circle cx="72.5" cy="120" r="17" class="h-leaves"/><circle cx="62" cy="130" r="10" class="h-leaves"/><circle cx="83" cy="131" r="10" class="h-leaves"/></g>

    <!-- our house, straight on: one front wall, a pitched roof, a chimney -->
    <g class="h-home">
      <!-- chimney (drawn first so the roof overlaps its foot) -->
      <rect x="214" y="44" width="15" height="40" class="h-chimney"/><rect x="212" y="41" width="19" height="5" class="h-chimney-top"/>
      <g class="h-smoke" aria-hidden="true"><circle cx="223" cy="35" r="3"/><circle cx="230" cy="37" r="3.6"/><circle cx="237" cy="39" r="4.2"/></g>
      <rect x="122" y="90" width="116" height="70" class="h-wall"/>
      <path d="M110 93 L180 50 L250 93Z" class="h-roof"/>
      <path d="M108 94 L180 49 L252 94" class="h-ridge" fill="none"/>
      <rect x="122" y="90" width="116" height="3" class="h-band"/>
    </g>

    <g class="h-path" aria-hidden="true"><path d="M170 161 L156 190 H204 L190 161Z"/></g>
    <g class="h-bushes" aria-hidden="true"><circle cx="128" cy="158" r="8"/><circle cx="232" cy="158" r="8"/><circle cx="242" cy="160" r="6"/></g>

    <a href="#/list/all" class="h-part h-door" aria-label="Front door: logbook">
      <title>Logbook</title>
      <rect x="168" y="124" width="24" height="36" rx="11" ry="11" class="h-door-arch"/>
      <rect x="168" y="138" width="24" height="22" class="h-door-arch"/>
      <rect x="172" y="128" width="16" height="32" rx="8" class="h-door-panel"/>
      <circle cx="184" cy="145" r="1.8" class="h-knob"/>
      <rect x="164" y="158" width="32" height="3" rx="1" class="h-step"/>
    </a>
    <rect width="360" height="190" class="h-shade" aria-hidden="true" pointer-events="none"/>
    <a href="#/list/meter" class="h-part h-windows" aria-label="Windows: electricity bills">
      <title>Electricity bills</title>
      ${win(134, 98, 26, 20, 0)}${win(200, 98, 26, 20, 1)}${win(134, 128, 26, 22, 2)}${win(200, 128, 26, 22, 3)}
    </a>
    ${due ? `<a href="#coming-up" class="h-part h-flag" data-due="${due}" aria-label="Flag: ${due} thing${due === 1 ? '' : 's'} due within 30 days">
      <title>Coming up</title>
      <rect x="134" y="28" width="38" height="46" fill="#000" fill-opacity="0" class="h-hit"/>
      <rect x="142" y="36" width="2.4" height="36" class="h-pole"/>
      <path d="M144.4 37 C 152 34 156 42 166 39 V51 C 156 54 152 46 144.4 49Z" class="h-flag-cloth"/>
      <text x="152" y="47.5" class="h-flag-num" aria-hidden="true">${due > 9 ? '9+' : due}</text>
    </a>` : ''}

    ${pct !== null ? `<g class="h-battery" id="house-battery" aria-label="Home battery ${pct}%" role="img">
      <rect x="262" y="124" width="16" height="30" rx="3" class="hb-case"/><rect x="267" y="121" width="6" height="4" rx="1" class="hb-case"/>
      <rect x="265" y="${127 + 24 * (1 - pct / 100)}" width="10" height="${24 * pct / 100}" rx="1.5" class="hb-fill"/>
    </g>` : '<g class="h-battery" id="house-battery" hidden></g>'}
  </svg>`;
}
