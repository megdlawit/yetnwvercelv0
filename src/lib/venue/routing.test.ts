import { describe, expect, it } from 'vitest';
import { findRoute, directions, type RouteNode } from './routing';

const P = 40;
const n = (id: string, x: number, y: number, level = 0, extra: Partial<RouteNode> = {}): RouteNode =>
  ({ id, floorId: `f${level}`, name: id, x: x * P, y: y * P, isHallway: false, floorLevel: level, floorName: `Floor ${level}`, ...extra });
const e = (a: string, b: string) => ({ id: `${a}-${b}`, fromNodeId: a, toNodeId: b, weight: 0 });

// Lobby → corridor → (stairs | lift) → upstairs gallery, plus a café round the corner.
const nodes = [
  n('Lobby', 0, 0), n('C1', 10, 0, 0, { isHallway: true, name: '' }), n('Café', 10, 8),
  n('Stairs G', 12, 0, 0, { stairs: true }), n('Stairs 1', 12, 0, 1, { stairs: true }),
  n('Lift G', 0, 6, 0, { elevator: true }), n('Lift 1', 0, 6, 1, { elevator: true }),
  n('Gallery', 20, 0, 1),
];
const edges = [
  e('Lobby', 'C1'), e('C1', 'Café'), e('C1', 'Stairs G'), e('Stairs G', 'Stairs 1'), e('Stairs 1', 'Gallery'),
  e('Lobby', 'Lift G'), e('Lift G', 'Lift 1'), e('Lift 1', 'Gallery'),
];

describe('routing', () => {
  it('finds the shortest route, across floors', () => {
    const r = findRoute(nodes, edges, 'Lobby', 'Gallery', { pxPerMeter: P })!;
    expect(r.map(x => x.id)).toEqual(['Lobby', 'C1', 'Stairs G', 'Stairs 1', 'Gallery']);
  });

  it('avoids stairs when step-free is asked for', () => {
    const r = findRoute(nodes, edges, 'Lobby', 'Gallery', { pxPerMeter: P, stepFree: true })!;
    expect(r.map(x => x.id)).toEqual(['Lobby', 'Lift G', 'Lift 1', 'Gallery']);
  });

  it('returns null when there is no way there', () => {
    expect(findRoute([...nodes, n('Island', 50, 50)], edges, 'Lobby', 'Island', { pxPerMeter: P })).toBeNull();
  });
});

describe('directions', () => {
  it('calls out turns, floor changes, distance and time', () => {
    const r = findRoute(nodes, edges, 'Lobby', 'Café', { pxPerMeter: P })!;
    const d = directions(r, P, 'Café');
    expect(d.steps.map(s => s.text)).toEqual(['Start at Lobby', 'Walk 10 m', 'Turn right', 'Walk 8 m', 'Arrive at Café']);
    expect(d.metres).toBeCloseTo(18);
    expect(d.minutes).toBe(1);

    const up = directions(findRoute(nodes, edges, 'Lobby', 'Gallery', { pxPerMeter: P, stepFree: true })!, P, 'Gallery');
    expect(up.steps.some(s => s.text === 'Take the elevator up to Floor 1')).toBe(true);
  });
});

describe('accessibility weighting and guidance positions', () => {
  // Two equal ways round a block: north (unknown surface) and south (a recorded ramp/level path).
  const ring = [n('A', 0, 0), n('N', 5, -4, 0, { isHallway: true }), n('S', 5, 4, 0, { isHallway: true }), n('B', 10, 0)];
  const ringEdges = [e('A', 'N'), e('N', 'B'), { ...e('A', 'S'), accessible: true }, { ...e('S', 'B'), accessible: true }];

  it('prefers paths recorded as accessible on step-free routes', () => {
    expect(findRoute(ring, ringEdges, 'A', 'B', { pxPerMeter: P, stepFree: true, preferAccessible: true })!.map(x => x.id)).toEqual(['A', 'S', 'B']);
  });

  it('steers around penalised places without forbidding them', () => {
    expect(findRoute(ring, ringEdges, 'A', 'B', { pxPerMeter: P, penalties: { S: 50 } })!.map(x => x.id)).toEqual(['A', 'N', 'B']);
    expect(findRoute(ring, ringEdges, 'A', 'S', { pxPerMeter: P, penalties: { S: 50 } })!.map(x => x.id)).toEqual(['A', 'S']);
  });

  it('records where on the route each step ends', () => {
    const r = findRoute(nodes, edges, 'Lobby', 'Café', { pxPerMeter: P })!;
    expect(directions(r, P, 'Café').steps.map(s => [s.icon, s.pathIndex])).toEqual([['start', 0], ['straight', 1], ['right', 1], ['straight', 2], ['arrive', 2]]);
  });
});
