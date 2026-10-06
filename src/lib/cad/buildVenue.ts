// Drawing + confirmed layer mapping → the venue's spatial model: walls,
// polygon rooms and point features (doors, stairs, trees, …), plus a health
// report of what was wrong with the drawing and what was fixed.
//
// Runs entirely in the browser. Output coordinates are editor px (pxPerMeter
// px = 1 m), positive, starting at (0, 0), Y down.

import type { DxfEntity, DxfPoint } from '../dxf/parseDxf';
import { quarterArcs, isLeafOf, DOOR_RANGE_M } from './analyze';
import { detectRooms } from './detectRooms';
import { categoryFromBlock } from './classify';
import type { CadDrawing, Category, LayerMapping } from './types';
import {
  type Pt, type Seg, mergeCollinear, closeGaps, countGaps, countOverlaps,
  polygonCentroid, polygonArea, pointInPolygon, bbox, dist, projectOnSegment,
} from './geometry';

export type FeatureKind =
  | 'door' | 'window' | 'stairs' | 'elevator' | 'entrance' | 'tree' | 'bench' | 'furniture' | 'landmark' | 'label';

export interface BuiltRoom { name: string; polygon: Pt[]; x: number; y: number; width: number; height: number }
export interface BuiltFeature {
  kind: FeatureKind; x: number; y: number; rotationDeg: number;
  width?: number | null; depth?: number | null; label?: string | null;
}

export interface BuildOptions {
  unitsPerMeter: number;
  pxPerMeter: number;
  flipY: boolean;
  fix: { gaps: boolean; overlaps: boolean; rooms: boolean; floating: boolean };
  /** Find doors from swing arcs and rooms from the spaces walls enclose (both on unless turned off). */
  detect?: { doors?: boolean; rooms?: boolean };
}

export interface Health {
  duplicates: number; tiny: number;
  gaps: number; gapsFixed: number;
  overlaps: number | null; overlapsMerged: number;   // null = too many walls to check pairwise
  unclosedRooms: number; roomsClosed: number;
  floating: number; floatingRemoved: number;
  extentM: { w: number; h: number };
  unitsSuspect: boolean;
  doorsFromSwings: number;   // doors recognised from quarter-circle swings
  roomsFromWalls: number;    // rooms traced from enclosed spaces
}

export interface BuiltVenue { walls: Seg[]; rooms: BuiltRoom[]; features: BuiltFeature[]; health: Health; warnings: string[] }

const ENTRANCE_TEXT = /ENTRANCE|ENTRY|EINGANG|ENTR[ÉE]E|\bGATE\b|MAIN DOOR|መግቢያ/i;
const BENCH_BLOCK = /BENCH|SEAT/i;
const MAX_FEATURES_PER_KIND = 1500;

export function buildVenue(d: CadDrawing, mapping: LayerMapping, o: BuildOptions): BuiltVenue {
  const warnings: string[] = [];
  const emptyHealth: Health = {
    duplicates: 0, tiny: 0, gaps: 0, gapsFixed: 0, overlaps: 0, overlapsMerged: 0,
    unclosedRooms: 0, roomsClosed: 0, floating: 0, floatingRemoved: 0, extentM: { w: 0, h: 0 }, unitsSuspect: false,
    doorsFromSwings: 0, roomsFromWalls: 0,
  };
  if (!d.bounds) return { walls: [], rooms: [], features: [], health: emptyHealth, warnings: ['The drawing has no geometry.'] };

  const b = d.bounds;
  const s = o.pxPerMeter / o.unitsPerMeter;            // px per drawing unit
  const P = (p: DxfPoint): Pt => ({ x: (p.x - b.minX) * s, y: (o.flipY ? b.maxY - p.y : p.y - b.minY) * s });
  // Rotation in plan: DXF angles are counter-clockwise with Y up; flipping Y mirrors them.
  const R = (deg: number) => (o.flipY ? -deg : deg);
  const cat = (layer: string): Category => mapping[layer] ?? 'ignore';
  const m = o.pxPerMeter; // px per metre

  const arcPts = (c: DxfPoint, r: number, a0: number, a1: number, n: number): DxfPoint[] => {
    let sweep = a1 - a0;
    if (sweep <= 0) sweep += 360;
    return Array.from({ length: n + 1 }, (_, i) => {
      const a = ((a0 + (sweep * i) / n) * Math.PI) / 180;
      return { x: c.x + r * Math.cos(a), y: c.y + r * Math.sin(a) };
    });
  };

  // ── Walls ──────────────────────────────────────────────────────────────────
  const health: Health = { ...emptyHealth };
  let walls: Seg[] = [];
  const seen = new Set<string>();
  const addWall = (a: Pt, c: Pt) => {
    if (dist(a, c) < 1) { health.tiny++; return; }
    const r = (v: number) => Math.round(v * 2) / 2;
    const key = [`${r(a.x)},${r(a.y)}`, `${r(c.x)},${r(c.y)}`].sort().join('|');
    if (seen.has(key)) { health.duplicates++; return; }
    seen.add(key);
    walls.push({ x1: a.x, y1: a.y, x2: c.x, y2: c.y });
  };
  const addPath = (pts: DxfPoint[], closed: boolean) => {
    const q = pts.map(P);
    for (let i = 0; i < q.length - 1; i++) addWall(q[i], q[i + 1]);
    if (closed && q.length > 2) addWall(q[q.length - 1], q[0]);
  };
  // Door swings: quarter circles of door size on wall / door layers. They
  // are doors, not walls — and neither are the door leaves drawn from the
  // hinge — so they are kept out of the walls and turned into doors below.
  const consumed = new Set<DxfEntity>();
  const swings = o.detect?.doors === false ? [] : quarterArcs(d.entities).filter(a => {
    const c = cat(a.layer), rm = a.radius / o.unitsPerMeter;
    return (c === 'walls' || c === 'doors') && rm >= DOOR_RANGE_M.min && rm <= DOOR_RANGE_M.max;
  });
  for (const sw of swings) consumed.add(sw.source);
  if (swings.length) {
    for (const e of d.entities) {
      const c = cat(e.layer);
      if (c !== 'walls' && c !== 'doors') continue;
      let pts: DxfPoint[] | null = null;
      if (e.kind === 'LINE') pts = [e.a, e.b];
      else if (e.kind === 'POLYLINE' && e.pts.length <= 5) pts = e.pts;
      if (!pts) continue;
      const box = bbox(pts);
      // a leaf is thin: a line, or a narrow panel
      if (pts.length > 2 && Math.min(box.maxX - box.minX, box.maxY - box.minY) > Math.max(box.maxX - box.minX, box.maxY - box.minY) * 0.2) continue;
      if (swings.some(sw => isLeafOf(pts!, sw))) consumed.add(e);
    }
  }

  // When furniture and fixtures share the walls' layer (common in single-layer
  // exports), small chunky closed shapes are objects, not walls — thin ones
  // (a wall drawn as a rectangle, a column) stay walls. Tiny multi-point
  // squiggles are symbols or exploded lettering.
  const furnitureShapes: Pt[][] = [];
  for (const e of d.entities) {
    if (cat(e.layer) !== 'walls' || consumed.has(e) || e.kind !== 'POLYLINE' || e.pts.length < 3) continue;
    const pts = e.pts.map(P), box = bbox(pts);
    const w = (box.maxX - box.minX) / m, h = (box.maxY - box.minY) / m;
    const thin = Math.min(w, h) < 0.25 || Math.min(w, h) / Math.max(w, h, 1e-9) < 0.15;
    if (Math.max(w, h) < 0.25) { consumed.add(e); continue; }
    if ((e.closed || dist(pts[0], pts[pts.length - 1]) < 0.05 * m) && !thin && w * h < 4) {
      consumed.add(e);
      if (w * h > 0.25) furnitureShapes.push(pts);
    }
  }

  for (const e of d.entities) {
    if (cat(e.layer) !== 'walls' || consumed.has(e)) continue;
    if (e.kind === 'LINE') addWall(P(e.a), P(e.b));
    else if (e.kind === 'POLYLINE') addPath(e.pts, e.closed);
    else if (e.kind === 'ARC') addPath(arcPts(e.center, e.radius, e.startDeg, e.endDeg, 12), false);
    else if (e.kind === 'CIRCLE') addPath(arcPts(e.center, e.radius, 0, 360, 12), true); // round column
  }

  health.overlaps = walls.length <= 6000 ? countOverlaps(walls) : null;
  if (o.fix.overlaps && walls.length) {
    const merged = mergeCollinear(walls, 0.5, 0.5);
    health.overlapsMerged = health.overlaps ?? merged.merged;
    walls = merged.segs;
  }
  const gapTol = 0.3 * m;
  health.gaps = countGaps(walls, gapTol);
  if (o.fix.gaps && health.gaps > 0) {
    const fixed = closeGaps(walls, gapTol);
    walls = fixed.segs;
    health.gapsFixed = fixed.fixed;
  }

  // ── Text (room names, labels, entrances) ───────────────────────────────────
  const labelLayers = new Set(Object.entries(mapping).filter(([, c]) => c === 'labels').map(([l]) => l));
  const texts = d.entities
    .filter((e): e is Extract<typeof e, { kind: 'TEXT' }> => e.kind === 'TEXT' && cat(e.layer) !== 'ignore')
    .filter(e => labelLayers.size === 0 || labelLayers.has(e.layer) || cat(e.layer) === 'rooms')
    .map(e => ({ pos: P(e.pos), text: e.text.trim(), used: false }))
    .filter(t => t.text.length > 0 && t.text.length < 80);

  // ── Rooms ──────────────────────────────────────────────────────────────────
  const rooms: BuiltRoom[] = [];
  let unnamed = 0;
  for (const e of d.entities) {
    if (e.kind !== 'POLYLINE' || cat(e.layer) !== 'rooms') continue;
    let poly = e.pts.map(P);
    if (!e.closed) {
      const nearlyClosed = poly.length >= 3 && dist(poly[0], poly[poly.length - 1]) <= 0.5 * m;
      if (!nearlyClosed) { health.unclosedRooms++; continue; }
      if (!o.fix.rooms) { health.unclosedRooms++; continue; }
      health.roomsClosed++;
    }
    if (poly.length > 1 && dist(poly[0], poly[poly.length - 1]) < 1e-6) poly = poly.slice(0, -1);
    if (poly.length < 3 || polygonArea(poly) < 0.5 * m * m) continue;
    const c = polygonCentroid(poly);
    const inside = texts.filter(t => !t.used && pointInPolygon(t.pos, poly)).sort((a, z) => dist(a.pos, c) - dist(z.pos, c));
    const label = inside[0];
    if (label) label.used = true; else unnamed++;
    const bb = bbox(poly);
    rooms.push({
      name: label?.text || `Room ${rooms.length + 1}`,
      polygon: poly.map(p => ({ x: Math.round(p.x * 10) / 10, y: Math.round(p.y * 10) / 10 })),
      x: bb.minX, y: bb.minY, width: bb.maxX - bb.minX, height: bb.maxY - bb.minY,
    });
  }

  // Door openings, sealed along both leaf positions so rooms don't leak into each other.
  const seals: Seg[] = [];
  const swingDoors: BuiltFeature[] = [];
  for (const sw of swings) {
    const h = P(sw.center);
    const ends = [sw.startDeg, sw.endDeg].map(a => P({ x: sw.center.x + sw.radius * Math.cos((a * Math.PI) / 180), y: sw.center.y + sw.radius * Math.sin((a * Math.PI) / 180) }));
    for (const e of ends) seals.push({ x1: h.x, y1: h.y, x2: e.x, y2: e.y });
    // The closed leaf lies across the opening, ending at the far jamb: the end nearer a wall.
    const wallDist = (p: Pt) => walls.reduce((best, w) => Math.min(best, projectOnSegment(p, w).d), Infinity);
    const closed = wallDist(ends[0]) <= wallDist(ends[1]) ? ends[0] : ends[1];
    swingDoors.push({
      kind: 'door', x: (h.x + closed.x) / 2, y: (h.y + closed.y) / 2,
      rotationDeg: (Math.atan2(closed.y - h.y, closed.x - h.x) * 180) / Math.PI, width: sw.radius * s,
    });
  }
  health.doorsFromSwings = swingDoors.length;

  // No room outlines in the drawing: rooms are the spaces the walls enclose.
  if (rooms.length === 0 && o.detect?.rooms !== false && walls.length) {
    const found = detectRooms(walls, seals, { pxPerMeter: m }).slice(0, 400);
    for (const r of found) {
      const poly = r.polygon.map(p => ({ x: Math.round(p.x * 10) / 10, y: Math.round(p.y * 10) / 10 }));
      const c = polygonCentroid(poly);
      const label = texts.filter(t => !t.used && pointInPolygon(t.pos, poly)).sort((a, z) => dist(a.pos, c) - dist(z.pos, c))[0];
      if (label) label.used = true; else unnamed++;
      const bb = bbox(poly);
      // tiny unnamed spaces are cubicles, stores and shafts — say so, so they're easy to spot and rename
      const fallback = r.areaM2 < 2.5 ? `Small room ${rooms.filter(x => x.name.startsWith('Small room')).length + 1}` : `Room ${rooms.length + 1}`;
      rooms.push({ name: label?.text || fallback, polygon: poly, x: bb.minX, y: bb.minY, width: bb.maxX - bb.minX, height: bb.maxY - bb.minY });
    }
    health.roomsFromWalls = found.length;
  }

  // ── Point features ─────────────────────────────────────────────────────────
  const features: BuiltFeature[] = [];
  const add = (f: BuiltFeature) => {
    // the same door drawn as a block *and* a swing arc, etc.
    if (features.some(g => g.kind === f.kind && dist(g, f) < (f.kind === 'door' ? 1 : 0.3) * m)) return;
    if (features.filter(g => g.kind === f.kind).length >= MAX_FEATURES_PER_KIND) return;
    features.push(f);
  };
  const kindFor: Partial<Record<Category, FeatureKind>> = {
    doors: 'door', windows: 'window', stairs: 'stairs', elevators: 'elevator', trees: 'tree', furniture: 'furniture',
  };

  // Stairs and lifts are usually drawn as many lines (treads, a crossed box):
  // group what's on those layers into one object per cluster.
  const clusters: Record<'stairs' | 'elevators', { minX: number; minY: number; maxX: number; maxY: number }[]> = { stairs: [], elevators: [] };

  for (const e of d.entities) {
    const lc = cat(e.layer);
    if (e.kind === 'INSERT') {
      const c = categoryFromBlock(e.block) ?? lc;
      const kind = kindFor[c];
      if (!kind) continue;
      add({ kind: kind === 'furniture' && BENCH_BLOCK.test(e.block) ? 'bench' : kind, ...P(e.pos), rotationDeg: R(e.rotationDeg) });
      continue;
    }
    if (lc === 'doors' && e.kind === 'ARC' && !consumed.has(e)) {
      // A door swing: hinge at the centre, closed leaf along the start angle.
      const a = (e.startDeg * Math.PI) / 180;
      add({ kind: 'door', ...P({ x: e.center.x + (e.radius / 2) * Math.cos(a), y: e.center.y + (e.radius / 2) * Math.sin(a) }), rotationDeg: R(e.startDeg), width: e.radius * s });
    } else if (lc === 'trees' && e.kind === 'CIRCLE') {
      add({ kind: 'tree', ...P(e.center), rotationDeg: 0, width: 2 * e.radius * s });
    } else if ((lc === 'stairs' || lc === 'elevators') && (e.kind === 'LINE' || e.kind === 'POLYLINE')) {
      const pts = (e.kind === 'LINE' ? [e.a, e.b] : e.pts).map(P);
      clusters[lc].push(bbox(pts));
    } else if (lc === 'furniture' && e.kind === 'POLYLINE' && e.closed) {
      const poly = e.pts.map(P);
      if (polygonArea(poly) < 6 * m * m) add({ kind: 'furniture', ...polygonCentroid(poly), rotationDeg: 0 });
    }
  }

  swingDoors.forEach(add);
  for (const shape of furnitureShapes) add({ kind: 'furniture', ...polygonCentroid(shape), rotationDeg: 0, ...(() => { const bb = bbox(shape); return { width: bb.maxX - bb.minX, depth: bb.maxY - bb.minY }; })() });

  for (const kind of ['stairs', 'elevators'] as const) {
    for (const box of mergeBoxes(clusters[kind], 0.5 * m)) {
      const w = box.maxX - box.minX, h = box.maxY - box.minY;
      if (Math.max(w, h) < 0.5 * m) continue;
      add({ kind: kind === 'stairs' ? 'stairs' : 'elevator', x: (box.minX + box.maxX) / 2, y: (box.minY + box.maxY) / 2, rotationDeg: 0, width: w, depth: h });
    }
  }

  for (const t of texts) {
    if (t.used) continue;
    if (ENTRANCE_TEXT.test(t.text)) add({ kind: 'entrance', ...t.pos, rotationDeg: 0, label: t.text });
    else if (labelLayers.size > 0) add({ kind: 'label', ...t.pos, rotationDeg: 0, label: t.text });
  }

  // ── Floating objects and units sanity ──────────────────────────────────────
  const anchor = walls.length ? bbox(walls.flatMap(w => [{ x: w.x1, y: w.y1 }, { x: w.x2, y: w.y2 }]))
    : rooms.length ? bbox(rooms.flatMap(r => r.polygon)) : null;
  let kept = features;
  if (anchor) {
    const pad = 10 * m;
    const outside = (f: BuiltFeature) => f.x < anchor.minX - pad || f.x > anchor.maxX + pad || f.y < anchor.minY - pad || f.y > anchor.maxY + pad;
    health.floating = features.filter(outside).length;
    if (o.fix.floating && health.floating) {
      kept = features.filter(f => !outside(f));
      health.floatingRemoved = health.floating;
    }
    health.extentM = { w: (anchor.maxX - anchor.minX) / m, h: (anchor.maxY - anchor.minY) / m };
    const longest = Math.max(health.extentM.w, health.extentM.h);
    health.unitsSuspect = longest < 3 || longest > 3000;
  }

  if (walls.length === 0) warnings.push('No walls were found. Map at least one layer to Walls.');
  if (Object.values(mapping).includes('rooms') && rooms.length === 0) warnings.push('No closed room outlines were found on the Rooms layers.');
  if (unnamed > 0) warnings.push(`${unnamed} room(s) had no name inside them — they're called "Room N"; rename them in the editor.`);
  if (health.unitsSuspect) {
    warnings.push(`The plan comes out ${health.extentM.w.toFixed(1)} × ${health.extentM.h.toFixed(1)} m — the units are probably wrong. Change "Drawing units" and check again.`);
  }

  return { walls, rooms, features: kept, health, warnings };
}

/** Merge boxes that overlap (after growing each by `pad`) into combined boxes. */
function mergeBoxes(boxes: { minX: number; minY: number; maxX: number; maxY: number }[], pad: number) {
  const out = boxes.map(b => ({ ...b }));
  let changed = true;
  while (changed) {
    changed = false;
    for (let i = 0; i < out.length && !changed; i++) {
      for (let j = i + 1; j < out.length; j++) {
        const a = out[i], c = out[j];
        if (a.minX - pad <= c.maxX && c.minX - pad <= a.maxX && a.minY - pad <= c.maxY && c.minY - pad <= a.maxY) {
          out[i] = { minX: Math.min(a.minX, c.minX), minY: Math.min(a.minY, c.minY), maxX: Math.max(a.maxX, c.maxX), maxY: Math.max(a.maxY, c.maxY) };
          out.splice(j, 1);
          changed = true;
          break;
        }
      }
    }
  }
  return out;
}
