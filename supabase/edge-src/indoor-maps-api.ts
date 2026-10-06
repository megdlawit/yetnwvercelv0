// supabase/functions/indoor-maps-api/index.ts
//
// Public API for @ethi/indoor-maps-sdk. Partners send an `x-api-key` header;
// we validate it against partner_keys (service-role client, never exposed
// to the client), scope the request to that key's allowed buildings, and
// return only the shape defined in packages/indoor-maps-sdk/src/types.ts —
// never raw table rows. This is deliberately the *only* thing a partner
// bundle ever talks to; it never sees SUPABASE_URL/anon key.
//
// A building's indoor content comes from one of two systems, same as the
// main app:
//   - schematic (nodes/floors/edges, x/y pixels) → rendered as a real floor
//     plan (FloorMap), same component the main app uses. This is the common
//     case, and fully replaces the map background — no map tiles at all.
//   - geo (venue_nodes/venue_paths, lat/lng)      → rendered zoomed into the
//     real map. Used only for buildings that have a geo-native walkway graph
//     and no authored floor plan (e.g. the outdoor venue's own building).
//
// Routes:
//   GET /buildings/:id/graph
//     → { buildingId, floor, building, indoorKind, nodes, paths, pois, schematic, venue }
//     `venue` is the whole multi-floor building (every floor's places, paths,
//     rooms, walls and objects, plus the stairs / lifts / ramps between
//     floors); `schematic` remains the single requested floor, unchanged.
//   GET /buildings/:id/route?from=<placeId>&to=<placeId>[&stepFree=1]
//     → { found, path, steps, metres, minutes } — across floors, optionally step-free.

import { createClient, type SupabaseClient } from 'https://esm.sh/@supabase/supabase-js@2';
import { findRoute, directions } from '../functions/_shared/routing.ts';
import { buildVenuePayload, routingGraph, PX_PER_METER, type VenueRows } from '../functions/_shared/venuePayload.ts';

const SUPABASE_URL = Deno.env.get('SUPABASE_URL')!;
const SERVICE_ROLE_KEY = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;

const CORS_HEADERS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'content-type, x-api-key',
  'Access-Control-Allow-Methods': 'GET, OPTIONS',
};

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...CORS_HEADERS, 'content-type': 'application/json' },
  });
}

// Haversine distance in meters — mirrors src/lib/geo/GeoMath.ts, since
// venue_paths doesn't store distance (it's derived), and this function
// can't import from the app's src directly (separate Deno runtime).
function haversineMeters(a: { lat: number; lng: number }, b: { lat: number; lng: number }): number {
  const R = 6371000;
  const toRad = (d: number) => (d * Math.PI) / 180;
  const dLat = toRad(b.lat - a.lat);
  const dLng = toRad(b.lng - a.lng);
  const s =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(toRad(a.lat)) * Math.cos(toRad(b.lat)) * Math.sin(dLng / 2) ** 2;
  return 2 * R * Math.asin(Math.min(1, Math.sqrt(s)));
}

/** Validate the partner key and its scope to this building. Returns an error response, or null when allowed. */
async function authorize(supabase: SupabaseClient, apiKey: string | null, buildingId: string): Promise<Response | null> {
  if (!apiKey) return json({ error: 'Missing x-api-key header' }, 401);
  const { data: keyRow, error: keyErr } = await supabase
    .from('partner_keys')
    .select('id, is_active, allowed_building_ids')
    .eq('api_key', apiKey)
    .maybeSingle();
  if (keyErr) return json({ error: 'Internal error validating API key' }, 500);
  if (!keyRow || !keyRow.is_active) return json({ error: 'Invalid or inactive API key' }, 401);
  const allowed: string[] | null = keyRow.allowed_building_ids;
  if (allowed && allowed.length > 0 && !allowed.includes(buildingId)) {
    return json({ error: 'This API key is not authorized for this building' }, 403);
  }
  return null;
}

/** Every floor's rows for a building. Tables added by newer migrations are optional. */
async function loadVenueRows(supabase: SupabaseClient, buildingId: string): Promise<VenueRows | null> {
  const [floors, nodes, edges, rooms, walls, features] = await Promise.all([
    // Whole rows: the 3D columns (20261006090000) come along once they exist.
    supabase.from('floors').select('*').eq('building_id', buildingId),
    supabase.from('nodes').select('id, floor_id, name, x, y, is_hallway').eq('building_id', buildingId),
    supabase.from('edges').select('*').eq('building_id', buildingId),
    supabase.from('rooms').select('*').eq('building_id', buildingId),
    supabase.from('walls').select('*').eq('building_id', buildingId),
    supabase.from('map_features').select('*').eq('building_id', buildingId),
  ]);
  if (floors.error || nodes.error || edges.error || rooms.error) return null;
  return {
    floors: floors.data ?? [], nodes: nodes.data ?? [], edges: edges.data ?? [], rooms: rooms.data ?? [],
    walls: walls.error ? [] : walls.data ?? [], features: features.error ? [] : features.data ?? [],
  };
}

async function isPublished(supabase: SupabaseClient, buildingId: string) {
  const { data } = await supabase.from('buildings').select('is_published').eq('id', buildingId).maybeSingle();
  return !!data?.is_published;
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response(null, { headers: CORS_HEADERS });

  const url = new URL(req.url);
  const match = url.pathname.match(/\/buildings\/([^/]+)\/(graph|route)\/?$/);
  if (req.method !== 'GET' || !match) {
    return json({ error: 'Not found' }, 404);
  }
  const buildingId = decodeURIComponent(match[1]);
  const supabase = createClient(SUPABASE_URL, SERVICE_ROLE_KEY);
  const denied = await authorize(supabase, req.headers.get('x-api-key'), buildingId);
  if (denied) return denied;

  if (match[2] === 'route') {
    // The service-role client bypasses RLS, so enforce publishing here.
    if (!(await isPublished(supabase, buildingId))) return json({ error: 'Venue not available' }, 404);
    const from = url.searchParams.get('from'), to = url.searchParams.get('to');
    if (!from || !to) return json({ error: 'from and to (place ids) are required' }, 400);
    const rows = await loadVenueRows(supabase, buildingId);
    if (!rows) return json({ error: 'Failed to load building data' }, 500);
    const { nodes, edges } = routingGraph(rows);
    const stepFree = ['1', 'true', 'yes'].includes(url.searchParams.get('stepFree') ?? '');
    const path = findRoute(nodes, edges, from, to, { pxPerMeter: PX_PER_METER, stepFree });
    if (!path) return json({ found: false, path: [], steps: [], metres: 0, minutes: 0 });
    const dest = nodes.find(n => n.id === to)?.name || 'your destination';
    const info = directions(path, PX_PER_METER, dest, edges);
    return json({
      found: true,
      path: path.map(n => ({ placeId: n.id, floorLevel: n.floorLevel, x: n.x, y: n.y })),
      steps: info.steps.map(st => ({ text: st.text, metres: Math.round(st.metres), floorLevel: st.floorLevel, icon: st.icon })),
      metres: Math.round(info.metres), minutes: info.minutes,
    });
  }

  const requestedFloorParam = url.searchParams.get('floor');
  const requestedFloor = requestedFloorParam !== null ? Number(requestedFloorParam) : null;

  // 2. Fetch the building's geo-anchor (for the outdoor "tap to enter" view
  //    — unrelated to indoor rendering) + the geo-native venue graph + POIs.
  const [
    { data: buildingRow, error: buildingErr },
    { data: nodes, error: nodesErr },
    { data: paths, error: pathsErr },
    { data: pois, error: poisErr },
  ] = await Promise.all([
    supabase.from('buildings').select('id, name, origin_lat, origin_lng, is_published').eq('id', buildingId).maybeSingle(),
    supabase.from('venue_nodes').select('id, lat, lng, kind').eq('building_id', buildingId),
    supabase
      .from('venue_paths')
      .select('id, path_type, from_node, to_node, from_poi, to_poi')
      .eq('building_id', buildingId),
    supabase
      .from('pois')
      .select('id, name, description, category, lat, lng, image_url, is_outdoor')
      .eq('building_id', buildingId),
  ]);

  if (buildingErr || nodesErr || pathsErr || poisErr) return json({ error: 'Failed to load building data' }, 500);
  // The service-role client bypasses RLS, so enforce publishing here: an
  // unpublished (or missing) venue is "not available" to partners too.
  if (!buildingRow || !buildingRow.is_published) return json({ error: 'Venue not available' }, 404);

  // A building only gets an outdoor "approach + tap to enter" view once it
  // has a real geo-anchor (origin_lat/origin_lng) — buildings without one
  // skip straight to the indoor-only view.
  const DEFAULT_BUILDING_RADIUS_M = 40; // mirrors src/pages/Index.tsx's venueBuildings fallback
  const building =
    buildingRow && buildingRow.origin_lat != null && buildingRow.origin_lng != null
      ? {
          id: buildingRow.id,
          name: buildingRow.name,
          originLat: buildingRow.origin_lat,
          originLng: buildingRow.origin_lng,
          radiusM: DEFAULT_BUILDING_RADIUS_M,
        }
      : null;

  const nodeById = new Map((nodes ?? []).map((n) => [n.id, n]));
  const poiById = new Map((pois ?? []).filter((p) => p.lat != null && p.lng != null).map((p) => [p.id, p]));

  const endpoint = (nodeId: string | null, poiId: string | null) => {
    if (nodeId) {
      const n = nodeById.get(nodeId);
      return { id: nodeId, lat: n?.lat ?? 0, lng: n?.lng ?? 0 };
    }
    const p = poiById.get(poiId!);
    return { id: poiId!, lat: p?.lat ?? 0, lng: p?.lng ?? 0 };
  };

  const geoNodes = (nodes ?? []).map((n) => ({ id: n.id, lat: n.lat, lng: n.lng, kind: n.kind }));
  const geoPaths = (paths ?? []).map((p) => {
    const from = endpoint(p.from_node, p.from_poi);
    const to = endpoint(p.to_node, p.to_poi);
    return {
      id: p.id,
      fromId: from.id,
      toId: to.id,
      pathType: p.path_type,
      distanceM: haversineMeters(from, to),
    };
  });
  const outdoorPois = (pois ?? []).map((p) => ({
    id: p.id,
    name: p.name,
    description: p.description,
    category: p.category,
    lat: p.lat,
    lng: p.lng,
    imageUrl: p.image_url,
    isOutdoor: !!p.is_outdoor,
  }));

  // 3. Indoor content: prefer the geo-native venue graph if this building
  //    has one; otherwise fall back to the schematic floor-plan system
  //    (nodes/floors/edges) — same rule the main app follows.
  let indoorKind: 'geo' | 'schematic' | 'none' = (nodes ?? []).length > 0 ? 'geo' : 'none';
  let resolvedFloor = 0;
  let schematic: {
    id: string;
    level: number;
    name: string;
    width: number;
    height: number;
    nodes: { id: string; name: string; x: number; y: number; isHallway: boolean }[];
    edges: { id: string; fromNodeId: string; toNodeId: string; weight: number }[];
    pois: { id: string; name: string; description: string; category: string; imageUrl: string | null; nodeId: string }[];
    floors: { id: string; level: number; name: string }[];
  } | null = null;

  if (indoorKind === 'none') {
    const { data: floors, error: floorsErr } = await supabase
      .from('floors')
      .select('id, level, name')
      .eq('building_id', buildingId)
      .order('level', { ascending: true });
    if (floorsErr) return json({ error: 'Failed to load building data' }, 500);

    if (floors && floors.length > 0) {
      indoorKind = 'schematic';
      const targetFloor =
        (requestedFloor !== null ? floors.find((f) => f.level === requestedFloor) : null) ?? floors[0];
      resolvedFloor = targetFloor.level;

      const [
        { data: schematicNodes, error: schematicNodesErr },
        { data: schematicPois, error: schematicPoisErr },
        { data: schematicEdges, error: schematicEdgesErr },
      ] = await Promise.all([
        supabase.from('nodes').select('id, name, x, y, is_hallway').eq('floor_id', targetFloor.id),
        supabase
          .from('pois')
          .select('id, name, description, category, image_url, node_id')
          .eq('building_id', buildingId),
        supabase.from('edges').select('id, from_node, to_node, weight').eq('building_id', buildingId),
      ]);
      if (schematicNodesErr || schematicPoisErr || schematicEdgesErr) {
        return json({ error: 'Failed to load building data' }, 500);
      }

      const floorNodeIds = new Set((schematicNodes ?? []).map((n) => n.id));

      schematic = {
        id: targetFloor.id,
        level: targetFloor.level,
        name: targetFloor.name,
        width: 800, // fixed floor-plan canvas size — mirrors src/hooks/useBuildingLoader.ts
        height: 500,
        nodes: (schematicNodes ?? []).map((n) => ({
          id: n.id,
          name: n.name,
          x: n.x,
          y: n.y,
          isHallway: n.is_hallway,
        })),
        edges: (schematicEdges ?? [])
          .filter((e) => floorNodeIds.has(e.from_node) && floorNodeIds.has(e.to_node))
          .map((e) => ({ id: e.id, fromNodeId: e.from_node, toNodeId: e.to_node, weight: e.weight })),
        pois: (schematicPois ?? [])
          .filter((p) => p.node_id && floorNodeIds.has(p.node_id))
          .map((p) => ({
            id: p.id,
            name: p.name,
            description: p.description,
            category: p.category,
            imageUrl: p.image_url,
            nodeId: p.node_id as string,
          })),
        floors: floors.map((f) => ({ id: f.id, level: f.level, name: f.name })),
      };
    }
  }

  // The whole building, every floor, for multi-floor partners.
  let venue = null;
  if (indoorKind === 'schematic') {
    const rows = await loadVenueRows(supabase, buildingId);
    if (rows) venue = buildVenuePayload(rows);
  }

  return json({
    buildingId,
    floor: resolvedFloor,
    building,
    indoorKind,
    nodes: geoNodes,
    paths: geoPaths,
    pois: outdoorPois,
    schematic,
    venue,
  });
});