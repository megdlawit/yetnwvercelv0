import { useCallback, useEffect, useState } from 'react';
import { supabase } from '@/integrations/supabase/client';
import { POI, POICategory } from '@/data/poi';

export type VisitSource = 'auto' | 'manual';

export interface VisitedPlace {
  id: string;
  profile_id: string;
  poi_id: string;
  visit_count: number;
  source: VisitSource;
  first_visited_at: string;
  last_visited_at: string;
}

// Minimal POI snapshot stored alongside each visited place so the history
// list always has the image/name even when the current building differs.
export interface VisitedPOISnapshot {
  id: string;
  name: string;
  description: string;
  subcategory: string;
  imageUrl: string | null;
  category: POICategory;
}

const POI_SNAPSHOT_COLUMNS = 'id, name, description, subcategory, image_url, category';

function toSnapshot(row: {
  id: string; name: string | null; description: string | null;
  subcategory: string | null; image_url: string | null; category: string | null;
}): VisitedPOISnapshot {
  return {
    id: row.id,
    name: row.name ?? 'Visited Place',
    description: row.description ?? '',
    subcategory: row.subcategory ?? '',
    imageUrl: row.image_url ?? null,
    category: (row.category as POICategory) ?? 'attraction',
  };
}

/**
 * Manages the current profile's visit history — places they've actually
 * been to, as opposed to useSavedPlaces' bookmark list. Visits can be
 * recorded automatically (navigation arrival, QR anchor) or manually
 * ("Mark as visited" on a POI card). Repeat visits update the same row
 * (bumping visit_count / last_visited_at) instead of duplicating.
 */
export function useVisitedPlaces(profileId: string | null | undefined) {
  const [visitedPlaces, setVisitedPlaces] = useState<VisitedPlace[]>([]);
  const [visitedPOIs, setVisitedPOIs]     = useState<Map<string, VisitedPOISnapshot>>(new Map());
  const [loading, setLoading]             = useState(true);
  const [error, setError]                 = useState<string | null>(null);

  const fetchVisited = useCallback(async () => {
    if (!profileId) {
      setVisitedPlaces([]);
      setVisitedPOIs(new Map());
      setLoading(false);
      return;
    }
    setLoading(true);
    setError(null);

    const { data, error: fetchError } = await supabase
      .from('visited_places')
      .select('*')
      .eq('profile_id', profileId)
      .order('last_visited_at', { ascending: false });

    if (fetchError) {
      console.error('[useVisitedPlaces] fetchVisited failed:', fetchError);
      setError(fetchError.message);
      setVisitedPlaces([]);
      setLoading(false);
      return;
    }

    const places = (data ?? []) as VisitedPlace[];
    setVisitedPlaces(places);

    if (places.length > 0) {
      const poiIds = places.map(p => p.poi_id);
      const { data: poiRows, error: poiError } = await supabase
        .from('pois')
        .select(POI_SNAPSHOT_COLUMNS)
        .in('id', poiIds);

      if (!poiError && poiRows) {
        const map = new Map<string, VisitedPOISnapshot>();
        for (const row of poiRows) map.set(row.id, toSnapshot(row));
        setVisitedPOIs(map);
      }
    } else {
      setVisitedPOIs(new Map());
    }

    setLoading(false);
  }, [profileId]);

  useEffect(() => {
    fetchVisited();
  }, [fetchVisited]);

  const isVisited = useCallback(
    (poiId: string) => visitedPlaces.some(vp => vp.poi_id === poiId),
    [visitedPlaces]
  );

  const getVisit = useCallback(
    (poiId: string) => visitedPlaces.find(vp => vp.poi_id === poiId) ?? null,
    [visitedPlaces]
  );

  /** Records a visit to a POI — first time inserts a row, later visits bump the count. */
  const recordVisit = useCallback(async (poiId: string, source: VisitSource = 'auto') => {
    if (!profileId) {
      console.error('[useVisitedPlaces] recordVisit failed: no profile loaded.');
      return false;
    }

    const existing = visitedPlaces.find(vp => vp.poi_id === poiId);
    const nowIso = new Date().toISOString();

    if (existing) {
      const { data, error: updateError } = await supabase
        .from('visited_places')
        .update({
          visit_count: existing.visit_count + 1,
          last_visited_at: nowIso,
          source,
        })
        .eq('id', existing.id)
        .select()
        .maybeSingle<VisitedPlace>();

      if (updateError) {
        console.error('[useVisitedPlaces] recordVisit (update) failed:', updateError);
        setError(updateError.message);
        return false;
      }
      if (data) {
        setVisitedPlaces(prev => prev.map(vp => (vp.id === data.id ? data : vp)));
      }
      return true;
    }

    const { data, error: insertError } = await supabase
      .from('visited_places')
      .insert({
        profile_id: profileId,
        poi_id: poiId,
        visit_count: 1,
        source,
        first_visited_at: nowIso,
        last_visited_at: nowIso,
      })
      .select()
      .maybeSingle<VisitedPlace>();

    if (insertError) {
      // Unique violation just means another call beat us to it — refresh and treat as success.
      if (insertError.code === '23505') {
        await fetchVisited();
        return true;
      }
      console.error('[useVisitedPlaces] recordVisit (insert) failed:', insertError);
      setError(insertError.message);
      return false;
    }

    if (data) {
      setVisitedPlaces(prev => [data, ...prev]);
      const { data: poiRow } = await supabase
        .from('pois')
        .select(POI_SNAPSHOT_COLUMNS)
        .eq('id', poiId)
        .maybeSingle();
      if (poiRow) {
        setVisitedPOIs(prev => {
          const next = new Map(prev);
          next.set(poiRow.id, toSnapshot(poiRow));
          return next;
        });
      }
    }
    return true;
  }, [profileId, visitedPlaces, fetchVisited]);

  const removeVisit = useCallback(async (poiId: string) => {
    if (!profileId) return false;
    const { error: deleteError } = await supabase
      .from('visited_places')
      .delete()
      .eq('profile_id', profileId)
      .eq('poi_id', poiId);

    if (deleteError) {
      console.error('[useVisitedPlaces] removeVisit failed:', deleteError);
      setError(deleteError.message);
      return false;
    }
    setVisitedPlaces(prev => prev.filter(vp => vp.poi_id !== poiId));
    setVisitedPOIs(prev => {
      const next = new Map(prev);
      next.delete(poiId);
      return next;
    });
    return true;
  }, [profileId]);

  return {
    visitedPlaces,
    visitedPOIs,
    loading,
    error,
    isVisited,
    getVisit,
    recordVisit,
    removeVisit,
    refresh: fetchVisited,
  };
}

/** Formats a last-visited timestamp as a short relative label, e.g. "Today", "3d ago". */
export function formatVisitedWhen(iso: string): string {
  const then = new Date(iso).getTime();
  const now = Date.now();
  const diffDays = Math.floor((now - then) / (1000 * 60 * 60 * 24));
  if (diffDays <= 0) return 'Today';
  if (diffDays === 1) return 'Yesterday';
  if (diffDays < 7) return `${diffDays}d ago`;
  if (diffDays < 30) return `${Math.floor(diffDays / 7)}w ago`;
  return new Date(iso).toLocaleDateString(undefined, { month: 'short', day: 'numeric' });
}
