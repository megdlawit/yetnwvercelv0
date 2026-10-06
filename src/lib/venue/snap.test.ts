import { describe, expect, it } from 'vitest';
import { snapPoint } from './snap';

const walls = [{ x1: 0, y1: 0, x2: 100, y2: 0 }, { x1: 100, y1: 0, x2: 100, y2: 100 }];
const nodes = [{ id: 'a', x: 50, y: 50 }];
const opt = { tolerance: 8 };

describe('snapPoint', () => {
  it('prefers an existing node over everything else', () => {
    expect(snapPoint({ x: 53, y: 48 }, { walls, nodes }, opt)).toEqual({ x: 50, y: 50, kind: 'node' });
  });

  it('never snaps a dragged node to itself', () => {
    expect(snapPoint({ x: 53, y: 48 }, { walls, nodes, excludeNodeId: 'a' }, opt).kind).toBeNull();
  });

  it('snaps to a wall corner, then midpoint, then along the wall', () => {
    expect(snapPoint({ x: 97, y: 4 }, { walls, nodes: [] }, opt)).toMatchObject({ x: 100, y: 0, kind: 'endpoint' });
    expect(snapPoint({ x: 47, y: 3 }, { walls, nodes: [] }, opt)).toMatchObject({ x: 50, y: 0, kind: 'midpoint' });
    expect(snapPoint({ x: 30, y: 5 }, { walls, nodes: [] }, opt)).toMatchObject({ x: 30, y: 0, kind: 'wall' });
  });

  it('falls back to the grid, or the raw point with no grid', () => {
    expect(snapPoint({ x: 33, y: 61 }, { walls, nodes: [] }, { ...opt, grid: 20 })).toEqual({ x: 40, y: 60, kind: 'grid' });
    expect(snapPoint({ x: 33, y: 61 }, { walls, nodes: [] }, opt)).toEqual({ x: 33, y: 61, kind: null });
  });
});
