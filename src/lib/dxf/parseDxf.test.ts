import { describe, it, expect } from 'vitest';
import { parseDxf, diagnoseDxf, unitsFromInsunits } from './parseDxf';
import { decodeTextSmart } from './readTextSmart';
import { dxfToVenue } from './dxfToVenue';
import { generatePathGraph } from './generatePathGraph';

const pair = (c: number | string, v: string | number) => `${c}\n${v}\n`;
const line = (layer: string, x1: number, y1: number, x2: number, y2: number) =>
  pair(0, 'LINE') + pair(8, layer) + pair(10, x1) + pair(20, y1) + pair(30, 0) + pair(11, x2) + pair(21, y2) + pair(31, 0);
const lwpoly = (layer: string, pts: [number, number][], closed: boolean) =>
  pair(0, 'LWPOLYLINE') + pair(8, layer) + pair(90, pts.length) + pair(70, closed ? 1 : 0) +
  pts.map(([x, y]) => pair(10, x) + pair(20, y)).join('');
const text = (layer: string, x: number, y: number, t: string) =>
  pair(0, 'TEXT') + pair(8, layer) + pair(10, x) + pair(20, y) + pair(40, 200) + pair(1, t);
const wrap = (entities: string, blocks = '') =>
  pair(0, 'SECTION') + pair(2, 'HEADER') + pair(9, '$ACADVER') + pair(1, 'AC1015') + pair(0, 'ENDSEC') +
  (blocks ? pair(0, 'SECTION') + pair(2, 'BLOCKS') + blocks + pair(0, 'ENDSEC') : '') +
  pair(0, 'SECTION') + pair(2, 'ENTITIES') + entities + pair(0, 'ENDSEC') + pair(0, 'EOF');

// 10m x 6m building in mm, one room on the left with a doorway onto a corridor.
const plan = () => wrap(
  line('WALL', 0, 0, 10000, 0) + line('WALL', 10000, 0, 10000, 6000) +
  line('WALL', 10000, 6000, 0, 6000) + line('WALL', 0, 6000, 0, 0) +
  line('WALL', 0, 3000, 3500, 3000) + line('WALL', 4500, 3000, 10000, 3000) +
  lwpoly('ROOM', [[0, 3000], [10000, 3000], [10000, 6000], [0, 6000]], true) +
  text('TEXT', 5000, 4500, 'Hall A'),
);

const toBytes = (s: string, enc: 'utf8' | 'utf16le' | 'utf16be', bom: boolean) => {
  if (enc === 'utf8') return new Uint8Array([...(bom ? [0xEF, 0xBB, 0xBF] : []), ...new TextEncoder().encode(s)]);
  const out: number[] = bom ? (enc === 'utf16le' ? [0xFF, 0xFE] : [0xFE, 0xFF]) : [];
  for (const ch of s) {
    const c = ch.charCodeAt(0);
    out.push(...(enc === 'utf16le' ? [c & 0xFF, c >> 8] : [c >> 8, c & 0xFF]));
  }
  return new Uint8Array(out);
};

describe('DXF parsing across real-world encodings', () => {
  const cases: [string, Uint8Array][] = [
    ['utf-8', toBytes(plan(), 'utf8', false)],
    ['utf-8 + BOM', toBytes(plan(), 'utf8', true)],
    ['CRLF', toBytes(plan().replace(/\n/g, '\r\n'), 'utf8', false)],
    ['bare CR (old Mac)', toBytes(plan().replace(/\n/g, '\r'), 'utf8', false)],
    ['utf-16le + BOM', toBytes(plan(), 'utf16le', true)],
    ['utf-16le no BOM', toBytes(plan(), 'utf16le', false)],
    ['utf-16be no BOM', toBytes(plan(), 'utf16be', false)],
  ];
  it.each(cases)('parses %s', (_n, bytes) => {
    const parsed = parseDxf(decodeTextSmart(bytes));
    expect(parsed.entities.length).toBe(8);
    expect(parsed.layers).toEqual(['ROOM', 'TEXT', 'WALL']);
  });

  it('old-style POLYLINE+VERTEX still works', () => {
    const v = (x: number, y: number) => pair(0, 'VERTEX') + pair(8, 'ROOM') + pair(10, x) + pair(20, y);
    const t = wrap(pair(0, 'POLYLINE') + pair(8, 'ROOM') + pair(66, 1) + pair(70, 1) + v(0, 0) + v(1000, 0) + v(1000, 1000) + v(0, 1000) + pair(0, 'SEQEND'));
    const p = parseDxf(t);
    expect(p.entities).toHaveLength(1);
    expect(p.entities[0].kind === 'POLYLINE' && p.entities[0].pts.length).toBe(4);
  });
});

describe('units and cleanup', () => {
  it('reads $INSUNITS from the header', () => {
    const withUnits = (code: number) => plan().replace(pair(1, 'AC1015'), pair(1, 'AC1015') + pair(9, '$INSUNITS') + pair(70, code));
    expect(parseDxf(withUnits(6)).insunits).toBe(6);
    expect(unitsFromInsunits(parseDxf(withUnits(4)).insunits)).toEqual({ perMeter: 1000, name: 'millimetres' });
    expect(parseDxf(plan()).insunits).toBeNull();
    expect(unitsFromInsunits(0)).toBeNull(); // "unitless" isn't a unit
  });

  it('drops duplicate and zero-length wall segments and reports them', () => {
    const dxf = wrap(
      line('WALL', 0, 0, 5000, 0) + line('WALL', 5000, 0, 0, 0) + // same wall drawn backwards
      line('WALL', 0, 0, 5000, 0) +                                 // and again
      line('WALL', 100, 100, 100, 100) +                            // zero length
      line('WALL', 0, 0, 0, 5000),
    );
    const venue = dxfToVenue(parseDxf(dxf), { wallLayers: ['WALL'], roomLayer: null, doorLayer: null, textLayers: null, unitsPerMeter: 1000, pxPerMeter: 40, flipY: true });
    expect(venue.walls).toHaveLength(2);
    expect(venue.cleanup).toEqual({ duplicateWalls: 2, tinyWalls: 1 });
    expect(venue.mapping.walls).toEqual(['WALL']);
  });
});

describe('layer names that do not match the import dialog', () => {
  const opts = { wallLayers: ['WALL', 'WALLS', 'A-WALL'], roomLayer: 'ROOM', doorLayer: null, textLayers: null, unitsPerMeter: 1000, pxPerMeter: 40, flipY: true };
  const renamed = (wall: string, room: string) => plan()
    .replace(/\n8\nWALL\n/g, `\n8\n${wall}\n`).replace(/\n8\nROOM\n/g, `\n8\n${room}\n`);

  it('uses similarly named layers (A-WALL-EXTR, ROOMS-OUTLINE)', () => {
    const venue = dxfToVenue(parseDxf(renamed('A-WALL-EXTR', 'ROOMS-OUTLINE')), opts);
    expect(venue.walls.length).toBe(6);
    expect(venue.rooms).toHaveLength(1);
    expect(venue.warnings.join(' ')).toMatch(/A-WALL-EXTR/);
  });

  it('falls back to the layer with the most lines when nothing is named like a wall', () => {
    const venue = dxfToVenue(parseDxf(renamed('0', 'ROOM')), opts);
    expect(venue.walls.length).toBe(6);
    expect(venue.warnings.join(' ')).toMatch(/most line geometry/);
    expect(generatePathGraph(venue.walls, venue.rooms, {}).nodes.length).toBeGreaterThan(1);
  });

  it('stays silent when the names match exactly', () => {
    const venue = dxfToVenue(parseDxf(plan()), opts);
    expect(venue.warnings.some(w => /instead|most line geometry/.test(w))).toBe(false);
  });
});

describe('end-to-end: DXF → venue → routable graph', () => {
  it('produces walls, a labelled room and a connected graph', () => {
    const parsed = parseDxf(plan());
    const venue = dxfToVenue(parsed, { wallLayers: ['WALL'], roomLayer: 'ROOM', doorLayer: null, textLayers: null, unitsPerMeter: 1000, pxPerMeter: 40, flipY: true });
    expect(venue.walls.length).toBe(6);
    expect(venue.rooms).toHaveLength(1);
    expect(venue.rooms[0].name).toBe('Hall A');
    // Flipped Y must still land in the positive quadrant the editor shows.
    const ys = venue.walls.flatMap(w => [w.y1, w.y2]);
    expect(Math.min(...ys)).toBe(0);
    expect(Math.max(...ys)).toBe(240); // 6 m × 40 px/m
    expect(venue.rooms[0].y).toBe(0); // the room is the top half of the plan
    const g = generatePathGraph(venue.walls, venue.rooms, {});
    expect(g.nodes.length).toBeGreaterThan(1);
    expect(g.edges.length).toBeGreaterThan(0);
  });
});

describe('diagnoseDxf explains empty imports', () => {
  it('empty ENTITIES but geometry in BLOCKS → says explode', () => {
    const blk = pair(0, 'BLOCK') + pair(2, 'PLAN') + line('WALL', 0, 0, 1, 1) + pair(0, 'ENDBLK');
    const d = diagnoseDxf(wrap('', blk));
    expect(d.hints.join(' ')).toMatch(/EXPLODE|BLOCKS/);
  });
  it('only unsupported types → lists them', () => {
    const d = diagnoseDxf(wrap(pair(0, 'SPLINE') + pair(8, 'WALL') + pair(0, 'HATCH') + pair(8, 'WALL')));
    expect(d.unsupported.sort()).toEqual(['HATCH', 'SPLINE']);
    expect(d.hints[0]).toMatch(/SPLINE/);
  });
  it('binary DXF / DWG / NUL-garbage are recognised', () => {
    expect(diagnoseDxf('AutoCAD Binary DXF\r\n\x1a\x00').format).toBe('binary-dxf');
    expect(diagnoseDxf('AC1032\x00\x00\x00').format).toBe('dwg');
    expect(diagnoseDxf('\u0000 \u0000 \u0000 \u0000 \u0000 \u0000 \u0000 \u0000 ').format).toBe('not-dxf');
  });
});
