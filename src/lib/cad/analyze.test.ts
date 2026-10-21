import { describe, expect, it } from 'vitest';
import { parseDxf } from '../dxf/parseDxf';
import { readDxf } from './readers/dxf';
import { classifyLayers } from './classify';
import { buildVenue } from './buildVenue';
import { inferUnits, findDrawings, withinArea, quarterArcs, leafedArcs, polylineAsArc } from './analyze';
import { detectRooms, doorwaySeals, rayToWall, sheetFrame } from './detectRooms';

const pair = (c: number | string, v: string | number) => `${c}\n${v}\n`;
let k = 1; // drawing scale applied by the helpers below
const line = (x1: number, y1: number, x2: number, y2: number, layer = '0') =>
  pair(0, 'LINE') + pair(8, layer) + pair(10, x1 * k) + pair(20, y1 * k) + pair(11, x2 * k) + pair(21, y2 * k);
const arc = (x: number, y: number, r: number, a0: number, a1: number) =>
  pair(0, 'ARC') + pair(8, '0') + pair(10, x * k) + pair(20, y * k) + pair(40, r * k) + pair(50, a0) + pair(51, a1);
const lw = (pts: [number, number, number?][], closed: boolean) =>
  pair(0, 'LWPOLYLINE') + pair(8, '0') + pair(90, pts.length) + pair(70, closed ? 1 : 0)
  + pts.map(([x, y, b]) => pair(10, x * k) + pair(20, y * k) + (b ? pair(42, b) : '')).join('');
const dxf = (ents: string, insunits = 1) => pair(0, 'SECTION') + pair(2, 'HEADER') + pair(9, '$INSUNITS') + pair(70, insunits) + pair(0, 'ENDSEC')
  + pair(0, 'SECTION') + pair(2, 'ENTITIES') + ents + pair(0, 'ENDSEC') + pair(0, 'EOF');

// The kind of file real offices send: one layer, millimetres mislabelled as
// inches, no room outlines, doors only as swings with leaves, furniture and a
// sheet border drawn in the same layer.
// Two 5 × 4 m rooms side by side, a door between them, an entrance door.
const house = (scale = 1) => { k = scale; const out = dxf(
  // outer walls, with an 900 mm entrance gap in the bottom wall at x 1000–1900
  line(0, 0, 1000, 0) + line(1900, 0, 10000, 0) + line(10000, 0, 10000, 4000) + line(10000, 4000, 0, 4000) + line(0, 4000, 0, 0)
  // partition at x = 5000 with an 800 mm opening between y 1500 and 2300
  + line(5000, 0, 5000, 1500) + line(5000, 2300, 5000, 4000)
  // inner door: hinge (5000,1500), swing to the left, leaf drawn open along 180°
  + arc(5000, 1500, 800, 90, 180) + line(5000, 1500, 4200, 1500)
  // entrance door: hinge (1000,0), drawn as a polyline with a quarter bulge (tan(90°/4))
  + lw([[1000, 900, -0.41421356], [1900, 0]], false) + line(1000, 0, 1000, 900)
  // a bed in the right room
  + lw([[6000, 500], [7600, 500], [7600, 2500], [6000, 2500]], true)
  // a basin: a small curve, not a door (no leaf)
  + arc(8000, 3500, 25, 0, 90)
  // the sheet border, far away
  + line(-20000, -20000, 30000, -20000) + line(30000, -20000, 30000, 24000) + line(30000, 24000, -20000, 24000) + line(-20000, 24000, -20000, -20000),
); k = 1; return out; };

describe('reading messy real-world DXF', () => {
  it('turns a quarter-circle bulge into an arc (door swings drawn as polylines)', () => {
    const arcs = parseDxf(house()).entities.filter(e => e.kind === 'ARC');
    expect(arcs).toHaveLength(3); // inner door, entrance (from the bulge), basin
  });

  it('recognises arc-shaped polylines', () => {
    const pts = Array.from({ length: 9 }, (_, i) => ({ x: 800 * Math.cos((i / 8) * Math.PI / 2), y: 800 * Math.sin((i / 8) * Math.PI / 2) }));
    const a = polylineAsArc(pts)!;
    expect(a.radius).toBeCloseTo(800, 0);
    expect(polylineAsArc([{ x: 0, y: 0 }, { x: 1, y: 0 }, { x: 2, y: 0 }, { x: 3, y: 0 }])).toBeNull();
  });

  it('expands blocks and reads attribute text', () => {
    const blocks = pair(0, 'SECTION') + pair(2, 'BLOCKS')
      + pair(0, 'BLOCK') + pair(2, 'TAG') + pair(10, 0) + pair(20, 0) + line(0, 0, 100, 0) + pair(0, 'ENDBLK')
      + pair(0, 'ENDSEC');
    const ents = pair(0, 'INSERT') + pair(8, 'A-ROOM') + pair(66, 1) + pair(2, 'TAG') + pair(10, 50) + pair(20, 50) + pair(41, 2) + pair(42, 2) + pair(50, 90)
      + pair(0, 'ATTRIB') + pair(8, 'A-ROOM') + pair(10, 50) + pair(20, 60) + pair(1, 'Gallery') + pair(0, 'SEQEND');
    const d = parseDxf(blocks + pair(0, 'SECTION') + pair(2, 'ENTITIES') + ents + pair(0, 'ENDSEC') + pair(0, 'EOF'));
    const ln = d.entities.find(e => e.kind === 'LINE')!;
    expect(ln.layer).toBe('A-ROOM'); // layer 0 inside the block takes the insert's layer
    expect(ln.kind === 'LINE' && ln.b.x).toBeCloseTo(50);  // scaled ×2 and turned 90°
    expect(ln.kind === 'LINE' && ln.b.y).toBeCloseTo(250);
    expect(d.entities.some(e => e.kind === 'TEXT' && e.text === 'Gallery')).toBe(true);
  });
});

describe('analysing a drawing', () => {
  const d = readDxf(house());
  const arcs = quarterArcs(d.entities);

  it('measures doors by their leaves, not by every curve', () => {
    expect(arcs).toHaveLength(3);
    expect(leafedArcs(d.entities, arcs)).toHaveLength(2); // the basin has no leaf
  });

  it('works out the real units even when the file declares the wrong ones', () => {
    const u = inferUnits(d, arcs);
    expect(d.unitsPerMeter).toBeCloseTo(39.37, 1); // the file says inches
    expect(u).toMatchObject({ perMeter: 1000, name: 'millimetres', source: 'inferred' });
    expect(u.reason).toMatch(/says inches.*2 doors/);
  });

  it('finds a plotted drawing\'s scale from its doors', () => {
    // the same house drawn at 1:100 on paper, in metres of paper (doors ≈ 8 mm)
    const scaled = readDxf(house(1 / 100000));
    const u = inferUnits(scaled, quarterArcs(scaled.entities));
    expect(u.source).toBe('inferred');
    expect(u.name).toMatch(/custom scale/);
  });

  it('separates the plan from the sheet border', () => {
    const areas = findDrawings(d, 1000, arcs);
    expect(areas[0].doors).toBe(2);
    expect(areas[0].label).toMatch(/^Floor plan/);
    const plan = withinArea(d, areas[0]);
    expect(plan.entities.some(e => e.kind === 'LINE' && e.a.x === -20000)).toBe(false);
  });

  it('builds doors from swings and rooms from the walls', () => {
    const plan = withinArea(d, findDrawings(d, 1000, arcs)[0]);
    const mapping = Object.fromEntries(classifyLayers(plan).map(l => [l.name, l.suggested]));
    expect(mapping['0']).toBe('walls');
    const v = buildVenue(plan, mapping, { unitsPerMeter: 1000, pxPerMeter: 40, flipY: true, fix: { gaps: true, overlaps: true, rooms: true, floating: false } });
    expect(v.health.doorsFromSwings).toBe(2);
    expect(v.features.filter(f => f.kind === 'door')).toHaveLength(2);
    // the bed is furniture, not a wall
    expect(v.features.filter(f => f.kind === 'furniture')).toHaveLength(1);
    expect(v.health.roomsFromWalls).toBe(2);
    const areasM2 = v.rooms.map(r => {
      let a = 0;
      r.polygon.forEach((p, i) => { const q = r.polygon[(i + 1) % r.polygon.length]; a += p.x * q.y - q.x * p.y; });
      return Math.abs(a / 2) / 1600;
    }).sort((x, y) => x - y);
    // two ~20 m² rooms (the bed is a hole in one of them)
    expect(areasM2[0]).toBeGreaterThan(14);
    expect(areasM2[1]).toBeGreaterThan(17);
    expect(areasM2[1]).toBeLessThan(23);
  });

  it('never calls the space inside a sheet border a room', () => {
    const S = (x1: number, y1: number, x2: number, y2: number) => ({ x1, y1, x2, y2 });
    const box = (x0: number, y0: number, x1: number, y1: number) => [S(x0, y0, x1, y0), S(x1, y0, x1, y1), S(x1, y1, x0, y1), S(x0, y1, x0, y0)];
    const rooms = detectRooms([...box(0, 0, 4000, 4000), ...box(1000, 1000, 1400, 1400)], [], { pxPerMeter: 40 });
    expect(rooms).toHaveLength(1); // the small room; the frame's inside is outside
  });
});


describe('walkable paths', () => {
  it('joins rooms through their doors, without crossing walls', async () => {
    const { buildRouteGraph } = await import('./routeGraph');
    const { walkableGraph, connectivity } = await import('./commitVenue');
    const d = readDxf(house());
    const plan = withinArea(d, findDrawings(d, 1000, quarterArcs(d.entities))[0]);
    const mapping = Object.fromEntries(classifyLayers(plan).map(l => [l.name, l.suggested]));
    const v = buildVenue(plan, mapping, { unitsPerMeter: 1000, pxPerMeter: 40, flipY: true, fix: { gaps: true, overlaps: true, rooms: true, floating: false } });
    const g = buildRouteGraph({ walls: v.walls, rooms: v.rooms, doors: v.features.filter(f => f.kind === 'door').map(f => ({ x: f.x, y: f.y })), pxPerMeter: 40 });
    expect(g.nodes.filter(n => !n.isHallway)).toHaveLength(2);   // a place per room
    expect(connectivity(g)).toBe(2 * 1000 - 1);                     // both rooms, one network
    // no path segment crosses a wall
    const cross = (a: { x: number; y: number }, b: { x: number; y: number }, w: { x1: number; y1: number; x2: number; y2: number }) => {
      const d1 = (w.x2 - w.x1) * (a.y - w.y1) - (w.y2 - w.y1) * (a.x - w.x1), d2 = (w.x2 - w.x1) * (b.y - w.y1) - (w.y2 - w.y1) * (b.x - w.x1);
      const d3 = (b.x - a.x) * (w.y1 - a.y) - (b.y - a.y) * (w.x1 - a.x), d4 = (b.x - a.x) * (w.y2 - a.y) - (b.y - a.y) * (w.x2 - a.x);
      return d1 * d2 < 0 && d3 * d4 < 0;
    };
    expect(g.edges.some(e => v.walls.some(w => cross(g.nodes[e.from], g.nodes[e.to], w)))).toBe(false);
    // the importer keeps the better-connected of the two methods
    expect(connectivity(walkableGraph(v, 40))).toBeGreaterThanOrEqual(connectivity(g));
  });
});

describe('doorways that leave rooms joined', () => {
  const W = (x1: number, y1: number, x2: number, y2: number) => ({ x1, y1, x2, y2 });
  it('a wall stopping short of a crossing wall is a doorway (L-shaped)', () => {
    // A 1 m gap between a wall end and the side of a crossing wall, at 40 px/m.
    const seals = doorwaySeals([W(0, 0, 200, 0), W(240, -100, 240, 100)], 40);
    expect(seals).toEqual([{ x1: 200, y1: 0, x2: 240, y2: 0 }]);
  });
  it('a wall that meets another is not a doorway', () => {
    expect(doorwaySeals([W(0, 0, 240, 0), W(240, -100, 240, 100)], 40)).toEqual([]);
  });
  it('finds the end of a wall in line ahead (a centre line it would run along)', () => {
    expect(rayToWall({ x: 0, y: 0 }, 1, 0, [W(30, 2, 200, 2)], 60, 40)).toEqual({ x: 30, y: 2 });
    expect(rayToWall({ x: 0, y: 0 }, 1, 0, [W(70, 0, 200, 0)], 60, 40)).toBeNull(); // further than asked
  });
});

describe('sheet frame (title block cells are not rooms)', () => {
  const W = (x1: number, y1: number, x2: number, y2: number) => ({ x1, y1, x2, y2 });
  const box = (x0: number, y0: number, x1: number, y1: number) => [W(x0, y0, x1, y0), W(x1, y0, x1, y1), W(x1, y1, x0, y1), W(x0, y1, x0, y0)];
  it('a frame with the building floating inside it is a frame', () => {
    const walls = [...box(0, 0, 2000, 1400), W(0, 1200, 2000, 1200), W(800, 1200, 800, 1400), // frame + title block row
      ...box(300, 200, 900, 700), W(600, 200, 600, 700), ...box(1000, 300, 1500, 900), W(1000, 600, 1500, 600)]; // the building
    expect(sheetFrame(walls, 40)).toEqual({ minX: 0, minY: 0, maxX: 2000, maxY: 1400 });
  });
  it("a rectangular building's outer walls are not a frame", () => {
    const walls = [...box(0, 0, 800, 600), W(400, 0, 400, 600), W(0, 300, 400, 300), W(400, 200, 800, 200)];
    expect(sheetFrame(walls, 40)).toBeNull();
  });
});
