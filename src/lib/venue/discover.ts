// What visitors browse: categories, search (with everyday words in English
// and Amharic), recommendations and curated collections. Pure functions, so
// the visitor app stays simple and this stays tested.

import type { PlaceType } from './places';
import { openStatus, type OpeningHours } from './places';

export type VisitorCategory = 'attractions' | 'gardens' | 'family' | 'food' | 'shops' | 'stays' | 'restrooms' | 'parking' | 'entrances' | 'facilities';

/** Category order and the words people type for each (English + Amharic). */
export const VISITOR_CATEGORIES: Record<VisitorCategory, { label: string; words: string[] }> = {
  attractions: { label: 'Attractions', words: ['attraction', 'museum', 'history', 'historic', 'culture', 'cultural', 'sight', 'monument', 'palace', 'heritage', 'gallery', 'exhibit', 'zoo', 'viewpoint', 'view', 'ሙዚየም', 'ቤተ', 'ታሪክ'] },
  gardens: { label: 'Gardens', words: ['garden', 'gardens', 'flower', 'flowers', 'nature', 'green', 'trees', 'ገነት', 'አትክልት'] },
  family: { label: 'Family', words: ['kids', 'kid', 'children', 'child', 'play', 'playground', 'family', 'baby', 'ልጆች', 'መጫወቻ'] },
  food: { label: 'Food & drink', words: ['food', 'eat', 'cafe', 'coffee', 'restaurant', 'drink', 'drinks', 'snack', 'lunch', 'breakfast', 'dinner', 'juice', 'ቡና', 'ምግብ', 'ካፌ'] },
  shops: { label: 'Shops', words: ['shop', 'shops', 'shopping', 'store', 'souvenir', 'souvenirs', 'gift', 'gifts', 'buy', 'market', 'ሱቅ', 'ገበያ'] },
  stays: { label: 'Hotels & stays', words: ['hotel', 'hotels', 'lodge', 'stay', 'sleep', 'room', 'rooms', 'guesthouse', 'accommodation', 'ሆቴል', 'ማረፊያ'] },
  restrooms: { label: 'Restrooms', words: ['restroom', 'restrooms', 'toilet', 'toilets', 'wc', 'bathroom', 'washroom', 'loo', 'ሽንት', 'መጸዳጃ'] },
  parking: { label: 'Parking', words: ['parking', 'car', 'cars', 'taxi', 'ማቆሚያ', 'ፓርኪንግ'] },
  entrances: { label: 'Entrances', words: ['entrance', 'entrances', 'gate', 'gates', 'entry', 'exit', 'way in', 'door', 'መግቢያ', 'በር'] },
  facilities: { label: 'Facilities', words: ['info', 'information', 'help', 'desk', 'ticket', 'tickets', 'atm', 'first aid', 'elevator', 'lift', 'stairs', 'reception'] },
};
export const VISITOR_CATEGORY_LIST = Object.keys(VISITOR_CATEGORIES) as VisitorCategory[];

const TYPE_CATEGORY: Record<PlaceType, VisitorCategory> = {
  attraction: 'attractions', cultural_site: 'attractions', viewpoint: 'attractions', custom: 'attractions',
  garden: 'gardens', play_area: 'family', cafe: 'food', restaurant: 'food', shop: 'shops', hotel: 'stays',
  restroom: 'restrooms', parking: 'parking', entrance: 'entrances', info_desk: 'facilities',
};

const norm = (s: string) => s.toLowerCase().normalize('NFKD').replace(/[̀-ͯ]/g, '');
const wordsOf = (s: string) => norm(s).split(/[^\p{L}\p{N}]+/u).filter(Boolean);

/** A place's category: its type when the institution set one, otherwise a good guess from its name or room. */
export function categoryOf(type: PlaceType | null | undefined, name: string, roomType?: string): VisitorCategory {
  if (type) return TYPE_CATEGORY[type];
  if (roomType === 'restroom') return 'restrooms';
  if (roomType === 'entrance') return 'entrances';
  if (roomType && ['stairs', 'elevator', 'reception', 'utility'].includes(roomType)) return 'facilities';
  const w = wordsOf(name);
  for (const c of ['restrooms', 'food', 'stays', 'shops', 'parking', 'entrances', 'gardens', 'family', 'facilities'] as VisitorCategory[]) {
    if (VISITOR_CATEGORIES[c].words.some(k => w.includes(norm(k)) || (k.length > 3 && norm(name).includes(norm(k))))) return c;
  }
  return 'attractions';
}

/** Which category a search is asking for ("toilet" → restrooms), if any. */
export function categoryFromQuery(q: string): VisitorCategory | null {
  const n = norm(q.trim());
  if (!n) return null;
  for (const c of VISITOR_CATEGORY_LIST) if (VISITOR_CATEGORIES[c].words.some(k => norm(k) === n || (n.length >= 4 && norm(k).startsWith(n)))) return c;
  return null;
}

export interface SearchablePlace { id: string; name: string; category: VisitorCategory; typeLabel?: string; description?: string | null }
export interface SearchableContent { id: string; title: string; kind: string; summary?: string | null; body?: string | null }

/** Ranked search over places and content. Every word typed has to match somewhere. */
export function searchVenue<P extends SearchablePlace, C extends SearchableContent>(query: string, places: P[], content: C[]) {
  const q = norm(query.trim());
  if (!q) return { places: [] as P[], content: [] as C[], category: null as VisitorCategory | null };
  const tokens = wordsOf(q);
  const category = categoryFromQuery(query);
  const scoreText = (fields: { text: string; weight: number }[]) => {
    let total = 0;
    for (const t of tokens) {
      let best = 0;
      for (const f of fields) {
        const n = norm(f.text);
        if (!n) continue;
        if (n.startsWith(t)) best = Math.max(best, f.weight);
        else if (wordsOf(n).some(w => w.startsWith(t))) best = Math.max(best, f.weight * 0.8);
        else if (n.includes(t)) best = Math.max(best, f.weight * 0.6);
      }
      if (!best) return 0;
      total += best;
    }
    return total;
  };
  const rankedPlaces = places.map(p => {
    const catWords = [VISITOR_CATEGORIES[p.category].label, ...VISITOR_CATEGORIES[p.category].words].join(' ');
    let s = scoreText([{ text: p.name, weight: 100 }, { text: p.typeLabel ?? '', weight: 40 }, { text: catWords, weight: 40 }, { text: p.description ?? '', weight: 20 }]);
    // A search that names a category ("garden", "toilet") puts places of that kind first.
    if (category && p.category === category) s = s > 0 ? s + 30 : 45;
    return { p, s };
  }).filter(x => x.s > 0).sort((a, b) => b.s - a.s || a.p.name.localeCompare(b.p.name)).map(x => x.p);
  const kindWords: Record<string, string> = { event: 'event events whats on today concert festival', announcement: 'announcement news notice', story: 'story stories history', guide: 'guide tips plan visit', educational: 'learn education', tour: 'tour tours route walk' };
  const rankedContent = content.map(c => ({
    c, s: scoreText([{ text: c.title, weight: 90 }, { text: kindWords[c.kind] ?? c.kind, weight: 30 }, { text: c.summary ?? '', weight: 25 }, { text: c.body ?? '', weight: 15 }]),
  })).filter(x => x.s > 0).sort((a, b) => b.s - a.s).map(x => x.c);
  return { places: rankedPlaces, content: rankedContent, category };
}

// ── Distances ────────────────────────────────────────────────────────────────

export interface Spot { x: number; y: number; floorId: string; floorLevel?: number }
const FLOOR_EXTRA_M = 15;

/** Straight-line metres between two spots (plus a bit per floor change); walking routes are a little longer. */
export function metresBetween(a: Spot, b: Spot, pxPerMeter: number): number {
  const flat = Math.hypot(a.x - b.x, a.y - b.y) / pxPerMeter;
  return a.floorId === b.floorId ? flat : flat + FLOOR_EXTRA_M * Math.max(1, Math.abs((a.floorLevel ?? 0) - (b.floorLevel ?? 0)));
}
/** Walking minutes at a relaxed visitor pace, with a 25% allowance for paths not being straight. */
export const walkMinutes = (metres: number) => Math.max(1, Math.round((metres * 1.25) / 1.2 / 60));

// ── Recommendations & collections ──────────────────────────────────────────

export interface DiscoverPlace extends SearchablePlace, Spot {
  type?: PlaceType | null; images: string[]; hours: OpeningHours | null; featured: boolean;
}

const NOT_DESTINATIONS: VisitorCategory[] = ['restrooms', 'parking', 'entrances', 'facilities'];

/** Places worth suggesting right now: featured, open, well described, close by. */
export function recommend<P extends DiscoverPlace>(places: P[], o: { now?: Date; origin?: Spot | null; pxPerMeter: number; limit?: number }): P[] {
  const now = o.now ?? new Date();
  return places
    .filter(p => !NOT_DESTINATIONS.includes(p.category))
    .map(p => {
      let s = 0;
      if (p.featured) s += 50;
      if (p.images.length) s += 20;
      if (p.description?.trim()) s += 10;
      const st = openStatus(p.hours, now);
      if (st) s += st.open ? 15 : -30;
      if (o.origin) s -= Math.min(30, metresBetween(o.origin, p, o.pxPerMeter) / 10);
      return { p, s };
    })
    .sort((a, b) => b.s - a.s || a.p.name.localeCompare(b.p.name))
    .slice(0, o.limit ?? 6)
    .map(x => x.p);
}

export interface Collection { id: string; title: string; subtitle: string; placeIds: string[]; contentIds: string[]; cover: string | null }
interface CollectionContent { id: string; kind: string; title: string; image_url?: string | null; ends_at?: string | null; stops?: string[] | null }

const has = (p: DiscoverPlace, re: RegExp) => re.test(norm(`${p.name} ${p.description ?? ''}`));

/** Ready-made collections to explore; empty ones are left out. */
export function collections<P extends DiscoverPlace>(places: P[], content: CollectionContent[], o: { now?: Date; pxPerMeter: number }): Collection[] {
  const now = o.now ?? new Date();
  const cover = (ps: P[]) => ps.find(p => p.images.length)?.images[0] ?? null;
  const out: Collection[] = [];
  const add = (id: string, title: string, subtitle: string, ps: P[]) => { if (ps.length) out.push({ id, title, subtitle, placeIds: ps.map(p => p.id), contentIds: [], cover: cover(ps) }); };

  const popular = places.filter(p => p.featured);
  add('popular', 'Popular', 'What visitors love most', popular.length ? popular : recommend(places, { now, pxPerMeter: o.pxPerMeter, limit: 5 }));
  add('museums', 'Museums & heritage', 'History, culture and landmarks', places.filter(p => p.type === 'cultural_site' || has(p, /museum|histor|heritage|palace|monument|ሙዚየም|ታሪክ/)));
  add('gardens', 'Gardens & nature', 'Green spaces and views', places.filter(p => p.category === 'gardens' || p.type === 'viewpoint'));
  add('family', 'Family area', 'Play and fun for children', places.filter(p => p.category === 'family' || has(p, /kids|children|child|play|ልጆች/)));
  add('food', 'Cafés & food', 'Coffee, snacks and meals', places.filter(p => p.category === 'food'));

  const events = content.filter(c => c.kind === 'event' && (!c.ends_at || new Date(c.ends_at) >= now));
  if (events.length) out.push({ id: 'events', title: 'Events', subtitle: 'Happening soon', placeIds: [], contentIds: events.map(c => c.id), cover: events.find(c => c.image_url)?.image_url ?? null });
  for (const t of content.filter(c => c.kind === 'tour' && (c.stops?.length ?? 0) > 0)) {
    out.push({ id: `tour:${t.id}`, title: t.title, subtitle: `Guided tour · ${t.stops!.length} stops`, placeIds: [], contentIds: [t.id], cover: t.image_url ?? null });
  }
  return out;
}
