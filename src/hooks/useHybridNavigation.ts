/**
 * useHybridNavigation — React hook bridging HybridPositioningEngine into the UI.
 *
 * Responsibilities:
 *   • Owns a single HybridPositioningEngine instance for the session.
 *   • Pushes the indoor PDR position into the engine.
 *   • Exposes the unified HybridPosition + environment + outdoor graph state.
 *   • Lazily loads an outdoor walkable graph (Overpass) when GPS is available
 *     near the active building.
 */

import { useEffect, useMemo, useRef, useState, useCallback } from 'react';
import { HybridPositioningEngine, type HybridPosition } from '@/lib/geo/HybridPositioningEngine';
import { OutdoorMapEngine } from '@/lib/geo/OutdoorMapEngine';
import { RoadSnapper } from '@/lib/geo/RoadSnapper';
import type { GeoAnchor, OutdoorGraph } from '@/lib/geo/GeoTypes';
import type { Building } from '@/data/types';

export interface UseHybridNavigationOptions {
  /** Buildings with optional geo-anchor metadata. */
  buildings: Array<Building & {
    originLat?: number | null;
    originLng?: number | null;
    rotationDeg?: number | null;
    metersPerPixel?: number | null;
    radiusM?: number | null;
  }>;
  activeBuildingId: string;
  activeFloorId: string | null;
  /** Current indoor PDR position to feed the engine. */
  indoorPosition: { x: number; y: number } | null;
  /** True when an indoor anchor (QR/manual) has been set. */
  indoorAnchored: boolean;
  /** Auto-start GPS tracking. */
  autoStart?: boolean;
}

export interface UseHybridNavigationReturn {
  position: HybridPosition;
  outdoorGraph: OutdoorGraph | null;
  outdoorEngine: OutdoorMapEngine;
  roadSnapper: RoadSnapper;
  startGPS: () => void;
  stopGPS: () => void;
  gpsStatus: ReturnType<HybridPositioningEngine['gps']['getStatus']>;
}

const DEFAULT_RADIUS_M = 35;

function getAnchor(b: UseHybridNavigationOptions['buildings'][number]): GeoAnchor | null {
  if (b.originLat == null || b.originLng == null) return null;
  return {
    originLat: b.originLat,
    originLng: b.originLng,
    rotationDeg: b.rotationDeg ?? 0,
    metersPerPixel: b.metersPerPixel ?? 1,
  };
}

export function useHybridNavigation(opts: UseHybridNavigationOptions): UseHybridNavigationReturn {
  const engineRef = useRef<HybridPositioningEngine | null>(null);
  if (!engineRef.current) engineRef.current = new HybridPositioningEngine();

  const outdoorEngineRef = useRef<OutdoorMapEngine | null>(null);
  if (!outdoorEngineRef.current) outdoorEngineRef.current = new OutdoorMapEngine();

  const roadSnapperRef = useRef<RoadSnapper | null>(null);
  if (!roadSnapperRef.current) roadSnapperRef.current = new RoadSnapper();

  const [position, setPosition] = useState<HybridPosition>(() => engineRef.current!.getPosition());
  const [outdoorGraph, setOutdoorGraph] = useState<OutdoorGraph | null>(null);
  const [gpsStatus, setGpsStatus] = useState(() => engineRef.current!.gps.getStatus());

  // Subscribe to engine + GPS status.
  useEffect(() => {
    const eng = engineRef.current!;
    const offPos = eng.onChange(setPosition);
    const offStatus = eng.gps.onStatus(setGpsStatus);
    return () => {
      offPos();
      offStatus();
    };
  }, []);

  // Push building footprints into the engine when they change.
  useEffect(() => {
    const eng = engineRef.current!;
    eng.setBuildings(
      opts.buildings.map(b => ({
        id: b.id,
        anchor: getAnchor(b),
        radiusM: b.radiusM ?? DEFAULT_RADIUS_M,
      })),
    );
  }, [opts.buildings]);

  // Auto-start GPS once on mount if requested.
  useEffect(() => {
    if (opts.autoStart) engineRef.current!.start();
    return () => {
      engineRef.current?.destroy();
      engineRef.current = null;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Push indoor anchor state.
  useEffect(() => {
    engineRef.current!.setIndoorAnchor(opts.indoorAnchored, opts.activeBuildingId || null);
  }, [opts.indoorAnchored, opts.activeBuildingId]);

  // Push indoor positions.
  useEffect(() => {
    if (!opts.indoorPosition || !opts.activeBuildingId) return;
    engineRef.current!.pushIndoorPosition(
      opts.activeBuildingId,
      opts.activeFloorId,
      opts.indoorPosition.x,
      opts.indoorPosition.y,
    );
  }, [opts.indoorPosition, opts.activeBuildingId, opts.activeFloorId]);

  // Lazily load outdoor graph around the active building (or current GPS).
  useEffect(() => {
    const eng = outdoorEngineRef.current!;
    const snap = roadSnapperRef.current!;
    const active = opts.buildings.find(b => b.id === opts.activeBuildingId);
    const anchor = active ? getAnchor(active) : null;
    const center = anchor
      ? { lat: anchor.originLat, lng: anchor.originLng }
      : position.geo;
    if (!center) return;
    let cancelled = false;
    eng.loadAround(center, 600).then(graph => {
      if (cancelled || !graph) return;
      snap.setGraph(graph);
      setOutdoorGraph(graph);
    });
    return () => {
      cancelled = true;
    };
  }, [opts.activeBuildingId, opts.buildings, position.geo]);

  const startGPS = useCallback(() => engineRef.current?.start(), []);
  const stopGPS = useCallback(() => engineRef.current?.stop(), []);

  return useMemo(
    () => ({
      position,
      outdoorGraph,
      outdoorEngine: outdoorEngineRef.current!,
      roadSnapper: roadSnapperRef.current!,
      startGPS,
      stopGPS,
      gpsStatus,
    }),
    [position, outdoorGraph, gpsStatus, startGPS, stopGPS],
  );
}
