// A venue's places as the institution manages them: every named place on the
// map (a non-hallway path node) plus the details row (`pois`) that describes
// it. A place on the map has no details row until someone first edits it.

import { PLACE_TYPES, placeTypeOf, type PlaceType } from './places';

export interface PlaceNodeLike { id: string; floorId: string; name: string; isHallway: boolean }
export interface PlaceRoomLike { name: string; nodeId: string | null }
export interface PoiLike {
  id: string; node_id: string | null; floor_id?: string | null; name: string; category: string;
  place_type?: string | null; custom_type?: string | null; is_visible?: boolean; navigable?: boolean; is_featured?: boolean;
}

export interface PlaceEntry<P extends PoiLike = PoiLike> {
  /** Stable list key: the details row id, else `node:<node id>`. */
  key: string;
  poi: P | null;
  nodeId: string | null;
  floorId: string | null;
  name: string;
  type: PlaceType;
  typeLabel: string;
  visible: boolean;
  navigable: boolean;
  featured: boolean;
}

export function venuePlaces<P extends PoiLike>(nodes: PlaceNodeLike[], rooms: PlaceRoomLike[], pois: P[]): PlaceEntry<P>[] {
  const roomName = new Map(rooms.filter(r => r.nodeId && (r.name ?? '').trim()).map(r => [r.nodeId!, r.name] as const));
  const nodeById = new Map(nodes.map(n => [n.id, n] as const));
  const poiByNode = new Map(pois.filter(p => p.node_id).map(p => [p.node_id!, p] as const));
  const out: PlaceEntry<P>[] = [];

  const entry = (poi: P | null, nodeId: string | null, floorId: string | null, mapName: string): PlaceEntry<P> => {
    const name = poi?.name?.trim() || mapName;
    const type = placeTypeOf({ place_type: poi?.place_type, category: poi?.category, name });
    return {
      key: poi?.id ?? `node:${nodeId}`, poi, nodeId, floorId, name, type,
      typeLabel: type === 'custom' && poi?.custom_type ? poi.custom_type : PLACE_TYPES[type].label,
      visible: poi?.is_visible ?? true, navigable: poi?.navigable ?? true, featured: poi?.is_featured ?? false,
    };
  };

  for (const n of nodes) {
    if (n.isHallway) continue;
    const mapName = roomName.get(n.id) || (n.name ?? '').trim();
    const poi = poiByNode.get(n.id) ?? null;
    if (!mapName && !poi) continue;
    out.push(entry(poi, n.id, n.floorId, mapName));
  }
  // Details rows whose place isn't on the map (outdoor-only, or its node was removed).
  for (const p of pois) {
    if (p.node_id && nodeById.has(p.node_id) && !nodeById.get(p.node_id)!.isHallway) continue;
    out.push(entry(p, p.node_id && nodeById.has(p.node_id) ? p.node_id : null, p.floor_id ?? null, p.name));
  }
  return out.sort((a, b) => a.name.localeCompare(b.name));
}
