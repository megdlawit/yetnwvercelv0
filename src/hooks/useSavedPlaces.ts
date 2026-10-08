import { useCallback, useEffect, useMemo } from 'react';
import { POI, POICategory } from '@/data/poi';
import {
  useVisitorStore, rememberPlaces, snapshotFor, savePlace as storeSave, unsavePlace as storeUnsave, isSavedPlace, syncVisitor,
} from '@/lib/visitor/visitorStore';

export interface SavedPlace {
  id: string;
  profile_id: string;
  poi_id: string;
  created_at: string;
}

// What's kept about each saved place, so the Saved list shows its name,
// photo and venue even when that venue isn't the one open now.
export interface SavedPOISnapshot {
  id: string;
  name: string;
  description: string;
  subcategory: string;
  imageUrl: string | null;
  category: POICategory;
  buildingId?: string | null;
  nodeId?: string | null;
  venueName?: string | null;
}

/**
 * The visitor's saved (bookmarked) places. Saved on the device at once —
 * any place, any venue, guest or not — and synced to their profile when the
 * database can hold it (see lib/visitor/visitorStore). Pass the places on
 * the map so a save keeps each one's name and photo.
 */
export function useSavedPlaces(profileId: string | null | undefined, pois?: POI[]) {
  const store = useVisitorStore();
  useEffect(() => { if (pois?.length) rememberPlaces(pois); }, [pois]);
  useEffect(() => { void syncVisitor(profileId); }, [profileId]);

  const savedPlaces = useMemo<SavedPlace[]>(
    () => store.saved.map(e => ({ id: e.id, profile_id: profileId ?? '', poi_id: e.id, created_at: e.savedAt })),
    [store.saved, profileId],
  );
  const savedPOIs = useMemo(() => new Map<string, SavedPOISnapshot>(store.saved.map(e => [e.id, {
    id: e.id, name: e.name, description: e.detail, subcategory: e.detail, imageUrl: e.imageUrl,
    category: e.category as POICategory, buildingId: e.buildingId, nodeId: e.nodeId, venueName: e.venueName,
  }])), [store.saved]);

  // eslint-disable-next-line react-hooks/exhaustive-deps
  const isSaved = useCallback((poiId: string) => isSavedPlace(poiId), [store.saved]);
  const savePlace = useCallback(async (poiId: string) => { storeSave(snapshotFor(poiId)); return true; }, []);
  const unsavePlace = useCallback(async (poiId: string) => { storeUnsave(poiId); return true; }, []);
  const toggleSave = useCallback(async (poiId: string) => {
    if (isSavedPlace(poiId)) storeUnsave(poiId); else storeSave(snapshotFor(poiId));
    return true;
  }, []);
  const refresh = useCallback(() => syncVisitor(profileId, true), [profileId]);

  return { savedPlaces, savedPOIs, loading: false, error: null as string | null, isSaved, savePlace, unsavePlace, toggleSave, refresh };
}

/** Builds a shareable URL for a specific POI. */
export function buildPOIShareUrl(poi: POI): string {
  const base = typeof window !== 'undefined' ? window.location.origin : '';
  const params = new URLSearchParams({ poi: poi.id });
  return `${base}/?${params.toString()}`;
}

/** Shares a POI via the native share sheet, falling back to clipboard copy. */
export async function sharePOI(poi: POI): Promise<'shared' | 'copied' | 'failed'> {
  const url = buildPOIShareUrl(poi);
  const text = `Check out ${poi.name}${poi.description ? ` — ${poi.description}` : ''}`;

  if (typeof navigator !== 'undefined' && navigator.share) {
    try {
      await navigator.share({ title: poi.name, text, url });
      return 'shared';
    } catch {
      // User cancelled or share failed — fall through to clipboard.
    }
  }

  if (typeof navigator !== 'undefined' && navigator.clipboard) {
    try {
      await navigator.clipboard.writeText(`${text}\n${url}`);
      return 'copied';
    } catch {
      return 'failed';
    }
  }

  return 'failed';
}