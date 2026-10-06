/**
 * usePOILoader — Fetches POIs and promotions from Supabase for the current
 * building, with localStorage caching for offline use. POI data is decoupled
 * from the building graph so it never affects routing.
 */

import { useState, useEffect, useCallback } from 'react';
import { supabase } from '@/integrations/supabase/client';
import { POI, Promotion, POICategory } from '@/data/poi';
import { idbGet, idbSet, migrateFromLocalStorage, STORES } from '@/lib/offline/db';

const LEGACY_CACHE_PREFIX = 'indoor-nav-pois-';

interface CachedPOIs {
  pois: POI[];
  timestamp: number;
}

export interface UsePOILoaderReturn {
  pois: POI[];
  poisByNode: Map<string, POI>;
  loading: boolean;
  refresh: () => Promise<void>;
}

export function usePOILoader(buildingId: string | null | undefined): UsePOILoaderReturn {
  const [pois, setPois] = useState<POI[]>([]);
  const [loading, setLoading] = useState(false);

  const loadFromCache = useCallback(async (bid: string): Promise<POI[] | null> => {
    await migrateFromLocalStorage<CachedPOIs>(LEGACY_CACHE_PREFIX + bid, STORES.pois, bid);
    const data = await idbGet<CachedPOIs>(STORES.pois, bid);
    return data?.pois ?? null;
  }, []);

  const saveToCache = useCallback(async (bid: string, list: POI[]) => {
    const data: CachedPOIs = { pois: list, timestamp: Date.now() };
    await idbSet(STORES.pois, bid, data);
  }, []);

  const isUuid = useCallback((value: string) => {
    return /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(value);
  }, []);

  const fetchPOIs = useCallback(async (bid: string): Promise<void> => {
    if (!isUuid(bid)) {
      console.warn('Skipping POI fetch for non-UUID building id:', bid);
      setPois([]);
      setLoading(false);
      return;
    }

    setLoading(true);
    try {
      const [poiRes, promoRes] = await Promise.all([
        supabase.from('pois').select('*').eq('building_id', bid),
        supabase.from('promotions').select('*'),
      ]);

      if (poiRes.error) throw poiRes.error;
      if (promoRes.error) throw promoRes.error;

      const poiRows = poiRes.data || [];
      const promoRows = promoRes.data || [];

      const promosByPoi = new Map<string, Promotion[]>();
      for (const p of promoRows) {
        const list = promosByPoi.get(p.poi_id) ?? [];
        list.push({
          id: p.id,
          poiId: p.poi_id,
          title: p.title,
          description: p.description ?? '',
          discountText: p.discount_text ?? '',
          badgeColor: p.badge_color ?? 'primary',
          startsAt: p.starts_at,
          endsAt: p.ends_at,
          isActive: p.is_active,
        });
        promosByPoi.set(p.poi_id, list);
      }

      const list: POI[] = poiRows.map((p: Record<string, unknown>) => ({
        id: p.id as string,
        nodeId: (p.node_id as string | null) ?? null,
        buildingId: p.building_id as string,
        name: p.name as string,
        description: (p.description as string | null) ?? '',
        category: ((p.category as POICategory) || 'attraction'),
        subcategory: (p.subcategory as string | null) ?? '',
        imageUrl: (p.image_url as string | null) ?? null,
        audioUrl: (p.audio_url as string | null) ?? null,
        isFeatured: !!p.is_featured,
        triggerRadius: (p.trigger_radius as number | null) ?? 5,
        promotions: promosByPoi.get(p.id as string) ?? [],
        lat: (p.lat as number | null) ?? null,
        lng: (p.lng as number | null) ?? null,
        isOutdoor: !!p.is_outdoor,
      }));

      setPois(list);
      await saveToCache(bid, list);
    } catch (err) {
      console.error('POI fetch failed, trying cache:', err);
      const cached = await loadFromCache(bid);
      if (cached) setPois(cached);
      else setPois([]);
    } finally {
      setLoading(false);
    }
  }, [loadFromCache, saveToCache]);

  useEffect(() => {
    if (!buildingId) {
      setPois([]);
      return;
    }
    // Show cached immediately, then refresh
    let cancelled = false;
    loadFromCache(buildingId).then(cached => {
      if (!cancelled && cached) setPois(cached);
    });
    fetchPOIs(buildingId);
    return () => { cancelled = true; };
  }, [buildingId, loadFromCache, fetchPOIs]);

  const poisByNode = new Map<string, POI>();
  for (const p of pois) if (p.nodeId) poisByNode.set(p.nodeId, p);

  return {
    pois,
    poisByNode,
    loading,
    refresh: () => buildingId ? fetchPOIs(buildingId) : Promise.resolve(),
  };
}
