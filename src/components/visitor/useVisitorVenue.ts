// One published venue, as visitors see it — shared by the home page and the
// full map. Loads the published snapshot (or, for the venue's team with
// ?preview=1, the live data), turns it into places, and keeps it in memory so
// going from the home page's hero to the full map doesn't load it again.
// Venues can be addressed by id or by a readable name ("unity-park").

import { useEffect, useMemo, useState } from 'react';
import { supabase } from '@/integrations/supabase/client';
import type { Tables } from '@/integrations/supabase/types';
import type { NavNode, Room, Wall } from '@/data/types';
import { parsePolygon, type FeatureKind, type MapFeature } from '@/lib/venue/features';
import type { RouteEdge, Connection } from '@/lib/venue/routing';
import { PLACE_TYPES, parseAccessibility, parseHours, type PlaceType } from '@/lib/venue/places';
import { categoryOf } from '@/lib/venue/discover';
import { slugify } from '@/lib/accounts';
import { loadVenueRows, type VenueRows } from './loadVenue';
import { getPackage } from '@/lib/offline/venuePackage';
import type { Floor, Place } from './types';

export type VisitorBuilding = Tables<'buildings'>;

export interface VisitorVenueData {
  building: VisitorBuilding;
  previewing: boolean;
  /** Show floor drawings as last imported (the team's preview, or a venue without a snapshot), not as last published. */
  drawingLive: boolean;
  floors: Floor[];
  nodes: (NavNode & { floorLevel: number })[];
  edges: RouteEdge[];
  rooms: Room[];
  walls: (Wall & { floorId: string })[];
  features: (MapFeature & { floorId: string })[];
  pois: Tables<'pois'>[];
  content: Tables<'venue_content'>[];
  /** Shown from the copy saved on this device (no connection): when it was saved. */
  offlineSavedAt?: string;
}

const cache = new Map<string, Promise<VisitorVenueData | null>>();
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** The request never reached the server (offline, or a network that doesn't let it through). */
class Unreachable extends Error {}
const unreachable = (e: { message?: string } | null) => !!e && /fetch|network|load failed|timed? ?out/i.test(e.message ?? '');

/** Venue id from an id or a readable name ("unity-park"); null if there's no such published venue. */
export async function resolveVenueId(idOrSlug: string): Promise<string | null> {
  if (UUID.test(idOrSlug)) return idOrSlug;
  const { data, error } = await supabase.from('buildings').select('id, name').eq('is_published', true);
  if (unreachable(error)) throw new Unreachable(error!.message);
  return data?.find(b => b.id === idOrSlug)?.id ?? data?.find(b => slugify(b.name) === idOrSlug.toLowerCase())?.id ?? null;
}

/** From the network; with no connection, the copy saved on this device ("Save for offline"), if there is one. */
async function load(idOrSlug: string, preview: boolean): Promise<VisitorVenueData | null> {
  try {
    if (typeof navigator !== 'undefined' && navigator.onLine === false) throw new Unreachable('offline');
    return await loadOnline(idOrSlug, preview);
  } catch (err) {
    const pack = !preview && err instanceof Unreachable ? await getPackage(idOrSlug) : null;
    if (pack) {
      return { ...toVisitorData(pack.building, { ...pack.rows, live: false, teamPreview: false }), offlineSavedAt: pack.savedAt };
    } else {
      throw err;
    }
  }
}

async function loadOnline(idOrSlug: string, preview: boolean): Promise<VisitorVenueData | null> {
  const id = await resolveVenueId(idOrSlug);
  if (!id) return null;
  const { data: b, error } = await supabase.from('buildings').select('*').eq('id', id).maybeSingle();
  if (unreachable(error)) throw new Unreachable(error!.message);
  // RLS only returns unpublished venues to their own editors (shown as a preview).
  if (!b) return null;
  const src = await loadVenueRows(id, b, preview);
  return toVisitorData(b, src);
}

function toVisitorData(b: VisitorBuilding, src: VenueRows): VisitorVenueData {
  const fl = [...src.floors].sort((a, z) => a.level - z.level) as Floor[];
  const levelOf = new Map(fl.map(x => [x.id, x.level] as const));
  return {
    // Published hero/theme/position/map-settings fields come from the snapshot (never the draft row's).
    building: (src.live ? b : { ...b, tagline: null, cover_url: null, hero_view: '3d', map_settings: {}, ...src.building }) as VisitorBuilding,
    previewing: src.teamPreview && b.is_published,
    drawingLive: src.live,
    floors: fl,
    // Older imports can leave names empty (null); treat that as "no name".
    nodes: src.nodes.map(x => ({ id: x.id, floorId: x.floor_id, name: x.name ?? '', x: x.x, y: x.y, isHallway: x.is_hallway, floorLevel: levelOf.get(x.floor_id) ?? 0 })),
    // connection / accessible arrive with migration 20260930160000; older rows just lack them
    edges: src.edges.map(x => ({
      id: x.id, fromNodeId: x.from_node, toNodeId: x.to_node, weight: x.weight,
      connection: (x.connection ?? null) as Connection | null, accessible: x.connection ? x.accessible : undefined,
    })),
    rooms: src.rooms.map(x => ({
      id: x.id, floorId: x.floor_id, name: x.name ?? '', nodeId: x.node_id ?? '', x: x.x, y: x.y, width: x.width, height: x.height,
      type: x.type as Room['type'], polygon: parsePolygon(x.polygon),
    })),
    walls: src.walls.map(x => ({ x1: x.x1, y1: x.y1, x2: x.x2, y2: x.y2, floorId: x.floor_id })),
    features: src.map_features.map(x => ({ id: x.id, kind: x.kind as FeatureKind, x: x.x, y: x.y, rotationDeg: x.rotation_deg, width: x.width, depth: x.depth, label: x.label, floorId: x.floor_id })),
    pois: src.pois,
    content: src.content,
  };
}

/** Starts loading a venue early (e.g. as soon as the home page knows which venue it shows). */
export function preloadVisitorVenue(idOrSlug: string, preview = false) {
  const key = `${idOrSlug}|${preview}`;
  if (!cache.has(key)) cache.set(key, load(idOrSlug, preview).catch(err => { cache.delete(key); throw err; }));
  return cache.get(key)!;
}

export function useVisitorVenue(idOrSlug: string | undefined, preview = false) {
  const [data, setData] = useState<VisitorVenueData | null>(null);
  const [state, setState] = useState<'loading' | 'ready' | 'unavailable'>('loading');
  useEffect(() => {
    if (!idOrSlug) return;
    let live = true;
    setState('loading');
    preloadVisitorVenue(idOrSlug, preview)
      .then(d => { if (!live) return; setData(d); setState(d ? 'ready' : 'unavailable'); })
      .catch(err => { console.error('Venue load failed:', err); if (live) setState('unavailable'); });
    return () => { live = false; };
  }, [idOrSlug, preview]);

  const derived = useMemo(() => (data ? derivePlaces(data) : null), [data]);
  return { state, data, ...(derived ?? { places: [] as Place[], placeById: new Map<string, Place>(), floorById: new Map<string, Floor>(), roomByNode: new Map<string, Room>() }) };
}

/** Map spots enriched with the institution's details; hidden places are left out. */
export function derivePlaces(d: Pick<VisitorVenueData, 'nodes' | 'rooms' | 'pois' | 'floors'>) {
  const floorById = new Map(d.floors.map(f => [f.id, f] as const));
  const roomByNode = new Map(d.rooms.filter(r => r.nodeId).map(r => [r.nodeId, r] as const));
  const places: Place[] = d.nodes.flatMap(n => {
    const room = roomByNode.get(n.id);
    const poi = d.pois.find(p => p.node_id === n.id);
    const name = poi?.name?.trim() || room?.name?.trim() || (n.name ?? '').trim();
    if (n.isHallway || !name || poi?.is_visible === false) return [];
    const fl = floorById.get(n.floorId);
    const type = poi?.place_type && poi.place_type in PLACE_TYPES ? poi.place_type as PlaceType : null;
    return [{
      id: n.id, name, floorId: n.floorId, floorName: fl?.name ?? '', floorLevel: fl?.level ?? 0, x: n.x, y: n.y, room,
      type, category: categoryOf(type, name, room?.type), description: poi?.description, poiId: poi?.id,
      typeLabel: type ? (type === 'custom' && poi?.custom_type ? poi.custom_type : PLACE_TYPES[type].label) : undefined,
      images: poi?.images?.length ? poi.images : poi?.image_url ? [poi.image_url] : [],
      hours: parseHours(poi?.opening_hours), access: parseAccessibility(poi?.accessibility),
      navigable: poi?.navigable ?? true, featured: poi?.is_featured ?? false,
      gps: poi?.lat != null && poi?.lng != null ? { lat: poi.lat, lng: poi.lng } : null,
      greetRadiusM: poi?.trigger_radius ?? 0,
      poiCategory: poi?.category ?? null, poiSubcategory: poi?.subcategory ?? null,
      trust: poi ? { trust_level: poi.trust_level, verified_at: poi.verified_at, checked_at: poi.checked_at, responsible_party: poi.responsible_party,
        verified_until: poi.verified_until ?? null, verification_scope: poi.verification_scope ?? null } : undefined,
    }];
  });
  return { places, placeById: new Map(places.map(p => [p.id, p] as const)), floorById, roomByNode };
}

/** A QR / link entry point: a place id, or a place's readable name ("main-entrance"). */
export function resolveEntry(entry: string | null, places: Place[]): string | null {
  if (!entry) return null;
  return places.find(p => p.id === entry)?.id ?? places.find(p => slugify(p.name) === entry.toLowerCase())?.id ?? null;
}
