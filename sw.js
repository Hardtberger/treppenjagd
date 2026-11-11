/* Offline-Unterstützung: App-Hülle und Treppendaten werden zwischengespeichert.
   Kartenkacheln kommen immer frisch vom Kartenserver (Browser-Cache genügt). */
const CACHE = 'treppenjagd-v3';
const SHELL = ['./', 'index.html', 'styles.css', 'js/match.js', 'js/game.js', 'js/app.js', 'data/stairs.json', 'data/areas.json', 'icons/icon.svg', 'manifest.webmanifest',
  'vendor/leaflet/leaflet.css', 'vendor/leaflet/leaflet.js', 'vendor/fonts/anton-400.woff2', 'vendor/fonts/aileron-400.woff2', 'vendor/fonts/aileron-700.woff2'];
self.addEventListener('install', (e) => e.waitUntil(caches.open(CACHE).then((c) => c.addAll(SHELL)).then(() => self.skipWaiting())));
self.addEventListener('activate', (e) => e.waitUntil(caches.keys().then((ks) => Promise.all(ks.filter((k) => k !== CACHE).map((k) => caches.delete(k)))).then(() => self.clients.claim())));
self.addEventListener('fetch', (e) => {
  const url = new URL(e.request.url);
  if (e.request.method !== 'GET' || url.hostname.endsWith('openstreetmap.org')) return;
  // Netz zuerst (damit Updates ankommen), Cache als Rückfall für unterwegs ohne Empfang
  e.respondWith(fetch(e.request).then((r) => {
    if (r.ok && url.origin === location.origin) { const copy = r.clone(); caches.open(CACHE).then((c) => c.put(e.request, copy)); }
    return r;
  }).catch(() => caches.match(e.request, { ignoreSearch: true })));
});
