// =====================================================================
// weather.js — the weather and sky for the house picture (v14).
// =====================================================================
// • WHERE: set on each phone (More → Appearance, or the one-time question on
//   the house card): "Use my location" or a town name. It's rounded to one
//   decimal place (an area about 10 km across) and kept in this phone's
//   settings (localStorage) only — never in the code, the shared sync file
//   or backups.
// • Until it's set: no weather requests at all; day and night use a rough
//   middle-of-the-UK position (country level only).
// • Sunrise / sunset and the moon's phase are worked out on the phone.
// • The weather comes from Open-Meteo (free, no account, no key), one small
//   request kept for 45 minutes. No signal? A plain sky — no complaints.
// Nothing here touches the logbook, backups or the sync file.

export const UK_DEFAULT = { lat: 54, lon: -2 }; // country level: roughly the middle of the UK
const PLACE_KEY = 'hearthbook.place';
const ASK_KEY = 'hearthbook.placeAsk';
export const round1 = (n) => Math.round(Number(n) * 10) / 10;
export function forecastUrl(place) {
  return `https://api.open-meteo.com/v1/forecast?latitude=${round1(place.lat)}&longitude=${round1(place.lon)}`
    + '&current=weather_code,cloud_cover,wind_speed_10m,wind_gusts_10m,temperature_2m&wind_speed_unit=mph&timezone=auto';
}
export const GEOCODE_URL = 'https://geocoding-api.open-meteo.com/v1/search';
const KEY = 'hearthbook.weather';
const OFF_KEY = 'hearthbook.weatherOff';
export const FRESH_MS = 45 * 60000; // re-ask after 45 minutes
export const STALE_MS = 3 * 3600000; // older than 3 hours: don't show it at all
const RETRY_MS = 10 * 60000; // after a failed ask, wait 10 minutes

const rad = Math.PI / 180;
const sin = (d) => Math.sin(d * rad), cos = (d) => Math.cos(d * rad);

/** Sunrise and sunset (Date objects) on the calendar day of `date`, for lat/lon. */
export function sunTimes(date, { lat, lon } = getPlace() || UK_DEFAULT) {
  const midnightUTC = Date.UTC(date.getFullYear(), date.getMonth(), date.getDate());
  const n = Math.ceil(midnightUTC / 86400000 + 2440587.5 - 2451545 + 0.0008);
  const J = n - lon / 360;
  const M = (357.5291 + 0.98560028 * J) % 360;
  const C = 1.9148 * sin(M) + 0.02 * sin(2 * M) + 0.0003 * sin(3 * M);
  const L = (M + C + 180 + 102.9372) % 360;
  const transit = 2451545 + J + 0.0053 * sin(M) - 0.0069 * sin(2 * L);
  const decl = Math.asin(sin(L) * sin(23.4397)) / rad;
  const cosW = (sin(-0.833) - sin(lat) * sin(decl)) / (cos(lat) * cos(decl));
  const w = Math.acos(Math.max(-1, Math.min(1, cosW))) / rad;
  const toDate = (jd) => new Date(Math.round((jd - 2440587.5) * 86400000));
  return { sunrise: toDate(transit - w / 360), sunset: toDate(transit + w / 360) };
}

/** Sky phase from the real sun: 'dawn' | 'day' | 'dusk' | 'evening' | 'night'. */
export function sunPhase(now = new Date(), times = sunTimes(now)) {
  const t = now.getTime(), m = 60000, rise = times.sunrise.getTime(), set = times.sunset.getTime();
  if (t < rise - 40 * m) return 'night';
  if (t < rise + 50 * m) return 'dawn';
  if (t < set - 60 * m) return 'day';
  if (t < set + 30 * m) return 'dusk';
  if (t < set + 100 * m) return 'evening';
  return 'night';
}

/** Moon age as a fraction: 0 = new, 0.5 = full, back to 1 = new. */
export function moonPhase(date = new Date()) {
  const p = ((date.getTime() - Date.UTC(2000, 0, 6, 18, 14)) / 86400000 / 29.530588853) % 1;
  return p < 0 ? p + 1 : p;
}

/** WMO weather code (what Open-Meteo sends) → a simple picture word. */
export function condition(code, cloud = null) {
  const c = Number(code);
  if (code === null || code === undefined || !isFinite(c)) return null;
  if (c >= 95) return 'storm';
  if ((c >= 71 && c <= 77) || c === 85 || c === 86) return 'snow';
  if ((c >= 51 && c <= 67) || (c >= 80 && c <= 82)) return 'rain';
  if (c === 45 || c === 48) return 'fog';
  if (c === 3) return 'cloudy';
  if (c === 2) return 'partly';
  if (c === 1) return cloud !== null && cloud > 50 ? 'partly' : 'clear';
  return 'clear';
}
/** Windy enough for the smoke to blow sideways: 20 mph+ (a "fresh breeze") or gusts of 35 mph+. */
export const isWindy = (wind, gust = 0) => Number(wind) >= 20 || Number(gust) >= 35;

/** Open-Meteo reply → { cond, code, cloud, wind, gust, windy, temp, at } or null. */
export function fromApi(json, now = new Date()) {
  const c = json && json.current;
  if (!c || c.weather_code === undefined || c.weather_code === null) return null;
  const cloud = isFinite(c.cloud_cover) ? Number(c.cloud_cover) : null;
  const wind = Number(c.wind_speed_10m) || 0, gust = Number(c.wind_gusts_10m) || 0;
  return { code: Number(c.weather_code), cond: condition(c.weather_code, cloud), cloud, wind, gust, windy: isWindy(wind, gust),
    temp: isFinite(c.temperature_2m) ? Number(c.temperature_2m) : null, at: now.getTime() };
}

/** Plain words for screen readers: "light rain, windy". */
export function describe(w) {
  if (!w || !w.cond) return '';
  const word = { clear: 'clear sky', partly: 'some cloud', cloudy: 'cloudy', fog: 'foggy', rain: 'rain', snow: 'snow', storm: 'thunderstorm' }[w.cond];
  return [word, w.windy ? 'windy' : ''].filter(Boolean).join(', ');
}

// ---------- the phone's copy (localStorage, not the logbook) ----------
const store = () => { try { return globalThis.localStorage || null; } catch { return null; } };
const readJSON = (k) => { try { const s = store(); const v = s && s.getItem(k); return v ? JSON.parse(v) : null; } catch { return null; } };
const writeJSON = (k, v) => { try { const s = store(); if (s) s.setItem(k, JSON.stringify(v)); } catch {} };

export const enabled = () => { try { const s = store(); return !(s && s.getItem(OFF_KEY) === 'yes'); } catch { return true; } };
export function setEnabled(on) { try { const s = store(); if (!s) return; if (on) s.removeItem(OFF_KEY); else { s.setItem(OFF_KEY, 'yes'); s.removeItem(KEY); } } catch {} }

/** The saved weather if it's recent enough to show (≤ 3 h), else null. Never asks the internet. */
export function cached(now = new Date()) {
  if (!enabled() || !getPlace()) return null;
  const c = readJSON(KEY);
  const w = c && c.w;
  return w && w.at && now.getTime() - w.at >= 0 && now.getTime() - w.at < STALE_MS ? w : null;
}

let inflight = null;
/**
 * Fresh weather: the saved copy if it's under 45 minutes old, otherwise one
 * request (8 s limit). Any failure gives back what's saved (or null) quietly.
 */
export function refresh({ now = new Date(), fetchFn = globalThis.fetch } = {}) {
  const place = getPlace();
  if (!place || !enabled() || typeof fetchFn !== 'function') return Promise.resolve(null); // no place set → never asks

  const c = readJSON(KEY) || {};
  if (c.w && now.getTime() - c.w.at >= 0 && now.getTime() - c.w.at < FRESH_MS) return Promise.resolve(c.w);
  if (inflight) return inflight; // already asking: share the answer
  if (c.tried && now.getTime() - c.tried >= 0 && now.getTime() - c.tried < RETRY_MS) return Promise.resolve(cached(now));
  if (globalThis.navigator && navigator.onLine === false) return Promise.resolve(cached(now));
  inflight = (async () => {
    writeJSON(KEY, { ...c, tried: now.getTime() });
    const ctrl = typeof AbortController === 'function' ? new AbortController() : null;
    const timer = ctrl ? setTimeout(() => ctrl.abort(), 8000) : null;
    try {
      const r = await fetchFn(forecastUrl(place), { signal: ctrl && ctrl.signal, cache: 'no-store', credentials: 'omit' });
      if (!r || !r.ok) throw new Error('weather ' + (r && r.status));
      const w = fromApi(await r.json(), now);
      if (!w) throw new Error('no weather');
      writeJSON(KEY, { w, tried: now.getTime() });
      return w;
    } catch {
      return cached(now);
    } finally {
      if (timer) clearTimeout(timer);
      inflight = null;
    }
  })();
  return inflight;
}

// ---------- where (this phone only) ----------
/** The phone's weather place { lat, lon, name } (rounded to 1 decimal), or null. */
export function getPlace() {
  const p = readJSON(PLACE_KEY);
  return p && isFinite(p.lat) && isFinite(p.lon) && Math.abs(p.lat) <= 90 && Math.abs(p.lon) <= 180 ? { lat: round1(p.lat), lon: round1(p.lon), name: String(p.name || '') } : null;
}
/** Save the place (rounded to ~10 km); clears the old weather so the new place shows. */
export function setPlace({ lat, lon, name = '' }) {
  if (!isFinite(lat) || !isFinite(lon)) throw new Error('No location');
  writeJSON(PLACE_KEY, { lat: round1(lat), lon: round1(lon), name: String(name).slice(0, 60) });
  try { const s = store(); if (s) { s.removeItem(KEY); s.setItem(ASK_KEY, 'done'); } } catch {}
  return getPlace();
}
export function clearPlace() { try { const s = store(); if (s) { s.removeItem(PLACE_KEY); s.removeItem(KEY); } } catch {} }
/** Show the one-time "Show your local weather?" question on the house card? */
export const shouldAsk = () => { try { const s = store(); return enabled() && !getPlace() && !(s && s.getItem(ASK_KEY)); } catch { return false; } };
export function dismissAsk() { try { const s = store(); if (s) s.setItem(ASK_KEY, 'no'); } catch {} }

/** "Use my location": the phone's position, rounded to 1 decimal before it's kept or sent anywhere. */
export function locate({ geo = globalThis.navigator && navigator.geolocation, timeout = 15000 } = {}) {
  return new Promise((resolve, reject) => {
    if (!geo) return reject(new Error('This phone can’t share its location here. Type a town instead.'));
    geo.getCurrentPosition(
      (pos) => resolve({ lat: round1(pos.coords.latitude), lon: round1(pos.coords.longitude) }),
      (err) => reject(new Error(err && err.code === 1 ? 'Location wasn’t allowed. You can type a town instead.' : 'Couldn’t get your location. Try again, or type a town.')),
      { enableHighAccuracy: false, maximumAge: 3600000, timeout });
  });
}

/** Open-Meteo geocoding reply → [{ name, area, lat, lon }] (rounded). Pure. */
export function placesFromApi(json) {
  return ((json && json.results) || []).filter((r) => isFinite(r.latitude) && isFinite(r.longitude)).slice(0, 6)
    .map((r) => ({ name: String(r.name || ''), area: [r.admin1, r.country].filter(Boolean).join(', '), lat: round1(r.latitude), lon: round1(r.longitude) }));
}
/** Town name → up to 6 matches (free, no key). UK first. */
export async function findTown(q, { fetchFn = globalThis.fetch } = {}) {
  const name = String(q || '').trim();
  if (name.length < 2) return [];
  const r = await fetchFn(`${GEOCODE_URL}?name=${encodeURIComponent(name)}&count=10&language=en&format=json`, { cache: 'no-store', credentials: 'omit' });
  if (!r || !r.ok) throw new Error('Couldn’t look that up just now. Check your signal and try again.');
  const all = placesFromApi(await r.json());
  return [...all.filter((p) => /United Kingdom/.test(p.area)), ...all.filter((p) => !/United Kingdom/.test(p.area))].slice(0, 6);
}
