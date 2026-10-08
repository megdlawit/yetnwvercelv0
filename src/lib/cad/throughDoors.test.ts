import { describe, expect, it } from 'vitest';
import { crossesWall, fromPlan, obstacles } from '@ethi/indoor-core';
import { throughDoors } from './commitVenue';
import type { BuiltVenue } from './buildVenue';
import type { PathGraphResult } from '../dxf/generatePathGraph';

// An 8 × 6 m room (40 px = 1 m) with a door in its south wall at x = 6 m,
// and an imported path that runs straight in through the north wall.
const P = 40;
const venue = (doors = true): BuiltVenue => ({
  walls: [
    { x1: 0, y1: 0, x2: 8 * P, y2: 0 }, { x1: 8 * P, y1: 0, x2: 8 * P, y2: 6 * P },
    { x1: 8 * P, y1: 6 * P, x2: 0, y2: 6 * P }, { x1: 0, y1: 6 * P, x2: 0, y2: 0 },
  ],
  rooms: [],
  features: doors ? [{ kind: 'door', x: 6 * P, y: 6 * P, rotationDeg: 0, width: 0.9 * P }] : [],
  health: {} as BuiltVenue['health'],
  warnings: [],
});
const graph = (): PathGraphResult => ({
  nodes: [{ x: 3 * P, y: -3 * P, isHallway: true, roomIndex: null }, { x: 3 * P, y: 3 * P, isHallway: false, roomIndex: 0 }],
  edges: [{ from: 0, to: 1, weight: 6 * P }],
  warnings: [],
});

describe('importing paths that go through walls', () => {
  it('sends them round the wall and through the doorway', () => {
    const g = throughDoors(venue(), graph(), P);
    expect(g.nodes.length).toBeGreaterThan(2);
    expect(g.edges.length).toBeGreaterThan(1);
    // None of the saved paths crosses a wall.
    const rows = {
      building: { id: 'b', name: '' }, floors: [{ id: 'f', name: '', level: 0 }],
      walls: venue().walls.map((w, i) => ({ id: `w${i}`, floor_id: 'f', ...w })), rooms: [],
      map_features: [{ id: 'd', floor_id: 'f', kind: 'door', x: 6 * P, y: 6 * P, rotation_deg: 0, width: 0.9 * P }],
      nodes: [], edges: [],
    };
    const lines = obstacles(fromPlan(rows), 'f');
    for (const e of g.edges) {
      const a = g.nodes[e.from], b = g.nodes[e.to];
      expect(crossesWall(lines, { x: a.x / P, z: a.y / P }, { x: b.x / P, z: b.y / P })).toBe(false);
    }
    expect(g.warnings.join(' ')).toMatch(/1 path went through a wall/);
  });

  it('leaves a path out when there is no doorway, and says so', () => {
    const g = throughDoors(venue(false), graph(), P);
    expect(g.edges).toHaveLength(0);
    expect(g.warnings.join(' ')).toMatch(/no doorway to use and was left out/);
  });

  it('keeps a graph with no wall crossings as it is', () => {
    const g = graph();
    g.nodes[0] = { x: 6 * P, y: 4 * P, isHallway: true, roomIndex: null };
    expect(throughDoors(venue(), g, P)).toBe(g);
  });
});
