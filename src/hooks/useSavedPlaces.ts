import { useCallback, useEffect, useState } from 'react';
import { supabase } from '@/integrations/supabase/client';
import { POI, POICategory } from '@/data/poi';

export interface SavedPlace {
  id: string;
  profile_id: string;
  poi_id: string;
  created_at: string;
}

// Minimal POI snapshot stored alongside each saved place so SavedPanel
// always has the image/name even when the current building differs.
export interface SavedPOISnapshot {
  id: string;
  name: string;
  description: string;
  subcategory: string;
  imageUrl: string | null;
  category: POICategory;
}

/**
 * Manages the current profile's saved (bookmarked) places.
 * Also fetches minimal POI data (name, image) for every saved poi_id
 * directly from Supabase, so images always display regardless of which
 * building's POIs are currently loaded in memory.
 */
export function useSavedPlaces(profileId: string | null | undefined) {
  const [savedPlaces, setSavedPlaces] = useState<SavedPlace[]>([]);
  const [savedPOIs, setSavedPOIs]     = useState<Map<string, SavedPOISnapshot>>(new Map());
  const [loading, setLoading]         = useState(true);
  const [error, setError]             = useState<string | null>(null);

  const fetchSaved = useCallback(async () => {
    if (!profileId) {
      setSavedPlaces([]);
      setSavedPOIs(new Map());
      setLoading(false);
      return;
    }
    setLoading(true);
    setError(null);

    const { data, error: fetchError } = await supabase
      .from('saved_places')
      .select('*')
      .eq('profile_id', profileId)
      .order('created_at', { ascending: false });

    if (fetchError) {
      console.error('[useSavedPlaces] fetchSaved failed:', fetchError);
      setError(fetchError.message);
      setSavedPlaces([]);
      setLoading(false);
      return;
    }

    const places = data ?? [];
    setSavedPlaces(places);

    // Fetch POI snapshots for all saved poi IDs in one query
    if (places.length > 0) {
      const poiIds = places.map(p => p.poi_id);
      const { data: poiRows, error: poiError } = await supabase
        .from('pois')
        .select('id, name, description, subcategory, image_url, category')
        .in('id', poiIds);

      if (!poiError && poiRows) {
        const map = new Map<string, SavedPOISnapshot>();
        for (const row of poiRows) {
          map.set(row.id, {
            id:          row.id,
            name:        row.name ?? 'Saved Place',
            description: row.description ?? '',
            subcategory: row.subcategory ?? '',
            imageUrl:    row.image_url ?? null,
            category:    (row.category as POICategory) ?? 'attraction',
          });
        }
        setSavedPOIs(map);
      }
    } else {
      setSavedPOIs(new Map());
    }

    setLoading(false);
  }, [profileId]);

  useEffect(() => {
    fetchSaved();
  }, [fetchSaved]);

  const isSaved = useCallback(
    (poiId: string) => savedPlaces.some(sp => sp.poi_id === poiId),
    [savedPlaces]
  );

  const savePlace = useCallback(async (poiId: string) => {
    if (!profileId) {
      const msg = 'No profile loaded — cannot save place.';
      console.error('[useSavedPlaces] savePlace failed:', msg);
      setError(msg);
      return false;
    }
    const { data, error: insertError } = await supabase
      .from('saved_places')
      .insert({ profile_id: profileId, poi_id: poiId })
      .select()
      .maybeSingle<SavedPlace>();

    if (insertError) {
      // Unique violation just means it's already saved — treat as success.
      if (insertError.code === '23505') {
        await fetchSaved();
        return true;
      }
      console.error('[useSavedPlaces] savePlace failed:', insertError);
      setError(insertError.message);
      return false;
    }
    if (data) {
      setSavedPlaces(prev => [data, ...prev]);
      // Fetch the POI snapshot for the newly saved place
      const { data: poiRow } = await supabase
        .from('pois')
        .select('id, name, description, subcategory, image_url, category')
        .eq('id', poiId)
        .maybeSingle();
      if (poiRow) {
        setSavedPOIs(prev => {
          const next = new Map(prev);
          next.set(poiRow.id, {
            id:          poiRow.id,
            name:        poiRow.name ?? 'Saved Place',
            description: poiRow.description ?? '',
            subcategory: poiRow.subcategory ?? '',
            imageUrl:    poiRow.image_url ?? null,
            category:    (poiRow.category as POICategory) ?? 'attraction',
          });
          return next;
        });
      }
    }
    return true;
  }, [profileId, fetchSaved]);

  const unsavePlace = useCallback(async (poiId: string) => {
    if (!profileId) return false;
    const { error: deleteError } = await supabase
      .from('saved_places')
      .delete()
      .eq('profile_id', profileId)
      .eq('poi_id', poiId);

    if (deleteError) {
      console.error('[useSavedPlaces] unsavePlace failed:', deleteError);
      setError(deleteError.message);
      return false;
    }
    setSavedPlaces(prev => prev.filter(sp => sp.poi_id !== poiId));
    setSavedPOIs(prev => {
      const next = new Map(prev);
      next.delete(poiId);
      return next;
    });
    return true;
  }, [profileId]);

  const toggleSave = useCallback(async (poiId: string) => {
    return isSaved(poiId) ? unsavePlace(poiId) : savePlace(poiId);
  }, [isSaved, savePlace, unsavePlace]);

  return {
    savedPlaces,
    savedPOIs,
    loading,
    error,
    isSaved,
    savePlace,
    unsavePlace,
    toggleSave,
    refresh: fetchSaved,
  };
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