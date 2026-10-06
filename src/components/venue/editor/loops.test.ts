import { describe, expect, it } from 'vitest';
import { closedLoop } from './loops';

describe('closedLoop', () => {
  const box = [
    { x1: 0, y1: 0, x2: 100, y2: 0 },
    { x1: 100, y1: 0, x2: 100, y2: 80 },
    { x1: 100, y1: 80, x2: 0, y2: 80 },
  ];

  it('finds the room a closing wall makes', () => {
    const ring = closedLoop(box, { x: 0, y: 80 }, { x: 1, y: 1 })!;
    expect(ring).toHaveLength(4);
    expect(ring[0]).toEqual({ x: 0, y: 80 });
  });

  it('is null for a wall that closes nothing', () => {
    expect(closedLoop(box, { x: 200, y: 0 }, { x: 300, y: 0 })).toBeNull();
    expect(closedLoop(box.slice(0, 2), { x: 100, y: 80 }, { x: 50, y: 120 })).toBeNull();
  });

  it('takes the smaller of two loops', () => {
    const two = [...box, { x1: 50, y1: 0, x2: 50, y2: 80 }];
    const ring = closedLoop(two, { x: 0, y: 80 }, { x: 0, y: 0 })!;
    expect(ring.length).toBe(4); // through the middle wall, not round the outside
  });
});
