/**
 * EnvironmentTransitionManager — decides whether the user is INDOORS or
 * OUTDOORS, with a TRANSITIONING limbo to smooth handoffs.
 *
 * Inputs:
 *   • indoor anchor presence (QR/manual scan)        → strong indoor hint
 *   • GPS accuracy + position vs building bbox       → outdoor hint
 *   • currently-active indoor navigation             → keep indoor sticky
 *
 * Output is a single Environment value with hysteresis so we don't flap.
 */

import type { Environment, GeoAnchor, GeoFix } from './GeoTypes';
import { haversineMeters } from './GeoMath';

export interface BuildingFootprint {
  buildingId: string;
  anchor: GeoAnchor;
  /** Approx. building radius from origin, in meters. */
  radiusM: number;
}

export interface EnvSnapshot {
  environment: Environment;
  insideBuildingId: string | null;
  /** 0..1 transition progress when blending between indoor and outdoor. */
  blend: number;
  reason: string;
}

export interface EnvConfig {
  /** GPS accuracy worse than this counts as "indoors" (multipath/no-signal). */
  poorGpsAccuracyM: number;
  /** Required dwell time before flipping environment, ms. */
  dwellMs: number;
  /** Buffer around building radius for hysteresis. */
  exitBufferM: number;
}

export const DEFAULT_ENV_CONFIG: EnvConfig = {
  poorGpsAccuracyM: 30,
  dwellMs: 4000,
  exitBufferM: 8,
};

export class EnvironmentTransitionManager {
  private buildings: BuildingFootprint[] = [];
  private current: EnvSnapshot = {
    environment: 'unknown',
    insideBuildingId: null,
    blend: 0,
    reason: 'init',
  };
  private candidate: { env: Environment; since: number; bid: string | null } | null = null;
  private indoorAnchored = false;
  private indoorAnchorBuildingId: string | null = null;
  private listeners = new Set<(s: EnvSnapshot) => void>();
  private cfg: EnvConfig;

  constructor(cfg: Partial<EnvConfig> = {}) {
    this.cfg = { ...DEFAULT_ENV_CONFIG, ...cfg };
  }

  setBuildings(footprints: BuildingFootprint[]): void {
    this.buildings = footprints;
    this.recompute('buildings updated', null);
  }

  /** Called when the user scans a QR / picks a node manually. */
  setIndoorAnchor(anchored: boolean, buildingId: string | null): void {
    this.indoorAnchored = anchored;
    this.indoorAnchorBuildingId = buildingId;
    this.commit({
      environment: anchored ? 'indoor' : this.current.environment,
      insideBuildingId: anchored ? buildingId : this.current.insideBuildingId,
      blend: anchored ? 0 : this.current.blend,
      reason: anchored ? 'indoor anchor set' : 'indoor anchor cleared',
    });
  }

  ingestGpsFix(fix: GeoFix | null): void {
    this.recompute('gps update', fix);
  }

  getSnapshot(): EnvSnapshot {
    return this.current;
  }

  onChange(cb: (s: EnvSnapshot) => void): () => void {
    this.listeners.add(cb);
    return () => this.listeners.delete(cb);
  }

  private recompute(reason: string, fix: GeoFix | null): void {
    // Indoor anchor wins outright.
    if (this.indoorAnchored) {
      this.commit({
        environment: 'indoor',
        insideBuildingId: this.indoorAnchorBuildingId,
        blend: 0,
        reason: 'indoor anchor active',
      });
      return;
    }
    if (!fix) {
      // No GPS yet; stay in current state.
      return;
    }

    // Find nearest building footprint.
    let inside: BuildingFootprint | null = null;
    let nearestDist = Infinity;
    for (const b of this.buildings) {
      const d = haversineMeters(
        { lat: b.anchor.originLat, lng: b.anchor.originLng },
        fix,
      );
      if (d < nearestDist) nearestDist = d;
      if (d <= b.radiusM) inside = b;
    }

    const poorGps = fix.accuracy > this.cfg.poorGpsAccuracyM;
    let target: Environment;
    let bid: string | null = null;
    if (inside) {
      // Inside footprint: lean indoor unless GPS is highly confident & far from origin.
      target = poorGps ? 'indoor' : 'transitioning';
      bid = inside.buildingId;
    } else if (poorGps && this.current.environment === 'indoor') {
      // GPS drifted outside the registered footprint, but accuracy is bad
      // AND we were already confidently indoors. Registered radii are
      // approximate, and indoor GPS is routinely off by tens of meters —
      // a low-confidence fix landing just outside the circle isn't good
      // evidence of actually having left the building. Stay indoor rather
      // than flip on a fix we don't trust; a confident (good-accuracy) fix
      // clearly outside the buffer will still flip it below next tick.
      target = 'indoor';
      bid = this.current.insideBuildingId;
    } else {
      // Outside footprint + buffer: outdoor.
      const farEnough = nearestDist > this.minRadius() + this.cfg.exitBufferM;
      target = farEnough ? 'outdoor' : 'transitioning';
    }

    this.proposeWithDwell(target, bid, reason);
  }

  private minRadius(): number {
    if (!this.buildings.length) return 0;
    return Math.min(...this.buildings.map(b => b.radiusM));
  }

  private proposeWithDwell(env: Environment, bid: string | null, reason: string): void {
    const now = Date.now();
    if (env === this.current.environment && bid === this.current.insideBuildingId) {
      this.candidate = null;
      return;
    }
    if (
      !this.candidate ||
      this.candidate.env !== env ||
      this.candidate.bid !== bid
    ) {
      this.candidate = { env, bid, since: now };
      // Show a transitioning hint immediately so UI can blend.
      this.commit({
        environment: 'transitioning',
        insideBuildingId: this.current.insideBuildingId,
        blend: Math.min(1, this.current.blend + 0.25),
        reason: `${reason}: candidate ${env}`,
      });
      return;
    }
    if (now - this.candidate.since >= this.cfg.dwellMs) {
      this.commit({
        environment: env,
        insideBuildingId: bid,
        blend: env === 'transitioning' ? 0.5 : 0,
        reason: `${reason}: committed ${env}`,
      });
      this.candidate = null;
    }
  }

  private commit(s: EnvSnapshot): void {
    if (
      s.environment === this.current.environment &&
      s.insideBuildingId === this.current.insideBuildingId &&
      s.blend === this.current.blend
    ) {
      return;
    }
    this.current = s;
    for (const l of this.listeners) l(s);
  }
}
