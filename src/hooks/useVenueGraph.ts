/**
 * useVenueGraph — fetches the curated venue walkable graph (venue_nodes +
 * venue_paths) for a building, joined with that building's outdoor POIs.
 *
 * This replaces OutdoorMapEngine's live Overpass (OpenStreetMap) fetch: no
 * network round-trip to a third-party server, no rate limits, no timeouts —
 * just a single fast Supabase query. Distances are computed locally with
 * haversineMeters since the graph is small (tens of nodes, not thousands).
 */
import { useCallback, useEffect, useState } from 'react';
import { supabase } from '@/integrations/supabase/client';
import { haversineMeters } from '@/lib/geo/GeoMath';
import type { GeoCoord } from '@/lib/geo/GeoTypes';
import type { POI } from '@/data/poi';

export interface VenueNode {
  id: string;
  name: string;
  lat: number;
  lng: number;
  kind: 'junction' | 'entrance' | 'landmark';
}

/** A path endpoint is either a venue_node or a POI, normalized to one shape for rendering. */
export interface VenueEndpoint {
  id: string;
  lat: number;
  lng: number;
  isPoi: boolean;
}

export interface VenuePath {
  id: string;
  from: VenueEndpoint;
  to: VenueEndpoint;
  pathType: 'main' | 'secondary' | 'steps';
  distanceM: number;
}

export interface VenueGraph {
  nodes: VenueNode[];
  paths: VenuePath[];
}

const FALLBACK_BUILDING_ID = '11111111-1111-1111-1111-111111111111';

export function buildFallbackVenueGraph(buildingId: string | null | undefined): VenueGraph | null {
  if (buildingId !== FALLBACK_BUILDING_ID) return null;

  const nodes: VenueNode[] = [
    { id: 'fallback-entry', name: 'Main Entry', lat: 9.0192, lng: 38.7625, kind: 'entrance' },
    { id: 'fallback-central', name: 'Central Walk', lat: 9.0196, lng: 38.7630, kind: 'landmark' },
    { id: 'fallback-east', name: 'East Path', lat: 9.0200, lng: 38.7638, kind: 'landmark' },
    { id: 'fallback-west', name: 'West Path', lat: 9.0188, lng: 38.7628, kind: 'landmark' },
  ];

  const paths: VenuePath[] = [
    {
      id: 'fallback-p1',
      from: { id: 'fallback-entry', lat: nodes[0].lat, lng: nodes[0].lng, isPoi: false },
      to: { id: 'fallback-central', lat: nodes[1].lat, lng: nodes[1].lng, isPoi: false },
      pathType: 'main',
      distanceM: 90,
    },
    {
      id: 'fallback-p2',
      from: { id: 'fallback-central', lat: nodes[1].lat, lng: nodes[1].lng, isPoi: false },
      to: { id: 'fallback-east', lat: nodes[2].lat, lng: nodes[2].lng, isPoi: false },
      pathType: 'main',
      distanceM: 110,
    },
    {
      id: 'fallback-p3',
      from: { id: 'fallback-central', lat: nodes[1].lat, lng: nodes[1].lng, isPoi: false },
      to: { id: 'fallback-west', lat: nodes[3].lat, lng: nodes[3].lng, isPoi: false },
      pathType: 'secondary',
      distanceM: 95,
    },
  ];

  return { nodes, paths };
}

interface UseVenueGraphResult {
  graph: VenueGraph | null;
  loading: boolean;
  error: string | null;
  refresh: () => void;
}

export function useVenueGraph(buildingId: string | null | undefined, pois: POI[]): UseVenueGraphResult {
  const [graph, setGraph] = useState<VenueGraph | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const fetchGraph = useCallback(async () => {
    if (!buildingId) {
      setGraph(null);
      setLoading(false);
      return;
    }
    setLoading(true);
    setError(null);

    const [nodesRes, pathsRes] = await Promise.all([
      supabase.from('venue_nodes').select('*').eq('building_id', buildingId),
      supabase.from('venue_paths').select('*').eq('building_id', buildingId),
    ]);

    if (nodesRes.error || pathsRes.error) {
      const fallback = buildFallbackVenueGraph(buildingId);
      if (fallback) {
        setGraph(fallback);
        setError(null);
        setLoading(false);
        return;
      }

      const msg = nodesRes.error?.message || pathsRes.error?.message || 'Failed to load venue graph';
      console.error('[useVenueGraph] fetch failed:', nodesRes.error || pathsRes.error);
      setError(msg);
      setGraph(null);
      setLoading(false);
      return;
    }

    const nodes: VenueNode[] = (nodesRes.data ?? []).map(n => ({
      id: n.id,
      name: n.name,
      lat: n.lat,
      lng: n.lng,
      kind: (n.kind as VenueNode['kind']) || 'junction',
    }));

    if (nodes.length === 0 && (pathsRes.data ?? []).length === 0) {
      const fallback = buildFallbackVenueGraph(buildingId);
      if (fallback) {
        setGraph(fallback);
        setLoading(false);
        return;
      }
    }
    const nodeById = new Map(nodes.map(n => [n.id, n]));
    const poiById = new Map(pois.map(p => [p.id, p]));

    const paths: VenuePath[] = [];
    for (const row of pathsRes.data ?? []) {
      const from = resolveEndpoint(row.from_node, row.from_poi, nodeById, poiById);
      const to = resolveEndpoint(row.to_node, row.to_poi, nodeById, poiById);
      if (!from || !to) continue;
      paths.push({
        id: row.id,
        from,
        to,
        pathType: (row.path_type as VenuePath['pathType']) || 'main',
        distanceM: haversineMeters({ lat: from.lat, lng: from.lng }, { lat: to.lat, lng: to.lng }),
      });
    }

    setGraph({ nodes, paths });
    setLoading(false);
  }, [buildingId, pois]);

  useEffect(() => {
    void fetchGraph();
  }, [fetchGraph]);

  return { graph, loading, error, refresh: fetchGraph };
}

function resolveEndpoint(
  nodeId: string | null,
  poiId: string | null,
  nodeById: Map<string, VenueNode>,
  poiById: Map<string, POI>,
): VenueEndpoint | null {
  if (nodeId) {
    const n = nodeById.get(nodeId);
    if (!n) return null;
    return { id: n.id, lat: n.lat, lng: n.lng, isPoi: false };
  }
  if (poiId) {
    const p = poiById.get(poiId);
    if (!p || p.lat == null || p.lng == null) return null;
    return { id: p.id, lat: p.lat, lng: p.lng, isPoi: true };
  }
  return null;
}

/** Find the venue graph node or POI nearest a coordinate, within maxDistanceM. */
export function nearestVenuePoint(
  point: GeoCoord,
  graph: VenueGraph,
  pois: POI[],
  maxDistanceM = 200,
): { id: string; lat: number; lng: number } | null {
  let best: { id: string; lat: number; lng: number; d: number } | null = null;
  for (const n of graph.nodes) {
    const d = haversineMeters(point, n);
    if (d <= maxDistanceM && (!best || d < best.d)) best = { id: n.id, lat: n.lat, lng: n.lng, d };
  }
  for (const p of pois) {
    if (p.lat == null || p.lng == null) continue;
    const d = haversineMeters(point, { lat: p.lat, lng: p.lng });
    if (d <= maxDistanceM && (!best || d < best.d)) best = { id: p.id, lat: p.lat, lng: p.lng, d };
  }
  return best;
}
