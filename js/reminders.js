// =====================================================================
// reminders.js — "your car insurance renews in 7 days" notifications.
// =====================================================================
// Phones don't let a web app run in the background, so Hearthbook checks
// when you open it (or switch back to it): anything renewing, expiring or
// due within 30 days gets ONE notification at 30 days, ONE at 7 days and
// one on the day. (v12: in the installed Android app, its native part does
// this every morning even when Hearthbook is closed — see native.js.)
// Tapping the notification opens that entry (see sw.js "notificationclick").
// Only after you've switched reminders on (prefs.js), and only if the
// phone allowed notifications. We never ask for permission by ourselves.

import { remindersOn, notifiedLog, markNotified } from './prefs.js';
import * as native from './native.js';

export const WINDOW_DAYS = 30;
export const THRESHOLDS = [30, 7, 0];
const WORD = { insurance: 'renews', warranty: 'expires', job: 'is due' };

const dayDiff = (iso, now) => {
  const [y, m, d] = iso.split('-').map(Number);
  const a = Date.UTC(y, m - 1, d);
  const b = Date.UTC(now.getFullYear(), now.getMonth(), now.getDate());
  return Math.round((a - b) / 86400000);
};
const ukDate = (iso) => new Date(iso + 'T12:00:00').toLocaleDateString('en-GB', { day: 'numeric', month: 'long', year: 'numeric' });
const inDays = (n) => (n === 0 ? 'today' : n === 1 ? 'tomorrow' : `in ${n} days`);

// Pure: which notifications are due right now? (Easy to test.)
export function dueReminders(entries, now = new Date(), log = {}) {
  const out = [];
  for (const e of entries) {
    if (!WORD[e.type] || !e.dueDate || !/^\d{4}-\d\d-\d\d/.test(e.dueDate)) continue;
    const days = dayDiff(e.dueDate.slice(0, 10), now);
    if (days < 0 || days > WINDOW_DAYS) continue;
    const threshold = days === 0 ? 0 : days <= 7 ? 7 : 30;
    const key = `${e.id}|${e.dueDate}|${threshold}`;
    if (log[key]) continue;
    out.push({
      key, id: e.id, days, threshold,
      title: `${e.title || 'Entry'} ${WORD[e.type]} ${inDays(days)}`,
      body: `${WORD[e.type] === 'is due' ? 'Due' : WORD[e.type][0].toUpperCase() + WORD[e.type].slice(1)} on ${ukDate(e.dueDate.slice(0, 10))}. Tap to open it in Hearth.`,
      url: `./index.html#/view/${encodeURIComponent(e.id)}`,
    });
  }
  return out.sort((a, b) => a.days - b.days);
}

export const supported = () => typeof Notification !== 'undefined' && 'serviceWorker' in navigator;
export const permission = () => (supported() ? Notification.permission : 'unsupported');

// From a tap only: ask the phone for permission, then switch reminders on.
export async function enable() {
  if (!supported()) return 'unsupported';
  let p = Notification.permission;
  if (p === 'default') p = await Notification.requestPermission();
  if (p === 'granted') { const { setRemindersOn } = await import('./prefs.js'); setRemindersOn(true); }
  return p;
}
export async function disable() { const { setRemindersOn } = await import('./prefs.js'); setRemindersOn(false); }

// Show what's due (call on open / when the app becomes visible).
let checking = null;
export function check(getEntries, { force = false } = {}) {
  if (!remindersOn() || permission() !== 'granted') return Promise.resolve([]);
  // In the Android app with phone reminders confirmed, the app's own daily
  // check posts them (native.js), so don't show the same one twice.
  if (native.active() && !force) return Promise.resolve([]);
  checking = checking || (async () => {
    try {
      const due = dueReminders(await getEntries(), new Date(), notifiedLog());
      if (!due.length) return [];
      const reg = await navigator.serviceWorker.ready;
      for (const r of due) {
        await reg.showNotification(r.title, { body: r.body, tag: `hearthbook-${r.id}`, data: { url: r.url }, icon: './icons/icon-192.png', badge: './icons/icon-192.png' });
      }
      markNotified(due.map((r) => r.key), new Date().toISOString().slice(0, 10));
      return due;
    } catch (err) { console.warn('reminders:', err); return []; } finally { checking = null; }
  })();
  return checking;
}
