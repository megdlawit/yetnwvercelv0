import { describe, expect, it } from 'vitest';
import { venueHealth } from './health';

const empty = { counts: { walls: 0, rooms: 0, imported: 0 }, rooms: [], edges: [], places: [], unreachable: 0, content: [], published: false, publishedAt: null };

describe('venue health', () => {
  it('a brand-new venue has everything left to do', () => {
    const h = venueHealth(empty);
    expect(h.hasMap).toBe(false);
    expect(h.setupPct).toBe(0);
    expect(h.steps.map(s => s.done)).toEqual([false, false, false, false, false, false]);
  });

  it('counts entrances, attractions, events, completeness and problems', () => {
    const poi = (d: string | null, img: boolean) => ({ description: d, images: img ? ['x'] : [] });
    const h = venueHealth({
      counts: { walls: 40, rooms: 3, imported: 40 },
      rooms: [{ name: 'Hall' }, { name: '' }, { name: 'Café' }],
      edges: [1, 2],
      places: [
        { type: 'entrance', nodeId: 'n1', visible: true, poi: poi('Main gate', true) },
        { type: 'garden', nodeId: 'n2', visible: true, poi: poi(null, false) },
        { type: 'cafe', nodeId: 'n3', visible: true, poi: poi('Coffee', false) },
        { type: 'parking', nodeId: null, visible: true, poi: null },
      ],
      unreachable: 1,
      content: [
        { kind: 'event', is_published: true, starts_at: null, ends_at: '2026-10-10T00:00:00Z' },
        { kind: 'event', is_published: true, starts_at: null, ends_at: '2026-09-01T00:00:00Z' },
      ],
      published: true, publishedAt: '2026-10-01T00:00:00Z',
    }, new Date('2026-10-02T00:00:00Z'));
    expect(h.entryPoints).toHaveLength(1);       // parking isn't on the map
    expect(h.attractions).toHaveLength(1);
    expect(h.upcomingEvents).toHaveLength(1);
    expect(h.contentPct).toBe(38);               // 2 described + 1 photo of 4 places × 2
    expect(h.unresolved).toBe(3);                // unnamed area + unreachable + off the map
    expect(h.setupPct).toBe(100);
  });
});
