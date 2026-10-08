// The automatic scenery around a building: a seeded ring of trees, the same
// every visit. It shows only until the venue places scenery of its own on
// the ground floor — then the venue is in charge (the editor can also turn
// the ring into real, editable trees to start from).

import { GREENERY, type IndoorVenue, type Vec2 } from './model';
import { v } from './geometry';

export interface GroundBounds { minX: number; maxX: number; minZ: number; maxZ: number }

/** A floor's extent (metres), with a little margin — the same box its slab is cut from. Null when the floor is empty. */
export function groundBounds(venue: IndoorVenue, floorId: string): GroundBounds | null {
  const pts: Vec2[] = [
    ...venue.walls.filter(w => w.floorId === floorId).flatMap(w => [w.a, w.b]),
    ...venue.rooms.filter(r => r.floorId === floorId).flatMap(r => r.polygon),
    ...venue.nodes.filter(n => n.floorId === floorId).map(n => n.at),
    ...venue.connectors.filter(c => c.fromFloorId === floorId).flatMap(c => [c.bottom, c.top]),
  ];
  if (!pts.length) return null;
  const m = 0.4;
  return {
    minX: Math.min(...pts.map(p => p.x)) - m, maxX: Math.max(...pts.map(p => p.x)) + m,
    minZ: Math.min(...pts.map(p => p.z)) - m, maxZ: Math.max(...pts.map(p => p.z)) + m,
  };
}

/** Where the automatic trees stand round a building (metres), with each one's size and which green it is. */
export function sceneryRing(b: GroundBounds): { at: Vec2; size: number; alt: boolean }[] {
  let seed = Math.round((b.maxX - b.minX) * 131 + (b.maxZ - b.minZ) * 71) || 7;
  const rnd = () => { seed = (seed * 16807) % 2147483647; return seed / 2147483647; };
  const cx = (b.minX + b.maxX) / 2, cz = (b.minZ + b.maxZ) / 2;
  const rx = (b.maxX - b.minX) / 2 + 4, rz = (b.maxZ - b.minZ) / 2 + 4;
  const count = Math.min(60, Math.round((rx + rz) * 1.2));
  const out: { at: Vec2; size: number; alt: boolean }[] = [];
  for (let i = 0; i < count; i++) {
    const a = (i / count) * Math.PI * 2 + rnd() * 0.3;
    const k = 1 + rnd() * 0.9;
    const at = v(cx + Math.cos(a) * rx * k, cz + Math.sin(a) * rz * k);
    out.push({ at, size: 2 + rnd() * 2.2, alt: rnd() > 0.5 });
  }
  return out;
}

/** Whether a floor gets the automatic ring of trees: the lowest floor, while it has no scenery of its own. */
export function autoScenery(venue: IndoorVenue, floorId: string): boolean {
  const lowest = venue.floors[0]?.id;
  return floorId === lowest && !venue.props.some(p => p.floorId === floorId && GREENERY.includes(p.kind));
}
