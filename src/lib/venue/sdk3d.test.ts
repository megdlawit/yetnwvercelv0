// The partner path end to end: database rows → the API's venue payload →
// the SDK's model → the same 3D model and routes the visitor app gets.

import { describe, expect, it } from 'vitest';
import { findRoute as coreRoute, fromPlan } from '@ethi/indoor-core';
import { testVenueRows } from '../../../packages/indoor-core/src/testVenue';
import { buildVenuePayload, type VenueRows } from '../../../supabase/functions/_shared/venuePayload';
import { venueFromGraph } from '../../../packages/indoor-maps-sdk/src/model3d';
import type { IndoorMapGraph } from '../../../packages/indoor-maps-sdk/src/types';

describe('API payload → SDK 3D model', () => {
  const rows = testVenueRows();
  const payload = buildVenuePayload({
    floors: rows.floors as VenueRows['floors'],
    nodes: rows.nodes.map(n => ({ ...n, name: n.name ?? '', is_hallway: !!n.is_hallway })),
    edges: rows.edges.map(e => ({ ...e, weight: 1 })),
    rooms: rows.rooms.map(r => ({ ...r, name: r.name ?? '', type: r.type ?? 'office', node_id: r.node_id ?? null })),
    walls: rows.walls as VenueRows['walls'],
    features: rows.map_features.map(f => ({ ...f, rotation_deg: f.rotation_deg ?? 0, width: f.width ?? null, depth: f.depth ?? null, label: f.label ?? null })),
  });
  const graph = { buildingId: 'b1', floor: 0, building: null, indoorKind: 'schematic', schematic: null, venue: payload, nodes: [], paths: [], pois: [] } as unknown as IndoorMapGraph;
  const fromApi = venueFromGraph(graph)!;
  const direct = fromPlan(rows);

  it('carries the 3D details through the API', () => {
    expect(payload.floors[0].walls3d?.find(w => w.id === 'w-up')).toBeUndefined(); // other floor's wall
    expect(payload.floors[1].walls3d?.find(w => w.id === 'w-up')).toMatchObject({ material: 'glass', thicknessM: 0.1 });
    expect(payload.floors[0].features.find(f => f.id === 'win')).toMatchObject({ wallId: 'w-n', offsetM: 10 });
    expect(payload.floors[0].rooms.find(r => r.id === 'r-cafe')).toMatchObject({ nameAm: 'ካፌ', floorMaterial: 'wood' });
  });

  it('gives the SDK the same building the app sees: floors, stairs, doors', () => {
    expect(fromApi.floors.map(f => [f.id, f.elevation])).toEqual(direct.floors.map(f => [f.id, f.elevation]));
    expect(fromApi.connectors.map(c => [c.id, c.kind, c.steps]).sort()).toEqual(direct.connectors.map(c => [c.id, c.kind, c.steps]).sort());
    expect(fromApi.openings.find(o => o.id === 'door')?.wallId).toBe('w-cafe-e');
    expect(fromApi.walls.find(w => w.id === 'w-up')).toMatchObject({ material: 'glass', thickness: 0.1 });
  });

  it('routes the same way, up the stairs (or by lift step-free)', () => {
    expect(coreRoute(fromApi, 'c', 'g')!.nodeIds).toEqual(coreRoute(direct, 'c', 'g')!.nodeIds);
    expect(coreRoute(fromApi, 'c', 'g', { stepFree: true })!.nodeIds).toContain('lift0');
  });
});
