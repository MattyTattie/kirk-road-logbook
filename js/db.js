// =====================================================================
// db.js — saving and loading data on the phone with IndexedDB.
// =====================================================================
//
// WHAT IS IndexedDB?
// Every web browser has a small built-in database called IndexedDB. Each
// website (strictly: each "origin", i.e. the web address it comes from)
// gets its own private one. Data saved there stays on THIS phone, in
// Chrome's storage — it is never sent anywhere. It survives closing the
// app and restarting the phone, and it can store real files (like photos)
// as "Blobs" (Binary Large OBjects), not just text.
//
// IMPORTANT: if you clear Chrome's "site data" for this app, or uninstall
// Chrome, the database is deleted. That's why the app has a Backup button.
//
// IndexedDB's own API is old-fashioned (it uses "events" instead of
// Promises), so this file wraps it in a few simple async functions:
//   getAllEntries(), getEntry(id), saveEntry(entry), deleteEntry(id),
//   getMeta(key), setMeta(key, value)
// The rest of the app only ever uses those, never IndexedDB directly.
//
// We have two "object stores" (think: tables in a spreadsheet):
//   entries – one record per logbook entry (job, receipt...), with photos
//   meta    – little settings, like the date of the last backup

const DB_NAME = 'kirk-road-logbook';
// If you ever change the stores below, increase this number so the
// "onupgradeneeded" code runs again on the phone.
const DB_VERSION = 1;

let dbPromise = null; // we open the database once and re-use it

function openDB() {
  if (dbPromise) return dbPromise;
  dbPromise = new Promise((resolve, reject) => {
    const request = indexedDB.open(DB_NAME, DB_VERSION);

    // Runs the very first time (or when DB_VERSION goes up): create stores.
    request.onupgradeneeded = () => {
      const db = request.result;
      if (!db.objectStoreNames.contains('entries')) {
        // keyPath 'id' means each entry's own "id" field is its unique key.
        const store = db.createObjectStore('entries', { keyPath: 'id' });
        store.createIndex('type', 'type'); // lets us look up by section
      }
      if (!db.objectStoreNames.contains('meta')) {
        db.createObjectStore('meta'); // simple key -> value pairs
      }
    };
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  });
  return dbPromise;
}

// A helper that runs one operation inside a "transaction" and gives back
// a Promise. A transaction is IndexedDB's way of making sure a change
// either fully happens or doesn't happen at all.
async function run(storeName, mode, action) {
  const db = await openDB();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(storeName, mode);
    const store = tx.objectStore(storeName);
    const request = action(store);
    let result;
    if (request) request.onsuccess = () => (result = request.result);
    // We resolve when the whole transaction has finished ("complete"),
    // which means the data really has been written to storage.
    tx.oncomplete = () => resolve(result);
    tx.onerror = () => reject(tx.error);
    tx.onabort = () => reject(tx.error || new Error('Transaction aborted'));
  });
}

// ---------- Entries ----------

export function getAllEntries() {
  return run('entries', 'readonly', (store) => store.getAll());
}

export function getEntry(id) {
  return run('entries', 'readonly', (store) => store.get(id));
}

// put() = "insert, or replace if this id already exists".
export function saveEntry(entry) {
  return run('entries', 'readwrite', (store) => store.put(entry));
}

export function deleteEntry(id) {
  return run('entries', 'readwrite', (store) => store.delete(id));
}

// Save many entries in ONE transaction (used by restore-from-backup), so a
// broken backup file can't leave you with half the entries imported.
export async function saveManyEntries(entries) {
  const db = await openDB();
  return new Promise((resolve, reject) => {
    const tx = db.transaction('entries', 'readwrite');
    const store = tx.objectStore('entries');
    for (const e of entries) store.put(e);
    tx.oncomplete = () => resolve(entries.length);
    tx.onerror = () => reject(tx.error);
    tx.onabort = () => reject(tx.error || new Error('Transaction aborted'));
  });
}

// Save entries AND one meta value in ONE transaction (restore while sync is
// on: the entries plus the updated tombstone list, all or nothing).
export async function saveEntriesAndMeta(entries, key, value) {
  const db = await openDB();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(['entries', 'meta'], 'readwrite');
    const store = tx.objectStore('entries');
    for (const e of entries) store.put(e);
    tx.objectStore('meta').put(value, key);
    tx.oncomplete = () => resolve(entries.length);
    tx.onerror = () => reject(tx.error);
    tx.onabort = () => reject(tx.error || new Error('Transaction aborted'));
  });
}

// ---------- Meta (small settings) ----------

export function getMeta(key) {
  return run('meta', 'readonly', (store) => store.get(key));
}

export function setMeta(key, value) {
  return run('meta', 'readwrite', (store) => store.put(value, key));
}

// ---------- Ask Chrome to keep our data ----------
// By default the browser *may* clear website storage if the phone runs
// very low on space. Asking for "persistent" storage tells Chrome "please
// don't auto-delete this". Chrome decides by itself (installed apps are
// usually granted). It does NOT protect against you clearing site data.
export async function requestPersistentStorage() {
  try {
    if (navigator.storage && navigator.storage.persist) {
      const already = await navigator.storage.persisted();
      if (already) return true;
      return await navigator.storage.persist();
    }
  } catch (err) {
    console.warn('Could not request persistent storage', err);
  }
  return false;
}

// Makes a unique id for a new entry, e.g. "lq3x9a-4f2k8d".
export function newId() {
  if (crypto.randomUUID) return crypto.randomUUID();
  return Date.now().toString(36) + '-' + Math.random().toString(36).slice(2, 8);
}
