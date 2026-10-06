/**
 * OutdoorMapEngine — fetches walkable graphs from OpenStreetMap (Overpass API)
 * and runs Dijkstra over them. Results are cached in localStorage by bbox key.
 *
 * Network cost is significant; we cache aggressively (24h) and let callers
 * preload around a building's geo-anchor.
 */

import type { GeoCoord, OutdoorEdge, OutdoorGraph, OutdoorNode, TravelMode } from './GeoTypes';
import { haversineMeters } from './GeoMath';

/** Highway tags safe/legal to route on foot. Excludes motorways — those
 *  aren't walkable even though OSM sometimes tags a parallel footway. */
const WALK_HIGHWAYS =
  'footway|path|pedestrian|residential|service|living_street|track|steps|cycleway|unclassified|road|primary|primary_link|secondary|secondary_link|tertiary|tertiary_link|trunk|trunk_link';

/** Highway tags drivable by car. Excludes footway/path/pedestrian/steps/
 *  cycleway/track — those aren't legal or physically drivable. */
const CAR_HIGHWAYS =
  'residential|service|living_street|unclassified|road|primary|primary_link|secondary|secondary_link|tertiary|tertiary_link|trunk|trunk_link|motorway|motorway_link';

/** Rough free-flow speeds (m/s) per highway tag, used to weight the driving
 *  graph by *time* rather than raw distance — otherwise Dijkstra would
 *  happily route down a residential backstreet instead of a faster
 *  arterial road just because it's a few meters shorter. */
const CAR_SPEED_MPS: Record<string, number> = {
  motorway: 27.8, motorway_link: 15,
  trunk: 22.2, trunk_link: 13.9,
  primary: 16.7, primary_link: 11.1,
  secondary: 13.9, secondary_link: 10,
  tertiary: 11.1, tertiary_link: 8.3,
  unclassified: 8.3, road: 8.3,
  residential: 8.3, living_street: 4.2,
  service: 5.6,
};
const DEFAULT_CAR_SPEED_MPS = 8.3;

// The proxy (`/api/overpass`) now races all public mirrors server-side and
// forwards whichever one answers first with data — see api/overpass.ts.
// We used to *also* call two mirrors directly from the browser here for
// "redundancy", but that redundancy was mostly illusory: those calls run on
// the end user's own (often slow/unreliable mobile) connection rather than
// Vercel's, and just doubled the total requests without meaningfully
// improving odds of success. Racing at the proxy instead means one fast,
// reliable hop for the client and the actual mirror-failover logic runs
// somewhere with good network conditions.
const OVERPASS_ENDPOINTS = ['/api/overpass'];

// Bumping this invalidates any graphs cached under the old, narrower
// highway-type filter (footway/residential only) — without it, browsers
// that already had a graph cached for an area would keep serving the old
// one for up to CACHE_TTL_MS and never pick up newly-included road types.
const CACHE_VERSION = 'v4';
/** Cache is now split by travel mode too — a walk graph (includes
 *  footpaths, excludes nothing drivable) and a car graph (drivable roads
 *  only, time-weighted) cover different edge sets, so they can't share a
 *  cache entry under the same bbox key. */
function cachePrefix(mode: TravelMode): string {
  return `outdoor-graph-${CACHE_VERSION}-${mode}-`;
}
const CACHE_TTL_MS = 24 * 60 * 60 * 1000;
/** After a failed load, wait this long before trying Overpass again for the
 *  same area — avoids hammering an already-struggling/rate-limited server
 *  on every GPS tick (which was making the 504s worse, not better). */
const FAILURE_COOLDOWN_MS = 8_000;
/** A stale cached graph (older than CACHE_TTL_MS) is still far better than a
 *  direct line — it's real path data, just possibly missing very recent OSM
 *  edits. We keep it around this long as a last-resort fallback when a live
 *  fetch fails, instead of discarding it outright at the 24h mark. */
const STALE_CACHE_MAX_AGE_MS = 7 * 24 * 60 * 60 * 1000;
/** Timeout for the single request to `/api/overpass`. The proxy itself races
 *  every public mirror server-side (see api/overpass.ts) with an 8s budget
 *  per mirror, so this needs enough headroom above that for the response to
 *  travel back, rather than the old value tuned for racing mirrors directly
 *  from the browser. */
const ENDPOINT_TIMEOUT_MS = 11_000;
/** Above this start↔dest distance, loadForRoute falls back to a plain
 *  radius fetch around the start instead of a bbox spanning the whole
 *  route, to keep the Overpass query fast and reasonably sized.
 *
 *  Exported so HybridNavigationBrain can use the same threshold to decide
 *  when to hand a route off to StreetRouting (OSRM) instead of the local
 *  Overpass+Dijkstra graph — anything wider than this span is a "walking/
 *  driving to the venue from elsewhere in the city" trip, not a "find the
 *  path around the venue" trip, and querying/solving a city-scale Overpass
 *  graph client-side for that is both slow and unnecessary. */
export const MAX_ROUTE_SPAN_M = 3_000;

interface RouteResult {
  path: OutdoorNode[];
  distanceM: number;
}

export class OutdoorMapEngine {
  private graph: OutdoorGraph | null = null;
  private adjacency = new Map<string, { to: string; weight: number; meters: number; edgeId: string }[]>();
  private nodeById = new Map<string, OutdoorNode>();
  private loading = false;
  /** Which bbox (mode + key) the in-flight fetch is for, and its promise —
   *  lets a request for a *different* bbox wait its turn instead of being
   *  silently dropped (see loadBbox). */
  private loadingKey: string | null = null;
  private loadingPromise: Promise<OutdoorGraph | null> | null = null;
  /** Keyed by `${mode}|${bboxKey}` — tracked per bbox (not globally) so a
   *  recent failure fetching one area (e.g. an automatic preload around the
   *  person's current position) doesn't block a fresh attempt at a
   *  *different* area (e.g. the actual route bbox for a destination they
   *  just picked). A single global cooldown was causing exactly that: the
   *  person taps navigate, an unrelated preload failed a moment earlier,
   *  and the route fetch got skipped entirely until the global cooldown
   *  expired — showing a straight line for several seconds even though the
   *  real route bbox was never actually tried. */
  private failureAtByKey = new Map<string, number>();
  /** Current travel mode — governs which roads are fetched/routable and
   *  how edges are weighted. Defaults to walking (existing behavior). */
  private travelMode: TravelMode = 'walk';

  getGraph(): OutdoorGraph | null {
    return this.graph;
  }

  getTravelMode(): TravelMode {
    return this.travelMode;
  }

  /** Switch travel mode. Clears the in-memory graph so the next load call
   *  fetches (or reads from cache) the correct mode's road network instead
   *  of silently continuing to route on the old one. */
  setTravelMode(mode: TravelMode): void {
    if (this.travelMode === mode) return;
    this.travelMode = mode;
    this.graph = null;
    this.adjacency.clear();
    this.nodeById.clear();
  }

  isLoading(): boolean {
    return this.loading;
  }

  /** True if *any* recent fetch failed and we're still within that specific
   *  bbox's cooldown. Mainly useful for a coarse "is anything broken right
   *  now" signal; prefer `hasFailedRecentlyFor` when you know which
   *  start/dest pair you actually care about, since that checks the right
   *  bbox instead of being tripped up by an unrelated area's failure. */
  hasFailedRecently(): boolean {
    if (this.graph || this.loading) return false;
    const now = Date.now();
    for (const failedAt of this.failureAtByKey.values()) {
      if (now - failedAt < FAILURE_COOLDOWN_MS) return true;
    }
    return false;
  }

  /** True if we recently failed to fetch *this exact* bbox (the one
   *  `loadForRoute`/`loadAround` would use for these coordinates) and are
   *  still cooling down — as opposed to some unrelated area. Callers
   *  deciding whether to show a direct-line fallback for a specific
   *  start/dest pair should use this instead of the global check. */
  hasFailedRecentlyFor(start: GeoCoord, dest?: GeoCoord, paddingM = 150): boolean {
    if (this.loading) return false;
    const bbox = dest
      ? (haversineMeters(start, dest) > MAX_ROUTE_SPAN_M ? bboxAround(start, 800) : bboxForPoints(start, dest, paddingM))
      : bboxAround(start, 400);
    const failKey = this.travelMode + '|' + bboxKey(bbox);
    const failedAt = this.failureAtByKey.get(failKey);
    return failedAt != null && Date.now() - failedAt < FAILURE_COOLDOWN_MS;
  }

  /**
   * Load a walkable graph around `center` (radius in meters). Tries cache
   * first, then Overpass. Subsequent calls within the same area are no-ops.
   */
  async loadAround(center: GeoCoord, radiusM = 400): Promise<OutdoorGraph | null> {
    return this.loadBbox(bboxAround(center, radiusM));
  }

  /**
   * Load a walkable graph covering *both* `start` and `dest`, padded by
   * `paddingM`. Plain `loadAround(start)` only fetches a circle around the
   * person's current position — if the destination sits outside that
   * circle, its real OSM path data never gets fetched at all and routing
   * falls back to a direct line even though a proper path exists, just
   * out of range. This is what computeOutdoorRoute should use once a
   * destination is known.
   *
   * The bbox area is capped (via MAX_ROUTE_SPAN_M) so a very distant
   * destination doesn't trigger a huge, slow Overpass query — beyond that
   * span we just fetch generously around the start and let progressive
   * re-fetching (as the person walks) pick up the rest.
   */
  async loadForRoute(start: GeoCoord, dest: GeoCoord, paddingM = 150): Promise<OutdoorGraph | null> {
    const spanM = haversineMeters(start, dest);
    if (spanM > MAX_ROUTE_SPAN_M) return this.loadAround(start, 800);
    return this.loadBbox(bboxForPoints(start, dest, paddingM));
  }

  private async loadBbox(bbox: ReturnType<typeof bboxAround>): Promise<OutdoorGraph | null> {
    const mode = this.travelMode;
    const key = bboxKey(bbox);
    const failKey = mode + '|' + key;
    const cached = readCache(mode, key, CACHE_TTL_MS);
    if (cached) {
      this.setGraph(cached);
      return cached;
    }
    // FIX — this used to be `if (this.loading) return this.graph;`, a single
    // global lock. Tapping an existing pin fires preloadOutdoorGraph(poi)
    // right as the outdoor map's own on-mount preload (around the venue
    // center, a *different* bbox) is still in flight — search doesn't hit
    // this because typing + picking a result takes long enough for that
    // first fetch to clear. With the old code, this request for the pin's
    // bbox was silently dropped: it returned early with whatever graph
    // existed (often none yet), and nothing ever queued a fetch for the
    // pin's actual area — computeOutdoorRoute would only recover later, and
    // only if some unrelated event (a GPS tick) happened to retry. Now a
    // request for a *different* bbox waits for the in-flight one to finish,
    // then actually fetches its own area, so the real street data always
    // gets requested instead of silently dropped.
    if (this.loading && this.loadingKey !== failKey) {
      await this.loadingPromise;
      return this.loadBbox(bbox);
    }
    if (this.loading) return this.loadingPromise; // same bbox already in flight — share it
    const failedAt = this.failureAtByKey.get(failKey);
    if (failedAt != null && Date.now() - failedAt < FAILURE_COOLDOWN_MS) return this.graph; // still cooling down for this bbox specifically
    this.loading = true;
    this.loadingKey = failKey;
    this.loadingPromise = this.doLoadBbox(bbox, mode, key, failKey);
    return this.loadingPromise;
  }

  private async doLoadBbox(
    bbox: ReturnType<typeof bboxAround>,
    mode: TravelMode,
    key: string,
    failKey: string,
  ): Promise<OutdoorGraph | null> {
    try {
      const graph = await fetchOverpass(bbox, mode);
      if (graph) {
        writeCache(mode, key, graph);
        this.setGraph(graph);
        this.failureAtByKey.delete(failKey);
        return graph;
      }
      this.failureAtByKey.set(failKey, Date.now());
    } catch (e) {
      this.failureAtByKey.set(failKey, Date.now());
      console.warn('[OutdoorMapEngine] Overpass fetch failed', e);
    } finally {
      this.loading = false;
      this.loadingKey = null;
      this.loadingPromise = null;
    }

    // Both mirrors failed/timed out. A real (if slightly stale, up to 7 days
    // old) path graph is still a much better experience than a straight line
    // through buildings — use it if we have one cached for this area, rather
    // than dropping straight to computeDirectFallbackRoute.
    const stale = readCache(mode, key, STALE_CACHE_MAX_AGE_MS);
    if (stale) {
      console.warn('[OutdoorMapEngine] using stale cached graph after live fetch failure');
      this.setGraph(stale);
      return stale;
    }
    return null;
  }

  /** Inject a graph (testing / sample data). */
  setGraph(graph: OutdoorGraph): void {
    this.graph = graph;
    this.nodeById.clear();
    this.adjacency.clear();
    for (const n of graph.nodes) this.nodeById.set(n.id, n);
    for (const e of graph.edges) {
      // In car mode, Dijkstra should minimize *time*, not distance — a
      // shorter residential shortcut isn't actually faster than a slightly
      // longer arterial road. Edge.weight itself stays a plain meter
      // distance (used for the distance readout); routing weight is
      // distance / speed only when driving.
      const weight = this.travelMode === 'car'
        ? e.weight / (CAR_SPEED_MPS[e.highway ?? ''] ?? DEFAULT_CAR_SPEED_MPS)
        : e.weight;
      pushAdj(this.adjacency, e.fromNodeId, { to: e.toNodeId, weight, meters: e.weight, edgeId: e.id });
      pushAdj(this.adjacency, e.toNodeId, { to: e.fromNodeId, weight, meters: e.weight, edgeId: e.id });
    }
  }

  /** Add a virtual node (e.g. an outdoor POI) wired to its nearest graph node. */
  addVirtualNode(node: OutdoorNode, maxConnectM = 80): OutdoorNode | null {
    if (!this.graph) return null;
    const nearest = this.nearestNode(node, maxConnectM);
    if (!nearest) return null;
    this.nodeById.set(node.id, node);
    const w = haversineMeters(node, nearest);
    const edgeId = `virt-${node.id}-${nearest.id}`;
    pushAdj(this.adjacency, node.id, { to: nearest.id, weight: w, meters: w, edgeId });
    pushAdj(this.adjacency, nearest.id, { to: node.id, weight: w, meters: w, edgeId });
    return node;
  }

  nearestNode(point: GeoCoord, maxDistanceM = 200): OutdoorNode | null {
    let best: { n: OutdoorNode; d: number } | null = null;
    for (const n of this.nodeById.values()) {
      const d = haversineMeters(point, n);
      if (d > maxDistanceM) continue;
      if (!best || d < best.d) best = { n, d };
    }
    return best?.n ?? null;
  }

  /** Diagnostic only — ignores maxDistanceM, used to log *how far* the
   *  nearest known path node actually is when snapping fails, instead of
   *  just "no node found". Cheap to call on failure (not hot-path). */
  nearestNodeDistance(point: GeoCoord): number | null {
    let best = Infinity;
    for (const n of this.nodeById.values()) {
      const d = haversineMeters(point, n);
      if (d < best) best = d;
    }
    return Number.isFinite(best) ? best : null;
  }

  findRoute(fromId: string, toId: string): RouteResult | null {
    if (!this.graph) return null;
    // `dist` accumulates the *routing cost* (seconds when driving, meters
    // when walking) — this is what Dijkstra minimizes. `realDist` tracks
    // actual meters travelled along the same relaxed edges, kept in lock-
    // step, so a driving route (which optimizes for time) still reports a
    // correct distanceM instead of a travel-time value mislabeled as meters.
    const dist = new Map<string, number>();
    const realDist = new Map<string, number>();
    const prev = new Map<string, string | null>();
    const visited = new Set<string>();
    dist.set(fromId, 0);
    realDist.set(fromId, 0);
    prev.set(fromId, null);

    // Simple O((V+E) log V) priority-queue-less Dijkstra; outdoor graphs are
    // small (a few hundred nodes), so a linear scan is fine.
    while (true) {
      let u: string | null = null;
      let best = Infinity;
      for (const [id, d] of dist) {
        if (!visited.has(id) && d < best) {
          best = d;
          u = id;
        }
      }
      if (u === null) break;
      if (u === toId) break;
      visited.add(u);
      const neigh = this.adjacency.get(u) ?? [];
      for (const { to, weight, meters } of neigh) {
        if (visited.has(to)) continue;
        const alt = best + weight;
        if (alt < (dist.get(to) ?? Infinity)) {
          dist.set(to, alt);
          realDist.set(to, (realDist.get(u) ?? 0) + meters);
          prev.set(to, u);
        }
      }
    }

    if (!dist.has(toId)) return null;
    const path: OutdoorNode[] = [];
    let cur: string | null = toId;
    while (cur) {
      const n = this.nodeById.get(cur);
      if (n) path.unshift(n);
      cur = prev.get(cur) ?? null;
    }
    return { path, distanceM: realDist.get(toId) ?? 0 };
  }
}

function pushAdj(
  m: Map<string, { to: string; weight: number; meters: number; edgeId: string }[]>,
  k: string,
  v: { to: string; weight: number; meters: number; edgeId: string },
) {
  const arr = m.get(k);
  if (arr) arr.push(v);
  else m.set(k, [v]);
}

function bboxAround(c: GeoCoord, radiusM: number) {
  const dLat = radiusM / 111_320;
  const dLng = radiusM / (111_320 * Math.cos((c.lat * Math.PI) / 180));
  return {
    south: c.lat - dLat,
    north: c.lat + dLat,
    west: c.lng - dLng,
    east: c.lng + dLng,
  };
}

/** Bounding box covering both `a` and `b`, padded by `paddingM` on each side. */
function bboxForPoints(a: GeoCoord, b: GeoCoord, paddingM: number) {
  const south = Math.min(a.lat, b.lat);
  const north = Math.max(a.lat, b.lat);
  const west = Math.min(a.lng, b.lng);
  const east = Math.max(a.lng, b.lng);
  const midLat = (south + north) / 2;
  const dLat = paddingM / 111_320;
  const dLng = paddingM / (111_320 * Math.cos((midLat * Math.PI) / 180));
  return {
    south: south - dLat,
    north: north + dLat,
    west: west - dLng,
    east: east + dLng,
  };
}

function bboxKey(b: ReturnType<typeof bboxAround>): string {
  const r = (n: number) => n.toFixed(4);
  return `${r(b.south)},${r(b.west)},${r(b.north)},${r(b.east)}`;
}

function readCache(mode: TravelMode, key: string, maxAgeMs: number): OutdoorGraph | null {
  try {
    const raw = localStorage.getItem(cachePrefix(mode) + key);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as OutdoorGraph;
    if (Date.now() - parsed.fetchedAt > maxAgeMs) return null;
    // An empty graph (no routable edges) isn't useful data worth trusting —
    // see the matching guard in fetchOverpass for why this can happen.
    if (!parsed.edges || parsed.edges.length === 0) return null;
    return parsed;
  } catch {
    return null;
  }
}

function writeCache(mode: TravelMode, key: string, g: OutdoorGraph): void {
  try {
    localStorage.setItem(cachePrefix(mode) + key, JSON.stringify(g));
  } catch (e) {
    console.warn('[OutdoorMapEngine] cache write failed', e);
  }
}

async function fetchOverpass(bbox: ReturnType<typeof bboxAround>, mode: TravelMode): Promise<OutdoorGraph | null> {
  const highways = mode === 'car' ? CAR_HIGHWAYS : WALK_HIGHWAYS;
  const q = `
[out:json][timeout:10];
(
  way["highway"~"^(${highways})$"]
    (${bbox.south},${bbox.west},${bbox.north},${bbox.east});
);
out body;
>;
out skel qt;
`.trim();

  // OVERPASS_ENDPOINTS now holds just the proxy — actual mirror racing
  // happens server-side in api/overpass.ts (see comment there for why).
  // This still goes through allSettled/selectBestOverpassGraph so the
  // empty-vs-error distinction below applies uniformly either way.
  const attempts = OVERPASS_ENDPOINTS.map((url) => fetchOneOverpass(url, q, bbox));
  const results = await Promise.allSettled(attempts);
  // IMPORTANT: a fulfilled promise with zero edges is NOT a success — it's
  // Overpass correctly answering "no matching ways in this bbox", which
  // previously got treated as valid data, cached for 24h, and permanently
  // stuck the app on the direct-line fallback (this is the actual bug
  // behind "street data unavailable, showing direct route" persisting even
  // when a real path genuinely exists nearby). Only accept a result that
  // actually contains routable edges; otherwise keep checking the other
  // mirrors, and if all of them come back empty, report this as a failure
  // so the caller retries later instead of caching the empty result.
  const graph = selectBestOverpassGraph(results);
  if (graph) return graph;
  const firstError = results.find(
    (r): r is PromiseRejectedResult => r.status === 'rejected'
  )?.reason;
  if (firstError) console.warn('[OutdoorMapEngine] Overpass endpoints failed', firstError);
  else console.warn('[OutdoorMapEngine] Overpass returned no walkable ways for this area');
  return null;
}

export function selectBestOverpassGraph(
  results: Array<PromiseSettledResult<OutdoorGraph | null>>,
): OutdoorGraph | null {
  for (const result of results) {
    if (result.status === 'fulfilled' && result.value && result.value.edges.length > 0) {
      return result.value;
    }
  }
  return null;
}

async function fetchOneOverpass(
  url: string,
  q: string,
  bbox: ReturnType<typeof bboxAround>,
): Promise<OutdoorGraph | null> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), ENDPOINT_TIMEOUT_MS);
  try {
    const res = await fetch(url, {
      method: 'POST',
      body: 'data=' + encodeURIComponent(q),
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      signal: controller.signal,
    });
    if (!res.ok) throw new Error('overpass ' + res.status);
    const json = await res.json();
    return parseOverpass(json, bbox);
  } finally {
    clearTimeout(timer);
  }
}

interface OverpassNode { type: 'node'; id: number; lat: number; lon: number; }
interface OverpassWay  { type: 'way';  id: number; nodes: number[]; tags?: Record<string, string>; }
type OverpassEl = OverpassNode | OverpassWay;

function parseOverpass(json: { elements: OverpassEl[] }, bbox: ReturnType<typeof bboxAround>): OutdoorGraph {
  const nodes: OutdoorNode[] = [];
  const edges: OutdoorEdge[] = [];
  const nodeMap = new Map<number, OutdoorNode>();
  for (const el of json.elements) {
    // Defensive: Overpass responses have occasionally been observed with a
    // node element missing lat/lon (e.g. a stub from a partial/aborted
    // response). A non-finite coordinate reaching MapLibre later throws
    // "Expected value to be of type number, but found null instead" and
    // kills the whole route render — so we drop bad nodes here instead.
    if (el.type === 'node' && Number.isFinite(el.lat) && Number.isFinite(el.lon)) {
      const n: OutdoorNode = {
        id: 'osm-' + el.id,
        lat: el.lat,
        lng: el.lon,
        kind: 'intersection',
      };
      nodeMap.set(el.id, n);
    }
  }
  for (const el of json.elements) {
    if (el.type !== 'way') continue;
    const tag = el.tags?.highway ?? 'path';
    for (let i = 0; i < el.nodes.length - 1; i++) {
      const a = nodeMap.get(el.nodes[i]);
      const b = nodeMap.get(el.nodes[i + 1]);
      if (!a || !b) continue;
      const w = haversineMeters(a, b);
      edges.push({
        id: `osm-${el.id}-${i}`,
        fromNodeId: a.id,
        toNodeId: b.id,
        weight: w,
        highway: tag,
      });
    }
  }
  // Only keep nodes referenced by an edge.
  const referenced = new Set<string>();
  for (const e of edges) {
    referenced.add(e.fromNodeId);
    referenced.add(e.toNodeId);
  }
  for (const n of nodeMap.values()) if (referenced.has(n.id)) nodes.push(n);

  return { nodes, edges, bbox, fetchedAt: Date.now() };
}
