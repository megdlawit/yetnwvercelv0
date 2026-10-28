// Floors of one building, imported together, put on top of each other: each floor's plan
// is moved so its walls lie over the floor next to it (sheets draw the plans side by side,
// files start at their own corner), and the stairs and lifts that line up between two
// floors are linked, so directions go up and down.
//
// Plan coordinates are editor px (pxPerMeter per metre), Y down, as BuiltVenue's.

import type { BuiltVenue } from './buildVenue';
import { polygonCentroid } from './geometry';
import { roomTypeFromName } from './commitVenue';

/** The walls' cells on a square grid (cell px), sampled along every wall. */
function cellsOf(v: BuiltVenue, cell: number): Map<string, [number, number]> {
  const out = new Map<string, [number, number]>();
  for (const w of v.walls) {
    const n = Math.max(1, Math.ceil(Math.hypot(w.x2 - w.x1, w.y2 - w.y1) / (cell / 2)));
    for (let i = 0; i <= n; i++) {
      const cx = Math.floor((w.x1 + ((w.x2 - w.x1) * i) / n) / cell), cy = Math.floor((w.y1 + ((w.y2 - w.y1) * i) / n) / cell);
      out.set(`${cx},${cy}`, [cx, cy]);
    }
  }
  return out;
}

/** How many of `moving`'s cells, shifted by (dx, dy) cells, land on `fixed`'s. */
function overlap(fixed: Map<string, [number, number]>, moving: [number, number][], dx: number, dy: number): number {
  let n = 0;
  for (const [x, y] of moving) if (fixed.has(`${x + dx},${y + dy}`)) n++;
  return n;
}

export interface Shift { dx: number; dy: number; /** Share of the moved floor's walls that lie on the other's, 0–1. */ fit: number }

/**
 * The shift (px) that lays `moving`'s walls over `fixed`'s best: every pair of wall cells
 * votes for the shift that would make them meet (on a 0.5 m grid), the most-voted shift wins,
 * and it's refined on a 0.1 m grid.
 */
export function bestShift(fixed: BuiltVenue, moving: BuiltVenue, pxPerMeter: number): Shift {
  const coarse = pxPerMeter / 2, fine = pxPerMeter / 10;
  const F = cellsOf(fixed, coarse), M = [...cellsOf(moving, coarse).values()];
  if (!F.size || !M.length) return { dx: 0, dy: 0, fit: 0 };
  // A fixed sample of each side keeps a big floor quick (votes = sample × sample).
  const sample = <T,>(xs: T[], k: number) => (xs.length <= k ? xs : xs.filter((_, i) => i % Math.ceil(xs.length / k) === 0));
  const fs = sample([...F.values()], 1500), ms = sample(M, 400);
  const votes = new Map<string, number>();
  let best = { dx: 0, dy: 0, n: -1 };
  for (const [mx, my] of ms) for (const [fx, fy] of fs) {
    const k = `${fx - mx},${fy - my}`, n = (votes.get(k) ?? 0) + 1;
    votes.set(k, n);
    if (n > best.n) best = { dx: fx - mx, dy: fy - my, n };
  }
  // The few best-voted shifts, judged by true overlap (votes favour repeated patterns).
  const top = [...votes.entries()].sort((a, b) => b[1] - a[1]).slice(0, 12).map(([k]) => k.split(',').map(Number) as [number, number]);
  let pick = { dx: best.dx, dy: best.dy, n: overlap(F, M, best.dx, best.dy) };
  for (const [dx, dy] of top) { const n = overlap(F, M, dx, dy); if (n > pick.n) pick = { dx, dy, n }; }
  // Refine within half a metre either way.
  const Ff = cellsOf(fixed, fine), Mf = [...cellsOf(moving, fine).values()];
  const r = coarse / fine;
  let fineBest = { dx: pick.dx * r, dy: pick.dy * r, n: -1 };
  for (let dx = pick.dx * r - r; dx <= pick.dx * r + r; dx++) {
    for (let dy = pick.dy * r - r; dy <= pick.dy * r + r; dy++) {
      const n = overlap(Ff, Mf, dx, dy);
      if (n > fineBest.n) fineBest = { dx, dy, n };
    }
  }
  return { dx: fineBest.dx * fine, dy: fineBest.dy * fine, fit: Mf.length ? fineBest.n / Mf.length : 0 };
}

/** A built venue moved by (dx, dy) px: walls, glass, rooms, objects and the drawing. */
export function shiftVenue(v: BuiltVenue, dx: number, dy: number): BuiltVenue {
  if (!dx && !dy) return v;
  const seg = <S extends { x1: number; y1: number; x2: number; y2: number }>(s: S): S => ({ ...s, x1: s.x1 + dx, y1: s.y1 + dy, x2: s.x2 + dx, y2: s.y2 + dy });
  return {
    ...v,
    walls: v.walls.map(seg),
    ...(v.glass ? { glass: v.glass.map(seg) } : {}),
    rooms: v.rooms.map(r => ({ ...r, x: r.x + dx, y: r.y + dy, polygon: r.polygon.map(p => ({ x: p.x + dx, y: p.y + dy })) })),
    features: v.features.map(f => ({ ...f, x: f.x + dx, y: f.y + dy })),
    ...(v.drawing ? {
      drawing: {
        ...v.drawing,
        layers: Object.fromEntries(Object.entries(v.drawing.layers).map(([k, lines]) => [k, lines!.map(l => l.map((n, i) => Math.round(n + (i % 2 ? dy : dx))))])),
      },
    } : {}),
  };
}

/** Below this share of walls lying on the other floor's, a floor isn't moved (it's a different plan). */
export const MIN_FIT = 0.2;

/**
 * Every floor moved over its neighbour: up from the ground floor (the lowest at level 0 or
 * above), then down to the basements. Returns the moved venues and, per floor, how it went.
 */
export function alignFloors(floors: { level: number; built: BuiltVenue }[], pxPerMeter: number): { built: BuiltVenue[]; shifts: (Shift & { moved: boolean })[] } {
  const order = floors.map((f, i) => ({ ...f, i })).sort((a, b) => a.level - b.level);
  const out = floors.map(f => f.built);
  const shifts: (Shift & { moved: boolean })[] = floors.map(() => ({ dx: 0, dy: 0, fit: 1, moved: false }));
  if (order.length < 2) return { built: out, shifts };
  const g = Math.max(0, order.findIndex(f => f.level >= 0));
  const place = (from: number, to: number) => {
    const s = bestShift(out[order[from].i], order[to].built, pxPerMeter);
    const moved = s.fit >= MIN_FIT;
    shifts[order[to].i] = { ...s, moved };
    if (moved) out[order[to].i] = shiftVenue(order[to].built, s.dx, s.dy);
  };
  for (let k = g + 1; k < order.length; k++) place(k - 1, k);
  for (let k = g - 1; k >= 0; k--) place(k + 1, k);
  return { built: out, shifts };
}

export interface Spot { kind: 'stairs' | 'elevator'; x: number; y: number }

/** Where a floor's stairs and lifts are: the objects found in the drawing, and rooms of those kinds. */
export function spotsOf(v: BuiltVenue): Spot[] {
  const out: Spot[] = [];
  for (const f of v.features) if (f.kind === 'stairs' || f.kind === 'elevator') out.push({ kind: f.kind, x: f.x, y: f.y });
  for (const r of v.rooms) {
    const t = r.type ?? roomTypeFromName(r.name);
    if (t === 'stairs' || t === 'elevator') out.push({ kind: t, ...polygonCentroid(r.polygon) });
  }
  return out;
}

export interface FloorNodes { floorId: string; level: number; spots: Spot[]; nodes: { id: string; x: number; y: number }[] }
export interface VerticalLink { from: string; to: string; kind: 'stairs' | 'elevator'; fromFloor: string; toFloor: string }

/**
 * Links between neighbouring floors (by level): each stair or lift that has one of the same
 * kind within `near` m on the floor above, from the nearest place to it on each floor (within
 * `reach` m). A stair core seen twice (an object and a room) is linked once.
 */
export function verticalLinks(floors: FloorNodes[], pxPerMeter: number, near = 3, reach = 5): VerticalLink[] {
  const sorted = [...floors].sort((a, b) => a.level - b.level);
  const links: VerticalLink[] = [];
  const closest = (nodes: FloorNodes['nodes'], p: { x: number; y: number }) => {
    let best: string | null = null, bd = reach * pxPerMeter;
    for (const n of nodes) { const d = Math.hypot(n.x - p.x, n.y - p.y); if (d < bd) { bd = d; best = n.id; } }
    return best;
  };
  for (let i = 1; i < sorted.length; i++) {
    const lo = sorted[i - 1], hi = sorted[i];
    if (hi.level - lo.level > 1) continue;   // a floor between them isn't in this import
    const seen = new Set<string>();
    for (const s of lo.spots) {
      const up = hi.spots.filter(t => t.kind === s.kind).map(t => ({ t, d: Math.hypot(t.x - s.x, t.y - s.y) })).sort((a, b) => a.d - b.d)[0];
      if (!up || up.d > near * pxPerMeter) continue;
      const a = closest(lo.nodes, s), b = closest(hi.nodes, up.t);
      if (!a || !b || seen.has(`${a}|${b}`)) continue;
      seen.add(`${a}|${b}`);
      links.push({ from: a, to: b, kind: s.kind, fromFloor: lo.floorId, toFloor: hi.floorId });
    }
  }
  return links;
}
