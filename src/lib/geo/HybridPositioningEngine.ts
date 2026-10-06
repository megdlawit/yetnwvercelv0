/**
 * HybridPositioningEngine — single source of truth for "where is the user?"
 * across indoor (PDR) and outdoor (GPS) modes.
 *
 * Sprint 1 Prototype — Module 1: Hybrid Positioning Engine
 *
 * Features:
 *  • Unified HybridPosition stream: lat, lng, x, y, floor, heading, accuracy, environment
 *  • EMA smoothing separately for position AND heading (with circular interpolation)
 *  • Jump prevention: ignores moves > 5m unless GPS accuracy is very high
 *  • Snap-to-path via RoadSnapper with gradual blend (no teleporting)
 *  • Environment transition handling: 1-2s hysteresis, no flicker
 *  • Stability rules: rejects bad accuracy + unrealistic speed
 *  • Last-known-good position fallback
 *  • Debug snapshot for overlay UI
 */

import type { Environment, GeoAnchor, GeoCoord, GeoFix } from './GeoTypes';
import { GPSPositioning } from './GPSPositioning';
import {
  EnvironmentTransitionManager,
  type EnvSnapshot,
  type BuildingFootprint,
} from './EnvironmentTransitionManager';
import { RoadSnapper, type RoadSnapResult } from './RoadSnapper';
import { indoorToGeo, geoToIndoor, haversineMeters } from './GeoMath';

// ─── Unified position output ──────────────────────────────────────────────────

export interface HybridPosition {
  /** WGS84 coordinates (always set if any source is available). */
  lat: number | null;
  lng: number | null;

  /** Indoor pixel coordinates (set when environment is indoor / transitioning). */
  x: number | null;
  y: number | null;

  /** Current floor ID (indoor only). */
  floor: string | null;

  /** Heading in degrees, 0 = North, clockwise. NaN when unavailable. */
  heading: number;

  /** Horizontal accuracy in meters. */
  accuracy: number;

  /** Active environment classification. */
  environment: Environment;

  // ── legacy compatibility fields (kept for existing consumers) ──
  indoor: { x: number; y: number; buildingId: string; floorId: string | null } | null;
  geo: GeoCoord | null;
  accuracyM: number | null;
  blending: boolean;
  source: 'pdr' | 'gps' | 'blend' | 'none';
  timestamp: number;
}

// ─── Debug snapshot ───────────────────────────────────────────────────────────

export interface PositionDebugSnapshot {
  environment: Environment;
  gpsAccuracyM: number | null;
  speedMs: number | null;
  heading: number;
  rawLat: number | null;
  rawLng: number | null;
  snappedLat: number | null;
  snappedLng: number | null;
  isSnapped: boolean;
  snapDistanceM: number | null;
  lastGoodAge: number; // ms since last known good fix
  positionSource: 'pdr' | 'gps' | 'blend' | 'none';
  jumpRejected: boolean;
  accuracyRejected: boolean;
  speedRejected: boolean;
}

// ─── Configuration ────────────────────────────────────────────────────────────

export interface HybridPositioningConfig {
  /** EMA alpha for position smoothing (0=frozen, 1=raw). Outdoor. */
  positionAlphaOutdoor: number;
  /** EMA alpha for position smoothing. Indoor. */
  positionAlphaIndoor: number;
  /** EMA alpha for heading smoothing. */
  headingAlpha: number;
  /** Reject GPS fixes with accuracy worse than this. */
  maxGpsAccuracyM: number;
  /** Max realistic speed indoors (m/s). Fixes implying higher speed rejected. */
  maxSpeedIndoorMs: number;
  /** Max realistic speed outdoors (m/s). */
  maxSpeedOutdoorMs: number;
  /** If a new position is more than this from smoothed, require high GPS accuracy to accept. */
  jumpThresholdM: number;
  /** GPS accuracy threshold to bypass jump guard (high-confidence fix). */
  highAccuracyM: number;
  /** Snap to road only if within this distance (meters). */
  snapThresholdM: number;
  /** EMA alpha for blending snap correction (0=no snap, 1=instant snap). */
  snapBlendAlpha: number;
}

export const DEFAULT_HYBRID_CONFIG: HybridPositioningConfig = {
  positionAlphaOutdoor: 0.25,
  positionAlphaIndoor: 0.4,
  headingAlpha: 0.2,
  maxGpsAccuracyM: 75,
  maxSpeedIndoorMs: 3,
  maxSpeedOutdoorMs: 10,
  jumpThresholdM: 25,
  highAccuracyM: 20,
  snapThresholdM: 8,
  snapBlendAlpha: 0.15,
};

// Mirrors GPSPositioning's INITIAL_ACCEPT_ACCURACY_M: this engine re-applies
// its own accuracy gate on top of GPSPositioning's, so without this it would
// immediately re-reject the same rough-but-useful first fix GPSPositioning
// just let through, and the blue dot would still never appear.
const INITIAL_ACCEPT_ACCURACY_M = 500;

// ─── Empty/default position ───────────────────────────────────────────────────

const EMPTY: HybridPosition = {
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

// ─── Circular heading interpolation ──────────────────────────────────────────

function lerpHeadingDeg(from: number, to: number, alpha: number): number {
  if (!isFinite(from)) return to;
  if (!isFinite(to)) return from;
  const delta = ((to - from + 540) % 360) - 180; // shortest arc, -180..180
  return (from + delta * alpha + 360) % 360;
}

// ─── HybridPositioningEngine ──────────────────────────────────────────────────

export class HybridPositioningEngine {
  readonly gps: GPSPositioning;
  readonly env: EnvironmentTransitionManager;
  readonly snapper: RoadSnapper;

  private cfg: HybridPositioningConfig;
  private anchorByBuilding = new Map<string, GeoAnchor>();

  // ── Smoothed state ─────────────────────────────────────────────────────
  private smoothedGeo: GeoCoord | null = null;
  private smoothedIndoor: { x: number; y: number } | null = null;
  /** Heading from GPS course-over-ground — only present while moving, never while stationary. */
  private gpsHeading: number = NaN;
  /** Heading from the device compass (DeviceOrientationEvent) — works indoors AND outdoors, moving or stationary. */
  private compassHeading: number = NaN;
  /** Snapper-corrected geo position (gradually blended). */
  private snappedGeo: GeoCoord | null = null;

  // ── Raw cache ──────────────────────────────────────────────────────────
  private rawGeoFix: GeoFix | null = null;
  private indoorCache: HybridPosition['indoor'] = null;
  private envSnap: EnvSnapshot = {
    environment: 'unknown',
    insideBuildingId: null,
    blend: 0,
    reason: 'init',
  };

  // ── Last-known-good fallback ───────────────────────────────────────────
  private lastGoodPosition: HybridPosition = EMPTY;
  private lastGoodAt: number = 0;

  // ── Debug state ────────────────────────────────────────────────────────
  private debugSnap: PositionDebugSnapshot = {
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

  // ── Current output and listeners ───────────────────────────────────────
  private current: HybridPosition = EMPTY;
  private listeners = new Set<(p: HybridPosition) => void>();
  private detachers: Array<() => void> = [];

  constructor(
    gps?: GPSPositioning,
    env?: EnvironmentTransitionManager,
    snapper?: RoadSnapper,
    cfg: Partial<HybridPositioningConfig> = {},
  ) {
    this.gps = gps ?? new GPSPositioning();
    this.env = env ?? new EnvironmentTransitionManager();
    this.snapper = snapper ?? new RoadSnapper();
    this.cfg = { ...DEFAULT_HYBRID_CONFIG, ...cfg };

    this.detachers.push(
      this.gps.onFix(fix => {
        this.ingestGpsFix(fix);
      }),
    );
    this.detachers.push(
      this.env.onChange(snap => {
        this.envSnap = snap;
        this.recompute();
      }),
    );
  }

  // ─── Public API ────────────────────────────────────────────────────────

  setBuildings(buildings: Array<{ id: string; anchor: GeoAnchor | null; radiusM: number }>): void {
    this.anchorByBuilding.clear();
    const fps: BuildingFootprint[] = [];
    for (const b of buildings) {
      if (!b.anchor) continue;
      this.anchorByBuilding.set(b.id, b.anchor);
      fps.push({ buildingId: b.id, anchor: b.anchor, radiusM: b.radiusM });
    }
    this.env.setBuildings(fps);
  }

  start(): void {
    this.gps.start();
  }

  stop(): void {
    this.gps.stop();
  }

  destroy(): void {
    for (const d of this.detachers) d();
    this.detachers = [];
    this.gps.stop();
  }

  pushIndoorPosition(buildingId: string, floorId: string | null, x: number, y: number): void {
    this.indoorCache = { x, y, buildingId, floorId };
    this.recompute();
  }

  setIndoorAnchor(anchored: boolean, buildingId: string | null): void {
    this.env.setIndoorAnchor(anchored, buildingId);
  }

  /**
   * Feed a device-compass heading (degrees, 0=North, clockwise) — same source
   * indoor PDR already uses via HeadingTracker. Unlike GPS course-over-ground,
   * this is available whether the user is standing still or moving, and
   * works identically indoors and outdoors, so the direction cone no longer
   * disappears/freezes outdoors just because the user stopped walking.
   */
  setCompassHeading(headingDeg: number): void {
    if (!isFinite(headingDeg)) return;
    this.compassHeading = lerpHeadingDeg(this.compassHeading, headingDeg, this.cfg.headingAlpha);
    this.recompute();
  }

  /** Compass heading wins whenever available; GPS course is only a fallback. */
  private get effectiveHeading(): number {
    return isFinite(this.compassHeading) ? this.compassHeading : this.gpsHeading;
  }

  onChange(cb: (p: HybridPosition) => void): () => void {
    this.listeners.add(cb);
    return () => this.listeners.delete(cb);
  }

  getPosition(): HybridPosition {
    return this.current;
  }

  getDebugSnapshot(): PositionDebugSnapshot {
    return { ...this.debugSnap, lastGoodAge: Date.now() - this.lastGoodAt };
  }

  toIndoor(pos: HybridPosition, buildingId: string): { x: number; y: number } | null {
    if (pos.indoor && pos.indoor.buildingId === buildingId) {
      return { x: pos.indoor.x, y: pos.indoor.y };
    }
    if (pos.geo) {
      const anchor = this.anchorByBuilding.get(buildingId);
      if (anchor) return geoToIndoor(anchor, pos.geo);
    }
    return null;
  }

  // ─── GPS ingestion with stability rules ───────────────────────────────

  private ingestGpsFix(fix: GeoFix): void {
    const debug: Partial<PositionDebugSnapshot> = {
      gpsAccuracyM: fix.accuracy,
      speedMs: fix.speed ?? null,
      rawLat: fix.lat,
      rawLng: fix.lng,
      jumpRejected: false,
      accuracyRejected: false,
      speedRejected: false,
    };

    // Rule 1: Drop poor-accuracy fixes (but always let the very first fix
    // through up to a generous ceiling — otherwise the blue dot can never
    // appear at all if the device's first estimate is rougher than usual).
    const acceptCeiling = this.smoothedGeo ? this.cfg.maxGpsAccuracyM : INITIAL_ACCEPT_ACCURACY_M;
    if (fix.accuracy > acceptCeiling) {
      debug.accuracyRejected = true;
      this.mergeDebug(debug);
      this.env.ingestGpsFix(fix);
      return;
    }

    // Rule 2: Speed gate (from fix.speed metadata)
    const env = this.envSnap.environment;
    const maxSpeed = env === 'indoor' ? this.cfg.maxSpeedIndoorMs : this.cfg.maxSpeedOutdoorMs;
    if (fix.speed != null && fix.speed > maxSpeed) {
      debug.speedRejected = true;
      this.mergeDebug(debug);
      return;
    }

    // Rule 3: Speed gate (implied by position delta)
    if (this.smoothedGeo && this.rawGeoFix) {
      const dt = Math.max(0.1, (fix.timestamp - this.rawGeoFix.timestamp) / 1000);
      const dist = haversineMeters(this.smoothedGeo, fix);
      const impliedSpeed = dist / dt;
      if (impliedSpeed > maxSpeed) {
        debug.speedRejected = true;
        this.mergeDebug(debug);
        return;
      }

      // Rule 4: Jump prevention — only reject large jumps when GPS accuracy is
      // also mediocre. Typical phone GPS accuracy outdoors is 10-30m, so the
      // thresholds here must be generous or every real movement update gets
      // dropped and the dot appears frozen ("stationary") even while walking.
      if (dist > this.cfg.jumpThresholdM && fix.accuracy > this.cfg.highAccuracyM) {
        debug.jumpRejected = true;
        this.mergeDebug(debug);
        return;
      }
    }

    this.rawGeoFix = fix;
    this.env.ingestGpsFix(fix);

    // EMA smooth position
    const alpha = this.cfg.positionAlphaOutdoor;
    if (!this.smoothedGeo) {
      this.smoothedGeo = { lat: fix.lat, lng: fix.lng };
      this.snappedGeo = { lat: fix.lat, lng: fix.lng };
    } else {
      this.smoothedGeo = {
        lat: this.smoothedGeo.lat * (1 - alpha) + fix.lat * alpha,
        lng: this.smoothedGeo.lng * (1 - alpha) + fix.lng * alpha,
      };
    }

    // Circular EMA for GPS course-over-ground heading (fallback only — this is
    // null whenever the device isn't moving fast enough for GPS to derive a
    // course, so it can never be the only heading source).
    const rawHeading = fix.heading != null && isFinite(fix.heading) ? fix.heading : NaN;
    this.gpsHeading = lerpHeadingDeg(this.gpsHeading, rawHeading, this.cfg.headingAlpha);

    // Road snap (outdoor/transitioning only)
    if ((env === 'outdoor' || env === 'transitioning') && this.snapper.hasGraph()) {
      const snapResult: RoadSnapResult | null = this.snapper.snap(this.smoothedGeo, this.cfg.snapThresholdM);
      const sa = this.cfg.snapBlendAlpha;

      if (snapResult) {
        if (!this.snappedGeo) {
          this.snappedGeo = snapResult.snapped;
        } else {
          // Gradual blend toward snapped position — no teleporting
          this.snappedGeo = {
            lat: this.snappedGeo.lat * (1 - sa) + snapResult.snapped.lat * sa,
            lng: this.snappedGeo.lng * (1 - sa) + snapResult.snapped.lng * sa,
          };
        }
        debug.isSnapped = true;
        debug.snapDistanceM = snapResult.distanceM;
        debug.snappedLat = this.snappedGeo.lat;
        debug.snappedLng = this.snappedGeo.lng;
      } else {
        // No snap target — slowly drift back toward raw smoothed position
        if (this.snappedGeo && this.smoothedGeo) {
          this.snappedGeo = {
            lat: this.snappedGeo.lat * (1 - sa) + this.smoothedGeo.lat * sa,
            lng: this.snappedGeo.lng * (1 - sa) + this.smoothedGeo.lng * sa,
          };
        } else {
          this.snappedGeo = this.smoothedGeo ? { ...this.smoothedGeo } : null;
        }
        debug.isSnapped = false;
        debug.snapDistanceM = null;
        debug.snappedLat = null;
        debug.snappedLng = null;
      }
    } else {
      this.snappedGeo = this.smoothedGeo ? { ...this.smoothedGeo } : null;
      debug.isSnapped = false;
      debug.snapDistanceM = null;
    }

    this.mergeDebug(debug);
    this.recompute();
  }

  // ─── Recompute unified output ──────────────────────────────────────────

  private recompute(): void {
    const env = this.envSnap.environment;
    const indoor = this.indoorCache;

    // Smooth indoor PDR position
    if (indoor) {
      const alpha = this.cfg.positionAlphaIndoor;
      if (!this.smoothedIndoor) {
        this.smoothedIndoor = { x: indoor.x, y: indoor.y };
      } else {
        this.smoothedIndoor = {
          x: this.smoothedIndoor.x * (1 - alpha) + indoor.x * alpha,
          y: this.smoothedIndoor.y * (1 - alpha) + indoor.y * alpha,
        };
      }
    }

    const geoOut = this.snappedGeo ?? this.smoothedGeo;
    const si = this.smoothedIndoor;

    let out: HybridPosition;

    if (env === 'indoor' && indoor && si) {
      const anchor = this.anchorByBuilding.get(indoor.buildingId);
      const projected = anchor ? indoorToGeo(anchor, si.x, si.y) : null;
      out = {
        lat: projected?.lat ?? null,
        lng: projected?.lng ?? null,
        x: si.x,
        y: si.y,
        floor: indoor.floorId,
        heading: this.effectiveHeading,
        accuracy: 2,
        environment: 'indoor',
        indoor: { ...indoor, x: si.x, y: si.y },
        geo: projected,
        accuracyM: 2,
        blending: false,
        source: 'pdr',
        timestamp: Date.now(),
      };
    } else if (env === 'outdoor' && geoOut) {
      out = {
        lat: geoOut.lat,
        lng: geoOut.lng,
        x: null,
        y: null,
        floor: null,
        heading: this.effectiveHeading,
        accuracy: this.rawGeoFix?.accuracy ?? Infinity,
        environment: 'outdoor',
        indoor: null,
        geo: geoOut,
        accuracyM: this.rawGeoFix?.accuracy ?? null,
        blending: false,
        source: 'gps',
        timestamp: this.rawGeoFix?.timestamp ?? Date.now(),
      };
    } else if (env === 'transitioning') {
      const blend = this.envSnap.blend;
      let geo: GeoCoord | null = geoOut;
      let x: number | null = null;
      let y: number | null = null;
      let floor: string | null = null;

      if (indoor && si) {
        const anchor = indoor.buildingId ? this.anchorByBuilding.get(indoor.buildingId) : undefined;
        const indoorAsGeo = anchor ? indoorToGeo(anchor, si.x, si.y) : null;
        if (indoorAsGeo && geoOut) {
          geo = {
            lat: indoorAsGeo.lat * (1 - blend) + geoOut.lat * blend,
            lng: indoorAsGeo.lng * (1 - blend) + geoOut.lng * blend,
          };
        }
        x = si.x;
        y = si.y;
        floor = indoor.floorId;
      }

      out = {
        lat: geo?.lat ?? null,
        lng: geo?.lng ?? null,
        x,
        y,
        floor,
        heading: this.effectiveHeading,
        accuracy: this.rawGeoFix?.accuracy ?? 10,
        environment: 'transitioning',
        indoor: indoor && si ? { ...indoor, x: si.x, y: si.y } : null,
        geo,
        accuracyM: this.rawGeoFix?.accuracy ?? null,
        blending: true,
        source: indoor ? 'blend' : 'gps',
        timestamp: Date.now(),
      };
    } else if (geoOut) {
      out = {
        lat: geoOut.lat,
        lng: geoOut.lng,
        x: null,
        y: null,
        floor: null,
        heading: this.effectiveHeading,
        accuracy: this.rawGeoFix?.accuracy ?? Infinity,
        environment: env,
        indoor: null,
        geo: geoOut,
        accuracyM: this.rawGeoFix?.accuracy ?? null,
        blending: false,
        source: 'gps',
        timestamp: this.rawGeoFix?.timestamp ?? Date.now(),
      };
    } else if (indoor && si) {
      const anchor = this.anchorByBuilding.get(indoor.buildingId);
      const projected = anchor ? indoorToGeo(anchor, si.x, si.y) : null;
      out = {
        lat: projected?.lat ?? null,
        lng: projected?.lng ?? null,
        x: si.x,
        y: si.y,
        floor: indoor.floorId,
        heading: this.effectiveHeading,
        accuracy: 2,
        environment: env,
        indoor: { ...indoor, x: si.x, y: si.y },
        geo: projected,
        accuracyM: 2,
        blending: false,
        source: 'pdr',
        timestamp: Date.now(),
      };
    } else {
      // Use last-known-good (up to 30s stale)
      if (Date.now() - this.lastGoodAt < 30_000 && this.lastGoodPosition.source !== 'none') {
        out = { ...this.lastGoodPosition, timestamp: Date.now() };
      } else {
        out = { ...EMPTY, environment: env };
      }
    }

    // Track last good position
    if (out.source !== 'none') {
      this.lastGoodPosition = out;
      this.lastGoodAt = Date.now();
    }

    // Update debug
    this.debugSnap = {
      ...this.debugSnap,
      environment: out.environment,
      heading: out.heading,
      positionSource: out.source,
    };

    // Skip emit if nothing meaningful changed
    if (
      out.environment === this.current.environment &&
      out.source === this.current.source &&
      sameGeo(out.geo, this.current.geo) &&
      sameIndoor(out.indoor, this.current.indoor) &&
      Math.abs(out.heading - this.current.heading) < 1
    ) {
      return;
    }

    this.current = out;
    for (const l of this.listeners) l(out);
  }

  private mergeDebug(partial: Partial<PositionDebugSnapshot>): void {
    this.debugSnap = { ...this.debugSnap, ...partial };
  }
}

// ─── Helpers ───────────────────────────────────────────────────────────────────

function sameGeo(a: GeoCoord | null, b: GeoCoord | null): boolean {
  if (!a && !b) return true;
  if (!a || !b) return false;
  return haversineMeters(a, b) < 0.5;
}

function sameIndoor(
  a: HybridPosition['indoor'],
  b: HybridPosition['indoor'],
): boolean {
  if (!a && !b) return true;
  if (!a || !b) return false;
  return (
    a.buildingId === b.buildingId &&
    a.floorId === b.floorId &&
    Math.abs(a.x - b.x) < 0.5 &&
    Math.abs(a.y - b.y) < 0.5
  );
}