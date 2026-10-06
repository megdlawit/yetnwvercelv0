/**
 * GeoMath — distance, bearing, and indoor↔geo coordinate conversions.
 *
 * Uses the haversine formula for distance and a small-area equirectangular
 * approximation for converting between meter-deltas and lat/lng deltas.
 * Within a single building/campus this is accurate to a fraction of a meter.
 */

import type { GeoAnchor, GeoCoord } from './GeoTypes';

const EARTH_RADIUS_M = 6_371_000;
const DEG = Math.PI / 180;

/** Haversine distance in meters between two GPS coordinates. */
export function haversineMeters(a: GeoCoord, b: GeoCoord): number {
  const dLat = (b.lat - a.lat) * DEG;
  const dLng = (b.lng - a.lng) * DEG;
  const lat1 = a.lat * DEG;
  const lat2 = b.lat * DEG;
  const h =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(lat1) * Math.cos(lat2) * Math.sin(dLng / 2) ** 2;
  return 2 * EARTH_RADIUS_M * Math.asin(Math.min(1, Math.sqrt(h)));
}

/** Initial bearing in degrees (0..360, north=0) from a → b. */
export function bearingDeg(a: GeoCoord, b: GeoCoord): number {
  const lat1 = a.lat * DEG;
  const lat2 = b.lat * DEG;
  const dLng = (b.lng - a.lng) * DEG;
  const y = Math.sin(dLng) * Math.cos(lat2);
  const x =
    Math.cos(lat1) * Math.sin(lat2) -
    Math.sin(lat1) * Math.cos(lat2) * Math.cos(dLng);
  return (Math.atan2(y, x) / DEG + 360) % 360;
}

/** Convert a meter offset (east, north) into a lat/lng delta near `origin`. */
export function metersToLatLng(
  origin: GeoCoord,
  eastM: number,
  northM: number,
): GeoCoord {
  const dLat = northM / EARTH_RADIUS_M / DEG;
  const dLng =
    eastM / (EARTH_RADIUS_M * Math.cos(origin.lat * DEG)) / DEG;
  return { lat: origin.lat + dLat, lng: origin.lng + dLng };
}

/** Convert a GPS point to (east, north) meters relative to `origin`. */
export function latLngToMeters(
  origin: GeoCoord,
  point: GeoCoord,
): { east: number; north: number } {
  const dLat = (point.lat - origin.lat) * DEG;
  const dLng = (point.lng - origin.lng) * DEG;
  const north = dLat * EARTH_RADIUS_M;
  const east = dLng * EARTH_RADIUS_M * Math.cos(origin.lat * DEG);
  return { east, north };
}

/**
 * Convert an indoor pixel coordinate (x right, y down) to GPS using the
 * building's geo-anchor. Indoor +y is screen-down; world +north is up, so we
 * flip y before rotating.
 */
export function indoorToGeo(
  anchor: GeoAnchor,
  x: number,
  y: number,
): GeoCoord {
  const eastPx = x;
  const northPx = -y; // flip screen-down to world-up
  const theta = anchor.rotationDeg * DEG;
  // Rotate the local pixel frame into world east/north.
  const east =
    (eastPx * Math.cos(theta) + northPx * Math.sin(theta)) *
    anchor.metersPerPixel;
  const north =
    (-eastPx * Math.sin(theta) + northPx * Math.cos(theta)) *
    anchor.metersPerPixel;
  return metersToLatLng({ lat: anchor.originLat, lng: anchor.originLng }, east, north);
}

/** Inverse of indoorToGeo: GPS → indoor pixel space. */
export function geoToIndoor(
  anchor: GeoAnchor,
  point: GeoCoord,
): { x: number; y: number } {
  const { east, north } = latLngToMeters(
    { lat: anchor.originLat, lng: anchor.originLng },
    point,
  );
  const theta = -anchor.rotationDeg * DEG;
  const eastPx =
    (east * Math.cos(theta) + north * Math.sin(theta)) /
    anchor.metersPerPixel;
  const northPx =
    (-east * Math.sin(theta) + north * Math.cos(theta)) /
    anchor.metersPerPixel;
  return { x: eastPx, y: -northPx };
}

/** Clamp a degrees value to [0, 360). */
export function normalizeDeg(deg: number): number {
  const d = deg % 360;
  return d < 0 ? d + 360 : d;
}

/**
 * Route a straight `start → end` segment around a circular obstacle
 * (e.g. a building footprint) when it cuts too close to/through it.
 *
 * Works in a local meter-plane around `start` so the math is plain 2D
 * geometry, then converts the detour point back to lat/lng. Returns null
 * if the segment doesn't come within `radiusM` of the obstacle, or if
 * either endpoint is already inside the obstacle (that's normal — you're
 * standing at/leaving/arriving at that building, not walking through it).
 */
export function detourAroundObstacle(
  start: GeoCoord,
  end: GeoCoord,
  obstacleCenter: GeoCoord,
  radiusM: number,
): GeoCoord | null {
  const p1 = { east: 0, north: 0 };
  const p2 = latLngToMeters(start, end);
  const c = latLngToMeters(start, obstacleCenter);

  const distToCenter = (p: { east: number; north: number }) =>
    Math.hypot(p.east - c.east, p.north - c.north);

  // Endpoints already inside/at the obstacle → this is the origin or
  // destination building itself, not something to route around.
  if (distToCenter(p1) < radiusM || distToCenter(p2) < radiusM) return null;

  const dx = p2.east - p1.east;
  const dy = p2.north - p1.north;
  const segLenSq = dx * dx + dy * dy;
  if (segLenSq < 1e-6) return null;

  // Project the obstacle center onto the segment, clamped to [0,1].
  const t = Math.max(0, Math.min(1, ((c.east - p1.east) * dx + (c.north - p1.north) * dy) / segLenSq));
  const closest = { east: p1.east + t * dx, north: p1.north + t * dy };
  const clearance = Math.hypot(closest.east - c.east, closest.north - c.north);

  const BUFFER_M = 6; // walk a little wider than the raw footprint radius
  const clearRadius = radiusM + BUFFER_M;
  if (clearance >= clearRadius || t <= 0 || t >= 1) return null;

  // Push the closest-approach point outward from the obstacle center to
  // just outside its clearance radius, along whichever side the line
  // already leans toward (minimal detour) — or an arbitrary perpendicular
  // if the line runs dead through the center.
  let ox = closest.east - c.east;
  let oy = closest.north - c.north;
  const oLen = Math.hypot(ox, oy);
  if (oLen < 1e-6) {
    // Dead-center hit: use the segment's perpendicular direction instead.
    ox = -dy;
    oy = dx;
  }
  const oNorm = Math.hypot(ox, oy) || 1;
  const detourEast = c.east + (ox / oNorm) * clearRadius;
  const detourNorth = c.north + (oy / oNorm) * clearRadius;

  return metersToLatLng(start, detourEast, detourNorth);
}
