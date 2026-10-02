// =====================================================================
// sync.js — keep one logbook on two phones, via a shared Drive folder.
// =====================================================================
// OFF by default. When it's off nothing here touches the network, and the
// app works exactly as before (phone-only, offline).
//
// WHAT'S IN THE SHARED FOLDER ("Hearthbook" in Google Drive):
//   hearthbook-sync.json   ONE file: every entry's text, a "tombstone" for
//                          each deleted entry, and the photos.
// One file on purpose. The app uses the low-privilege drive.file
// permission, so it can only open files it created or that you picked in
// Google's file picker. Picking a folder does NOT unlock the files inside,
// and the other phone can't see files created later. With a single file,
// your partner picks it once and that's it.
// (Version 1 of sync spread photos over 8 extra files. The first phone to
// sync with this version copies them into hearthbook-sync.json; the old
// files are left alone, and you can delete them later.)
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
import { blobToDataURL, dataURLToBlob } from './photos.js';

export const INDEX_NAME = 'hearthbook-sync.json';
export const LEGACY_BUCKETS = 8; // sync v1 kept photos in 8 extra files
export const bucketName = (i) => `hearthbook-photos-${i + 1}.json`;
export const REQUIRED = [INDEX_NAME]; // what the person joining has to pick
const FOLDER_NAME = 'Hearthbook';
const STATE_KEY = 'sync'; // meta store: settings for this phone
const TOMBS_KEY = 'syncTombstones'; // meta store: { entryId: deletedAtISO }
const CACHE_KEY = 'syncCache'; // meta store: last-seen Drive file (text only), to skip re-downloading
const DIAG_KEY = 'syncDiag'; // meta store: troubleshooting details
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
  return { account: c.account || null, folderName: (c.folder && c.folder.name) || '', owner: Boolean(c.folder && c.folder.owner), lastSync: c.lastSync || null };
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
  }
  if (ready(c)) schedule(600); // sync on open
}

// ---------- hooks the app calls ----------
export async function noteChange() {
  const c = await getConfig();
  if (ready(c)) schedule(SYNC_DELAY);
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
function schedule(ms) {
  clearTimeout(timer);
  timer = setTimeout(() => syncNow().catch(() => {}), ms);
}

// ---------- connecting ----------
// Step 1 (from a tap): sign in and find out who you are.
export async function connect() {
  if (!drive.isConfigured()) throw new Error('Google sync is not set up in this copy of the app yet.');
  drive.forgetToken();
  await drive.getToken({ interactive: true });
  const user = await drive.whoAmI();
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
    Object.assign(c, { folder: { id: folder.id, name: folder.name || FOLDER_NAME, owner: true }, files: { index: index.id }, layout: 2 });
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

export function syncNow({ interactive = false } = {}) {
  if (running) { again = true; return running; }
  running = (async () => {
    try {
      do {
        again = false;
        await syncCycle(interactive);
      } while (again);
    } finally {
      running = null;
    }
  })();
  return running;
}

async function syncCycle(interactive) {
  const c = await getConfig();
  if (!ready(c)) return;
  if (!navigator.onLine) return setStatus({ ...baseStatus(c), state: 'offline', message: '' });
  setStatus({ ...baseStatus(c), state: 'syncing', message: '' });
  try {
    await drive.getToken({ interactive, email: c.account && c.account.email });
    const result = await syncOnce(c);
    c.lastSync = new Date().toISOString();
    await saveConfig(c);
    setStatus({ ...baseStatus(c), state: 'idle', message: '', last: result, count: (status.count || 0) + 1 });
    if (result.pulled) dispatchEvent(new CustomEvent('hearthbook:synced', { detail: result }));
  } catch (err) {
    await fail(err, c);
  }
}

async function fail(err, c) {
  c = c || (await getConfig());
  console.warn('sync:', err);
  try { await diag({ lastError: `${err.name || 'Error'}: ${err.message}` }); } catch {}
  if (err instanceof drive.AuthError) setStatus({ ...baseStatus(c), state: 'signin', message: err.message });
  else if (err instanceof drive.OfflineError || !navigator.onLine) setStatus({ ...baseStatus(c), state: 'offline', message: '' });
  else if (err instanceof drive.NotFoundError) setStatus({ ...baseStatus(c), state: 'error', message: 'The shared files can’t be found in Google Drive. They may have been deleted, or the folder is no longer shared with you.' });
  else setStatus({ ...baseStatus(c), state: 'error', message: err.message || String(err) });
}

const emptyIndex = () => ({ format: 'hearthbook-sync', version: 2, updatedAt: new Date().toISOString(), records: {}, tombstones: {}, photos: {} });
const emptyBucket = () => ({ format: 'hearthbook-photos', version: 1, photos: {} });
function normIndex(d) {
  const e = emptyIndex();
  if (!d || d.format !== 'hearthbook-sync') return e;
  return { ...e, ...d, records: d.records || {}, tombstones: d.tombstones || {}, photos: d.photos || {}, photoIndex: d.photoIndex || {} };
}
const normBucket = (d) => (d && d.photos ? d : emptyBucket());

// Which v1 photo file a photo lived in: a simple hash of its id.
export function bucketOf(photoId) {
  let h = 0;
  for (const ch of String(photoId)) h = (h * 31 + ch.charCodeAt(0)) >>> 0;
  return h % LEGACY_BUCKETS;
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

async function syncOnce(c) {
  for (let attempt = 0; attempt < 4; attempt++) {
    const before = await drive.getMeta(c.files.index);
    // Unchanged since last time? Use our saved copy of the text and skip
    // downloading the (photo-heavy) file.
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
    const photoData = async (id) => {
      if (remoteHas.has(id)) { await download(); if (remote.photos[id]) return remote.photos[id]; }
      return legacy(id);
    };

    // Entries to write here: the other phone's changes, plus repairs for
    // entries whose photos didn't arrive last time (e.g. before the move).
    const incoming = [...p.toLocal];
    const incomingIds = new Set(incoming.map((r) => r.id));
    for (const [id, rec] of Object.entries(p.records)) {
      const l = localById.get(id);
      if (!l || incomingIds.has(id) || stamp(l) !== stamp(rec)) continue;
      const have = new Set((l.photos || []).filter((x) => x.blob).map((x) => x.id));
      const canGet = (id) => remoteHas.has(id) || (c.files.buckets && remote.photoIndex[id] !== undefined);
      if ((rec.photos || []).some((ph) => !have.has(ph.id) && canGet(ph.id))) incoming.push(rec);
    }
    const toSave = [];
    for (const r of incoming) {
      const photos = [];
      for (const ph of r.photos || []) {
        let blob = localBlobs.get(ph.id);
        if (!blob) { const data = await photoData(ph.id); if (data) blob = await dataURLToBlob(data); }
        if (blob) photos.push({ id: ph.id, blob });
      }
      toSave.push({ ...r, photos });
    }

    // Photos the shared file should hold = those used by live entries.
    const used = new Set();
    for (const rec of Object.values(p.records)) for (const ph of rec.photos || []) used.add(ph.id);
    const supplyable = [...used].filter((id) => !remoteHas.has(id) && (localBlobs.has(id) || (c.files.buckets && remote.photoIndex[id] !== undefined)));
    const unused = [...remoteHas].filter((id) => !used.has(id));
    const legacyLeft = Object.keys(remote.photoIndex).length > 0 || remote.version !== 2;

    if (p.remoteChanged || supplyable.length || unused.length || (legacyLeft && c.files.buckets)) {
      await download(); // need the current photos to write the whole file back
      const photos = {};
      for (const id of used) {
        let data = remote.photos[id];
        if (!data && localBlobs.has(id)) data = await blobToDataURL(localBlobs.get(id));
        if (!data) data = await legacy(id);
        if (data) photos[id] = data;
      }
      // v1 -> v2: keep pointers only for photos we still couldn't move.
      const photoIndex = {};
      for (const [id, i] of Object.entries(remote.photoIndex)) if (used.has(id) && !photos[id]) photoIndex[id] = i;
      const out = { format: 'hearthbook-sync', version: 2, updatedAt: new Date().toISOString(), records: p.records, tombstones: p.tombstones, photos };
      if (Object.keys(photoIndex).length) out.photoIndex = photoIndex;
      // If the other phone wrote the file while we were busy, start again
      // with its version, so neither phone's changes are lost.
      const now = await drive.getMeta(c.files.index);
      if (now.version !== before.version) continue;
      const written = await drive.writeJSON(c.files.index, out);
      await db.setMeta(CACHE_KEY, { fileId: c.files.index, version: written && written.version, index: { records: out.records, tombstones: out.tombstones, photoIndex: out.photoIndex || {}, version: 2 }, photoIds: Object.keys(photos) });
      if (!c.layout || c.layout < 2) { c.layout = 2; await saveConfig(c); }
    } else if (full) {
      await db.setMeta(CACHE_KEY, { fileId: c.files.index, version: before.version, index: { records: remote.records, tombstones: remote.tombstones, photoIndex: remote.photoIndex, version: remote.version }, photoIds: remote.photoIds });
    }

    // Apply the other phone's changes here (unless you saved something
    // newer on this phone while we were syncing).
    const fresh = new Map((await db.getAllEntries()).map((e) => [e.id, e]));
    const keep = toSave.filter((r) => !fresh.has(r.id) || stamp(fresh.get(r.id)) <= stamp(r));
    if (keep.length) await db.saveManyEntries(keep);
    const gone = p.deleteLocal.filter((id) => fresh.has(id) && stamp(fresh.get(id)) <= p.tombs[id]);
    for (const id of gone) await db.deleteEntry(id);
    await db.setMeta(TOMBS_KEY, p.tombs);
    const waiting = [...used].filter((id) => !localBlobs.has(id) && !keep.some((k) => (k.photos || []).some((x) => x.id === id))).length;
    return { pulled: keep.length + gone.length, pushed: p.pushed, photosWaiting: waiting };
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
