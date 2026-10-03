// =====================================================================
// house.js — the "living" house picture at the top of the home screen.
// =====================================================================
// A generic end-of-terrace house (gable end, chimney, roof window on the
// front slope), drawn as SVG so it's sharp, tiny and works offline.
// It reacts to your logbook:
//   • the sky follows the time of day, and turns deep blue with stars in
//     the cheap overnight hours (Settings → Cheap overnight hours);
//   • the windows glow brighter when the latest electricity bill is above
//     your average, dimmer when it's below;
//   • a little flag flies on the roof when something is due within 30 days;
//   • a battery gauge on the gable wall, only once there's battery data
//     (a meter entry with "battery" in its title and the unit "%").
// Tap the flag → Coming up, a window → Electricity bills, the door → Logbook.
// Colours come from CSS (styles.css, "House picture") so dark mode works.

import { inCheapHours } from './prefs.js';

// Which sky? 'night' (cheap hours: stars), 'dawn', 'day', 'dusk', 'evening'.
export function skyPhase(date, cheap) {
  const m = date.getHours() * 60 + date.getMinutes();
  if (inCheapHours(m, cheap)) return 'night';
  const h = m / 60;
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

const STARS = [[24, 18, 1.2], [58, 34, 0.9], [92, 14, 1.4], [130, 40, 0.8], [168, 20, 1.1], [205, 12, 0.9], [244, 30, 1.3], [282, 16, 0.8], [318, 38, 1.1], [342, 12, 0.9], [40, 58, 0.7], [300, 60, 0.7], [112, 62, 0.6], [228, 54, 0.6]];

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
  return `<svg class="house-svg" viewBox="0 0 360 190" role="group" aria-label="Your house" data-phase="${phase}" xmlns="http://www.w3.org/2000/svg">
    <defs>
      <linearGradient id="${sky}" x1="0" y1="0" x2="0" y2="1">
        <stop offset="0" class="sky-top"/><stop offset="1" class="sky-bottom"/>
      </linearGradient>
    </defs>
    <rect width="360" height="190" fill="url(#${sky})" class="h-sky"/>
    <g class="h-stars" aria-hidden="true">${STARS.map(([x, y, r], i) => `<circle cx="${x}" cy="${y}" r="${r}" style="--d:${i % 5}"/>`).join('')}</g>
    <circle cx="118" cy="30" r="12" class="h-moon" aria-hidden="true"/><circle cx="124" cy="25.5" r="10" class="h-moon-cut" aria-hidden="true"/>
    <circle cx="62" cy="44" r="16" class="h-sun" aria-hidden="true"/>
    <path d="M0 150 C 60 128 120 140 180 134 S 300 124 360 140 V190 H0Z" class="h-hill" aria-hidden="true"/>
    <rect x="0" y="160" width="360" height="30" class="h-ground" aria-hidden="true"/>

    <!-- the neighbour's half of the terrace (left) -->
    <g class="h-neighbour" aria-hidden="true">
      <path d="M40 96 L80 66 H150 V160 H40Z" class="hn-wall"/>
      <path d="M34 98 L80 62 H150 V70 H83 L42 102Z" class="hn-roof"/>
      <rect x="58" y="104" width="22" height="24" rx="2" class="hn-win"/><rect x="104" y="104" width="22" height="24" rx="2" class="hn-win"/>
      <rect x="58" y="134" width="22" height="20" rx="2" class="hn-win"/>
    </g>

    <!-- our house, seen from the front-left: front wall, front roof slope, gable end on the right -->
    <g class="h-home">
      <path d="M278 160 V88 L302 58 L322 79 V151Z" class="h-gable-side"/>
      <rect x="150" y="86" width="128" height="74" class="h-wall"/>
      <path d="M144 89 L166 55 H304 L282 89Z" class="h-roof"/>
      <path d="M282 89 L304 55 L326 81 L322 83 L304 61 L285 90Z" class="h-verge"/>
      <path d="M166 55 H304" class="h-ridge"/>
      <!-- chimney on the gable end -->
      <rect x="296" y="34" width="15" height="26" class="h-chimney"/><rect x="294" y="31" width="19" height="5" class="h-chimney-top"/>
      <g class="h-smoke" aria-hidden="true"><circle cx="304" cy="23" r="4"/><circle cx="309" cy="14" r="5"/><circle cx="302" cy="5" r="6"/></g>
      <!-- roof window (Velux style) on the front slope -->
      <path d="M206 63 H232 L227 79 H200Z" class="h-velux"/><path d="M209 65.5 H229 L225 76.5 H204Z" class="h-velux-glass"/>
      <rect x="150" y="122" width="128" height="3" class="h-band"/>
    </g>

    <g class="h-path" aria-hidden="true"><path d="M180 161 L164 190 H218 L202 161Z"/></g>
    <g class="h-bushes" aria-hidden="true"><circle cx="160" cy="158" r="9"/><circle cx="270" cy="157" r="10"/><circle cx="282" cy="160" r="7"/></g>

    <a href="#/list/all" class="h-part h-door" aria-label="Front door: logbook">
      <title>Logbook</title>
      <rect x="178" y="128" width="26" height="32" rx="12" ry="12" class="h-door-arch"/>
      <rect x="178" y="140" width="26" height="20" class="h-door-arch"/>
      <rect x="182" y="132" width="18" height="28" rx="9" class="h-door-panel"/>
      <circle cx="196" cy="147" r="1.8" class="h-knob"/>
      <rect x="174" y="158" width="34" height="3" rx="1" class="h-step"/>
    </a>
    <rect width="360" height="190" class="h-shade" aria-hidden="true" pointer-events="none"/>
    <a href="#/list/meter" class="h-part h-windows" aria-label="Windows: electricity bills">
      <title>Electricity bills</title>
      ${win(162, 94, 30, 22, 0)}${win(236, 94, 30, 22, 1)}${win(236, 130, 30, 22, 2)}
    </a>
    ${due ? `<a href="#coming-up" class="h-part h-flag" data-due="${due}" aria-label="Flag: ${due} thing${due === 1 ? '' : 's'} due within 30 days">
      <title>Coming up</title>
      <rect x="244" y="24" width="38" height="40" fill="#000" fill-opacity="0" class="h-hit"/>
      <rect x="252" y="30" width="2.4" height="30" class="h-pole"/>
      <path d="M254.4 31 C 262 28 266 36 276 33 V45 C 266 48 262 40 254.4 43Z" class="h-flag-cloth"/>
      <text x="262" y="41.5" class="h-flag-num" aria-hidden="true">${due > 9 ? '9+' : due}</text>
    </a>` : ''}

    ${pct !== null ? `<g class="h-battery" id="house-battery" aria-label="Home battery ${pct}%" role="img">
      <rect x="288" y="104" width="16" height="30" rx="3" class="hb-case"/><rect x="293" y="101" width="6" height="4" rx="1" class="hb-case"/>
      <rect x="291" y="${107 + 24 * (1 - pct / 100)}" width="10" height="${24 * pct / 100}" rx="1.5" class="hb-fill"/>
    </g>` : '<g class="h-battery" id="house-battery" hidden></g>'}
  </svg>`;
}
