// The architect's drawing of one floor, kept for the visitor map so it reads as a
// floor plan rather than a diagram: walls with their solid fills, doors with their
// swings, windows, stairs, lifts, furniture and fixtures, planting — each kind on its
// own layer. Layers mapped to "ignore" (dimensions, grids, notes, the title block,
// services) and room outlines and texts (the rooms table names rooms) are not kept.
//
// Coordinates are editor px like the rest of the venue, rounded to whole px (2.5 cm
// at 40 px/m), each line a flat [x0, y0, x1, y1, …] list.

import type { DxfEntity, DxfPoint } from '../dxf/parseDxf';
import type { CadDrawing, Category } from './types';
import { wallHatchLoops } from './analyze';
import { bbox, type Pt } from './geometry';

/** Drawing order, bottom to top. `poche` are filled shapes (cut walls, columns), the rest lines. */
export const DRAWING_LAYERS = ['poche', 'furniture', 'trees', 'stairs', 'elevators', 'windows', 'doors', 'walls'] as const;
export type DrawingLayer = (typeof DRAWING_LAYERS)[number];

export interface PlanDrawing {
  v: 1;
  layers: Partial<Record<DrawingLayer, number[][]>>;
  /** Some furniture (then planting, …) was left out to keep the drawing a sensible size. */
  truncated?: boolean;
}

const LAYER_OF: Partial<Record<Category, DrawingLayer>> = {
  walls: 'walls', doors: 'doors', windows: 'windows', stairs: 'stairs', elevators: 'elevators', furniture: 'furniture', trees: 'trees',
};

/** What's dropped first when a drawing is too big: the least important kind of line. */
const KEEP_FIRST: DrawingLayer[] = ['poche', 'walls', 'windows', 'doors', 'stairs', 'elevators', 'trees', 'furniture'];

/** Enough points for a large hotel floor (≈1–2 MB of JSON). */
export const MAX_DRAWING_POINTS = 150_000;

export function planDrawing(
  d: CadDrawing, cat: (layer: string) => Category, P: (p: DxfPoint) => Pt,
  o: { pxPerMeter: number; unitsPerMeter: number; maxPoints?: number },
  /** Entities the venue build recognised as something other than their layer says (door leaves on a wall layer, …); null = leave out. */
  drawAs: Map<DxfEntity, DrawingLayer | null> = new Map(),
): PlanDrawing {
  const m = o.pxPerMeter, s = o.pxPerMeter / o.unitsPerMeter;
  const layers: Partial<Record<DrawingLayer, number[][]>> = {};

  const add = (layer: DrawingLayer, pts: Pt[], closed = false) => {
    const flat: number[] = [];
    for (const p of pts) {
      const x = Math.round(p.x), y = Math.round(p.y);
      if (flat.length && flat[flat.length - 2] === x && flat[flat.length - 1] === y) continue;
      flat.push(x, y);
    }
    if (closed && flat.length > 4 && (flat[0] !== flat[flat.length - 2] || flat[1] !== flat[flat.length - 1])) flat.push(flat[0], flat[1]);
    if (flat.length < 4) return;
    const list = (layers[layer] ??= []);
    // A line that starts where the last one ended continues it (exports split walls into single lines).
    const last = list[list.length - 1];
    if (layer !== 'poche' && last && last[last.length - 2] === flat[0] && last[last.length - 1] === flat[1]) last.push(...flat.slice(2));
    else list.push(flat);
  };

  const arc = (c: DxfPoint, r: number, a0: number, a1: number): Pt[] => {
    let sweep = a1 - a0;
    if (sweep <= 0) sweep += 360;
    const n = Math.max(3, Math.min(48, Math.ceil(sweep / (r * s < 0.3 * m ? 30 : 10))));
    return Array.from({ length: n + 1 }, (_, i) => {
      const a = ((a0 + (sweep * i) / n) * Math.PI) / 180;
      return P({ x: c.x + r * Math.cos(a), y: c.y + r * Math.sin(a) });
    });
  };

  const wallSegs: [Pt, Pt][] = [];
  for (const e of d.entities) {
    const layer = drawAs.has(e) ? drawAs.get(e) : LAYER_OF[cat(e.layer)];
    if (!layer) continue;
    if (e.kind === 'LINE') {
      const a = P(e.a), b = P(e.b);
      add(layer, [a, b]);
      if (layer === 'walls') wallSegs.push([a, b]);
    } else if (e.kind === 'POLYLINE') {
      const pts = e.pts.map(P);
      add(layer, pts, e.closed);
      if (layer === 'walls') {
        for (let i = 1; i < pts.length; i++) wallSegs.push([pts[i - 1], pts[i]]);
        if (e.closed && pts.length > 2) wallSegs.push([pts[pts.length - 1], pts[0]]);
      }
      if (layer === 'walls' && e.closed && solidWallShape(pts, m)) add('poche', pts, true);
    } else if (e.kind === 'ARC') add(layer, arc(e.center, e.radius, e.startDeg, e.endDeg));
    else if (e.kind === 'CIRCLE') add(layer, arc(e.center, e.radius, 0, 360), true);
  }
  // Walls drawn as hatched areas are filled, as on a printed plan.
  for (const loop of wallHatchLoops(d, o.unitsPerMeter, l => cat(l) === 'walls' || cat(l) === 'ignore')) add('poche', loop.map(P), true);
  // …and so are walls drawn as two parallel lines, the usual way.
  for (const quad of wallFills(wallSegs, m)) add('poche', quad, true);

  return limitSize(layers, o.maxPoints ?? MAX_DRAWING_POINTS);
}

/** A closed outline on a wall layer that's a piece of wall or a column, so it's filled solid. */
function solidWallShape(pts: Pt[], m: number): boolean {
  const b = bbox(pts), w = (b.maxX - b.minX) / m, h = (b.maxY - b.minY) / m;
  const thin = Math.min(w, h), long = Math.max(w, h);
  const wallPiece = thin >= 0.05 && thin <= 0.45 && long >= 0.3;
  const column = thin >= 0.15 && long <= 1.0;
  return wallPiece || column;
}

/**
 * The solid between a wall's two faces: each pair of parallel wall lines 5–45 cm apart,
 * filled where they run alongside each other. A line with parallel neighbours on both
 * sides is a stair tread or a pattern, not a wall face, and is left hollow.
 */
export function wallFills(segs: [Pt, Pt][], m: number): Pt[][] {
  const minGap = 0.05 * m, maxGap = 0.45 * m, minRun = 0.15 * m;
  const lines = segs
    .map(([a, b]) => { const len = Math.hypot(b.x - a.x, b.y - a.y); return { a, b, len, ux: (b.x - a.x) / len, uy: (b.y - a.y) / len }; })
    .filter(l => l.len >= 0.2 * m);
  // Lines by the 1 m cells they pass through, to find neighbours without comparing every pair.
  const cell = m, grid = new Map<string, number[]>();
  lines.forEach((l, i) => {
    const steps = Math.ceil(l.len / cell);
    const seen = new Set<string>();
    for (let s = 0; s <= steps; s++) {
      const t = Math.min(1, s / steps), key = `${Math.floor((l.a.x + (l.b.x - l.a.x) * t) / cell)},${Math.floor((l.a.y + (l.b.y - l.a.y) * t) / cell)}`;
      if (!seen.has(key)) { seen.add(key); (grid.get(key) ?? grid.set(key, []).get(key)!).push(i); }
    }
  });
  const near = (l: (typeof lines)[number]) => {
    const out = new Set<number>(), steps = Math.ceil(l.len / cell);
    for (let s = 0; s <= steps; s++) {
      const t = Math.min(1, s / steps), cx = Math.floor((l.a.x + (l.b.x - l.a.x) * t) / cell), cy = Math.floor((l.a.y + (l.b.y - l.a.y) * t) / cell);
      for (let dx = -1; dx <= 1; dx++) for (let dy = -1; dy <= 1; dy++) for (const j of grid.get(`${cx + dx},${cy + dy}`) ?? []) out.add(j);
    }
    return out;
  };
  // For line i and a parallel line j: signed distance of j from i, and the stretch (along i) they share.
  const pair = (i: number, j: number) => {
    const p = lines[i], q = lines[j];
    if (Math.abs(p.ux * q.uy - p.uy * q.ux) > 0.035) return null;                    // not parallel (2°)
    const off = (q.a.x - p.a.x) * -p.uy + (q.a.y - p.a.y) * p.ux;
    if (Math.abs(off) < minGap || Math.abs(off) > maxGap) return null;
    const t0 = (q.a.x - p.a.x) * p.ux + (q.a.y - p.a.y) * p.uy, t1 = (q.b.x - p.a.x) * p.ux + (q.b.y - p.a.y) * p.uy;
    const from = Math.max(0, Math.min(t0, t1)), to = Math.min(p.len, Math.max(t0, t1));
    return to - from >= minRun ? { off, from, to } : null;
  };
  const partners = lines.map((_, i) => [...near(lines[i])].filter(j => j !== i).map(j => ({ j, s: pair(i, j) })).filter(x => x.s) as { j: number; s: NonNullable<ReturnType<typeof pair>> }[]);
  const bothSides = partners.map(ps => ps.some(x => x.s.off > 0) && ps.some(x => x.s.off < 0));
  const quads: Pt[][] = [], done = new Set<string>();
  partners.forEach((ps, i) => {
    if (bothSides[i]) return;
    const p = lines[i], faces = ps.filter(x => !bothSides[x.j]);
    if (!faces.length) return;
    // The nearest line alongside is the wall's other face (one further out is a finish); a face
    // broken by doorways is several lines at that distance.
    const nearest = Math.min(...faces.map(x => Math.abs(x.s.off)));
    for (const { j, s } of faces) {
      if (Math.abs(s.off) > nearest + 0.03 * m) continue;
      const key = i < j ? `${i},${j}` : `${j},${i}`;
      if (done.has(key)) continue;
      done.add(key);
      const nx = -p.uy * s.off, ny = p.ux * s.off;
      const A = { x: p.a.x + p.ux * s.from, y: p.a.y + p.uy * s.from }, B = { x: p.a.x + p.ux * s.to, y: p.a.y + p.uy * s.to };
      quads.push([A, B, { x: B.x + nx, y: B.y + ny }, { x: A.x + nx, y: A.y + ny }]);
    }
  });
  return quads;
}

function limitSize(layers: Partial<Record<DrawingLayer, number[][]>>, maxPoints: number): PlanDrawing {
  let budget = maxPoints, truncated = false;
  const out: PlanDrawing['layers'] = {};
  for (const layer of KEEP_FIRST) {
    const lines = layers[layer];
    if (!lines?.length) continue;
    const kept: number[][] = [];
    for (const line of lines) {
      const n = line.length / 2;
      if (n > budget) { truncated = true; continue; }
      budget -= n;
      kept.push(line);
    }
    if (kept.length) out[layer] = kept;
  }
  return { v: 1, layers: out, ...(truncated ? { truncated } : {}) };
}

/** SVG path data for one layer (`close` for filled shapes). */
export function layerPath(lines: number[][] | undefined, close = false): string {
  if (!lines) return '';
  let d = '';
  for (const l of lines) {
    d += `M${l[0]} ${l[1]}`;
    for (let i = 2; i < l.length; i += 2) d += `L${l[i]} ${l[i + 1]}`;
    if (close) d += 'Z';
  }
  return d;
}

/** The drawing's extent in editor px, or null when it holds nothing. */
export function drawingBounds(dr: PlanDrawing | null | undefined) {
  let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
  for (const lines of Object.values(dr?.layers ?? {})) {
    for (const l of lines ?? []) {
      for (let i = 0; i < l.length; i += 2) {
        if (l[i] < minX) minX = l[i]; if (l[i] > maxX) maxX = l[i];
        if (l[i + 1] < minY) minY = l[i + 1]; if (l[i + 1] > maxY) maxY = l[i + 1];
      }
    }
  }
  return minX <= maxX ? { minX, minY, maxX, maxY } : null;
}
