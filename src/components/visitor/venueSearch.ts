// What the home page search finds on Yet New itself: every published venue,
// and the places inside them (as of their last publish). Loaded once, the
// first time someone starts searching.

import { supabase } from '@/integrations/supabase/client';

export interface VenueHit {
  id: string; name: string; tagline: string | null; cover: string | null; institution: string | null;
  /** On the world map (so it has an outdoor view). */
  placed: boolean;
}
export interface PlaceHit {
  venueId: string; venueName: string; nodeId: string; name: string; detail: string; image: string | null;
}
export interface VenueIndex { venues: VenueHit[]; places: PlaceHit[] }

let loading: Promise<VenueIndex> | null = null;

type Row = Record<string, unknown>;
const str = (v: unknown) => (typeof v === 'string' && v.trim() ? v.trim() : null);

export function loadVenueIndex(): Promise<VenueIndex> {
  loading ??= (async () => {
    const { data: rows } = await supabase.from('buildings').select('*').eq('is_published', true);
    const list = (rows ?? []) as Row[];
    if (!list.length) return { venues: [], places: [] };
    const ids = list.map(b => String(b.id));
    const [snaps, insts] = await Promise.all([
      supabase.from('venue_snapshots').select('building_id, building:data->building, pois:data->pois, rooms:data->rooms' as string).in('building_id', ids),
      supabase.from('institutions').select('id, name'),
    ]);
    const snapOf = new Map(((snaps.data ?? []) as unknown as Row[]).map(s => [String(s.building_id), s]));
    // Venues published before snapshots existed: their places from the live tables (as the venue map does).
    const bare = ids.filter(id => !snapOf.has(id));
    if (bare.length) {
      const [p, r] = await Promise.all([
        supabase.from('pois').select('building_id, node_id, name, subcategory, place_type, images, image_url, is_visible').in('building_id', bare),
        supabase.from('rooms').select('building_id, node_id, name, type').in('building_id', bare),
      ]);
      for (const id of bare) {
        snapOf.set(id, {
          building_id: id, building: null,
          pois: ((p.data ?? []) as Row[]).filter(x => x.building_id === id),
          rooms: ((r.data ?? []) as Row[]).filter(x => x.building_id === id),
        });
      }
    }
    const instName = new Map(((insts.data ?? []) as Row[]).map(i => [String(i.id), str(i.name)]));
    const venues: VenueHit[] = [], places: PlaceHit[] = [];
    for (const b of list) {
      const s = snapOf.get(String(b.id));
      const hero = { ...b, ...((s?.building as Row | null) ?? {}) };
      const name = str(hero.name) ?? 'Venue';
      venues.push({
        id: String(b.id), name, tagline: str(hero.tagline) ?? str(hero.description), cover: str(hero.cover_url),
        institution: b.institution_id ? instName.get(String(b.institution_id)) ?? null : null,
        placed: hero.origin_lat != null && hero.origin_lng != null,
      });
      const seen = new Set<string>();
      for (const p of ((s?.pois as Row[] | null) ?? [])) {
        const nodeId = str(p.node_id), pn = str(p.name);
        if (!nodeId || !pn || p.is_visible === false) continue;
        const images = Array.isArray(p.images) ? (p.images as unknown[]).filter((x): x is string => typeof x === 'string') : [];
        seen.add(nodeId);
        places.push({ venueId: String(b.id), venueName: name, nodeId, name: pn, detail: str(p.subcategory) ?? str(p.place_type)?.replace(/_/g, ' ') ?? '', image: images[0] ?? str(p.image_url) });
      }
      for (const r of ((s?.rooms as Row[] | null) ?? [])) {
        const nodeId = str(r.node_id), rn = str(r.name);
        if (!nodeId || !rn || seen.has(nodeId)) continue;
        seen.add(nodeId);
        places.push({ venueId: String(b.id), venueName: name, nodeId, name: rn, detail: str(r.type)?.replace(/_/g, ' ') ?? '', image: null });
      }
    }
    return { venues, places };
  })().catch(err => { loading = null; console.error('Could not load venues for search:', err); return { venues: [], places: [] }; });
  return loading;
}

/** Does `text` match what was typed (every word, at a word start or anywhere for longer words)? Higher is better; 0 = no. */
export function matchScore(text: string, query: string): number {
  const t = text.toLowerCase(), words = query.toLowerCase().split(/\s+/).filter(Boolean);
  if (!words.length) return 0;
  let score = 0;
  for (const w of words) {
    const i = t.indexOf(w);
    if (i < 0) return 0;
    score += i === 0 ? 3 : /\W/.test(t[i - 1] ?? ' ') ? 2 : 1;
  }
  return score + (t === query.toLowerCase().trim() ? 5 : 0);
}
