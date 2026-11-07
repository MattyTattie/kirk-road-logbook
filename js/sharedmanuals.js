// v15.15 — shared user PDFs. No PDF bytes in hearthbook-sync.json.
// Each phone writes ONLY its own small companion manifest in the shared
// folder. All manifests are merged by manual id + timestamp (delete wins
// ties). Old apps may drop the optional main-index hints, but cannot erase
// these files: drive.readonly discovers them again. No extra Drive scope.
// PDFs are immutable; edits only change their metadata. Deleted PDFs are
// retained in Drive for recovery, while tombstones hide them on both phones.
//
// v15.16 — sync shares metadata + Drive pointers only. Other phones do NOT
// auto-download every PDF. Opening only fetches temporary viewing bytes;
// only “Save on this device” keeps them. Remove drops the optional copy. Backups still
// include PDF bytes, fetching from Drive when the local copy is missing.
import * as db from './db.js';
import * as drive from './gdrive.js';
import * as manuals from './usermanuals.js';
import * as rooms from './rooms.js';

const STATE = 'sharedManualFiles';
const FORMAT = 'hearthbook-manuals';
const PREFIX = 'hearthbook-manuals-';
const stamp = manuals.manualStamp;
const json = (x) => JSON.stringify(x);
const time = (x) => typeof x === 'string' && Number.isFinite(Date.parse(x));
export function mergeManuals(sources) {
  const records = Object.create(null), tombstones = Object.create(null);
  for (const source of sources) {
    for (const [id, m] of Object.entries(source.records || {})) {
      if (!m || !manuals.validRecord(m) || m.id !== id || !time(stamp(m))) continue;
      if (!records[id] || stamp(m) > stamp(records[id])) records[id] = m;
    }
    for (const [id, t] of Object.entries(source.tombstones || {})) {
      if (time(t) && (!tombstones[id] || t > tombstones[id])) tombstones[id] = t;
    }
  }
  for (const [id, t] of Object.entries(tombstones)) {
    if (records[id] && stamp(records[id]) > t) delete tombstones[id];
    else delete records[id];
  }
  return { records, tombstones };
}
const localSource = async () => ({ records: Object.fromEntries((await manuals.list()).map((m) => [m.id, m])), tombstones: (await db.getMeta(manuals.TOMBS_KEY)) || {} });
const pdfName = (id) => `hearthbook-manual-${id}.pdf`;
const quoted = (s) => String(s).replace(/\\/g, '\\\\').replace(/'/g, "\\'");

export async function syncManuals(c, hints = [], stillOn = async () => true) {
  const parent = c.folder && c.folder.id;
  let state = (await db.getMeta(STATE)) || {};
  if (state.parent !== parent) state = { parent, device: db.newId(), uploads: {} };
  state.uploads ||= {};
  const files = parent ? await drive.list(`'${quoted(parent)}' in parents and trashed = false and name contains '${PREFIX}'`) : [];
  // v15.18: the Drive tidy moves these files into the Manuals folder(s).
  if (parent) {
    const subs = (await drive.list(`'${quoted(parent)}' in parents and trashed = false and mimeType = 'application/vnd.google-apps.folder'`)).filter((f) => f.name === 'Manuals' || f.name === 'Hearthbook manuals');
    for (const sub of subs) for (const f of await drive.list(`'${quoted(sub.id)}' in parents and trashed = false and name contains '${PREFIX}'`)) if (!files.some((x) => x.id === f.id)) files.push(f);
  }
  const ids = new Set([...files.filter((f) => f.name.startsWith(PREFIX) && f.name.endsWith('.json')).map((f) => f.id), ...hints]);
  const sources = [];
  for (const id of ids) {
    // A failed read is NOT an empty manifest. Never announce a successful
    // sync while the other phone's manual metadata could not be opened.
    const data = await drive.readJSON(id);
    if (!data || data.format !== FORMAT) throw new Error('A shared manuals file could not be read. Try syncing again.');
    sources.push(data);
  }
  const remoteOnly = mergeManuals(sources);
  const remoteSettings = rooms.mergeShared(sources.map((s) => s.roomSettings));
  const roomSettings = rooms.mergeShared([await rooms.getShared(), remoteSettings]);
  const local = await localSource();
  let merged = mergeManuals([local, ...sources]);
  // v15.18: removed built-in guides (optional field, older apps ignore it).
  const remoteHides = manuals.mergeHides(sources.map((s) => s.builtinHidden));
  const hides = manuals.mergeHides([await manuals.builtinHides(), remoteHides]);
  const hasData = Object.keys(merged.records).length || Object.keys(merged.tombstones).length || Object.keys(roomSettings).length || Object.keys(hides).length;
  if (!hasData) return { ids: [...ids], pulled: 0 };
  if (!parent) throw new Error('Choose the shared Hearthbook folder in Manuals before syncing PDFs.');
  await db.setMeta(STATE, state); // stable device id before any remote create

  // One folder per uploader is fine: it MUST be inside the shared folder,
  // never quietly in that phone's private Drive root. All PDFs inherit sharing.
  const folder = async () => {
    if (state.folder) {
      const f = await drive.getMeta(state.folder);
      if ((f.parents || []).includes(parent) && !f.trashed) return f.id;
    }
    const found = [...await drive.list(`'${quoted(parent)}' in parents and trashed = false and name = 'Manuals'`), ...await drive.list(`'${quoted(parent)}' in parents and trashed = false and name = 'Hearthbook manuals'`)];
    // Only reuse an app-writable folder (owned by this account). Read-only
    // access to somebody else's folder isn't permission to create children.
    const own = found.find((f) => f.ownedByMe);
    let f = own;
    if (!f) {
      try { f = await drive.createFolder('Manuals', parent); }
      catch (err) { if (err instanceof drive.AuthError) throw err; throw new Error('Tap “Allow saving to the shared Drive folder” under More → Backup & sharing, select the existing Hearthbook folder, then Sync now again. Your PDF is still safe on this device.'); }
    }
    state.folder = f.id;
    await db.setMeta(STATE, state);
    return f.id;
  };
  for (const [id, m] of Object.entries(merged.records)) {
    if (m.driveId) continue;
    const blob = await manuals.getFile(id);
    if (!blob) throw new Error(`The PDF for “${m.name}” is missing. Load a backup containing it, then sync again.`);
    let file = null;
    const saved = state.uploads[id];
    if (saved) {
      try { const f = await drive.getMeta(saved); if (!f.trashed && Number(f.size) === blob.size) file = f; } catch (e) { if (e instanceof drive.AuthError) throw e; }
    }
    const target = await folder();
    if (!file) file = (await drive.list(`'${quoted(target)}' in parents and trashed = false and name = '${quoted(pdfName(id))}'`)).find((f) => Number(f.size) === blob.size);
    if (!file) {
      if (!(await stillOn())) throw new Error('Sync was switched off.');
      file = await drive.uploadNewBlob(pdfName(id), target, blob, 'application/pdf', { hearthbook: 'manual', manualId: id }, { timeoutMs: 60000 });
      if (file && (file.size == null || file.unchecked)) file = await drive.getMeta(file.id);
      if (!file || Number(file.size) !== blob.size) throw new Error('Google Drive did not save the whole PDF. Try syncing again.');
    }
    state.uploads[id] = file.id;
    await db.setMeta(STATE, state); // checkpoint BEFORE publishing the pointer
    merged.records[id] = { ...m, driveId: file.id };
  }

  // Write our own manifest, not another account's file (drive.file remains
  // the sole write scope). Version-3 sync only receives optional id hints.
  const payload = { format: FORMAT, version: 1, ...merged, roomSettings, ...(Object.keys(hides).length ? { builtinHidden: hides } : {}) };
  const name = PREFIX + state.device + '.json';
  // Recover a completed create if the phone stopped before saving its id.
  if (!state.manifest) state.manifest = files.find((f) => f.name === name && f.ownedByMe)?.id;
  if ((json(merged) !== json(remoteOnly) || json(roomSettings) !== json(remoteSettings) || json(hides) !== json(remoteHides)) && json(payload) !== state.last) {
    if (!(await stillOn())) throw new Error('Sync was switched off.');
    let written;
    try { written = state.manifest ? await drive.writeJSON(state.manifest, payload) : await drive.createJSON(name, parent, payload); }
    catch (err) {
      if (!state.manifest && err instanceof drive.NotFoundError) throw new Error('Tap “Allow saving to the shared Drive folder” under More → Backup & sharing, choose the existing Hearthbook folder, then Sync now again. Your saved records are still on this device.');
      throw err;
    }
    state.manifest = written.id || state.manifest;
    state.last = json(payload);
    await db.setMeta(STATE, state);
  }
  ids.add(state.manifest);

  // v15.16: apply metadata only. Do not auto-download every PDF — that was
  // filling both phones. Opening / Save on this phone fetches on demand.
  // Existing local copies stay put until the user removes them or a delete
  // tombstone clears them.
  if (!(await stillOn())) throw new Error('Sync was switched off.');
  // Re-read: edits, deletes and restores during a network request must win.
  const fresh = await localSource();
  const final = mergeManuals([merged, fresh]);
  // Preserve a pointer learned this sync when the local metadata ties.
  for (const [id, m] of Object.entries(final.records)) if (!m.driveId && merged.records[id]?.driveId && stamp(m) === stamp(merged.records[id])) final.records[id] = { ...m, driveId: merged.records[id].driveId };
  const before = json(fresh);
  const freshSettings = await rooms.getShared();
  const finalSettings = rooms.mergeShared([roomSettings, freshSettings]);
  const blobs = {};
  for (const id of Object.keys(final.tombstones)) blobs[manuals.fileKey(id)] = null;
  const freshHides = await manuals.builtinHides();
  const finalHides = manuals.mergeHides([hides, freshHides]);
  await db.saveMetaValues({ ...rooms.sharedMeta(finalSettings), ...blobs, [manuals.LIST_KEY]: Object.values(final.records), [manuals.TOMBS_KEY]: final.tombstones, [manuals.BUILTIN_HIDE_KEY]: finalHides });
  const newlyHidden = manuals.hiddenIds(finalHides).filter((id) => !manuals.hiddenIds(freshHides).includes(id));
  // v15.18: bin (Drive trash, 30 days to restore) the PDFs of removed
  // manuals. Only files this account owns can be binned with drive.file; the
  // phone that uploaded a PDF bins it when it sees the delete marker.
  const binned = await binRemoved(final.tombstones, state, final.records);
  return { ids: [...ids].filter(Boolean).sort(), newlyHidden, binned, pulled: before === json(final) && json(freshSettings) === json(finalSettings) && json(freshHides) === json(finalHides) ? 0 : 1 };
}

async function binRemoved(tombstones, state, records) {
  const pending = { ...((await db.getMeta(manuals.TRASH_KEY)) || {}) };
  let binned = 0, changed = false;
  for (const id of Object.keys(tombstones)) {
    if (records[id]) continue; // brought back since
    const targets = [...new Set([state.uploads?.[id], pending[id]].filter(Boolean))];
    if (!targets.length) continue;
    let left = false;
    for (const fid of targets) {
      try {
        const f = await drive.getMeta(fid);
        if (f.trashed) continue;
        if (!f.ownedByMe) continue; // the other phone's upload: it bins its own
        if (f.appProperties?.hearthbook !== 'manual' || (f.appProperties.manualId && f.appProperties.manualId !== id)) continue; // never touch anything else
        await drive.trash(fid); binned++;
      } catch (e) {
        if (e instanceof drive.AuthError) throw e;
        if (!(e instanceof drive.NotFoundError)) left = true; // try again next sync
      }
    }
    if (!left) { if (state.uploads?.[id]) { delete state.uploads[id]; changed = true; } if (pending[id]) { delete pending[id]; changed = true; } }
  }
  if (changed) await db.saveMetaValues({ [STATE]: state, [manuals.TRASH_KEY]: pending });
  return binned;
}

/** Load a user-manual PDF: local copy first, else Drive. Does not save. */
export async function loadBlob(id) {
  const local = await manuals.getFile(id);
  if (local) return local;
  const m = await manuals.get(id);
  if (!m) throw new Error('That manual is not in Hearth.');
  if (!m.driveId) throw new Error(`“${m.name}” is not on Drive yet. Keep Hearth open until syncing finishes, then try again.`);
  const downloaded = await drive.readBlob(m.driveId);
  const blob = new Blob([downloaded], { type: 'application/pdf' });
  if (blob.size !== Number(m.size) || !(await manuals.looksLikePdf(blob))) throw new Error(`“${m.name}” did not download completely. Try again.`);
  return blob;
}

/** Optional offline copy on this phone only. */
export async function saveOnThisPhone(id) {
  const existing = await manuals.getFile(id);
  if (existing) return existing;
  const blob = await loadBlob(id);
  await manuals.saveFile(id, blob);
  return blob;
}

// Explicit user gesture, Google Picker grants drive.file access to the
// ALREADY shared folder. No new scopes and no new unrelated folder.
export async function allowSharedFolder(c) {
  await drive.getToken({ interactive: true });
  const picked = await drive.pickFiles({ query: 'Hearthbook', title: 'Select your shared Hearthbook folder', multiselect: false, foldersOnly: true });
  if (picked.action !== 'picked') return;
  const folder = picked.docs[0];
  if (!folder || folder.mimeType !== 'application/vnd.google-apps.folder') throw new Error('Select the existing Hearthbook folder, not a file.');
  if (c.folder?.id && folder.id !== c.folder.id) throw new Error('Choose the same Hearthbook folder that holds hearthbook-sync.json.');
  if (!c.folder?.id) {
    const children = await drive.list(`'${quoted(folder.id)}' in parents and trashed = false`);
    if (!children.some((f) => f.id === c.files?.index)) throw new Error('That folder does not contain your connected hearthbook-sync.json. Nothing changed.');
    const latest = await db.getMeta('sync');
    if (!latest?.enabled || latest.files?.index !== c.files?.index) throw new Error('Sync was switched off.');
    await db.setMeta('sync', { ...latest, folder: { ...latest.folder, id: folder.id, name: folder.name } });
  }
}
