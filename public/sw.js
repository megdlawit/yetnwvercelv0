/**
 * Service worker — two jobs:
 *
 *  1. App shell: cache-first for same-origin build assets (JS/CSS/HTML), so
 *     the app itself still boots on a completely offline cold start.
 *  2. Map tiles: cache-first (falling back to network, and caching what it
 *     fetches) for the outdoor basemap's raster/vector tile requests, so
 *     areas a visitor has already panned/zoomed into stay visible offline.
 *
 *  3. Venues saved for offline use ("Save for offline", src/lib/offline/venuePackage.ts):
 *     each lives in its own cache (yetnew-pack-<venue id>) with the venue's photos, the
 *     street and satellite tiles around it and its pages. Kept across updates of this
 *     worker; answered from whenever the network can't.
 *
 * This intentionally does NOT touch Supabase API calls — those are handled
 * by the app's own IndexedDB caching in src/lib/offline/db.ts, which needs
 * richer fallback logic (version checks, etc.) than a blanket SW cache-first
 * would give.
 */

const SHELL_CACHE = 'ethi-route-shell-v1';
const TILE_CACHE = 'ethi-route-tiles-v1';
const PACK_PREFIX = 'yetnew-pack-';
// Hosts often answer with `Vary: Origin`; a saved copy must still match the browser's later request.
const ANY = { ignoreVary: true };

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
          .filter((key) => key !== SHELL_CACHE && key !== TILE_CACHE && !key.startsWith(PACK_PREFIX))
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

  // Map tiles: cache-first (the tile cache, or a saved venue's), then network, caching the response.
  if (isTileRequest(url)) {
    event.respondWith(
      caches.open(TILE_CACHE).then(async (cache) => {
        const cached = (await cache.match(req, ANY)) || (await caches.match(req, ANY));
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
          // Any cache (a saved venue keeps its own pages); a page we never saw opens the app itself.
          const cached = (await caches.match(req, ANY)) || (req.mode === 'navigate' && ((await caches.match('/', ANY)) || (await caches.match('/index.html', ANY))));
          return cached || Response.error();
        }
      })
    );
    return;
  }

  // Photos (e.g. Supabase Storage): network as usual; when it fails, a saved venue's copy.
  if (req.destination === 'image' || url.pathname.includes('/storage/v1/object/public/')) {
    event.respondWith(
      fetch(req).catch(async () => (await caches.match(req, ANY)) || (await caches.match(req.url, ANY)) || Response.error())
    );
  }
});
