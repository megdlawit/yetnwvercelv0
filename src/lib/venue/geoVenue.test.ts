import { describe, expect, it } from 'vitest';
import { anchorForCenter, anchorOf, DEFAULT_MPP, footprint, insideRing, planBounds, venueGeoJSON } from './geoVenue';
import { geoToIndoor, haversineMeters, indoorToGeo } from '@/lib/geo/GeoMath';
import type { Room } from '@/data/types';

const UNITY = { lat: 9.0303, lng: 38.7612 };

describe('venue on the world map', () => {
  it('reads anchors, treating the database default scale as unset', () => {
    expect(anchorOf({ origin_lat: null, origin_lng: 38 })).toBeNull();
    expect(anchorOf({ origin_lat: 9, origin_lng: 38, meters_per_pixel: 1 })!.metersPerPixel).toBe(DEFAULT_MPP);
    expect(anchorOf({ origin_lat: 9, origin_lng: 38, meters_per_pixel: 0.02, rotation_deg: 30 })).toEqual({ originLat: 9, originLng: 38, rotationDeg: 30, metersPerPixel: 0.02 });
  });

  it('puts the chosen plan point exactly at the map centre, at any rotation', () => {
    for (const rot of [0, 37, 180, 271]) {
      const a = anchorForCenter(UNITY, { x: 800, y: -300 }, rot);
      const g = indoorToGeo(a, 800, -300);
      expect(haversineMeters(g, UNITY)).toBeLessThan(0.01);
      const back = geoToIndoor(a, UNITY);
      expect(back.x).toBeCloseTo(800, 3); expect(back.y).toBeCloseTo(-300, 3);
    }
  });

  it('keeps real distances: 400 px is 10 m', () => {
    const a = anchorForCenter(UNITY, { x: 0, y: 0 }, 25);
    expect(haversineMeters(indoorToGeo(a, 0, 0), indoorToGeo(a, 400, 0))).toBeCloseTo(10, 2);
  });

  it('turns walls into 30 cm thick polygons, rooms into rings and places into points', () => {
    const a = anchorForCenter(UNITY, { x: 0, y: 0 }, 0);
    const room: Room = { id: 'r', floorId: 'f', name: 'Café', nodeId: 'n', x: 0, y: 0, width: 400, height: 200, type: 'office' };
    const g = venueGeoJSON(a, { walls: [{ x1: 0, y1: 0, x2: 400, y2: 0 }], rooms: [room], places: [{ id: 'n', name: 'Café', x: 200, y: 100 }], paths: [] }, { venue: 'v' });
    const ring = g.walls.features[0].geometry.coordinates as number[][][];
    const width = haversineMeters({ lng: ring[0][0][0], lat: ring[0][0][1] }, { lng: ring[0][3][0], lat: ring[0][3][1] });
    expect(width).toBeCloseTo(0.3, 2);
    expect((g.rooms.features[0].geometry.coordinates as number[][][])[0]).toHaveLength(5);
    expect(g.places.features[0].properties).toMatchObject({ id: 'n', name: 'Café', venue: 'v' });
  });

  it('knows when a point is inside the venue footprint', () => {
    const a = anchorForCenter(UNITY, { x: 200, y: 100 }, 45);
    const b = planBounds([{ x1: 0, y1: 0, x2: 400, y2: 200 }], [])!;
    const ring = footprint(a, b);
    expect(insideRing(ring, UNITY)).toBe(true);
    expect(insideRing(ring, { lat: UNITY.lat + 0.001, lng: UNITY.lng })).toBe(false); // ~110 m north
  });
});
