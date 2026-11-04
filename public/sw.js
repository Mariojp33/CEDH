'use strict';
// Service worker: con conexión siempre se pide lo último al servidor; sin ella se sirve lo último que se vio
// (la web y las respuestas de la API ya consultadas). No toca nada de otros orígenes (imágenes de Scryfall).
const CACHE = 'cedh-v1', MAX_API = 80;

self.addEventListener('install', () => self.skipWaiting());
self.addEventListener('activate', e => e.waitUntil(
  caches.keys().then(ks => Promise.all(ks.filter(k => k !== CACHE).map(k => caches.delete(k)))).then(() => self.clients.claim())));

async function trim(cache) {
  const keys = await cache.keys(), api = keys.filter(k => new URL(k.url).pathname.startsWith('/api/'));
  for (const k of api.slice(0, Math.max(0, api.length - MAX_API))) await cache.delete(k);
}

self.addEventListener('fetch', e => {
  const req = e.request, url = new URL(req.url);
  if (req.method !== 'GET' || url.origin !== location.origin) return;
  e.respondWith((async () => {
    const cache = await caches.open(CACHE);
    try {
      const res = await fetch(req);
      if (res.ok) { cache.put(req, res.clone()).then(() => trim(cache)).catch(() => {}); }
      return res;
    } catch (err) {
      const hit = await cache.match(req, { ignoreSearch: url.pathname === '/' });
      if (hit) return hit;
      throw err;
    }
  })());
});
