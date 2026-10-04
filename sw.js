// =====================================================================
// sw.js — the "service worker": what makes the app work offline.
// =====================================================================
//
// WHAT IS A SERVICE WORKER?
// It's a small script that Chrome keeps installed alongside the app and
// that sits between the app and the internet. Every time the app asks for
// a file (a page, a stylesheet, an icon), the request goes through here
// first, and we can answer it from a local "cache" (a saved copy) instead
// of the network. So once the app has been opened once, it opens even in
// airplane mode or a garage with no signal.
//
// Note: your logbook DATA is not in this cache — that lives in IndexedDB
// (see db.js). This cache only holds the app's own files (the "app shell").
//
// UPDATING THE APP: when you change any file, bump the version number in
// CACHE_NAME (e.g. v1 -> v2). Chrome sees sw.js has changed, installs the
// new version, downloads fresh copies of all files, and deletes the old cache.

// v2 = the Hearthbook redesign (new look, dashboard, charts, dark mode).
// v3 = scan receipts/bills, swipeable chart detail cards.
// v4 = optional Google Drive sync.
// v5 = real Google IDs.
// v6 = sync: one shared file (easier joining), sync details.
// v7 = Insurance section, unit rates & standing charge, year-on-year charts, no backup nag while synced.
// v8 = scanner: foreign receipts (EUR), auto-rotate and crop.
// v9 = neutral sharing wording, "Electricity bills" section, home tiles follow the year picker, quiet Google sign-in refresh.
// v10 = house picture, Ask Hearthbook, reminders, tour, customisable sections, app shortcuts, share target.
// v11 = no cheap-rate chip/setting (night sky by the clock), shorter house, tiles + Coming up under it, smaller spending card.
// v12 = simple front-on house, phone reminders bridge (Android app), scan auto-sort, tappable chips, Manuals.
// v13 = safer sync (restore, deletes during sync, resumable upload), sharper manuals + open in another app,
//       your own manuals, rooms, year in review; updates fetch fresh files and reload once.
// v13.1 = Beldray bedroom radiator manual (tagged Bedroom).
// v13.2 = Ecostrad iQ Ceramic 1800W bedroom radiator manual (tagged Bedroom).
// v13.3 = Ecostrad iQ WiFi Heating Element 600W towel rail manual (tagged Bathroom).
// v13.4 = electriQ VSTR9-650-0.6 600W smart towel rail manual (tagged Bathroom).
// (Older caches such as 'kirk-road-logbook-v1' are deleted automatically on activate.)
const CACHE_NAME = 'hearthbook-v13.4';
// Where a shared photo/PDF waits for the app to pick it up (share target).
const SHARE_CACHE = 'hearthbook-share';

// The scanner's libraries (OCR engine + English model + PDF reader) are big
// (~8 MB to download), so they get their OWN cache with its own version.
// That way an ordinary app update doesn't download them all again, and the
// first install isn't slowed down: they're fetched quietly in the background
// after the app has loaded (see "warm-ocr" below). Bump this only when the
// files in vendor/ change.
const OCR_CACHE = 'hearthbook-ocr-v1';
const OCR_FILES = [
  './vendor/tesseract/tesseract.min.js',
  './vendor/tesseract/worker.min.js',
  './vendor/tesseract/eng.traineddata.gz',
  './vendor/pdfjs/pdf.min.mjs',
  './vendor/pdfjs/pdf.worker.min.mjs',
];
// The appliance manuals (about 40 MB of PDFs) get their own cache too, filled
// the first time you open More → Manuals ("warm-manuals"), not at install.
// The list is in js/manuals.js. Bump only when the PDFs change.
const MANUALS_CACHE = 'hearthbook-manuals-v1';
const isManual = (url) => new URL(url).pathname.includes('/manuals/') && /\.pdf$/i.test(new URL(url).pathname);

// Tesseract comes in two builds; only download the one this phone will use.
function ocrCoreFiles() {
  let simd = false;
  try {
    simd = WebAssembly.validate(new Uint8Array([0, 97, 115, 109, 1, 0, 0, 0, 1, 5, 1, 96, 0, 1, 123, 3, 2, 1, 0, 10, 10, 1, 8, 0, 65, 0, 253, 15, 253, 98, 11]));
  } catch {}
  const core = simd ? 'tesseract-core-simd-lstm' : 'tesseract-core-lstm';
  return [`./vendor/tesseract/${core}.js`, `./vendor/tesseract/${core}.wasm`];
}

// Every file the app needs to run. If you add a new file, add it here too.
const APP_SHELL = [
  './',
  './index.html',
  './styles.css',
  './report.html',
  './report.css',
  './manifest.json',
  './js/app.js',
  './js/db.js',
  './js/sections.js',
  './js/photos.js',
  './js/backup.js',
  './js/utils.js',
  './js/report.js',
  './js/config.js',
  './js/icons.js',
  './js/charts.js',
  './js/stats.js',
  './js/theme.js',
  './js/periodcard.js',
  './js/scan.js',
  './js/parse.js',
  './js/tariff.js',
  './js/sync.js',
  './js/gdrive.js',
  './js/prefs.js',
  './js/reminders.js',
  './js/search.js',
  './js/house.js',
  './js/motion.js',
  './js/homeui.js',
  './js/manuals.js',
  './js/native.js',
  './js/autosort.js',
  './js/pdfview.js',
  './js/rooms.js',
  './js/usermanuals.js',
  './js/review.js',
  './fonts/inter-latin.woff',
  './icons/icon.svg',
  './icons/icon-192.png',
  './icons/icon-512.png',
  './icons/icon-maskable-512.png',
];

// 1) INSTALL: runs once when this version of the service worker is new.
//    We download every app file into the cache.
self.addEventListener('install', (event) => {
  event.waitUntil(
    // cache: 'reload' (v13) skips the browser's own HTTP cache, so a new
    // version never saves copies of the previous version's files (GitHub
    // Pages lets browsers keep files for 10 minutes).
    caches.open(CACHE_NAME).then((cache) => cache.addAll(APP_SHELL.map((u) => new Request(u, { cache: 'reload' })))).then(() => self.skipWaiting())
  );
});

// 2) ACTIVATE: runs after install. We delete caches from older versions.
self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches
      .keys()
      .then((names) => Promise.all(names.filter((n) => n !== CACHE_NAME && n !== OCR_CACHE && n !== SHARE_CACHE && n !== MANUALS_CACHE).map((n) => caches.delete(n))))
      .then(() => self.clients.claim()) // start controlling open pages straight away
  );
});

// 2b) The page sends 'warm-ocr' once it has loaded and gone quiet. We then
//     download the scanner files (only the ones not already saved), so
//     scanning works offline later. If the phone is offline right now it
//     simply tries again next time the app opens.
let warming = null;
async function warmOcr() {
  const cache = await caches.open(OCR_CACHE);
  for (const url of [...OCR_FILES, ...ocrCoreFiles()]) {
    if (await cache.match(url)) continue;
    const response = await fetch(url);
    if (response.ok) await cache.put(url, response);
  }
}
self.addEventListener('message', (event) => {
  if (event.data && event.data.type === 'warm-ocr') {
    warming = warming || warmOcr().catch(() => {}).finally(() => { warming = null; });
    event.waitUntil(warming);
  }
  if (event.data && event.data.type === 'warm-manuals' && Array.isArray(event.data.files)) {
    manualsWarming = manualsWarming || warmManuals(event.data.files).finally(() => { manualsWarming = null; });
    event.waitUntil(manualsWarming);
  }
});

// 2c) When you tap "Save all for offline" in Manuals (v13: it asks first,
//     ~57 MB), the page sends 'warm-manuals' with the list of PDFs; we save
//     the ones not already saved, one at a time. Otherwise each manual is
//     saved the first time you open it (serveManual below).
//     (The pdf.js reader used to show them comes along too.) If the
//     phone goes offline half way, the rest are fetched next time.
let manualsWarming = null;
async function warmManuals(files) {
  const cache = await caches.open(MANUALS_CACHE);
  for (const f of files) {
    const url = new URL(f, self.registration.scope).href;
    if (!isManual(url) || new URL(url).origin !== self.location.origin) continue;
    try {
      if (await cache.match(url)) continue;
      const response = await fetch(url);
      if (response.status === 200) await cache.put(url, response);
    } catch (err) { /* offline: try again next time */ }
  }
  try { await warmOcr(); } catch {}
}

// 3) FETCH: runs for every file request the app makes.
//    Strategy "cache first": use the saved copy if we have one, otherwise
//    go to the network (and save a copy for next time).
self.addEventListener('fetch', (event) => {
  const request = event.request;
  // A photo or PDF shared to Hearthbook (manifest "share_target"): keep the
  // file in a cache and open the scanner, which picks it up from there.
  if (request.method === 'POST' && new URL(request.url).pathname.endsWith('/share-target')) {
    event.respondWith(receiveShare(request));
    return;
  }
  // Only handle simple GET requests for our own files.
  if (request.method !== 'GET' || new URL(request.url).origin !== self.location.origin) return;
  // Manuals: from their own cache; a manual opened before the cache was
  // filled is saved as it's opened.
  if (isManual(request.url)) {
    event.respondWith(serveManual(request));
    return;
  }

  event.respondWith(
    // ignoreSearch: treat "index.html?x=1" the same as "index.html"
    caches.match(request, { ignoreSearch: true }).then((cached) => {
      if (cached) return cached;
      return fetch(request)
        .then((response) => {
          if (response.status === 200 && !request.headers.has('range')) {
            const copy = response.clone();
            const name = request.url.includes('/vendor/') ? OCR_CACHE : CACHE_NAME;
            caches.open(name).then((cache) => cache.put(request, copy));
          }
          return response;
        })
        .catch(() => {
          // Offline and not cached: for page loads, fall back to the app's main page.
          if (request.mode === 'navigate') return caches.match('./index.html');
          return Response.error();
        });
    })
  );
});

async function serveManual(request) {
  const url = new URL(request.url);
  url.search = '';
  const cache = await caches.open(MANUALS_CACHE);
  const cached = await cache.match(url.href);
  if (cached) return cached;
  try {
    const response = await fetch(url.href);
    if (response.status === 200) await cache.put(url.href, response.clone());
    return response;
  } catch (err) {
    return new Response('This manual hasn’t been saved on this phone yet. Open Manuals once while online.', { status: 503, headers: { 'Content-Type': 'text/plain; charset=utf-8' } });
  }
}

// 4) SHARE TARGET: Android's Share sheet → Hearthbook. The phone POSTs the
//    file here; nothing goes over the internet.
async function receiveShare(request) {
  try {
    const form = await request.formData();
    const file = form.getAll('media').find((f) => f && typeof f === 'object' && f.size > 0);
    if (file) {
      const cache = await caches.open(SHARE_CACHE);
      await cache.put('./__shared__', new Response(file, { headers: { 'Content-Type': file.type || 'application/octet-stream', 'X-File-Name': encodeURIComponent(file.name || 'shared') } }));
    }
  } catch (err) {
    console.warn('share failed', err);
  }
  return Response.redirect('./index.html#/scan/shared', 303);
}

// 5) REMINDERS: tapping a notification opens that entry, in the app window
//    that's already open if there is one.
async function openFromNotification(url) {
  const target = new URL(url || './index.html#/home', self.location.href);
  if (target.origin !== self.location.origin) return;
  const wins = await self.clients.matchAll({ type: 'window', includeUncontrolled: true });
  const win = wins.find((w) => new URL(w.url).origin === self.location.origin);
  if (win) {
    win.postMessage({ type: 'open', hash: target.hash });
    if (win.focus) await win.focus();
    return;
  }
  await self.clients.openWindow(target.href);
}
self.addEventListener('notificationclick', (event) => {
  event.notification.close();
  event.waitUntil(openFromNotification(event.notification.data && event.notification.data.url));
});
// Tests can't tap a real notification, so they ask the worker to act as if
// the newest one with this tag was tapped (same code path as above).
self.addEventListener('message', (event) => {
  if (event.data && event.data.type === 'test-notification-click') {
    event.waitUntil(self.registration.getNotifications({ tag: event.data.tag }).then((list) => {
      const n = list[0];
      if (!n) return;
      n.close();
      return openFromNotification(n.data && n.data.url);
    }));
  }
});
