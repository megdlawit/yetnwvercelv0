// Loading a venue for visitors: the snapshot taken at the last "Publish".
// The venue's team, with ?preview=1, gets the live tables (their unpublished
// edits). Venues published before snapshots existed fall back to live tables.

import { supabase } from '@/integrations/supabase/client';
import type { Tables } from '@/integrations/supabase/types';
import type { Floor } from './types';

export type VenueRows = {
  building: { name: string; description: string | null; theme?: string | null };
  floors: Floor[]; nodes: Tables<'nodes'>[]; edges: Tables<'edges'>[]; rooms: Tables<'rooms'>[]; walls: Tables<'walls'>[];
  map_features: Tables<'map_features'>[]; pois: Tables<'pois'>[]; content: Tables<'venue_content'>[]; live: boolean;
  /** The venue's own team looking at unpublished changes (not just an older venue without a snapshot). */
  teamPreview: boolean;
};

export async function loadVenueRows(buildingId: string, b: Tables<'buildings'>, preview: boolean): Promise<VenueRows> {
  const editor = preview && !!(await supabase.rpc('user_can_edit_building', { b: buildingId })).data;
  if (!editor || !b.is_published) {
    const { data: snap } = await supabase.from('venue_snapshots').select('data').eq('building_id', buildingId).maybeSingle();
    if (snap?.data && b.is_published && !editor) {
      const d = snap.data as unknown as Omit<VenueRows, 'live'>;
      return { building: d.building ?? b, floors: d.floors ?? [], nodes: d.nodes ?? [], edges: d.edges ?? [], rooms: d.rooms ?? [], walls: d.walls ?? [],
        map_features: d.map_features ?? [], pois: d.pois ?? [], content: d.content ?? [], live: false, teamPreview: false };
    }
  }
  const [f, n, e, r, w, mf, p, vc] = await Promise.all([
    supabase.from('floors').select('*').eq('building_id', buildingId).order('level'),
    supabase.from('nodes').select('*').eq('building_id', buildingId),
    supabase.from('edges').select('*').eq('building_id', buildingId),
    supabase.from('rooms').select('*').eq('building_id', buildingId),
    supabase.from('walls').select('*').eq('building_id', buildingId),
    supabase.from('map_features').select('*').eq('building_id', buildingId),
    supabase.from('pois').select('*').eq('building_id', buildingId),
    // The team can read drafts too, so ask for visible items only.
    supabase.from('venue_content').select('*').eq('building_id', buildingId).eq('is_published', true).order('sort_order').order('starts_at'),
  ]);
  return {
    building: b, floors: (f.data ?? []) as Floor[], nodes: n.data ?? [], edges: e.data ?? [], rooms: r.data ?? [], walls: w.data ?? [],
    map_features: mf.data ?? [], pois: p.data ?? [], content: vc.error ? [] : vc.data ?? [], live: true, teamPreview: editor,
  };
}
