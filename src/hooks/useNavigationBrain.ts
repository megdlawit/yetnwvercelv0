/**
 * useNavigationBrain — React binding for HybridNavigationBrain.
 *
 * Owns a single brain instance for the session, wires up active building/POIs,
 * and exposes a unified state + API to the UI. Replaces the trio of:
 *   useNavigation + useHybridNavigation + usePOIProximity
 * so the UI talks to a single coordinator.
 */

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import type { POI } from '@/data/poi';
import type { Building } from '@/data/types';
import {
  HybridNavigationBrain,
  type BrainDestination,
  type BrainState,
  type VenueGraphLike,
} from '@/lib/HybridNavigationBrain';
import type { GeoAnchor, TravelMode } from '@/lib/geo/GeoTypes';
import { toast } from 'sonner';

export interface UseNavigationBrainOptions {
  buildings: Building[];
  activeBuildingId: string;
  activeFloorId: string | null;
  pois: POI[];
  /** Curated venue graph (real admin-drawn paths) — preferred over the live
   *  Overpass/OSM fetch when it can connect the current start/destination. */
  venueGraph?: VenueGraphLike | null;
  /** Called whenever the brain switches indoor floor (e.g. multi-floor route). */
  onFloorChange?: (floorId: string) => void;
  autoStart?: boolean;
}

export interface UseNavigationBrainReturn {
  state: BrainState;
  brain: HybridNavigationBrain;
  startNavigation: (opts: { startNodeId?: string | null; destination: BrainDestination }) => boolean;
  stopNavigation: () => void;
  setDestination: (dest: BrainDestination | null) => void;
  toggleVoice: () => void;
  dismissPOI: (poiId: string) => void;
  pushIndoorPosition: (x: number, y: number) => void;
  recordStep: (ts: number) => void;
  recordHeading: (deg: number) => void;
  recordNoise: (variance: number) => void;
  startGPS: () => void;
  stopGPS: () => void;
  setIndoorAnchor: (anchored: boolean, buildingId: string | null) => void;
  speak: (msg: { text: string; priority: 'route' | 'warning' | 'poi' | 'info'; key?: string; immediate?: boolean }) => void;
  setNavigationMode: (mode: 'navigate' | 'explore') => void;
  setTravelMode: (mode: TravelMode) => void;
  /** Guidance language (English / Amharic). */
  setLanguage: (lang: 'en' | 'am') => void;
  preloadOutdoorGraph: (center: { lat: number; lng: number }) => void;
}

function anchorMetaFor(buildings: Building[]): Map<string, { anchor: GeoAnchor | null; radiusM: number }> {
  const m = new Map<string, { anchor: GeoAnchor | null; radiusM: number }>();
  for (const b of buildings) {
    const anchor: GeoAnchor | null = (b.originLat != null && b.originLng != null)
      ? {
          originLat: b.originLat,
          originLng: b.originLng,
          rotationDeg: b.rotationDeg ?? 0,
          metersPerPixel: b.metersPerPixel ?? 1,
        }
      : null;
    m.set(b.id, { anchor, radiusM: b.radiusM ?? 35 });
  }
  return m;
}

export function useNavigationBrain(opts: UseNavigationBrainOptions): UseNavigationBrainReturn {
  const brainRef = useRef<HybridNavigationBrain | null>(null);
  if (!brainRef.current) {
    brainRef.current = new HybridNavigationBrain({
      onArrival: () => toast.success('🎉 You have arrived!', { duration: 4000 }),
      onAnnounce: () => { /* voice handled inside brain */ },
    });
  }
  const brain = brainRef.current;

  const [state, setState] = useState<BrainState>(() => brain.getCurrentState());

  // Subscribe to brain state.
  useEffect(() => {
    const off = brain.onChange(setState);
    return off;
  }, [brain]);

  // Start positioning + cleanup.
  useEffect(() => {
    if (opts.autoStart) brain.start();
    return () => {
      brain.destroy();
      brainRef.current = null;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Push the building list (for env detection footprints).
  useEffect(() => {
    brain.setBuildings(opts.buildings, anchorMetaFor(opts.buildings));
  }, [brain, opts.buildings]);

  // Push the active building / floor (rebuilds the indoor controller).
  const activeBuilding = useMemo(
    () => opts.buildings.find(b => b.id === opts.activeBuildingId) ?? opts.buildings[0],
    [opts.buildings, opts.activeBuildingId],
  );

  const onFloorChangeRef = useRef(opts.onFloorChange);
  useEffect(() => { onFloorChangeRef.current = opts.onFloorChange; }, [opts.onFloorChange]);

  useEffect(() => {
    if (!activeBuilding) return;
    brain.setActiveBuilding(activeBuilding, opts.activeFloorId, (id) => onFloorChangeRef.current?.(id));
  }, [brain, activeBuilding, opts.activeFloorId]);

  // POIs.
  useEffect(() => {
    brain.setPOIs(opts.pois);
  }, [brain, opts.pois]);

  // Curated venue graph (real admin-drawn outdoor paths) — pushed whenever
  // the fetched graph changes (initial load, building switch, admin edits
  // via refresh()). Passing undefined/null is safe: the brain just falls
  // back to the live Overpass/OSM path as before.
  useEffect(() => {
    brain.setVenueGraph(opts.venueGraph ?? null);
  }, [brain, opts.venueGraph]);

  // ── Public API ────────────────────────────────────────────────────
  const startNavigation = useCallback(
    (o: { startNodeId?: string | null; destination: BrainDestination }) => brain.startNavigation(o),
    [brain],
  );
  const stopNavigation = useCallback(() => brain.stopNavigation(), [brain]);
  const setDestination = useCallback((d: BrainDestination | null) => brain.setDestination(d), [brain]);
  const toggleVoice = useCallback(() => {
    const next = !state.voiceEnabled;
    brain.setVoiceEnabled(next);
    toast.info(next ? '🔊 Voice guidance on' : '🔇 Voice guidance off', { duration: 1500 });
  }, [brain, state.voiceEnabled]);
  const dismissPOI = useCallback((id: string) => brain.dismissPOI(id), [brain]);
  const pushIndoorPosition = useCallback(
    (x: number, y: number) => brain.pushIndoorPosition(opts.activeBuildingId, opts.activeFloorId, x, y),
    [brain, opts.activeBuildingId, opts.activeFloorId],
  );
  const recordStep = useCallback((ts: number) => brain.recordStep(ts), [brain]);
  const recordHeading = useCallback((deg: number) => brain.recordHeading(deg), [brain]);
  const recordNoise = useCallback((v: number) => brain.recordNoise(v), [brain]);
  const startGPS = useCallback(() => brain.start(), [brain]);
  const stopGPS = useCallback(() => brain.stop(), [brain]);
  const setIndoorAnchor = useCallback(
    (anchored: boolean, bid: string | null) => brain.setIndoorAnchor(anchored, bid),
    [brain],
  );
  const speak = useCallback(
    (msg: { text: string; priority: 'route' | 'warning' | 'poi' | 'info'; key?: string; immediate?: boolean }) => brain.speak(msg),
    [brain],
  );
  const setNavigationMode = useCallback(
    (mode: 'navigate' | 'explore') => brain.setNavigationMode(mode),
    [brain],
  );
  const setTravelMode = useCallback(
    (mode: TravelMode) => brain.setTravelMode(mode),
    [brain],
  );
  const setLanguage = useCallback((lang: 'en' | 'am') => brain.setLanguage(lang), [brain]);
  const preloadOutdoorGraph = useCallback(
    (center: { lat: number; lng: number }) => brain.preloadOutdoorGraph(center),
    [brain],
  );

  return {
    state,
    brain,
    startNavigation,
    stopNavigation,
    setDestination,
    toggleVoice,
    dismissPOI,
    pushIndoorPosition,
    recordStep,
    recordHeading,
    recordNoise,
    startGPS,
    stopGPS,
    setIndoorAnchor,
    speak,
    setNavigationMode,
    setTravelMode,
    setLanguage,
    preloadOutdoorGraph,
  };
}
