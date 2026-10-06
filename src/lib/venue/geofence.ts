// Geofenced messages: "You're entering the Historic Garden…" when a visitor
// walks into a place, once per visit — and "Museum · 8 min walk" nudges
// towards something worth seeing nearby, also once each.

import { metresBetween, walkMinutes, type Spot } from './discover';

export interface Fence {
  id: string;            // the place
  name: string;
  floorId: string;
  center: { x: number; y: number };
  /** The place's area outline (plan px), when it has one. */
  polygon?: { x: number; y: number }[];
  /** Greeting radius (plan px) around the centre; 0 = only inside the outline. */
  radiusPx: number;
}

function inside(poly: { x: number; y: number }[], p: { x: number; y: number }) {
  let r = false;
  for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) {
    const a = poly[i], b = poly[j];
    if ((a.y > p.y) !== (b.y > p.y) && p.x < ((b.x - a.x) * (p.y - a.y)) / (b.y - a.y) + a.x) r = !r;
  }
  return r;
}

export const isInFence = (f: Fence, p: Spot) =>
  f.floorId === p.floorId && ((f.polygon && f.polygon.length > 2 && inside(f.polygon, p)) || (f.radiusPx > 0 && Math.hypot(f.center.x - p.x, f.center.y - p.y) <= f.radiusPx));

/**
 * Feeds positions in; gets back the fences newly entered. Each fence fires
 * once per visit (pass in the ids already greeted). Standing on a boundary
 * doesn't re-fire, and neither does coming back later.
 */
export class GeofenceTracker {
  constructor(private fences: Fence[], private greeted: Set<string> = new Set()) {}
  setFences(f: Fence[]) { this.fences = f; }
  get seen() { return this.greeted; }
  update(p: Spot): Fence[] {
    const entered = this.fences.filter(f => !this.greeted.has(f.id) && isInFence(f, p));
    // The smallest fence wins when they nest (a café inside a garden): greet that one, remember all.
    entered.forEach(f => this.greeted.add(f.id));
    return entered.sort((a, b) => area(a) - area(b)).slice(0, 1);
  }
}
const area = (f: Fence) => (f.polygon && f.polygon.length > 2 ? Math.abs(f.polygon.reduce((s, p, i, a) => s + p.x * a[(i + 1) % a.length].y - a[(i + 1) % a.length].x * p.y, 0)) / 2 : Math.PI * f.radiusPx ** 2);

/** The nearest worthwhile place you haven't been to yet: "Museum · 8 min walk". */
export function nearbySuggestion<P extends Spot & { id: string; name: string }>(from: Spot, candidates: P[], visited: Set<string>, pxPerMeter: number, maxMetres = 600) {
  let best: { place: P; metres: number } | null = null;
  for (const p of candidates) {
    if (visited.has(p.id)) continue;
    const m = metresBetween(from, p, pxPerMeter);
    if (m < 12 || m > maxMetres) continue;  // already there, or too far to suggest
    if (!best || m < best.metres) best = { place: p, metres: m };
  }
  return best && { ...best, minutes: walkMinutes(best.metres) };
}
