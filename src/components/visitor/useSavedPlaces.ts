// Places a visitor saved, in the venue guide — the same list as the map's
// Saved tab and the profile (lib/visitor/visitorStore): kept on the device
// at once, synced to their profile when it can be.

import { useCallback, useEffect, useMemo } from 'react';
import { toggleSavedPlace, useVisitorStore, type PlaceSnapshot } from '@/lib/visitor/visitorStore';
import type { Place } from './types';

/** Before the shared store, each venue kept a list of ids of its own. */
const legacyKey = (venueId: string) => `yetnew-saved-${venueId}`;

export function useSavedPlaces(venueId: string | undefined, places: Place[] = [], venueName?: string | null) {
  const store = useVisitorStore();
  const snapshot = useCallback((p: Place): PlaceSnapshot => ({
    id: p.poiId ?? p.id, name: p.name, detail: p.typeLabel ?? p.description?.slice(0, 60) ?? '', imageUrl: p.images[0] ?? null,
    category: p.category, buildingId: venueId ?? null, nodeId: p.id, venueName: venueName ?? null,
  }), [venueId, venueName]);

  // Bring an old per-venue list into the shared one, once the places are known.
  useEffect(() => {
    if (!venueId || !places.length) return;
    let old: string[] = [];
    try { old = JSON.parse(localStorage.getItem(legacyKey(venueId)) || '[]'); } catch { /* none */ }
    if (!Array.isArray(old) || !old.length) return;
    for (const id of old) {
      const p = places.find(x => x.id === id);
      if (p && !store.saved.some(e => e.nodeId === p.id || e.id === (p.poiId ?? p.id))) toggleSavedPlace(snapshot(p));
    }
    try { localStorage.removeItem(legacyKey(venueId)); } catch { /* private mode */ }
  }, [venueId, places]); // eslint-disable-line react-hooks/exhaustive-deps

  /** This venue's saved places, by place (path point) id. */
  const ids = useMemo(() => store.saved.filter(e => e.buildingId === venueId).map(e => e.nodeId ?? e.id), [store.saved, venueId]);
  const has = useCallback((placeId: string) => store.saved.some(e => e.nodeId === placeId || e.id === placeId), [store.saved]);
  /** Save or unsave; true when it's saved now. */
  const toggle = useCallback((p: Place) => toggleSavedPlace(snapshot(p)), [snapshot]);
  return { ids, has, toggle };
}
