// =====================================================================
// sync.js — keep one logbook on two phones, via a shared Drive folder.
// =====================================================================
// OFF by default. When it's off nothing here touches the network, and the
// app works exactly as before (phone-only, offline).
//
// WHAT'S IN THE SHARED FOLDER ("Hearthbook" in Google Drive):
//   hearthbook-sync.json        every entry's text (no photos), plus a
//                               "tombstone" for each deleted entry
//   hearthbook-photos-1…8.json  the photos, spread over 8 files by photo id
// It's a fixed set of 9 files on purpose: with the low-privilege drive.file
// permission, the app can only open files it created or that you picked in
// Google's file picker. A fixed set means your partner picks them ONCE and
// never has to again. (Section 9 of HOW-IT-WORKS.md explains the choice.)
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
export const PHOTO_BUCKETS = 8;
export const bucketName = (i) => `hearthbook-photos-${i + 1}.json`;
export const ALL_NAMES = [INDEX_NAME, ...Array.from({ length: PHOTO_BUCKETS }, (_, i) => bucketName(i))];
const FOLDER_NAME = 'Hearthbook';
const STATE_KEY = 'sync'; // meta store: settings for this phone
const TOMBS_KEY = 'syncTombstones'; // meta store: { entryId: deletedAtISO }
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
const ready = (c) => Boolean(c && c.enabled && c.files && c.files.index && c.files.buckets && c.files.buckets.length === PHOTO_BUCKETS);

function baseStatus(c) {
  return { account: c.account || null, folderName: (c.folder && c.folder.name) || '', owner: Boolean(c.folder && c.folder.owner), lastSync: c.lastSync || null };
}

// Call once at start-up.
let started = false;
export async function init() {
  const c = await getConfig();
  if (!drive.isConfigured()) return setStatus({ state: 'unconfigured' });
  if (!c.enabled) return setStatus({ state: 'off' });
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
  if (found.complete) Object.assign(c, { folder: found.folder, files: found.files });
  await saveConfig(c);
  await init();
  if (ready(c)) await syncNow({ interactive: true });
  return c;
}

// Look for the shared files this app can already open.
async function findExisting() {
  const idx = await drive.list(`name = '${INDEX_NAME}' and trashed = false`);
  let best = { complete: false, missing: ALL_NAMES };
  for (const f of idx) {
    const parent = (f.parents || [])[0];
    if (!parent) continue;
    const kids = await drive.list(`'${parent}' in parents and trashed = false`);
    const byName = Object.fromEntries(kids.map((k) => [k.name, k.id]));
    byName[INDEX_NAME] = f.id;
    const missing = ALL_NAMES.filter((n) => !byName[n]);
    let folder = { id: parent, name: 'Shared folder', owner: false };
    try {
      const m = await drive.getMeta(parent);
      folder = { id: parent, name: m.name, owner: Boolean(m.capabilities && m.capabilities.canShare) };
    } catch {} // with drive.file you often can't see a folder someone else made — that's fine
    const files = { index: f.id, buckets: Array.from({ length: PHOTO_BUCKETS }, (_, i) => byName[bucketName(i)]) };
    if (!missing.length) return { complete: true, folder, files };
    if (missing.length < best.missing.length) best = { complete: false, missing, folder };
  }
  return best;
}

// Step 2a: "Start a new shared logbook" — creates the folder + files.
export async function createShared() {
  const c = await getConfig();
  setStatus({ state: 'syncing', message: 'Creating the Hearthbook folder…' });
  try {
    const folder = await drive.createFolder(FOLDER_NAME);
    const index = await drive.createJSON(INDEX_NAME, folder.id, emptyIndex());
    const buckets = [];
    for (let i = 0; i < PHOTO_BUCKETS; i++) buckets.push((await drive.createJSON(bucketName(i), folder.id, emptyBucket())).id);
    Object.assign(c, { folder: { id: folder.id, name: folder.name || FOLDER_NAME, owner: true }, files: { index: index.id, buckets } });
    await saveConfig(c);
  } catch (err) {
    await fail(err);
    throw err;
  }
  setStatus(baseStatus(c));
  return syncNow({ interactive: true });
}

// Step 2b: "Join a shared logbook" — pick the files in Google's picker.
export async function joinShared() {
  const picked = await drive.pickFiles({ query: 'hearthbook', title: `Select all ${ALL_NAMES.length} Hearthbook files` });
  if (!picked) return { cancelled: true };
  const found = await findExisting();
  if (!found.complete) {
    return { missing: found.missing };
  }
  const c = await getConfig();
  Object.assign(c, { folder: found.folder, files: found.files });
  await saveConfig(c);
  setStatus(baseStatus(c));
  await syncNow({ interactive: true });
  return { ok: true };
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
  setStatus({ state: drive.isConfigured() ? 'off' : 'unconfigured', account: null, folderName: '', lastSync: null, message: '' });
}

// ---------- syncing ----------
let running = null;
let again = false;
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
  if (err instanceof drive.AuthError) setStatus({ ...baseStatus(c), state: 'signin', message: err.message });
  else if (err instanceof drive.OfflineError || !navigator.onLine) setStatus({ ...baseStatus(c), state: 'offline', message: '' });
  else if (err instanceof drive.NotFoundError) setStatus({ ...baseStatus(c), state: 'error', message: 'The shared files can’t be found in Google Drive. They may have been deleted, or the folder is no longer shared with you.' });
  else setStatus({ ...baseStatus(c), state: 'error', message: err.message || String(err) });
}

const emptyIndex = () => ({ format: 'hearthbook-sync', version: 1, updatedAt: new Date().toISOString(), records: {}, tombstones: {}, photoIndex: {} });
const emptyBucket = () => ({ format: 'hearthbook-photos', version: 1, photos: {} });
function normIndex(d) {
  const e = emptyIndex();
  if (!d || d.format !== 'hearthbook-sync') return e;
  return { ...e, ...d, records: d.records || {}, tombstones: d.tombstones || {}, photoIndex: d.photoIndex || {} };
}
const normBucket = (d) => (d && d.photos ? d : emptyBucket());

// Which photo file a photo lives in: a simple hash of its id.
export function bucketOf(photoId) {
  let h = 0;
  for (const ch of String(photoId)) h = (h * 31 + ch.charCodeAt(0)) >>> 0;
  return h % PHOTO_BUCKETS;
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
    const remote = normIndex(await drive.readJSON(c.files.index));
    const local = await db.getAllEntries();
    const localTombs = (await db.getMeta(TOMBS_KEY)) || {};
    const p = plan(local, localTombs, remote);

    // Photos we need to download for entries coming from the other phone.
    const localBlobs = new Map();
    for (const e of local) for (const ph of e.photos || []) if (ph.blob) localBlobs.set(ph.id, ph.blob);
    const buckets = {};
    const bucket = async (i) => (buckets[i] = buckets[i] || normBucket(await drive.readJSON(c.files.buckets[i])));
    const toSave = [];
    for (const r of p.toLocal) {
      const photos = [];
      for (const ph of r.photos || []) {
        let blob = localBlobs.get(ph.id);
        if (!blob) {
          const i = remote.photoIndex[ph.id] ?? bucketOf(ph.id);
          const data = (await bucket(i)).photos[ph.id];
          if (data) blob = await dataURLToBlob(data);
        }
        if (blob) photos.push({ id: ph.id, blob });
      }
      toSave.push({ ...r, photos });
    }

    // Photos to upload (new on this phone) and to remove (no longer used).
    const photoIndex = { ...remote.photoIndex };
    const adds = {}; // bucket -> {photoId: blob}
    const used = new Set();
    for (const rec of Object.values(p.records)) for (const ph of rec.photos || []) used.add(ph.id);
    for (const id of used) {
      if (photoIndex[id] !== undefined) continue;
      const blob = localBlobs.get(id);
      if (!blob) continue; // the other phone has it; it'll upload it
      const i = bucketOf(id);
      (adds[i] = adds[i] || {})[id] = blob;
      photoIndex[id] = i;
    }
    const removes = {};
    for (const [id, i] of Object.entries(photoIndex)) {
      if (!used.has(id)) { (removes[i] = removes[i] || []).push(id); delete photoIndex[id]; }
    }
    const touched = new Set([...Object.keys(adds), ...Object.keys(removes)].map(Number));

    if (p.remoteChanged || touched.size) {
      for (const i of touched) {
        const b = normBucket(await drive.readJSON(c.files.buckets[i])); // fresh copy
        for (const [id, blob] of Object.entries(adds[i] || {})) b.photos[id] = await blobToDataURL(blob);
        for (const id of removes[i] || []) delete b.photos[id];
        await drive.writeJSON(c.files.buckets[i], b);
      }
      // If the other phone wrote the index while we were busy, start again
      // with its version, so neither phone's changes are lost.
      const now = await drive.getMeta(c.files.index);
      if (now.version !== before.version) continue;
      await drive.writeJSON(c.files.index, { ...remote, format: 'hearthbook-sync', version: 1, updatedAt: new Date().toISOString(), records: p.records, tombstones: p.tombstones, photoIndex });
    }

    // Apply the other phone's changes here (unless you saved something
    // newer on this phone while we were syncing).
    const fresh = new Map((await db.getAllEntries()).map((e) => [e.id, e]));
    const keep = toSave.filter((r) => !fresh.has(r.id) || stamp(fresh.get(r.id)) <= stamp(r));
    if (keep.length) await db.saveManyEntries(keep);
    const gone = p.deleteLocal.filter((id) => fresh.has(id) && stamp(fresh.get(id)) <= p.tombs[id]);
    for (const id of gone) await db.deleteEntry(id);
    await db.setMeta(TOMBS_KEY, p.tombs);
    return { pulled: keep.length + gone.length, pushed: p.pushed };
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
