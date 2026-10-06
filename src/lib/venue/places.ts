// Places visitors can find: the institution-facing vocabulary (types,
// opening hours, accessibility) shared by the dashboard and the visitor map.

import {
  Landmark, Flower2, Coffee, Bath, SquareParking, DoorOpen, Info, Baby, Mountain, Castle, MapPin,
} from 'lucide-react';

export type PlaceType =
  | 'attraction' | 'garden' | 'cafe' | 'restroom' | 'parking' | 'entrance' | 'info_desk'
  | 'play_area' | 'viewpoint' | 'cultural_site' | 'custom';

/** `legacy` keeps the older 4-way `category` column in step for the existing visitor app and partner API. */
export const PLACE_TYPES: Record<PlaceType, { label: string; icon: typeof MapPin; legacy: 'attraction' | 'retail' | 'service' | 'education'; qr: boolean }> = {
  attraction:    { label: 'Attraction',    icon: Landmark,      legacy: 'attraction', qr: true },
  garden:        { label: 'Garden',        icon: Flower2,       legacy: 'attraction', qr: false },
  cafe:          { label: 'Café',          icon: Coffee,        legacy: 'retail',     qr: false },
  restroom:      { label: 'Restroom',      icon: Bath,          legacy: 'service',    qr: false },
  parking:       { label: 'Parking',       icon: SquareParking, legacy: 'service',    qr: true },
  entrance:      { label: 'Entrance / gate', icon: DoorOpen,    legacy: 'service',    qr: true },
  info_desk:     { label: 'Info desk',     icon: Info,          legacy: 'service',    qr: false },
  play_area:     { label: 'Play area',     icon: Baby,          legacy: 'attraction', qr: false },
  viewpoint:     { label: 'Viewpoint',     icon: Mountain,      legacy: 'attraction', qr: false },
  cultural_site: { label: 'Cultural site', icon: Castle,        legacy: 'education',  qr: true },
  custom:        { label: 'Custom',        icon: MapPin,        legacy: 'attraction', qr: false },
};
export const PLACE_TYPE_LIST = Object.keys(PLACE_TYPES) as PlaceType[];

/** Best guess at a place type for rows created before place types existed. */
export function placeTypeOf(row: { place_type?: string | null; category?: string | null; name?: string }): PlaceType {
  if (row.place_type && row.place_type in PLACE_TYPES) return row.place_type as PlaceType;
  const n = (row.name ?? '').toLowerCase();
  if (/caf|coffee|restaurant|food|ቡና/.test(n)) return 'cafe';
  if (/toilet|wc|restroom/.test(n)) return 'restroom';
  if (/gate|entrance|entry|መግቢያ/.test(n)) return 'entrance';
  if (/parking/.test(n)) return 'parking';
  if (row.category === 'education') return 'cultural_site';
  if (row.category === 'retail') return 'cafe';
  return 'attraction';
}

// ── Opening hours ────────────────────────────────────────────────────────────

export const DAYS = ['mon', 'tue', 'wed', 'thu', 'fri', 'sat', 'sun'] as const;
export type Day = typeof DAYS[number];
export const DAY_LABELS: Record<Day, string> = { mon: 'Mon', tue: 'Tue', wed: 'Wed', thu: 'Thu', fri: 'Fri', sat: 'Sat', sun: 'Sun' };

/** Per day, a list of [open, close] times ("08:00"); an empty list = closed. */
export type OpeningHours = Partial<Record<Day, [string, string][]>> & { note?: string };

export function parseHours(v: unknown): OpeningHours | null {
  if (!v || typeof v !== 'object') return null;
  const o = v as Record<string, unknown>, out: OpeningHours = {};
  for (const d of DAYS) {
    const spans = o[d];
    if (Array.isArray(spans)) out[d] = spans.filter((s): s is [string, string] => Array.isArray(s) && typeof s[0] === 'string' && typeof s[1] === 'string');
  }
  if (typeof o.note === 'string') out.note = o.note;
  return out;
}

const dayOf = (d: Date): Day => DAYS[(d.getDay() + 6) % 7];
const minutes = (t: string) => { const [h, m] = t.split(':').map(Number); return h * 60 + (m || 0); };

/** "Open now · until 18:00", "Closed · opens 08:00 tomorrow", or null when hours aren't set. */
export function openStatus(h: OpeningHours | null, now = new Date()): { open: boolean; text: string } | null {
  if (!h || !DAYS.some(d => h[d] !== undefined)) return null;
  const today = dayOf(now), t = now.getHours() * 60 + now.getMinutes();
  const spans = h[today] ?? [];
  const current = spans.find(([a, b]) => t >= minutes(a) && t < minutes(b));
  if (current) return { open: true, text: `Open now · until ${current[1]}` };
  const later = spans.find(([a]) => minutes(a) > t);
  if (later) return { open: false, text: `Closed · opens ${later[0]}` };
  for (let i = 1; i <= 7; i++) {
    const d = DAYS[(DAYS.indexOf(today) + i) % 7], first = h[d]?.[0];
    if (first) return { open: false, text: `Closed · opens ${first[0]} ${i === 1 ? 'tomorrow' : DAY_LABELS[d]}` };
  }
  return { open: false, text: 'Closed' };
}

/** "Mon–Fri 08:00–18:00 · Sat 09:00–13:00 · Sun closed" */
export function hoursSummary(h: OpeningHours | null): string {
  if (!h) return '';
  const fmt = (d: Day) => (h[d]?.length ? h[d]!.map(([a, b]) => `${a}–${b}`).join(', ') : 'closed');
  const groups: { from: Day; to: Day; text: string }[] = [];
  for (const d of DAYS) {
    const text = fmt(d), last = groups[groups.length - 1];
    if (last && last.text === text) last.to = d; else groups.push({ from: d, to: d, text });
  }
  return groups.map(g => `${DAY_LABELS[g.from]}${g.from !== g.to ? `–${DAY_LABELS[g.to]}` : ''} ${g.text}`).join(' · ');
}

// ── Accessibility ────────────────────────────────────────────────────────────

export interface Accessibility { wheelchair?: boolean; stepFree?: boolean; accessibleToilet?: boolean; seating?: boolean; notes?: string }
export const ACCESSIBILITY_LABELS: Record<Exclude<keyof Accessibility, 'notes'>, string> = {
  wheelchair: 'Wheelchair accessible', stepFree: 'Step-free entrance', accessibleToilet: 'Accessible toilet', seating: 'Seating available',
};
export const parseAccessibility = (v: unknown): Accessibility => (v && typeof v === 'object' ? v as Accessibility : {});

// ── Content ──────────────────────────────────────────────────────────────────

export type ContentKind = 'story' | 'guide' | 'announcement' | 'event' | 'educational' | 'tour';
export const CONTENT_KINDS: Record<ContentKind, { label: string; plural: string; dated: boolean }> = {
  story:        { label: 'Story',        plural: 'Stories',       dated: false },
  guide:        { label: 'Guide',        plural: 'Guides',        dated: false },
  announcement: { label: 'Announcement', plural: 'Announcements', dated: true },
  event:        { label: 'Event',        plural: 'Events',        dated: true },
  educational:  { label: 'Educational',  plural: 'Educational',   dated: false },
  tour:         { label: 'Tour',         plural: 'Tours',         dated: false },
};
