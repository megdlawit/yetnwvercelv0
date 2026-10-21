// The wall lines you can't walk (or see) through on a floor: every wall,
// minus its door and arch gaps (windows stay solid at walking height).

import type { IndoorVenue, Vec2 } from './model';
import { dist, segmentsCross } from './geometry';

/** How far apart the two faces of one thick wall may be drawn (lines of a double-line wall). */
const TWIN_WALL_M = 0.45;

export function obstacles(venue: IndoorVenue, floorId: string): { a: Vec2; b: Vec2 }[] {
  const out: { a: Vec2; b: Vec2 }[] = [];
  const doors = venue.openings.filter(o => o.floorId === floorId && o.kind !== 'window');
  for (const w of venue.walls) {
    if (w.floorId !== floorId) continue;
    const L = dist(w.a, w.b);
    if (L < 0.01) continue;
    const ux = (w.b.x - w.a.x) / L, uz = (w.b.z - w.a.z) / L;
    // A door cuts its own wall line — and the other face of the same thick wall, when the wall
    // is drawn as two lines (common): the parallel line close behind it, across the door's width.
    const gaps = doors.flatMap(o => {
      if (o.wallId === w.id) return [[o.offset - o.width / 2, o.offset + o.width / 2]];
      const rx = o.at.x - w.a.x, rz = o.at.z - w.a.z;
      const along = rx * ux + rz * uz, across = Math.abs(rx * uz - rz * ux);
      const parallel = Math.abs(Math.sin(o.angle - Math.atan2(uz, ux))) < 0.2;
      return parallel && across <= TWIN_WALL_M && along > -o.width / 2 && along < L + o.width / 2 ? [[along - o.width / 2, along + o.width / 2]] : [];
    }).sort((x, y) => x[0] - y[0]);
    let s = 0;
    const at = (k: number) => ({ x: w.a.x + ((w.b.x - w.a.x) * k) / L, z: w.a.z + ((w.b.z - w.a.z) * k) / L });
    for (const [g0, g1] of gaps) { if (g0 > s) out.push({ a: at(s), b: at(g0) }); s = Math.max(s, g1); }
    if (s < L) out.push({ a: at(s), b: at(L) });
  }
  return out;
}

/**
 * Does the stretch a→b pass through a wall (not through a door or arch)?
 * Its ends may touch a wall — a place set against one is fine.
 */
export function crossesWall(lines: { a: Vec2; b: Vec2 }[], a: Vec2, b: Vec2): boolean {
  const p = (k: number) => ({ x: a.x + (b.x - a.x) * k, z: a.z + (b.z - a.z) * k });
  const p0 = p(0.04), p1 = p(0.96);
  return lines.some(w => segmentsCross(p0, p1, w.a, w.b));
}
