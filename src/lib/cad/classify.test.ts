import { describe, expect, it } from 'vitest';
import { categoryFromName, classifyLayers } from './classify';
import type { CadDrawing } from './types';

const cases = (pairs: [string, ReturnType<typeof categoryFromName>][]) =>
  pairs.map(([name, want]) => [name, categoryFromName(name), want]);

describe('layer names', () => {
  it('keeps the standard names', () => {
    for (const [name, got, want] of cases([
      ['A-WALL', 'walls'], ['A-DOOR', 'doors'], ['A-GLAZ', 'windows'], ['A-FLOR-STRS', 'stairs'], ['A-FLOR-EVTR', 'elevators'],
      ['L-PLNT', 'trees'], ['I-FURN', 'furniture'], ['A-AREA', 'rooms'], ['A-ANNO-TEXT', 'labels'], ['A-ANNO-DIMS', 'ignore'],
      ['A-WALL-PATT', 'ignore'], ['S-COLS', 'walls'], ['LIFT', 'elevators'], ['ELEVATOR', 'elevators'],
    ])) expect(got, name).toBe(want);
  });

  it('reads elevations and sections as other drawings, not lifts or walls', () => {
    for (const [name, got, want] of cases([
      ['ELEV 1', 'ignore'], ['Elev 6', 'ignore'], ['ele 2', 'ignore'], ['Elevation 01', 'ignore'], ['ELEVATION 1', 'ignore'],
      ['elevation 3', 'ignore'], ['A-Section-G', 'ignore'], ['ROOF', 'ignore'],
    ])) expect(got, name).toBe(want);
  });

  it('reads misspellings and Turkish, Spanish and Vietnamese template names', () => {
    for (const [name, got, want] of cases([
      ['DIMANTION', 'ignore'], ['DAIMENTION', 'ignore'], ['HACTH', 'ignore'], ['HACHE', 'ignore'], ['boarder ext', 'ignore'],
      ['içölçü', 'ignore'], ['PEOPLE', 'ignore'], ['CARS', 'ignore'], ['Akaki Parcel', 'ignore'], ['LOCAL STREET_10M', 'ignore'],
      ['GENERAL NOTE', 'ignore'],
      ['DUVAR', 'walls'], ['WAL', 'walls'], ['WAL1', 'walls'], ['wall15', 'walls'], ['PARED', 'walls'],
      ['PENCERE', 'windows'], ['VENTANA', 'windows'], ['KAPI', 'doors'], ['PUERTA', 'doors'], ['ESCALERA', 'stairs'],
      ['FIRNTUR', 'furniture'], ['FURNICHER', 'furniture'], ['A-FRN', 'furniture'], ['NOI THAT', 'furniture'], ['NOITHAT', 'furniture'],
      ['THIET-BI', 'furniture'], ['CAY', 'trees'], ['tex', 'labels'], ['texet2', 'labels'],
    ])) expect(got, name).toBe(want);
  });

  it('does not over-match', () => {
    for (const [name, got, want] of cases([
      // HID: 'hidden lines' by convention, but chairs in a real drawing we have — no rule.
      ['C-WALK', null], ['HID', null], ['FURNITUR-X', 'furniture'], ['A-TUR', 'doors'], ['HIDE', null], ['CARPET', null], ['Layer 3', null], ['0', null], ['SHIDDEN', null],
    ])) expect(got, name).toBe(want);
  });
});


describe('names from the October 2026 architect drawings', () => {
  it('misspellings, electrical layers, columns and a walkway are read right', () => {
  const cases: [string, string | null][] = [['out door walk way', 'ignore'], ['FERNITURE', 'furniture'], ['FIXITURE', 'furniture'], ['SANITARY', 'furniture'], ['P-SANR-FIXT', 'furniture'],
      ['columan', 'walls'], ['COLON', 'walls'], ['COL', 'walls'], ['col', 'walls'], ['E-LIGHT', 'ignore'], ['lighting', 'ignore'], ['socket', 'ignore'], ['E-EARTH', 'ignore'],
      ['hidden line', 'ignore'], ['HIDD', 'ignore'], ['C-PROP-LINE', 'ignore'], ['Diamension', 'ignore'], ['ground$0$03-WIN', 'windows'], ['win', 'windows'], ['green', 'trees'],
      ['FUR', 'furniture'], ['A-WALL', 'walls'], ['A-DOOR', 'doors'], ['WINDOW', 'windows'], ['KAPI', 'doors'], ['HID', null], ['FURNITURE', 'furniture'], ['COLOR', null], ['WINE CELLAR', null]];
    const bad = cases.filter(([n, c]) => categoryFromName(n) !== c).map(([n, c]) => `${n}: ${categoryFromName(n)} ≠ ${c}`);
    expect(bad).toEqual([]);
  });
});

describe('what a layer holds and where it is drawn', () => {
  const line = (layer: string, x: number) => ({ kind: 'LINE', layer, a: { x, y: 0 }, b: { x: x + 1, y: 0 } });
  const text = (layer: string, x: number) => ({ kind: 'TEXT', layer, pos: { x, y: 0 }, text: 'Lobby', height: 1 });
  const drawing = (entities: object[]) => ({ layers: [...new Set(entities.map(e => (e as { layer: string }).layer))], entities }) as unknown as CadDrawing;

  it('names and numbers of things are labels, not the things', () => {
    expect(categoryFromName('S-STRS-IDEN')).toBe('labels');
    expect(categoryFromName('A-DOOR-NMBR')).toBe('labels');
    expect(categoryFromName('R.C.')).toBe('walls');
    expect(categoryFromName('I-Concrete')).toBe('walls');
    expect(categoryFromName('PUMP CONCRETE BASE')).not.toBe('walls');
    const wall = classifyLayers(drawing([...Array.from({ length: 19 }, (_, i) => text('WALL', i)), line('WALL', 0), line('A-WALL', 0)])).find(l => l.name === 'WALL')!;
    expect(wall.suggested).toBe('labels');
  });

  it('a layer drawn only outside the floor plans is left out, whatever its name', () => {
    const d = drawing([
      ...Array.from({ length: 20 }, (_, i) => line('A-WALL', i)),               // in the plans
      ...Array.from({ length: 20 }, (_, i) => line('FURNITURE', 500 + i)),      // an elevation, off to the side
      ...Array.from({ length: 20 }, (_, i) => line('A-DOOR', i % 2 ? i : 500 + i)), // half in, half out
    ]);
    const plans = [{ minX: -10, minY: -10, maxX: 100, maxY: 10 }, { minX: 200, minY: -10, maxX: 300, maxY: 10 }];
    const byName = Object.fromEntries(classifyLayers(d, { plans }).map(l => [l.name, l.suggested]));
    expect(byName).toEqual({ 'A-WALL': 'walls', FURNITURE: 'ignore', 'A-DOOR': 'doors' });
    // Without plans (one drawing on the sheet) names decide as before.
    expect(classifyLayers(d).find(l => l.name === 'FURNITURE')!.suggested).toBe('furniture');
  });
});
