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
// - Idempotent: a second run finds nothing to do. Runs at most once a day
//   unless new photos were uploaded. Never fails a sync.
import * as drive from './gdrive.js';
import * as db from './db.js';

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
/** "2026-11 EDF bill.jpg", "2026-10 Screwfix receipt 2.jpg". Pure. */
export function photoName(entry, index = 0, count = 1, ext = 'jpg') {
  const month = /^\d{4}-\d{2}/.test(entry?.date || '') ? entry.date.slice(0, 7) : '';
  const word = WORD[entry?.type] || 'photo';
  const who = clean(entry?.supplier) || clean(entry?.title) || '';
  let base = clean([month, who.slice(0, 60), who.toLowerCase().includes(word) ? '' : word].filter(Boolean).join(' ')) || 'Hearth photo';
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
export function planTidy({ files, folders, photoOwner, manualByDrive, manifestIds = new Set() }) {
  const moves = [];
  for (const f of files || []) {
    if (!f || f.trashed || !f.ownedByMe || f.mimeType === FOLDER_MIME) continue;
    if (!(f.parents || []).length) continue; // parent unknown to this app: never guess a move
    let kind = null, name = f.name;
    const tag = f.appProperties && f.appProperties.hearthbook;
    if (tag === 'photo' && photoOwner.has(f.id)) {
      const o = photoOwner.get(f.id);
      kind = kindOf(o.entry); name = photoName(o.entry, o.index, o.count, extOf(f.mimeType));
    } else if (tag === 'manual' && manualByDrive.has(f.id)) {
      kind = 'manuals'; name = manualName(manualByDrive.get(f.id));
    } else if (manifestIds.has(f.id) && /^hearthbook-manuals-.+\.json$/.test(f.name || '')) {
      kind = 'manuals'; // keep its name: phones find it by name
    } else continue; // not ours, or not confirmed in use: leave it
    const to = folders[kind];
    if (!to) continue;
    const inPlace = (f.parents || []).includes(to) && (f.parents || []).length === 1;
    if (inPlace && name === f.name) continue;
    moves.push({ id: f.id, from: (f.parents || []).filter((p) => p !== to), to, name: name === f.name ? null : name, was: f.name });
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
      // The phone that joined never makes or renames folders (so there is
      // only ever one of each); it files its own photos into the owner's.
      const f = kids.find((k) => k.name === def.name && k.ownedByMe) || kids.find((k) => k.name === def.name);
      if (f) folders[kind] = f.id;
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
  const moves = planTidy({ files, folders, photoOwner, manualByDrive, manifestIds: new Set(ctx.manifestIds || []) });
  let moved = 0, failed = 0;
  for (const m of moves) {
    try { await drive.updateFile(m.id, m.name ? { name: m.name } : {}, { addParents: m.to, removeParents: m.from }); moved++; }
    catch (err) { if (err instanceof drive.AuthError) throw err; failed++; }
  }
  let binned = 0;
  for (const f of planLeftovers(files, { parent, syncVersion: ctx.syncVersion })) {
    try { await drive.trash(f.id); binned++; } catch (err) { if (err instanceof drive.AuthError) throw err; failed++; }
  }
  state.at = new Date().toISOString(); // failures retry tomorrow / after the next upload
  state.last = { moved, binned, failed };
  await db.setMeta(STATE_KEY, state);
  return { moved, binned, failed };
}
