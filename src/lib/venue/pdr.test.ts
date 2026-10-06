import { describe, expect, it } from 'vitest';
import { planAngleDeg, snapToPaths, stepForward } from './pdr';
import { bearingDeg, haversineMeters, indoorToGeo } from '@/lib/geo/GeoMath';

const P = 40;

describe('step forward', () => {
  it('on a north-up plan, facing north moves up the screen and east moves right', () => {
    const n = stepForward({ x: 0, y: 0 }, 0, 0.7, P);
    expect(n.x).toBeCloseTo(0); expect(n.y).toBeCloseTo(-28);
    const e = stepForward({ x: 0, y: 0 }, 90, 0.7, P);
    expect(e.x).toBeCloseTo(28); expect(e.y).toBeCloseTo(0);
  });

  it('agrees with the real world for a turned plan: walking at compass bearing H lands at bearing H', () => {
    for (const rotation of [0, 20, 135, 270]) {
      const anchor = { originLat: 9.03, originLng: 38.76, rotationDeg: rotation, metersPerPixel: 1 / P };
      for (const heading of [0, 45, 90, 200, 330]) {
        const from = { x: 300, y: 200 };
        const to = stepForward(from, heading, 10, P, rotation);
        const a = indoorToGeo(anchor, from.x, from.y), b = indoorToGeo(anchor, to.x, to.y);
        expect(haversineMeters(a, b)).toBeCloseTo(10, 1);
        expect(Math.abs(((bearingDeg(a, b) - heading + 540) % 360) - 180)).toBeLessThan(0.5);
      }
    }
  });

  it('draws the heading as a screen angle', () => {
    expect(planAngleDeg(90)).toBeCloseTo(0);   // east → +x
    expect(planAngleDeg(180)).toBeCloseTo(90); // south → down
  });
});

describe('snap to paths', () => {
  const corridor = [{ a: { x: 0, y: 0 }, b: { x: 400, y: 0 } }];
  it('pulls a drifting position back onto a nearby path', () => {
    expect(snapToPaths({ x: 100, y: 30 }, corridor, 80)).toEqual({ x: 100, y: 0 });
  });
  it('leaves it alone when no path is close (open ground)', () => {
    expect(snapToPaths({ x: 100, y: 300 }, corridor, 80)).toEqual({ x: 100, y: 300 });
  });
});
