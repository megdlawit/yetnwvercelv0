/**
 * usePOIProximity — Real-time POI Trigger System.
 *
 * Continuously checks distance between user position (from PDR) and POIs,
 * using each POI's triggerRadius. Featured POIs auto-trigger an immediate
 * card; non-featured POIs surface in the "Nearby Experiences" panel for
 * manual interaction. Triggers are throttled with:
 *   • 300ms debounce on proximity checks
 *   • Per-POI cooldown so the same POI can't re-trigger spam-style
 *   • Spatial pre-filter (NEARBY_RADIUS) so we never iterate distant POIs
 *
 * State exposed:
 *   • triggeredPOIs    — Set of POI ids already auto-triggered this session
 *   • lastTriggeredAt  — timestamp of the most recent auto-trigger
 *   • currentActivePoi — the POI currently shown in the auto-toast (if any)
 *   • nearby           — closest non-triggered POIs within nearby radius
 */

import { useEffect, useMemo, useRef, useState } from 'react';
import { POI } from '@/data/poi';
import { NavNode } from '@/data/types';

interface UsePOIProximityArgs {
  pois: POI[];
  nodesById: Map<string, NavNode>;
  position: { x: number; y: number } | null;
  currentFloorId: string | null;
  isNavigating: boolean;
  onAnnounce?: (text: string) => void;
}

export interface POIWithDistance {
  poi: POI;
  distance: number;
}

const NEARBY_RADIUS = 60;       // panel/list visibility radius (map units)
const DEBOUNCE_MS = 300;        // proximity check debounce
const COOLDOWN_MS = 30_000;     // per-POI cooldown before it can re-trigger

export function usePOIProximity({
  pois,
  nodesById,
  position,
  currentFloorId,
  isNavigating,
  onAnnounce,
}: UsePOIProximityArgs) {
  const [autoTriggeredPoi, setAutoTriggeredPoi] = useState<POI | null>(null);
  const [triggeredPOIs, setTriggeredPOIs] = useState<Set<string>>(new Set());
  const [lastTriggeredAt, setLastTriggeredAt] = useState<number>(0);

  const cooldownRef = useRef<Map<string, number>>(new Map()); // poiId -> ts
  const dismissedRef = useRef<Set<string>>(new Set());
  const announcedRef = useRef<Set<string>>(new Set());
  const debouncedPos = useRef<{ x: number; y: number } | null>(null);
  const debounceTimerRef = useRef<number | null>(null);

  // POIs filtered to current floor
  const floorPois = useMemo(() => {
    if (!currentFloorId) return [] as POI[];
    return pois.filter(p => {
      const node = nodesById.get(p.nodeId);
      return node?.floorId === currentFloorId;
    });
  }, [pois, nodesById, currentFloorId]);

  // Debounce raw position changes -> debouncedPos
  useEffect(() => {
    if (!position) return;
    if (debounceTimerRef.current) window.clearTimeout(debounceTimerRef.current);
    debounceTimerRef.current = window.setTimeout(() => {
      debouncedPos.current = position;
      // bump a state to recompute ranked/effects
      setTick(t => t + 1);
    }, DEBOUNCE_MS);
    return () => {
      if (debounceTimerRef.current) window.clearTimeout(debounceTimerRef.current);
    };
  }, [position?.x, position?.y]);

  const [tick, setTick] = useState(0);

  // Distances from debounced position with spatial pre-filter
  const ranked = useMemo<POIWithDistance[]>(() => {
    const pos = debouncedPos.current ?? position;
    if (!pos) return [];
    const out: POIWithDistance[] = [];
    for (const poi of floorPois) {
      if (!poi.nodeId) continue;
      const n = nodesById.get(poi.nodeId);
      if (!n) continue;
      const dx = n.x - pos.x;
      const dy = n.y - pos.y;
      // cheap bbox pre-filter before sqrt
      if (Math.abs(dx) > NEARBY_RADIUS && Math.abs(dy) > NEARBY_RADIUS) continue;
      const distance = Math.sqrt(dx * dx + dy * dy);
      out.push({ poi, distance });
    }
    return out.sort((a, b) => a.distance - b.distance);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [floorPois, nodesById, tick, position?.x, position?.y]);

  const nearby = useMemo(
    () => ranked.filter(r => r.distance <= NEARBY_RADIUS).slice(0, 5),
    [ranked]
  );

  // Auto-trigger featured POIs when within their trigger radius
  useEffect(() => {
    if (!isNavigating) return;
    const now = Date.now();
    for (const { poi, distance } of ranked) {
      if (!poi.isFeatured) continue;
      if (dismissedRef.current.has(poi.id)) continue;
      const cooldownUntil = cooldownRef.current.get(poi.id) ?? 0;
      if (cooldownUntil > now) continue;
      if (distance <= poi.triggerRadius) {
        // Trigger
        setAutoTriggeredPoi(poi);
        setLastTriggeredAt(now);
        setTriggeredPOIs(prev => {
          if (prev.has(poi.id)) return prev;
          const next = new Set(prev);
          next.add(poi.id);
          return next;
        });
        cooldownRef.current.set(poi.id, now + COOLDOWN_MS);
        if (!announcedRef.current.has(poi.id)) {
          announcedRef.current.add(poi.id);
          onAnnounce?.(`You are near ${poi.name}. ${poi.description}`);
        }
        return;
      }
    }
    // No featured POI in range — clear auto card if its POI moved out of range
    if (autoTriggeredPoi) {
      const stillIn = ranked.find(r => r.poi.id === autoTriggeredPoi.id);
      if (!stillIn || stillIn.distance > autoTriggeredPoi.triggerRadius * 1.4) {
        setAutoTriggeredPoi(null);
      }
    }
  }, [ranked, isNavigating, onAnnounce, autoTriggeredPoi]);

  const dismissAutoPoi = (poiId: string) => {
    dismissedRef.current.add(poiId);
    cooldownRef.current.set(poiId, Date.now() + COOLDOWN_MS);
    setAutoTriggeredPoi(null);
  };

  // Reset when navigation stops
  useEffect(() => {
    if (!isNavigating) {
      announcedRef.current.clear();
      dismissedRef.current.clear();
      cooldownRef.current.clear();
      setTriggeredPOIs(new Set());
      setLastTriggeredAt(0);
      setAutoTriggeredPoi(null);
    }
  }, [isNavigating]);

  return {
    nearby,
    autoTriggeredPoi,
    currentActivePoi: autoTriggeredPoi,
    triggeredPOIs,
    lastTriggeredAt,
    dismissAutoPoi,
    floorPois,
  };
}
