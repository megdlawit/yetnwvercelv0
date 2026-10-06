import { describe, expect, it } from 'vitest';
import { hoursSummary, openStatus, parseHours, placeTypeOf } from './places';
import { venuePlaces } from './placeList';
import { hexToHslVar, themeOf } from './themes';

const hours = parseHours({ mon: [['08:00', '18:00']], tue: [['08:00', '18:00']], wed: [], sat: [['09:00', '13:00']], note: 'Closed on holidays' });

describe('opening hours', () => {
  // 2026-10-05 is a Monday
  it('is open within a span', () => {
    expect(openStatus(hours, new Date(2026, 9, 5, 10, 0))).toEqual({ open: true, text: 'Open now · until 18:00' });
  });
  it('says when it opens later today', () => {
    expect(openStatus(hours, new Date(2026, 9, 5, 7, 0))?.text).toBe('Closed · opens 08:00');
  });
  it('finds the next open day', () => {
    expect(openStatus(hours, new Date(2026, 9, 5, 19, 0))?.text).toBe('Closed · opens 08:00 tomorrow');
    expect(openStatus(hours, new Date(2026, 9, 7, 12, 0))?.text).toBe('Closed · opens 09:00 Sat');
  });
  it('is null when no hours are set', () => {
    expect(openStatus(null)).toBeNull();
    expect(openStatus({ note: 'x' })).toBeNull();
  });
  it('summarises runs of equal days', () => {
    expect(hoursSummary(hours)).toBe('Mon–Tue 08:00–18:00 · Wed–Fri closed · Sat 09:00–13:00 · Sun closed');
  });
});

describe('places', () => {
  it('guesses types for older rows', () => {
    expect(placeTypeOf({ name: 'Main Gate', category: 'service' })).toBe('entrance');
    expect(placeTypeOf({ name: 'Lion house', category: 'attraction', place_type: 'cultural_site' })).toBe('cultural_site');
  });

  it('merges map places with their details rows', () => {
    const nodes = [
      { id: 'n1', floorId: 'f', name: 'Node 1', isHallway: false },
      { id: 'n2', floorId: 'f', name: 'Cafe', isHallway: false },
      { id: 'h', floorId: 'f', name: '', isHallway: true },
      { id: 'n3', floorId: 'f', name: '  ', isHallway: false },
    ];
    const rooms = [{ name: 'Palace', nodeId: 'n1' }];
    const pois = [
      { id: 'p2', node_id: 'n2', name: 'Garden Café', category: 'retail', place_type: 'cafe', is_visible: false },
      { id: 'p9', node_id: null, name: 'Car park', category: 'service', place_type: 'parking' },
    ];
    const list = venuePlaces(nodes, rooms, pois);
    expect(list.map(p => [p.key, p.name, p.type, p.visible])).toEqual([
      ['p9', 'Car park', 'parking', true],
      ['p2', 'Garden Café', 'cafe', false],
      ['node:n1', 'Palace', 'attraction', true],
    ]);
    expect(list.find(p => p.key === 'p9')!.nodeId).toBeNull();
  });
});

describe('themes', () => {
  it('falls back to park', () => {
    expect(themeOf('nope').id).toBe('park');
    expect(themeOf('heritage').id).toBe('heritage');
  });
  it('converts accents to CSS hsl vars', () => {
    expect(hexToHslVar('#ff0000')).toBe('0 100% 50%');
    expect(hexToHslVar('#ffffff')).toBe('0 0% 100%');
  });
});
