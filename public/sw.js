/**
 * Service worker — two jobs:
 *
 *  1. App shell: cache-first for same-origin build assets (JS/CSS/HTML), so
 *     the app itself still boots on a completely offline cold start.
 *  2. Map tiles: cache-first (falling back to network, and caching what it
 *     fetches) for the outdoor basemap's raster/vector tile requests, so
 *     areas a visitor has already panned/zoomed into stay visible offline.
 *
 * This intentionally does NOT touch Supabase API calls — those are handled
 * by the app's own IndexedDB caching in src/lib/offline/db.ts, which needs
 * richer fallback logic (version checks, etc.) than a blanket SW cache-first
 * would give.
 */

const SHELL_CACHE = 'ethi-route-shell-v1';
const TILE_CACHE = 'ethi-route-tiles-v1';

const TILE_HOSTS = [
  'tiles.openfreemap.org',
  'server.arcgisonline.com',
  'a.tile.opentopomap.org',
  'b.tile.opentopomap.org',
  'c.tile.opentopomap.org',
];

self.addEventListener('install', () => {
  self.skipWaiting();
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches.keys().then((keys) =>
      Promise.all(
        keys
          .filter((key) => key !== SHELL_CACHE && key !== TILE_CACHE)
          .map((key) => caches.delete(key))
      )
    )
  );
  self.clients.claim();
});

function isTileRequest(url) {
  return TILE_HOSTS.some((host) => url.hostname === host || url.hostname.endsWith('.' + host));
}

self.addEventListener('fetch', (event) => {
  const req = event.request;
  if (req.method !== 'GET') return;

  const url = new URL(req.url);

  // Map tiles: cache-first, then network, caching the response.
  if (isTileRequest(url)) {
    event.respondWith(
      caches.open(TILE_CACHE).then(async (cache) => {
        const cached = await cache.match(req);
        if (cached) return cached;
        try {
          const res = await fetch(req);
          if (res.ok) cache.put(req, res.clone());
          return res;
        } catch (err) {
          return cached || Response.error();
        }
      })
    );
    return;
  }

  // Same-origin app shell: network-first, falling back to cache when offline.
  if (url.origin === self.location.origin) {
    event.respondWith(
      caches.open(SHELL_CACHE).then(async (cache) => {
        try {
          const res = await fetch(req);
          if (res.ok) cache.put(req, res.clone());
          return res;
        } catch (err) {
          const cached = await cache.match(req);
          return cached || cache.match('/index.html') || Response.error();
        }
      })
    );
  }
});
