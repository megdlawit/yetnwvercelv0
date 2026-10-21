// Paths that go through walls, fixed: each one is sent the way a person
// walks — round the wall and through a doorway (walkway.ts) — as a chain of
// new corner points. A path with no doorway to use is taken out (and
// reported), since nobody can walk it. Used by the CAD import before it
// saves, and by the editor when someone draws a path across a wall.
//
// Works on database-shaped rows in plan px; returns what to add and remove.

import { fromPlan, type PlanRows } from './normalize';
import { crossesWall, obstacles } from './walls';
import { walkway } from './nav/walkway';
import type { IndoorVenue, Vec2 } from './model';

export interface PathRepair {
  /** New corner points (hallway path points), plan px. */
  nodes: { id: string; floor_id: string; x: number; y: number }[];
  /** New paths (the chains that replace the ones through walls). */
  edges: { id: string; from_node: string; to_node: string; weight: number }[];
  /** Paths through walls that were rerouted (replaced by a chain). */
  rerouted: string[];
  /** Paths through walls with no doorway to use (taken out). */
  dropped: string[];
}

export interface RepairOptions {
  /** Plan px per metre (the editor draws at 40). */
  pxPerMeter?: number;
  newId: () => string;
  /** Only look at these paths (default: every path on a single floor). */
  edgeIds?: string[];
}

/** Which paths in these rows cross a wall (ids). Pass `venue` when it's already built from the same rows. */
export function pathsThroughWalls(rows: PlanRows, pxPerMeter = 40, edgeIds?: string[], venue: IndoorVenue = fromPlan(rows, { pxPerMeter })): string[] {
  const node = new Map(venue.nodes.map(n => [n.id, n]));
  const lines = new Map<string, ReturnType<typeof obstacles>>();
  const out: string[] = [];
  const only = edgeIds ? new Set(edgeIds) : null;
  for (const e of rows.edges) {
    if (only && !only.has(e.id)) continue;
    if (e.connection && e.connection !== 'door') continue;
    const a = node.get(e.from_node), b = node.get(e.to_node);
    if (!a || !b || a.floorId !== b.floorId) continue;
    let ls = lines.get(a.floorId);
    if (!ls) { ls = obstacles(venue, a.floorId); lines.set(a.floorId, ls); }
    if (crossesWall(ls, a.at, b.at)) out.push(e.id);
  }
  return out;
}

export function repairPathsThroughWalls(rows: PlanRows, opts: RepairOptions): PathRepair {
  const ppm = opts.pxPerMeter ?? 40;
  const bad = pathsThroughWalls(rows, ppm, opts.edgeIds);
  const result: PathRepair = { nodes: [], edges: [], rerouted: [], dropped: [] };
  if (!bad.length) return result;
  const venue = fromPlan(rows, { pxPerMeter: ppm });
  const node = new Map(venue.nodes.map(n => [n.id, n]));
  const px = (p: Vec2) => ({ x: Math.round(p.x * ppm * 10) / 10, y: Math.round(p.z * ppm * 10) / 10 });
  // Corner points to share: existing hallway points, and the ones made here
  // (two paths round the same wall corner meet at one point, not two).
  const corners = venue.nodes.filter(n => n.hallway).map(n => ({ id: n.id, floorId: n.floorId, at: n.at }));
  const SHARE = 0.25;
  // Paths that already exist (so a shared stretch isn't drawn twice).
  const key = (p: string, q: string) => (p < q ? p + '|' + q : q + '|' + p);
  const badSet = new Set(bad), edgeById = new Map(rows.edges.map(x => [x.id, x] as const));
  const have = new Set(rows.edges.filter(x => !badSet.has(x.id)).map(x => key(x.from_node, x.to_node)));
  for (const id of bad) {
    const e = edgeById.get(id)!;
    const a = node.get(e.from_node)!, b = node.get(e.to_node)!;
    const way = walkway(venue, a.floorId, a.at, b.at);
    if (!way || way.length < 2) { result.dropped.push(id); continue; }
    // The chain: a → corners → b (the corners are hallway points, new or shared).
    const ids = [a.id], pts = [a.at];
    for (const p of way.slice(1, -1)) {
      const near = corners.find(c => c.floorId === a.floorId && Math.hypot(c.at.x - p.x, c.at.z - p.z) < SHARE);
      if (near && near.id === b.id) break;
      if (near) { if (near.id !== ids[ids.length - 1]) { ids.push(near.id); pts.push(near.at); } continue; }
      const nid = opts.newId();
      result.nodes.push({ id: nid, floor_id: a.floorId, ...px(p) });
      corners.push({ id: nid, floorId: a.floorId, at: p });
      ids.push(nid); pts.push(p);
    }
    ids.push(b.id); pts.push(b.at);
    for (let i = 1; i < ids.length; i++) {
      if (ids[i] === ids[i - 1] || have.has(key(ids[i - 1], ids[i]))) continue;
      have.add(key(ids[i - 1], ids[i]));
      const w = Math.hypot(pts[i].x - pts[i - 1].x, pts[i].z - pts[i - 1].z) * ppm;
      result.edges.push({ id: opts.newId(), from_node: ids[i - 1], to_node: ids[i], weight: Math.max(1, Math.round(w)) });
    }
    result.rerouted.push(id);
  }
  return result;
}
