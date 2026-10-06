import { describe, expect, it } from 'vitest';
import { followRoute, pointAlong, projectAlong, strideFromCadence } from './pdr';

const M = 40; // px per metre
// An L-shaped route: 10 m east, then 6 m south.
const route = [{ x: 0, y: 0 }, { x: 10 * M, y: 0 }, { x: 10 * M, y: 6 * M }];
const dirOf = (deg: number) => ({ x: Math.cos((deg * Math.PI) / 180), y: Math.sin((deg * Math.PI) / 180) }); // plan angle, y down
const stride = 0.7 * M, corner = 3 * M;

describe('followRoute', () => {
  it('moves exactly one stride along the route even when the compass is 40° off', () => {
    let s = 0;
    for (let i = 0; i < 10; i++) s = followRoute(route, s, dirOf(i % 2 ? 40 : -40), stride, corner).s;
    expect(s / M).toBeCloseTo(7, 5);              // 10 steps × 0.7 m — not 10 × 0.7 × cos 40° (5.4 m)
    expect(pointAlong(route, s)).toEqual({ x: 7 * M, y: 0 });
  });

  it('continues round the corner when the person turns near it', () => {
    // 2.1 m short of the corner, the person turns south: on round the corner.
    const r = followRoute(route, 7.9 * M, dirOf(90), stride, corner);
    expect(r.onRoute).toBe(true);
    expect(r.s / M).toBeCloseTo(10.7, 5);
    expect(pointAlong(route, r.s)).toEqual({ x: 10 * M, y: 0.7 * M });
  });

  it('does not cut the corner when the turn comes too early', () => {
    const r = followRoute(route, 4 * M, dirOf(90), stride, corner);
    expect(r.onRoute).toBe(false); // 6 m before the corner: that's leaving the route
  });

  it('walks back along the route', () => {
    const r = followRoute(route, 5 * M, dirOf(180), stride, corner);
    expect(r).toEqual({ s: 5 * M - stride, onRoute: true });
  });

  it('stops at the destination', () => {
    expect(followRoute(route, 15.9 * M, dirOf(90), stride, corner).s).toBe(16 * M);
  });
});

describe('projectAlong', () => {
  it('finds how far along the route a nearby point is', () => {
    const p = projectAlong(route, { x: 10.3 * M, y: 2 * M });
    expect(p.s / M).toBeCloseTo(12, 5);
    expect(p.dist / M).toBeCloseTo(0.3, 5);
  });
});

describe('strideFromCadence', () => {
  it('takes longer steps at a faster pace', () => {
    expect(strideFromCadence(null)).toBe(0.7);
    expect(strideFromCadence(1.6)).toBeCloseTo(0.65, 2);
    expect(strideFromCadence(1.9)).toBeCloseTo(0.725, 3);
    expect(strideFromCadence(2.2)).toBeCloseTo(0.8, 2);
    expect(strideFromCadence(5)).toBe(0.85);
  });
});
