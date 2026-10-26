// A venue placed on the real world map. A plan (pixels, 40 px = 1 m) is tied
// to the earth by its anchor: the GPS position of plan (0,0), the rotation
// from north, and the scale (buildings.origin_lat / origin_lng / rotation_deg
// / meters_per_pixel). From that we turn walls, rooms, paths and places into
// GeoJSON for the outdoor map.

import { indoorToGeo, latLngToMeters, metersToLatLng } from '@/lib/geo/GeoMath';
import type { GeoAnchor, GeoCoord } from '@/lib/geo/GeoTypes';
import { roomOutline } from './features';
import type { Room, Wall } from '@/data/types';
import type { DrawingLayer, PlanDrawing } from '@/lib/cad/planDrawing';

export const PX_PER_METER = 40;
export const DEFAULT_MPP = 1 / PX_PER_METER;
const WALL_THICKNESS_M = 0.3;

/**
 * The venue's anchor, or null if it hasn't been placed on the map yet.
 * meters_per_pixel defaults to 1 in the database, which no real plan uses
 * (our plans are 40 px/m), so values ≥ 0.5 count as "not set".
 */
export function anchorOf(b: { origin_lat?: number | null; origin_lng?: number | null; rotation_deg?: number | null; meters_per_pixel?: number | null }): GeoAnchor | null {
  if (b.origin_lat == null || b.origin_lng == null) return null;
  const mpp = b.meters_per_pixel && b.meters_per_pixel > 0 && b.meters_per_pixel < 0.5 ? b.meters_per_pixel : DEFAULT_MPP;
  return { originLat: b.origin_lat, originLng: b.origin_lng, rotationDeg: b.rotation_deg ?? 0, metersPerPixel: mpp };
}

/** The anchor that puts plan point `planPx` at `center`, turned by `rotationDeg`. */
export function anchorForCenter(center: GeoCoord, planPx: { x: number; y: number }, rotationDeg: number, metersPerPixel = DEFAULT_MPP): GeoAnchor {
  const probe: GeoAnchor = { originLat: center.lat, originLng: center.lng, rotationDeg, metersPerPixel };
  // Where planPx lands if the origin sat at `center`; shift the origin back by that much.
  const { east, north } = latLngToMeters(center, indoorToGeo(probe, planPx.x, planPx.y));
  const origin = metersToLatLng(center, -east, -north);
  return { originLat: origin.lat, originLng: origin.lng, rotationDeg, metersPerPixel };
}

export function planBounds(walls: Pick<Wall, 'x1' | 'y1' | 'x2' | 'y2'>[], rooms: Pick<Room, 'x' | 'y' | 'width' | 'height'>[], points: { x: number; y: number }[] = []) {
  const xs: number[] = [], ys: number[] = [];
  for (const w of walls) { xs.push(w.x1, w.x2); ys.push(w.y1, w.y2); }
  for (const r of rooms) { xs.push(r.x, r.x + r.width); ys.push(r.y, r.y + r.height); }
  for (const p of points) { xs.push(p.x); ys.push(p.y); }
  if (!xs.length) return null;
  const minX = Math.min(...xs), maxX = Math.max(...xs), minY = Math.min(...ys), maxY = Math.max(...ys);
  return { minX, minY, maxX, maxY, cx: (minX + maxX) / 2, cy: (minY + maxY) / 2 };
}

type Pos = [number, number];
const ll = (a: GeoAnchor, x: number, y: number): Pos => { const g = indoorToGeo(a, x, y); return [g.lng, g.lat]; };

export interface VenueGeoInput {
  walls: Pick<Wall, 'x1' | 'y1' | 'x2' | 'y2'>[];
  rooms: Room[];
  places: { id: string; name: string; x: number; y: number; kind?: string }[];
  paths: { a: { x: number; y: number }; b: { x: number; y: number } }[];
  /** The architect's drawing of this floor (planDrawing.ts), laid on the ground. */
  drawing?: PlanDrawing | null;
}

export interface FeatureCollection { type: 'FeatureCollection'; features: { type: 'Feature'; properties: Record<string, unknown>; geometry: { type: string; coordinates: unknown } }[] }
const fc = (features: FeatureCollection['features']): FeatureCollection => ({ type: 'FeatureCollection', features });

/** Everything the outdoor map draws for one venue (one floor). */
export function venueGeoJSON(anchor: GeoAnchor, d: VenueGeoInput, props: Record<string, unknown> = {}) {
  const halfPx = (WALL_THICKNESS_M / anchor.metersPerPixel) / 2;
  const walls = fc(d.walls.flatMap(w => {
    const dx = w.x2 - w.x1, dy = w.y2 - w.y1, len = Math.hypot(dx, dy);
    if (len < 1e-6) return [];
    const nx = (-dy / len) * halfPx, ny = (dx / len) * halfPx;
    const ring = [ll(anchor, w.x1 + nx, w.y1 + ny), ll(anchor, w.x2 + nx, w.y2 + ny), ll(anchor, w.x2 - nx, w.y2 - ny), ll(anchor, w.x1 - nx, w.y1 - ny)];
    return [{ type: 'Feature' as const, properties: { ...props }, geometry: { type: 'Polygon', coordinates: [[...ring, ring[0]]] } }];
  }));
  const rooms = fc(d.rooms.map(r => {
    const ring = roomOutline(r).map(p => ll(anchor, p.x, p.y));
    return { type: 'Feature' as const, properties: { ...props, name: r.name, type: r.type, nodeId: r.nodeId }, geometry: { type: 'Polygon', coordinates: [[...ring, ring[0]]] } };
  }));
  const paths = fc(d.paths.map(p => ({ type: 'Feature' as const, properties: { ...props }, geometry: { type: 'LineString', coordinates: [ll(anchor, p.a.x, p.a.y), ll(anchor, p.b.x, p.b.y)] } })));
  const places = fc(d.places.map(p => ({ type: 'Feature' as const, properties: { ...props, id: p.id, name: p.name, kind: p.kind ?? 'place' }, geometry: { type: 'Point', coordinates: ll(anchor, p.x, p.y) } })));
  return { walls, rooms, paths, places, ...drawingGeoJSON(anchor, d.drawing, props) };
}

/**
 * The architect's drawing on the map: its lines (each with its `layer`: walls, doors,
 * furniture…) and its solid wall fills. Empty collections when there's no drawing.
 */
export function drawingGeoJSON(anchor: GeoAnchor, drawing: PlanDrawing | null | undefined, props: Record<string, unknown> = {}, skip: DrawingLayer[] = []) {
  const lines: FeatureCollection['features'] = [], poche: FeatureCollection['features'] = [];
  for (const [layer, list] of Object.entries(drawing?.layers ?? {}) as [DrawingLayer, number[][]][]) {
    if (skip.includes(layer)) continue;
    for (const l of list) {
      const coords: Pos[] = [];
      for (let i = 0; i < l.length; i += 2) coords.push(ll(anchor, l[i], l[i + 1]));
      if (layer === 'poche') { if (coords.length >= 4) poche.push({ type: 'Feature', properties: { ...props }, geometry: { type: 'Polygon', coordinates: [coords] } }); }
      else lines.push({ type: 'Feature', properties: { ...props, layer }, geometry: { type: 'LineString', coordinates: coords } });
    }
  }
  return { planLines: fc(lines), planPoche: fc(poche) };
}

/** The venue's footprint on the map: its plan's bounding box, as a polygon (lng/lat). */
export function footprint(anchor: GeoAnchor, bounds: NonNullable<ReturnType<typeof planBounds>>, padPx = 0): Pos[] {
  const { minX, minY, maxX, maxY } = bounds;
  const ring = [ll(anchor, minX - padPx, minY - padPx), ll(anchor, maxX + padPx, minY - padPx), ll(anchor, maxX + padPx, maxY + padPx), ll(anchor, minX - padPx, maxY + padPx)];
  return [...ring, ring[0]];
}

/** Is a GPS point inside a (convex) footprint ring? */
export function insideRing(ring: Pos[], p: GeoCoord): boolean {
  let inside = false;
  for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
    const [xi, yi] = ring[i], [xj, yj] = ring[j];
    if ((yi > p.lat) !== (yj > p.lat) && p.lng < ((xj - xi) * (p.lat - yi)) / (yj - yi) + xi) inside = !inside;
  }
  return inside;
}

export const lineToGeo = (anchor: GeoAnchor, pts: { x: number; y: number }[]): Pos[] => pts.map(p => ll(anchor, p.x, p.y));
