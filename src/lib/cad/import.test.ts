import { describe, expect, it } from 'vitest';
import { readDxf } from './readers/dxf';
import { readSvg, flattenPath } from './readers/svg';
import { elementsToDrawing, boundsOf, decodeIfcString, doorSwings, storeysOf, topOutline, type Element } from './readers/model3d';
import { classifyLayers } from './classify';
import { buildVenue } from './buildVenue';
import { roomTypeFromName } from './commitVenue';
import type { LayerMapping } from './types';

const pair = (c: number | string, v: string | number) => `${c}\n${v}\n`;
const line = (layer: string, x1: number, y1: number, x2: number, y2: number) =>
  pair(0, 'LINE') + pair(8, layer) + pair(10, x1) + pair(20, y1) + pair(11, x2) + pair(21, y2);
const lwpoly = (layer: string, pts: [number, number][], closed: boolean) =>
  pair(0, 'LWPOLYLINE') + pair(8, layer) + pair(90, pts.length) + pair(70, closed ? 1 : 0) + pts.map(([x, y]) => pair(10, x) + pair(20, y)).join('');
const text = (layer: string, x: number, y: number, t: string) => pair(0, 'TEXT') + pair(8, layer) + pair(10, x) + pair(20, y) + pair(1, t);
const insert = (layer: string, block: string, x: number, y: number) => pair(0, 'INSERT') + pair(8, layer) + pair(2, block) + pair(10, x) + pair(20, y);
const arc = (layer: string, x: number, y: number, r: number, a0: number, a1: number) =>
  pair(0, 'ARC') + pair(8, layer) + pair(10, x) + pair(20, y) + pair(40, r) + pair(50, a0) + pair(51, a1);
const circle = (layer: string, x: number, y: number, r: number) => pair(0, 'CIRCLE') + pair(8, layer) + pair(10, x) + pair(20, y) + pair(40, r);
const dxf = (ents: string) => pair(0, 'SECTION') + pair(2, 'HEADER') + pair(9, '$INSUNITS') + pair(70, 4) + pair(0, 'ENDSEC')
  + pair(0, 'SECTION') + pair(2, 'ENTITIES') + ents + pair(0, 'ENDSEC') + pair(0, 'EOF');

// A 12 × 8 m pavilion in mm, AIA layer names, a near-miss corner and a few objects.
const pavilion = () => dxf(
  line('A-WALL-EXTR', 0, 0, 12000, 0) + line('A-WALL-EXTR', 12000, 0, 12000, 8000) +
  line('A-WALL-EXTR', 12000, 8000, 0, 8000) + line('A-WALL-EXTR', 0, 8000, 0, 100) + // 10 cm gap at the corner
  line('A-WALL-EXTR', 0, 0, 12000, 0) +                                               // drawn twice
  line('A-WALL-INTR', 6000, 0, 6000, 8000) +
  lwpoly('A-AREA', [[0, 0], [6000, 0], [6000, 8000], [0, 8000]], true) +
  lwpoly('A-AREA', [[6000, 0], [12000, 0], [12000, 8000], [6000, 8000], [6000, 150]], false) + // stops 15 cm short of closing
  text('A-AREA-IDEN', 3000, 4000, 'Museum') + text('A-AREA-IDEN', 9000, 4000, 'Café') +
  text('A-ANNO-TEXT', 6000, -500, 'Main entrance') +
  insert('A-DOOR', 'DOOR-900', 6000, 2000) + arc('A-DOOR', 3000, 0, 900, 0, 90) +
  line('A-FLOR-STRS', 10000, 6000, 11000, 6000) + line('A-FLOR-STRS', 10000, 6300, 11000, 6300) + line('A-FLOR-STRS', 10000, 6600, 11000, 6600) +
  insert('0', 'TREE-OAK', -3000, 4000) + circle('L-PLNT', 15000, 4000, 1500) +
  line('A-ANNO-DIMS', 0, -1000, 12000, -1000) +
  insert('A-FURN', 'BENCH-2', 3000, 6000),
);

describe('layer classification', () => {
  const layers = classifyLayers(readDxf(pavilion()));
  const sug = (n: string) => layers.find(l => l.name === n)!;

  it('recognises standard layer names with high confidence', () => {
    expect(sug('A-WALL-EXTR')).toMatchObject({ suggested: 'walls' });
    expect(sug('A-WALL-EXTR').confidence).toBeGreaterThan(0.9);
    expect(sug('A-DOOR').suggested).toBe('doors');
    expect(sug('A-AREA').suggested).toBe('rooms');
    expect(sug('A-AREA-IDEN').suggested).toBe('labels');   // named like rooms, holds only text
    expect(sug('A-FLOR-STRS').suggested).toBe('stairs');
    expect(sug('L-PLNT').suggested).toBe('trees');
    expect(sug('A-ANNO-DIMS').suggested).toBe('ignore');   // dimensions
    expect(sug('A-FURN').suggested).toBe('furniture');
  });

  it('uses block names when the layer name says nothing', () => {
    expect(sug('0')).toMatchObject({ suggested: 'trees', reason: expect.stringContaining('TREE-OAK') });
  });

  it('falls back to the busiest line layer for walls', () => {
    const d = readDxf(dxf(line('0', 0, 0, 1000, 0) + line('0', 1000, 0, 1000, 1000) + line('Layer 7', 0, 0, 10, 10)));
    expect(classifyLayers(d).find(l => l.name === '0')).toMatchObject({ suggested: 'walls', confidence: 0.55 });
  });
});

describe('building a venue', () => {
  const drawing = readDxf(pavilion());
  const mapping: LayerMapping = Object.fromEntries(classifyLayers(drawing).map(l => [l.name, l.suggested]));
  const opts = (fix: boolean) => ({ unitsPerMeter: drawing.unitsPerMeter!, pxPerMeter: 40, flipY: true, fix: { gaps: fix, overlaps: fix, rooms: fix, floating: fix } });

  it('reads units from the file', () => {
    expect(drawing.unitsPerMeter).toBe(1000);
  });

  it('reports problems without fixing them', () => {
    const v = buildVenue(drawing, mapping, opts(false));
    expect(v.health.duplicates).toBe(1);
    expect(v.health.gaps).toBeGreaterThan(0);
    expect(v.health.unclosedRooms).toBe(1);
    expect(v.rooms).toHaveLength(1);
  });

  it('fixes them when asked: closes the gap and the almost-closed room', () => {
    const v = buildVenue(drawing, mapping, opts(true));
    expect(v.health.gapsFixed).toBeGreaterThan(0);
    expect(v.health.roomsClosed).toBe(1);
    expect(v.rooms.map(r => r.name).sort()).toEqual(['Café', 'Museum']);
    expect(v.rooms[0].polygon.length).toBeGreaterThanOrEqual(4);
  });

  it('gives rooms the type of their layer when the layer was confirmed as one (e.g. restrooms)', () => {
    const v = buildVenue(drawing, mapping, { ...opts(true), roomTypes: { 'A-AREA': 'restroom' } });
    expect(v.rooms.map(r => r.type)).toEqual(['restroom', 'restroom']);
    expect(buildVenue(drawing, mapping, opts(true)).rooms.every(r => r.type === undefined)).toBe(true);
  });

  it('turns blocks, arcs, circles and line clusters into objects', () => {
    const v = buildVenue(drawing, mapping, opts(true));
    const kinds = (k: string) => v.features.filter(f => f.kind === k);
    expect(kinds('door')).toHaveLength(2);           // DOOR-900 block + a swing arc
    expect(kinds('stairs')).toHaveLength(1);         // three tread lines → one staircase
    expect(kinds('stairs')[0].width).toBeCloseTo(40); // 1 m wide at 40 px/m
    expect(kinds('tree')).toHaveLength(2);           // TREE block on layer 0 + a circle on L-PLNT
    expect(kinds('bench')).toHaveLength(1);
    expect(kinds('entrance')[0]).toMatchObject({ label: 'Main entrance' });
  });

  it('flags units that make no sense', () => {
    const v = buildVenue(drawing, mapping, { ...opts(false), unitsPerMeter: 1 }); // mm read as metres
    expect(v.health.unitsSuspect).toBe(true);
    expect(v.warnings.join(' ')).toMatch(/units are probably wrong/);
  });
});

describe('SVG reader', () => {
  it('reads layers, transforms, paths and text', () => {
    const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="200mm" height="100mm" viewBox="0 0 200 100">
      <g id="Walls" transform="translate(10 0)">
        <rect x="0" y="0" width="100" height="50"/>
        <path d="M0 60 h50 v20 z"/>
      </g>
      <g id="Rooms"><polygon points="0,0 50,0 50,50 0,50"/><text x="25" y="25">Gallery</text></g>
    </svg>`;
    const d = readSvg(svg);
    expect(d.layers).toEqual(['Rooms', 'Walls']);
    const rect = d.entities.find(e => e.kind === 'POLYLINE' && e.layer === 'Walls' && e.pts.length === 4)!;
    expect(rect.kind === 'POLYLINE' && rect.pts[0]).toEqual({ x: 10, y: 0 }); // translate applied
    expect(d.entities.some(e => e.kind === 'TEXT' && e.text === 'Gallery')).toBe(true);
    expect(d.unitsPerMeter).toBe(1000); // 1 user unit = 1 mm
    expect(d.flipY).toBe(false);
  });

  it('flattens curves and arcs', () => {
    const [sub] = flattenPath('M0 0 C 10 0 10 10 0 10');
    expect(sub.pts.length).toBe(9);
    expect(sub.pts[8]).toEqual({ x: 0, y: 10 });
    const [a] = flattenPath('M0 0 A 10 10 0 0 1 20 0');
    expect(a.pts[a.pts.length - 1].x).toBeCloseTo(20);
    expect(Math.min(...a.pts.map(p => p.y))).toBeCloseTo(-10, 0); // arc bulges up
  });
});

describe('3D models → plan', () => {
  // an axis-aligned box as 12 triangles
  const box = (x0: number, y0: number, z0: number, x1: number, y1: number, z1: number) => {
    const c = [[x0, y0, z0], [x1, y0, z0], [x1, y1, z0], [x0, y1, z0], [x0, y0, z1], [x1, y0, z1], [x1, y1, z1], [x0, y1, z1]];
    const f = [[0, 1, 2], [0, 2, 3], [4, 6, 5], [4, 7, 6], [0, 3, 7], [0, 7, 4], [1, 5, 6], [1, 6, 2], [3, 2, 6], [3, 6, 7], [0, 4, 5], [0, 5, 1]];
    const positions = new Float32Array(c.flat());
    return { positions, index: new Uint32Array(f.flat()), ...boundsOf(positions) };
  };
  const el = (layer: string, role: Element['role'], b: ReturnType<typeof box>, name = ''): Element => ({ layer, name, role, ...b });

  const elements = [
    el('IfcWall', 'slice', box(0, 0, 0, 10, 3, 0.2)),        // ground floor wall
    el('IfcWall', 'slice', box(0, 3.5, 0, 10, 6.5, 0.2)),    // first floor wall
    el('IfcSpace', 'space', box(0, 0, 0.2, 10, 3, 6), 'Lobby'),
    el('IfcDoor', 'object', box(4, 0, 0, 5, 2.1, 0.2)),
  ];

  it('finds levels and cuts walls 1 m above the chosen floor', () => {
    const d = elementsToDrawing(elements, 'ifc', {}, []);
    expect(d.levels).toHaveLength(2);
    // the cut wall: one closed outline (filled solid on the plan), its four corners
    const cut = d.entities.filter(e => e.layer === 'IfcWall');
    expect(cut).toHaveLength(1);
    expect(cut[0].kind === 'POLYLINE' && cut[0].closed && cut[0].pts.length).toBe(4);
    expect(d.entities.some(e => e.kind === 'TEXT' && e.text === 'Lobby')).toBe(true);
    expect(d.entities.some(e => e.kind === 'INSERT' && e.layer === 'IfcDoor')).toBe(true);
    const upstairs = d.atLevel!(1);
    expect(upstairs.entities.filter(e => e.layer === 'IfcSpace')).toHaveLength(0);
    expect(upstairs.entities.filter(e => e.layer === 'IfcWall' && e.kind === 'POLYLINE' && e.closed)).toHaveLength(1);
  });
});

describe('room types from names', () => {
  it('guesses common types', () => {
    expect(roomTypeFromName('Ladies WC')).toBe('restroom');
    expect(roomTypeFromName('Main Lobby')).toBe('entrance');
    expect(roomTypeFromName('Gallery 2')).toBe('office');
  });
});

describe('walkable paths follow the real plan', () => {
  const drawing = readDxf(pavilion());
  const mapping: LayerMapping = Object.fromEntries(classifyLayers(drawing).map(l => [l.name, l.suggested]));
  const v = buildVenue(drawing, mapping, { unitsPerMeter: drawing.unitsPerMeter!, pxPerMeter: 40, flipY: true, fix: { gaps: true, overlaps: true, rooms: true, floating: false } });

  it('never cross a wall except through a door or opening', async () => {
    const { walkableGraph } = await import('./commitVenue');
    const g = walkableGraph(v, 40);
    expect(g.edges.length).toBeGreaterThan(0);
    const openings = v.features.filter(f => f.kind === 'door' || f.kind === 'entrance');
    const cross = (a: { x: number; y: number }, b: { x: number; y: number }, c: { x: number; y: number }, d: { x: number; y: number }) => {
      const o = (p: typeof a, q: typeof a, r: typeof a) => Math.sign((q.x - p.x) * (r.y - p.y) - (q.y - p.y) * (r.x - p.x));
      return o(a, b, c) * o(a, b, d) < 0 && o(c, d, a) * o(c, d, b) < 0;
    };
    for (const e of g.edges) {
      const a = g.nodes[e.from], b = g.nodes[e.to];
      for (const w of v.walls) {
        const wa = { x: w.x1, y: w.y1 }, wb = { x: w.x2, y: w.y2 };
        if (!cross(a, b, wa, wb)) continue;
        // allowed only where a door / opening is (within 1 m)
        const atDoor = openings.some(o => Math.hypot(o.x - (a.x + b.x) / 2, o.y - (a.y + b.y) / 2) < 40 * 6 &&
          [a, b].some(p => Math.hypot(p.x - o.x, p.y - o.y) <= 40));
        expect(atDoor, `path (${Math.round(a.x)},${Math.round(a.y)})→(${Math.round(b.x)},${Math.round(b.y)}) crosses a wall`).toBe(true);
      }
    }
  });

  it('stores each path with its true length', async () => {
    const { walkableGraph } = await import('./commitVenue');
    const g = walkableGraph(v, 40);
    for (const e of g.edges) {
      const a = g.nodes[e.from], b = g.nodes[e.to];
      expect(Math.abs(e.weight - Math.hypot(a.x - b.x, a.y - b.y))).toBeLessThanOrEqual(1);
    }
  });
});

describe('IFC building models → plan', () => {
  const box = (x0: number, y0: number, z0: number, x1: number, y1: number, z1: number) => {
    const c = [[x0, y0, z0], [x1, y0, z0], [x1, y1, z0], [x0, y1, z0], [x0, y0, z1], [x1, y0, z1], [x1, y1, z1], [x0, y1, z1]];
    const f = [[0, 1, 2], [0, 2, 3], [4, 6, 5], [4, 7, 6], [0, 3, 7], [0, 7, 4], [1, 5, 6], [1, 6, 2], [3, 2, 6], [3, 6, 7], [0, 4, 5], [0, 5, 1]];
    const positions = new Float32Array(c.flat());
    return { positions, index: new Uint32Array(f.flat()), ...boundsOf(positions) };
  };
  const el = (layer: string, role: Element['role'], b: ReturnType<typeof box>, extra: Partial<Element> = {}): Element => ({ layer, name: '', role, ...b, ...extra });

  it('reads the escapes IFC writes names in', () => {
    expect(decodeIfcString(String.raw`Wohnk\X2\00FC\X0\che`)).toBe('Wohnküche');
    expect(decodeIfcString(String.raw`Caf\X\E9`)).toBe('Café');
    expect(decodeIfcString('Bad/WC')).toBe('Bad/WC');
  });

  it("uses the model's storeys, without its footing and roof", () => {
    const els = [
      el('IfcWall', 'slice', box(0, -1.2, 0, 10, -0.2, 0.3), { storey: 1 }),     // footing walls
      el('IfcWall', 'slice', box(0, 0, 0, 10, 3, 0.3), { storey: 2 }),
      el('IfcDoor', 'cut', box(4, 0, 0, 5, 2.1, 0.3), { storey: 2 }),
      el('IfcWall', 'slice', box(0, 3, 0, 10, 6, 0.3), { storey: 3 }),
      el('IfcWall', 'slice', box(0, 6, 0, 10, 7, 0.3), { storey: 4 }),          // parapet on the roof
      el('IfcSpace', 'space', box(0, 6, 0.3, 10, 8, 5), { storey: 4 }),         // attic void
    ];
    const s = storeysOf(els, new Map([[1, 'T/FDN'], [2, 'Level 1'], [3, 'Level 2'], [4, 'Roof']]))!;
    expect(s.map(x => [x.name, x.elevation])).toEqual([['Level 1', 0], ['Level 2', 3]]);
    // the plan of Level 2 has its wall, and Level 1's door isn't there
    const upstairs = elementsToDrawing(els, 'ifc', {}, [], 1, s);
    expect(upstairs.entities.some(e => e.layer === 'IfcDoor')).toBe(false);
    expect(upstairs.levels!.map(l => l.name)).toEqual(['Level 1', 'Level 2']);
  });

  it('cuts walls as solid outlines and doors with a swing, whatever way the exporter set up its frame', () => {
    const door = box(4, 0, 0, 4.9, 2.1, 0.3);
    // A frame (column-major 4x4) from its x, y, z axes in the model's Y-up world.
    const frame = (x: number[], y: number[], z: number[]) => [...x, 0, ...y, 0, ...z, 0, 0, 0, 0, 1];
    const archicad = frame([1, 0, 0], [0, 0, -1], [0, 1, 0]);           // x along the wall, y across it, z up
    const revit = frame([1, 0, 0], [0, 1, 0], [0, 0, 1]);               // y points up, z across
    const millimetres = frame([0.001, 0, 0], [0, 0, -0.001], [0, 0.001, 0]);
    for (const m of [archicad, revit, millimetres]) {
      const swings = doorSwings(m, door.positions, '')!;
      expect(swings).toHaveLength(1);
      expect(swings[0].width).toBeCloseTo(0.9, 5);
    }
    expect(doorSwings(archicad, box(0, 0, 0, 1.8, 2.1, 0.3).positions, '')).toHaveLength(2);   // wide: a double door
    expect(doorSwings(archicad, box(0, 0, 0, 3, 2.4, 0.3).positions, '')).toHaveLength(0);     // a garage door
    expect(doorSwings(archicad, door.positions, 'SLIDING_TO_LEFT')).toHaveLength(0);

    const els = [
      el('IfcWall', 'slice', box(0, 0, 0, 4, 3, 0.3), { storey: 1 }), el('IfcWall', 'slice', box(4.9, 0, 0, 9, 3, 0.3), { storey: 1 }),
      el('IfcDoor', 'cut', door, { storey: 1, swings: doorSwings(archicad, door.positions, 'SINGLE_SWING_LEFT') }),
    ];
    const d = elementsToDrawing(els, 'ifc', {}, [], 0, [{ id: 1, name: 'Ground', elevation: 0 }]);
    expect(d.entities.filter(e => e.layer === 'IfcWall' && e.kind === 'POLYLINE' && e.closed)).toHaveLength(2);
    const arc = d.entities.find(e => e.kind === 'ARC' && e.layer === 'IfcDoor');
    expect(arc && arc.kind === 'ARC' && arc.radius).toBeCloseTo(0.9, 5);
  });

  it('draws stairs and furniture as seen from above', () => {
    // two treads: each a box, at different heights
    const treads = [box(0, 0, 0, 1, 0.18, 0.28), box(0, 0.18, 0.28, 1, 0.36, 0.56)];
    const positions = new Float32Array([...treads[0].positions, ...treads[1].positions]);
    const index = new Uint32Array([...treads[0].index, ...Array.from(treads[1].index, i => i + 8)]);
    const segs = topOutline(positions, index);
    // each tread's outline: its front and back edges across the stair, and its sides
    const across = segs.filter(s => Math.abs(s.y1 - s.y2) < 1e-6 && Math.abs(s.x2 - s.x1) > 0.99);
    expect(new Set(across.map(s => s.y1.toFixed(2)))).toEqual(new Set(['0.00', '0.28', '0.56']));
  });
});

describe('rooms around a few outlined ones', () => {
  it('traces the rest of the floor when the outlined rooms cover little of it', () => {
    const P = (pts: [number, number][], closed = true) => lwpoly('A-WALL', pts, closed);
    // a 20 x 10 m floor in two halves, a 2 x 2 m stair hall outlined as a room in one corner
    const dxf = pair(0, 'SECTION') + pair(2, 'HEADER') + pair(9, '$INSUNITS') + pair(70, 6) + pair(0, 'ENDSEC') + pair(0, 'SECTION') + pair(2, 'ENTITIES')
      + P([[0, 0], [20, 0], [20, 10], [0, 10]]) + line('A-WALL', 10, 0, 10, 10)
      + lwpoly('A-AREA', [[0.5, 0.5], [2.5, 0.5], [2.5, 2.5], [0.5, 2.5]], true) + text('A-AREA', 1.5, 1.5, 'Stair hall')
      + pair(0, 'ENDSEC') + pair(0, 'EOF');
    const d = readDxf(dxf);
    const v = buildVenue(d, { 'A-WALL': 'walls', 'A-AREA': 'rooms' }, { unitsPerMeter: 1, pxPerMeter: 40, flipY: true, fix: { gaps: true, overlaps: true, rooms: true, floating: false } });
    expect(v.rooms.map(r => r.name)).toContain('Stair hall');
    expect(v.rooms.length).toBeGreaterThanOrEqual(2);   // the other half is a room too
  });
});
