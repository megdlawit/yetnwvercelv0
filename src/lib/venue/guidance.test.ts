import { describe, expect, it } from 'vitest';
import { currentStepIndex, measureRoute, pointAlong, projectOntoRoute, type RoutePoint } from './guidance';
import { directions, type RouteNode } from './routing';

const P = 40;
const pt = (x: number, y: number, floor = 'f0', level = 0): RoutePoint => ({ x: x * P, y: y * P, floorId: floor, floorLevel: level });
// 10 m east, turn right, 8 m south; then a lift up, then 5 m east upstairs.
const path = [pt(0, 0), pt(10, 0), pt(10, 8), pt(10, 8, 'f1', 1), pt(15, 8, 'f1', 1)];
const nodes: RouteNode[] = path.map((p, i) => ({ ...p, id: `n${i}`, name: i === 4 ? 'Gallery' : '', isHallway: i > 0 && i < 4, floorName: p.floorId, elevator: i === 2 || i === 3 }));

describe('guidance', () => {
  it('measures the route, not counting the ride between floors', () => {
    const { cum, total } = measureRoute(path, P);
    expect(cum).toEqual([0, 10, 18, 18, 23]);
    expect(total).toBe(23);
  });

  it('finds the point a given distance along, switching floors with the route', () => {
    const { cum } = measureRoute(path, P);
    expect(pointAlong(path, cum, 5)).toMatchObject({ x: 5 * P, y: 0, floorId: 'f0' });
    expect(pointAlong(path, cum, 14)).toMatchObject({ x: 10 * P, y: 4 * P });
    expect(pointAlong(path, cum, 20)).toMatchObject({ x: 12 * P, floorId: 'f1' });
    expect(pointAlong(path, cum, 99)).toEqual(path[4]);
  });

  it('snaps a GPS position onto the route and says how far off it is', () => {
    const { cum } = measureRoute(path, P);
    const r = projectOntoRoute(path, cum, { x: 6 * P, y: 2 * P, floorId: 'f0' }, P);
    expect(r.along).toBeCloseTo(6);
    expect(r.offRouteM).toBeCloseTo(2);
    expect(projectOntoRoute(path, cum, { x: 12 * P, y: 9 * P, floorId: 'f1' }, P).along).toBeCloseTo(20);
  });

  it('moves through the instructions as the visitor walks', () => {
    const { cum } = measureRoute(path, P);
    const steps = directions(nodes, P, 'Gallery').steps;
    const now = (along: number) => steps[currentStepIndex(steps, cum, along)].text;
    expect(now(0)).toBe('Start at your location');
    expect(now(4)).toBe('Walk 10 m');
    expect(now(9.5)).toBe('Turn right');
    expect(now(12)).toBe('Walk 8 m');
    expect(now(17.5)).toMatch(/^Take the elevator up/);
    expect(now(23)).toBe('Arrive at Gallery');
  });
});
