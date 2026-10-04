// =====================================================================
// usermanuals.js — manuals you add yourself (v13).
// =====================================================================
// Pick a PDF on the phone (More → Manuals → Add a manual), or share one to
// Hearthbook from another app and choose "Keep as a manual". You give it a
// name, and can link it to entries (e.g. the dishwasher's warranty) and to
// rooms. It's saved inside the app's own storage, so it opens offline.
//
// WHERE IT LIVES: on THIS phone only, in the existing "meta" store
// (key "userManuals" = the list, "userManualFile:<id>" = the PDF itself).
// No new database, no change to entries, backups or the sync file.
//
// WHY NOT SYNCED: the sync file is ONE JSON file that every phone reads
// and rewrites in full. PDFs are big (often 1–10 MB each), which would
// push that file far past Google's 5 MB simple-upload size, and an older
// copy of the app on the other phone would drop anything it doesn't know
// about when it writes the file back. So each phone keeps its own; the
// screen says so. (A future option: one Drive file per manual.)

import * as db from './db.js';

const LIST_KEY = 'userManuals';
const fileKey = (id) => `userManualFile:${id}`;
export const MAX_BYTES = 60 * 1024 * 1024; // a sane limit per PDF

export async function list() { return (await db.getMeta(LIST_KEY)) || []; }
export async function get(id) { return (await list()).find((m) => m.id === id) || null; }
export async function getFile(id) { return (await db.getMeta(fileKey(id))) || null; }

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
  await db.setMeta(fileKey(id), blob); // the PDF first; the list only points at it once it's saved
  await db.setMeta(LIST_KEY, [...(await list()), rec]);
  return rec;
}
export async function update(id, patch) {
  const all = await list();
  const i = all.findIndex((m) => m.id === id);
  if (i < 0) return null;
  all[i] = { ...all[i], ...patch, id };
  await db.setMeta(LIST_KEY, all);
  return all[i];
}
export async function updateMany(changed) {
  const byId = new Map(changed.map((m) => [m.id, m]));
  await db.setMeta(LIST_KEY, (await list()).map((m) => byId.get(m.id) || m));
}
export async function remove(id) {
  await db.setMeta(LIST_KEY, (await list()).filter((m) => m.id !== id));
  await db.setMeta(fileKey(id), null);
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
