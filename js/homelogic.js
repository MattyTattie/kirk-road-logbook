// =====================================================================
// homelogic.js — small rules for the v14 home screen (no screen code, so
// they're easy to test).
// =====================================================================

const DAY = 86400000;

/**
 * Is a backup actually overdue? (v14: the warning only shows then.)
 *   count:       entries in the logbook
 *   lastBackup:  ISO time of the last backup file, or null
 *   syncHealthy: Drive sync working (a copy is in Drive) → never overdue
 *   lastSync:    ISO time of the last good Drive sync, or null; within
 *                7 days counts as backed up (e.g. it only needs a tap to sign in)
 *   oldestAdded: ISO time the oldest entry was added: a new logbook isn't
 *                nagged until it's a month old
 * → { due: boolean, days: days since the last backup or null }
 */
export function backupDue({ count = 0, lastBackup = null, syncHealthy = false, lastSync = null, oldestAdded = null, limitDays = 30, now = new Date() } = {}) {
  const t = now.getTime();
  const days = lastBackup ? Math.floor((t - Date.parse(lastBackup)) / DAY) : null;
  if (!count || syncHealthy) return { due: false, days };
  if (lastSync && t - Date.parse(lastSync) < 7 * DAY) return { due: false, days };
  if (days !== null) return { due: days > limitDays, days };
  const age = oldestAdded ? (t - Date.parse(oldestAdded)) / DAY : Infinity;
  return { due: !(age < limitDays), days };
}

/** "Shared file" size for Sync details: KB under 1 MB ("44 KB"), else MB ("5.6 MB"). */
export function sizeLabel(bytes) {
  const b = Number(bytes);
  if (!isFinite(b) || b < 0) return '';
  if (b < 1048576) return `${Math.max(1, Math.round(b / 1024))} KB`;
  return `${(b / 1048576).toFixed(1)} MB`;
}
