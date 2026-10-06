/**
 * Fetches admin-curated "Popular" places for the search panel
 * (POIs and buildings where is_search_popular = true).
 */
import { useCallback, useEffect, useState } from 'react';
import { supabase } from '@/integrations/supabase/client';
import { POI_CATEGORY_META, type POICategory } from '@/data/poi';

export interface PopularPOI {
  kind: 'poi';
  id: string;
  name: string;
  description: string;
  category: string;
  imageUrl: string | null;
  buildingId: string;
  isOutdoor: boolean;
}

export interface PopularBuilding {
  kind: 'building';
  id: string;
  name: string;
  description: string;
}

export type PopularSearchPlace = PopularPOI | PopularBuilding;

export function usePopularSearchPlaces() {
  const [places, setPlaces] = useState<PopularSearchPlace[]>([]);
  const [loading, setLoading] = useState(true);

  const fetchPopular = useCallback(async () => {
    setLoading(true);
    try {
      const [poiRes, buildingRes] = await Promise.all([
        supabase
          .from('pois')
          .select('id, name, description, category, image_url, building_id, is_outdoor')
          .eq('is_search_popular', true)
          .order('name'),
        supabase
          .from('buildings')
          .select('id, name, description')
          .eq('is_search_popular', true)
          .order('name'),
      ]);

      const popularPois: PopularPOI[] = (poiRes.data ?? []).map((p) => ({
        kind: 'poi' as const,
        id: p.id,
        name: p.name,
        description: p.description ?? '',
        category: p.category ?? 'attraction',
        imageUrl: p.image_url,
        buildingId: p.building_id,
        isOutdoor: !!p.is_outdoor,
      }));

      const popularBuildings: PopularBuilding[] = (buildingRes.data ?? []).map((b) => ({
        kind: 'building' as const,
        id: b.id,
        name: b.name,
        description: b.description ?? '',
      }));

      setPlaces([...popularBuildings, ...popularPois]);
    } catch (err) {
      console.warn('Failed to load popular search places:', err);
      setPlaces([]);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void fetchPopular();
    const onFocus = () => { void fetchPopular(); };
    window.addEventListener('focus', onFocus);
    return () => window.removeEventListener('focus', onFocus);
  }, [fetchPopular]);

  return { places, loading, refresh: fetchPopular };
}

export function popularPlaceTypeLabel(place: PopularSearchPlace): string {
  if (place.kind === 'building') return 'Indoor building';
  const meta = POI_CATEGORY_META[(place.category as POICategory) || 'attraction'];
  return place.isOutdoor ? `Outdoor · ${meta.label}` : meta.label;
}
