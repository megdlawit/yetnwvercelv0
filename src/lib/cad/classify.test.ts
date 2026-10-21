import { describe, expect, it } from 'vitest';
import { categoryFromName } from './classify';

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
