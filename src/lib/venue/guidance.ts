// Live turn-by-turn: how far along the route the visitor is, where that is
// on the map, which instruction applies now, and whether they've wandered off.

import type { Step } from './routing';

export interface RoutePoint { x: number; y: number; floorId: string; floorLevel: number }

/** Distance (m) from the start to each point on the route. Floor changes add no walking distance. */
export function measureRoute(path: RoutePoint[], pxPerMeter: number) {
  const cum = [0];
  for (let i = 1; i < path.length; i++) {
    const a = path[i - 1], b = path[i];
    cum.push(cum[i - 1] + (a.floorId === b.floorId ? Math.hypot(b.x - a.x, b.y - a.y) / pxPerMeter : 0));
  }
  return { cum, total: cum[cum.length - 1] ?? 0 };
}

/** The point `along` metres into the route. */
export function pointAlong(path: RoutePoint[], cum: number[], along: number): RoutePoint {
  if (!path.length) return { x: 0, y: 0, floorId: '', floorLevel: 0 };
  if (along <= 0) return path[0];
  for (let i = 1; i < path.length; i++) {
    if (cum[i] >= along) {
      const a = path[i - 1], b = path[i], len = cum[i] - cum[i - 1];
      if (len <= 0) return b;
      const t = (along - cum[i - 1]) / len;
      return { x: a.x + (b.x - a.x) * t, y: a.y + (b.y - a.y) * t, floorId: b.floorId, floorLevel: b.floorLevel };
    }
  }
  return path[path.length - 1];
}

/**
 * Snap a sensed position (e.g. GPS) onto the route: how far along it is and
 * how far off it (m). Prefers the stretch at or after `notBefore`, so a route
 * that doubles back doesn't jump the visitor backwards.
 */
export function projectOntoRoute(path: RoutePoint[], cum: number[], p: { x: number; y: number; floorId: string }, pxPerMeter: number, notBefore = 0) {
  let best = { along: 0, off: Infinity };
  for (let i = 1; i < path.length; i++) {
    const a = path[i - 1], b = path[i];
    if (a.floorId !== b.floorId || a.floorId !== p.floorId) continue;
    const dx = b.x - a.x, dy = b.y - a.y, l2 = dx * dx + dy * dy;
    const t = l2 ? Math.max(0, Math.min(1, ((p.x - a.x) * dx + (p.y - a.y) * dy) / l2)) : 0;
    const off = Math.hypot(a.x + dx * t - p.x, a.y + dy * t - p.y) / pxPerMeter;
    const along = cum[i - 1] + (cum[i] - cum[i - 1]) * t;
    // Small penalty for going backwards along the route.
    const score = off + (along < notBefore - 3 ? (notBefore - along) * 0.5 : 0);
    if (score < best.off + (best.along < notBefore - 3 ? (notBefore - best.along) * 0.5 : 0)) best = { along, off };
  }
  return { along: best.along, offRouteM: best.off };
}

/** The instruction to show now: the first one still ahead of the visitor. */
export function currentStepIndex(steps: Step[], cum: number[], along: number): number {
  for (let i = 0; i < steps.length; i++) {
    const s = steps[i];
    if (s.icon === 'start') { if (along < 1) return i; continue; }
    const at = cum[Math.min(s.pathIndex, cum.length - 1)] ?? 0;
    // A turn is "current" until you're past its corner; a walk until its end.
    if (at > along + 1.5) return i;
    if (s.icon !== 'straight' && at >= along - 1.5) return i;
  }
  return steps.length - 1;
}

export const ARRIVE_WITHIN_M = 3;
export const OFF_ROUTE_M = 15;
