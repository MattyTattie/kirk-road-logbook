// =====================================================================
// prefs.js — settings that belong to THIS phone only.
// =====================================================================
// Kept in localStorage, never in the logbook database, so they are not
// part of backups and never sync: each phone can hide or reorder sections,
// opt in to reminders, etc. without changing anyone else's phone.
//
//   hearthbook.sections   { order: ['meter', 'job', ...], hidden: ['job'] }
//   hearthbook.notify     "on" once you've switched reminders on
//   hearthbook.notified   { "<id>|<dueDate>|<30|7>": "2026-10-03" } reminders already shown
//   hearthbook.toured     "yes" once the first-run tour is finished or skipped

import { SECTIONS } from './sections.js';

const read = (k, fallback) => { try { const v = localStorage.getItem(k); return v === null ? fallback : JSON.parse(v); } catch { return fallback; } };
const write = (k, v) => { try { localStorage.setItem(k, JSON.stringify(v)); } catch {} };
const readRaw = (k, fallback = '') => { try { const v = localStorage.getItem(k); return v === null ? fallback : v; } catch { return fallback; } };
const writeRaw = (k, v) => { try { localStorage.setItem(k, v); } catch {} };

// ---------- sections: order + hidden ----------
const SEC_KEY = 'hearthbook.sections';
export function sectionPrefs() {
  const p = read(SEC_KEY, {}) || {};
  const ids = SECTIONS.map((s) => s.id);
  // Known ids in the saved order first, then any new sections at the end.
  const order = [...(Array.isArray(p.order) ? p.order.filter((id) => ids.includes(id)) : []), ...ids].filter((id, i, a) => a.indexOf(id) === i);
  const hidden = Array.isArray(p.hidden) ? p.hidden.filter((id) => ids.includes(id)) : [];
  return { order, hidden };
}
export function saveSectionPrefs({ order, hidden }) {
  write(SEC_KEY, { order: [...order], hidden: [...new Set(hidden)] });
  if (typeof dispatchEvent === 'function') dispatchEvent(new CustomEvent('hearthbook:prefs'));
}
// Sections in this phone's order (hidden ones left out unless asked).
export function orderedSections({ includeHidden = false } = {}) {
  const { order, hidden } = sectionPrefs();
  return order.map((id) => SECTIONS.find((s) => s.id === id)).filter((s) => s && (includeHidden || !hidden.includes(s.id)));
}
export const isHidden = (id) => sectionPrefs().hidden.includes(id);
export function setHidden(id, hide) {
  const p = sectionPrefs();
  p.hidden = hide ? [...p.hidden, id] : p.hidden.filter((x) => x !== id);
  saveSectionPrefs(p);
}
export function moveSection(id, toIndex) {
  const p = sectionPrefs();
  const from = p.order.indexOf(id);
  if (from < 0) return;
  p.order.splice(from, 1);
  p.order.splice(Math.max(0, Math.min(p.order.length, toIndex)), 0, id);
  saveSectionPrefs(p);
}
export function setOrder(order) { const p = sectionPrefs(); p.order = order; saveSectionPrefs(p); }

// (v10 had a "cheap overnight hours" setting for the house picture; v11
// dropped it, so tidy away its old key.)
try { localStorage.removeItem('hearthbook.cheap'); } catch {}

// ---------- reminders ----------
export const remindersOn = () => readRaw('hearthbook.notify') === 'on';
export const setRemindersOn = (on) => writeRaw('hearthbook.notify', on ? 'on' : 'off');
export const notifiedLog = () => read('hearthbook.notified', {}) || {};
export function markNotified(keys, today) {
  const log = notifiedLog();
  for (const k of keys) log[k] = today;
  // Forget entries older than a year so the list stays small.
  const cutoff = new Date(Date.now() - 366 * 86400000).toISOString().slice(0, 10);
  for (const [k, d] of Object.entries(log)) if (d < cutoff) delete log[k];
  write('hearthbook.notified', log);
}

// ---------- first-run tour ----------
export const toured = () => readRaw('hearthbook.toured') === 'yes';
export const markToured = () => writeRaw('hearthbook.toured', 'yes');

// v14 home screen: the tidy layout (house, tiles, Coming up, then one
// "Money & energy" card that opens on a tap) is the normal one. Unticking
// "Tidy home screen" under More brings back the v13.9 layout (everything
// shown, tour + Recent on home). Only this phone.
export const homeTidy = () => readRaw('hearthbook.homeLayout', 'tidy') !== 'full';
export const setHomeTidy = (on) => writeRaw('hearthbook.homeLayout', on ? 'tidy' : 'full');
export const monthOpen = () => readRaw('hearthbook.monthOpen') === 'yes';
export const setMonthOpen = (on) => writeRaw('hearthbook.monthOpen', on ? 'yes' : 'no');

// v14.5: Electricity page "After EDF credits" switch (this phone only).
export const afterCreditsOn = () => readRaw('hearthbook.afterCredits') === 'on';
export const setAfterCredits = (on) => writeRaw('hearthbook.afterCredits', on ? 'on' : 'off');
