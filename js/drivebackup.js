// A deliberate backup, separate from live sync. No scheduled network writes.
import * as drive from './gdrive.js';
import * as db from './db.js';
import { buildBackup } from './backup.js';
import { APP_SLUG } from './config.js';

const TAG = 'backup-v15';
const PREFIX = APP_SLUG + '-backup-';
const quote = (x) => String(x).replace(/\\/g, '\\\\').replace(/'/g, "\\'");
export function planBackupRetention(files, parent) {
  const ours = files.filter((f) => !f.trashed && (f.parents || []).includes(parent) && f.appProperties?.hearthbook === TAG && f.name?.startsWith(PREFIX) && f.mimeType === 'application/json');
  ours.sort((a,b) => (b.createdTime || '').localeCompare(a.createdTime || '') || b.id.localeCompare(a.id));
  return { trash: ours.slice(3).filter((f) => f.ownedByMe), protected: ours.slice(3).filter((f) => !f.ownedByMe) };
}
export async function saveBackupToDrive(c) {
  if (!c.enabled || !c.files?.index || !c.folder?.id) throw new Error('Connect to your shared Drive logbook first, then try again.');
  await drive.getToken({ interactive: true, email: c.account?.email });
  const { blob, count } = await buildBackup();
  const parent = c.folder.id;
  let saved = await db.getMeta('driveBackupFolder');
  let folder;
  if (saved?.parent === parent) {
    try { const f = await drive.getMeta(saved.id); if (!f.trashed && f.parents?.includes(parent)) folder = f; } catch (err) { if (err instanceof drive.AuthError) throw err; }
  }
  if (!folder) {
    const candidates = await drive.list(`'${quote(parent)}' in parents and trashed = false and name = 'Hearthbook backups'`);
    folder = candidates.find((f) => f.ownedByMe && f.mimeType === 'application/vnd.google-apps.folder');
    if (!folder) {
      try { folder = await drive.createFolder('Hearthbook backups', parent); }
      catch (err) { throw new Error('Tap “Allow saving to the shared folder”, choose the existing Hearthbook folder, then try again. No backup was saved.'); }
    }
    await db.setMeta('driveBackupFolder', { id: folder.id, parent });
  }
  const now = new Date();
  // Europe/London timestamp, including milliseconds and random suffix for
  // distinct files even when both phones save during the same second.
  const parts = new Intl.DateTimeFormat('en-GB', {timeZone:'Europe/London',year:'numeric',month:'2-digit',day:'2-digit',hour:'2-digit',minute:'2-digit',second:'2-digit',hourCycle:'h23'}).formatToParts(now);
  const part = (n) => parts.find((x) => x.type === n).value;
  const filename = `${PREFIX}${part('year')}-${part('month')}-${part('day')}_${part('hour')}-${part('minute')}-${part('second')}-${String(now.getMilliseconds()).padStart(3,'0')}-${db.newId().slice(0,8)}.json`;
  let made = await drive.uploadNewBlob(filename, folder.id, blob, 'application/json', { hearthbook: TAG }, { timeoutMs: 120000 });
  if (!made || made.size == null || made.unchecked) made = await drive.getMeta(made.id);
  if (Number(made.size) !== blob.size) throw new Error('Google Drive did not confirm the whole backup. Try again.');
  // Do not prune until the new file has been read back and verified.
  const check = await drive.readJSON(made.id);
  if (JSON.stringify(check) !== await blob.text() || check.format !== 'kirk-road-logbook-backup' || check.version !== 1 || check.entries?.length !== count || !Array.isArray(check.manuals)) throw new Error('The Drive backup could not be checked. Older backups were left alone.');
  await db.setMeta('lastBackup', now.toISOString());
  let warning = '';
  try {
    const files = await drive.list(`'${quote(folder.id)}' in parents and trashed = false`);
    const plan = planBackupRetention(files, folder.id);
    for (const old of plan.trash) await drive.trash(old.id);
    if (plan.protected.length) warning = 'Backup saved. Some older backups belong to the other account and were left in Drive.';
  } catch { warning = 'Backup saved and checked. Older backups could not be tidied this time.'; }
  return { filename, count, warning };
}
