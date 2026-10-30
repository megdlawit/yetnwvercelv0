// A published venue in the shape the explore map and its navigation engine
// use (Building / POI), so /venue/:id gets exactly the /explore experience —
// floor map, outdoor map, turn-by-turn with step counting — on that venue's
// published data only.

import type { Building, Floor as NavFloor, NavEdge } from '@/data/types';
import type { POI, POICategory } from '@/data/poi';
import type { VisitorCategory } from '@/lib/venue/discover';
import { VISITOR_CATEGORIES } from '@/lib/venue/discover';
import { anchorOf } from '@/lib/venue/geoVenue';
import { indoorToGeo } from '@/lib/geo/GeoMath';
import { EDITOR_PX_PER_METER, planExtent, sanitizeMetersPerPixel } from '@/lib/navScale';
import type { VisitorVenueData } from './useVisitorVenue';
import type { Place } from './types';

/** A stair or lift object joins the floors at a path point within this distance of it. */
const CONNECTOR_REACH_M = 6;

const POI_CATEGORY: Record<VisitorCategory, POICategory> = {
  attractions: 'attraction', gardens: 'attraction', family: 'attraction', food: 'retail', shops: 'retail', stays: 'service',
  restrooms: 'service', parking: 'service', entrances: 'service', facilities: 'service',
};

export function toExploreBuilding(d: VisitorVenueData): Building {
  const b = d.building;
  const metersPerPixel = sanitizeMetersPerPixel(b.meters_per_pixel);
  const anchor = anchorOf(b);
  const floors: NavFloor[] = d.floors.map(f => {
    const nodes = d.nodes.filter(n => n.floorId === f.id).map(n => ({ id: n.id, floorId: n.floorId, name: n.name, x: n.x, y: n.y, isHallway: n.isHallway }));
    const ids = new Set(nodes.map(n => n.id));
    // Every edge touching this floor — one between floors (stairs, lift) joins the two.
    const edges: NavEdge[] = d.edges.filter(e => ids.has(e.fromNodeId) || ids.has(e.toNodeId))
      .map(e => ({ id: e.id, fromNodeId: e.fromNodeId, toNodeId: e.toNodeId, weight: e.weight }));
    // Rooms the visitor can tap (each leads to a spot on the paths).
    const rooms = d.rooms.filter(r => r.floorId === f.id && r.nodeId && ids.has(r.nodeId));
    const walls = d.walls.filter(w => w.floorId === f.id).map(({ x1, y1, x2, y2 }) => ({ x1, y1, x2, y2 }));
    const extent = planExtent([...nodes, ...rooms, ...walls.flatMap(w => [{ x: w.x1, y: w.y1 }, { x: w.x2, y: w.y2 }])]);
    return { id: f.id, buildingId: b.id, level: f.level, name: f.name, ...extent, nodes, edges, rooms, walls };
  });
  const widest = Math.max(...floors.map(f => Math.max(f.width, f.height)), 0);
  // Stairs and lifts drawn as objects (what imports produce): each joins the
  // floors at the path point nearest to it.
  const connectors: NonNullable<Building['connectors']> = [];
  for (const f of floors) {
    for (const ft of d.features.filter(x => x.floorId === f.id && (x.kind === 'stairs' || x.kind === 'elevator'))) {
      let best: { id: string; d: number } | null = null;
      for (const n of f.nodes) {
        const dd = Math.hypot(n.x - ft.x, n.y - ft.y);
        if (!best || dd < best.d) best = { id: n.id, d: dd };
      }
      if (best && best.d <= CONNECTOR_REACH_M * EDITOR_PX_PER_METER) connectors.push({ nodeId: best.id, floorId: f.id, type: ft.kind as 'stairs' | 'elevator' });
    }
  }
  return {
    id: b.id,
    name: b.name,
    address: b.tagline ?? b.description ?? '',
    city: '',
    floors,
    originLat: anchor?.originLat ?? null,
    originLng: anchor?.originLng ?? null,
    rotationDeg: b.rotation_deg ?? 0,
    // Where the plan sits on the world map (set by eye against satellite imagery).
    metersPerPixel,
    // The plan's own scale — what the editor measures — for steps, distances and arrival.
    planPxPerMeter: EDITOR_PX_PER_METER,
    connectors,
    radiusM: Math.max(35, Math.round((widest * metersPerPixel) / 2)),
  };
}

/** Every visible place as a map pin, plus the venue's outdoor-only spots. */
export function toExplorePois(d: VisitorVenueData, places: Place[]): POI[] {
  const rows = new Map(d.pois.map(p => [p.id, p] as const));
  const indoor: POI[] = places.map(p => {
    const row = p.poiId ? rows.get(p.poiId) : undefined;
    return {
      id: p.poiId ?? p.id,
      nodeId: p.id,
      buildingId: d.building.id,
      name: p.name,
      description: p.description ?? '',
      category: POI_CATEGORY[p.category],
      subcategory: p.typeLabel ?? VISITOR_CATEGORIES[p.category].label,
      imageUrl: p.images[0] ?? null,
      audioUrl: row?.audio_url ?? null,
      isFeatured: p.featured,
      // Metres — the navigation engine measures indoor distances in metres for scaled plans.
      triggerRadius: p.greetRadiusM > 0 ? p.greetRadiusM : 5,
      promotions: [],
      lat: p.gps?.lat ?? null,
      lng: p.gps?.lng ?? null,
      isOutdoor: false,
    };
  });
  const outdoor: POI[] = d.pois
    .filter(r => !r.node_id && r.is_outdoor && r.lat != null && r.lng != null && r.is_visible !== false)
    .map(r => ({
      id: r.id, nodeId: null, buildingId: d.building.id, name: r.name, description: r.description ?? '',
      category: (['retail', 'attraction', 'service', 'education'].includes(r.category) ? r.category : 'attraction') as POICategory,
      subcategory: r.subcategory ?? '', imageUrl: r.images?.[0] ?? r.image_url ?? null, audioUrl: r.audio_url ?? null,
      isFeatured: !!r.is_featured, triggerRadius: r.trigger_radius ?? 20, promotions: [],
      lat: r.lat, lng: r.lng, isOutdoor: true,
    }));
  return [...indoor, ...outdoor];
}

/** Where outdoor walking directions should lead: the (step-free) entrance, else the venue itself. */
export function venueArrivalPoint(d: VisitorVenueData, places: Place[]): { lat: number; lng: number; name: string } | null {
  const anchor = anchorOf(d.building);
  if (!anchor) return null;
  const entrance = places.find(p => p.category === 'entrances' && (p.access.stepFree || p.access.wheelchair)) ?? places.find(p => p.category === 'entrances');
  if (entrance?.gps) return { ...entrance.gps, name: `${d.building.name} — ${entrance.name}` };
  if (entrance) return { ...indoorToGeo(anchor, entrance.x, entrance.y), name: `${d.building.name} — ${entrance.name}` };
  return { lat: anchor.originLat, lng: anchor.originLng, name: d.building.name };
}
