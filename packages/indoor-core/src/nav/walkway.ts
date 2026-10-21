// Walking a floor the way a person would: around walls and through the
// doorways, never through a wall — whatever the drawn path lines do.
//
// Each floor becomes a fine grid (20 cm): cells too close to a wall are
// solid, door and arch openings stay open. A* finds the shortest way across
// it, then the way is pulled straight wherever there's a clear line of
// sight, so the walk reads as natural straight stretches through doorways.

import type { IndoorVenue, Vec2 } from '../model';
import { obstacles } from '../walls';

interface Grid { x0: number; z0: number; cs: number; w: number; h: number; free: Uint8Array; area?: Int32Array }

/** Grid cell size (m) and how far to keep from a wall's centre line (m). */
const CELL = 0.2;
const CLEAR = 0.3;
/** Room to walk round the outside of the building (m). */
const MARGIN = 6;
const MAX_CELLS = 600_000;

const grids = new WeakMap<IndoorVenue, Map<string, Grid>>();

function segDist(x: number, z: number, a: Vec2, b: Vec2) {
  const dx = b.x - a.x, dz = b.z - a.z, l2 = dx * dx + dz * dz;
  const t = l2 > 0 ? Math.max(0, Math.min(1, ((x - a.x) * dx + (z - a.z) * dz) / l2)) : 0;
  return Math.hypot(x - (a.x + dx * t), z - (a.z + dz * t));
}

function gridFor(venue: IndoorVenue, floorId: string): Grid {
  let byFloor = grids.get(venue);
  if (!byFloor) { byFloor = new Map(); grids.set(venue, byFloor); }
  const hit = byFloor.get(floorId);
  if (hit) return hit;

  const pts: Vec2[] = [
    ...venue.walls.filter(w => w.floorId === floorId).flatMap(w => [w.a, w.b]),
    ...venue.rooms.filter(r => r.floorId === floorId).flatMap(r => r.polygon),
    ...venue.nodes.filter(n => n.floorId === floorId).map(n => n.at),
  ];
  const xs = pts.map(p => p.x), zs = pts.map(p => p.z);
  const x0 = (pts.length ? Math.min(...xs) : 0) - MARGIN, z0 = (pts.length ? Math.min(...zs) : 0) - MARGIN;
  const x1 = (pts.length ? Math.max(...xs) : 10) + MARGIN, z1 = (pts.length ? Math.max(...zs) : 10) + MARGIN;
  let cs = CELL;
  while (((x1 - x0) / cs) * ((z1 - z0) / cs) > MAX_CELLS) cs *= 1.25;
  const w = Math.ceil((x1 - x0) / cs) + 1, h = Math.ceil((z1 - z0) / cs) + 1;
  const free = new Uint8Array(w * h).fill(1);
  const cx = (i: number) => x0 + i * cs, cz = (j: number) => z0 + j * cs;

  // Walls (with their doorways already left out) are solid, with clearance.
  for (const s of obstacles(venue, floorId)) {
    const i0 = Math.max(0, Math.floor((Math.min(s.a.x, s.b.x) - CLEAR - x0) / cs)), i1 = Math.min(w - 1, Math.ceil((Math.max(s.a.x, s.b.x) + CLEAR - x0) / cs));
    const j0 = Math.max(0, Math.floor((Math.min(s.a.z, s.b.z) - CLEAR - z0) / cs)), j1 = Math.min(h - 1, Math.ceil((Math.max(s.a.z, s.b.z) + CLEAR - z0) / cs));
    for (let j = j0; j <= j1; j++) for (let i = i0; i <= i1; i++) if (segDist(cx(i), cz(j), s.a, s.b) < CLEAR) free[j * w + i] = 0;
  }
  // Door and arch openings are open all the way through the wall.
  for (const o of venue.openings) {
    if (o.floorId !== floorId || o.kind === 'window' || !o.wallId) continue;
    const d = { x: Math.cos(o.angle), z: Math.sin(o.angle) }, n = { x: -d.z, z: d.x };
    const half = Math.max(0.1, o.width / 2 - 0.12), depth = CLEAR + 0.25;
    const r = Math.hypot(half, depth);
    const i0 = Math.max(0, Math.floor((o.at.x - r - x0) / cs)), i1 = Math.min(w - 1, Math.ceil((o.at.x + r - x0) / cs));
    const j0 = Math.max(0, Math.floor((o.at.z - r - z0) / cs)), j1 = Math.min(h - 1, Math.ceil((o.at.z + r - z0) / cs));
    for (let j = j0; j <= j1; j++) for (let i = i0; i <= i1; i++) {
      const rx = cx(i) - o.at.x, rz = cz(j) - o.at.z;
      if (Math.abs(rx * d.x + rz * d.z) <= half && Math.abs(rx * n.x + rz * n.z) <= depth) free[j * w + i] = 1;
    }
  }
  const g = { x0, z0, cs, w, h, free };
  byFloor.set(floorId, g);
  return g;
}

/**
 * Which open area each free cell is in (8-way, as A* moves), labelled once per grid:
 * two points in different areas have no way between them, so there's nothing to search.
 */
function areas(g: Grid): Int32Array {
  if (g.area) return g.area;
  const area = new Int32Array(g.w * g.h).fill(-1), q = new Int32Array(g.w * g.h);
  let id = 0;
  for (let c0 = 0; c0 < g.w * g.h; c0++) {
    if (!g.free[c0] || area[c0] >= 0) continue;
    let head = 0, tail = 0;
    area[c0] = id; q[tail++] = c0;
    while (head < tail) {
      const c = q[head++], ci = c % g.w, cj = (c - ci) / g.w;
      for (let dj = -1; dj <= 1; dj++) for (let di = -1; di <= 1; di++) {
        const i = ci + di, j = cj + dj;
        if ((!di && !dj) || i < 0 || j < 0 || i >= g.w || j >= g.h) continue;
        const n = j * g.w + i;
        if (!g.free[n] || area[n] >= 0) continue;
        if (di && dj && (!g.free[cj * g.w + i] || !g.free[j * g.w + ci])) continue;
        area[n] = id; q[tail++] = n;
      }
    }
    id++;
  }
  return (g.area = area);
}

/** The free cell nearest a point (within a couple of metres), or -1. */
function snap(g: Grid, p: Vec2): number {
  const ci = Math.round((p.x - g.x0) / g.cs), cj = Math.round((p.z - g.z0) / g.cs);
  const maxR = Math.ceil(2.5 / g.cs);
  for (let r = 0; r <= maxR; r++) {
    let best = -1, bd = Infinity;
    for (let j = cj - r; j <= cj + r; j++) for (let i = ci - r; i <= ci + r; i++) {
      if (Math.max(Math.abs(i - ci), Math.abs(j - cj)) !== r || i < 0 || j < 0 || i >= g.w || j >= g.h || !g.free[j * g.w + i]) continue;
      const d = Math.hypot(g.x0 + i * g.cs - p.x, g.z0 + j * g.cs - p.z);
      if (d < bd) { bd = d; best = j * g.w + i; }
    }
    if (best >= 0) return best;
  }
  return -1;
}

/** Is the straight line a→b clear of walls (sampled on the grid)? */
function clearLine(g: Grid, a: Vec2, b: Vec2): boolean {
  const L = Math.hypot(b.x - a.x, b.z - a.z);
  const n = Math.max(1, Math.ceil(L / (g.cs * 0.5)));
  for (let k = 0; k <= n; k++) {
    const x = a.x + ((b.x - a.x) * k) / n, z = a.z + ((b.z - a.z) * k) / n;
    const i = Math.round((x - g.x0) / g.cs), j = Math.round((z - g.z0) / g.cs);
    if (i < 0 || j < 0 || i >= g.w || j >= g.h || !g.free[j * g.w + i]) return false;
  }
  return true;
}

/**
 * The way a person walks from `from` to `to` on a floor: round walls,
 * through doorways, as straight as it can be. Null when the walls leave no
 * way through (e.g. a room drawn without a door).
 */
export function walkway(venue: IndoorVenue, floorId: string, from: Vec2, to: Vec2): Vec2[] | null {
  const g = gridFor(venue, floorId);
  const s = snap(g, from), e = snap(g, to);
  if (s < 0 || e < 0) return null;
  if (areas(g)[s] !== areas(g)[e]) return null; // walled off from each other
  const at = (c: number): Vec2 => ({ x: g.x0 + (c % g.w) * g.cs, z: g.z0 + Math.floor(c / g.w) * g.cs });
  if (s !== e) {
    // A* over the grid, 8 ways, never cutting a wall's corner.
    const ex = e % g.w, ez = Math.floor(e / g.w);
    const hcost = (c: number) => { const dx = Math.abs((c % g.w) - ex), dz = Math.abs(Math.floor(c / g.w) - ez); return Math.max(dx, dz) + 0.4142 * Math.min(dx, dz); };
    // 64-bit costs: 32-bit rounding re-queues the same cells over and over on big grids.
    const cost = new Float64Array(g.w * g.h).fill(Infinity);
    const done = new Uint8Array(g.w * g.h);
    const prev = new Int32Array(g.w * g.h).fill(-1);
    const heap = new MinHeap();
    cost[s] = 0;
    heap.push(s, hcost(s));
    let found = false;
    while (heap.size) {
      const c = heap.pop();
      if (done[c]) continue;
      done[c] = 1;
      if (c === e) { found = true; break; }
      const ci = c % g.w, cj = Math.floor(c / g.w), cc = cost[c];
      for (let dj = -1; dj <= 1; dj++) for (let di = -1; di <= 1; di++) {
        if (!di && !dj) continue;
        const i = ci + di, j = cj + dj;
        if (i < 0 || j < 0 || i >= g.w || j >= g.h) continue;
        const nIdx = j * g.w + i;
        if (!g.free[nIdx]) continue;
        if (di && dj && (!g.free[cj * g.w + i] || !g.free[j * g.w + ci])) continue;
        const nc = cc + (di && dj ? 1.4142 : 1);
        if (nc < cost[nIdx]) { cost[nIdx] = nc; prev[nIdx] = c; heap.push(nIdx, nc + hcost(nIdx)); }
      }
    }
    if (!found) return null;
    const cells: number[] = [];
    for (let c = e; c !== -1; c = prev[c]) cells.push(c);
    cells.reverse();
    // Pull it straight: from each corner, jump to the furthest cell still in plain sight.
    const raw = cells.map(at);
    const startPt = clearLine(g, from, raw[0]) ? from : raw[0];
    const out: Vec2[] = [startPt];
    let k = 0;
    // Scan forward (not back from the end): a long way would otherwise test every pair.
    while (k < raw.length - 1) {
      let next = k + 1;
      while (next + 1 < raw.length && clearLine(g, out[out.length - 1], raw[next + 1])) next++;
      out.push(raw[next]);
      k = next;
    }
    if (clearLine(g, out[out.length - 1], to)) out.push(to);
    return dedupe(out);
  }
  return dedupe([from, to]);
}

function dedupe(pts: Vec2[]): Vec2[] {
  const out: Vec2[] = [];
  for (const p of pts) { const q = out[out.length - 1]; if (!q || Math.hypot(p.x - q.x, p.z - q.z) > 0.05) out.push(p); }
  return out;
}

class MinHeap {
  private a: number[] = [];
  private p: number[] = [];
  get size() { return this.a.length; }
  push(v: number, pr: number) {
    const a = this.a, p = this.p;
    a.push(v); p.push(pr);
    for (let i = a.length - 1; i > 0;) {
      const j = (i - 1) >> 1;
      if (p[j] <= p[i]) break;
      [a[i], a[j]] = [a[j], a[i]]; [p[i], p[j]] = [p[j], p[i]];
      i = j;
    }
  }
  pop(): number {
    const a = this.a, p = this.p, top = a[0];
    const lv = a.pop()!, lp = p.pop()!;
    if (a.length) {
      a[0] = lv; p[0] = lp;
      for (let i = 0; ;) {
        const l = 2 * i + 1, r = l + 1;
        let m = i;
        if (l < a.length && p[l] < p[m]) m = l;
        if (r < a.length && p[r] < p[m]) m = r;
        if (m === i) break;
        [a[i], a[m]] = [a[m], a[i]]; [p[i], p[m]] = [p[m], p[i]];
        i = m;
      }
    }
    return top;
  }
}
