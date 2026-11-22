/*
 * Mini Excel - the offline helper ("service worker").
 * The first time someone opens the website, this saves a copy of the app files on their device.
 * After that the app opens even with no internet. When you publish a new version,
 * change VERSION below so everyone gets the new files.
 */
const VERSION = 'mini-excel-v4';
const FILES = [
  './',
  './index.html',
  './style.css',
  './src/engine.js',
  './src/csv.js',
  './src/grid.js',
  './src/pwa.js',
  './manifest.webmanifest',
  './icons/icon-192.png',
  './icons/icon-512.png',
  './icons/apple-touch-icon.png',
];

self.addEventListener('install', (event) => {
  event.waitUntil(caches.open(VERSION).then((cache) => cache.addAll(FILES)).then(() => self.skipWaiting()));
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches
      .keys()
      .then((names) => Promise.all(names.filter((n) => n !== VERSION).map((n) => caches.delete(n))))
      .then(() => self.clients.claim())
  );
});

// Try the internet first (so updates show up); if it fails, use the saved copy.
self.addEventListener('fetch', (event) => {
  if (event.request.method !== 'GET') return;
  event.respondWith(
    fetch(event.request)
      .then((response) => {
        if (response && response.ok && new URL(event.request.url).origin === self.location.origin) {
          const copy = response.clone();
          caches.open(VERSION).then((cache) => cache.put(event.request, copy));
        }
        return response;
      })
      .catch(() => caches.match(event.request).then((hit) => hit || caches.match('./index.html')))
  );
});
