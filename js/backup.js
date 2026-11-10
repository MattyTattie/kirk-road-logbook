// =====================================================================
// backup.js — making a backup file, and restoring from one.
// =====================================================================
//
// Because ALL your data lives only on the phone, a backup file is your
// safety net. The backup is a single ".json" file (JSON = a plain-text
// format for data) that contains every entry AND every photo (as base64
// text). Save it somewhere safe: email it to yourself, put it on Google
// Drive, copy it to a PC. You can restore it on this phone or a new one.

import { getEverything as getAllEntries, getMeta, saveEntriesAndMeta, setMeta } from './db.js'; // v15.0: everything, incl. the usage entry
import { reviveRestored, TOMBSTONES_KEY, CACHE_META_KEY, missingPhotoCount } from './sync.js';
import { blobToDataURL, dataURLToBlob } from './photos.js';
import { APP_NAME, APP_SLUG } from './config.js';
import * as manuals from './usermanuals.js';
import { loadBlob as loadManualBlob } from './sharedmanuals.js';
import * as rooms from './rooms.js';
import { todayISO } from './utils.js';

// NEVER change FORMAT: it's how a restore recognises a backup file, and it
// must keep matching every backup you've already made (the app used to be
// called "Kirk Road Logbook"; the name inside the file stays the same).
const FORMAT = 'kirk-road-logbook-backup';
const FORMAT_VERSION = 1;

// Builds the backup and makes the browser download it.
export async function buildBackup() {
  const entries = await getAllEntries();

  // Convert each entry's photo Blobs into base64 text.
  const out = [];
  for (const entry of entries) {
    if (await missingPhotoCount(entry)) throw new Error('Some photos have not reached this phone yet. Sync and allow shared-file access before saving a backup.');
    const photos = [];
    for (const p of entry.photos || []) {
      photos.push({ id: p.id, data: await blobToDataURL(p.blob) });
    }
    out.push({ ...entry, photos });
  }

  const manualFiles = [];
  for (const m of await manuals.list()) {
    // v15.16: local offline copy is optional; fetch from Drive when needed so
    // a backup still includes every PDF rather than quietly skipping one.
    let blob;
    try { blob = await loadManualBlob(m.id); }
    catch (err) { throw new Error(err?.message || `The PDF for “${m.name}” is not on this phone yet. Sync before saving a backup.`); }
    manualFiles.push({ ...m, data: await blobToDataURL(blob) });
  }
  const backup = {
    format: FORMAT,
    version: FORMAT_VERSION,
    exportedAt: new Date().toISOString(),
    entryCount: out.length,
    entries: out,
    manuals: manualFiles,
    roomSettings: await rooms.getShared(),
  };

  // Turn it into a file and "click" a hidden download link.
  const json = JSON.stringify(backup);
  const blob = new Blob([json], { type: 'application/json' });
  const today = todayISO(); // v15.7: local date (UTC was yesterday after midnight in summer time)
  const filename = `${APP_SLUG}-backup-${today}.json`;

  return { blob, filename, count: out.length, manuals: manualFiles.length };
}

export async function exportBackup() {
  const { blob, filename, count } = await buildBackup();
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  a.remove();
  // Give the download a moment to start before tidying up.
  setTimeout(() => URL.revokeObjectURL(url), 10000);

  // Remember when we last backed up, for the 30-day reminder.
  await setMeta('lastBackup', new Date().toISOString());
  return { filename, count, bytes: blob.size };
}

// Reads a backup File (chosen by the user) and saves its entries.
// Entries with the same id as one already on the phone are replaced;
// everything else on the phone is left alone (nothing is deleted).
// v15.22: …unless the phone's copy was changed AFTER the backup's copy
// (newer updatedAt): then the phone's newer copy is kept, so restoring an
// old backup can't quietly undo newer edits. Returns the number of entries
// in the backup (as before); restoreBackup() also says how many were kept.
export async function importBackup(file) {
  return (await restoreBackup(file)).count;
}

// v15.22: the file is read and checked FIRST; then `confirm(info)` (if
// given) is asked, with what will happen; false = nothing changes.
//   info = { count, exportedAt, newerHere, sameHere, toAdd }
export async function restoreBackup(file, { confirm = null } = {}) {
  const text = await file.text();
  let data;
  try {
    data = JSON.parse(text);
  } catch {
    throw new Error('That file is not a valid backup (it is not JSON).');
  }
  if (!data || data.format !== FORMAT || !Array.isArray(data.entries)) {
    throw new Error(`That file does not look like a ${APP_NAME} backup.`);
  }

  // Check and convert everything FIRST, then save in one go. That way a
  // damaged file can't leave you with half an import.
  const manualMeta = {};
  if (data.roomSettings !== undefined) {
    if (!data.roomSettings || typeof data.roomSettings !== 'object' || Array.isArray(data.roomSettings)) throw new Error('The backup contains damaged room settings. Nothing was imported.');
    const restored = rooms.mergeShared([data.roomSettings]);
    if (Object.keys(restored).length !== Object.keys(data.roomSettings).length) throw new Error('The backup contains damaged room settings. Nothing was imported.');
    for (const rec of Object.values(restored)) rec.updatedAt = new Date().toISOString();
    Object.assign(manualMeta, rooms.sharedMeta(rooms.mergeShared([restored, await rooms.getShared()])));
  }
  if (data.manuals !== undefined) {
    if (!Array.isArray(data.manuals)) throw new Error('The backup contains a damaged manuals list. Nothing was imported.');
    const restored = [];
    for (const m of data.manuals) {
      if (!manuals.validRecord(m) || typeof m.data !== 'string' || !m.data.startsWith('data:application/pdf;base64,')) throw new Error('The backup contains a damaged manual. Nothing was imported.');
      const blob = await dataURLToBlob(m.data);
      if (!blob.size || blob.size > manuals.MAX_BYTES || !(await manuals.looksLikePdf(blob))) throw new Error('The backup contains an invalid PDF. Nothing was imported.');
      const { data: bytes, driveId, ...record } = m;
      restored.push({ ...record, size: blob.size, updatedAt: new Date().toISOString() });
      manualMeta[manuals.fileKey(m.id)] = blob;
    }
    const all = new Map((await manuals.list()).map((m) => [m.id, m]));
    const tombs = { ...((await getMeta(manuals.TOMBS_KEY)) || {}) };
    for (const m of restored) { all.set(m.id, m); delete tombs[m.id]; }
    manualMeta[manuals.LIST_KEY] = [...all.values()];
    manualMeta[manuals.TOMBS_KEY] = tombs;
  }
  for (const e of data.entries) {
    if (!e || typeof e.id !== 'string' || typeof e.type !== 'string') {
      throw new Error('The backup contains a damaged entry, so nothing was imported.');
    }
  }
  // v15.22: which of the backup's entries this phone already has a newer
  // copy of. Changed since the backup → the phone's copy is kept. The same
  // details (only the time stamp moved, e.g. it came from this backup) →
  // left as it is, unless the backup has photos this phone lacks.
  const local = new Map((await getAllEntries()).map((e) => [e.id, e]));
  const body = (x) => JSON.stringify(Object.keys(x).filter((k) => !['updatedAt', 'createdAt', 'photos'].includes(k)).sort().map((k) => [k, x[k] === undefined ? null : x[k]]));
  const newer = new Set(), already = new Set(), keepStamp = new Map();
  for (const e of data.entries) {
    const here = local.get(e.id);
    if (!here) continue;
    const a = String(here.updatedAt || ''), b = String(e.updatedAt || '');
    if (!(a && b && a > b)) continue; // older or the same here: the backup copy goes back, as before
    if (body(here) !== body(e)) { newer.add(e.id); continue; }
    const have = new Set((here.photos || []).map((p) => p.id));
    if ((e.photos || []).every((p) => have.has(p.id))) already.add(e.id);
    else keepStamp.set(e.id, here.updatedAt); // same details, photos missing here: put back, keep this phone's time
  }
  const notUsage = (set) => data.entries.filter((e) => set.has(e.id) && e.type !== 'usage').length;
  const count = data.entries.filter((e) => e.type !== 'usage').length; // v15.0: the EDF usage record isn't a logbook entry
  const info = { count, exportedAt: typeof data.exportedAt === 'string' ? data.exportedAt : null,
    newerHere: notUsage(newer), alreadyHere: notUsage(already) };
  info.toAdd = count - info.newerHere - info.alreadyHere;
  if (confirm && !(await confirm(info))) return { ...info, cancelled: true };
  const entries = [];
  for (const e of data.entries) {
    if (newer.has(e.id) || already.has(e.id)) continue;
    const photos = [];
    for (const p of e.photos || []) {
      if (typeof p.data !== 'string' || !p.data.startsWith('data:image/')) continue;
      photos.push({ id: p.id, blob: await dataURLToBlob(p.data) });
    }
    entries.push(keepStamp.has(e.id) ? { ...e, photos, updatedAt: keepStamp.get(e.id) } : { ...e, photos });
  }

  // v13 (H1): with sync on, an entry that had been deleted would be deleted
  // again by the next sync (the old delete looked newer than the old
  // backup copy). So entries that were deleted, or are missing here and not
  // in Drive, get "changed now" and their delete marker is cleared. The
  // file format is unchanged; only updatedAt moves forward.
  const localIds = new Set(local.keys());
  const tombs = (await getMeta(TOMBSTONES_KEY)) || {};
  const cache = await getMeta(CACHE_META_KEY);
  const remote = cache && cache.index ? cache.index : null;
  const r = reviveRestored(entries, localIds, tombs, remote);
  await saveEntriesAndMeta(r.entries, TOMBSTONES_KEY, r.tombs, manualMeta);
  if (data.manuals?.length || data.roomSettings) dispatchEvent(new CustomEvent('hearthbook:manualchange'));
  return { ...info, kept: info.newerHere };
}
