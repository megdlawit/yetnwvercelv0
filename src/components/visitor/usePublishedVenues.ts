// The venues on the public home page: every published venue, with the hero
// details (name, tagline, cover…) as of its last publish — never draft text.

import { useEffect, useState } from 'react';
import { supabase } from '@/integrations/supabase/client';

export interface PublishedVenue {
  id: string; name: string; tagline: string | null; description: string | null; cover: string | null;
  layout: string; theme: string; heroView: string; rank: number; publishedAt: string | null; institution: string | null;
}

// Just the hero part of each snapshot, not the whole venue. (A plain string: the typed
// client can't follow JSON paths.)
const HERO_COLUMNS: string = 'building_id, building:data->building';

export function usePublishedVenues() {
  const [venues, setVenues] = useState<PublishedVenue[] | null>(null);
  useEffect(() => {
    let live = true;
    (async () => {
      const { data: rows } = await supabase.from('buildings').select('*').eq('is_published', true);
      const list = rows ?? [];
      const [snaps, insts] = await Promise.all([
        list.length ? supabase.from('venue_snapshots').select(HERO_COLUMNS).in('building_id', list.map(b => b.id)) : Promise.resolve({ data: [] }),
        supabase.from('institutions').select('id, name'),
      ]);
      const snapOf = new Map(((snaps.data ?? []) as unknown as { building_id: string; building: Record<string, unknown> | null }[]).map(s => [s.building_id, s.building ?? {}] as const));
      const instName = new Map((insts.data ?? []).map(i => [i.id, i.name] as const));
      const out = list.map(b => {
        // Published fields win. Hero fields not in the snapshot (published before they existed)
        // stay empty rather than showing draft text; venues with no snapshot at all use their row.
        const s = snapOf.get(b.id);
        const p = (s ? { ...b, tagline: null, cover_url: null, hero_view: '3d', ...s } : b) as typeof b;
        return {
          id: b.id, name: p.name, tagline: p.tagline ?? null, description: p.description ?? null, cover: p.cover_url ?? null,
          layout: p.layout ?? 'building', theme: p.theme ?? 'park', heroView: p.hero_view ?? '3d', rank: b.home_rank ?? 0,
          publishedAt: b.published_at ?? null, institution: b.institution_id ? instName.get(b.institution_id) ?? null : null,
        };
      }).sort((a, z) => z.rank - a.rank || (z.publishedAt ?? '').localeCompare(a.publishedAt ?? '') || a.name.localeCompare(z.name));
      if (live) setVenues(out);
    })().catch(err => { console.error('Could not load venues:', err); if (live) setVenues([]); });
    return () => { live = false; };
  }, []);
  return venues;
}
