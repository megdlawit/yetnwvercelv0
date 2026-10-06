// Everything the institution dashboard shows about one venue, loaded once
// and refreshed after edits.

import { useCallback, useEffect, useState } from 'react';
import { supabase } from '@/integrations/supabase/client';
import type { Tables } from '@/integrations/supabase/types';

export type PoiRow = Tables<'pois'>;
export type ContentRow = Tables<'venue_content'>;
export type ActivityRow = Tables<'venue_activity'>;
export interface VenueFloor { id: string; name: string; level: number }
export interface VenuePlaceNode { id: string; floorId: string; name: string; x: number; y: number; isHallway: boolean }
export interface VenueRoom { id: string; name: string; type: string; nodeId: string | null; floorId: string; x: number; y: number; width: number; height: number; polygon: unknown }

export interface VenueData {
  building: Tables<'buildings'>;
  floors: VenueFloor[];
  nodes: VenuePlaceNode[];
  edges: { from: string; to: string }[];
  counts: { walls: number; rooms: number; objects: number; doors: number; imported: number };
  rooms: VenueRoom[];
  pois: PoiRow[];
  content: ContentRow[];
  activity: ActivityRow[];
  /** Changes made since the last publish (what "Publish changes" will send to visitors). */
  unpublished: number;
  /** Tables / columns added by recent migrations that aren't on this database yet. */
  missing: string[];
}

export function useVenue(buildingId: string | undefined | null) {
  const [data, setData] = useState<VenueData | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);

  const load = useCallback(async () => {
    if (!buildingId) { setData(null); setLoading(false); return; }
    setLoading(true);
    try {
      const [b, floors, nodes, edges, rooms, walls, imported, features, pois, content, activity] = await Promise.all([
        supabase.from('buildings').select('*').eq('id', buildingId).maybeSingle(),
        supabase.from('floors').select('*').eq('building_id', buildingId).order('level'),
        supabase.from('nodes').select('id, floor_id, name, x, y, is_hallway').eq('building_id', buildingId),
        supabase.from('edges').select('from_node, to_node').eq('building_id', buildingId),
        supabase.from('rooms').select('id, name, type, node_id, floor_id, x, y, width, height, polygon').eq('building_id', buildingId),
        supabase.from('walls').select('id', { count: 'exact', head: true }).eq('building_id', buildingId),
        supabase.from('walls').select('id', { count: 'exact', head: true }).eq('building_id', buildingId).neq('source', 'manual'),
        supabase.from('map_features').select('kind').eq('building_id', buildingId),
        supabase.from('pois').select('*').eq('building_id', buildingId).order('name'),
        supabase.from('venue_content').select('*').eq('building_id', buildingId).order('sort_order').order('created_at', { ascending: false }),
        supabase.from('venue_activity').select('*').eq('building_id', buildingId).order('created_at', { ascending: false }).limit(60),
      ]);
      if (b.error) throw new Error(b.error.message);
      if (!b.data) throw new Error('This venue does not exist, or you are not allowed to manage it.');

      let unpublished = 0;
      if (!activity.error) {
        let q = supabase.from('venue_activity').select('id', { count: 'exact', head: true }).eq('building_id', buildingId)
          .not('action', 'in', '(published,unpublished)');
        if (b.data.published_at) q = q.gt('created_at', b.data.published_at);
        unpublished = (await q).count ?? 0;
      }
      const missing = [
        features.error && 'map_features', content.error && 'venue_content',
        (activity.error || b.data.layout === undefined) && 'venue_activity',
        !('map_settings' in b.data) && 'map_settings',
      ].filter(Boolean) as string[];

      setData({
        building: b.data,
        floors: floors.data ?? [],
        nodes: (nodes.data ?? []).map(n => ({ id: n.id, floorId: n.floor_id, name: n.name ?? '', x: n.x, y: n.y, isHallway: n.is_hallway })),
        edges: (edges.data ?? []).map(e => ({ from: e.from_node, to: e.to_node })),
        rooms: (rooms.data ?? []).map(r => ({ id: r.id, name: r.name ?? '', type: r.type, nodeId: r.node_id, floorId: r.floor_id, x: r.x, y: r.y, width: r.width, height: r.height, polygon: r.polygon })),
        counts: {
          walls: walls.count ?? 0, imported: imported.count ?? 0, rooms: rooms.data?.length ?? 0,
          objects: features.data?.length ?? 0, doors: (features.data ?? []).filter(f => f.kind === 'door').length,
        },
        pois: pois.data ?? [],
        content: content.error ? [] : content.data ?? [],
        activity: activity.error ? [] : activity.data ?? [],
        unpublished,
        missing,
      });
      setError(null);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to load the venue.');
    } finally {
      setLoading(false);
    }
  }, [buildingId]);

  useEffect(() => { load(); }, [load]);
  return { data, error, loading, reload: load, setData };
}

/** Destinations visitors can't be routed to: not joined to the venue's largest path network. */
export function unreachablePlaces(d: Pick<VenueData, 'nodes' | 'edges'>): string[] {
  const parent = new Map(d.nodes.map(n => [n.id, n.id] as const));
  const find = (i: string): string => { const p = parent.get(i)!; if (p === i) return i; const r = find(p); parent.set(i, r); return r; };
  for (const e of d.edges) if (parent.has(e.from) && parent.has(e.to)) parent.set(find(e.from), find(e.to));
  const size = new Map<string, number>();
  for (const n of d.nodes) size.set(find(n.id), (size.get(find(n.id)) ?? 0) + 1);
  const main = [...size.entries()].sort((a, b) => b[1] - a[1])[0]?.[0];
  return d.nodes.filter(n => !n.isHallway && find(n.id) !== main).map(n => n.id);
}

/** Publishing copies the venue into what visitors see (falls back to the plain flag on older databases). */
export async function publishVenue(buildingId: string) {
  const { error } = await supabase.rpc('publish_venue', { b: buildingId });
  if (!error) return;
  if (/function .*publish_venue|schema cache/i.test(error.message)) {
    const { error: e2 } = await supabase.from('buildings').update({ is_published: true }).eq('id', buildingId);
    if (e2) throw new Error(e2.message);
    return;
  }
  throw new Error(error.message);
}

export async function unpublishVenue(buildingId: string) {
  const { error } = await supabase.rpc('unpublish_venue', { b: buildingId });
  if (!error) return;
  if (/function .*unpublish_venue|schema cache/i.test(error.message)) {
    const { error: e2 } = await supabase.from('buildings').update({ is_published: false }).eq('id', buildingId);
    if (e2) throw new Error(e2.message);
    return;
  }
  throw new Error(error.message);
}
