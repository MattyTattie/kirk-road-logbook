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
//   • v14: the local weather (weather.js): clouds, rain, snow, fog or a
//     storm when that's what it's doing; stars and the moon on a clear
//     night; the windows glow and light the garden after dark; chimney
//     smoke drifts up, and blows sideways when it's windy. Day and night
//     follow the real sunrise and sunset (sunPhase in weather.js).
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

// Fixed spots (so the picture never jumps about between redraws).
const RAIN = Array.from({ length: 22 }, (_, i) => [6 + ((i * 61) % 348), 30 + ((i * 37) % 96), ((i * 7) % 10) / 10]);
const SNOW = Array.from({ length: 20 }, (_, i) => [8 + ((i * 67) % 344), 28 + ((i * 41) % 110), ((i * 3) % 10) / 10, 1.1 + ((i * 5) % 4) * 0.3]);
const cloud = (x, y, s, cls) => `<g class="h-cloud ${cls}" style="--cx:${x}px"><g transform="translate(${x} ${y}) scale(${s})"><ellipse cx="0" cy="6" rx="26" ry="9"/><circle cx="-10" cy="1" r="10"/><circle cx="6" cy="-3" r="13"/><circle cx="20" cy="3" r="8"/></g></g>`;

/**
 * houseSVG({ phase, glow, due, battery, weather, moon }) → SVG markup string.
 *   due:     number of things due within 30 days (0 = no flag)
 *   battery: null, or { pct: 0–100 }
 *   weather: null (= clear), or { cond: 'clear'|'partly'|'cloudy'|'fog'|'rain'|'snow'|'storm', windy }
 *   moon:    0–1 moon age (0/1 new, 0.5 full); null = no moon
 */
let uid = 0;
export function houseSVG({ phase = 'day', glow = 0.5, due = 0, battery = null, weather = null, moon = 0.35 } = {}) {
  const id = ++uid;
  const sky = `hb-sky-${id}`;
  const lit = phase !== 'day';
  const dark = phase === 'night' || phase === 'evening';
  const cond = (weather && weather.cond) || 'clear';
  const windy = Boolean(weather && weather.windy);
  const clearSky = cond === 'clear' || cond === 'partly';
  // Window light: brighter with a bigger bill; faint by day. After dark it
  // also spills onto the garden (v14: stronger night glow).
  const glass = lit ? (0.68 + 0.32 * glow).toFixed(2) : (0.08 + 0.3 * glow).toFixed(2);
  const halo = lit ? (0.25 + 0.55 * glow).toFixed(2) : '0';
  const spill = dark ? (0.18 + 0.3 * glow).toFixed(2) : phase === 'dusk' || phase === 'dawn' ? '0.08' : '0';
  const win = (x, y, w, h, i) => `
      <g class="hw-win" style="--d:${i}">
        <rect x="${x - 4}" y="${y - 4}" width="${w + 8}" height="${h + 8}" rx="4" class="hw-halo" opacity="${halo}"/>
        <rect x="${x}" y="${y}" width="${w}" height="${h}" rx="2" class="hw-frame"/>
        <rect x="${x + 2}" y="${y + 2}" width="${w - 4}" height="${h - 4}" rx="1" class="hw-glass"/>
        <rect x="${x + 2}" y="${y + 2}" width="${w - 4}" height="${h - 4}" rx="1" class="hw-light" opacity="${glass}"/>
        <path d="M${x + w / 2} ${y + 2}V${y + h - 2}M${x + 2} ${y + h / 2}H${x + w - 2}" class="hw-bars"/>
        <rect x="${x - 2}" y="${y + h}" width="${w + 4}" height="3" rx="1" class="hw-sill"/>
      </g>`;
  const pct = battery && isFinite(battery.pct) ? Math.max(0, Math.min(100, Math.round(battery.pct))) : null;
  // Stars on a clear (or partly clear) dark night; fewer through broken cloud.
  const stars = dark && clearSky ? STARS.filter((_, i) => cond === 'clear' || i % 2 === 0) : [];
  // The moon: a lit disc with the shadow sliding across it (waxing = lit on the right).
  const age = moon === null || moon === undefined ? null : ((Number(moon) % 1) + 1) % 1;
  const showMoon = lit && phase !== 'dawn' && clearSky && age !== null && age > 0.035 && age < 0.965;
  const mx = 296, my = 46, mr = 10;
  const shift = age === null ? 0 : age <= 0.5 ? -2 * mr * (age / 0.5) : 2 * mr * ((1 - age) / 0.5);
  const moonSVG = showMoon ? `<g class="h-moon-g" aria-hidden="true"><clipPath id="hb-moon-${id}"><circle cx="${mx}" cy="${my}" r="${mr}"/></clipPath>
      <circle cx="${mx}" cy="${my}" r="${mr + 5}" class="h-moon-halo"/><circle cx="${mx}" cy="${my}" r="${mr}" class="h-moon"/>
      ${Math.abs(shift) < 2 * mr - 0.5 ? `<circle cx="${(mx + shift).toFixed(1)}" cy="${my}" r="${mr + 0.6}" class="h-moon-shadow" clip-path="url(#hb-moon-${id})"/>` : ''}</g>` : '';
  const clouds = cond === 'clear' ? ''
    : cond === 'partly' ? cloud(250, 50, 0.8, 'c1') + cloud(60, 64, 0.6, 'c2')
    : cloud(70, 46, 1, 'c1') + cloud(196, 38, 1.15, 'c2') + cloud(310, 52, 0.95, 'c3') + (cond === 'fog' ? '' : cloud(130, 62, 0.7, 'c4'));
  const rain = cond === 'rain' || cond === 'storm'
    ? `<g class="h-rain" aria-hidden="true">${RAIN.map(([x, y, d]) => `<line x1="${x}" y1="${y}" x2="${x - (windy ? 4 : 1)}" y2="${y + 8}" style="--d:${d}"/>`).join('')}</g>` : '';
  const snow = cond === 'snow'
    ? `<g class="h-snow" aria-hidden="true">${SNOW.map(([x, y, d, r]) => `<circle cx="${x}" cy="${y}" r="${r}" style="--d:${d}"/>`).join('')}</g>` : '';
  const fog = cond === 'fog' ? '<g class="h-fog" aria-hidden="true"><rect x="-40" y="118" width="440" height="16" rx="8"/><rect x="-60" y="140" width="460" height="14" rx="7"/></g>' : '';
  const flash = cond === 'storm' ? '<rect width="360" height="190" class="h-flash" aria-hidden="true" pointer-events="none"/>' : '';
  return `<svg class="house-svg" viewBox="0 26 360 144" role="group" aria-label="Your house" data-phase="${phase}" data-weather="${cond}" data-windy="${windy}" xmlns="http://www.w3.org/2000/svg">
    <defs>
      <linearGradient id="${sky}" x1="0" y1="0" x2="0" y2="1">
        <stop offset="0" class="sky-top"/><stop offset="1" class="sky-bottom"/>
      </linearGradient>
      <radialGradient id="hb-spill-${id}"><stop offset="0" class="spill-in"/><stop offset="1" class="spill-out"/></radialGradient>
    </defs>
    <rect width="360" height="190" fill="url(#${sky})" class="h-sky"/>
    <g class="h-stars" aria-hidden="true">${stars.map(([x, y, r], i) => `<circle cx="${x}" cy="${y}" r="${r}" style="--d:${i % 5}"/>`).join('')}</g>
    <circle cx="62" cy="50" r="14" class="h-sun" aria-hidden="true"/>
    <g class="h-clouds" aria-hidden="true">${clouds}</g>
    <path d="M0 150 C 60 128 120 140 180 134 S 300 124 360 140 V190 H0Z" class="h-hill" aria-hidden="true"/>
    <rect x="0" y="160" width="360" height="30" class="h-ground" aria-hidden="true"/>
    <ellipse cx="180" cy="166" rx="92" ry="14" fill="url(#hb-spill-${id})" class="h-spill" opacity="${spill}" aria-hidden="true"/>

    <!-- a simple tree on the left -->
    <g class="h-tree" aria-hidden="true"><rect x="70" y="128" width="5" height="32" rx="1" class="h-trunk"/><circle cx="72.5" cy="120" r="17" class="h-leaves"/><circle cx="62" cy="130" r="10" class="h-leaves"/><circle cx="83" cy="131" r="10" class="h-leaves"/></g>

    <!-- our house, straight on: one front wall, a pitched roof, a chimney -->
    <g class="h-home">
      <!-- chimney smoke (behind the chimney pot), then the chimney -->
      <g class="h-smoke${windy ? ' windy' : ''}" aria-hidden="true">${[0, 1, 2, 3, 4].map((i) => `<circle cx="222" cy="38" r="${3 + i * 0.5}" style="--d:${i}"/>`).join('')}</g>
      <rect x="214" y="44" width="15" height="40" class="h-chimney"/><rect x="212" y="41" width="19" height="5" class="h-chimney-top"/>
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
    ${moonSVG}
    <circle cx="180" cy="119" r="2.2" class="h-lamp" aria-hidden="true" pointer-events="none"/>
    <a href="#/list/meter" class="h-part h-windows" aria-label="Windows: electricity bills">
      <title>Electricity bills</title>
      ${win(134, 98, 26, 20, 0)}${win(200, 98, 26, 20, 1)}${win(134, 128, 26, 22, 2)}${win(200, 128, 26, 22, 3)}
    </a>
    <g class="h-weather" pointer-events="none">${fog}${rain}${snow}${flash}</g>
    ${due ? `<a href="#coming-up" class="h-part h-flag" data-due="${due}" aria-label="Flag: ${due} thing${due === 1 ? '' : 's'} due within 30 days">
      <title>Coming up</title>
      <rect x="134" y="28" width="38" height="46" fill="#000" fill-opacity="0" class="h-hit"/>
      <rect x="142" y="36" width="2.4" height="36" class="h-pole"/>
      <path d="M144.4 37 C 152 34 156 42 166 39 V51 C 156 54 152 46 144.4 49Z" class="h-flag-cloth${windy ? ' windy' : ''}"/>
      <text x="152" y="47.5" class="h-flag-num" aria-hidden="true">${due > 9 ? '9+' : due}</text>
    </a>` : ''}

    ${pct !== null ? `<g class="h-battery" id="house-battery" aria-label="Home battery ${pct}%" role="img">
      <rect x="262" y="124" width="16" height="30" rx="3" class="hb-case"/><rect x="267" y="121" width="6" height="4" rx="1" class="hb-case"/>
      <rect x="265" y="${127 + 24 * (1 - pct / 100)}" width="10" height="${24 * pct / 100}" rx="1.5" class="hb-fill"/>
    </g>` : '<g class="h-battery" id="house-battery" hidden></g>'}
  </svg>`;
}
