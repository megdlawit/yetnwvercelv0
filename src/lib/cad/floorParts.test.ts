import { describe, expect, it } from 'vitest';
import { buildPart, fillLevels, floorNameFrom, levelFromName, levelsFromName, oneFloorPerFile, orderBasements, partsFromFile } from './floorParts';
import { placeLabelFrom, roomNameFrom } from './buildVenue';

describe('levelFromName', () => {
  it.each([
    ['Ground floor', 0], ['GF plan', 0], ['Level 2', 2], ['level-3.dxf', 3], ['2nd floor', 2], ['Second Floor', 2],
    ['Basement', -1], ['B2 parking', -2], ['L1', 1], ['Floor 0', 0], ['FL 4', 4],
  ])('%s → %i', (name, level) => expect(levelFromName(name)).toBe(level));

  it('is unknown when the name does not say', () => {
    expect(levelFromName('museum east wing')).toBeNull();
  });
});

describe('floorNameFrom', () => {
  it('tidies file names', () => {
    expect(floorNameFrom('unity_level-2_plan.dxf')).toBe('Unity level-2 plan');
    expect(floorNameFrom('ground.ifc')).toBe('Ground');
  });
});

describe('fillLevels', () => {
  it('places floors without a level after the known ones, skipping levels in use', () => {
    const out = fillLevels([{ level: 0 }, { level: null }, { level: 2 }, { level: null }], [1]);
    expect(out.map(p => p.level)).toEqual([0, 3, 2, 4]);
  });
});

// A sheet with three plans side by side, each titled (mm, like most CAD).
const pair = (c: number | string, v: string | number) => `${c}\n${v}\n`;
const line = (l: string, x1: number, y1: number, x2: number, y2: number) => pair(0, 'LINE') + pair(8, l) + pair(10, x1) + pair(20, y1) + pair(11, x2) + pair(21, y2);
const text = (l: string, x: number, y: number, t: string) => pair(0, 'TEXT') + pair(8, l) + pair(10, x) + pair(20, y) + pair(40, 400) + pair(1, t);
const arc = (l: string, x: number, y: number, r: number, a0: number, a1: number) => pair(0, 'ARC') + pair(8, l) + pair(10, x) + pair(20, y) + pair(40, r) + pair(50, a0) + pair(51, a1);
const plan = (ox: number, title: string) =>
  line('A-WALL', ox, 0, ox + 14000, 0) + line('A-WALL', ox + 14000, 0, ox + 14000, 9000) + line('A-WALL', ox + 14000, 9000, ox, 9000) + line('A-WALL', ox, 9000, ox, 0) +
  line('A-WALL', ox + 6000, 0, ox + 6000, 9000) + line('A-WALL', ox + 6000, 4500, ox + 14000, 4500) +
  arc('A-DOOR', ox + 6000, 1500, 900, 0, 90) + arc('A-DOOR', ox + 9000, 4500, 900, 90, 180) + text('A-ANNO-TTLB', ox + 5000, -1500, title);
const sheet = pair(0, 'SECTION') + pair(2, 'HEADER') + pair(9, '$INSUNITS') + pair(70, 4) + pair(0, 'ENDSEC') + pair(0, 'SECTION') + pair(2, 'ENTITIES')
  + plan(0, 'GROUND FLOOR') + plan(22000, 'FIRST FLOOR') + plan(44000, 'SECOND FLOOR') + pair(0, 'ENDSEC') + pair(0, 'EOF');

// jsdom's File has no arrayBuffer(); what the readers use is all a test needs.
const fileOf = (name: string, body: string) => {
  const bytes = new TextEncoder().encode(body);
  return { name, size: bytes.length, type: '', arrayBuffer: async () => bytes.buffer, text: async () => body } as unknown as File;
};

describe('partsFromFile', () => {
  it('finds each floor on a sheet, named and levelled from its title', async () => {
    const parts = await partsFromFile(fileOf('museum.dxf', sheet));
    expect(parts.map(p => [p.name, p.level])).toEqual([['Ground floor', 0], ['1st floor', 1], ['2nd floor', 2]]);
    for (const p of parts) expect(buildPart(p, 40).walls.length).toBeGreaterThanOrEqual(6);
  });

  it('a file per floor works the same way: its plan, named from the file when the plan has no title', async () => {
    const one = pair(0, 'SECTION') + pair(2, 'HEADER') + pair(9, '$INSUNITS') + pair(70, 4) + pair(0, 'ENDSEC')
      + pair(0, 'SECTION') + pair(2, 'ENTITIES') + plan(0, 'x') + pair(0, 'ENDSEC') + pair(0, 'EOF');
    const parts = await partsFromFile(fileOf('level-2.dxf', one));
    expect(parts.map(p => [p.name, p.level])).toEqual([['2nd floor', 2]]);
    // …and a file holding all the floors gives all of them, whichever way it was uploaded.
    expect((await partsFromFile(fileOf('level-2.dxf', sheet))).map(p => p.level)).toEqual([0, 1, 2]);
  });

  it("an elevation (no doors, level markers beside it) isn't a floor, even with the plans' footprint", async () => {
    const elevation = (ox: number) =>
      line('A-WALL', ox, 0, ox + 14000, 0) + line('A-WALL', ox + 14000, 0, ox + 14000, 9000) + line('A-WALL', ox + 14000, 9000, ox, 9000) + line('A-WALL', ox, 9000, ox, 0) +
      line('A-WALL', ox, 3000, ox + 14000, 3000) + line('A-WALL', ox, 6000, ox + 14000, 6000) +
      text('A-ANNO', ox - 2600, 200, 'GROUND FLOOR') + text('A-ANNO', ox - 2600, 3200, 'FIRST FLOOR') + text('A-ANNO', ox - 2600, 6200, 'SECOND FLOOR');
    const withElevation = pair(0, 'SECTION') + pair(2, 'HEADER') + pair(9, '$INSUNITS') + pair(70, 4) + pair(0, 'ENDSEC') + pair(0, 'SECTION') + pair(2, 'ENTITIES')
      + plan(0, 'GROUND FLOOR') + plan(22000, 'FIRST FLOOR') + elevation(44000) + pair(0, 'ENDSEC') + pair(0, 'EOF');
    expect((await partsFromFile(fileOf('house.dxf', withElevation))).map(p => p.name)).toEqual(['Ground floor', '1st floor']);
  });

  it('two drawings of one floor: the detailed one is the floor, the simpler copy is listed unticked', async () => {
    // A presentation copy of the ground floor, a little smaller and without door swings.
    const copy = (ox: number) =>
      line('A-WALL', ox, 0, ox + 12000, 0) + line('A-WALL', ox + 12000, 0, ox + 12000, 7800) + line('A-WALL', ox + 12000, 7800, ox, 7800) + line('A-WALL', ox, 7800, ox, 0) +
      line('A-WALL', ox + 5000, 0, ox + 5000, 7800) + text('A-ANNO-TTLB', ox + 4000, -1500, 'GROUND FLOOR PLAN');
    const sheet2 = pair(0, 'SECTION') + pair(2, 'HEADER') + pair(9, '$INSUNITS') + pair(70, 4) + pair(0, 'ENDSEC') + pair(0, 'SECTION') + pair(2, 'ENTITIES')
      + copy(0) + plan(22000, 'GROUND FLOOR PLAN') + plan(44000, 'FIRST FLOOR') + pair(0, 'ENDSEC') + pair(0, 'EOF');
    const parts = await partsFromFile(fileOf('house.dxf', sheet2));
    expect(parts.filter(p => p.include !== false).map(p => [p.name, p.drawing.bounds!.minX >= 20000])).toEqual([['Ground floor', true], ['1st floor', true]]);
    expect(parts.find(p => p.include === false)?.note).toMatch(/Another drawing of the ground floor/);
  });

  it('plans drawn about a metre apart are still separate floors', async () => {
    // 14 m wide plans, 1.2 m apart (the usual grouping distance joins them).
    const close = pair(0, 'SECTION') + pair(2, 'HEADER') + pair(9, '$INSUNITS') + pair(70, 4) + pair(0, 'ENDSEC') + pair(0, 'SECTION') + pair(2, 'ENTITIES')
      + plan(0, 'GROUND FLOOR') + plan(15200, 'FIRST FLOOR') + plan(30400, 'SECOND FLOOR') + pair(0, 'ENDSEC') + pair(0, 'EOF');
    expect((await partsFromFile(fileOf('house.dxf', close))).map(p => p.name)).toEqual(['Ground floor', '1st floor', '2nd floor']);
    // a floor titled without a level: its name, without "floor plan"
    const terrace = pair(0, 'SECTION') + pair(2, 'HEADER') + pair(9, '$INSUNITS') + pair(70, 4) + pair(0, 'ENDSEC') + pair(0, 'SECTION') + pair(2, 'ENTITIES')
      + plan(0, 'GROUND FLOOR') + plan(22000, 'TERRACE FLOOR PLAN') + pair(0, 'ENDSEC') + pair(0, 'EOF');
    expect((await partsFromFile(fileOf('house.dxf', terrace))).map(p => p.name)).toEqual(['Ground floor', 'Terrace']);
  });

  it('a sheet with no floor titles: named in order, with a note to check', async () => {
    const untitled = pair(0, 'SECTION') + pair(2, 'HEADER') + pair(9, '$INSUNITS') + pair(70, 4) + pair(0, 'ENDSEC') + pair(0, 'SECTION') + pair(2, 'ENTITIES')
      + plan(0, 'x') + plan(22000, 'x') + plan(44000, 'x') + pair(0, 'ENDSEC') + pair(0, 'EOF');
    const parts = await partsFromFile(fileOf('house.dxf', untitled));
    expect(parts.map(p => [p.name, p.level, p.include !== false])).toEqual([['Ground floor', 0, true], ['1st floor', 1, true], ['2nd floor', 2, true]]);
    expect(parts.every(p => /no floor titles/.test(p.note ?? ''))).toBe(true);
  });

  it('an outbuilding drawn beside the ground floor (a guard house) is part of the ground floor, not a second one', async () => {
    const guard = (ox: number, oy: number) =>
      line('A-WALL', ox, oy, ox + 6000, oy) + line('A-WALL', ox + 6000, oy, ox + 6000, oy + 5000) + line('A-WALL', ox + 6000, oy + 5000, ox, oy + 5000) +
      line('A-WALL', ox, oy + 5000, ox, oy) + line('A-WALL', ox + 2000, oy + 3000, ox + 6000, oy + 3000) +
      text('A-ANNO', ox + 3000, oy + 1500, 'Guard House Ceramic ff A=11.75m²') + text('A-ANNO-TTLB', ox + 1000, oy - 1500, 'GROUND FLOOR PLAN A= 21 M² Sc=1:50');
    const sheet3 = pair(0, 'SECTION') + pair(2, 'HEADER') + pair(9, '$INSUNITS') + pair(70, 4) + pair(0, 'ENDSEC') + pair(0, 'SECTION') + pair(2, 'ENTITIES')
      + plan(0, 'GROUND FLOOR PLAN') + guard(0, -9000) + plan(22000, 'FIRST FLOOR PLAN') + pair(0, 'ENDSEC') + pair(0, 'EOF');
    const parts = await partsFromFile(fileOf('belay.dxf', sheet3));
    expect(parts.map(p => [p.name, p.level, p.include !== false])).toEqual([['Ground floor', 0, true], ['1st floor', 1, true]]);
    expect(parts[0].note).toMatch(/guard house.*drag it to where it stands/i);
    const v = buildPart(parts[0], 40);
    expect(v.rooms.map(r => r.name)).toContain('Guard House');
    // set apart from the building: at least 4 m between them
    const guardRoom = v.rooms.find(r => r.name === 'Guard House')!;
    const building = v.walls.filter(w => Math.min(w.y1, w.y2) < guardRoom.y - 4 * 40);
    expect(building.length).toBeGreaterThan(0);
  });

  it('an ArchiCAD sheet: titled plans count without door swings, titled elevations never do, another building is set apart', async () => {
    // Shop shutters have no swings; the elevation has an arched window that looks like a door.
    const noSwings = (ox: number, title: string) => plan(ox, title).replace(/0\nARC\n(?:(?!0\n)[^\n]*\n[^\n]*\n)*/g, '');
    const elevation = plan(44000, 'FRONT SIDE ELEVATION SC 1:50');
    const sheet2 = pair(0, 'SECTION') + pair(2, 'HEADER') + pair(9, '$INSUNITS') + pair(70, 4) + pair(0, 'ENDSEC') + pair(0, 'SECTION') + pair(2, 'ENTITIES')
      + noSwings(0, 'GROUND FLOOR PLAN SC 1:50') + noSwings(22000, '1st -4th FLOOR PLAN SC 1:50') + elevation
      // the shop block, 90 m off and a different size (a same-size twin would be a copy of the plan)
      + plan(150000, 'GROUND FLOOR PLAN SC 1:50') + line('A-WALL', 164000, 0, 172000, 0) + line('A-WALL', 172000, 0, 172000, 9000) + line('A-WALL', 172000, 9000, 164000, 9000)
      + pair(0, 'ENDSEC') + pair(0, 'EOF');
    const parts = await partsFromFile(fileOf('Drawing1.dxf', sheet2));
    expect(parts.map(p => [p.name, p.level, p.include !== false])).toEqual([
      ['Ground floor', 0, true], ['1st floor', 1, true], ['2nd floor', 2, true], ['3rd floor', 3, true], ['4th floor', 4, true],
      ['Ground floor', 0, false],
    ]);
    expect(parts[5].note).toMatch(/Another building/);
  });
});

describe('a real sheet: floor plans among elevations, copies and an annex', () => {
  // Plans 14 × 9 m titled below them. A basement with no door swings (a car park) but the
  // same footprint; an elevation (walls, no swings, another size); a second copy of the
  // ground floor plan elsewhere on the sheet; a small annex also titled "ground floor".
  const box = (ox: number, oy: number, w: number, h: number) =>
    line('A-WALL', ox, oy, ox + w, oy) + line('A-WALL', ox + w, oy, ox + w, oy + h) + line('A-WALL', ox + w, oy + h, ox, oy + h) + line('A-WALL', ox, oy + h, ox, oy)
    + line('A-WALL', ox + w / 2, oy, ox + w / 2, oy + h);
  const at = (ox: number, oy: number, title: string) =>
    box(ox, oy, 14000, 9000) + line('A-WALL', ox + 7000, oy + 4500, ox + 14000, oy + 4500)
    + arc('A-DOOR', ox + 7000, oy + 1500, 900, 0, 90) + arc('A-DOOR', ox + 10000, oy + 4500, 900, 90, 180) + text('A-ANNO-TTLB', ox + 5000, oy - 1500, title);
  const entities = box(-22000, 0, 14000, 9000) + text('A-ANNO-TTLB', -21000, -1200, 'BASMENT FLOOR PLAN AREA= 80 M2')
    + at(0, 0, 'GROUND FLOOR A= 126 M² Sc=1:50') + at(22000, 0, '1ST FLOOR PLAN') + at(44000, 0, '2nd -4th FLOOR')
    + box(66000, 0, 14000, 19000) + text('A-ANNO-TTLB', 67000, -1200, 'FRONT ELEVATION')
    + at(100000, 60000, 'GROUND FLOOR')
    + box(0, -20000, 6000, 6000) + arc('A-DOOR', 3000, -18500, 900, 0, 90) + text('A-ANNO-TTLB', 1000, -21500, 'GROUN FLOOR A= 21 M²');
  const realSheet = pair(0, 'SECTION') + pair(2, 'HEADER') + pair(9, '$INSUNITS') + pair(70, 4) + pair(0, 'ENDSEC')
    + pair(0, 'SECTION') + pair(2, 'ENTITIES') + entities + pair(0, 'ENDSEC') + pair(0, 'EOF');

  it('finds every floor once, named and levelled, a typical-floor plan as each of its floors', async () => {
    const parts = await partsFromFile(fileOf('belay.dxf', realSheet));
    const on = parts.filter(p => p.include !== false);
    expect(on.map(p => [p.name, p.level])).toEqual([
      ['Basement', -1], ['Ground floor', 0], ['1st floor', 1], ['2nd floor', 2], ['3rd floor', 3], ['4th floor', 4],
    ]);
    expect(on.filter(p => p.level! >= 2).every(p => p.note === 'One plan for floors 2–4')).toBe(true);
    // The elevation is not a floor, the ground floor's copy is imported once, and the annex
    // (an outbuilding titled "ground floor" too) is drawn into the ground floor.
    expect(parts.filter(p => p.include === false)).toHaveLength(0);
    const ground = on.find(p => p.level === 0)!;
    expect(ground.note).toMatch(/small separate building.*drag it/);
    expect(ground.drawing.bounds!.maxY - ground.drawing.bounds!.minY).toBeGreaterThan(9000 + 4000 + 6000 - 1);
  });
});

describe('names on real sheets', () => {
  it.each([
    ['BASMENT FLOOR PLAN', [-1]], ['GROUN FLOOR A= 21 M²', [0]], ['2nd -4th FLOOR', [2, 3, 4]], ['2ND -4TH FLOOR PLAN', [2, 3, 4]],
    ['Floors 2-3', [2, 3]], ['1ST FLOOR PLAN', [1]], ['FRONT ELEVATION', []],
    ['BASEMENT 2  FLOOR PLAN', [-2]], ['BASEMENT 1 FLOOR PLAN', [-1]], ['SEMI-BASEMENT FLOOR PLAN', [-1]], ['SECOND - THIRD FLOOR PLAN', [2, 3]], ['ELEVENTH FLOOR PLAN', [11]], ['AR_MARRIOTT HOTEL A-111_5th,6th,7th,8th & 9th FLOOR PLAN JAN_26.dxf', [5, 6, 7, 8, 9]], ['FORTH FLOOR PLAN', [4]], ['TWELFTH FLOOR', [12]], ['5th,6th,7th,8th & 9th FLOOR PLAN', [5, 6, 7, 8, 9]], ['SECOND FLOOR', [2]], ['GROUND FLOOR PLAN : 43 m²', [0]],
  ])('%s → levels %j', (title, levels) => expect(levelsFromName(title)).toEqual(levels));
});

describe('room names from the tags in real drawings', () => {
  it.each([
    ['B. ROOM Ceramic ff A=14.6 m²', 'Bedroom'], ['LIVING,DINING & O.KITCHEN Ceramic ff A=62.6 m²', 'Living, Dining & Open Kitchen'],
    ['M.BATH Ceramic ff A=11 m²', 'Master Bath'], ['TRADITIONAL K. Ceramic ff A=27.4 m²', 'Traditional Kitchen'],
    ['MAIDS B. ROOM Ceramic ff A=7.4 m²', "Maid's Bedroom"], ['JANITARY ROOM Ceramic ff A=2.2 m²', 'Janitor Room'],
    ['shop Ceramic ff A=10.5 m²', 'Shop'], ['Meeting Room A', 'Meeting Room A'], ['Café', 'Café'],
    ['Disable TOILET', 'Disable Toilet'], ['Staff WC', 'Staff WC'],
    ['PASSAGE 6FEET WIDE', 'Passage'], ['CORRIDOR 1.5 M WIDE', 'Corridor'],
  ])('%s → %s', (tag, name) => expect(roomNameFrom(tag)).toBe(name));
});

describe('map labels: names only, never drafting notes', () => {
  it.each([
    ['FOYER', 'Foyer'], ['STORE Ceramic ff A=3.3 m²', 'Store'], ['Guard House Ceramic ff A=11.75m²', 'Guard House'], ['Main Entrance', 'Main Entrance'],
    ['A', null], ['D', null], ['90/210', null], ['+3.50', null], ['GROUN FLOOR A= 21 M² Sc=1:50', null], ['FRONT ELEVATION', null],
    ['Plastered & Painting RAL 7044', null], ['5mm thick glass', null], ['11% Slope', null], ['ROOM', null], ['ORIENTATION', null],
    ['HALL', 'Hall'], ['PASSAGE 6FEET WIDE', 'Passage'],
    ['Parquet', null], ['MARBLE FLOORING', null], ['Ceramic tiles', null], ['Bath room', 'Bathroom'], ['Bed room', 'Bedroom'],
    ['Bedroom porcelain', 'Bedroom'], ['Terazzo', null], ['A= 7.75 m. sq', null], ['Area: 12 m²', null], ['M.Bedroom', 'Master Bedroom'], ['C.Bath', 'Common Bath'],
  ])('%s → %s', (text, label) => expect(placeLabelFrom(text)).toBe(label));
});

describe('basements across files (one file per floor)', () => {
  it('a semi-basement sits just below ground; the basements go under it', () => {
    const part = (named: string) => ({ named, name: '', level: levelFromName(named) });
    const parts = orderBasements([part('A-101_BASEMENT 2 FLOOR PLAN.dxf'), part('A-102_BASEMENT 1 FLOOR PLAN.dxf'), part('A-103_SEMI-BASEMENT FLOOR PLAN.dxf'), part('A-104_GROUND FLOOR PLAN.dxf')]);
    expect(parts.map(p => p.level)).toEqual([-3, -2, -1, 0]);
    expect(parts[2].name).toBe('Semi-basement');
    expect(parts.map(p => p.name).slice(0, 2)).toEqual(['Basement 2', 'Basement 1']);   // their own numbers
  });
});

describe('one file per floor', () => {
  const part = (file: string, name: string, level: number | null, w: number, include = true) =>
    ({ key: `${file}#${name}`, file, origin: '', units: { perMeter: 1, source: 'file', reason: '' }, name, level, include, drawing: { bounds: { minX: 0, minY: 0, maxX: w, maxY: w } } }) as unknown as Parameters<typeof oneFloorPerFile>[0][number]['parts'][number];
  it('each file is its floor; unnumbered floors sit between their neighbours; extra drawings are off', () => {
    const out = oneFloorPerFile([
      { name: 'A-106_FIRST FLOOR PLAN.dxf', parts: [part('A-106', '1st floor', 1, 40)] },
      { name: 'A-104_GROUND FLOOR PLAN.dxf', parts: [part('A-104', 'Ground floor', 0, 40), part('A-104', 'Floor 1', null, 5, false)] },
      { name: 'A-105_MEZZANINE  FLOOR PLAN.dxf', parts: [part('A-105', 'Ground floor', 0, 8), part('A-105', 'Ground floor', 0, 35)] },
      { name: 'A-101_BASEMENT 2 FLOOR PLAN.dxf', parts: [part('A-101', 'Basement', -1, 40)] },
      { name: 'A-114_ROOF PLAN.dxf', parts: [part('A-114', 'Roof plan', null, 30), part('A-114', 'Ground floor', 0, 10)] },
    ]);
    const on = out.filter(p => p.include !== false).sort((a, b) => a.level! - b.level!);
    expect(on.map(p => [p.name, p.level])).toEqual([['Basement 2', -2], ['Ground floor', 0], ['Mezzanine floor', 1], ['1st floor', 2], ['Roof', 3]]);
    expect(out.filter(p => p.include === false)).toHaveLength(3);   // the key plans and copies on those sheets
  });
});
