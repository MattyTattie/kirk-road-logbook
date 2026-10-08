// =====================================================================
// sync.js — keep one logbook on two phones, via a shared Drive folder.
// =====================================================================
// OFF by default. When it's off nothing here touches the network, and the
// app works exactly as before (phone-only, offline).
//
// WHAT'S IN THE SHARED FOLDER ("Hearthbook" in Google Drive):
//   hearthbook-sync.json   Text of every entry, tombstones, and a small
//                          pointer per photo (Drive file id). Stays small.
//   Hearthbook photos/     One JPEG file per photo (created by the phone
//                          that first synced it). Each phone also keeps a
//                          local copy so reopen is instant and offline.
// The shared JSON is still the one file the other person picks once
// (drive.file can't unlock a folder's children). New photos briefly carry
// their image bytes inside the JSON for one sync so the other phone can
// cache them; after that only the Drive id stays. Offline / no Drive:
// photos stay on the phone as before.
// (Version 1 spread photos over 8 JSON files; v2 put them inside the sync
// file; v3 moves them to separate Drive JPEGs. Older layouts still load.)
//
// MOVING PHOTOS TO DRIVE SAFELY (v13.8). The first sync after v13.7 moves
// every photo out of the sync file. On 6 Oct 2026 that move kept starting
// again from the first photo whenever the app was interrupted (switched
// away, reloaded), uploading the same photos again and leaving empty files.
// Now:
//   • each finished, checked upload is remembered on this phone straight
//     away (meta "syncPhotoUploads"), and before uploading a photo the app
//     looks for a Drive file it made earlier with the same name and the
//     right size, so a restart carries on and never uploads a photo twice;
//   • an upload is checked (the size Drive stored = the bytes sent); a bad
//     one is binned and tried again a couple of times, then that photo is
//     skipped for this sync (it stays in the sync file / on the phone);
//   • the sync file is rewritten after every 10 photos, so it shrinks as
//     it goes, even if some photos are skipped;
//   • only one sync runs at a time, even across two open windows;
//   • the screen says "Moving photos to Drive: 12 of 38".
//
// HOW TWO PHONES AGREE (per entry, "last write wins"):
//   • every entry has updatedAt (set when you save it);
//   • deleting an entry leaves a tombstone {id: deletedAt} so the delete
//     reaches the other phone instead of the entry coming back;
//   • for each id, whichever is newest (edit or delete) wins, on both sides.
//   Entries are merged one by one, so two people editing DIFFERENT entries
//   never clash. If you both edit the SAME entry before syncing, the later
//   save wins (phone clocks are normally within seconds of each other).
//
// Nothing about the local database changes: same name, same stores. The
// sync settings and tombstones are two extra keys in the existing "meta"
// store, and backups are untouched.

import * as db from './db.js';
import * as drive from './gdrive.js';
import { blobToDataURL, dataURLToBlob, isDriveRef, photoDriveId, photoEmbeddedData, packDrivePhoto } from './photos.js';

export const APP_VERSION = '14.0'; // shown in Sync details; keep in step with sw.js CACHE_NAME
export const INDEX_NAME = 'hearthbook-sync.json';
export const LEGACY_BUCKETS = 8; // sync v1 kept photos in 8 extra files
export const bucketName = (i) => `hearthbook-photos-${i + 1}.json`;
export const REQUIRED = [INDEX_NAME]; // what the person joining has to pick
const FOLDER_NAME = 'Hearthbook';
const PHOTO_FOLDER_NAME = 'Hearthbook photos';
const SYNC_VERSION = 3; // v3: photos as separate Drive files (pointers in the JSON)

const STATE_KEY = 'sync'; // meta store: settings for this phone
const TOMBS_KEY = 'syncTombstones'; // meta store: { entryId: deletedAtISO }
const CACHE_KEY = 'syncCache'; // meta store: last-seen Drive file (text only), to skip re-downloading
const DIAG_KEY = 'syncDiag'; // meta store: troubleshooting details
const UPLOADS_KEY = 'syncPhotoUploads'; // meta store (v13.8): { photoId: { driveId, size, at } } finished, checked photo uploads
const TIDY_KEY = 'syncPhotoTidy'; // meta store (v13.8): when leftover duplicate photo files were last binned
export const PHOTO_BATCH = 10; // rewrite the sync file after this many photos
const PHOTO_TRIES = 3; // tries per photo before it's skipped for this sync
const PHOTO_WAITS = [1500, 4000]; // short waits between those tries (ms)
const PHOTO_TIMEOUT = 60_000; // one photo upload request may take this long
const EPOCH = '1970-01-01T00:00:00.000Z';
export const isConfigured = drive.isConfigured;

// ---------- status, for the screen ----------
// state: 'unconfigured' | 'off' | 'nofolder' | 'idle' | 'syncing' | 'offline' | 'signin' | 'error'
let status = { state: 'off' };
const listeners = new Set();
export function onStatus(fn) { listeners.add(fn); fn(status); return () => listeners.delete(fn); }
export const getStatus = () => status;
function setStatus(patch) {
  status = { ...status, ...patch };
  listeners.forEach((fn) => { try { fn(status); } catch (e) { console.warn(e); } });
}

export const getConfig = async () => (await db.getMeta(STATE_KEY)) || { enabled: false };
const saveConfig = (c) => db.setMeta(STATE_KEY, c);
const ready = (c) => Boolean(c && c.enabled && c.files && c.files.index);

function baseStatus(c) {
  return { account: c.account || null, folderName: (c.folder && c.folder.name) || '', owner: Boolean(c.folder && c.folder.owner), lastSync: c.lastSync || null, fileSize: c.fileSize ?? null, photosLeft: c.photosLeft || 0 };
}

// Call once at start-up.
let started = false;
export async function init() {
  const c = await getConfig();
  if (!drive.isConfigured()) return setStatus({ state: 'unconfigured' });
  if (!c.enabled) return setStatus({ state: 'off' });
  drive.setResourceKeys(c.resourceKeys);
  setStatus({ ...baseStatus(c), state: ready(c) ? (navigator.onLine ? 'idle' : 'offline') : 'nofolder', message: '' });
  if (!started) {
    started = true;
    addEventListener('online', () => schedule(500));
    addEventListener('offline', () => getConfig().then((k) => ready(k) && setStatus({ state: 'offline', message: '' })));
    document.addEventListener('visibilitychange', () => { if (document.visibilityState === 'visible') schedule(1500); });
    // Quiet token refresh on your next tap (see gdrive.js "sign-in").
    document.addEventListener('click', refreshOnTap, true);
  }
  // Phones connected before v9: remember the account as the sign-in hint.
  if (c.account && c.account.email && !drive.accountHint()) drive.rememberAccount(c.account.email);
  if (ready(c)) { schedule(600); if (navigator.onLine) drive.warmUp(); } // sync on open
}

// When the Google token has run out (or will within 10 minutes), use the
// next ordinary tap to fetch a new one quietly, then carry on syncing. Taps
// on the sync buttons themselves are left alone (they sign in anyway).
const REFRESH_EARLY = 10 * 60_000;
let lastTapRefresh = 0;
async function refreshOnTap(ev) {
  if (!navigator.onLine || drive.tokenLeft() > REFRESH_EARLY) return;
  if (ev.target && ev.target.closest && ev.target.closest('#sync-chip, #sync-signin, #sync-now, #sync-connect, #sync-create, #sync-join, #sync-invite')) return;
  if (Date.now() - lastTapRefresh < 2 * 60_000) return; // don't keep trying on every tap
  const c = await getConfig();
  const hint = drive.accountHint() || (c.account && c.account.email);
  if (!ready(c) || !hint || !drive.isConfigured()) return;
  lastTapRefresh = Date.now();
  try {
    await drive.refreshSilently(hint);
    if (status.state === 'signin' || status.state === 'error') schedule(300);
  } catch (err) {
    console.info('sync: quiet sign-in did not work', err && err.message);
  }
}

// ---------- hooks the app calls ----------
export async function noteChange() {
  const c = await getConfig();
  if (ready(c)) schedule(SYNC_DELAY, true);
}
export async function recordDelete(id) {
  const tombs = (await db.getMeta(TOMBS_KEY)) || {};
  tombs[id] = new Date().toISOString();
  await db.setMeta(TOMBS_KEY, tombs);
  await noteChange();
}
// A saved entry is alive again, so forget any old tombstone for it.
export async function recordSave(id) {
  const tombs = (await db.getMeta(TOMBS_KEY)) || {};
  if (tombs[id]) { delete tombs[id]; await db.setMeta(TOMBS_KEY, tombs); }
  await noteChange();
}

const SYNC_DELAY = 3000; // wait this long after a change, so several edits go up together
let timer = null;
// queue=true only for your own changes: if a sync is already running they
// go up in one more round straight after. Other triggers (opening the app,
// coming back to it, signal back, Sync now) never start a second sync.
function schedule(ms, queue = false) {
  clearTimeout(timer);
  timer = setTimeout(() => syncNow({ queue }).catch(() => {}), ms);
}

// ---------- connecting ----------
// Step 1 (from a tap): sign in and find out who you are.
export async function connect() {
  if (!drive.isConfigured()) throw new Error('Google sync is not set up in this copy of the app yet.');
  drive.forgetToken();
  await drive.getToken({ interactive: true, choose: true });
  const user = await drive.whoAmI();
  drive.rememberAccount(user.emailAddress);
  const c = { ...(await getConfig()), enabled: true, account: { email: user.emailAddress, name: user.displayName } };
  // Already connected to a shared logbook before (e.g. this is your
  // second phone, or you re-installed)? Use it straight away.
  const found = await findExisting();
  if (found) Object.assign(c, { folder: found.folder, files: found.files });
  await saveConfig(c);
  await init();
  if (ready(c)) await syncNow({ interactive: true });
  return c;
}

// ---------- troubleshooting details ----------
export async function getDiag() { return (await db.getMeta(DIAG_KEY)) || {}; }
async function diag(patch) {
  const d = { ...(await getDiag()), ...patch, at: new Date().toISOString() };
  await db.setMeta(DIAG_KEY, d);
  return d;
}
// Which Drive files can this app open right now? (Shown in "Sync details".)
export async function refreshDiag() {
  const c = await getConfig();
  let accessible = [];
  try {
    accessible = (await drive.list(`trashed = false and name contains 'hearthbook'`)).map((f) => ({ id: f.id, name: f.name, parents: (f.parents || []).join(','), version: f.version, size: f.size }));
  } catch (err) { accessible = [{ error: err.message }]; }
  return diag({ accessible, files: c.files || null, layout: c.layout || null });
}

// Look for the shared file this app can already open (yours, or one you
// picked before). Uses a name search; the picker's own answer is used first
// when joining (see joinShared), because searches can lag behind.
async function findExisting() {
  const idx = await drive.list(`name = '${INDEX_NAME}' and trashed = false`);
  for (const f of idx) {
    const parent = (f.parents || [])[0] || '';
    const found = { files: { index: f.id }, folder: { id: parent, name: 'Shared folder', owner: Boolean(f.ownedByMe) } };
    if (parent) {
      try {
        const m = await drive.getMeta(parent);
        found.folder = { id: parent, name: m.name, owner: Boolean(m.capabilities && m.capabilities.canShare) };
      } catch {} // with drive.file you often can't see a folder someone else made — fine
      // Old (v1) photo files next to it, if this app can open them (for the move).
      try {
        const kids = await drive.list(`'${parent}' in parents and trashed = false`);
        const buckets = Array.from({ length: LEGACY_BUCKETS }, (_, i) => (kids.find((k) => k.name === bucketName(i)) || {}).id || null);
        if (buckets.some(Boolean)) found.files.buckets = buckets;
      } catch {}
    }
    return found;
  }
  return null;
}

// Step 2a: "Start a new shared logbook" — creates the folder + the file.
export async function createShared() {
  const c = await getConfig();
  setStatus({ state: 'syncing', message: 'Creating the Hearthbook folder…' });
  try {
    const folder = await drive.createFolder(FOLDER_NAME);
    const index = await drive.createJSON(INDEX_NAME, folder.id, emptyIndex());
    Object.assign(c, { folder: { id: folder.id, name: folder.name || FOLDER_NAME, owner: true }, files: { index: index.id }, layout: 3 });
    await saveConfig(c);
  } catch (err) {
    await fail(err);
    throw err;
  }
  setStatus(baseStatus(c));
  return syncNow({ interactive: true });
}

// Step 2b: "Join a shared logbook" — pick hearthbook-sync.json in Google's
// picker. We trust the picker's answer (file id) and check it directly,
// rather than searching Drive afterwards. Picking several files at once,
// or one at a time over several tries, both work: whatever is linked is
// remembered.
export async function joinShared() {
  const c = await getConfig();
  const linked = { ...(c.pendingLinks || {}) }; // name -> id, from earlier tries
  let picked;
  try {
    picked = await drive.pickFiles({ query: 'hearthbook', title: 'Tap hearthbook-sync.json, then Select' });
  } catch (err) {
    await diag({ picker: { error: err.message } });
    throw err;
  }
  const checks = [];
  const keys = { ...(c.resourceKeys || {}) };
  for (const d of picked.docs) if (d.resourceKey) keys[d.id] = d.resourceKey;
  drive.setResourceKeys(keys);
  for (const d of picked.docs) {
    try {
      const m = await drive.getMetaRetry(d.id);
      checks.push({ id: d.id, name: m.name, ok: true, parent: (m.parents || [])[0] || d.parentId || '' });
      if (m.name === INDEX_NAME) { linked[INDEX_NAME] = d.id; linked.parent = (m.parents || [])[0] || d.parentId || ''; }
      const bi = Array.from({ length: LEGACY_BUCKETS }, (_, i) => bucketName(i)).indexOf(m.name);
      if (bi >= 0) linked[m.name] = d.id;
    } catch (err) {
      checks.push({ id: d.id, name: d.name, ok: false, error: err.message });
    }
  }
  // Nothing usable picked? Maybe it was linked before: try a search.
  if (!linked[INDEX_NAME]) {
    try { const f = await findExisting(); if (f) { linked[INDEX_NAME] = f.files.index; linked.parent = f.folder.id; } } catch {}
  }
  await diag({ picker: { action: picked.action, count: picked.docs.length, docs: picked.docs.map((d) => ({ id: d.id, name: d.name, mimeType: d.mimeType, resourceKey: Boolean(d.resourceKey) })) }, checks });
  c.pendingLinks = linked;
  c.resourceKeys = keys;
  const have = REQUIRED.filter((n) => linked[n]).length;
  if (picked.action === 'cancel' && !have) { await saveConfig(c); return { cancelled: true, have, of: REQUIRED.length }; }
  if (have < REQUIRED.length) {
    await saveConfig(c);
    return { missing: REQUIRED.filter((n) => !linked[n]), have, of: REQUIRED.length, checks };
  }
  const buckets = Array.from({ length: LEGACY_BUCKETS }, (_, i) => linked[bucketName(i)] || null);
  Object.assign(c, {
    files: { index: linked[INDEX_NAME], ...(buckets.some(Boolean) ? { buckets } : {}) },
    folder: { id: linked.parent || '', name: 'Shared folder', owner: false },
  });
  delete c.pendingLinks;
  await saveConfig(c);
  setStatus(baseStatus(c));
  await syncNow({ interactive: true });
  return { ok: true, have, of: REQUIRED.length };
}

export async function invite(email) {
  const c = await getConfig();
  if (!c.folder) throw new Error('No shared folder yet.');
  await drive.getToken({ interactive: true, email: c.account && c.account.email });
  await drive.shareFolder(c.folder.id, email);
}

export async function disconnect() {
  clearTimeout(timer);
  again = false; // a sync that's running stops at its next step (see stillOn)
  await drive.revoke();
  await saveConfig({ enabled: false });
  await db.setMeta(CACHE_KEY, null);
  setStatus({ state: drive.isConfigured() ? 'off' : 'unconfigured', account: null, folderName: '', lastSync: null, message: '' });
}

// ---------- syncing ----------
let running = null;
let again = false;
// "Connected and healthy": joined a shared file, synced within the last
// 7 days and not currently showing a problem. Used to hide the backup
// reminder (Drive holds a copy, photos included).
export async function isHealthy() {
  if (['error', 'signin', 'nofolder', 'unconfigured'].includes(status.state)) return false;
  const c = await getConfig();
  if (!ready(c) || !drive.isConfigured()) return false;
  const last = c.lastSync ? Date.parse(c.lastSync) : 0;
  return Date.now() - last < 7 * 86400000;
}

// One sync at a time (v13.8). In this window: a sync that's running is
// simply joined (Sync now tapped again, the app coming back to the front,
// signal back). Across windows/tabs of the app: a Web Lock, so a second
// window doesn't start its own sync (it answers { busy: true }).
export function syncNow({ interactive = false, queue = false } = {}) {
  if (running) { if (queue) again = true; return running; }
  running = (async () => {
    try {
      return await exclusive(async () => {
        let r;
        do {
          again = false;
          r = await syncCycle(interactive);
        } while (again);
        return r;
      });
    } finally {
      running = null;
    }
  })();
  return running;
}
export const isRunning = () => Boolean(running);

const LOCK_NAME = 'hearthbook-sync';
const LEASE_KEY = 'hearthbook.syncLease';
async function exclusive(fn) {
  if (typeof navigator !== 'undefined' && navigator.locks && navigator.locks.request) {
    return navigator.locks.request(LOCK_NAME, { ifAvailable: true }, async (lock) => {
      if (!lock) { console.info('sync: already running in another Hearthbook window'); return { busy: true }; }
      return fn();
    });
  }
  // No Web Locks (very old browsers): a short lease in localStorage, renewed while we run.
  const me = Math.random().toString(36).slice(2);
  let cur = null;
  try { cur = JSON.parse(localStorage.getItem(LEASE_KEY) || 'null'); } catch {}
  if (cur && cur.until > Date.now()) return { busy: true };
  const beat = () => { try { localStorage.setItem(LEASE_KEY, JSON.stringify({ id: me, until: Date.now() + 30_000 })); } catch {} };
  beat();
  const iv = setInterval(beat, 10_000);
  try { return await fn(); } finally {
    clearInterval(iv);
    try { const now = JSON.parse(localStorage.getItem(LEASE_KEY) || 'null'); if (now && now.id === me) localStorage.removeItem(LEASE_KEY); } catch {}
  }
}

// Is sync still switched on for the same shared file as when this sync
// started? (You may have tapped Disconnect while it was running.) v13:
// settings are re-read and merged, never written back from an old copy.
async function stillOn(c) {
  const now = await getConfig();
  return ready(now) && now.files.index === c.files.index ? now : null;
}
async function updateConfig(c, patch) {
  const now = await stillOn(c);
  if (!now) return null;
  const next = { ...now, ...patch };
  await saveConfig(next);
  return next;
}

async function syncCycle(interactive) {
  const c = await getConfig();
  if (!ready(c)) return;
  if (!navigator.onLine) return setStatus({ ...baseStatus(c), state: 'offline', message: '', progress: null });
  setStatus({ ...baseStatus(c), state: 'syncing', message: '', progress: null });
  const job = photoJob();
  try {
    await drive.getToken({ interactive, email: c.account && c.account.email });
    // Photos are moved in batches: each round uploads up to PHOTO_BATCH new
    // photos, then rewrites the sync file (so it shrinks as it goes). Stops
    // when nothing is left, or a round got nowhere (e.g. signal lost).
    let result, pulled = 0;
    for (let round = 0; ; round++) {
      job.uploadsLeft = PHOTO_BATCH;
      const doneBefore = job.finished.size;
      result = await syncOnce(c, job);
      pulled += result.pulled || 0;
      if (!job.deferred || job.stopped || job.finished.size === doneBefore || round >= 200) break;
      if (!(await stillOn(c))) return;
    }
    result.pulled = pulled;
    // Bin leftover copies of photos this app uploaded twice (and empty
    // files) — only ones the sync file doesn't point at. Never fatal.
    if (job.mapNow) {
      try { result.tidied = await tidyPhotoFiles(job); } catch (err) { console.info('sync: photo tidy skipped', err && err.message); }
    }
    const left = Math.max(0, job.pending.size - job.finished.size);
    result.photosMoved = job.finished.size;
    result.photosLeft = left;
    const saved = await updateConfig(c, { lastSync: new Date().toISOString(), photosLeft: left, ...(result.fileSize != null ? { fileSize: result.fileSize } : {}) });
    if (!saved) return; // disconnected meanwhile: leave sync off
    setStatus({ ...baseStatus(saved), state: 'idle', message: '', progress: null, last: result, count: (status.count || 0) + 1 });
    if (result.pulled) dispatchEvent(new CustomEvent('hearthbook:synced', { detail: result }));
    return result;
  } catch (err) {
    if (!(await stillOn(c))) return;
    // Photos already moved stay moved (remembered on this phone); the next
    // sync carries on from there.
    if (job.pending.size) { try { await updateConfig(c, { photosLeft: Math.max(0, job.pending.size - job.finished.size) }); } catch {} }
    await fail(err, c);
  }
}

async function fail(err, c) {
  const now = await getConfig();
  c = c ? { ...c, photosLeft: now.photosLeft || 0 } : now;
  console.warn('sync:', err);
  status = { ...status, progress: null };
  try { await diag({ lastError: `${err.name || 'Error'}: ${err.message}` }); } catch {}
  if (err instanceof drive.AuthError) setStatus({ ...baseStatus(c), state: 'signin', message: err.message });
  else if (err instanceof drive.OfflineError || !navigator.onLine) setStatus({ ...baseStatus(c), state: 'offline', message: '' });
  else if (err instanceof drive.NotFoundError) setStatus({ ...baseStatus(c), state: 'error', message: 'The shared files can’t be found in Google Drive. They may have been deleted, or the folder is no longer shared with you.' });
  else setStatus({ ...baseStatus(c), state: 'error', message: err.message || String(err) });
}

const emptyIndex = () => ({ format: 'hearthbook-sync', version: SYNC_VERSION, updatedAt: new Date().toISOString(), records: {}, tombstones: {}, photos: {} });
const emptyBucket = () => ({ format: 'hearthbook-photos', version: 1, photos: {} });
function normIndex(d) {
  const e = emptyIndex();
  if (!d || d.format !== 'hearthbook-sync') return e;
  return { ...e, ...d, records: d.records || {}, tombstones: d.tombstones || {}, photos: d.photos || {}, photoIndex: d.photoIndex || {}, photoFolderId: d.photoFolderId || null };
}
const normBucket = (d) => (d && d.photos ? d : emptyBucket());

// Which v1 photo file a photo lived in: a simple hash of its id.
export function bucketOf(photoId) {
  let h = 0;
  for (const ch of String(photoId)) h = (h * 31 + ch.charCodeAt(0)) >>> 0;
  return h % LEGACY_BUCKETS;
}

export { isDriveRef, photoDriveId, photoEmbeddedData, packDrivePhoto };
const photoFileName = (photoId) => `hearthbook-photo-${photoId}.jpg`;

// Find or create the "Hearthbook photos" folder under the shared folder.
// Joiners may not be able to see the parent folder (drive.file): then we
// create the photos folder in their Drive root instead. Either way the
// photo's Drive id is what the sync file stores.
async function ensurePhotoFolder(c) {
  if (c.photoFolderId) {
    try {
      await drive.getMeta(c.photoFolderId);
      return c.photoFolderId;
    } catch { /* recreate below */ }
  }
  const parent = c.folder && c.folder.id;
  if (parent) {
    try {
      const kids = await drive.list(`'${parent}' in parents and trashed = false and mimeType = 'application/vnd.google-apps.folder'`);
      const found = kids.find((k) => k.name === PHOTO_FOLDER_NAME);
      if (found) {
        await updateConfig(c, { photoFolderId: found.id });
        c.photoFolderId = found.id;
        return found.id;
      }
    } catch { /* can't list parent — fine for joiners */ }
  }
  try {
    const folder = await drive.createFolder(PHOTO_FOLDER_NAME, parent || undefined);
    await updateConfig(c, { photoFolderId: folder.id });
    c.photoFolderId = folder.id;
    return folder.id;
  } catch (err) {
    console.warn('sync: could not create photo folder', err && err.message);
    return null;
  }
}

// ---------- moving photos to Drive (v13.8) ----------
// One "job" per sync: what's been moved, skipped or left for the next round.
function photoJob() {
  return {
    uploadsLeft: PHOTO_BATCH, // new uploads allowed before the next sync-file rewrite
    deferred: 0, // photos left for a later round of this sync
    stopped: false, // stop uploading for this sync (sign-in needed, no signal, several failures in a row)
    failRow: 0,
    pending: new Set(), // photo ids that needed a Drive file during this sync
    finished: new Set(), // …and have one now
    skipped: new Set(), // …failed this time (they stay in the sync file / on the phone)
    ids: new Map(), // photo id -> Drive id found or uploaded during this sync
    progress: null, // saved uploads (meta UPLOADS_KEY)
    existing: undefined, // name -> [files] this app made (one listing per sync; null if listing failed)
    folderId: undefined,
    mapNow: null, // the photos map the shared file holds right now (for tidying)
    c: null,
    uploads: 0, reused: 0,
  };
}
const wait = (ms) => new Promise((r) => setTimeout(r, ms));
export const photoIdFromName = (name) => {
  const m = /^hearthbook-photo-(.+)\.jpg$/.exec(String(name || ''));
  return m ? m[1] : null;
};

function emitProgress(job) {
  if (!job.pending.size) return;
  setStatus({ progress: { done: job.finished.size, total: job.pending.size, skipped: job.skipped.size } });
}

// A good existing Drive file for this photo: right size (or, if the size
// isn't known, any non-empty one), not in the bin. Prefers the one this
// phone remembered, then the oldest. Pure; tested.
export function choosePhotoFile(files, size, preferId) {
  const good = (files || []).filter((f) => f && f.id && !f.trashed && f.size != null && Number(f.size) > 0 && (size == null || Number(f.size) === Number(size)));
  if (!good.length) return null;
  const pref = preferId && good.find((f) => f.id === preferId);
  if (pref) return pref;
  const t = (f) => Date.parse(f.createdTime || f.modifiedTime || '') || 0;
  return good.slice().sort((a, b) => t(a) - t(b) || (a.id < b.id ? -1 : 1))[0];
}

async function listPhotoFiles() {
  try {
    const files = await drive.list(`name contains 'hearthbook-photo' and trashed = false`);
    const byName = new Map();
    for (const f of files) {
      if (!photoIdFromName(f.name)) continue;
      if (!byName.has(f.name)) byName.set(f.name, []);
      byName.get(f.name).push(f);
    }
    return byName;
  } catch (err) {
    console.info('sync: could not list photo files', err && err.message);
    return null;
  }
}

async function savedUploads(job) {
  if (!job.progress) job.progress = (await db.getMeta(UPLOADS_KEY)) || {};
  return job.progress;
}
async function remember(job, photoId, meta) {
  const prog = await savedUploads(job);
  prog[photoId] = { driveId: meta.id, size: Number(meta.size) || null, at: new Date().toISOString() };
  await db.setMeta(UPLOADS_KEY, prog); // straight away: a restart carries on from here
}

// Already in Drive? (Uploaded by an earlier sync that was cut off, or by
// this one.) Uses this phone's saved list, the one listing per sync, and
// as a last check the saved file itself.
async function knownUpload(job, photoId, blob) {
  const name = photoFileName(photoId);
  const prog = await savedUploads(job);
  const rec = prog[photoId];
  if (job.existing === undefined) job.existing = await listPhotoFiles();
  const size = blob ? blob.size : null;
  const pick = job.existing ? choosePhotoFile(job.existing.get(name), size, rec && rec.driveId) : null;
  if (pick) {
    if (!rec || rec.driveId !== pick.id) await remember(job, photoId, pick);
    return pick.id;
  }
  if (rec && rec.driveId) {
    try {
      const m = await drive.getMeta(rec.driveId);
      if (choosePhotoFile([m], size)) return m.id;
    } catch (err) {
      if (err instanceof drive.AuthError) throw err;
    }
  }
  return null;
}

async function photoFolder(job) {
  if (job.folderId === undefined) job.folderId = await ensurePhotoFolder(job.c);
  return job.folderId;
}

// Upload one photo, checked. A bad upload (0 bytes or the wrong size) is
// binned and tried again after a short wait; before each try we look
// again for a finished copy, so nothing is uploaded twice. Throws if every
// try failed (the caller skips the photo for this sync).
async function uploadPhotoChecked(job, photoId, blob) {
  const name = photoFileName(photoId);
  let last = null;
  for (let t = 0; t < PHOTO_TRIES; t++) {
    if (t > 0) await wait(PHOTO_WAITS[t - 1] ?? PHOTO_WAITS[PHOTO_WAITS.length - 1]);
    try {
      const same = choosePhotoFile(await drive.list(`name = '${name.replace(/'/g, "\\'")}' and trashed = false`), blob.size);
      if (same) return same;
    } catch (err) {
      if (err instanceof drive.AuthError) throw err;
    }
    let made = null;
    try {
      const parent = await photoFolder(job);
      made = await drive.uploadNewBlob(name, parent, blob, (blob && blob.type) || 'image/jpeg', { hearthbook: 'photo', photoId: String(photoId) }, { timeoutMs: PHOTO_TIMEOUT });
      if (made && made.id && (made.size == null || made.unchecked)) made = await drive.getMeta(made.id);
      if (!made || !made.id) throw new Error('Google Drive did not confirm the photo upload.');
      if (made.size == null || Number(made.size) !== blob.size) {
        const bad = made;
        made = null;
        try { await drive.trash(bad.id); } catch {}
        throw new Error(`Photo upload came out ${bad.size ?? '?'} bytes instead of ${blob.size}.`);
      }
      return made;
    } catch (err) {
      if (err && err.createdId) { try { await drive.trash(err.createdId); } catch {} }
      last = err;
      console.warn('sync: photo upload try failed', photoId, t + 1, err && err.message);
      if (err instanceof drive.AuthError) throw err;
      if (err instanceof drive.OfflineError && !navigator.onLine) throw err;
    }
  }
  throw last || new Error('Photo upload failed.');
}

// The Drive id to store for a photo that has none yet: found, uploaded,
// or null (skipped this time, or left for the next round of this sync).
async function driveIdFor(job, photoId, blob) {
  job.pending.add(photoId);
  if (job.ids.has(photoId)) return job.ids.get(photoId);
  if (job.skipped.has(photoId)) return null;
  const found = await knownUpload(job, photoId, blob);
  if (found) {
    job.ids.set(photoId, found); job.finished.add(photoId); job.reused++;
    emitProgress(job);
    return found;
  }
  if (job.stopped || job.uploadsLeft <= 0) { job.deferred++; return null; }
  job.uploadsLeft--;
  emitProgress(job);
  try {
    const meta = await uploadPhotoChecked(job, photoId, blob);
    await remember(job, photoId, meta);
    job.ids.set(photoId, meta.id); job.finished.add(photoId); job.uploads++;
    job.failRow = 0;
    emitProgress(job);
    return meta.id;
  } catch (err) {
    job.skipped.add(photoId);
    job.failRow++;
    if (err instanceof drive.AuthError || (err instanceof drive.OfflineError && !navigator.onLine) || job.failRow >= 3) job.stopped = true;
    console.warn('sync: photo skipped this time (it stays in the sync file / on this phone)', photoId, err && err.message);
    emitProgress(job);
    return null;
  }
}

// Which leftover photo files to move to the bin. Only files this app made
// (that's all drive.file lets it see), named hearthbook-photo-<id>.jpg,
// more than a few minutes old, NOT pointed at by the sync file, and either
// empty (0 bytes) or a spare copy of a photo whose pointer is another file.
// Pure; tested.
export function planPhotoTidy(files, photosMap, now = Date.now(), minAgeMs = 5 * 60_000) {
  const map = photosMap || {};
  const referenced = new Set(Object.values(map).map((v) => photoDriveId(v)).filter(Boolean));
  const out = [];
  for (const f of files || []) {
    const pid = photoIdFromName(f && f.name);
    if (!pid || f.trashed || referenced.has(f.id)) continue;
    const t = Date.parse(f.createdTime || f.modifiedTime || '');
    if (!t || now - t < minAgeMs) continue;
    const empty = f.size != null && Number(f.size) === 0;
    const ref = photoDriveId(map[pid]);
    if (empty || (ref && ref !== f.id)) out.push(f);
  }
  return out;
}

async function tidyPhotoFiles(job) {
  const last = await db.getMeta(TIDY_KEY);
  if (!job.finished.size && last && Date.now() - Date.parse(last.at) < 86400_000) return null;
  const listing = await listPhotoFiles();
  if (!listing) return null;
  const files = [].concat(...listing.values());
  const bin = planPhotoTidy(files, job.mapNow);
  let trashed = 0;
  for (const f of bin) {
    try { await drive.trash(f.id); trashed++; } catch (err) {
      if (err instanceof drive.AuthError) break;
    }
  }
  await db.setMeta(TIDY_KEY, { at: new Date().toISOString(), trashed, looked: files.length });
  return { trashed, looked: files.length };
}

// Turn whatever is in the sync file's photos map into a Blob for this phone.
async function blobFromRemotePhoto(value) {
  const embedded = photoEmbeddedData(value);
  if (embedded) return dataURLToBlob(embedded);
  const driveId = photoDriveId(value);
  if (driveId) {
    try { return await drive.readBlob(driveId); } catch (err) {
      console.info('sync: photo Drive download skipped', driveId, err && err.message);
      return null;
    }
  }
  return null;
}

// Build the photos map to write: Drive pointers, with embedded bytes only
// when the other phone may not have them yet (first publish of this photo).
async function buildPhotosMap(used, remotePhotos, localBlobs, job, previousDriveOnly, canMigrate = true) {
  const photos = {};
  const remote = remotePhotos || {};
  // Count what needs moving first, so the screen can say "12 of 38".
  for (const id of used) {
    const ex = remote[id];
    if (!photoDriveId(ex) && localBlobs.get(id) && (canMigrate || !photoEmbeddedData(ex))) job.pending.add(id);
  }
  emitProgress(job);
  for (const id of used) {
    const existing = remote[id];
    let driveId = photoDriveId(existing);
    let blob = localBlobs.get(id) || null;
    // Prefer an existing Drive file; otherwise upload from this phone
    // (checked, remembered, at most PHOTO_BATCH per round; see driveIdFor).
    // v13.8: photos already inside the shared file are moved by the phone
    // that owns it (Matthew's), not by a phone that joined: so a joiner
    // never fills its own Drive with copies. New photos: whoever adds them.
    if (!driveId && blob && (canMigrate || !photoEmbeddedData(existing))) driveId = await driveIdFor(job, id, blob);
    if (driveId) {
      // Include image bytes only the first time this Drive id is published,
      // so the other phone can cache them (drive.file can't open files this
      // phone created). Later syncs keep the pointer only and the file stays small.
      // v13.8: bytes that were already in the shared file (v2 layout) have
      // been published to the other phone, so moving them writes the pointer
      // only and the file shrinks with every batch.
      const alreadyPublished = photoDriveId(existing) === driveId
        || (previousDriveOnly && previousDriveOnly.has(id) && previousDriveOnly.get(id) === driveId)
        || Boolean(photoEmbeddedData(existing) && !photoDriveId(existing));
      let data = null;
      if (!alreadyPublished) {
        if (!blob && photoEmbeddedData(existing)) data = photoEmbeddedData(existing);
        else if (blob) data = await blobToDataURL(blob);
      }
      photos[id] = packDrivePhoto(driveId, { data });
      continue;
    }
    // No Drive id (offline upload failed, or no local blob): fall back to
    // whatever we already have, or embed from this phone.
    if (typeof existing === 'string' && existing.startsWith('data:image/')) photos[id] = existing;
    else if (photoEmbeddedData(existing)) photos[id] = photoEmbeddedData(existing);
    else if (blob) photos[id] = await blobToDataURL(blob);
  }
  return photos;
}

// Same photos map? (Same ids, same Drive ids, same embedded bytes.)
export function samePhotos(a, b) {
  const ka = Object.keys(a || {}), kb = Object.keys(b || {});
  if (ka.length !== kb.length) return false;
  for (const k of ka) {
    const x = a[k], y = (b || {})[k];
    if (y === undefined) return false;
    if (photoDriveId(x) !== photoDriveId(y)) return false;
    if (photoEmbeddedData(x) !== photoEmbeddedData(y)) return false;
  }
  return true;
}

// Saved uploads the shared file now points at don't need remembering.
async function forgetPublishedUploads(job, photos) {
  const prog = await savedUploads(job);
  let changed = false;
  for (const [id, rec] of Object.entries(prog)) {
    if (rec && photoDriveId(photos[id]) === rec.driveId) { delete prog[id]; changed = true; }
  }
  if (changed) await db.setMeta(UPLOADS_KEY, prog);
}

// Ids whose sync value is a Drive pointer with no embedded image bytes.
export function driveOnlyPhotoIds(photosMap) {
  const out = new Map();
  for (const [id, value] of Object.entries(photosMap || {})) {
    if (photoDriveId(value) && !photoEmbeddedData(value)) out.set(id, photoDriveId(value));
  }
  return out;
}


// Entries saved before sync existed may lack updatedAt: treat them as old
// (createdAt, or 1970). Nothing is written back, so this is non-destructive.
export const stamp = (e) => (e && (e.updatedAt || e.createdAt)) || EPOCH;
const strip = (e) => ({ ...e, photos: (e.photos || []).map((p) => ({ id: p.id })) });

// Decide, per entry id, who wins. Pure function (tested on its own).
export function plan(localEntries, localTombs, remote) {
  const L = new Map(localEntries.map((e) => [e.id, e]));
  const out = { records: { ...remote.records }, tombstones: { ...remote.tombstones }, toLocal: [], deleteLocal: [], tombs: { ...localTombs }, remoteChanged: false, pushed: 0 };
  const ids = new Set([...L.keys(), ...Object.keys(localTombs), ...Object.keys(remote.records), ...Object.keys(remote.tombstones)]);
  for (const id of ids) {
    const l = L.get(id), lt = localTombs[id], r = remote.records[id], rt = remote.tombstones[id];
    const cands = [];
    if (r) cands.push({ kind: 'live', src: 'remote', t: stamp(r) });
    if (l) cands.push({ kind: 'live', src: 'local', t: stamp(l) });
    if (rt) cands.push({ kind: 'del', src: 'remote', t: rt });
    if (lt) cands.push({ kind: 'del', src: 'local', t: lt });
    // newest wins; on an exact tie a delete wins, then the Drive copy
    cands.sort((a, b) => (a.t < b.t ? 1 : a.t > b.t ? -1 : a.kind !== b.kind ? (a.kind === 'del' ? -1 : 1) : a.src === 'remote' ? -1 : 1));
    const w = cands[0];
    if (w.kind === 'del') {
      if (r || rt !== w.t) { delete out.records[id]; out.tombstones[id] = w.t; out.remoteChanged = true; if (w.src === 'local') out.pushed++; }
      if (l) out.deleteLocal.push(id);
      out.tombs[id] = w.t;
    } else if (w.src === 'local') {
      out.records[id] = strip(l);
      if (rt) delete out.tombstones[id];
      if (!r || stamp(r) !== stamp(l) || rt) { out.remoteChanged = true; out.pushed++; }
      delete out.tombs[id];
    } else {
      if (!l || stamp(l) !== stamp(r)) out.toLocal.push(r);
      delete out.tombs[id];
    }
  }
  return out;
}

// Tombstones to keep after a sync. `before` = what the sync started from,
// `now` = what's there at the end, `planned` = what the sync decided. Any id
// that changed on this phone during the sync (a new delete, or a restore
// that cleared one) keeps the phone's current value. Pure; tested.
export function mergeTombs(before, now, planned) {
  const out = { ...planned };
  const ids = new Set([...Object.keys(before || {}), ...Object.keys(now || {})]);
  for (const id of ids) {
    const b = (before || {})[id], n = (now || {})[id];
    if (b === n) continue; // untouched during the sync
    if (n) out[id] = out[id] && out[id] > n ? out[id] : n;
    else delete out[id];
  }
  return out;
}

// Restoring a backup while sync is on (H1, v13). An entry that was deleted
// (a tombstone here or in the Drive copy we last saw), or that is missing
// here and not alive in that Drive copy, gets a fresh updatedAt and loses
// its tombstone, so the restore wins instead of the old delete. Entries the
// Drive copy still has are left as they are. Nothing else changes. Pure.
//   entries: restored entries; localIds: Set of ids on this phone now;
//   tombs: this phone's tombstones; remote: last-seen Drive text (or null).
export function reviveRestored(entries, localIds, tombs, remote, now = new Date().toISOString()) {
  const outTombs = { ...(tombs || {}) };
  const revived = [];
  const out = entries.map((e) => {
    const deleted = Boolean(outTombs[e.id]) || Boolean(remote && remote.tombstones && remote.tombstones[e.id]);
    const missing = !localIds.has(e.id);
    const alive = Boolean(remote && remote.records && remote.records[e.id]);
    if (deleted || (missing && !alive)) {
      delete outTombs[e.id];
      revived.push(e.id);
      return { ...e, updatedAt: now };
    }
    return e;
  });
  return { entries: out, tombs: outTombs, revived };
}
export const TOMBSTONES_KEY = TOMBS_KEY;
export const CACHE_META_KEY = CACHE_KEY;

// The last photos map this phone wrote (v13.8), so the next round of the
// same sync doesn't download the whole file again.
let lastWrite = null;

async function syncOnce(c, job = photoJob()) {
  job.c = c;
  for (let attempt = 0; attempt < 4; attempt++) {
    job.deferred = 0;
    job.mapNow = null;
    const before = await drive.getMeta(c.files.index);
    let fileSize = before.size != null ? Number(before.size) : null;
    // Unchanged since last time? Use our saved copy of the text and skip
    // re-downloading the shared file.
    const cache = await db.getMeta(CACHE_KEY);
    let remote, full = false;
    if (cache && cache.fileId === c.files.index && cache.version === before.version) {
      remote = normIndex({ format: 'hearthbook-sync', ...cache.index, photos: {} });
      remote.photoIds = cache.photoIds || [];
    } else {
      remote = normIndex(await drive.readJSON(c.files.index));
      remote.photoIds = Object.keys(remote.photos);
      full = true;
    }
    const download = async () => {
      if (full) return;
      if (lastWrite && lastWrite.fileId === c.files.index && lastWrite.version === before.version) {
        remote.photos = lastWrite.photos;
        remote.photoIds = Object.keys(lastWrite.photos);
        full = true;
        return;
      }
      const fresh = normIndex(await drive.readJSON(c.files.index));
      remote.photos = fresh.photos;
      remote.photoIds = Object.keys(fresh.photos);
      full = true;
    };

    const local = await db.getAllEntries();
    const localTombs = (await db.getMeta(TOMBS_KEY)) || {};
    const p = plan(local, localTombs, remote);
    const localById = new Map(local.map((e) => [e.id, e]));
    const localBlobs = new Map();
    for (const e of local) for (const ph of e.photos || []) if (ph.blob) localBlobs.set(ph.id, ph.blob);

    // Old v1 photo files (only readable by the phone that made them).
    const buckets = {};
    const legacy = async (id) => {
      const i = remote.photoIndex[id] ?? bucketOf(id);
      const fid = c.files.buckets && c.files.buckets[i];
      if (!fid) return null;
      try { buckets[i] = buckets[i] || normBucket(await drive.readJSON(fid)); } catch { buckets[i] = emptyBucket(); }
      return buckets[i].photos[id] || null;
    };
    const remoteHas = new Set(remote.photoIds);
    // Resolve a photo id to a Blob: local cache, embedded sync bytes, Drive
    // file, or a leftover v1 photo bucket.
    const loadPhotoBlob = async (id) => {
      if (localBlobs.has(id)) return localBlobs.get(id);
      if (remoteHas.has(id)) {
        await download();
        const value = remote.photos[id];
        if (value) {
          const blob = await blobFromRemotePhoto(value);
          if (blob) return blob;
        }
      }
      const legacyData = await legacy(id);
      if (legacyData) {
        if (typeof legacyData === 'string') return dataURLToBlob(legacyData);
        return blobFromRemotePhoto(legacyData);
      }
      return null;
    };

    // Entries to write here: the other phone's changes, plus repairs for
    // entries whose photos didn't arrive last time (e.g. before the move).
    const incoming = [...p.toLocal];
    const incomingIds = new Set(incoming.map((r) => r.id));
    for (const [id, rec] of Object.entries(p.records)) {
      const l = localById.get(id);
      if (!l || incomingIds.has(id) || stamp(l) !== stamp(rec)) continue;
      const have = new Set((l.photos || []).filter((x) => x.blob).map((x) => x.id));
      const canGet = (pid) => remoteHas.has(pid) || (c.files.buckets && remote.photoIndex[pid] !== undefined);
      if ((rec.photos || []).some((ph) => !have.has(ph.id) && canGet(ph.id))) incoming.push(rec);
    }
    const toSave = [];
    for (const r of incoming) {
      const photos = [];
      for (const ph of r.photos || []) {
        const blob = await loadPhotoBlob(ph.id);
        if (blob) photos.push({ id: ph.id, blob });
      }
      toSave.push({ ...r, photos });
    }

    // Photos the shared file should point at = those used by live entries.
    const used = new Set();
    for (const rec of Object.values(p.records)) for (const ph of rec.photos || []) used.add(ph.id);
    const previousDriveOnly = new Map(Object.entries(cache && cache.driveOnlyPhotos || {}));
    // Also treat remote thin Drive refs as "already published" so we don't
    // re-embed every photo on every sync after migration.
    if (full) {
      for (const [id, value] of Object.entries(remote.photos || {})) {
        if (photoDriveId(value) && !photoEmbeddedData(value)) previousDriveOnly.set(id, photoDriveId(value));
      }
    } else if (cache && cache.driveOnlyPhotos) {
      for (const [id, did] of Object.entries(cache.driveOnlyPhotos)) previousDriveOnly.set(id, did);
    }
    // Only the phone that owns the shared file moves photos already in it (v13.8).
    const canMigrate = Boolean(before.ownedByMe) || Boolean(c.folder && c.folder.owner);
    const needsMigrate = [...used].some((id) => {
      if (!localBlobs.has(id) || job.skipped.has(id)) return false;
      if (!remoteHas.has(id)) return true; // we can supply a brand-new photo
      // Cache hit: photos map not loaded — migrate only if last sync did not
      // already store this id as a thin Drive pointer.
      if (!full) return canMigrate && !previousDriveOnly.has(id);
      // Full download: migrate when the shared value still has no Drive id.
      return !photoDriveId(remote.photos[id]) && (canMigrate || !photoEmbeddedData(remote.photos[id]));
    });
    // Need the photo map when migrating, even if cache skipped the download.
    const supplyable = [...used].filter((id) => !remoteHas.has(id) && (localBlobs.has(id) || (c.files.buckets && remote.photoIndex[id] !== undefined)));
    const unused = [...remoteHas].filter((id) => !used.has(id));
    const legacyLeft = Object.keys(remote.photoIndex).length > 0 || (remote.version && remote.version < SYNC_VERSION);
    // Strip embedded bytes once a Drive id is known on both sides of a sync.
    // Any photo that still carries embedded bytes alongside a Drive id should
    // be rewritten pointer-only so the shared file shrinks after migration.
    const fatLeft = full && [...used].some((id) => photoEmbeddedData(remote.photos[id]) && photoDriveId(remote.photos[id]));
    const shouldWrite = p.remoteChanged || supplyable.length || unused.length || needsMigrate || fatLeft || (legacyLeft && (c.files.buckets || needsMigrate || full));

    if (shouldWrite) {
      await download(); // need the current photos map to rewrite
      // Pull any still-embedded / legacy bytes into localBlobs so we can upload.
      for (const id of used) {
        if (localBlobs.has(id)) continue;
        const value = remote.photos[id];
        if (photoEmbeddedData(value) || typeof value === 'string') {
          try {
            const blob = await blobFromRemotePhoto(value);
            if (blob) localBlobs.set(id, blob);
          } catch {}
        } else {
          const legacyData = await legacy(id);
          if (legacyData) {
            try {
              const blob = typeof legacyData === 'string' ? await dataURLToBlob(legacyData) : await blobFromRemotePhoto(legacyData);
              if (blob) localBlobs.set(id, blob);
            } catch {}
          }
        }
      }
      const photos = await buildPhotosMap(used, remote.photos, localBlobs, job, previousDriveOnly, canMigrate);
      // v1 leftovers we still couldn't move (rare).
      const photoIndex = {};
      for (const [id, i] of Object.entries(remote.photoIndex)) if (used.has(id) && !photos[id]) photoIndex[id] = i;
      const out = { format: 'hearthbook-sync', version: SYNC_VERSION, updatedAt: new Date().toISOString(), records: p.records, tombstones: p.tombstones, photos };
      if (Object.keys(photoIndex).length) out.photoIndex = photoIndex;
      if (c.photoFolderId) out.photoFolderId = c.photoFolderId;
      // Nothing would actually change (e.g. the only photo left to move
      // failed again)? Then don't rewrite the file.
      const photosOnly = !p.remoteChanged && !supplyable.length && !unused.length && !legacyLeft && !Object.keys(photoIndex).length;
      if (photosOnly && samePhotos(remote.photos, photos)) {
        job.mapNow = remote.photos;
      } else {
      // If the other phone wrote the file while we were busy, start again
      // with its version, so neither phone's changes are lost. (Photos
      // uploaded meanwhile are remembered, so they aren't uploaded again.)
      const now = await drive.getMeta(c.files.index);
      if (now.version !== before.version) continue;
      if (!(await stillOn(c))) throw new Error('Sync was switched off.');
      const written = await drive.writeJSON(c.files.index, out);
      fileSize = written && written.size != null ? Number(written.size) : null;
      lastWrite = written && written.version != null ? { fileId: c.files.index, version: written.version, photos } : null;
      job.mapNow = photos;
      await forgetPublishedUploads(job, photos);
      const driveOnly = Object.fromEntries(driveOnlyPhotoIds(photos));
      await db.setMeta(CACHE_KEY, {
        fileId: c.files.index,
        version: written && written.version,
        index: { records: out.records, tombstones: out.tombstones, photoIndex: out.photoIndex || {}, version: SYNC_VERSION, photoFolderId: out.photoFolderId },
        photoIds: Object.keys(photos),
        driveOnlyPhotos: driveOnly,
      });
      if (!c.layout || c.layout < 3) { c.layout = 3; await updateConfig(c, { layout: 3, ...(out.photoFolderId ? { photoFolderId: out.photoFolderId } : {}) }); }
      }
    } else if (full) {
      job.mapNow = remote.photos;
      const driveOnly = Object.fromEntries(driveOnlyPhotoIds(remote.photos));
      await db.setMeta(CACHE_KEY, {
        fileId: c.files.index,
        version: before.version,
        index: { records: remote.records, tombstones: remote.tombstones, photoIndex: remote.photoIndex, version: remote.version, photoFolderId: remote.photoFolderId },
        photoIds: remote.photoIds,
        driveOnlyPhotos: driveOnly,
      });
      if (remote.photoFolderId && !c.photoFolderId) await updateConfig(c, { photoFolderId: remote.photoFolderId });
      if (remote.version >= 3 && (!c.layout || c.layout < 3)) await updateConfig(c, { layout: 3 });
    }

    // Apply the other phone's changes here (unless you saved something
    // newer on this phone while we were syncing).
    // v13: deletes (and restores) made on this phone WHILE we were syncing
    // win over what this sync worked out from its earlier snapshot.
    const tombsNow = (await db.getMeta(TOMBS_KEY)) || {};
    const tombs = mergeTombs(localTombs, tombsNow, p.tombs);
    const fresh = new Map((await db.getAllEntries()).map((e) => [e.id, e]));
    const keep = toSave.filter((r) => (!fresh.has(r.id) || stamp(fresh.get(r.id)) <= stamp(r)) && !(tombsNow[r.id] && tombsNow[r.id] !== localTombs[r.id] && tombsNow[r.id] >= stamp(r)));
    if (keep.length) await db.saveManyEntries(keep);
    const gone = p.deleteLocal.filter((id) => fresh.has(id) && stamp(fresh.get(id)) <= p.tombs[id]);
    for (const id of gone) await db.deleteEntry(id);
    await db.setMeta(TOMBS_KEY, tombs);
    const waiting = [...used].filter((id) => !localBlobs.has(id) && !keep.some((k) => (k.photos || []).some((x) => x.id === id))).length;
    return { pulled: keep.length + gone.length, pushed: p.pushed, photosWaiting: waiting, fileSize };
  }
  throw new Error('Google Drive kept changing while syncing. It will try again shortly.');
}

// "Synced 3 min ago"
export function ago(iso) {
  if (!iso) return 'never';
  const s = Math.max(0, (Date.now() - new Date(iso)) / 1000);
  if (s < 45) return 'just now';
  if (s < 3600) return `${Math.round(s / 60)} min ago`;
  if (s < 86400) return `${Math.round(s / 3600)} h ago`;
  return new Date(iso).toLocaleString('en-GB', { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' });
}
