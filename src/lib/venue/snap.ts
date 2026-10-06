// Snapping for the floor editor's precision tools.
//
// Priority, highest first: an existing node, a wall endpoint (corner), a wall
// midpoint, the nearest point along a wall, then the grid. Within a class the
// closest candidate wins; a class only applies inside `tolerance` (world
// units — the caller converts its on-screen tolerance using the zoom level).

import type { Wall } from '@/data/types';

export type SnapKind = 'node' | 'endpoint' | 'midpoint' | 'wall' | 'grid';

export interface SnapResult { x: number; y: number; kind: SnapKind | null }

interface Pt { x: number; y: number }

export interface SnapSources {
  walls: Wall[];
  nodes: (Pt & { id: string })[];
  excludeNodeId?: string | null; // the node being dragged must not snap to itself
}

export interface SnapOptions {
  tolerance: number;
  grid?: number | null;        // grid step; null/undefined = no grid snap
}

const d = (a: Pt, b: Pt) => Math.hypot(a.x - b.x, a.y - b.y);

export function closestOnSegment(p: Pt, w: Wall): Pt {
  const dx = w.x2 - w.x1, dy = w.y2 - w.y1;
  const len2 = dx * dx + dy * dy;
  const t = len2 === 0 ? 0 : Math.max(0, Math.min(1, ((p.x - w.x1) * dx + (p.y - w.y1) * dy) / len2));
  return { x: w.x1 + t * dx, y: w.y1 + t * dy };
}

export function snapPoint(p: Pt, src: SnapSources, opt: SnapOptions): SnapResult {
  const best = (cands: Iterable<Pt>): Pt | null => {
    let hit: Pt | null = null, hd = opt.tolerance;
    for (const c of cands) { const cd = d(p, c); if (cd <= hd) { hit = c; hd = cd; } }
    return hit;
  };

  const node = best(src.nodes.filter(n => n.id !== src.excludeNodeId));
  if (node) return { x: node.x, y: node.y, kind: 'node' };

  const ends = best(src.walls.flatMap(w => [{ x: w.x1, y: w.y1 }, { x: w.x2, y: w.y2 }]));
  if (ends) return { x: ends.x, y: ends.y, kind: 'endpoint' };

  const mid = best(src.walls.map(w => ({ x: (w.x1 + w.x2) / 2, y: (w.y1 + w.y2) / 2 })));
  if (mid) return { x: mid.x, y: mid.y, kind: 'midpoint' };

  const along = best(src.walls.map(w => closestOnSegment(p, w)));
  if (along) return { x: along.x, y: along.y, kind: 'wall' };

  if (opt.grid && opt.grid > 0) {
    return { x: Math.round(p.x / opt.grid) * opt.grid, y: Math.round(p.y / opt.grid) * opt.grid, kind: 'grid' };
  }
  return { x: p.x, y: p.y, kind: null };
}
