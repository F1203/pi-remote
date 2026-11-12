// Primero la red (para recibir siempre la última versión) y, sin internet, la copia guardada:
// la app tiene que abrir igual porque el control va por Bluetooth, no por la red.
const CACHE = 'pi-remote-v3';
const FILES = ['./', 'index.html', 'manifest.webmanifest', 'icon-192.png', 'icon-512.png'];

self.addEventListener('install', (ev) => {
  ev.waitUntil(caches.open(CACHE).then((c) => c.addAll(FILES)).then(() => self.skipWaiting()));
});
self.addEventListener('activate', (ev) => {
  ev.waitUntil(caches.keys()
    .then((keys) => Promise.all(keys.filter((k) => k !== CACHE).map((k) => caches.delete(k))))
    .then(() => self.clients.claim()));
});
self.addEventListener('fetch', (ev) => {
  if (ev.request.method !== 'GET') return;
  ev.respondWith(fetch(ev.request).then((res) => {
    const copy = res.clone();
    caches.open(CACHE).then((c) => c.put(ev.request, copy));
    return res;
  }).catch(() => caches.match(ev.request, { ignoreSearch: true })));
});
