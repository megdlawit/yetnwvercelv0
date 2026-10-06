// src/lib/dxf/dxfToVenue.ts
//
// Turns classified DXF layers into the shapes FloorEditor already knows:
// Wall{x1,y1,x2,y2} and Room{x,y,width,height,name}. This is deliberately
// NOT a full auto-mapping pipeline (no wall-loop polygonization, no
// corridor-graph generation) — see the note at the bottom of this file for
// why, and what's still manual after an import.

import type { ParsedDxf, DxfPoint } from './parseDxf';

export interface ImportOptions {
  wallLayers: string[];      // e.g. ['WALL', 'WALLS', 'A-WALL']
  roomLayer: string | null;  // e.g. 'ROOM' — closed polylines here become rooms
  doorLayer: string | null;  // e.g. 'DOOR' — any entity here becomes a door marker
  textLayers: string[] | null; // room-label text layers to search; null = search all TEXT
  unitsPerMeter: number;     // DXF drawing units per real metre (1000 if the file is in mm, 1 if metres)
  pxPerMeter: number;        // FloorEditor's own scale — how many of its px = 1 metre. Default 40.
  flipY: boolean;            // DXF is Y-up, SVG/editor is Y-down — almost always true
}

export interface ImportedWall { x1: number; y1: number; x2: number; y2: number }
export interface ImportedRoom { name: string; x: number; y: number; width: number; height: number }
export interface ImportedDoor { x: number; y: number }

export interface ImportResult {
  walls: ImportedWall[];
  rooms: ImportedRoom[];
  doors: ImportedDoor[];
  warnings: string[];
  // What the import cleaned up and which CAD layers became which objects —
  // shown to the user as the import's health check.
  cleanup: { duplicateWalls: number; tinyWalls: number };
  mapping: { walls: string[]; rooms: string[] };
}

// Output always starts at (0,0) and is positive. When flipping, Y is measured
// down from the top of the drawing (maxY) rather than negated: negating put
// the whole plan at negative y, above the editor's visible area.
function toPx(p: DxfPoint, o: ImportOptions, bounds: { minX: number; minY: number; maxY: number }): DxfPoint {
  const metersX = (p.x - bounds.minX) / o.unitsPerMeter;
  const metersY = (o.flipY ? bounds.maxY - p.y : p.y - bounds.minY) / o.unitsPerMeter;
  const x = metersX * o.pxPerMeter;
  const y = metersY * o.pxPerMeter;
  return { x, y };
}

function pointInPolygon(pt: DxfPoint, poly: DxfPoint[]): boolean {
  let inside = false;
  for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) {
    const xi = poly[i].x, yi = poly[i].y, xj = poly[j].x, yj = poly[j].y;
    const intersect = (yi > pt.y) !== (yj > pt.y) &&
      pt.x < ((xj - xi) * (pt.y - yi)) / (yj - yi) + xi;
    if (intersect) inside = !inside;
  }
  return inside;
}

// Real plans rarely use the exact layer names typed into the import dialog:
// "A-WALL-EXTR", "Walls - Interior", or everything on layer "0" are all
// common. Resolution order, stopping at the first that yields geometry:
//   1. exact (case-insensitive) match on the requested names
//   2. layers whose name contains a requested name or one of `keywords`
//   3. (walls only) the layer carrying the most line geometry
// Returns the chosen layer set and, if it wasn't an exact match, how it was
// chosen, so the caller can say so in a warning.
function resolveLayers(
  counts: Map<string, number>, requested: string[], keywords: string[], fallbackToBusiest: boolean,
): { layers: Set<string>; how: 'exact' | 'name' | 'busiest' | 'none' } {
  const req = requested.map(l => l.trim().toUpperCase()).filter(Boolean);
  const exact = new Set(req.filter(l => (counts.get(l) ?? 0) > 0));
  if (exact.size > 0) return { layers: exact, how: 'exact' };

  const needles = [...req, ...keywords];
  const byName = new Set([...counts.keys()].filter(l => needles.some(n => l.includes(n))));
  if (byName.size > 0) return { layers: byName, how: 'name' };

  if (fallbackToBusiest && counts.size > 0) {
    const [busiest] = [...counts.entries()].sort((a, b) => b[1] - a[1])[0];
    return { layers: new Set([busiest]), how: 'busiest' };
  }
  return { layers: new Set(), how: 'none' };
}

export function dxfToVenue(parsed: ParsedDxf, o: ImportOptions): ImportResult {
  const warnings: string[] = [];
  if (!parsed.bounds) {
    return { walls: [], rooms: [], doors: [], warnings: ['DXF has no recognized geometry in its ENTITIES section.'], cleanup: { duplicateWalls: 0, tinyWalls: 0 }, mapping: { walls: [], rooms: [] } };
  }
  const bounds = parsed.bounds;
  const P = (p: DxfPoint) => toPx(p, o, bounds);

  // ── Walls: LINEs and (exploded) POLYLINEs on any of the wall layers ────────
  const walls: ImportedWall[] = [];
  const lineCounts = new Map<string, number>();
  for (const e of parsed.entities) {
    if (e.kind === 'LINE' || e.kind === 'POLYLINE') {
      const l = e.layer.toUpperCase();
      lineCounts.set(l, (lineCounts.get(l) ?? 0) + (e.kind === 'LINE' ? 1 : e.pts.length));
    }
  }
  const wallPick = resolveLayers(lineCounts, o.wallLayers, ['WALL', 'MUR', 'WAND'], true);
  const wallLayerSet = wallPick.layers;
  if (wallPick.how === 'name' || wallPick.how === 'busiest') {
    const used = [...wallLayerSet].join(', ');
    warnings.push(wallPick.how === 'name'
      ? `No layer named ${o.wallLayers.join(', ') || '(none)'} — used similarly named layer(s) ${used} for walls instead.`
      : `No wall layer found by name — used "${used}", the layer with the most line geometry. If walls look wrong, set "Wall layer(s)" to one of the layers listed below and re-import.`);
  }
  // CAD exports are full of zero-length segments and lines drawn twice
  // (overlapping polylines, copied layers). Drop both: duplicates double the
  // wall count and confuse the path generator; tiny ones are invisible noise.
  const cleanup = { duplicateWalls: 0, tinyWalls: 0 };
  const seen = new Set<string>();
  const addWall = (a: DxfPoint, b: DxfPoint) => {
    if (Math.hypot(a.x - b.x, a.y - b.y) < 1) { cleanup.tinyWalls++; return; }
    const r = (v: number) => Math.round(v * 2) / 2;
    const key = [`${r(a.x)},${r(a.y)}`, `${r(b.x)},${r(b.y)}`].sort().join('|');
    if (seen.has(key)) { cleanup.duplicateWalls++; return; }
    seen.add(key);
    walls.push({ x1: a.x, y1: a.y, x2: b.x, y2: b.y });
  };
  for (const e of parsed.entities) {
    if (!wallLayerSet.has(e.layer.toUpperCase())) continue;
    if (e.kind === 'LINE') {
      addWall(P(e.a), P(e.b));
    } else if (e.kind === 'POLYLINE') {
      const n = e.pts.length;
      const segs = e.closed ? n : n - 1;
      for (let i = 0; i < segs; i++) addWall(P(e.pts[i]), P(e.pts[(i + 1) % n]));
    }
  }
  if (walls.length === 0) {
    warnings.push(`No wall geometry found on layer(s) ${o.wallLayers.join(', ') || '(none specified)'}. Check the layer name(s) match the DXF exactly (case-insensitive) and try again.`);
  }

  // ── Rooms: closed POLYLINEs on the room layer → bounding-box rectangle ─────
  // FloorEditor's Room shape is an axis-aligned rectangle, not an arbitrary
  // polygon, so an irregular room outline is approximated by its bounding
  // box here. Good enough for routing/labels; adjust the rectangle by hand
  // in the editor for a very non-rectangular room.
  const rooms: ImportedRoom[] = [];
  let roomLayersUsed: string[] = [];
  if (o.roomLayer) {
    const closedCounts = new Map<string, number>();
    for (const e of parsed.entities) {
      if (e.kind === 'POLYLINE' && e.closed) closedCounts.set(e.layer.toUpperCase(), (closedCounts.get(e.layer.toUpperCase()) ?? 0) + 1);
    }
    const roomPick = resolveLayers(closedCounts, [o.roomLayer], ['ROOM', 'SPACE', 'AREA'], false);
    roomLayersUsed = [...roomPick.layers];
    if (roomPick.how === 'name') {
      warnings.push(`No layer named "${o.roomLayer}" — used similarly named layer(s) ${[...roomPick.layers].join(', ')} for rooms instead.`);
    }
    const texts = parsed.entities.filter(e => e.kind === 'TEXT' &&
      (!o.textLayers || o.textLayers.some(l => l.toUpperCase() === e.layer.toUpperCase()))) as { kind: 'TEXT'; layer: string; pos: DxfPoint; text: string }[];

    let anon = 0;
    for (const e of parsed.entities) {
      if (e.kind !== 'POLYLINE' || !roomPick.layers.has(e.layer.toUpperCase()) || !e.closed) continue;
      const xs = e.pts.map(p => p.x), ys = e.pts.map(p => p.y);
      const minX = Math.min(...xs), maxX = Math.max(...xs);
      const minY = Math.min(...ys), maxY = Math.max(...ys);
      const centroid = { x: (minX + maxX) / 2, y: (minY + maxY) / 2 };

      let label = texts.find(t => pointInPolygon(t.pos, e.pts))?.text;
      if (!label) {
        // fall back to nearest label within a generous radius of the centroid
        let best: { d: number; text: string } | null = null;
        for (const t of texts) {
          const d = Math.hypot(t.pos.x - centroid.x, t.pos.y - centroid.y);
          if (d < (maxX - minX + maxY - minY) && (!best || d < best.d)) best = { d, text: t.text };
        }
        label = best?.text;
      }
      anon += label ? 0 : 1;

      const tl = P({ x: minX, y: maxY }); // top-left in px space (maxY because of the flip)
      const br = P({ x: maxX, y: minY });
      rooms.push({
        name: label || `Room ${anon}`,
        x: Math.min(tl.x, br.x),
        y: Math.min(tl.y, br.y),
        width: Math.abs(br.x - tl.x),
        height: Math.abs(br.y - tl.y),
      });
    }
    if (rooms.length === 0) {
      warnings.push(`No closed room outlines found on layer "${o.roomLayer}". Rooms must be drawn as closed polylines there.`);
    } else if (anon > 0) {
      warnings.push(`${anon} room(s) had no nearby text label — named "Room N", rename them in the editor.`);
    }
  } else {
    warnings.push('No room layer specified — walls were imported, but no rooms. Add rooms by hand, or re-import with a room layer set.');
  }

  // ── Doors: any entity on the door layer becomes a point marker ─────────────
  const doors: ImportedDoor[] = [];
  if (o.doorLayer) {
    const doorLayerU = o.doorLayer.toUpperCase();
    for (const e of parsed.entities) {
      if (e.layer.toUpperCase() !== doorLayerU) continue;
      if (e.kind === 'INSERT' || e.kind === 'CIRCLE') doors.push(P(e.kind === 'INSERT' ? e.pos : e.center));
      else if (e.kind === 'ARC') doors.push(P(e.center));
      else if (e.kind === 'LINE') doors.push(P({ x: (e.a.x + e.b.x) / 2, y: (e.a.y + e.b.y) / 2 }));
    }
  }

  return { walls, rooms, doors, warnings, cleanup, mapping: { walls: [...wallLayerSet], rooms: roomLayersUsed } };
}

// ── What this deliberately does NOT do ────────────────────────────────────
// It does not generate a routable node/edge graph from the walls. Real CAD
// wall layers rarely enclose clean single loops (they have jogs, double
// lines for wall thickness, structural columns cutting through) — turning
// that into "one polygon per room" automatically is a much harder geometry
// problem than this pass, and getting it wrong silently produces a
// confidently-broken map. Rooms + walls import as reference geometry;
// FloorEditor's existing add-node / add-edge tools are then used to trace
// the actual walkable path on top of it, which is also what a step like
// this looks like in every competitor's editor (Mappedin/Visioglobe still
// require a human to confirm the walkable network, they just make tracing
// faster with the geometry underneath).