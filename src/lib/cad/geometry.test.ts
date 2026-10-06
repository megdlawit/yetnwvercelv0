import { describe, expect, it } from 'vitest';
import {
  splitAt, trimAt, extendTo, offsetSeg, joinSegs, mergeCollinear, closeGaps, countGaps, countOverlaps,
  polygonArea, polygonCentroid, chainLoops, sliceMesh, rotatePt,
} from './geometry';

const S = (x1: number, y1: number, x2: number, y2: number) => ({ x1, y1, x2, y2 });

describe('modify tools', () => {
  it('splits a wall at the clicked point', () => {
    expect(splitAt(S(0, 0, 100, 0), { x: 40, y: 3 })).toEqual([S(0, 0, 40, 0), S(40, 0, 100, 0)]);
    expect(splitAt(S(0, 0, 100, 0), { x: 0.2, y: 0 })).toBeNull(); // at the end: nothing to split
  });

  it('trims the piece between the crossings around the click', () => {
    const wall = S(0, 0, 100, 0);
    const cutters = [S(30, -10, 30, 10), S(70, -10, 70, 10)];
    expect(trimAt(wall, { x: 50, y: 0 }, cutters)).toEqual([S(0, 0, 30, 0), S(70, 0, 100, 0)]);
    expect(trimAt(wall, { x: 10, y: 0 }, cutters)).toEqual([S(30, 0, 100, 0)]);
    expect(trimAt(wall, { x: 10, y: 0 }, [])).toBeNull();
  });

  it('extends the nearer end to the next wall', () => {
    const wall = S(0, 0, 50, 0);
    expect(extendTo(wall, { x: 48, y: 0 }, [S(80, -10, 80, 10), S(120, -10, 120, 10)])).toEqual(S(0, 0, 80, 0));
    expect(extendTo(wall, { x: 2, y: 0 }, [S(80, -10, 80, 10)])).toBeNull(); // nothing to the left
  });

  it('offsets parallel and joins collinear walls', () => {
    expect(offsetSeg(S(0, 0, 10, 0), 5)).toEqual(S(0, 5, 10, 5));
    expect(joinSegs(S(0, 0, 10, 0), S(10, 0, 25, 0))).toEqual(S(0, 0, 25, 0));
    expect(joinSegs(S(0, 0, 10, 0), S(0, 0, 0, 10))).toBeNull();
  });

  it('rotates around a centre', () => {
    const p = rotatePt({ x: 10, y: 0 }, { x: 0, y: 0 }, 90);
    expect(p.x).toBeCloseTo(0); expect(p.y).toBeCloseTo(10);
  });
});

describe('cleanup', () => {
  it('merges collinear pieces (sliced models, double-drawn walls)', () => {
    const r = mergeCollinear([S(0, 0, 10, 0), S(10, 0, 20, 0), S(15, 0, 30, 0), S(0, 0, 0, 10)]);
    expect(r.segs).toHaveLength(2);
    expect(r.merged).toBe(2);
  });

  it('finds and closes small gaps, including T-junctions', () => {
    const walls = [S(0, 0, 100, 0), S(100.4, 0.3, 100, 80), S(50, 0.4, 50, 60)];
    expect(countGaps(walls, 1)).toBe(3); // both sides of the corner gap, plus the T
    const fixed = closeGaps(walls, 1);
    expect(fixed.fixed).toBe(2);
    expect(countGaps(fixed.segs, 1)).toBe(0);
  });

  it('counts overlapping walls', () => {
    expect(countOverlaps([S(0, 0, 50, 0), S(40, 0, 90, 0), S(0, 10, 50, 10)])).toBe(1);
  });
});

describe('polygons and slicing', () => {
  const square = [{ x: 0, y: 0 }, { x: 10, y: 0 }, { x: 10, y: 10 }, { x: 0, y: 10 }];
  it('area and centroid', () => {
    expect(polygonArea(square)).toBe(100);
    expect(polygonCentroid(square)).toEqual({ x: 5, y: 5 });
  });

  it('chains loose segments into a closed loop', () => {
    const loops = chainLoops([S(0, 0, 10, 0), S(10, 10, 10, 0), S(10, 10, 0, 10), S(0, 10, 0, 0)]);
    expect(loops).toHaveLength(1);
    expect(polygonArea(loops[0])).toBeCloseTo(100);
  });

  it('slices a vertical wall mesh into its plan outline', () => {
    // a 4m x 0.2m x 3m box (one wall), as 12 triangles
    const [x0, x1, z0, z1, y0, y1] = [0, 4, 0, 0.2, 0, 3];
    const c = [[x0, y0, z0], [x1, y0, z0], [x1, y1, z0], [x0, y1, z0], [x0, y0, z1], [x1, y0, z1], [x1, y1, z1], [x0, y1, z1]];
    const faces = [[0, 1, 2], [0, 2, 3], [4, 6, 5], [4, 7, 6], [0, 3, 7], [0, 7, 4], [1, 5, 6], [1, 6, 2], [3, 2, 6], [3, 6, 7], [0, 4, 5], [0, 5, 1]];
    const positions = c.flat();
    const segs = sliceMesh(positions, faces.flat(), 1.0);
    const merged = mergeCollinear(segs, 0.005, 0.005).segs;
    expect(merged).toHaveLength(4); // the rectangle around the wall's footprint
    const loops = chainLoops(merged, 0.01);
    expect(polygonArea(loops[0])).toBeCloseTo(0.8);
  });
});
