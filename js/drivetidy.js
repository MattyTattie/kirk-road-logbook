// =====================================================================
// drivetidy.js — v15.18: tidy the shared Hearthbook Drive folder.
// =====================================================================
// Inside the shared Hearthbook folder, Hearth keeps:
//   hearthbook-sync.json (stays at the top, never moved or renamed)
//   Receipts/  Bills/  Mortgage/  Manuals/  Backups/  Other photos/
// Photos go in the folder for their entry's type and get readable names
// ("2026-11 EDF bill.jpg"); manual PDFs go in Manuals ("Beko dishwasher
// manual.pdf"); the per-phone manuals files (hearthbook-manuals-*.json)
// move into Manuals too.
//
// Safety:
// - Files are MOVED and RENAMED, never re-uploaded: their Drive ids stay
//   the same, so the sync file, older app versions and backups still point
//   at them. Nothing in the sync/backup format changes.
// - Only files this Google account owns AND this app made (appProperties
//   hearthbook=photo/manual, or our own manifest / legacy sync bucket) are
//   touched. Anything else in the folder (your own files, files the box or
//   the other phone made) is left alone. The other phone tidies its own.
// - Old folders are renamed rather than replaced ("Hearthbook photos" →
//   "Other photos", "Hearthbook backups" → "Backups", "Hearthbook manuals"
//   → "Manuals"), keeping ids, so older app versions keep working.
// - Leftover sync v1 files (hearthbook-photos-N.json) go to the Drive bin
//   (30 days to restore) only once the sync file is version 3 and the
//   leftover hasn't changed for 14 days. Backup retention is unchanged.
// v15.19:
// - Bill photos are named by the month the bill is FOR (from its title,
//   e.g. "EDF bill Sep 2025", or the period it covers), not the day it
//   was paid. No two files in one folder get the same name: a clash adds
//   the day ("2026-03-14 Screwfix receipt"), then " 2", " 3"…
// - The phone that joined (not the folder's owner) uses the owner's
//   folders instead of making its own. If Google won't let it write or move
//   into them, its files are left where they are (counted as "skipped",
//   never an error), and any folder it must make is called e.g.
//   "Backups (second phone)" so there are never two folders of one name.
// - Idempotent: a second run finds nothing to do. Runs at most once a day
//   unless new photos were uploaded. Never fails a sync.
import * as drive from './gdrive.js';
import * as db from './db.js';
import { coverMonths } from './stats.js';

export const FOLDERS = {
  receipts: { name: 'Receipts', old: [] },
  bills: { name: 'Bills', old: [] },
  mortgage: { name: 'Mortgage', old: [] },
  manuals: { name: 'Manuals', old: ['Hearthbook manuals'] },
  backups: { name: 'Backups', old: ['Hearthbook backups'] },
  other: { name: 'Other photos', old: ['Hearthbook photos'] },
};
export const STATE_KEY = 'driveTidy';
const FOLDER_MIME = 'application/vnd.google-apps.folder';
const DAY = 86400_000;
const quote = (x) => String(x).replace(/\\/g, '\\\\').replace(/'/g, "\\'");

/** Which folder an entry's photos belong in. Pure. */
export function kindOf(entry) {
  switch (entry && entry.type) {
    case 'receipt': case 'warranty': return 'receipts';
    case 'meter': case 'insurance': return 'bills';
    case 'mortgage': return 'mortgage';
    default: return 'other';
  }
}
const WORD = { receipt: 'receipt', warranty: 'warranty', meter: 'bill', insurance: 'insurance', mortgage: 'mortgage statement', job: 'job' };
const clean = (s) => String(s || '').replace(/[\\/:*?"<>|#\u0000-\u001f]+/g, ' ').replace(/\s+/g, ' ').trim();
export const SECOND = ' (second phone)';
const MONTHS = ['jan', 'feb', 'mar', 'apr', 'may', 'jun', 'jul', 'aug', 'sep', 'oct', 'nov', 'dec'];
/** v15.19: "YYYY-MM" a bill is for: its title ("EDF bill Sep 2025"), else
 *  the period it covers (cover = coverMonths()), else its date. Pure. */
export function billMonth(entry, cover = null) {
  const t = String(entry?.title || '');
  const m = t.match(/\b(jan|feb|mar|apr|may|jun|jul|aug|sep|oct|nov|dec)[a-z]*\.?\s+(\d{4})\b/i);
  if (m) return `${m[2]}-${String(MONTHS.indexOf(m[1].toLowerCase()) + 1).padStart(2, '0')}`;
  const iso = t.match(/\b(\d{4})-(0[1-9]|1[0-2])\b/);
  if (iso) return `${iso[1]}-${iso[2]}`;
  const c = cover && entry?.id && (cover.get ? cover.get(entry.id) : cover[entry.id]);
  if (c && /^\d{4}-\d{2}$/.test(c)) return c;
  return /^\d{4}-\d{2}/.test(entry?.date || '') ? entry.date.slice(0, 7) : '';
}
/** "2026-11 EDF bill.jpg", "2026-10 Screwfix receipt 2.jpg". Pure.
 *  opts.cover: coverMonths() map for bills; opts.day: use the full date. */
export function photoName(entry, index = 0, count = 1, ext = 'jpg', opts = {}) {
  const dated = /^\d{4}-\d{2}-\d{2}/.test(entry?.date || '') ? entry.date.slice(0, 10) : '';
  let month = entry?.type === 'meter' ? billMonth(entry, opts.cover) : (dated ? dated.slice(0, 7) : '');
  let tail = '';
  if (opts.day && dated) { if (!month || month === dated.slice(0, 7)) month = dated; else tail = ` ${dated}`; }
  const word = WORD[entry?.type] || 'photo';
  const who = clean(entry?.supplier) || clean(entry?.title) || '';
  let base = clean([month, who.slice(0, 60), who.toLowerCase().includes(word) ? '' : word].filter(Boolean).join(' ')) || 'Hearth photo';
  base += tail;
  if (count > 1) base += ` ${index + 1}`;
  return `${base}.${ext}`;
}
/** "Beko dishwasher manual.pdf". Pure. */
export function manualName(m) {
  const n = clean(m?.name).slice(0, 90) || 'Manual';
  return /\b(manual|guide|instructions?|handbook)\b/i.test(n) ? `${n}.pdf` : `${n} manual.pdf`;
}
const extOf = (mime) => (/png/.test(mime || '') ? 'png' : /pdf/.test(mime || '') ? 'pdf' : 'jpg');

/**
 * Work out every move/rename. Pure; tested.
 *   files: Drive metadata of candidate files (with parents, ownedByMe, appProperties)
 *   folders: { kind: folderId }
 *   photoOwner: Map photoDriveId → { entry, index, count }
 *   manualByDrive: Map pdfDriveId → manual record
 *   manifests: ids of hearthbook-manuals-*.json files
 */
export function planTidy({ files, folders, photoOwner, manualByDrive, manifestIds = new Set(), cover = null }) {
  const plans = [];
  const seen = new Set();
  for (const f of files || []) {
    if (!f || seen.has(f.id)) continue;
    seen.add(f.id);
    if (f.trashed || !f.ownedByMe || f.mimeType === FOLDER_MIME) continue;
    if (!(f.parents || []).length) continue; // parent unknown to this app: never guess a move
    let kind = null, name = f.name, alt = null;
    const tag = f.appProperties && f.appProperties.hearthbook;
    if (tag === 'photo' && photoOwner.has(f.id)) {
      const o = photoOwner.get(f.id);
      kind = kindOf(o.entry); name = photoName(o.entry, o.index, o.count, extOf(f.mimeType), { cover });
      alt = photoName(o.entry, o.index, o.count, extOf(f.mimeType), { cover, day: true });
    } else if (tag === 'manual' && manualByDrive.has(f.id)) {
      kind = 'manuals'; name = manualName(manualByDrive.get(f.id));
    } else if (manifestIds.has(f.id) && /^hearthbook-manuals-.+\.json$/.test(f.name || '')) {
      kind = 'manuals'; // keep its name: phones find it by name
    } else continue; // not ours, or not confirmed in use: leave it
    const to = folders[kind];
    if (!to) continue;
    plans.push({ f, to, name, alt, fixed: kind === 'manuals' && tag !== 'manual' });
  }
  // v15.19: unique names per folder. Every file already in a target folder
  // that isn't being renamed keeps its name; the rest get the next free one.
  const planned = new Set(plans.map((p) => p.f.id));
  const taken = new Map();
  const take = (folder, n) => { if (!taken.has(folder)) taken.set(folder, new Set()); taken.get(folder).add(String(n).toLowerCase()); };
  const isTaken = (folder, n) => !!taken.get(folder)?.has(String(n).toLowerCase());
  for (const f of seen.size ? files : []) if (f && !f.trashed && !planned.has(f.id)) for (const p of f.parents || []) take(p, f.name);
  // Files already right (in place, right name) claim their names first.
  const ok = (p) => (p.f.parents || []).length === 1 && p.f.parents[0] === p.to && (p.fixed || p.name === p.f.name);
  for (const p of plans) if (ok(p) && !isTaken(p.to, p.f.name)) { take(p.to, p.f.name); p.done = true; }
  const moves = [];
  for (const p of plans) {
    if (p.done) continue;
    let name = p.fixed ? p.f.name : p.name;
    if (!p.fixed && isTaken(p.to, name)) {
      const dot = (n) => { const i = n.lastIndexOf('.'); return i > 0 ? [n.slice(0, i), n.slice(i)] : [n, '']; };
      if (p.alt && !isTaken(p.to, p.alt)) name = p.alt;
      else {
        const [stem, ext] = dot(p.alt || name);
        let i = 2;
        while (isTaken(p.to, `${stem} ${i}${ext}`)) i++;
        name = `${stem} ${i}${ext}`;
      }
    }
    take(p.to, name);
    const inPlace = (p.f.parents || []).includes(p.to) && (p.f.parents || []).length === 1;
    if (inPlace && name === p.f.name) continue;
    moves.push({ id: p.f.id, from: (p.f.parents || []).filter((x) => x !== p.to), to: p.to, name: name === p.f.name ? null : name, was: p.f.name });
  }
  return moves;
}

/** sync v1 leftovers safe to bin. Pure; tested. */
export function planLeftovers(files, { parent, syncVersion, now = Date.now() }) {
  if (!(syncVersion >= 3)) return [];
  return (files || []).filter((f) => f && !f.trashed && f.ownedByMe && /^hearthbook-photos-\d+\.json$/.test(f.name || '')
    && (f.parents || []).includes(parent) && now - (Date.parse(f.modifiedTime || '') || now) >= 14 * DAY);
}

// prefer: { kind: folderId } the app already uses (photo folder from the
// sync file, this phone's backups / manuals folder). Those are renamed in
// place. A same-named folder this app can't write to (e.g. one made outside
// Hearth) is skipped, never touched.
async function ensureFolders(parent, state, prefer = {}, owner = true) {
  const kids = await drive.list(`'${quote(parent)}' in parents and trashed = false and mimeType = '${FOLDER_MIME}'`);
  const folders = {};
  const used = () => new Set(Object.values(folders));
  for (const [kind, def] of Object.entries(FOLDERS)) {
    if (!owner) {
      // The phone that joined never makes folders here; it files its own
      // photos into the owner's (v15.19: the owner's first, not a copy of
      // its own). Its own same-named folders (made by v15.18) are renamed
      // "… (second phone)" so there's only one folder of each name.
      const theirs = kids.find((k) => k.name === def.name && !k.ownedByMe);
      if (theirs) folders[kind] = theirs.id;
      for (const k of kids.filter((x) => x.ownedByMe && x.name === def.name && theirs)) {
        const name = def.name + SECOND;
        if (kids.some((x) => x.name === name)) continue;
        try { await drive.updateFile(k.id, { name }); k.name = name; } catch (err) { if (err instanceof drive.AuthError) throw err; }
      }
      continue;
    }
    const ids = [state.folders?.[kind], prefer[kind]].filter(Boolean);
    const tries = [
      ...ids.map((id) => kids.find((k) => k.id === id && k.ownedByMe)),
      ...kids.filter((k) => k.ownedByMe && k.name === def.name),
      ...kids.filter((k) => k.ownedByMe && def.old.includes(k.name) && ids.includes(k.id)),
    ].filter((k) => k && !used().has(k.id));
    let got = null;
    for (const k of tries) {
      if (k.name === def.name) { got = k.id; break; }
      try { await drive.updateFile(k.id, { name: def.name }); got = k.id; break; }
      catch (err) { if (err instanceof drive.AuthError) throw err; }
    }
    if (!got) got = (await drive.createFolder(def.name, parent)).id;
    folders[kind] = got;
  }
  return folders;
}

const isPermission = (err) => err instanceof drive.NotFoundError || err?.status === 403 || err?.status === 404;

/**
 * v15.19: write a file into one of the shared sub-folders (Backups,
 * Manuals…) without ever making a second folder of the same name.
 * write(folderId) does the upload and returns its result. Folders are tried
 * in order; one Google won't let this phone write into is skipped quietly.
 *   owner phone:  remembered → its own "Backups" → its own old name → make "Backups"
 *   joined phone: the owner's "Backups" → remembered → its own "Backups (second
 *                 phone)" / "Backups" / old name → make "Backups (second phone)"
 * Returns { folderId, result }. Throws err.needsGrant if nothing could be made.
 */
export async function writeIntoFolder({ parent, kind, owner = true, remembered = null, write }) {
  const def = FOLDERS[kind];
  const kids = (await drive.list(`'${quote(parent)}' in parents and trashed = false and mimeType = '${FOLDER_MIME}'`)).filter((k) => !k.trashed);
  const mine = (n) => kids.filter((k) => k.ownedByMe && k.name === n);
  const order = owner
    ? [...kids.filter((k) => k.id === remembered && k.ownedByMe), ...mine(def.name), ...def.old.flatMap(mine)]
    : [...kids.filter((k) => !k.ownedByMe && k.name === def.name), ...kids.filter((k) => k.id === remembered), ...mine(def.name + SECOND), ...mine(def.name), ...def.old.flatMap(mine)];
  const tried = new Set();
  for (const f of order) {
    if (tried.has(f.id)) continue;
    tried.add(f.id);
    try { return { folderId: f.id, result: await write(f.id) }; }
    catch (err) { if (err instanceof drive.AuthError || !isPermission(err)) throw err; }
  }
  let made;
  try { made = await drive.createFolder(owner ? def.name : def.name + SECOND, parent); }
  catch (err) { if (err instanceof drive.AuthError) throw err; const e = new Error('needs folder grant'); e.needsGrant = true; throw e; }
  return { folderId: made.id, result: await write(made.id) };
}

/** Folder id to upload a new photo of this entry type into (only already-made folders). */
export async function folderFor(parent, entry) {
  const state = (await db.getMeta(STATE_KEY)) || {};
  if (!parent || state.parent !== parent || state.owner === false) return null;
  return state.folders?.[kindOf(entry)] || null;
}

/**
 * Run the tidy. ctx: { parent, records (id → entry), photos (photoId → map value),
 * photoDriveId(fn), syncVersion, manuals (records), manifestIds, force }
 */
export async function tidyDrive(ctx) {
  const { parent } = ctx;
  if (!parent) return null;
  let state = (await db.getMeta(STATE_KEY)) || {};
  if (state.parent !== parent) state = { parent };
  if (!ctx.force && state.at && Date.now() - Date.parse(state.at) < DAY) return null;
  const folders = await ensureFolders(parent, state, ctx.prefer || {}, ctx.owner !== false);
  state.folders = folders;
  state.owner = ctx.owner !== false; // only the owner's phone uploads straight into them
  await db.setMeta(STATE_KEY, state); // checkpoint the folder ids first

  const photoOwner = new Map();
  for (const e of Object.values(ctx.records || {})) {
    const list = (e.photos || []).filter((p) => p && p.id);
    list.forEach((p, i) => { const id = ctx.photoDriveId(ctx.photos?.[p.id]); if (id) photoOwner.set(id, { entry: e, index: i, count: list.length }); });
  }
  const manualByDrive = new Map((ctx.manuals || []).filter((m) => m.driveId).map((m) => [m.driveId, m]));
  const where = [...new Set([parent, ...Object.values(folders), ...Object.values(ctx.prefer || {}).filter(Boolean)])];
  const files = [];
  for (const p of where) files.push(...await drive.list(`'${quote(p)}' in parents and trashed = false`));
  let cover = null;
  try { cover = coverMonths(Object.values(ctx.records || {})); } catch { cover = null; }
  const moves = planTidy({ files, folders, photoOwner, manualByDrive, manifestIds: new Set(ctx.manifestIds || []), cover });
  let moved = 0, failed = 0, skipped = 0;
  const owner = ctx.owner !== false;
  for (const m of moves) {
    try { await drive.updateFile(m.id, m.name ? { name: m.name } : {}, { addParents: m.to, removeParents: m.from }); moved++; }
    catch (err) {
      if (err instanceof drive.AuthError) throw err;
      // v15.19: the joined phone may not be allowed into the owner's
      // folders. Leave the file where it is; that's fine, not an error.
      if (!owner && isPermission(err)) skipped++; else failed++;
    }
  }
  // Files in the shared folder that the other phone made: theirs to tidy.
  const tidyIds = new Set(Object.values(folders));
  skipped += new Set(files.filter((f) => f && !f.trashed && !f.ownedByMe && f.mimeType !== FOLDER_MIME
    && /^(photo|manual)$/.test(f.appProperties?.hearthbook || '') && !(f.parents || []).some((p) => tidyIds.has(p))).map((f) => f.id)).size;
  let binned = 0;
  for (const f of planLeftovers(files, { parent, syncVersion: ctx.syncVersion })) {
    try { await drive.trash(f.id); binned++; } catch (err) { if (err instanceof drive.AuthError) throw err; failed++; }
  }
  state.at = new Date().toISOString(); // failures retry tomorrow / after the next upload
  state.last = { moved, binned, failed, skipped };
  await db.setMeta(STATE_KEY, state);
  return { moved, binned, failed, skipped };
}
