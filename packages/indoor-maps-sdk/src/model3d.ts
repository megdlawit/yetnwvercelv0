// The API's building payload → the shared indoor model (@ethi/indoor-core),
// so the SDK renders and navigates exactly as the visitor app does.
// Schematic venues (floor plans) and geo-native ones (lat/lng paths) both work.

import { fromGeo, fromPlan, type IndoorVenue, type PlanRows } from '@ethi/indoor-core';
import type { IndoorMapGraph } from './types';

export function venueFromGraph(g: IndoorMapGraph): IndoorVenue | null {
  const v = g.venue;
  if (v && v.floors.length) {
    const rows: PlanRows = {
      building: { id: g.buildingId, name: g.building?.name ?? '', origin_lat: g.building?.originLat, origin_lng: g.building?.originLng },
      floors: v.floors.map(f => ({ id: f.id, name: f.name, level: f.level, elevation_m: f.elevationM, ceiling_height_m: f.ceilingHeightM, name_am: f.nameAm })),
      walls: v.floors.flatMap(f => f.walls3d?.length
        ? f.walls3d.map(w => ({ id: w.id, floor_id: f.id, x1: w.x1, y1: w.y1, x2: w.x2, y2: w.y2, thickness_m: w.thicknessM, height_m: w.heightM, material: w.material }))
        : f.walls.map(([x1, y1, x2, y2], i) => ({ id: `${f.id}:w${i}`, floor_id: f.id, x1, y1, x2, y2 }))),
      rooms: v.floors.flatMap(f => f.rooms.map(r => {
        const xs = r.outline.map(p => p[0]), ys = r.outline.map(p => p[1]);
        return {
          id: r.id, floor_id: f.id, name: r.name, type: r.type, node_id: r.nodeId, polygon: r.outline,
          x: Math.min(...xs), y: Math.min(...ys), width: Math.max(...xs) - Math.min(...xs), height: Math.max(...ys) - Math.min(...ys),
          name_am: r.nameAm, floor_material: r.floorMaterial, has_ceiling: r.hasCeiling,
        };
      })),
      map_features: v.floors.flatMap(f => f.features.map(x => ({
        id: x.id, floor_id: f.id, kind: x.kind, x: x.x, y: x.y, rotation_deg: x.rotationDeg, width: x.width, depth: x.depth, label: x.label,
        wall_id: x.wallId, offset_m: x.offsetM, height_m: x.heightM, sill_m: x.sillM, from_floor_id: x.fromFloorId, to_floor_id: x.toFloorId,
        step_count: x.stepCount, landing: x.landing, accessible: x.accessible, label_am: x.labelAm,
      }))),
      nodes: v.floors.flatMap(f => f.nodes.map(n => ({ id: n.id, floor_id: f.id, name: n.name, x: n.x, y: n.y, is_hallway: n.isHallway }))),
      edges: [
        ...v.floors.flatMap(f => f.edges.map(e => ({ id: e.id, from_node: e.fromNodeId, to_node: e.toNodeId }))),
        ...v.connections.map(c => ({ id: c.id, from_node: c.fromNodeId, to_node: c.toNodeId, connection: c.kind, accessible: c.accessible })),
      ],
    };
    return fromPlan(rows, { pxPerMeter: v.pxPerMeter });
  }
  if (g.indoorKind === 'geo' && g.nodes.length) {
    return fromGeo({
      building: { id: g.buildingId, name: g.building?.name ?? '', origin_lat: g.building?.originLat, origin_lng: g.building?.originLng },
      venue_nodes: g.nodes.map(n => ({ id: n.id, lat: n.lat, lng: n.lng, kind: n.kind })),
      venue_paths: g.paths.map(p => {
        const fromPoi = g.pois.some(x => x.id === p.fromId), toPoi = g.pois.some(x => x.id === p.toId);
        return { id: p.id, path_type: p.pathType, from_node: fromPoi ? null : p.fromId, from_poi: fromPoi ? p.fromId : null, to_node: toPoi ? null : p.toId, to_poi: toPoi ? p.toId : null };
      }),
      pois: g.pois.map(p => ({ id: p.id, name: p.name, description: p.description, category: p.category, lat: p.lat, lng: p.lng, image_url: p.imageUrl })),
    });
  }
  return null;
}
