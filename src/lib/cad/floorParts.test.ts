import { describe, expect, it } from 'vitest';
import { buildPart, fillLevels, floorNameFrom, levelFromName, partsFromFile } from './floorParts';

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
    expect(parts.map(p => [p.name, p.level])).toEqual([['Ground floor', 0], ['First floor', 1], ['Second floor', 2]]);
    for (const p of parts) expect(buildPart(p, 40).walls.length).toBeGreaterThanOrEqual(6);
  });

  it('keeps a one-floor-per-file upload as one floor, named after the file', async () => {
    const parts = await partsFromFile(fileOf('level-2.dxf', sheet), { split: false });
    expect(parts).toHaveLength(1);
    expect(parts[0]).toMatchObject({ name: 'Level-2', level: 2 });
  });
});
