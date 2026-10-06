// Geofenced messages for the visitor app: greet a place once per visit when
// the visitor walks into it, and suggest what's nearby ("Museum · 8 min walk").

import { useEffect, useMemo, useRef, useState } from 'react';
import { GeofenceTracker, nearbySuggestion, type Fence } from '@/lib/venue/geofence';
import { roomOutline } from '@/lib/venue/features';
import type { Place, VisitorPosition } from './types';
import { PX_PER_METER } from './types';

const storeKey = (venueId: string) => `yetnew-greeted-${venueId}`;
const load = (venueId: string) => { try { return new Set<string>(JSON.parse(sessionStorage.getItem(storeKey(venueId)) || '[]')); } catch { return new Set<string>(); } };
const save = (venueId: string, s: Set<string>) => { try { sessionStorage.setItem(storeKey(venueId), JSON.stringify([...s])); } catch { /* private mode */ } };

/**
 * Places that greet: ones worth announcing (attractions, gardens, family areas,
 * cafés) when the visitor walks into their area, plus any place the institution
 * gave a greeting radius. Restrooms and car parks stay quiet.
 */
export function fencesFor(places: Place[]): Fence[] {
  const worth = (p: Place) => ['attractions', 'gardens', 'family', 'food'].includes(p.category);
  return places.filter(p => p.greetRadiusM > 0 || (p.room && worth(p))).map(p => ({
    id: p.id, name: p.name, floorId: p.floorId, center: { x: p.x, y: p.y },
    polygon: p.room ? roomOutline(p.room) : undefined,
    radiusPx: p.greetRadiusM * PX_PER_METER,
  }));
}

/** `startedAt`: the place the visitor began from (e.g. the QR code they scanned) — they're already there, so it doesn't greet. */
export function useGeofences(venueId: string | undefined, places: Place[], position: VisitorPosition | null, startedAt: string | null = null) {
  const fences = useMemo(() => fencesFor(places), [places]);
  const tracker = useRef<GeofenceTracker | null>(null);
  const [greeting, setGreeting] = useState<Place | null>(null);
  const [suggested, setSuggested] = useState<Set<string>>(new Set());

  useEffect(() => { if (venueId) tracker.current = new GeofenceTracker(fences, load(venueId)); }, [venueId]); // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => { tracker.current?.setFences(fences); }, [fences]);
  useEffect(() => { if (startedAt) tracker.current?.seen.add(startedAt); }, [startedAt, venueId]);

  useEffect(() => {
    if (!position || !tracker.current || !venueId) return;
    const [entered] = tracker.current.update(position);
    save(venueId, tracker.current.seen);
    if (entered) setGreeting(places.find(p => p.id === entered.id) ?? null);
  }, [position?.x, position?.y, position?.floorId]); // eslint-disable-line react-hooks/exhaustive-deps

  // Auto-hide a greeting after a while.
  useEffect(() => { if (!greeting) return; const t = setTimeout(() => setGreeting(null), 12000); return () => clearTimeout(t); }, [greeting]);

  const nearby = useMemo(() => {
    if (!position) return null;
    const worth = places.filter(p => p.featured || ['attractions', 'gardens', 'family'].includes(p.category));
    const visited = new Set([...(tracker.current?.seen ?? []), ...suggested]);
    return nearbySuggestion(position, worth, visited, PX_PER_METER);
  }, [position, places, suggested]);

  return {
    greeting, dismissGreeting: () => setGreeting(null),
    nearby, dismissNearby: (id: string) => setSuggested(s => new Set(s).add(id)),
  };
}
