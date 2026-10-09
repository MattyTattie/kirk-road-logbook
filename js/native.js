// =====================================================================
// native.js — phone reminders in the installed Android app (v12).
// =====================================================================
// A web page can't run while it's closed, so the Android app (app-v13+)
// has a little native part that checks once a day (about 08:30) and posts
// notifications 30 days and 7 days before, and on the day of, each
// renewal / warranty expiry / job due date — even when Hearthbook is shut.
//
// The native part can't read this page's database, so we hand it a short
// list of upcoming dates ("bridge"): we open
//   intent://reminders?d=<list>#Intent;scheme=hearthbook;package=…;end
// which Android passes to the app's ReminderBridgeActivity. It saves the
// list, books the daily check, asks for notification permission if needed
// and closes straight away. Chrome only lets a page do this straight after
// a tap, so we send right after a tap whenever the list has changed.
//
// When the app starts it tells us what it holds by adding ?hbv=13&hbn=<hash>
// &hbp=1 to the address (LauncherActivity.java); we note that and tidy the
// address. Nothing here goes over the internet.
//
// Only inside the installed app (not in a normal Chrome tab), and only
// after you've turned phone reminders on.

const PKG = 'io.github.mattytattie.hearthbook';
const K_APP = 'hearthbook.app';         // "yes" once we've seen we're inside the Android app
const K_ON = 'hearthbook.native.on';    // "on" after you turned phone reminders on
const K_SENT = 'hearthbook.native.sent'; // { h, at } last list handed over
const K_SEEN = 'hearthbook.native.seen'; // { h, perm, v, at } what the app said it holds
const WORD = { insurance: 'renews', warranty: 'expires', job: 'is due' };

const get = (k) => { try { return localStorage.getItem(k); } catch { return null; } };
const set = (k, v) => { try { localStorage.setItem(k, v); } catch {} };
const getJSON = (k) => { try { return JSON.parse(get(k) || 'null'); } catch { return null; } };

// Read (and remove) what the app put in the address.
export function readLaunch(loc = location) {
  try {
    const u = new URL(loc.href);
    const v = u.searchParams.get('hbv');
    if (document.referrer && document.referrer.startsWith('android-app://' + PKG)) set(K_APP, 'yes');
    if (!v) return null;
    set(K_APP, 'yes');
    const seen = { v: Number(v) || 0, h: u.searchParams.get('hbn') || '', perm: u.searchParams.get('hbp') === '1', at: new Date().toISOString() };
    set(K_SEEN, JSON.stringify(seen));
    ['hbv', 'hbn', 'hbp'].forEach((p) => u.searchParams.delete(p));
    history.replaceState(history.state, '', u.pathname + (u.search || '') + u.hash);
    return seen;
  } catch { return null; }
}

export const inApp = () => get(K_APP) === 'yes';
export const isOn = () => get(K_ON) === 'on';
export const seen = () => getJSON(K_SEEN);
export const lastSent = () => getJSON(K_SENT);
export function setOn(on) { set(K_ON, on ? 'on' : 'off'); }

// Phone reminders confirmed working: the app holds the latest list and may notify.
export function active() {
  const s = seen();
  return Boolean(inApp() && isOn() && s && s.v >= 13 && s.h && s.perm);
}

// Small, stable hash so we can tell when the list changed.
function hash(str) {
  let h = 5381;
  for (let i = 0; i < str.length; i++) h = ((h << 5) + h + str.charCodeAt(i)) | 0;
  return (h >>> 0).toString(36);
}

const dayNum = (iso) => { const [y, m, d] = iso.split('-').map(Number); return Date.UTC(y, m - 1, d) / 86400000; };

/** The compact list for the app: dated renewals / expiries / jobs from today up to ~13 months ahead. */
export function payload(entries, now = new Date(), notified = {}) {
  const today = Date.UTC(now.getFullYear(), now.getMonth(), now.getDate()) / 86400000;
  const items = entries
    .filter((e) => WORD[e.type] && /^\d{4}-\d\d-\d\d/.test(e.dueDate || ''))
    .map((e) => ({ i: String(e.id).slice(0, 80), t: String(e.title || 'Entry').slice(0, 60), d: e.dueDate.slice(0, 10), w: WORD[e.type] }))
    .filter((x) => { const n = dayNum(x.d) - today; return n >= 0 && n <= 400; })
    .sort((a, b) => a.d.localeCompare(b.d) || a.i.localeCompare(b.i))
    .slice(0, 80);
  const h = hash(JSON.stringify(items));
  // Reminders this page already showed (same keys as the app uses), so they aren't repeated.
  const n = Object.keys(notified).filter((k) => items.some((x) => k.startsWith(x.i + '|' + x.d + '|'))).slice(0, 200);
  return { v: 1, h, items, n };
}

export function intentUrl(p) {
  return `intent://reminders?d=${encodeURIComponent(JSON.stringify(p))}#Intent;scheme=hearthbook;package=${PKG};end`;
}

/** Hand the list to the app. Must run during / just after a tap. */
export function send(p) {
  set(K_SENT, JSON.stringify({ h: p.h, at: new Date().toISOString(), count: p.items.length }));
  const a = document.createElement('a');
  a.href = intentUrl(p);
  a.rel = 'noopener';
  a.style.display = 'none';
  document.body.append(a);
  a.click();
  a.remove();
}

/** Status line for Settings. */
export function statusText() {
  const s = seen(), sent = lastSent();
  if (!isOn()) return null;
  if (s && s.v >= 13 && !s.perm) return 'Notifications are switched off for the app. Allow them in Android Settings → Apps → Hearthbook (the app’s name on Android for now) → Notifications.';
  if (active() && sent && s.h === sent.h) return `✓ Phone reminders are on: the app checks every morning at about 08:30, even when Hearth is closed (${sent.count} date${sent.count === 1 ? '' : 's'}).`;
  if (sent) return `Dates handed to the app ${new Date(sent.at).toLocaleString('en-GB', { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' })}. This shows ✓ next time you open Hearth.`;
  return 'Phone reminders will start after the next tap.';
}

// After a tap, if phone reminders are on and the dates changed, send them.
export function autoSync(getEntries, getNotified) {
  let busy = false;
  let last = 0;
  document.addEventListener('click', () => {
    if (!inApp() || !isOn() || busy || Date.now() - last < 1000) return;
    busy = true;
    last = Date.now();
    getEntries().then((entries) => {
      const p = payload(entries, new Date(), getNotified());
      const sent = lastSent();
      const s = seen();
      // Changed since we last sent, or the app started after our last send and
      // still holds a different list (the hand-over didn't arrive, or reinstalled).
      const stale = s && s.h !== p.h && new Date(s.at) > new Date(sent ? sent.at : 0);
      if (!sent || sent.h !== p.h || stale) setTimeout(() => send(p), 250);
    }).catch(() => {}).finally(() => { busy = false; });
  }, true);
}
