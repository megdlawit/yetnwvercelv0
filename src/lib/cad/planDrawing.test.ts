import { describe, expect, it } from 'vitest';
import type { DxfEntity } from '../dxf/parseDxf';
import { buildVenue } from './buildVenue';
import type { CadDrawing, LayerMapping } from './types';
import { drawingBounds, layerPath, planDrawing, wallFills } from './planDrawing';

const m = 40;
const seg = (x1: number, y1: number, x2: number, y2: number) => [{ x: x1 * m, y: y1 * m }, { x: x2 * m, y: y2 * m }] as [{ x: number; y: number }, { x: number; y: number }];

function drawing(entities: DxfEntity[]): CadDrawing {
  const xs = entities.flatMap(e => (e.kind === 'LINE' ? [e.a.x, e.b.x] : e.kind === 'POLYLINE' ? e.pts.map(p => p.x) : 'center' in e ? [e.center.x] : []));
  const ys = entities.flatMap(e => (e.kind === 'LINE' ? [e.a.y, e.b.y] : e.kind === 'POLYLINE' ? e.pts.map(p => p.y) : 'center' in e ? [e.center.y] : []));
  return {
    entities, layers: [...new Set(entities.map(e => e.layer))], insunits: 6,
    bounds: { minX: Math.min(...xs), minY: Math.min(...ys), maxX: Math.max(...xs), maxY: Math.max(...ys) },
    format: 'dxf', unitsPerMeter: 1, unitsName: 'metres', flipY: false, notes: [],
  };
}
const line = (layer: string, x1: number, y1: number, x2: number, y2: number): DxfEntity => ({ kind: 'LINE', layer, a: { x: x1, y: y1 }, b: { x: x2, y: y2 } });

describe('the floor drawing kept for visitors', () => {
  it('keeps each kind on its layer and leaves out dimensions, grids and notes', () => {
    const d = drawing([
      line('A-WALL', 0, 0, 10, 0), line('A-WALL', 0, 0.2, 10, 0.2),
      line('A-FURN', 2, 2, 3, 2), line('A-DIMS', 0, -1, 10, -1), line('GRID', 5, -5, 5, 5),
      { kind: 'TEXT', layer: 'A-WALL', pos: { x: 1, y: 1 }, text: 'NOTE' },
    ]);
    const mapping: LayerMapping = { 'A-WALL': 'walls', 'A-FURN': 'furniture', 'A-DIMS': 'ignore', GRID: 'ignore' };
    const dr = planDrawing(d, l => mapping[l] ?? 'ignore', p => ({ x: (p.x - d.bounds!.minX) * m, y: (p.y - d.bounds!.minY) * m }), { pxPerMeter: m, unitsPerMeter: 1 });
    expect(Object.keys(dr.layers).sort()).toEqual(['furniture', 'poche', 'walls']);
    expect(dr.layers.walls).toHaveLength(2);
    // the two faces of the wall are filled between
    expect(dr.layers.poche).toHaveLength(1);
    const b = drawingBounds(dr)!;
    expect(b.maxX - b.minX).toBe(400);
  });

  it('is drawn with door swings on the doors layer even when they sit on the wall layer', () => {
    const d = drawing([
      line('A-WALL', 0, 0, 4, 0), line('A-WALL', 5, 0, 9, 0), line('A-WALL', 0, 0.2, 4, 0.2), line('A-WALL', 5, 0.2, 9, 0.2),
      { kind: 'ARC', layer: 'A-WALL', center: { x: 4, y: 0.2 }, radius: 0.9, startDeg: 0, endDeg: 90 },
      line('A-WALL', 4, 0.2, 4, 1.1),
    ]);
    const v = buildVenue(d, { 'A-WALL': 'walls' }, { unitsPerMeter: 1, pxPerMeter: m, flipY: false, fix: { gaps: false, overlaps: false, rooms: false, floating: false } });
    expect(v.drawing?.layers.doors?.length).toBeGreaterThanOrEqual(1);
    expect(layerPath(v.drawing!.layers.doors)).toMatch(/^M/);
  });

  it('drops furniture first when a drawing is too big', () => {
    const d = drawing([line('W', 0, 0, 10, 0), ...Array.from({ length: 50 }, (_, i) => line('F', i * 0.5, 2, i * 0.5 + 0.3, 2.3))]);
    const dr = planDrawing(d, l => (l === 'W' ? 'walls' : 'furniture'), p => ({ x: p.x * m, y: p.y * m }), { pxPerMeter: m, unitsPerMeter: 1, maxPoints: 20 });
    expect(dr.layers.walls).toHaveLength(1);
    expect(dr.layers.furniture!.length).toBeLessThan(50);
    expect(dr.truncated).toBe(true);
  });
});

describe('solid walls between two drawn faces', () => {
  it('fills a wall drawn as two lines, also where one face is broken by a doorway', () => {
    const quads = wallFills([seg(0, 0, 10, 0), seg(0, 0.2, 4, 0.2), seg(5, 0.2, 10, 0.2)], m);
    expect(quads).toHaveLength(2);
  });

  it('leaves stair treads and lines too far apart hollow', () => {
    const treads = Array.from({ length: 8 }, (_, i) => seg(0, i * 0.28, 1.2, i * 0.28));
    expect(wallFills(treads, m)).toHaveLength(0);
    expect(wallFills([seg(0, 0, 10, 0), seg(0, 1, 10, 1)], m)).toHaveLength(0);
  });
});
