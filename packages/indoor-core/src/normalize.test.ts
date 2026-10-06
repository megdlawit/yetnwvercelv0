import { describe, expect, it } from 'vitest';
import { fromGeo, fromPlan } from './normalize';
import { geoToModel, modelToGeo } from './geo';
import { testVenueRows } from './testVenue';

describe('fromPlan', () => {
  const venue = fromPlan(testVenueRows(), { wallHeight: 3 });
  const floor = (id: string) => venue.floors.find(f => f.id === id)!;

  it('puts plan pixels into metres and stacks floors bottom to top', () => {
    expect(venue.floors.map(f => f.id)).toEqual(['f0', 'f1']);
    expect(floor('f0').elevation).toBe(0);
    expect(floor('f1').elevation).toBe(3.5);
    expect(floor('f1').name).toEqual({ en: 'First', am: 'አንደኛ ፎቅ' });
    const n = venue.nodes.find(x => x.id === 'c')!;
    expect(n.at).toEqual({ x: 3, z: 6 });
  });

  it('gives walls their thickness, height and material, defaulting to the venue', () => {
    const w = venue.walls.find(x => x.id === 'w-n')!;
    expect(w).toMatchObject({ thickness: 0.18, height: 3, material: 'plaster' });
    expect(venue.walls.find(x => x.id === 'w-up')).toMatchObject({ thickness: 0.1, material: 'glass' });
  });

  it('cuts an unanchored door into the nearest wall, and keeps an anchored window where it was put', () => {
    const door = venue.openings.find(o => o.id === 'door')!;
    expect(door.wallId).toBe('w-cafe-e');
    expect(door.offset).toBeCloseTo(6);
    expect(door.at).toEqual({ x: 6, z: 6 });
    expect(door.width).toBe(0.9);
    const win = venue.openings.find(o => o.id === 'win')!;
    expect(win).toMatchObject({ wallId: 'w-n', offset: 10, sill: 0.9, kind: 'window' });
  });

  it('marks a corridor edge through a doorway as a door', () => {
    expect(venue.edges.find(e => e.id === 'e-c-h1')!.kind).toBe('door');
    expect(venue.edges.find(e => e.id === 'e-h1-h2')!.kind).toBe('walk');
  });

  it('joins a drawn stair to the floor change that climbs it, bottom at the lower path point', () => {
    const st = venue.connectors.find(c => c.id === 'stairs')!;
    expect(st).toMatchObject({ kind: 'stairs', fromFloorId: 'f0', toFloorId: 'f1', drawn: true, accessible: false });
    expect(st.dir.x).toBeCloseTo(1);
    expect(st.bottom.x).toBeCloseTo(14.5);
    expect(st.top.x).toBeCloseTo(17.5);
    expect(st.steps).toBe(Math.round(3.5 / 0.17));
    const e = venue.edges.find(x => x.id === 'e-stairs')!;
    expect(e).toMatchObject({ kind: 'stairs', connectorId: 'stairs', accessible: false });
    // 0.5 m to the bottom step, the flight itself, then 0 m off the top.
    expect(e.length).toBeCloseTo(0.5 + Math.hypot(3, 3.5) + 0);
  });

  it('works out a lift nobody drew from its two ends', () => {
    const lift = venue.connectors.find(c => c.kind === 'elevator')!;
    expect(lift).toMatchObject({ drawn: false, fromFloorId: 'f0', toFloorId: 'f1', accessible: true });
    expect(venue.edges.find(e => e.id === 'e-lift')).toMatchObject({ kind: 'elevator', accessible: true, connectorId: lift.id });
  });

  it('links places to their room and language, and drops hidden ones', () => {
    expect(venue.pois.map(p => p.id)).toEqual(['p-cafe', 'p-gal']);
    expect(venue.pois[0]).toMatchObject({ roomId: 'r-cafe', floorId: 'f0', name: { en: 'Café', am: 'ካፌ' }, blurb: { en: 'Coffee and cake' } });
    expect(venue.pois[1]).toMatchObject({ roomId: 'r-gal', floorId: 'f1', images: ['a.jpg'] });
  });

  it('keeps the plan on the earth with its anchor', () => {
    expect(venue.geo).toMatchObject({ lat: 9.03, lng: 38.76, rotationDeg: 0, scale: 1 });
  });
});

describe('fromGeo', () => {
  it('turns lat/lng paths into one ground level in metres, places included', () => {
    const v = fromGeo({
      building: { id: 'park', name: 'Park', origin_lat: 9, origin_lng: 38 },
      venue_nodes: [{ id: 'a', lat: 9, lng: 38 }, { id: 'b', lat: 9.0001, lng: 38, kind: 'entrance' }],
      venue_paths: [{ id: 'p1', from_node: 'a', to_node: 'b' }, { id: 'p2', from_node: 'b', to_poi: 'lake', path_type: 'steps' }],
      pois: [{ id: 'lake', name: 'Lake', lat: 9.0001, lng: 38.0001 }],
    });
    expect(v.floors).toHaveLength(1);
    const b = v.nodes.find(n => n.id === 'b')!;
    expect(b.at.x).toBeCloseTo(0);
    expect(b.at.z).toBeCloseTo(-11.12, 1); // north is up the plan (−z)
    expect(v.edges.find(e => e.id === 'p2')).toMatchObject({ accessible: false });
    expect(v.pois[0].nodeId).toBe('poi:lake');
  });
});

describe('geo frame', () => {
  it('round-trips and matches a rotated plan', () => {
    const frame = { lat: 9.03, lng: 38.76, rotationDeg: 30 };
    const p = { x: 12, z: -7 };
    const g = modelToGeo(frame, p);
    const back = geoToModel(frame, g.lat, g.lng);
    expect(back.x).toBeCloseTo(12, 6);
    expect(back.z).toBeCloseTo(-7, 6);
  });
});
