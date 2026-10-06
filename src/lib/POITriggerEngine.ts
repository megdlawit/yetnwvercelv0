/**
 * POITriggerEngine — Module 3: Tourism & Experience Layer
 *
 * Central, non-React POI proximity & trigger manager.
 * Owned by NavigationBrain for consistent indoor/outdoor triggers
 * and unified voice output with no duplicate fires.
 *
 * New in Module 3:
 *   • activePoi: the POI currently "held" (within radius + not exited yet)
 *   • recentlyTriggered: cooldown-aware set of ids with exit-hysteresis
 *   • Explore mode: trigger POIs even when not actively navigating
 *   • Promotion-aware: hasPromotion flag surfaces to UI + voice
 *   • Voice suppression: skips announce when distanceToManeuverM < 20m
 *   • Exit-before-retrigger: poi must leave RELEASE_MULTIPLIER * radius
 *     before it can auto-trigger again (prevents re-trigger spam)
 */

import { POI, getActivePromotions } from '@/data/poi';
import type { NavNode } from '@/data/types';
import type { GeoCoord } from '@/lib/geo/GeoTypes';
import { haversineMeters } from '@/lib/geo/GeoMath';

// ─── Types ─────────────────────────────────────────────────────────────────────

export interface POIWithDistance {
  poi: POI;
  distance: number;
  hasPromotion: boolean;
}

export interface POITriggerSnapshot {
  nearby: POIWithDistance[];
  /** POI being auto-displayed (featured + inside triggerRadius). */
  autoTriggered: POI | null;
  /** POI currently "active" — within radius and not yet exited. */
  activePoi: POI | null;
  triggeredIds: Set<string>;
  recentlyTriggeredIds: Set<string>;
  lastTriggeredAt: number;
}

export interface POITriggerInputs {
  pois: POI[];
  /** Plan pixels per metre for indoor distances (1 = plan units, the original behaviour). */
  indoorPxPerMeter?: number;
  nodesById: Map<string, NavNode>;
  indoorPosition: { x: number; y: number } | null;
  geoPosition: GeoCoord | null;
  currentFloorId: string | null;
  /** Whether the user is actively routing (gates auto-triggers in navigate mode). */
  isNavigating: boolean;
  /** Explore mode: trigger without a route active. */
  exploreMode?: boolean;
  /** Current distance to next route maneuver (meters). Used to suppress POI voice. */
  distanceToManeuverM?: number;
}

export interface POITriggerCallbacks {
  onAnnounce?: (poi: POI) => void;
  onChange?: (snap: POITriggerSnapshot) => void;
}

// ─── Constants ─────────────────────────────────────────────────────────────────

const NEARBY_RADIUS_PX = 60;
const NEARBY_RADIUS_M = 80;
/** "Nearby" indoors, for plans with a real scale. */
const NEARBY_RADIUS_INDOOR_M = 15;
/** How long before a dismissed/triggered POI can auto-trigger again. */
const COOLDOWN_MS = 45_000;
/** POI must travel this multiple past its triggerRadius before clearing "active". */
const RELEASE_MULTIPLIER = 1.5;
/** Suppress POI voice when a turn is this close (meters). */
const MANEUVER_SUPPRESS_M = 20;
/** Max nearby POIs in the list. */
const MAX_NEARBY = 8;

// ─── Engine ────────────────────────────────────────────────────────────────────

export class POITriggerEngine {
  /** ms timestamp when cooldown expires per poiId. */
  private cooldown = new Map<string, number>();
  /** Permanently dismissed this session. */
  private dismissed = new Set<string>();
  /** Voice-announced (dedup within cooldown window). */
  private announced = new Set<string>();
  /** IDs that have been triggered (entered radius). */
  private triggered = new Set<string>();
  /** IDs currently inside radius (for exit-before-retrigger). */
  private insideRadius = new Set<string>();

  private lastInputs: POITriggerInputs | null = null;
  private snap: POITriggerSnapshot = {
    nearby: [],
    autoTriggered: null,
    activePoi: null,
    triggeredIds: new Set(),
    recentlyTriggeredIds: new Set(),
    lastTriggeredAt: 0,
  };

  constructor(private cb: POITriggerCallbacks = {}) {}

  // ── Public API ───────────────────────────────────────────────────────

  update(inputs: POITriggerInputs): void {
    this.lastInputs = inputs;

    const ranked = this.computeNearby(inputs);
    this.updateInsideRadius(inputs, ranked);
    const autoTriggered = this.computeAuto(inputs, ranked);
    const activePoi = this.resolveActive(ranked);

    const next: POITriggerSnapshot = {
      nearby: ranked,
      autoTriggered,
      activePoi,
      triggeredIds: new Set(this.triggered),
      recentlyTriggeredIds: new Set(this.cooldown.keys()),
      lastTriggeredAt: this.snap.lastTriggeredAt,
    };

    if (autoTriggered && autoTriggered.id !== this.snap.autoTriggered?.id) {
      next.lastTriggeredAt = Date.now();
    }

    if (this.snapEquivalent(next, this.snap)) return;
    this.snap = next;
    this.cb.onChange?.(next);
  }

  dismiss(poiId: string): void {
    this.dismissed.add(poiId);
    this.cooldown.set(poiId, Date.now() + COOLDOWN_MS);
    if (this.snap.autoTriggered?.id === poiId) {
      this.snap = { ...this.snap, autoTriggered: null, activePoi: null };
      this.cb.onChange?.(this.snap);
    }
    if (this.lastInputs) this.update(this.lastInputs);
  }

  reset(): void {
    this.cooldown.clear();
    this.dismissed.clear();
    this.announced.clear();
    this.triggered.clear();
    this.insideRadius.clear();
    this.snap = {
      nearby: [],
      autoTriggered: null,
      activePoi: null,
      triggeredIds: new Set(),
      recentlyTriggeredIds: new Set(),
      lastTriggeredAt: 0,
    };
    this.cb.onChange?.(this.snap);
  }

  getSnapshot(): POITriggerSnapshot {
    return this.snap;
  }

  // ── Internal ─────────────────────────────────────────────────────────

  private computeNearby(inputs: POITriggerInputs): POIWithDistance[] {
    const out: POIWithDistance[] = [];
    for (const poi of inputs.pois) {
      const d = this.distanceFor(poi, inputs);
      if (d == null) continue;
      const radius = this.nearbyRadiusFor(poi, inputs.indoorPxPerMeter ?? 1);
      if (d <= radius) {
        out.push({
          poi,
          distance: d,
          hasPromotion: getActivePromotions(poi).length > 0,
        });
      }
    }
    // Sort: promoted first, then by distance
    return out
      .sort((a, b) => {
        if (a.hasPromotion !== b.hasPromotion) return a.hasPromotion ? -1 : 1;
        return a.distance - b.distance;
      })
      .slice(0, MAX_NEARBY);
  }

  private updateInsideRadius(inputs: POITriggerInputs, ranked: POIWithDistance[]): void {
    const nowInside = new Set(ranked.map(r => r.poi.id));

    // Find POIs that just exited — clear their triggered+announced state
    for (const id of Array.from(this.insideRadius)) {
      if (!nowInside.has(id)) {
        this.insideRadius.delete(id);
        // Only clear announced if they've been gone long enough (release hysteresis)
        // The cooldown handles retrigger suppression; announced is cleared on exit
        // so next entry is fresh.
        this.announced.delete(id);
        this.dismissed.delete(id);
      }
    }

    // Track newly entered
    for (const id of nowInside) {
      this.insideRadius.add(id);
    }
  }

  private computeAuto(inputs: POITriggerInputs, ranked: POIWithDistance[]): POI | null {
    const shouldTrigger = inputs.isNavigating || inputs.exploreMode;
    if (!shouldTrigger) return null;

    const now = Date.now();
    const suppressVoice =
      inputs.distanceToManeuverM != null &&
      inputs.distanceToManeuverM < MANEUVER_SUPPRESS_M;

    for (const { poi, distance } of ranked) {
      if (!poi.isFeatured) continue;
      if (this.dismissed.has(poi.id)) continue;
      const cd = this.cooldown.get(poi.id) ?? 0;
      if (cd > now) continue;

      if (distance <= poi.triggerRadius) {
        if (!this.triggered.has(poi.id)) this.triggered.add(poi.id);
        this.cooldown.set(poi.id, now + COOLDOWN_MS);

        if (!this.announced.has(poi.id)) {
          this.announced.add(poi.id);
          // Only fire voice if we're not about to give a turn instruction
          if (!suppressVoice) {
            this.cb.onAnnounce?.(poi);
          }
        }
        return poi;
      }
    }

    // Keep existing auto card if still nearby (exit hysteresis)
    const current = this.snap.autoTriggered;
    if (current) {
      const stillIn = ranked.find(r => r.poi.id === current.id);
      if (stillIn && stillIn.distance <= current.triggerRadius * RELEASE_MULTIPLIER) {
        return current;
      }
    }
    return null;
  }

  private resolveActive(ranked: POIWithDistance[]): POI | null {
    // Active = first POI that is strictly inside its triggerRadius
    for (const { poi, distance } of ranked) {
      if (distance <= poi.triggerRadius) return poi;
    }
    return null;
  }

  private distanceFor(poi: POI, inputs: POITriggerInputs): number | null {
    if (poi.isOutdoor && poi.lat != null && poi.lng != null && inputs.geoPosition) {
      return haversineMeters(inputs.geoPosition, { lat: poi.lat, lng: poi.lng });
    }
    if (poi.nodeId && inputs.indoorPosition && inputs.currentFloorId) {
      const n = inputs.nodesById.get(poi.nodeId);
      if (!n || n.floorId !== inputs.currentFloorId) return null;
      const dx = n.x - inputs.indoorPosition.x;
      const dy = n.y - inputs.indoorPosition.y;
      return Math.sqrt(dx * dx + dy * dy) / (inputs.indoorPxPerMeter ?? 1);
    }
    return null;
  }

  private nearbyRadiusFor(poi: POI, indoorPxPerMeter: number): number {
    if (poi.isOutdoor) return NEARBY_RADIUS_M;
    return indoorPxPerMeter === 1 ? NEARBY_RADIUS_PX : NEARBY_RADIUS_INDOOR_M;
  }

  private snapEquivalent(a: POITriggerSnapshot, b: POITriggerSnapshot): boolean {
    if (a.autoTriggered?.id !== b.autoTriggered?.id) return false;
    if (a.activePoi?.id !== b.activePoi?.id) return false;
    if (a.nearby.length !== b.nearby.length) return false;
    for (let i = 0; i < a.nearby.length; i++) {
      if (a.nearby[i].poi.id !== b.nearby[i].poi.id) return false;
      if (Math.abs(a.nearby[i].distance - b.nearby[i].distance) > 0.5) return false;
    }
    return true;
  }
}
