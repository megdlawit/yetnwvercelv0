// The wall lines you can't walk (or see) through on a floor: every wall,
// minus its door and arch gaps (windows stay solid at walking height).

import type { IndoorVenue, Vec2 } from './model';
import { dist } from './geometry';

export function obstacles(venue: IndoorVenue, floorId: string): { a: Vec2; b: Vec2 }[] {
  const out: { a: Vec2; b: Vec2 }[] = [];
  for (const w of venue.walls) {
    if (w.floorId !== floorId) continue;
    const L = dist(w.a, w.b);
    if (L < 0.01) continue;
    const gaps = venue.openings.filter(o => o.wallId === w.id && o.kind !== 'window').map(o => [o.offset - o.width / 2, o.offset + o.width / 2]).sort((x, y) => x[0] - y[0]);
    let s = 0;
    const at = (k: number) => ({ x: w.a.x + ((w.b.x - w.a.x) * k) / L, z: w.a.z + ((w.b.z - w.a.z) * k) / L });
    for (const [g0, g1] of gaps) { if (g0 > s) out.push({ a: at(s), b: at(g0) }); s = Math.max(s, g1); }
    if (s < L) out.push({ a: at(s), b: at(L) });
  }
  return out;
}
