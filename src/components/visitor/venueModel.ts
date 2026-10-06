// The whole venue (every floor, stairs between them) in the shared engine's
// metre model, from what the map page already has: the Building the
// navigation engine routes on, the venue's 3D objects, and BuildingGraph's
// own floor joins — so the 3D route climbs exactly the stairs the app routes
// over.

import { fromPlan, type IndoorVenue, type PlanRows } from '@ethi/indoor-core';
import type { Building } from '@/data/types';
import type { MapFeature } from '@/lib/venue/features';
import type { BuildingGraph } from '@/lib/BuildingGraph';
import { pxPerMeterOf } from '@/lib/navScale';

export function venueModel(building: Building, features: (MapFeature & { floorId: string })[], graph: BuildingGraph | null, wallHeight?: number): IndoorVenue {
  const seen = new Set<string>();
  const edges: PlanRows['edges'] = [];
  for (const f of building.floors) for (const e of f.edges) {
    if (seen.has(e.id)) continue;
    seen.add(e.id);
    edges.push({ id: e.id, from_node: e.fromNodeId, to_node: e.toNodeId });
  }
  for (const c of graph?.getCrossFloorEdges() ?? []) edges.push({ id: c.id, from_node: c.fromNodeId, to_node: c.toNodeId, connection: c.type });

  const rows: PlanRows = {
    building: { id: building.id, name: building.name, origin_lat: building.originLat, origin_lng: building.originLng, rotation_deg: building.rotationDeg, meters_per_pixel: building.metersPerPixel },
    floors: building.floors.map(f => ({ id: f.id, name: f.name, level: f.level })),
    walls: building.floors.flatMap(f => f.walls.map((w, i) => ({ id: (w as typeof w & { id?: string }).id ?? `${f.id}:w${i}`, floor_id: f.id, x1: w.x1, y1: w.y1, x2: w.x2, y2: w.y2 }))),
    rooms: building.floors.flatMap(f => f.rooms.map(r => ({ id: r.id, floor_id: f.id, name: r.name, x: r.x, y: r.y, width: r.width, height: r.height, type: r.type, node_id: r.nodeId || null, polygon: r.polygon?.map(p => [p.x, p.y]) }))),
    map_features: features.map(f => ({ id: f.id, floor_id: f.floorId, kind: f.kind, x: f.x, y: f.y, rotation_deg: f.rotationDeg, width: f.width, depth: f.depth, label: f.label })),
    nodes: building.floors.flatMap(f => f.nodes.map(n => ({ id: n.id, floor_id: f.id, name: n.name, x: n.x, y: n.y, is_hallway: n.isHallway }))),
    edges,
  };
  const ppm = pxPerMeterOf(building);
  return fromPlan(rows, { pxPerMeter: ppm > 1 ? ppm : 40, wallHeight });
}
