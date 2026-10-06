/**
 * GPSPositioning — wraps navigator.geolocation.watchPosition with:
 *   • accuracy filtering (drops fixes worse than `maxAccuracyM`)
 *   • exponential moving average smoothing on lat/lng
 *   • simple velocity gating to reject teleport jumps
 *
 * Output is a single normalized GeoFix consumed by HybridPositioningEngine.
 */

import type { GeoFix } from './GeoTypes';
import { haversineMeters } from './GeoMath';

export interface GPSConfig {
  /** Reject fixes with accuracy worse than this (meters). */
  maxAccuracyM: number;
  /** Smoothing factor 0..1; higher = snappier, lower = smoother. */
  smoothing: number;
  /** Reject jumps faster than this (m/s). Walking ~1.5 m/s, running ~5 m/s. */
  maxSpeedMs: number;
  /** Geolocation options. */
  enableHighAccuracy: boolean;
}

export const DEFAULT_GPS_CONFIG: GPSConfig = {
  maxAccuracyM: 75,
  smoothing: 0.35,
  maxSpeedMs: 12, // tolerate brief bursts (vehicle / GPS jitter)
  enableHighAccuracy: true,
};

// A device's very first fix (especially indoors, in a browser without a
// real GPS chip, or before the OS has "warmed up" its location stack) is
// often worse than maxAccuracyM — sometimes 100-300m from a WiFi/cell
// estimate. Rejecting it outright means the person just sees "Finding your
// location…" forever, since nothing ever arrives to replace it. We accept
// that first rough fix (as long as it's not wildly implausible) so the
// blue dot shows up immediately, then keep refining/tightening from there.
const INITIAL_ACCEPT_ACCURACY_M = 500;

export type GPSStatus =
  | 'idle'
  | 'requesting'
  | 'tracking'
  | 'denied'
  | 'unavailable'
  | 'no-fix';

export class GPSPositioning {
  private watchId: number | null = null;
  private smoothed: GeoFix | null = null;
  private listeners = new Set<(f: GeoFix) => void>();
  private statusListeners = new Set<(s: GPSStatus) => void>();
  private status: GPSStatus = 'idle';
  private cfg: GPSConfig;

  constructor(cfg: Partial<GPSConfig> = {}) {
    this.cfg = { ...DEFAULT_GPS_CONFIG, ...cfg };
  }

  isSupported(): boolean {
    return typeof navigator !== 'undefined' && 'geolocation' in navigator;
  }

  getCurrentFix(): GeoFix | null {
    return this.smoothed;
  }

  getStatus(): GPSStatus {
    return this.status;
  }

  onFix(cb: (f: GeoFix) => void): () => void {
    this.listeners.add(cb);
    return () => this.listeners.delete(cb);
  }

  onStatus(cb: (s: GPSStatus) => void): () => void {
    this.statusListeners.add(cb);
    return () => this.statusListeners.delete(cb);
  }

  start(): void {
    if (!this.isSupported()) {
      this.setStatus('unavailable');
      return;
    }
    if (this.watchId !== null) return;
    this.setStatus('requesting');
    this.watchId = navigator.geolocation.watchPosition(
      (pos) => this.handlePosition(pos),
      (err) => this.handleError(err),
      {
        enableHighAccuracy: this.cfg.enableHighAccuracy,
        maximumAge: 1000,
        timeout: 15_000,
      },
    );
  }

  stop(): void {
    if (this.watchId !== null && this.isSupported()) {
      navigator.geolocation.clearWatch(this.watchId);
    }
    this.watchId = null;
    this.smoothed = null;
    this.setStatus('idle');
  }

  /** Inject a synthetic fix (useful for desktop testing). */
  injectFix(fix: GeoFix): void {
    this.handleFix(fix);
  }

  private handlePosition(pos: GeolocationPosition): void {
    const fix: GeoFix = {
      lat: pos.coords.latitude,
      lng: pos.coords.longitude,
      accuracy: pos.coords.accuracy ?? 9999,
      heading: pos.coords.heading ?? null,
      speed: pos.coords.speed ?? null,
      timestamp: pos.timestamp || Date.now(),
    };
    this.handleFix(fix);
  }

  private handleFix(fix: GeoFix): void {
    const isFirstFix = !this.smoothed;
    const acceptCeiling = isFirstFix ? INITIAL_ACCEPT_ACCURACY_M : this.cfg.maxAccuracyM;
    if (fix.accuracy > acceptCeiling) {
      // Keep status meaningful while we wait for a usable fix.
      if (!this.smoothed) this.setStatus('no-fix');
      return;
    }
    if (this.smoothed) {
      const dt = Math.max(0.001, (fix.timestamp - this.smoothed.timestamp) / 1000);
      const dist = haversineMeters(this.smoothed, fix);
      if (dist / dt > this.cfg.maxSpeedMs) {
        // Likely an outlier; ignore.
        return;
      }
      const a = this.cfg.smoothing;
      this.smoothed = {
        lat: this.smoothed.lat * (1 - a) + fix.lat * a,
        lng: this.smoothed.lng * (1 - a) + fix.lng * a,
        accuracy: Math.min(this.smoothed.accuracy, fix.accuracy),
        heading: fix.heading ?? this.smoothed.heading,
        speed: fix.speed ?? this.smoothed.speed,
        timestamp: fix.timestamp,
      };
    } else {
      this.smoothed = { ...fix };
    }
    this.setStatus('tracking');
    for (const l of this.listeners) l(this.smoothed);
  }

  private handleError(err: GeolocationPositionError): void {
    if (err.code === err.PERMISSION_DENIED) this.setStatus('denied');
    else this.setStatus('unavailable');
  }

  private setStatus(s: GPSStatus): void {
    if (this.status === s) return;
    this.status = s;
    for (const l of this.statusListeners) l(s);
  }
}
