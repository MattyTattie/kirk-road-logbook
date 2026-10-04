// =====================================================================
// rooms.js — rooms you can tag things to (v13).
// =====================================================================
// A room is just a name ("Kitchen", "Becca's office"). An entry (job,
// receipt, warranty) can carry ONE room in an optional `room` field. That
// field travels with the entry everywhere (sync file, backups) exactly like
// its notes do, and older versions of the app simply ignore it (they keep
// it when they save, because the form copies every field it doesn't know).
//
// The list of room names lives in this phone's settings (meta "rooms").
// The rooms used by entries are always shown too, so a room your partner
// tagged on their phone appears here after a sync.
//
// Manuals can be in one or more rooms. The built-in ones come pre-tagged
// (manuals.js `rooms`); a change is kept per phone (meta "manualRooms").
// Manuals you add yourself keep their rooms with them (usermanuals.js).
//
// Deleting a room only removes the tag; it never deletes an entry.
// Pure helpers are at the top so they can be tested with Node.

export const DEFAULT_ROOMS = ['Kitchen', 'Living room', 'Bedroom', 'Bathroom', 'Hall', 'Garage', 'Shed', 'Outside'];
export const ROOMS_KEY = 'rooms';
export const MANUAL_ROOMS_KEY = 'manualRooms';
// Sections that can be tagged to a room (insurance and bills are whole-house).
export const ROOM_TYPES = ['job', 'receipt', 'warranty'];

export const cleanName = (s) => String(s || '').replace(/\s+/g, ' ').trim().slice(0, 40);
const same = (a, b) => cleanName(a).toLowerCase() === cleanName(b).toLowerCase();

/** The rooms to show: this phone's list (or the defaults), then any room
 *  an entry or manual uses that isn't in it. No duplicates (case-blind). */
export function roomList(stored, entries = [], extra = []) {
  const base = Array.isArray(stored) ? stored : DEFAULT_ROOMS;
  const out = [];
  const add = (n) => { const c = cleanName(n); if (c && !out.some((x) => same(x, c))) out.push(c); };
  base.forEach(add);
  for (const e of entries) if (e && e.room) add(e.room);
  extra.forEach(add);
  return out;
}

/** Entries in a room (case-blind). */
export const inRoom = (entries, room) => entries.filter((e) => e.room && same(e.room, room));

/** Tag several entries to one room. Returns only the ones that changed,
 *  with a new updatedAt (so the change syncs). room '' = untag. */
export function tagMany(entries, ids, room, now = new Date().toISOString()) {
  const want = new Set(ids);
  const r = cleanName(room);
  const out = [];
  for (const e of entries) {
    if (!want.has(e.id)) continue;
    if ((e.room || '') === r) continue;
    const next = { ...e, updatedAt: now };
    if (r) next.room = r; else delete next.room;
    out.push(next);
  }
  return out;
}

/** Rename a room on every entry that uses it (changed entries only). */
export function renameOnEntries(entries, from, to, now = new Date().toISOString()) {
  const t = cleanName(to);
  return entries.filter((e) => e.room && same(e.room, from)).map((e) => ({ ...e, room: t, updatedAt: now }));
}
/** Remove a room from every entry that uses it (changed entries only). The entries stay. */
export function untagEntries(entries, room, now = new Date().toISOString()) {
  return entries.filter((e) => e.room && same(e.room, room)).map((e) => { const n = { ...e, updatedAt: now }; delete n.room; return n; });
}
/** Same for a { key: [rooms] } map (built-in manual tags). */
export function renameInMap(map, from, to) {
  const out = {};
  for (const [k, list] of Object.entries(map || {})) {
    const next = [];
    for (const r of list || []) { const v = same(r, from) ? cleanName(to) : r; if (v && !next.some((x) => same(x, v))) next.push(v); }
    out[k] = next;
  }
  return out;
}
export const removeFromMap = (map, room) => Object.fromEntries(Object.entries(map || {}).map(([k, list]) => [k, (list || []).filter((r) => !same(r, room))]));

/** Built-in manual → its rooms on this phone (override, else the default). */
export const manualRoomsOf = (appliance, overrides) => (overrides && Array.isArray(overrides[appliance.id]) ? overrides[appliance.id] : appliance.rooms || []);
export const hasRoom = (list, room) => (list || []).some((r) => same(r, room));
export { same as sameRoom };

// ---------- stored on this phone ----------
import * as db from './db.js';
export async function getStored() { return (await db.getMeta(ROOMS_KEY)) || null; }
export async function setStored(list) { await db.setMeta(ROOMS_KEY, list.map(cleanName).filter(Boolean)); }
export async function getManualRooms() { return (await db.getMeta(MANUAL_ROOMS_KEY)) || {}; }
export async function setManualRooms(map) { await db.setMeta(MANUAL_ROOMS_KEY, map); }
