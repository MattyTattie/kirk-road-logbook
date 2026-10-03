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
// (Older caches such as 'kirk-road-logbook-v1' are deleted automatically on activate.)
const CACHE_NAME = 'hearthbook-v10';
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
    caches.open(CACHE_NAME).then((cache) => cache.addAll(APP_SHELL)).then(() => self.skipWaiting())
  );
});

// 2) ACTIVATE: runs after install. We delete caches from older versions.
self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches
      .keys()
      .then((names) => Promise.all(names.filter((n) => n !== CACHE_NAME && n !== OCR_CACHE && n !== SHARE_CACHE).map((n) => caches.delete(n))))
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
});

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

  event.respondWith(
    // ignoreSearch: treat "index.html?x=1" the same as "index.html"
    caches.match(request, { ignoreSearch: true }).then((cached) => {
      if (cached) return cached;
      return fetch(request)
        .then((response) => {
          if (response.ok) {
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
