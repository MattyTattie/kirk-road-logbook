// A deliberate backup, separate from live sync. No scheduled network writes.
import * as drive from './gdrive.js';
import * as db from './db.js';
import { buildBackup } from './backup.js';
import { APP_SLUG } from './config.js';
import { writeIntoFolder } from './drivetidy.js';

const TAG = 'backup-v15';
const PREFIX = APP_SLUG + '-backup-';
const quote = (x) => String(x).replace(/\\/g, '\\\\').replace(/'/g, "\\'");
// v15.19: keep the newest backup of each of the last 12 months (by when it
// was made), plus everything from the last 7 days and always the newest 3.
// Only this account's app-made backups are ever binned; the other phone's
// are counted separately (and are the other phone's to tidy).
export const KEEP_MONTHS = 12;
export const KEEP_DAYS = 7;
export const KEEP_NEWEST = 3;
export function planBackupRetention(files, parent, now = Date.now()) {
  const ours = files.filter((f) => !f.trashed && (f.parents || []).includes(parent) && f.appProperties?.hearthbook === TAG && f.name?.startsWith(PREFIX) && f.mimeType === 'application/json');
  ours.sort((a,b) => (b.createdTime || '').localeCompare(a.createdTime || '') || b.id.localeCompare(a.id));
  const d = new Date(now);
  const oldest = `${new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth() - (KEEP_MONTHS - 1), 1)).toISOString().slice(0, 7)}`;
  const keep = new Set();
  const months = new Set();
  // Per account, so one phone's backups never stand in for the other's.
  for (const mine of [true, false]) {
    const list = ours.filter((f) => Boolean(f.ownedByMe) === mine);
    list.slice(0, KEEP_NEWEST).forEach((f) => keep.add(f.id));
    months.clear();
    for (const f of list) {
      const t = Date.parse(f.createdTime || '');
      if (Number.isFinite(t) && now - t < KEEP_DAYS * 86400_000) { keep.add(f.id); continue; }
      const m = (f.createdTime || '').slice(0, 7);
      if (/^\d{4}-\d{2}$/.test(m) && m >= oldest && !months.has(m)) { months.add(m); keep.add(f.id); }
    }
  }
  const drop = ours.filter((f) => !keep.has(f.id));
  return { trash: drop.filter((f) => f.ownedByMe), protected: drop.filter((f) => !f.ownedByMe) };
}
export async function saveBackupToDrive(c) {
  if (!c.enabled || !c.files?.index || !c.folder?.id) throw new Error('Connect to your shared Drive logbook first, then try again.');
  await drive.getToken({ interactive: true, email: c.account?.email });
  const { blob, count } = await buildBackup();
  const parent = c.folder.id;
  const saved = await db.getMeta('driveBackupFolder');
  const now = new Date();
  // Europe/London timestamp, including milliseconds and random suffix for
  // distinct files even when both phones save during the same second.
  const parts = new Intl.DateTimeFormat('en-GB', {timeZone:'Europe/London',year:'numeric',month:'2-digit',day:'2-digit',hour:'2-digit',minute:'2-digit',second:'2-digit',hourCycle:'h23'}).formatToParts(now);
  const part = (n) => parts.find((x) => x.type === n).value;
  const filename = `${PREFIX}${part('year')}-${part('month')}-${part('day')}_${part('hour')}-${part('minute')}-${part('second')}-${String(now.getMilliseconds()).padStart(3,'0')}-${db.newId().slice(0,8)}.json`;
  // v15.19: the phone that joined saves into the owner's Backups folder when
  // Google allows it, rather than making a second "Backups" folder.
  let put;
  try {
    put = await writeIntoFolder({ parent, kind: 'backups', owner: c.folder.owner !== false, remembered: saved?.parent === parent ? saved.id : null,
      write: (id) => drive.uploadNewBlob(filename, id, blob, 'application/json', { hearthbook: TAG }, { timeoutMs: 120000 }) });
  } catch (err) {
    if (err.needsGrant) throw new Error('Tap “Allow saving to the shared folder”, choose the existing Hearthbook folder, then try again. No backup was saved.');
    throw err;
  }
  const folder = { id: put.folderId };
  await db.setMeta('driveBackupFolder', { id: folder.id, parent });
  let made = put.result;
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
    // v15.19: the other phone's older backups are its own to tidy; no warning.
  } catch { warning = 'Backup saved and checked. Older backups could not be tidied this time.'; }
  return { filename, count, warning };
}
