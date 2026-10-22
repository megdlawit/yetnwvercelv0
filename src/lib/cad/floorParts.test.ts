import { describe, expect, it } from 'vitest';
import { buildPart, fillLevels, floorNameFrom, levelFromName, levelsFromName, partsFromFile } from './floorParts';
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
    // The elevation is not a floor, the ground floor's copy is imported once, the annex is offered but off.
    const off = parts.filter(p => p.include === false);
    expect(off).toHaveLength(1);
    expect(off[0].note).toMatch(/Small separate plan/);
  });
});

describe('names on real sheets', () => {
  it.each([
    ['BASMENT FLOOR PLAN', [-1]], ['GROUN FLOOR A= 21 M²', [0]], ['2nd -4th FLOOR', [2, 3, 4]], ['2ND -4TH FLOOR PLAN', [2, 3, 4]],
    ['Floors 2-3', [2, 3]], ['1ST FLOOR PLAN', [1]], ['FRONT ELEVATION', []],
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
  ])('%s → %s', (text, label) => expect(placeLabelFrom(text)).toBe(label));
});
