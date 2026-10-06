/**
 * useBuildingLoader — Fetches all published buildings with floors, nodes,
 * and edges from Supabase, constructs Building objects, and caches offline.
 */

import { useState, useEffect, useCallback } from 'react';
import { supabase } from '@/integrations/supabase/client';
import { Building, Floor, NavNode, NavEdge } from '@/data/types';
import { toast } from 'sonner';
import { idbGet, idbSet, migrateFromLocalStorage, STORES } from '@/lib/offline/db';
import { EDITOR_PX_PER_METER, planExtent, sanitizeMetersPerPixel } from '@/lib/navScale';

const LEGACY_CACHE_KEY = 'indoor-nav-cached-buildings';
const IDB_KEY = 'all';

interface CachedData {
  buildings: Building[];
  version: number;
  timestamp: number;
}

export interface UseBuildingLoaderReturn {
  building: Building | null;
  buildings: Building[];
  loading: boolean;
  isOffline: boolean;
  refresh: () => Promise<void>;
}

/** `enabled: false` skips loading entirely (a page that brings its own venue data). */
export function useBuildingLoader(enabled = true): UseBuildingLoaderReturn {
  const [building, setBuilding] = useState<Building | null>(null);
  const [buildings, setBuildings] = useState<Building[]>([]);
  const [loading, setLoading] = useState(enabled);
  const [isOffline, setIsOffline] = useState(false);

  const loadFromCache = useCallback(async (): Promise<CachedData | null> => {
    await migrateFromLocalStorage<CachedData>(LEGACY_CACHE_KEY, STORES.buildings, IDB_KEY);
    return idbGet<CachedData>(STORES.buildings, IDB_KEY);
  }, []);

  const saveToCache = useCallback(async (buildings: Building[], version: number) => {
    const data: CachedData = { buildings, version, timestamp: Date.now() };
    await idbSet(STORES.buildings, IDB_KEY, data);
  }, []);

  const fetchFromCloud = useCallback(async (): Promise<void> => {
    setLoading(true);
    try {
      // Fetch all published buildings
      const { data: bRows, error: bErr } = await supabase
        .from('buildings')
        .select('*')
        .eq('is_published', true)
        .order('name');

      if (bErr) throw bErr;
      if (!bRows || bRows.length === 0) {
        // No published buildings — fall through to sample data by returning
        // empty array; Index.tsx will use sampleBuildings as the fallback.
        setBuildings([]);
        setBuilding(null);
        setLoading(false);
        return;
      }

      const buildingIds = bRows.map(b => b.id);

      // Fetch floors, nodes, edges in parallel
      const [floorsRes, nodesRes, edgesRes] = await Promise.all([
        supabase.from('floors').select('*').in('building_id', buildingIds).order('level'),
        supabase.from('nodes').select('*').in('building_id', buildingIds),
        supabase.from('edges').select('*').in('building_id', buildingIds),
      ]);

      if (floorsRes.error) throw floorsRes.error;
      if (nodesRes.error) throw nodesRes.error;
      if (edgesRes.error) throw edgesRes.error;

      const allBuildings: Building[] = bRows.map(bRow => {
        const floors: Floor[] = (floorsRes.data || [])
          .filter(f => f.building_id === bRow.id)
          .map(f => {
            const floorNodes: NavNode[] = (nodesRes.data || [])
              .filter(n => n.floor_id === f.id)
              .map(n => ({
                id: n.id,
                floorId: f.id,
                name: n.name,
                x: n.x,
                y: n.y,
                isHallway: n.is_hallway,
              }));

            const floorEdges: NavEdge[] = (edgesRes.data || [])
              .filter(e => {
                const nodeIds = new Set(floorNodes.map(n => n.id));
                return nodeIds.has(e.from_node) || nodeIds.has(e.to_node);
              })
              .map(e => ({
                id: e.id,
                fromNodeId: e.from_node,
                toNodeId: e.to_node,
                weight: e.weight,
              }));

            return {
              id: f.id,
              buildingId: bRow.id,
              level: f.level,
              name: f.name,
              // Big enough for the whole plan (real plans are often larger than 800×500).
              ...planExtent(floorNodes),
              rooms: [],
              nodes: floorNodes,
              edges: floorEdges,
              walls: [],
            };
          });

        const row = bRow as Record<string, unknown>;
        return {
          id: bRow.id,
          name: bRow.name,
          address: bRow.description || '',
          city: '',
          floors,
          originLat: (row.origin_lat as number | null) ?? null,
          originLng: (row.origin_lng as number | null) ?? null,
          rotationDeg: (row.rotation_deg as number | null) ?? null,
          // Real scale, so steps, distances and arrival are in true metres.
          metersPerPixel: sanitizeMetersPerPixel(row.meters_per_pixel as number | null),
          // Plans are drawn at the editor's scale; distances follow it exactly.
          planPxPerMeter: EDITOR_PX_PER_METER,
          radiusM: 35,
        };
      });

      setBuildings(allBuildings);
      if (allBuildings.length > 0) {
        setBuilding(allBuildings[0]);
      }
      // Sum all versions for cache invalidation
      const totalVersion = bRows.reduce((sum, b) => sum + b.version, 0);
      await saveToCache(allBuildings, totalVersion);
      setIsOffline(false);
    } catch (err) {
      console.error('Cloud fetch failed, trying cache:', err);
      const cached = await loadFromCache();
      if (cached) {
        setBuilding(cached.buildings[0] || null);
        setBuildings(cached.buildings);
        setIsOffline(true);
        toast.info('Offline Mode — using cached data');
      } else {
        toast.error('Failed to load building data');
      }
    } finally {
      setLoading(false);
    }
  }, [loadFromCache, saveToCache]);

  // Auto version refresh
  useEffect(() => {
    if (!enabled) return;
    const checkVersion = async () => {
      const cached = await loadFromCache();
      if (!cached) {
        await fetchFromCloud();
        return;
      }
      try {
        const { data } = await supabase
          .from('buildings')
          .select('version')
          .eq('is_published', true);

        const totalVersion = (data || []).reduce((sum, b) => sum + b.version, 0);

        if (totalVersion !== cached.version) {
          console.log('Version changed, refreshing...');
          await fetchFromCloud();
        } else {
          // Use cache
          setBuilding(cached.buildings[0] || null);
          setBuildings(cached.buildings);
          setLoading(false);
        }
      } catch {
        setBuilding(cached.buildings[0] || null);
        setBuildings(cached.buildings);
        setIsOffline(true);
        setLoading(false);
      }
    };
    checkVersion();
  }, [enabled, fetchFromCloud, loadFromCache]);

  return { building, buildings, loading, isOffline, refresh: fetchFromCloud };
}
