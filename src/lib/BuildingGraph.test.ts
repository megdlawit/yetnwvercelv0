import { describe, expect, it } from 'vitest';
import type { Building, Floor } from '@/data/types';
import { BuildingGraph } from './BuildingGraph';

const PX = 40; // editor scale
// A floor with a staircase at each end (25 m apart). `corridor`: whether the
// two ends are joined on this floor.
function floor(id: string, level: number, corridor: boolean, stairsAs: 'rooms' | 'connectors'): Floor {
  const L = `${id}-L`, R = `${id}-R`;
  return {
    id, buildingId: 'b', level, name: id, width: 2000, height: 400, walls: [],
    nodes: [
      { id: L, floorId: id, name: 'West stairs', x: 0, y: 0, isHallway: false },
      { id: R, floorId: id, name: 'East stairs', x: 25 * PX, y: 0, isHallway: false },
    ],
    edges: corridor ? [{ id: `${id}-corr`, fromNodeId: L, toNodeId: R, weight: 1 /* stale */ }] : [],
    rooms: stairsAs === 'rooms' ? [
      { id: `${L}-room`, floorId: id, name: 'West stairs', nodeId: L, x: -40, y: -40, width: 80, height: 80, type: 'stairs' },
      { id: `${R}-room`, floorId: id, name: 'East stairs', nodeId: R, x: 25 * PX - 40, y: -40, width: 80, height: 80, type: 'stairs' },
    ] : [],
  };
}
const building = (stairsAs: 'rooms' | 'connectors'): Building => ({
  id: 'b', name: 'Test', address: '', city: '', planPxPerMeter: PX,
  floors: [floor('g', 0, false, stairsAs), floor('one', 1, true, stairsAs)],
  connectors: stairsAs === 'connectors' ? ['g', 'one'].flatMap(f => [
    { nodeId: `${f}-L`, floorId: f, type: 'stairs' as const }, { nodeId: `${f}-R`, floorId: f, type: 'stairs' as const },
  ]) : undefined,
});

describe('BuildingGraph floor changes', () => {
  it.each(['rooms', 'connectors'] as const)('joins each staircase only to the one above it (stairs as %s)', stairsAs => {
    const route = BuildingGraph.fromBuilding(building(stairsAs)).findPath('g-L', 'one-R')!;
    // Up the west stairs, then across the first floor — not from the west stairs straight onto the east ones.
    expect(route.nodeIds).toEqual(['g-L', 'one-L', 'one-R']);
    expect(route.floorTransitions).toHaveLength(1);
    expect(route.floorTransitions[0]).toMatchObject({ type: 'stairs', direction: 'up' });
  });

  it('measures paths on a floor from where their ends are, not a stale stored length', () => {
    const route = BuildingGraph.fromBuilding(building('rooms')).findPath('one-L', 'one-R')!;
    expect(route.distance).toBeCloseTo(25 * PX, 0);
  });

  it('times the walk in real metres, with the stairs on top', () => {
    const route = BuildingGraph.fromBuilding(building('rooms')).findPath('g-L', 'one-R')!;
    // 25 m of corridor at 1.3 m/s, plus 15 s for the stairs.
    expect(route.estimatedSeconds).toBe(Math.round(25 / 1.3 + 15));
  });
});
