import { describe, expect, it } from 'vitest';
import { fromPlan, type PlanRows } from '../normalize';
import { obstacles } from '../walls';
import { segmentsCross } from '../geometry';
import { walkway } from './walkway';

// A closed 8 × 6 m room with one door in its south wall, at x = 6 m. The
// path graph runs straight through the north wall (a drawing mistake).
const P = 40;
const rows = (): PlanRows => ({
  building: { id: 'b', name: 'B' },
  floors: [{ id: 'f', name: 'G', level: 0 }],
  walls: [
    { id: 'n', floor_id: 'f', x1: 0, y1: 0, x2: 8 * P, y2: 0 },
    { id: 'e', floor_id: 'f', x1: 8 * P, y1: 0, x2: 8 * P, y2: 6 * P },
    { id: 's', floor_id: 'f', x1: 8 * P, y1: 6 * P, x2: 0, y2: 6 * P },
    { id: 'w', floor_id: 'f', x1: 0, y1: 6 * P, x2: 0, y2: 0 },
  ],
  rooms: [{ id: 'r', floor_id: 'f', name: 'Room', x: 0, y: 0, width: 8 * P, height: 6 * P, node_id: 'in' }],
  map_features: [{ id: 'door', floor_id: 'f', kind: 'door', x: 6 * P, y: 6 * P, rotation_deg: 0, width: 0.9 * P }],
  nodes: [{ id: 'out', floor_id: 'f', x: 3 * P, y: -3 * P }, { id: 'in', floor_id: 'f', x: 3 * P, y: 3 * P }],
  edges: [{ id: 'thru', from_node: 'out', to_node: 'in' }],
});

describe('walkway', () => {
  const venue = fromPlan(rows());
  const walls = obstacles(venue, 'f');
  const throughWall = (pts: { x: number; z: number }[]) => pts.slice(1).some((p, i) => walls.some(w => segmentsCross(pts[i], p, w.a, w.b)));

  it('goes round the outside and in through the door, never through a wall', () => {
    const way = walkway(venue, 'f', { x: 3, z: -3 }, { x: 3, z: 3 })!;
    expect(way).not.toBeNull();
    expect(throughWall(way)).toBe(false);
    // It passes through the doorway (x ≈ 6, z ≈ 6).
    expect(way.some((p, i) => i > 0 && Math.abs(p.x - 6) < 0.6 && Math.abs(p.z - 6) < 0.7)).toBe(true);
    expect(way[0]).toEqual({ x: 3, z: -3 });
    expect(way[way.length - 1]).toEqual({ x: 3, z: 3 });
  });

  it('is a straight line when nothing is in the way', () => {
    expect(walkway(venue, 'f', { x: 1, z: 1 }, { x: 7, z: 5 })).toEqual([{ x: 1, z: 1 }, { x: 7, z: 5 }]);
  });

  it('finds no way into a room that has no door', () => {
    const r = rows();
    r.map_features = [];
    expect(walkway(fromPlan(r), 'f', { x: 3, z: -3 }, { x: 3, z: 3 })).toBeNull();
  });
});
