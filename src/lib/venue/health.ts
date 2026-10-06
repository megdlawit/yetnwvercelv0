// The dashboard's at-a-glance answers: is the map healthy, how complete is
// the venue, what's left to set up. Pure, so it's easy to test.

import type { PlaceType } from './places';

export const ATTRACTION_TYPES: PlaceType[] = ['attraction', 'garden', 'viewpoint', 'cultural_site', 'play_area'];
export const ENTRY_TYPES: PlaceType[] = ['entrance', 'parking'];

interface PlaceLike { type: PlaceType; nodeId: string | null; visible: boolean; poi: { description?: string | null; images?: string[] | null; image_url?: string | null } | null }
interface Input<P extends PlaceLike> {
  counts: { walls: number; rooms: number; imported: number };
  rooms: { name: string }[];
  edges: unknown[];
  places: P[];
  unreachable: number;
  content: { kind: string; is_published: boolean; ends_at: string | null; starts_at: string | null }[];
  published: boolean;
  publishedAt: string | null;
}

export interface SetupStep { id: string; label: string; done: boolean; hint: string }

export function venueHealth<P extends PlaceLike>(d: Input<P>, now = new Date()) {
  const hasMap = d.counts.walls > 0 || d.counts.rooms > 0;
  const onMap = d.places.filter(p => p.nodeId);
  const entryPoints = onMap.filter(p => ENTRY_TYPES.includes(p.type));
  const attractions = d.places.filter(p => ATTRACTION_TYPES.includes(p.type));
  const upcomingEvents = d.content.filter(c => c.kind === 'event' && (!c.ends_at || new Date(c.ends_at) >= now));
  const visible = d.places.filter(p => p.visible);
  const described = visible.filter(p => p.poi?.description?.trim()).length;
  const pictured = visible.filter(p => p.poi?.images?.length || p.poi?.image_url).length;
  const contentPct = visible.length ? Math.round(100 * (described + pictured) / (2 * visible.length)) : 0;
  const unnamedAreas = d.rooms.filter(r => !r.name.trim()).length;
  const offMap = d.places.filter(p => !p.nodeId).length;
  const unresolved = unnamedAreas + d.unreachable + offMap;

  const steps: SetupStep[] = [
    { id: 'map', label: 'Upload map', done: hasMap, hint: 'CAD, PDF or an image of your plan' },
    { id: '3d', label: 'Generate 3D world', done: hasMap && d.counts.rooms > 0, hint: 'Areas are detected from your plan' },
    { id: 'entrance', label: 'Add main entrance', done: entryPoints.length > 0, hint: 'Visitors start here; it gets a QR code' },
    { id: 'places', label: 'Add places', done: d.places.filter(p => p.poi).length >= 3, hint: 'Describe at least 3 places' },
    { id: 'content', label: 'Add visitor content', done: d.content.some(c => c.is_published), hint: 'A story, guide or event' },
    { id: 'publish', label: 'Publish venue', done: d.published && !!d.publishedAt, hint: 'Visitors can explore it' },
  ];
  const setupPct = Math.round(100 * steps.filter(s => s.done).length / steps.length);

  return {
    hasMap, onMap: onMap.length, entryPoints, attractions, upcomingEvents, contentPct,
    unnamedAreas, offMap, unresolved, steps, setupPct, imported: d.counts.imported > 0,
    pathsReady: d.edges.length > 0,
  };
}
