import { describe, expect, it } from 'vitest';
import { categoryFromQuery, categoryOf, collections, recommend, searchVenue, walkMinutes, type DiscoverPlace } from './discover';
import { GeofenceTracker, nearbySuggestion, type Fence } from './geofence';

const P = 40;
const place = (id: string, name: string, extra: Partial<DiscoverPlace> = {}): DiscoverPlace => ({
  id, name, category: categoryOf(extra.type ?? null, name), x: 0, y: 0, floorId: 'f', images: [], hours: null, featured: false, description: null, ...extra,
});
const places = [
  place('m', 'National Museum', { type: 'cultural_site', featured: true, images: ['m.jpg'], description: 'History of Ethiopia', x: 1200 }),
  place('g', 'Historic Garden', { type: 'garden', images: ['g.jpg'], x: 4000 }),
  place('c', 'Garden Café', { type: 'cafe', description: 'Coffee ceremony', hours: { mon: [], tue: [], wed: [], thu: [], fri: [], sat: [], sun: [] } }),
  place('w', 'Toilets North', {}),
  place('p', 'Kids playground', {}),
  place('k', 'Car park B', {}),
];

describe('categories', () => {
  it('guesses from everyday names when no type is set', () => {
    expect(places.map(p => p.category)).toEqual(['attractions', 'gardens', 'food', 'restrooms', 'family', 'parking']);
    expect(categoryOf(null, 'Main Gate')).toBe('entrances');
    expect(categoryOf(null, 'ቡና ቤት')).toBe('food');
  });
  it('reads what a search is asking for', () => {
    expect(categoryFromQuery('toilet')).toBe('restrooms');
    expect(categoryFromQuery('Coffee')).toBe('food');
    expect(categoryFromQuery('ሽንት')).toBe('restrooms');
    expect(categoryFromQuery('museum')).toBe('attractions');
    expect(categoryFromQuery('xyz')).toBeNull();
  });
});

describe('search', () => {
  const content = [
    { id: 'e', title: 'Coffee ceremony', kind: 'event', summary: 'Every afternoon' },
    { id: 's', title: 'The palace story', kind: 'story', body: 'Built in 1890…' },
  ];
  it('ranks name matches first, then category words, then descriptions', () => {
    const r = searchVenue('garden', places, content);
    expect(r.places.map(p => p.id)).toEqual(['g', 'c']); // the garden itself beats a café named after it
  });
  it('finds restrooms for "toilet" even when nobody wrote that word', () => {
    expect(searchVenue('wc', places, []).places.map(p => p.id)).toEqual(['w']);
    expect(searchVenue('bathroom', places, []).places.map(p => p.id)).toEqual(['w']);
  });
  it('searches events and stories too, and needs every word to match', () => {
    const r = searchVenue('coffee', places, content);
    expect(r.places.map(p => p.id)).toEqual(['c']);
    expect(r.content.map(c => c.id)).toEqual(['e']);
    expect(searchVenue('palace 1890', places, content).content.map(c => c.id)).toEqual(['s']);
    expect(searchVenue('museum garden', places, content).places).toEqual([]);
  });
  it('ignores accents', () => {
    expect(searchVenue('cafe', places, []).places[0].id).toBe('c');
  });
});

describe('recommendations and collections', () => {
  it('suggests featured, open, well-described places first and skips facilities', () => {
    const r = recommend(places, { pxPerMeter: P, now: new Date(2026, 9, 5, 10) });
    expect(r[0].id).toBe('m');
    expect(r.map(p => p.id)).not.toContain('w');
    expect(r.indexOf(places[2])).toBe(r.length - 1); // the café is closed all week
  });
  it('builds collections, leaving empty ones out', () => {
    const cs = collections(places, [
      { id: 'e', kind: 'event', title: 'Coffee ceremony', ends_at: '2099-01-01T00:00:00Z' },
      { id: 'old', kind: 'event', title: 'Last year', ends_at: '2020-01-01T00:00:00Z' },
      { id: 't', kind: 'tour', title: 'Highlights', stops: ['m', 'g'] },
    ], { pxPerMeter: P });
    expect(cs.map(c => c.id)).toEqual(['popular', 'museums', 'gardens', 'family', 'food', 'events', 'tour:t']);
    expect(cs.find(c => c.id === 'events')!.contentIds).toEqual(['e']);
    expect(cs[0].cover).toBe('m.jpg');
  });
  it('walking time', () => {
    expect(walkMinutes(10)).toBe(1);
    expect(walkMinutes(460)).toBe(8);
  });
});

describe('geofences', () => {
  const fences: Fence[] = [
    { id: 'garden', name: 'Historic Garden', floorId: 'f', center: { x: 200, y: 200 }, polygon: [{ x: 0, y: 0 }, { x: 400, y: 0 }, { x: 400, y: 400 }, { x: 0, y: 400 }], radiusPx: 0 },
    { id: 'cafe', name: 'Café', floorId: 'f', center: { x: 300, y: 300 }, radiusPx: 80 },
  ];
  it('greets once on entering, never again on the way back', () => {
    const t = new GeofenceTracker(fences);
    expect(t.update({ x: -50, y: 50, floorId: 'f' })).toEqual([]);
    expect(t.update({ x: 50, y: 50, floorId: 'f' }).map(f => f.id)).toEqual(['garden']);
    expect(t.update({ x: 60, y: 60, floorId: 'f' })).toEqual([]);
    expect(t.update({ x: 290, y: 310, floorId: 'f' }).map(f => f.id)).toEqual(['cafe']);
    expect(t.update({ x: -50, y: 50, floorId: 'f' })).toEqual([]);
    expect(t.update({ x: 50, y: 50, floorId: 'f' })).toEqual([]);
  });
  it('greets the innermost place when two start at once, and remembers both', () => {
    const t = new GeofenceTracker(fences);
    expect(t.update({ x: 300, y: 300, floorId: 'f' }).map(f => f.id)).toEqual(['cafe']);
    expect([...t.seen].sort()).toEqual(['cafe', 'garden']);
  });
  it('ignores other floors and remembers earlier visits', () => {
    expect(new GeofenceTracker(fences).update({ x: 50, y: 50, floorId: 'other' })).toEqual([]);
    expect(new GeofenceTracker(fences, new Set(['garden'])).update({ x: 50, y: 50, floorId: 'f' })).toEqual([]);
  });
  it('suggests the nearest unvisited place with a walking time', () => {
    const s = nearbySuggestion({ x: 0, y: 0, floorId: 'f' }, places.filter(p => p.featured || p.category === 'gardens'), new Set(), P)!;
    expect(s.place.id).toBe('m');
    expect(s.minutes).toBe(1);
    expect(nearbySuggestion({ x: 0, y: 0, floorId: 'f' }, places.filter(p => p.id === 'm'), new Set(['m']), P)).toBeNull();
  });
});
