// Pedestrian dead reckoning on a venue plan: every step moves the visitor one
// stride in the direction the phone's compass says they're facing, then snaps
// them onto the nearest walking path (people walk on paths, not through walls).

/**
 * Direction of a compass heading (degrees clockwise from north) in plan
 * coordinates (x right, y down), for a plan turned `planRotationDeg` from
 * north (buildings.rotation_deg). Same convention as GeoMath.indoorToGeo.
 */
export function planDirection(headingDeg: number, planRotationDeg = 0) {
  const h = (headingDeg * Math.PI) / 180, t = (-planRotationDeg * Math.PI) / 180;
  const east = Math.sin(h), north = Math.cos(h);
  const eastPx = east * Math.cos(t) + north * Math.sin(t);
  const northPx = -east * Math.sin(t) + north * Math.cos(t);
  return { dx: eastPx, dy: -northPx };
}

/** One step forward. */
export function stepForward(p: { x: number; y: number }, headingDeg: number, strideM: number, pxPerMeter: number, planRotationDeg = 0) {
  const d = planDirection(headingDeg, planRotationDeg);
  return { x: p.x + d.dx * strideM * pxPerMeter, y: p.y + d.dy * strideM * pxPerMeter };
}

/** The heading as an angle for drawing on the plan (degrees, 0 = +x, clockwise because y points down). */
export const planAngleDeg = (headingDeg: number, planRotationDeg = 0) => {
  const d = planDirection(headingDeg, planRotationDeg);
  return (Math.atan2(d.dy, d.dx) * 180) / Math.PI;
};

export interface Segment { a: { x: number; y: number }; b: { x: number; y: number } }

/** Snap onto the nearest path segment, if one is within `maxPx`; otherwise stay put. */
export function snapToPaths(p: { x: number; y: number }, segments: Segment[], maxPx: number) {
  let best: { x: number; y: number; d: number } | null = null;
  for (const { a, b } of segments) {
    const dx = b.x - a.x, dy = b.y - a.y, l2 = dx * dx + dy * dy;
    const t = l2 ? Math.max(0, Math.min(1, ((p.x - a.x) * dx + (p.y - a.y) * dy) / l2)) : 0;
    const x = a.x + dx * t, y = a.y + dy * t, d = Math.hypot(x - p.x, y - p.y);
    if (d <= maxPx && (!best || d < best.d)) best = { x, y, d };
  }
  return best ? { x: best.x, y: best.y } : p;
}

// ── Following a route ────────────────────────────────────────────────────────
// Indoor positioning is far more accurate when steps are kept on the route:
// a step taken roughly along the route moves exactly one stride along it (the
// compass only has to say "this way", not the exact angle), turning near a
// corner continues onto the next stretch, and walking back moves back. Only a
// step clearly off the route is left free (and may then trigger a re-route).

export interface P2 { x: number; y: number }

/** An average adult walking step, metres. */
export const AVERAGE_STRIDE_M = 0.7;

/** Distance along a polyline at each of its points. */
export function cumulative(path: P2[]): number[] {
  const out = [0];
  for (let i = 1; i < path.length; i++) out.push(out[i - 1] + Math.hypot(path[i].x - path[i - 1].x, path[i].y - path[i - 1].y));
  return out;
}

/** The point `s` along a polyline (clamped to its ends). */
export function pointAlong(path: P2[], s: number, cum = cumulative(path)): P2 {
  if (path.length === 1 || s <= 0) return { ...path[0] };
  const total = cum[cum.length - 1];
  if (s >= total) return { ...path[path.length - 1] };
  let i = 1;
  while (i < cum.length - 1 && cum[i] < s) i++;
  const t = (s - cum[i - 1]) / Math.max(cum[i] - cum[i - 1], 1e-9);
  return { x: path[i - 1].x + (path[i].x - path[i - 1].x) * t, y: path[i - 1].y + (path[i].y - path[i - 1].y) * t };
}

/** How far along a polyline the point nearest to `p` is, and how far `p` is from it. */
export function projectAlong(path: P2[], p: P2, cum = cumulative(path)): { s: number; dist: number } {
  let best = { s: 0, dist: Infinity };
  for (let i = 1; i < path.length; i++) {
    const a = path[i - 1], b = path[i];
    const dx = b.x - a.x, dy = b.y - a.y, len2 = dx * dx + dy * dy || 1e-9;
    const t = Math.max(0, Math.min(1, ((p.x - a.x) * dx + (p.y - a.y) * dy) / len2));
    const d = Math.hypot(a.x + dx * t - p.x, a.y + dy * t - p.y);
    if (d < best.dist) best = { s: cum[i - 1] + t * Math.sqrt(len2), dist: d };
  }
  return best;
}

/**
 * One step on a route. `dir` is the step's direction on the plan (unit
 * vector), `stride` its length and `cornerReach` how close to a corner a turn
 * may already continue onto the next stretch (both in plan units).
 * Returns the new distance along the route, or onRoute: false when the step
 * clearly leaves it.
 */
export function followRoute(path: P2[], s: number, dir: P2, stride: number, cornerReach: number, cum = cumulative(path)): { s: number; onRoute: boolean } {
  const total = cum[cum.length - 1];
  if (path.length < 2 || total <= 0) return { s, onRoute: false };
  // the stretch we're on (at a corner exactly: the one ahead)
  let i = 0;
  while (i < path.length - 2 && cum[i + 1] <= s) i++;
  const unit = (k: number) => {
    const a = path[k], b = path[k + 1], len = Math.hypot(b.x - a.x, b.y - a.y) || 1;
    return { x: (b.x - a.x) / len, y: (b.y - a.y) / len };
  };
  const along = (k: number) => { const u = unit(k); return dir.x * u.x + dir.y * u.y; };
  const ALONG = 0.5; // within ~60° of the route's direction

  // Turned the corner just ahead: continue from the corner onto the next stretch.
  if (i < path.length - 2 && cum[i + 1] - s <= cornerReach && along(i + 1) >= ALONG && along(i) < ALONG) {
    return { s: Math.min(total, cum[i + 1] + stride), onRoute: true };
  }
  if (along(i) >= ALONG) return { s: Math.min(total, s + stride), onRoute: true };
  // Turned back at the corner just behind us onto the previous stretch.
  if (i > 0 && s - cum[i] <= cornerReach && along(i - 1) <= -ALONG) return { s: Math.max(0, cum[i] - stride), onRoute: true };
  if (along(i) <= -ALONG) return { s: Math.max(0, s - stride), onRoute: true };
  return { s, onRoute: false };
}

/**
 * Step length from walking pace: people take longer steps when they walk
 * faster. ~0.65 m at a stroll (1.6 steps/s), ~0.73 m at a normal pace
 * (1.9/s), ~0.8 m hurrying (2.2/s). Without a pace yet: 0.7 m.
 */
export function strideFromCadence(stepsPerSecond: number | null): number {
  if (!stepsPerSecond || !Number.isFinite(stepsPerSecond)) return AVERAGE_STRIDE_M;
  return Math.min(0.85, Math.max(0.5, 0.25 + 0.25 * stepsPerSecond));
}
