import { describe, expect, it } from 'vitest';
import { fromPlan, type PlanRows } from './normalize';
import { crossesWall, obstacles } from './walls';
import { pathsThroughWalls, repairPathsThroughWalls } from './repair';

const P = 40;
// A closed 8 × 6 m room, its door in the south wall at x = 6 m, and a path
// drawn straight through the north wall from outside to the room's place.
const rows = (door = true): PlanRows => ({
  building: { id: 'b', name: 'B' },
  floors: [{ id: 'f', name: 'G', level: 0 }],
  walls: [
    { id: 'n', floor_id: 'f', x1: 0, y1: 0, x2: 8 * P, y2: 0 },
    { id: 'e', floor_id: 'f', x1: 8 * P, y1: 0, x2: 8 * P, y2: 6 * P },
    { id: 's', floor_id: 'f', x1: 8 * P, y1: 6 * P, x2: 0, y2: 6 * P },
    { id: 'w', floor_id: 'f', x1: 0, y1: 6 * P, x2: 0, y2: 0 },
  ],
  rooms: [],
  map_features: door ? [{ id: 'door', floor_id: 'f', kind: 'door', x: 6 * P, y: 6 * P, rotation_deg: 0, width: 0.9 * P }] : [],
  nodes: [{ id: 'out', floor_id: 'f', x: 3 * P, y: -3 * P }, { id: 'in', floor_id: 'f', x: 3 * P, y: 3 * P }, { id: 'in2', floor_id: 'f', x: 6 * P, y: 3 * P }],
  edges: [{ id: 'thru', from_node: 'out', to_node: 'in' }, { id: 'ok', from_node: 'in', to_node: 'in2' }],
});

describe('paths through walls', () => {
  it('finds the path drawn through a wall, not the one inside the room', () => {
    expect(pathsThroughWalls(rows())).toEqual(['thru']);
  });

  it('reroutes it round the building and in through the door', () => {
    let n = 0;
    const fix = repairPathsThroughWalls(rows(), { newId: () => `new${n++}` });
    expect(fix.rerouted).toEqual(['thru']);
    expect(fix.dropped).toEqual([]);
    expect(fix.nodes.length).toBeGreaterThan(0);
    // The chain runs out → … → in, and none of it crosses a wall.
    const r = rows();
    r.edges = r.edges.filter(e => e.id !== 'thru').concat(fix.edges);
    r.nodes = r.nodes.concat(fix.nodes.map(x => ({ ...x, is_hallway: true })));
    expect(pathsThroughWalls(r)).toEqual([]);
    expect(fix.edges[0].from_node).toBe('out');
    expect(fix.edges[fix.edges.length - 1].to_node).toBe('in');
    const venue = fromPlan(r);
    const lines = obstacles(venue, 'f');
    const at = new Map(venue.nodes.map(x => [x.id, x.at]));
    expect(fix.edges.some(e => crossesWall(lines, at.get(e.from_node)!, at.get(e.to_node)!))).toBe(false);
  });

  it('two paths round the same corner share its corner points, without drawing a stretch twice', () => {
    const r = rows();
    r.nodes.push({ id: 'out2', floor_id: 'f', x: 3.6 * P, y: -3.2 * P });
    r.edges.push({ id: 'thru2', from_node: 'out2', to_node: 'in' });
    let n = 0;
    const fix = repairPathsThroughWalls(r, { newId: () => `new${n++}` });
    expect(fix.rerouted).toEqual(['thru', 'thru2']);
    const alone = repairPathsThroughWalls(rows(), { newId: () => `new${n++}` });
    // The second path adds no more corner points than the first needed on its own (+1 at most for its own turn).
    expect(fix.nodes.length).toBeLessThanOrEqual(alone.nodes.length + 1);
    const keys = fix.edges.map(e => [e.from_node, e.to_node].sort().join('|'));
    expect(new Set(keys).size).toBe(keys.length);
  });

  it('takes out a path into a room with no door at all', () => {
    const fix = repairPathsThroughWalls(rows(false), { newId: () => 'x' });
    expect(fix.dropped).toEqual(['thru']);
    expect(fix.edges).toEqual([]);
  });
});

describe('walls drawn as two lines', () => {
  // The south wall is 20 cm thick, drawn as two lines; the door sits on the inner one.
  const thick = (): PlanRows => {
    const r = rows();
    r.walls.push({ id: 's2', floor_id: 'f', x1: 8 * P, y1: 6.2 * P, x2: 0, y2: 6.2 * P });
    r.nodes = [{ id: 'in', floor_id: 'f', x: 6 * P, y: 5 * P }, { id: 'out', floor_id: 'f', x: 6 * P, y: 7.5 * P }, { id: 'side', floor_id: 'f', x: 2 * P, y: 7.5 * P }];
    r.edges = [{ id: 'door', from_node: 'in', to_node: 'out' }, { id: 'wall', from_node: 'in', to_node: 'side' }];
    return r;
  };

  it('a door opens both faces of the wall; elsewhere the wall stays closed', () => {
    expect(pathsThroughWalls(thick())).toEqual(['wall']);
  });

  it('a parallel wall far behind the door is not opened', () => {
    const r = thick();
    r.walls.push({ id: 'far', floor_id: 'f', x1: 8 * P, y1: 7 * P, x2: 0, y2: 7 * P });
    expect(pathsThroughWalls(r)).toEqual(['door', 'wall']);
  });
});
