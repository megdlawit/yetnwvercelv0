import { describe, expect, it } from 'vitest';
import type { BuiltVenue } from './buildVenue';
import { alignFloors, bestShift, shiftVenue, spotsOf, verticalLinks } from './stackFloors';

const M = 40;
/** A 12 × 8 m floor with a stair core and a lift, drawn with its corner at (ox, oy) metres. */
function floor(ox: number, oy: number): BuiltVenue {
  const w = (x1: number, y1: number, x2: number, y2: number) => ({ x1: (ox + x1) * M, y1: (oy + y1) * M, x2: (ox + x2) * M, y2: (oy + y2) * M });
  return {
    walls: [w(0, 0, 12, 0), w(12, 0, 12, 8), w(12, 8, 0, 8), w(0, 8, 0, 0), w(4, 0, 4, 5), w(4, 5, 7, 5), w(9, 3, 12, 3), w(2, 6, 2, 8)],
    rooms: [],
    features: [{ kind: 'stairs', x: (ox + 2) * M, y: (oy + 2) * M, rotationDeg: 0 }, { kind: 'elevator', x: (ox + 10.5) * M, y: (oy + 1.5) * M, rotationDeg: 0 }],
    health: {} as BuiltVenue['health'], warnings: [],
  };
}

describe('floors on top of each other', () => {
  it('finds how far a floor is drawn from the one below', () => {
    const s = bestShift(floor(0, 0), floor(7.3, -2.1), M);
    expect(s.dx / M).toBeCloseTo(-7.3, 1);
    expect(s.dy / M).toBeCloseTo(2.1, 1);
    expect(s.fit).toBeGreaterThan(0.9);
  });

  it('moves every floor over the one below, and leaves a different plan where it is', () => {
    const other: BuiltVenue = { ...floor(0, 0), walls: [{ x1: 0, y1: 0, x2: 3 * M, y2: 30 * M }, { x1: 50 * M, y1: 2 * M, x2: 51 * M, y2: 40 * M }] };
    const { built, shifts } = alignFloors([{ level: 0, built: floor(0, 0) }, { level: 1, built: floor(20, 0) }, { level: 2, built: other }], M);
    expect(shifts[1].moved).toBe(true);
    expect(built[1].walls[0]).toEqual(floor(0, 0).walls[0]);
    expect(built[1].features[0].x).toBeCloseTo(2 * M, 3);
    expect(shifts[2].moved).toBe(false);
    expect(built[2]).toBe(other);
  });

  it('moves the drawing and rooms with the walls', () => {
    const v: BuiltVenue = { ...floor(0, 0), rooms: [{ name: 'Lobby', polygon: [{ x: 0, y: 0 }, { x: 40, y: 0 }, { x: 40, y: 40 }], x: 0, y: 0, width: 40, height: 40 }],
      drawing: { v: 1, layers: { walls: [[0, 0, 400, 0]] } } };
    const s = shiftVenue(v, 10, 20);
    expect(s.rooms[0].polygon[1]).toEqual({ x: 50, y: 20 });
    expect(s.drawing!.layers.walls![0]).toEqual([10, 20, 410, 20]);
  });

  it('links stairs and lifts that line up between neighbouring floors, from the nearest place', () => {
    const f0 = floor(0, 0), f1 = floor(0, 0), f3 = floor(0, 0);
    const nodes = (p: string) => [{ id: `${p}-stair`, x: 2.5 * M, y: 2.5 * M }, { id: `${p}-lift`, x: 10.5 * M, y: 2 * M }, { id: `${p}-far`, x: 6 * M, y: 7 * M }];
    const links = verticalLinks([
      { floorId: 'g', level: 0, spots: spotsOf(f0), nodes: nodes('g') },
      { floorId: '1', level: 1, spots: spotsOf(f1), nodes: nodes('1') },
      { floorId: '3', level: 3, spots: spotsOf(f3), nodes: nodes('3') },   // the 2nd floor isn't in this import
    ], M);
    expect(links).toEqual([
      { from: 'g-stair', to: '1-stair', kind: 'stairs', fromFloor: 'g', toFloor: '1' },
      { from: 'g-lift', to: '1-lift', kind: 'elevator', fromFloor: 'g', toFloor: '1' },
    ]);
  });

  it('knows stairs and lifts from room names too', () => {
    const v: BuiltVenue = { ...floor(0, 0), features: [], rooms: [{ name: 'Stair 1', polygon: [{ x: 0, y: 0 }, { x: 80, y: 0 }, { x: 80, y: 80 }, { x: 0, y: 80 }], x: 0, y: 0, width: 80, height: 80 }] };
    expect(spotsOf(v)).toEqual([{ kind: 'stairs', x: 40, y: 40 }]);
  });
});
