/**
 * StreetRouting — long-distance street-network routing via a public OSRM
 * instance, fetched through the `/api/osrm` proxy (see api/osrm.ts).
 *
 * OutdoorMapEngine's Overpass+Dijkstra graph is the right tool for "find a
 * walking path around this venue" — it's small, cacheable, and gives a
 * curated/dense edge set. It is the *wrong* tool once start and destination
 * are, say, a couple kilometers apart (MAX_ROUTE_SPAN_M) — someone walking
 * or driving to the venue from elsewhere in the city. Fetching and solving
 * a city-scale Overpass graph client-side for that trip would be slow and
 * often simply times out. OSRM already maintains a routable street network
 * for the whole region and hands back a ready-made path, so we use that
 * instead for the long leg.
 */

import type { GeoCoord, OutdoorNode, TravelMode } from './GeoTypes';
import { haversineMeters } from './GeoMath';

const ENDPOINT = '/api/osrm';
/** The proxy itself races its mirrors with its own budget (see api/osrm.ts)
 *  — this needs enough headroom above that for the response to travel back. */
const TIMEOUT_MS = 12_000;

export interface StreetRouteResult {
  path: OutdoorNode[];
  distanceM: number;
}

/**
 * Fetch a real street route between two points, however far apart, via a
 * public OSRM instance. Returns null on any failure (network, timeout, no
 * route found) so callers can fall back to a direct line rather than hang.
 */
export async function fetchStreetRoute(
  start: GeoCoord,
  dest: GeoCoord,
  mode: TravelMode,
): Promise<StreetRouteResult | null> {
  const profile = mode === 'car' ? 'car' : 'foot';
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), TIMEOUT_MS);
  try {
    const coords = `${start.lng},${start.lat};${dest.lng},${dest.lat}`;
    const url = `${ENDPOINT}?profile=${profile}&coords=${encodeURIComponent(coords)}`;
    const res = await fetch(url, { signal: controller.signal });
    if (!res.ok) {
      console.warn(`[StreetRouting] /api/osrm responded ${res.status}`);
      return null;
    }
    const json = await res.json();
    const result = parseOsrmResponse(json);
    if (!result) console.warn('[StreetRouting] OSRM returned no route', json?.code);
    return result;
  } catch (e) {
    console.warn('[StreetRouting] OSRM fetch failed', e);
    return null;
  } finally {
    clearTimeout(timer);
  }
}

interface OsrmRoute {
  distance: number;
  geometry?: { type: string; coordinates: [number, number][] };
}
interface OsrmResponse {
  code: string;
  routes?: OsrmRoute[];
}

function parseOsrmResponse(json: OsrmResponse): StreetRouteResult | null {
  const route = json.routes?.[0];
  if (json.code !== 'Ok' || !route || !route.geometry?.coordinates?.length) return null;
  const coords = route.geometry.coordinates;
  const path: OutdoorNode[] = coords.map(([lng, lat], i) => ({
    id: i === 0 ? 'osrm-start' : i === coords.length - 1 ? 'osrm-end' : `osrm-${i}`,
    lat,
    lng,
    kind: 'intersection',
  }));
  // OSRM's own reported distance (meters, along the actual road geometry)
  // is more accurate than re-summing haversine over a possibly-simplified
  // geometry — only fall back to that if OSRM didn't report one.
  const distanceM = Number.isFinite(route.distance) ? route.distance : sumPathMeters(path);
  return { path, distanceM };
}

function sumPathMeters(path: OutdoorNode[]): number {
  let d = 0;
  for (let i = 1; i < path.length; i++) d += haversineMeters(path[i - 1], path[i]);
  return d;
}
