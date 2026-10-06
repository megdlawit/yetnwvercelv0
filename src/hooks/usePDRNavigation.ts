/**
 * PDR Navigation Hook — fixed version.
 *
 * Bugs fixed vs original:
 *
 * FIX 1 — Gravity removal in motionHandler (the #1 cause of "always stationary").
 *   Old:  detector.handleMotion(a.x, a.y, a.z - 9.81)
 *         → wrong: gravity projects across all 3 axes depending on phone tilt.
 *         ||(ax, ay, az-9.81)|| is NOT the linear acceleration magnitude.
 *   New:  Prefer `e.acceleration` (gravity-free, provided by the OS).
 *         If it's null/undefined (iOS Safari sometimes omits it), fall back to
 *         `e.accelerationIncludingGravity` via detector.handleRawGravity() which
 *         uses a high-pass DC-removal filter to isolate the motion signal.
 *
 * FIX 2 — recordStep timestamp in Index.tsx called recordStep(Date.now()) inside
 *   a useEffect that runs when stepCount changes — every step fires the brain's
 *   recordStep with the current wall-clock time, which is fine, but was
 *   wrapped in an extra useEffect causing one-render delay. We now expose a
 *   `handleStep` callback that Index.tsx can wire directly, so the timestamp
 *   from the StepDetector (performance.now() → mapped to Date.now()) is used.
 *   The hook converts it correctly internally.
 *
 * FIX 3 — sensors started even when permission not yet granted (race in start()).
 *   Old: `if (perm !== 'granted') await requestSensors()` then immediately calls
 *        startSensors() even if requestSensors returned false (denied/unavailable).
 *   New: only call startSensors() if sensors are actually available.
 *
 * FIX 4 — duplicate sensor registration on fast re-mount.
 *   Old: startSensors() returned a cleanup fn but cleanupRef was overwritten
 *        before the old cleanup ran. Now always cleans up first.
 */

import { useState, useCallback, useRef, useEffect } from 'react';
import { NavNode, NavEdge } from '@/data/types';
import { StepDetector } from '@/lib/StepDetector';
import { HeadingTracker } from '@/lib/HeadingTracker';
import { computeStepPosition } from '@/lib/PDRPositioning';
import { followRoute, planDirection, pointAlong, projectAlong, stepForward, strideFromCadence } from '@/lib/venue/pdr';
import { snapToPath } from '@/lib/PathSnapper';
import { findShortestPath } from '@/lib/dijkstra';

export interface PDRNavState {
  isNavigating: boolean;
  isPaused: boolean;
  isComplete: boolean;
  currentPosition: { x: number; y: number };
  currentNodeIndex: number;
  progress: number;
  isMoving: boolean;
  heading: number;
  headingDeg: number;
  headingCardinal: string;
  sensorMode: 'pdr';
  sensorPermission: 'prompt' | 'granted' | 'denied' | 'unavailable';
  stepCount: number;
  isStationary: boolean;
  isWalking: boolean;
  accelVariance: number;
  rawEventCount: number;
  lastEventMsAgo: number | null;
  /** Metres actually walked on this route (stride by stride, at the walker's own pace). */
  distanceM: number;
}

// Plan units, for buildings without a real scale (the original behaviour).
const SNAP_COMPLETE_DIST = 20;
const REROUTE_DIST       = 50;
// Real metres, for plans with a known scale.
/** How close to a corner a turn may already continue onto the next stretch. */
const CORNER_REACH_M     = 3;
const SNAP_COMPLETE_M    = 2;
const REROUTE_M          = 6;

export interface PDRScale {
  /** Plan pixels per real metre (lib/navScale). 1 = plan units, the original behaviour. */
  pxPerMeter?: number;
  /** How far the plan is turned from north (the building's rotation_deg). */
  rotationDeg?: number;
}

export function usePDRNavigation(
  path: NavNode[] | null,
  allNodes: NavNode[],
  allEdges: NavEdge[],
  endNodeId: string | null,
  onReroute?: (newPath: NavNode[]) => void,
  scale: PDRScale = {},
) {
  const pxPerMeter = scale.pxPerMeter && scale.pxPerMeter > 0 ? scale.pxPerMeter : 1;
  const scaled = pxPerMeter !== 1;
  const scaleRef = useRef({ pxPerMeter, scaled, rotationDeg: scale.rotationDeg ?? 0 });
  scaleRef.current = { pxPerMeter, scaled, rotationDeg: scale.rotationDeg ?? 0 };
  const completeDist = scaled ? SNAP_COMPLETE_M * pxPerMeter : SNAP_COMPLETE_DIST;
  const rerouteDist  = scaled ? REROUTE_M * pxPerMeter : REROUTE_DIST;
  const [state, setState] = useState<PDRNavState>({
    isNavigating: false,
    isPaused: false,
    isComplete: false,
    currentPosition: { x: 0, y: 0 },
    currentNodeIndex: 0,
    progress: 0,
    isMoving: false,
    heading: 0,
    headingDeg: 0,
    headingCardinal: 'North',
    sensorMode: 'pdr',
    sensorPermission: 'prompt',
    stepCount: 0,
    isStationary: true,
    isWalking: false,
    accelVariance: 0,
    rawEventCount: 0,
    lastEventMsAgo: null,
    distanceM: 0,
  });

  const posRef          = useRef({ x: 0, y: 0 });
  const headingRef      = useRef(0);
  const stepDetectorRef = useRef<StepDetector | null>(null);
  const headingTrackerRef = useRef<HeadingTracker | null>(null);
  const pathRef         = useRef(path);
  const navigatingRef   = useRef(false);
  const cleanupRef      = useRef<(() => void) | null>(null);
  const permRef         = useRef<string>('prompt');
  const pendingStartRef = useRef(false);
  /** Where the walker is along the route (plan units), when following it. */
  const alongRef        = useRef<number | null>(null);
  /** Recent step times, for the walking pace (and so the stride). */
  const stepTimesRef    = useRef<number[]>([]);

  useEffect(() => {
    pathRef.current = path;
    // A new route (re-routed, next floor): pick up from where the walker is on it.
    alongRef.current = path && path.length >= 2 && navigatingRef.current ? projectAlong(path, posRef.current).s : null;
  }, [path]);

  // ── position update (snap + reroute) ─────────────────────────────────────
  const updatePosition = useCallback((x: number, y: number, isMoving: boolean) => {
    const currentPath = pathRef.current;
    if (!currentPath || currentPath.length < 2) return;

    const snap = snapToPath(x, y, currentPath);

    if (snap.distanceToPath > rerouteDist && endNodeId) {
      let nearestIdx = 0, nearestDist = Infinity;
      for (let i = 0; i < allNodes.length; i++) {
        const d = Math.sqrt((allNodes[i].x - x) ** 2 + (allNodes[i].y - y) ** 2);
        if (d < nearestDist) { nearestDist = d; nearestIdx = i; }
      }
      const nearestNode = allNodes[nearestIdx];
      const result = findShortestPath(allNodes, allEdges, nearestNode.id, endNodeId);
      if (result && onReroute) {
        onReroute(result.path);
        const newSnap = snapToPath(x, y, result.path);
        posRef.current = { x: newSnap.x, y: newSnap.y };
        setState(s => ({
          ...s,
          currentPosition: { x: newSnap.x, y: newSnap.y },
          currentNodeIndex: newSnap.nearestNodeIndex,
          isMoving,
        }));
        return;
      }
    }

    posRef.current = { x: snap.x, y: snap.y };
    alongRef.current = projectAlong(currentPath, posRef.current).s;
    // Done only when actually at the destination — being on the last stretch
    // of the route isn't arriving.
    const dest = currentPath[currentPath.length - 1];
    const isComplete = Math.hypot(snap.x - dest.x, snap.y - dest.y) < completeDist;

    let progress = 0;
    if (snap.nearestNodeIndex < currentPath.length - 1) {
      const from = currentPath[snap.nearestNodeIndex];
      const to   = currentPath[snap.nearestNodeIndex + 1];
      const segLen = Math.sqrt((to.x - from.x) ** 2 + (to.y - from.y) ** 2);
      if (segLen > 0) {
        const projDx = snap.x - from.x, projDy = snap.y - from.y;
        const segDx  = to.x - from.x,   segDy  = to.y - from.y;
        progress = Math.max(0, Math.min(1, (projDx * segDx + projDy * segDy) / (segLen * segLen)));
      }
    }

    setState(s => ({
      ...s,
      currentPosition: { x: snap.x, y: snap.y },
      currentNodeIndex: snap.nearestNodeIndex,
      progress,
      isMoving,
      isComplete,
      isNavigating: !isComplete && s.isNavigating,
    }));
  }, [allNodes, allEdges, endNodeId, onReroute, rerouteDist, completeDist]);

  // ── step / heading callbacks ──────────────────────────────────────────────
  const handleStep = useCallback((timestamp: number) => {
    // FIX 5 — stepCount used to be gated behind `navigatingRef.current`, so
    // it (and isWalking) only ever moved while a route was active AND
    // start() had been called. That meant "Test Sensors (no route needed)"
    // — which deliberately leaves navigatingRef false — never actually
    // counted a step, and there was no way to see steps/walking state at
    // all without a loaded route. Step counting is now always live the
    // moment sensors are attached (see the ambient-attach effect below).
    // Only the on-map position snap (which requires a real path) still
    // needs an active route, so that part alone stays gated.
    // The walker's pace (median of the last few step intervals) sets the stride.
    const times = stepTimesRef.current;
    times.push(timestamp);
    if (times.length > 6) times.shift();
    const gaps = times.slice(1).map((t, i) => t - times[i]).filter(g => g > 200 && g < 1500).sort((a, b) => a - b);
    const stride = strideFromCadence(gaps.length >= 2 ? 1000 / gaps[Math.floor(gaps.length / 2)] : null);

    setState(s => ({ ...s, stepCount: s.stepCount + 1, isWalking: true, distanceM: navigatingRef.current ? s.distanceM + stride : s.distanceM }));
    if (!navigatingRef.current) return;
    const sc = scaleRef.current;
    if (!sc.scaled) {
      // Older plans without a real scale keep the fixed map-unit step.
      const p = computeStepPosition(posRef.current, headingRef.current);
      updatePosition(p.x, p.y, true);
      return;
    }
    const headingDeg = (headingRef.current * 180) / Math.PI;
    const route = pathRef.current;
    // On a route: one stride along it whenever the step goes its way.
    if (route && route.length >= 2 && alongRef.current != null) {
      const d = planDirection(headingDeg, sc.rotationDeg);
      const r = followRoute(route, alongRef.current, { x: d.dx, y: d.dy }, stride * sc.pxPerMeter, CORNER_REACH_M * sc.pxPerMeter);
      if (r.onRoute) {
        const p = pointAlong(route, r.s);
        updatePosition(p.x, p.y, true);
        return;
      }
    }
    // Clearly off the route: a free step along the compass (may re-route).
    const p = stepForward(posRef.current, headingDeg, stride, sc.pxPerMeter, sc.rotationDeg);
    updatePosition(p.x, p.y, true);
  }, [updatePosition]);

  const handleStopWalking = useCallback(() => {
    setState(s => ({ ...s, isMoving: false, isWalking: false }));
  }, []);

  const handleHeadingChange = useCallback((rad: number) => {
    headingRef.current = rad;
    const tracker = headingTrackerRef.current;
    setState(s => ({
      ...s,
      heading: rad,
      headingDeg: tracker?.getHeadingDegrees() ?? (rad * 180) / Math.PI,
      headingCardinal: tracker?.getCardinal() ?? 'North',
    }));
  }, []);

  // ── sensor permission ─────────────────────────────────────────────────────
  const requestSensors = useCallback(async (): Promise<boolean> => {
    try {
      if (typeof DeviceMotionEvent === 'undefined') {
        setState(s => ({ ...s, sensorPermission: 'unavailable' }));
        permRef.current = 'unavailable';
        return false;
      }

      // iOS 13+ requires explicit permission
      if (typeof (DeviceMotionEvent as any).requestPermission === 'function') {
        const motionPerm = await (DeviceMotionEvent as any).requestPermission();
        const orientPerm = await (DeviceOrientationEvent as any).requestPermission?.() ?? 'granted';
        const granted = motionPerm === 'granted' && orientPerm === 'granted';
        const status = granted ? 'granted' : 'denied';
        setState(s => ({ ...s, sensorPermission: status }));
        permRef.current = status;
        return granted;
      }

      // Android / desktop — there is no permission API to call here at all
      // (requestPermission only exists on iOS 13+ Safari), so there is
      // nothing to "request". Grant immediately and let startSensors()
      // attach the real listeners right away.
      //
      // ROOT CAUSE OF "PDR never moves / heading stuck at 0 / always
      // stationary": the old code, instead of just starting, waited up to
      // 1 second for a *probe* devicemotion event before granting anything.
      // On real devices the first devicemotion event can easily take
      // longer than 1s to arrive (sensor warm-up, background-tab/rAF
      // throttling, low-power mode, slow first paint) — when it did,
      // sensors were permanently marked 'unavailable' and startSensors()
      // was NEVER called, so the real motion/orientation listeners were
      // never attached. Every value stayed frozen at its initial default
      // (heading 0°, isStationary: true, stepCount: 0) for the rest of the
      // session, no matter how much the phone physically moved — with no
      // retry, since it was a one-shot check.
      setState(s => ({ ...s, sensorPermission: 'granted' }));
      permRef.current = 'granted';
      return true;
    } catch {
      setState(s => ({ ...s, sensorPermission: 'denied' }));
      permRef.current = 'denied';
      return false;
    }
  }, []);

  // ── sensor start ──────────────────────────────────────────────────────────
  const startSensors = useCallback((): (() => void) => {
    const detector = new StepDetector(handleStep, handleStopWalking);
    const tracker  = new HeadingTracker(handleHeadingChange);
    stepDetectorRef.current  = detector;
    headingTrackerRef.current = tracker;

    let rawEventCount = 0;
    let lastEventAt: number | null = null;

    // Periodic debug-state sync (isStationary, variance, etc.)
    const debugInterval = window.setInterval(() => {
      const isStationary = detector.isStationary;
      tracker.setFrozen(isStationary);
      setState(s => ({
        ...s,
        isStationary,
        isWalking: detector.isWalking,
        accelVariance: Math.round(detector.variance * 1000) / 1000,
        rawEventCount,
        lastEventMsAgo: lastEventAt === null ? null : Math.round(performance.now() - lastEventAt),
      }));
    }, 150);

    // Non-blocking watchdog: purely informational. Real listeners below are
    // ALWAYS attached regardless of this — it only flips the displayed
    // sensorPermission to 'unavailable' if truly nothing arrives after a
    // generous grace period (genuinely sensor-less device, e.g. a desktop
    // with no accelerometer), and flips it back to 'granted' the instant a
    // real event lands, even if that's late. This replaces the old 1s
    // probe-then-give-up gate that could disable PDR permanently.
    let receivedAnyMotion = false;
    const watchdog = window.setTimeout(() => {
      if (!receivedAnyMotion) {
        setState(s => (s.sensorPermission === 'granted' ? { ...s, sensorPermission: 'unavailable' } : s));
      }
    }, 3000);

    // Some Android devices/browsers don't actually compute the gravity-free
    // `e.acceleration` field — instead of leaving it null/undefined (which
    // the code below already falls back on), they report a literal
    // {x:0, y:0, z:0} on every single event, even while the phone is
    // physically moving. That looks "valid" to a null-check, so the old
    // code kept feeding the step detector a permanently flat, all-zero
    // signal — it read as motionless forever, so steps could never fire,
    // while the raw devicemotion listener itself kept firing normally
    // (which is exactly "raw events go up, Steps stays 0"). Track how many
    // consecutive events report exactly zero on all three axes; once that
    // run gets long enough that it can't plausibly be someone standing
    // still while raw events are still arriving fast, switch permanently
    // to the accelerationIncludingGravity + DC-removal fallback path for
    // the rest of this session.
    let consecutiveZeroAcceleration = 0;
    let accelerationFieldBroken = false;
    const ZERO_ACCELERATION_BREAK_THRESHOLD = 40; // ~a couple seconds of events

    // ── FIXED: use e.acceleration (gravity-free) first; fall back to ──────
    // ── handleRawGravity() with the DC-removal high-pass filter.       ──────
    const motionHandler = (e: DeviceMotionEvent) => {
      rawEventCount++;
      lastEventAt = performance.now();
      if (!receivedAnyMotion) {
        receivedAnyMotion = true;
        clearTimeout(watchdog);
        permRef.current = 'granted';
        setState(s => (s.sensorPermission !== 'granted' ? { ...s, sensorPermission: 'granted' } : s));
      }
      const acc = e.acceleration; // gravity subtracted by OS (when the device actually supports it)
      const accValid = !!acc && acc.x != null && acc.y != null && acc.z != null;

      if (accValid && !accelerationFieldBroken) {
        if (acc!.x === 0 && acc!.y === 0 && acc!.z === 0) {
          consecutiveZeroAcceleration++;
          if (consecutiveZeroAcceleration >= ZERO_ACCELERATION_BREAK_THRESHOLD) {
            accelerationFieldBroken = true;
          }
        } else {
          consecutiveZeroAcceleration = 0;
        }
      }

      if (accValid && !accelerationFieldBroken) {
        detector.handleMotion(acc!.x!, acc!.y!, acc!.z!);
      } else {
        // Fallback: gravity-including signal → DC-removal filter inside detector
        const g = e.accelerationIncludingGravity;
        if (g && g.x != null && g.y != null && g.z != null) {
          detector.handleRawGravity(g.x, g.y, g.z);
        }
      }
    };

    let sawAbsoluteEvent = false;
    const orientHandler = (e: DeviceOrientationEvent) => {
      const webkitCompassHeading = (e as any).webkitCompassHeading;
      const isAbsolute = (e as any).absolute === true || e.type === 'deviceorientationabsolute';
      if (isAbsolute) sawAbsoluteEvent = true;

      // If this device also fires a proper absolute event, ignore the
      // plain non-absolute 'deviceorientation' duplicates (Android fires
      // both for the same physical rotation) — using both would make the
      // heading jitter between correct and drifting fallback values.
      if (!isAbsolute && typeof webkitCompassHeading !== 'number' && sawAbsoluteEvent) {
        return;
      }

      tracker.handleOrientation(e.alpha, {
        absolute: isAbsolute,
        webkitCompassHeading:
          typeof webkitCompassHeading === 'number' ? webkitCompassHeading : undefined,
      });
    };

    const bindTarget = (target: EventTarget) => {
      target.addEventListener('devicemotion', motionHandler as EventListener, { passive: true } as AddEventListenerOptions);
      target.addEventListener('deviceorientationabsolute', orientHandler as EventListener, { passive: true } as AddEventListenerOptions);
      target.addEventListener('deviceorientation', orientHandler as EventListener, { passive: true } as AddEventListenerOptions);
    };
    const unbindTarget = (target: EventTarget) => {
      target.removeEventListener('devicemotion', motionHandler as EventListener);
      target.removeEventListener('deviceorientationabsolute', orientHandler as EventListener);
      target.removeEventListener('deviceorientation', orientHandler as EventListener);
    };

    bindTarget(window);
    if (typeof document !== 'undefined') bindTarget(document);

    return () => {
      unbindTarget(window);
      if (typeof document !== 'undefined') unbindTarget(document);
      clearInterval(debugInterval);
      clearTimeout(watchdog);
      detector.destroy();
    };
  }, [handleStep, handleStopWalking, handleHeadingChange]);

  // ── ambient sensor attachment ─────────────────────────────────────────────
  // FIX 6 — root cause of "steps only work if I tap Test Sensors first, and
  // only Test Sensors is decoupled from needing a route": the real
  // devicemotion/deviceorientation listeners were ONLY ever attached inside
  // start() (which requires path.length >= 2, i.e. an active route) or
  // testSensors() (which requires a manual tap). There was no path that
  // attached them on their own.
  //
  // This effect attaches them as soon as it's actually possible to:
  //   - Android / desktop: no permission API exists at all, so this fires
  //     immediately on mount — sensors are live before the user does
  //     anything.
  //   - iOS 13+: DeviceMotionEvent.requestPermission() MUST be called
  //     synchronously from inside a real user click/tap handler, or Safari
  //     silently ignores it — it cannot be requested from inside a
  //     useEffect. So on iOS this effect stays a no-op until permRef.current
  //     is already 'granted' (set by whatever button the user actually
  //     tapped — the onboarding "Allow" prompt, or the debug "Test Sensors"
  //     button — either one works, neither is required specifically).
  //     `state.sensorPermission` is in the dep array so this effect re-runs
  //     the instant that happens and attaches right away.
  //
  // Once attached, listeners are left running for the life of this hook —
  // start()/stop() below no longer tear them down, they just toggle
  // navigatingRef (see handleStep/updatePosition above and stop() below).
  useEffect(() => {
    let cancelled = false;
    const needsPrompt =
      typeof DeviceMotionEvent !== 'undefined' &&
      typeof (DeviceMotionEvent as any).requestPermission === 'function';
    if (!cancelled && !cleanupRef.current && (!needsPrompt || permRef.current === 'granted')) {
      cleanupRef.current = startSensors();
    }
    return () => { cancelled = true; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [startSensors, state.sensorPermission]);

  // ── public API ────────────────────────────────────────────────────────────
  const start = useCallback(async () => {
    if (!path || path.length < 2) {
      // FIX — root cause of "isNavigating stuck false / blue dot never
      // moves even though the debug panel later shows a healthy Path pts
      // count": `path` here is the per-floor slice (`currentFloorPath` in
      // Index.tsx), derived via useMemo from the multi-floor brain path.
      // "Start Walking" becomes clickable as soon as `hasPath` (the FULL
      // cross-floor path) is non-empty, which can be one or two renders
      // BEFORE the current-floor slice finishes recomputing. The old code
      // just console.warn'd and gave up — isNavigating never became true,
      // so handleStep's `navigatingRef.current` guard silently dropped
      // every subsequent step/position update for the rest of the session,
      // with no retry, even once the path became valid a moment later.
      // Now: remember the request and let the effect below fire it the
      // instant a valid path shows up.
      // eslint-disable-next-line no-console
      console.warn(
        '[PDR] start() called before a valid path was ready — will auto-start as soon as it arrives.',
        'path:', path,
      );
      pendingStartRef.current = true;
      return;
    }
    pendingStartRef.current = false;

    // Sensors are attached ambiently now (see the effect above) and are
    // deliberately NOT torn down here — a route starting shouldn't interrupt
    // step/heading tracking that may already be running. If for some reason
    // nothing is attached yet (e.g. permission only just got granted this
    // tick), attach now instead of waiting for the effect to catch up.
    const pos = { x: path[0].x, y: path[0].y };
    posRef.current     = pos;
    navigatingRef.current = true;
    alongRef.current   = 0;   // at the start of the route
    stepTimesRef.current = [];

    setState(s => ({
      ...s,
      isNavigating: true,
      isPaused: false,
      isComplete: false,
      currentPosition: pos,
      distanceM: 0,
      currentNodeIndex: 0,
      progress: 0,
      isMoving: false,
      stepCount: 0,
      isStationary: true,
      isWalking: false,
      accelVariance: 0,
      rawEventCount: 0,
      lastEventMsAgo: null,
    }));

    // Start listening immediately so motion updates are captured even before
    // the permission prompt resolves. We still ask for permission in the
    // background, but navigation should not wait on it to begin.
    if (!cleanupRef.current) {
      cleanupRef.current = startSensors();
    }

    let ok = permRef.current === 'granted';
    if (!ok) {
      ok = await requestSensors();
    }

    if (!ok && permRef.current !== 'granted') {
      setState(s => ({ ...s, sensorPermission: permRef.current === 'denied' ? 'denied' : 'unavailable' }));
    }
  }, [path, requestSensors, startSensors]);

  // Auto-fires the deferred start() the moment `path` becomes valid, so a
  // "Start Walking" tap that landed a render early isn't lost.
  useEffect(() => {
    if (pendingStartRef.current && path && path.length >= 2 && !navigatingRef.current) {
      pendingStartRef.current = false;
      void start();
    }
  }, [path, start]);

  const stop = useCallback(() => {
    navigatingRef.current = false;
    pendingStartRef.current = false;
    // Deliberately NOT tearing down cleanupRef here — sensors stay attached
    // ambiently so stepCount/heading/isWalking/etc. keep working after a
    // route ends, same as before one ever started. Only the navigation-
    // specific fields (position on the path, progress, nav flags) reset;
    // stepCount and the live sensor readouts are left exactly as they are.
    setState(prev => ({
      ...prev,
      isNavigating: false,
      isPaused: false,
      isComplete: false,
      currentPosition: { x: 0, y: 0 },
      currentNodeIndex: 0,
      progress: 0,
      isMoving: false,
    }));
  }, []);

  // Cleanup on unmount — this is now the only place listeners are torn down.
  useEffect(() => {
    return () => {
      navigatingRef.current = false;
      cleanupRef.current?.();
      cleanupRef.current = null;
    };
  }, []);

  // Legacy API kept for the DebugDrawer button and any other callers.
  // Sensors now attach ambiently on their own (see the effect above), so
  // this no longer needs to do the attaching itself — its only remaining
  // job is to trigger the permission prompt on-demand for devices (iOS)
  // that haven't granted it yet, since that prompt must come from a real
  // click handler. Once permission is granted the ambient effect takes it
  // from there, so "Test Sensors" is no longer required for steps/heading/
  // etc. to work — it's just a convenient manual permission trigger now.
  const testSensors = useCallback(async () => {
    let ok = permRef.current === 'granted';
    if (!ok) {
      ok = await requestSensors();
    }
    if ((ok || permRef.current === 'granted') && !cleanupRef.current) {
      cleanupRef.current = startSensors();
    }
    return ok || permRef.current === 'granted';
  }, [requestSensors, startSensors]);

  // No-op now that sensors stay attached ambiently — kept so existing
  // DebugDrawer wiring (onStopTestSensors) doesn't need to change.
  const stopTestSensors = useCallback(() => {}, []);

  return { state, start, stop, requestSensors, testSensors, stopTestSensors };
}