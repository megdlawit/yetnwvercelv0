import { describe, expect, it } from 'vitest';
import { fromPlan } from './normalize';
import { locateOnPath, pathFromNodes, pathFromPoints, pointAt } from './path3d';
import { ribbonGeometry } from './render/route';
import { testVenueRows } from './testVenue';

const venue = fromPlan(testVenueRows(), { wallHeight: 3 });
const route = pathFromNodes(venue, ['c', 'h1', 'h2', 's0', 's1', 'g']);

describe('pathFromNodes', () => {
  it('walks to the stairs, climbs them, and steps off upstairs', () => {
    expect(route.pieces.map(p => `${p.kind}@${p.floorId}`)).toEqual(['door@f0', 'walk@f0', 'stairs@f0', 'walk@f1']);
    const climb = route.pieces[2].points;
    expect(climb[0]).toMatchObject({ y: 0 });
    expect(climb[climb.length - 1]).toMatchObject({ y: 3.5 });
    // On at the bottom step (x 14.5), off at the top (x 17.5).
    expect(climb[0].x).toBeCloseTo(14.5);
    expect(climb[climb.length - 1].x).toBeCloseTo(17.5);
  });

  it('measures the whole line, the climb along its slope', () => {
    const flat = Math.hypot(5, 0) + 6 + 1 + 0.5; // café→h1, h1→h2, h2→s0, s0→bottom step
    expect(route.length).toBeGreaterThan(flat + 3.5);
    expect(route.samples[route.samples.length - 1].s).toBeCloseTo(route.length);
  });

  it('switches floor half way up the stairs, not before', () => {
    const start = route.samples.find(x => x.kind === 'stairs')!;
    const i = route.samples.indexOf(start);
    const bottom = route.samples[i - 1].s, top = route.samples[route.samples.length - 2].s;
    expect(pointAt(route, bottom + 0.3).floorId).toBe('f0');
    expect(pointAt(route, (bottom + top) / 2 + 0.6).floorId).toBe('f1');
    expect(pointAt(route, route.length - 0.5).floorId).toBe('f1');
    expect(pointAt(route, bottom + 0.3).kind).toBe('stairs');
  });

  it('finds where a visitor is along the line, and how far off it', () => {
    const at = pointAt(route, 8);
    const found = locateOnPath(route, { x: at.p.x, z: at.p.z + 0.5 }, 'f0');
    expect(found.s).toBeCloseTo(8, 1);
    expect(found.off).toBeCloseTo(0.5, 2);
  });

  it('rides a lift straight up, and the ribbon breaks there', () => {
    const lift = pathFromNodes(venue, ['lift0', 'lift1', 'u1']);
    expect(lift.pieces.map(p => p.kind)).toEqual(['walk', 'elevator', 'walk']);
    const g = ribbonGeometry(lift, 0.9);
    // Two strips (before and after the shaft), each a quad per segment.
    expect(g.index!.count % 6).toBe(0);
    expect(g.getAttribute('position').count).toBeGreaterThan(0);
  });
});

describe('pathFromPoints', () => {
  it('makes a one-floor line from plain points', () => {
    const p = pathFromPoints([{ x: 0, z: 0 }, { x: 3, z: 4 }, { x: 3, z: 4 }], 'f', 2);
    expect(p.length).toBe(5);
    expect(p.samples).toHaveLength(2);
    expect(p.samples[1].p.y).toBe(2);
  });
});
