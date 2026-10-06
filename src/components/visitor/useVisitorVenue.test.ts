import { describe, expect, it } from 'vitest';
import { derivePlaces, resolveEntry } from './useVisitorVenue';
import { venuePlaces } from '@/lib/venue/placeList';

// Older CAD imports left some names NULL in the database.
const nodes = [
  { id: 'a', floorId: 'f', name: null as unknown as string, x: 0, y: 0, isHallway: false, floorLevel: 0 },
  { id: 'b', floorId: 'f', name: 'Main Entrance', x: 40, y: 0, isHallway: false, floorLevel: 0 },
  { id: 'c', floorId: 'f', name: null as unknown as string, x: 80, y: 0, isHallway: false, floorLevel: 0 },
];
const rooms = [{ id: 'r', floorId: 'f', name: null as unknown as string, nodeId: 'c', x: 0, y: 0, width: 10, height: 10, type: 'office' as const }];

describe('places from data with missing names', () => {
  it('skips nameless spots instead of crashing', () => {
    const { places } = derivePlaces({ nodes, rooms, pois: [], floors: [{ id: 'f', name: 'Ground', level: 0 }] });
    expect(places.map(p => p.name)).toEqual(['Main Entrance']);
  });
  it('the dashboard list copes too', () => {
    expect(venuePlaces(nodes, rooms, []).map(p => p.name)).toEqual(['Main Entrance']);
  });
  it('resolves QR entry links by id or readable name', () => {
    const { places } = derivePlaces({ nodes, rooms, pois: [], floors: [{ id: 'f', name: 'Ground', level: 0 }] });
    expect(resolveEntry('main-entrance', places)).toBe('b');
    expect(resolveEntry('b', places)).toBe('b');
    expect(resolveEntry('nowhere', places)).toBeNull();
  });
});
