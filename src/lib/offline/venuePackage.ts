// Offline packages (business plan §23 and DR-009 "Offline where necessary"): a visitor saves a venue
// before they go — its published map and places, floor drawings, business details and ratings,
// official notices, photos, and the outdoor map around it — and the venue's map then works with
// no connection. Data lives in IndexedDB; photos and map tiles in a Cache Storage cache per venue
// that the service worker (public/sw.js) answers from when the network is gone.

import { supabase } from '@/integrations/supabase/client';
import type { Tables } from '@/integrations/supabase/types';
import type { VenueRows } from '@/components/visitor/loadVenue';
import type { PlanDrawing } from '@/lib/cad/planDrawing';
import { slugify } from '@/lib/accounts';
import { anchorOf } from '@/lib/venue/geoVenue';
import { idbDelete, idbGet, idbKeys, idbSet, STORES } from './db';

export interface VenuePackage {
  /** Format of this record; a newer app ignores (and offers to refresh) older ones. */
  v: 1;
  venueId: string;
  name: string;
  /** What visitors saw when it was saved: the venue's last publish. Newer on the server = an update is waiting. */
  version: string | null;
  savedAt: string;
  building: Tables<'buildings'>;
  rows: Omit<VenueRows, 'live' | 'teamPreview'>;
  drawings: Record<string, PlanDrawing | null>;
  business: Tables<'business_profiles'>[];
  ratings: { poi_id: string; rating: number; reviews: number }[];
  notices: unknown[];
  /** Photos and map tiles stored, and roughly how many bytes everything takes. */
  files: number;
  bytes: number;
}

export type PackageSummary = Pick<VenuePackage, 'venueId' | 'name' | 'version' | 'savedAt' | 'files' | 'bytes'>;

export const PACK_CACHE_PREFIX = 'yetnew-pack-';
export const packCacheName = (venueId: string) => `${PACK_CACHE_PREFIX}${venueId}`;

// ── Map tiles around the venue (pure, tested) ────────────────────────────────

export function lngLatToTile(lng: number, lat: number, z: number): { x: number; y: number } {
  const n = 2 ** z;
  const latR = (Math.max(-85.05112878, Math.min(85.05112878, lat)) * Math.PI) / 180;
  const x = Math.floor(((lng + 180) / 360) * n);
  const y = Math.floor(((1 - Math.log(Math.tan(latR) + 1 / Math.cos(latR)) / Math.PI) / 2) * n);
  return { x: Math.min(n - 1, Math.max(0, x)), y: Math.min(n - 1, Math.max(0, y)) };
}

/** Every tile within `radiusM` of a point for zooms zMin..zMax, at most `cap` tiles (lowest zooms first). */
export function tilesAround(lat: number, lng: number, radiusM: number, zMin: number, zMax: number, cap = 400): { z: number; x: number; y: number }[] {
  const dLat = radiusM / 111_320;
  const dLng = radiusM / (111_320 * Math.max(0.1, Math.cos((lat * Math.PI) / 180)));
  const out: { z: number; x: number; y: number }[] = [];
  for (let z = zMin; z <= zMax; z++) {
    const a = lngLatToTile(lng - dLng, lat + dLat, z), b = lngLatToTile(lng + dLng, lat - dLat, z);
    const count = (b.x - a.x + 1) * (b.y - a.y + 1);
    if (out.length + count > cap) {
      break;
    } else {
      for (let x = a.x; x <= b.x; x++) for (let y = a.y; y <= b.y; y++) out.push({ z, x, y });
    }
  }
  return out;
}

export const tileUrl = (template: string, t: { z: number; x: number; y: number }) =>
  template.replace('{z}', String(t.z)).replace('{x}', String(t.x)).replace('{y}', String(t.y));

/** Photos a visitor would see in this venue: places, stories and events, the cover. */
export function imageUrlsOf(rows: Pick<VenuePackage['rows'], 'pois' | 'content'>, building: Partial<Tables<'buildings'>>): string[] {
  const urls = new Set<string>();
  const add = (u: string | null | undefined) => { if (u && /^https?:\/\//.test(u)) urls.add(u); };
  for (const p of rows.pois) { for (const u of p.images ?? []) add(u); add(p.image_url); }
  for (const c of rows.content) add((c as { image_url?: string | null }).image_url);
  add(building.cover_url);
  return [...urls];
}

/** "4.2 MB" */
export function sizeText(bytes: number): string {
  if (bytes < 1024 * 1024) {
    return `${Math.max(1, Math.round(bytes / 1024))} KB`;
  } else {
    return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
  }
}

/** True when the venue was published again after the package was saved. */
export const packageOutdated = (pack: Pick<VenuePackage, 'version'>, publishedAt: string | null | undefined) =>
  !!publishedAt && (!pack.version || new Date(publishedAt).getTime() > new Date(pack.version).getTime());

// ── Storage ──────────────────────────────────────────────────────────────────

export async function getPackage(venueIdOrSlug: string): Promise<VenuePackage | null> {
  const direct = await idbGet<VenuePackage>(STORES.venuePackages, venueIdOrSlug);
  if (direct?.v === 1) {
    return direct;
  } else {
    const all = await listPackages();
    const hit = all.find(p => slugify(p.name) === venueIdOrSlug.toLowerCase());
    return hit ? idbGet<VenuePackage>(STORES.venuePackages, hit.venueId) : null;
  }
}

export async function listPackages(): Promise<PackageSummary[]> {
  const keys = await idbKeys(STORES.venuePackages);
  const packs = await Promise.all(keys.map(k => idbGet<VenuePackage>(STORES.venuePackages, k)));
  return packs.filter((p): p is VenuePackage => p?.v === 1)
    .map(({ venueId, name, version, savedAt, files, bytes }) => ({ venueId, name, version, savedAt, files, bytes }));
}

export async function removePackage(venueId: string): Promise<void> {
  await idbDelete(STORES.venuePackages, venueId);
  if (typeof caches !== 'undefined') await caches.delete(packCacheName(venueId));
  window.dispatchEvent(new Event(PACKAGES_CHANGED));
}

/** A floor's drawing from any saved package (the visitor map asks when the network can't answer). */
export async function packagedDrawing(floorId: string): Promise<PlanDrawing | null> {
  for (const p of await listPackages()) {
    const pack = await idbGet<VenuePackage>(STORES.venuePackages, p.venueId);
    if (pack && floorId in pack.drawings) return pack.drawings[floorId];
  }
  return null;
}

export const PACKAGES_CHANGED = 'yetnew-offline-packages-changed';

// ── Saving ───────────────────────────────────────────────────────────────────

export type Progress = { step: 'data' | 'files'; done: number; total: number };

const STREETS_STYLE = 'https://tiles.openfreemap.org/styles/liberty';
const SATELLITE = 'https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}';

/** The street map's own files for the area: style, vector tiles, icons and the fonts it labels with (Latin and Ethiopic). */
async function streetMapUrls(lat: number, lng: number): Promise<string[]> {
  try {
    const style = await (await fetch(STREETS_STYLE)).json() as {
      sources?: Record<string, { type: string; url?: string; tiles?: string[] }>; sprite?: string; glyphs?: string;
      layers?: { layout?: { 'text-font'?: string[] } }[];
    };
    const urls = [STREETS_STYLE];
    for (const src of Object.values(style.sources ?? {})) {
      if (src.type === 'vector') {
        let templates = src.tiles ?? [];
        let maxzoom = 14;
        if (!templates.length && src.url) {
          urls.push(src.url);
          const tj = await (await fetch(src.url)).json() as { tiles?: string[]; maxzoom?: number };
          templates = tj.tiles ?? [];
          maxzoom = tj.maxzoom ?? 14;
        } else {
          // tiles listed in the style itself
        }
        for (const t of tilesAround(lat, lng, 1500, 11, Math.min(14, maxzoom), 120)) urls.push(tileUrl(templates[0], t));
      } else {
        // raster or other sources: the satellite view is added separately
      }
    }
    if (style.sprite) for (const s of ['', '@2x']) urls.push(`${style.sprite}${s}.json`, `${style.sprite}${s}.png`);
    if (style.glyphs) {
      const stacks = new Set((style.layers ?? []).map(l => l.layout?.['text-font']?.join(',')).filter((s): s is string => !!s));
      for (const stack of stacks) for (const range of ['0-255', '256-511', '4608-4863', '4864-5119']) {
        urls.push(style.glyphs.replace('{fontstack}', encodeURIComponent(stack)).replace('{range}', range));
      }
    }
    return urls;
  } catch {
    return [];
  }
}

async function store(cache: Cache, url: string): Promise<number> {
  try {
    let res = await fetch(url, { mode: 'cors', credentials: 'omit' }).catch(() => null);
    if (!res || (!res.ok && res.type !== 'opaque')) res = await fetch(url, { mode: 'no-cors' });
    await cache.put(url, res.clone());
    const len = Number(res.headers.get('content-length') ?? 0);
    return len || (res.type === 'opaque' ? 30_000 : (await res.blob()).size);
  } catch {
    return 0;
  }
}

/**
 * Save a published venue for offline use (or update a saved one). Visitors get the copy taken at
 * the venue's last publish — the same one they see online.
 */
export async function saveVenuePackage(venueId: string, onProgress?: (p: Progress) => void): Promise<PackageSummary> {
  onProgress?.({ step: 'data', done: 0, total: 1 });
  const { data: b, error } = await supabase.from('buildings').select('*').eq('id', venueId).maybeSingle();
  if (error || !b || !b.is_published) throw new Error(error?.message ?? 'Only published venues can be saved for offline use.');
  const { data: snap } = await supabase.from('venue_snapshots').select('data').eq('building_id', venueId).maybeSingle();
  if (!snap?.data) throw new Error('This venue has no published copy yet.');
  const d = snap.data as unknown as Omit<VenueRows, 'live' | 'teamPreview'>;
  const rows: VenuePackage['rows'] = {
    building: d.building ?? b, floors: d.floors ?? [], nodes: d.nodes ?? [], edges: d.edges ?? [], rooms: d.rooms ?? [], walls: d.walls ?? [],
    map_features: d.map_features ?? [], pois: d.pois ?? [], content: d.content ?? [],
  };
  const [dr, bp, rs, nt] = await Promise.all([
    rows.floors.length ? supabase.from('floor_drawings').select('floor_id, published').in('floor_id', rows.floors.map(f => f.id)) : Promise.resolve({ data: [] }),
    supabase.from('business_profiles').select('*').eq('building_id', venueId),
    supabase.rpc('place_review_summary', { b: venueId }),
    supabase.rpc('venue_notices' as never, { b: venueId } as never) as unknown as Promise<{ data: unknown[] | null }>,
  ]);
  const drawings: Record<string, PlanDrawing | null> = {};
  for (const f of rows.floors) drawings[f.id] = null;
  for (const x of (dr.data ?? []) as { floor_id: string; published: unknown }[]) {
    const p = x.published as PlanDrawing | null;
    drawings[x.floor_id] = p && p.v === 1 && p.layers ? p : null;
  }

  // The 3D and outdoor views load on demand: load them now, so they're among the app's files below.
  await Promise.all([import('@/components/venue/Venue3D'), import('@/components/venue/OutdoorView')]).catch(() => undefined);
  // Files: the app itself (on a first visit it loaded before the service worker took over, so it isn't
  // cached yet), the venue's pages, photos, and — for venues on the world map — the map around them.
  const appFiles = performance.getEntriesByType('resource').map(e => e.name)
    .filter(u => u.startsWith(window.location.origin) && /\.(js|css|woff2?|wasm)(\?|$)/.test(u));
  const urls = new Set<string>([`${window.location.origin}/`, `${window.location.origin}/venue/${venueId}`, ...appFiles, ...imageUrlsOf(rows, b)]);
  const anchor = anchorOf(b);
  if (anchor) {
    for (const u of await streetMapUrls(anchor.originLat, anchor.originLng)) urls.add(u);
    for (const t of tilesAround(anchor.originLat, anchor.originLng, 700, 14, 18, 260)) urls.add(tileUrl(SATELLITE, t));
  } else {
    // an indoor venue not placed on the world map: its own plan is the map
  }
  let bytes = JSON.stringify(rows).length + JSON.stringify(drawings).length, files = 0;
  if (typeof caches !== 'undefined') {
    const cache = await caches.open(packCacheName(venueId));
    const list = [...urls];
    let done = 0;
    // A few at a time: quick on good connections, gentle on the venue's Wi-Fi.
    for (let i = 0; i < list.length; i += 6) {
      const sizes = await Promise.all(list.slice(i, i + 6).map(u => store(cache, u)));
      for (const s of sizes) { if (s > 0) { files++; bytes += s; } else { /* not stored: skipped */ } }
      done = Math.min(list.length, i + 6);
      onProgress?.({ step: 'files', done, total: list.length });
    }
  } else {
    // no Cache Storage (very old browser): data only
  }

  const pack: VenuePackage = {
    v: 1, venueId, name: b.name, version: b.published_at, savedAt: new Date().toISOString(), building: b, rows, drawings,
    business: bp.data ?? [], ratings: ((rs.data ?? []) as { poi_id: string; rating: number; reviews: number }[]).map(r => ({ poi_id: r.poi_id, rating: Number(r.rating), reviews: Number(r.reviews) })),
    notices: nt.data ?? [], files, bytes,
  };
  const ok = await idbSet(STORES.venuePackages, venueId, pack);
  if (!ok) throw new Error('This device has no room to save the venue. Free some space and try again.');
  window.dispatchEvent(new Event(PACKAGES_CHANGED));
  return { venueId, name: pack.name, version: pack.version, savedAt: pack.savedAt, files, bytes };
}
