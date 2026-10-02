// =====================================================================
// backup.js — making a backup file, and restoring from one.
// =====================================================================
//
// Because ALL your data lives only on the phone, a backup file is your
// safety net. The backup is a single ".json" file (JSON = a plain-text
// format for data) that contains every entry AND every photo (as base64
// text). Save it somewhere safe: email it to yourself, put it on Google
// Drive, copy it to a PC. You can restore it on this phone or a new one.

import { getAllEntries, saveManyEntries, setMeta } from './db.js';
import { blobToDataURL, dataURLToBlob } from './photos.js';

const FORMAT = 'kirk-road-logbook-backup';
const FORMAT_VERSION = 1;

// Builds the backup and makes the browser download it.
export async function exportBackup() {
  const entries = await getAllEntries();

  // Convert each entry's photo Blobs into base64 text.
  const out = [];
  for (const entry of entries) {
    const photos = [];
    for (const p of entry.photos || []) {
      photos.push({ id: p.id, data: await blobToDataURL(p.blob) });
    }
    out.push({ ...entry, photos });
  }

  const backup = {
    format: FORMAT,
    version: FORMAT_VERSION,
    exportedAt: new Date().toISOString(),
    entryCount: out.length,
    entries: out,
  };

  // Turn it into a file and "click" a hidden download link.
  const json = JSON.stringify(backup);
  const blob = new Blob([json], { type: 'application/json' });
  const today = new Date().toISOString().slice(0, 10);
  const filename = `kirk-road-logbook-backup-${today}.json`;

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
  return { filename, count: out.length, bytes: blob.size };
}

// Reads a backup File (chosen by the user) and saves its entries.
// Entries with the same id as one already on the phone are replaced;
// everything else on the phone is left alone (nothing is deleted).
export async function importBackup(file) {
  const text = await file.text();
  let data;
  try {
    data = JSON.parse(text);
  } catch {
    throw new Error('That file is not a valid backup (it is not JSON).');
  }
  if (!data || data.format !== FORMAT || !Array.isArray(data.entries)) {
    throw new Error('That file does not look like a Kirk Road Logbook backup.');
  }

  // Check and convert everything FIRST, then save in one go. That way a
  // damaged file can't leave you with half an import.
  const entries = [];
  for (const e of data.entries) {
    if (!e || typeof e.id !== 'string' || typeof e.type !== 'string') {
      throw new Error('The backup contains a damaged entry, so nothing was imported.');
    }
    const photos = [];
    for (const p of e.photos || []) {
      if (typeof p.data !== 'string' || !p.data.startsWith('data:image/')) continue;
      photos.push({ id: p.id, blob: await dataURLToBlob(p.data) });
    }
    entries.push({ ...e, photos });
  }

  await saveManyEntries(entries);
  return entries.length;
}
