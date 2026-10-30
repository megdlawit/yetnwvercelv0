/**
 * useHybridPositioning — React hook wrapping HybridPositioningEngine.
 *
 * Provides:
 *  • Live HybridPosition updates (state-driven, batched via React scheduler)
 *  • PositionDebugSnapshot for the debug overlay
 *  • Controls: start, stop, pushIndoorPosition, setIndoorAnchor, setBuildings
 *
 * The engine itself is long-lived (created once per mount); only position
 * state triggers re-renders.
 */

import { useState, useEffect, useRef, useCallback } from 'react';
import {
  HybridPositioningEngine,
  type HybridPosition,
  type HybridPositioningConfig,
  type PositionDebugSnapshot,
} from '@/lib/geo/HybridPositioningEngine';
import { GPSPositioning } from '@/lib/geo/GPSPositioning';
import { EnvironmentTransitionManager } from '@/lib/geo/EnvironmentTransitionManager';
import { RoadSnapper } from '@/lib/geo/RoadSnapper';
import { HeadingTracker } from '@/lib/HeadingTracker';
import type { GeoAnchor, OutdoorGraph } from '@/lib/geo/GeoTypes';

export interface UseHybridPositioningOptions {
  /** Auto-start GPS on mount. Default true. */
  autoStart?: boolean;
  /** Engine config overrides. */
  config?: Partial<HybridPositioningConfig>;
  /** Outdoor graph to enable road snapping. */
  outdoorGraph?: OutdoorGraph | null;
  /** Buildings for environment detection. */
  buildings?: Array<{ id: string; anchor: GeoAnchor | null; radiusM: number }>;
}

export interface UseHybridPositioningReturn {
  position: HybridPosition;
  debug: PositionDebugSnapshot;
  isTracking: boolean;
  /** Push a new indoor PDR position. */
  pushIndoorPosition: (buildingId: string, floorId: string | null, x: number, y: number) => void;
  /** Mark the user as anchored inside a building (e.g. after QR scan). */
  setIndoorAnchor: (anchored: boolean, buildingId: string | null) => void;
  /** Access the raw engine (for advanced usage). */
  engine: HybridPositioningEngine | null;
}

const EMPTY_POSITION: HybridPosition = {
  lat: null,
  lng: null,
  x: null,
  y: null,
  floor: null,
  heading: NaN,
  accuracy: Infinity,
  environment: 'unknown',
  indoor: null,
  geo: null,
  accuracyM: null,
  blending: false,
  source: 'none',
  timestamp: 0,
};

const EMPTY_DEBUG: PositionDebugSnapshot = {
  environment: 'unknown',
  gpsAccuracyM: null,
  speedMs: null,
  heading: NaN,
  rawLat: null,
  rawLng: null,
  snappedLat: null,
  snappedLng: null,
  isSnapped: false,
  snapDistanceM: null,
  lastGoodAge: 0,
  positionSource: 'none',
  jumpRejected: false,
  accuracyRejected: false,
  speedRejected: false,
};

export function useHybridPositioning(
  opts: UseHybridPositioningOptions = {},
): UseHybridPositioningReturn {
  const { autoStart = true, config, outdoorGraph, buildings } = opts;

  const engineRef = useRef<HybridPositioningEngine | null>(null);
  const [position, setPosition] = useState<HybridPosition>(EMPTY_POSITION);
  const [isTracking, setIsTracking] = useState(false);
  const [debug, setDebug] = useState<PositionDebugSnapshot>(EMPTY_DEBUG);

  // Create engine once
  useEffect(() => {
    const gps = new GPSPositioning();
    const env = new EnvironmentTransitionManager();
    const snapper = new RoadSnapper();
    const engine = new HybridPositioningEngine(gps, env, snapper, config ?? {});
    engineRef.current = engine;

    const unsubPos = engine.onChange(pos => {
      setPosition(pos);
      setDebug(engine.getDebugSnapshot());
    });

    // Track GPS status
    const unsubStatus = gps.onStatus(status => {
      setIsTracking(status === 'tracking');
    });

    if (autoStart) engine.start();

    // ── Device-compass heading (same source indoor PDR uses) ────────────────
    // GPS course-over-ground (`fix.heading`) is only ever set while the user
    // is walking fast enough for the OS to derive a bearing — it's null the
    // instant they stop, which is why the direction cone used to freeze/
    // vanish outdoors while it kept working fine indoors. Feeding the phone's
    // magnetometer/compass in here (exactly like indoor's HeadingTracker)
    // makes outdoor heading behave the same way: available whether stationary
    // or moving, indoors or out.
    const tracker = new HeadingTracker(() => {
      engineRef.current?.setCompassHeading(tracker.getHeadingDegrees());
    });

    const orientHandler = (e: DeviceOrientationEvent) => tracker.handleOrientation(e.alpha);

    let compassActive = false;
    const attachCompass = () => {
      if (compassActive) return;
      compassActive = true;
      window.addEventListener('deviceorientation', orientHandler, { passive: true });
    };

    const tryStartCompass = async () => {
      try {
        const DOE = typeof DeviceOrientationEvent !== 'undefined' ? (DeviceOrientationEvent as unknown as { requestPermission?: () => Promise<string> }) : null;
        if (DOE && typeof DOE.requestPermission === 'function') {
          // iOS 13+: requires an explicit permission grant, and reliably only
          // resolves 'granted' when called from within a user gesture. Try
          // immediately; if that fails, retry on the user's first tap/touch.
          try {
            const perm = await DOE.requestPermission();
            if (perm === 'granted') attachCompass();
          } catch {
            // Needs a user gesture — retry once on first interaction.
          }
        } else {
          // Android / desktop: no permission gate needed.
          attachCompass();
        }
      } catch {
        // Sensor unavailable — outdoor heading will just fall back to GPS course.
      }
    };
    tryStartCompass();

    const retryOnGesture = () => {
      if (compassActive) return;
      tryStartCompass();
    };
    window.addEventListener('click', retryOnGesture, { once: true, passive: true });
    window.addEventListener('touchend', retryOnGesture, { once: true, passive: true });

    return () => {
      unsubPos();
      unsubStatus();
      engine.destroy();
      engineRef.current = null;
      window.removeEventListener('deviceorientation', orientHandler);
      window.removeEventListener('click', retryOnGesture);
      window.removeEventListener('touchend', retryOnGesture);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []); // intentionally stable

  // Update outdoor graph for snapping
  useEffect(() => {
    if (engineRef.current && outdoorGraph !== undefined) {
      engineRef.current.snapper.setGraph(outdoorGraph ?? null);
    }
  }, [outdoorGraph]);

  // Update building footprints
  useEffect(() => {
    if (engineRef.current && buildings) {
      engineRef.current.setBuildings(buildings);
    }
  }, [buildings]);

  const pushIndoorPosition = useCallback(
    (buildingId: string, floorId: string | null, x: number, y: number) => {
      engineRef.current?.pushIndoorPosition(buildingId, floorId, x, y);
    },
    [],
  );

  const setIndoorAnchor = useCallback(
    (anchored: boolean, buildingId: string | null) => {
      engineRef.current?.setIndoorAnchor(anchored, buildingId);
    },
    [],
  );

  return {
    position,
    debug,
    isTracking,
    pushIndoorPosition,
    setIndoorAnchor,
    engine: engineRef.current,
  };
}
