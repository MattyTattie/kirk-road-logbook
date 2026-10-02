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
// (The old 'kirk-road-logbook-v1' cache is deleted automatically on activate.)
const CACHE_NAME = 'hearthbook-v2';

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
      .then((names) => Promise.all(names.filter((n) => n !== CACHE_NAME).map((n) => caches.delete(n))))
      .then(() => self.clients.claim()) // start controlling open pages straight away
  );
});

// 3) FETCH: runs for every file request the app makes.
//    Strategy "cache first": use the saved copy if we have one, otherwise
//    go to the network (and save a copy for next time).
self.addEventListener('fetch', (event) => {
  const request = event.request;
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
            caches.open(CACHE_NAME).then((cache) => cache.put(request, copy));
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
