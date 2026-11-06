// =====================================================================
// usermanuals.js — manuals you add yourself (v13).
// =====================================================================
// Pick a PDF on the phone (More → Manuals → Add a manual), or share one to
// Hearthbook from another app and choose "Keep as a manual". You give it a
// name, and can link it to entries (e.g. the dishwasher's warranty) and to
// rooms. It's saved inside the app's own storage, so it opens offline.
//
// v15.15: separate PDFs in the shared Drive folder; metadata syncs.
// v15.16: local PDF copies are optional. Sync shares the listing + Drive
// pointer; opening (or “Save on this phone”) fetches the PDF. “Remove from
// this phone” drops only the local copy. sharedmanuals.js handles pointers
// and last-write-wins delete markers. Backups still carry PDF bytes (fetched
// from Drive when needed). Meta keys and DB stay unchanged.

import * as db from './db.js';

export const LIST_KEY = 'userManuals';
export const fileKey = (id) => `userManualFile:${id}`;
export const TOMBS_KEY = 'userManualTombstones';
const notifyManualChange = () => dispatchEvent(new CustomEvent('hearthbook:manualchange'));
export const manualStamp = (m) => m.updatedAt || m.addedAt || '1970-01-01T00:00:00.000Z';
export function validRecord(m) {
  return Boolean(m && typeof m.id === 'string' && /^[a-zA-Z0-9_-]{1,160}$/.test(m.id) && !['__proto__','constructor','prototype'].includes(m.id) && typeof m.name === 'string' && Number.isFinite(Number(m.size)) && Number(m.size) > 0 && Number(m.size) <= MAX_BYTES && (!m.rooms || (Array.isArray(m.rooms) && m.rooms.every((r) => typeof r === 'string'))) && (!m.entryIds || (Array.isArray(m.entryIds) && m.entryIds.every((id) => typeof id === 'string'))));
}
export const MAX_BYTES = 60 * 1024 * 1024; // a sane limit per PDF

export async function list() { return (await db.getMeta(LIST_KEY)) || []; }
export async function get(id) { return (await list()).find((m) => m.id === id) || null; }
export async function getFile(id) { return (await db.getMeta(fileKey(id))) || null; }
export async function hasFile(id) { return Boolean(await getFile(id)); }
/** Keep a local offline copy (optional). Does not change shared Drive / metadata. */
export async function saveFile(id, blob) {
  if (!id || !blob || !blob.size) throw new Error('That file is empty.');
  if (blob.size > MAX_BYTES) throw new Error(`That PDF is too big to keep in the app (limit ${MAX_BYTES / 1048576} MB).`);
  await db.setMeta(fileKey(id), blob.type === 'application/pdf' ? blob : new Blob([blob], { type: 'application/pdf' }));
  notifyManualChange();
}
/** Drop the local offline copy only. The listing and Drive PDF stay. */
export async function clearFile(id) {
  await db.setMeta(fileKey(id), null);
  notifyManualChange();
}

export const isPdfName = (name) => /\.pdf$/i.test(name || '');
export async function looksLikePdf(file) {
  try { const head = new Uint8Array(await file.slice(0, 5).arrayBuffer()); return String.fromCharCode(...head) === '%PDF-'; } catch { return false; }
}
// "Beko_DIS15020-user manual.pdf" → "Beko DIS15020 user manual"
export const nameFromFile = (name) => String(name || 'Manual').replace(/\.pdf$/i, '').replace(/^[^\s_]+$/, (w) => w.replace(/-+/g, ' ')).replace(/[_]+/g, ' ').replace(/\s*-\s*/g, ' – ').replace(/\s+/g, ' ').trim().slice(0, 80) || 'Manual';

/** Save a new manual. file = File/Blob (PDF). Returns the saved record. */
export async function add(file, { name, notes = '', rooms = [], entryIds = [], pages = null }) {
  if (!file || !file.size) throw new Error('That file is empty.');
  if (file.size > MAX_BYTES) throw new Error(`That PDF is ${(file.size / 1048576).toFixed(0)} MB, too big to keep in the app (limit ${MAX_BYTES / 1048576} MB).`);
  const id = db.newId();
  const blob = file.type === 'application/pdf' ? file : new Blob([file], { type: 'application/pdf' });
  const rec = { id, name: String(name || nameFromFile(file.name)).trim().slice(0, 80), notes: String(notes || '').slice(0, 2000), rooms, entryIds, size: file.size, pages, fileName: file.name || `${id}.pdf`, addedAt: new Date().toISOString() };
  await db.saveMetaValues({ [fileKey(id)]: blob, [LIST_KEY]: [...(await list()), rec] });
  notifyManualChange();
  return rec;
}
export async function update(id, patch) {
  const all = await list();
  const i = all.findIndex((m) => m.id === id);
  if (i < 0) return null;
  all[i] = { ...all[i], ...patch, id, updatedAt: new Date().toISOString() };
  await db.setMeta(LIST_KEY, all);
  notifyManualChange();
  return all[i];
}
export async function updateMany(changed) {
  const byId = new Map(changed.map((m) => [m.id, m]));
  await db.setMeta(LIST_KEY, (await list()).map((m) => byId.has(m.id) ? { ...byId.get(m.id), updatedAt: new Date().toISOString() } : m));
  notifyManualChange();
}
export async function remove(id) {
  const tombs = { ...((await db.getMeta(TOMBS_KEY)) || {}), [id]: new Date().toISOString() };
  await db.saveMetaValues({ [LIST_KEY]: (await list()).filter((m) => m.id !== id), [fileKey(id)]: null, [TOMBS_KEY]: tombs });
  notifyManualChange();
}

/** Manuals linked to an entry. */
export const forEntry = (all, entryId) => all.filter((m) => (m.entryIds || []).includes(entryId));

const words = (s) => String(s || '').toLowerCase().replace(/[^a-z0-9°%]+/g, ' ').split(' ').filter(Boolean);
const STOP = new Set('the a an my our for of to in on how do does i is where what manual manuals guide guides instructions instruction booklet pdf user book handbook'.split(' '));
/** Ask Hearthbook: your own manuals matching a query (name, notes, file name, rooms). Pure. */
export function searchUser(all, q) {
  const qw = words(q);
  if (!qw.length) return [];
  const wantsManual = qw.some((w) => /^(manual|manuals|guide|guides|instructions?|handbook|booklet|pdf)$/.test(w));
  const key = qw.filter((w) => !STOP.has(w) && w.length >= 2);
  if (!key.length) return wantsManual ? all.slice() : [];
  const hit = (list, w) => list.some((h) => h === w || (w.length >= 3 && h.startsWith(w)));
  const scored = all.map((m) => {
    const main = words([m.name, m.fileName].join(' '));
    const extra = words([m.notes, ...(m.rooms || [])].join(' '));
    let score = 0, found = 0;
    for (const w of key) { const s = hit(main, w) ? 2 : hit(extra, w) ? 1 : 0; score += s; if (s) found++; }
    return { m, score, found };
  }).filter((x) => x.score > 0 && (wantsManual || x.found === key.length));
  scored.sort((a, b) => b.score - a.score);
  return scored.map((x) => x.m);
}

export const sizeText = (bytes) => (bytes >= 1048576 ? `${(bytes / 1048576).toFixed(1)} MB` : `${Math.max(1, Math.round(bytes / 1024))} KB`);
