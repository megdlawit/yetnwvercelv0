// Where is the visitor? Two live sources, used only after they ask:
//  - GPS (outdoors, venues placed on the world map): smoothed fixes from
//    GPSPositioning, turned into plan coordinates with the venue's anchor;
//  - steps and compass (everywhere, like the original app): each counted step
//    moves the visitor one stride the way the phone faces, along the paths. A QR
//    code puts them back exactly where they are.

import { useCallback, useEffect, useRef, useState } from 'react';
import { GPSPositioning, type GPSStatus } from '@/lib/geo/GPSPositioning';
import { geoToIndoor, haversineMeters } from '@/lib/geo/GeoMath';
import type { GeoAnchor, GeoFix } from '@/lib/geo/GeoTypes';
import { StepDetector } from '@/lib/StepDetector';
import { HeadingTracker } from '@/lib/HeadingTracker';

export const STRIDE_M = 0.7;

export function useGps(anchor: GeoAnchor | null) {
  const [status, setStatus] = useState<GPSStatus>('idle');
  const [fix, setFix] = useState<GeoFix | null>(null);
  const gps = useRef<GPSPositioning | null>(null);

  const start = useCallback(() => {
    if (!gps.current) {
      gps.current = new GPSPositioning({ maxAccuracyM: 60 });
      gps.current.onFix(setFix);
      gps.current.onStatus(setStatus);
    }
    if (!gps.current.isSupported()) { setStatus('unavailable'); return; }
    gps.current.start();
  }, []);
  const stop = useCallback(() => { gps.current?.stop(); setStatus('idle'); }, []);
  useEffect(() => () => gps.current?.stop(), []);

  const plan = fix && anchor ? geoToIndoor(anchor, fix) : null;
  return { status, fix, plan, start, stop, active: status === 'tracking' || status === 'requesting' };
}

/** Metres from a GPS fix to a point (e.g. the venue's centre). */
export const metresTo = (fix: GeoFix | null, to: { lat: number; lng: number } | null) => (fix && to ? haversineMeters(fix, to) : null);

type MotionPermission = 'idle' | 'granted' | 'denied' | 'unavailable';

/**
 * The phone's motion sensors: a step counter and the compass (as in the
 * original visitor app). `start()` must be called from a tap — iPhones ask
 * for permission then.
 */
export function useStepCounter() {
  const [steps, setSteps] = useState(0);
  const [heading, setHeading] = useState<number | null>(null);   // degrees clockwise from north
  const [permission, setPermission] = useState<MotionPermission>('idle');
  const cleanup = useRef<(() => void) | null>(null);

  const stop = useCallback(() => { cleanup.current?.(); cleanup.current = null; }, []);
  const start = useCallback(async () => {
    if (cleanup.current) return true;
    if (typeof window === 'undefined' || typeof DeviceMotionEvent === 'undefined') { setPermission('unavailable'); return false; }
    const askMotion = (DeviceMotionEvent as unknown as { requestPermission?: () => Promise<string> }).requestPermission;
    const askOrient = typeof DeviceOrientationEvent !== 'undefined'
      ? (DeviceOrientationEvent as unknown as { requestPermission?: () => Promise<string> }).requestPermission : undefined;
    if (askMotion) {
      try {
        if ((await askMotion()) !== 'granted') { setPermission('denied'); return false; }
        await askOrient?.().catch(() => 'denied');
      } catch { setPermission('denied'); return false; }
    }
    const detector = new StepDetector(() => setSteps(s => s + 1), () => {});
    const compass = new HeadingTracker(rad => setHeading(((rad * 180) / Math.PI + 360) % 360));
    const onMotion = (e: DeviceMotionEvent) => {
      const a = e.acceleration;
      if (a && a.x != null && a.y != null && a.z != null) detector.handleMotion(a.x, a.y, a.z);
      else if (e.accelerationIncludingGravity) {
        const g = e.accelerationIncludingGravity;
        detector.handleRawGravity(g.x ?? 0, g.y ?? 0, g.z ?? 0);
      }
    };
    // Same rules as the original app: prefer an absolute (earth-referenced) compass when the phone has one.
    let sawAbsolute = false;
    const onOrient = (e: DeviceOrientationEvent) => {
      const wk = (e as unknown as { webkitCompassHeading?: number }).webkitCompassHeading;
      const absolute = (e as unknown as { absolute?: boolean }).absolute === true || e.type === 'deviceorientationabsolute';
      if (absolute) sawAbsolute = true;
      if (!absolute && typeof wk !== 'number' && sawAbsolute) return;
      compass.handleOrientation(e.alpha, { absolute, webkitCompassHeading: typeof wk === 'number' ? wk : undefined });
    };
    window.addEventListener('devicemotion', onMotion);
    window.addEventListener('deviceorientationabsolute', onOrient as EventListener);
    window.addEventListener('deviceorientation', onOrient);
    cleanup.current = () => {
      window.removeEventListener('devicemotion', onMotion);
      window.removeEventListener('deviceorientationabsolute', onOrient as EventListener);
      window.removeEventListener('deviceorientation', onOrient);
      detector.destroy();
    };
    setPermission('granted');
    return true;
  }, []);
  useEffect(() => stop, [stop]);

  return { steps, metres: steps * STRIDE_M, heading, permission, start, stop, reset: useCallback(() => setSteps(0), []), active: permission === 'granted' };
}
