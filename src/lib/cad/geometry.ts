// 2D plan geometry shared by the CAD import (cleanup, slicing 3D models into
// a plan) and the floor editor's modify tools (trim, extend, split, join,
// offset, area). Everything is in editor plan units (px) unless noted.

export interface Pt { x: number; y: number }
export interface Seg { x1: number; y1: number; x2: number; y2: number }

const EPS = 1e-9;

export const dist = (a: Pt, b: Pt) => Math.hypot(a.x - b.x, a.y - b.y);
export const segA = (s: Seg): Pt => ({ x: s.x1, y: s.y1 });
export const segB = (s: Seg): Pt => ({ x: s.x2, y: s.y2 });
export const segLen = (s: Seg) => Math.hypot(s.x2 - s.x1, s.y2 - s.y1);

/** Parameter t (0..1 within the segment) and point of the closest point on `s` to `p`. */
export function projectOnSegment(p: Pt, s: Seg): { t: number; pt: Pt; d: number } {
  const dx = s.x2 - s.x1, dy = s.y2 - s.y1;
  const len2 = dx * dx + dy * dy;
  const t = len2 < EPS ? 0 : Math.max(0, Math.min(1, ((p.x - s.x1) * dx + (p.y - s.y1) * dy) / len2));
  const pt = { x: s.x1 + t * dx, y: s.y1 + t * dy };
  return { t, pt, d: dist(p, pt) };
}

/**
 * Intersection of the infinite lines through a and b, as parameters along
 * each (ta on a, tb on b); null when parallel.
 */
export function lineIntersection(a: Seg, b: Seg): { ta: number; tb: number; pt: Pt } | null {
  const rx = a.x2 - a.x1, ry = a.y2 - a.y1;
  const sx = b.x2 - b.x1, sy = b.y2 - b.y1;
  const den = rx * sy - ry * sx;
  if (Math.abs(den) < EPS) return null;
  const qx = b.x1 - a.x1, qy = b.y1 - a.y1;
  const ta = (qx * sy - qy * sx) / den;
  const tb = (qx * ry - qy * rx) / den;
  return { ta, tb, pt: { x: a.x1 + ta * rx, y: a.y1 + ta * ry } };
}

/** Points where `s` is crossed by any of `others`, as sorted parameters strictly inside (0,1). */
export function crossings(s: Seg, others: Seg[]): number[] {
  const ts: number[] = [];
  for (const o of others) {
    if (o === s) continue;
    const hit = lineIntersection(s, o);
    if (!hit) continue;
    if (hit.ta > 1e-6 && hit.ta < 1 - 1e-6 && hit.tb >= -1e-6 && hit.tb <= 1 + 1e-6) ts.push(hit.ta);
  }
  return [...new Set(ts.map(t => +t.toFixed(9)))].sort((a, b) => a - b);
}

const at = (s: Seg, t: number): Pt => ({ x: s.x1 + (s.x2 - s.x1) * t, y: s.y1 + (s.y2 - s.y1) * t });
const make = (a: Pt, b: Pt): Seg => ({ x1: a.x, y1: a.y, x2: b.x, y2: b.y });

// ── Modify tools ─────────────────────────────────────────────────────────────

/** Split `s` at the point on it closest to `p`. Returns null if that's an end. */
export function splitAt(s: Seg, p: Pt, minPiece = 1): [Seg, Seg] | null {
  const { pt } = projectOnSegment(p, s);
  if (dist(pt, segA(s)) < minPiece || dist(pt, segB(s)) < minPiece) return null;
  return [make(segA(s), pt), make(pt, segB(s))];
}

/**
 * Trim: remove the piece of `s` between the crossings that surround the
 * clicked point `p` (AutoCAD-style). Returns the pieces that remain (0–2).
 * Returns null when nothing crosses `s` (nothing to trim against).
 */
export function trimAt(s: Seg, p: Pt, cutters: Seg[]): Seg[] | null {
  const ts = crossings(s, cutters);
  if (ts.length === 0) return null;
  const { t } = projectOnSegment(p, s);
  const before = ts.filter(x => x < t).pop();
  const after = ts.find(x => x > t);
  const keep: Seg[] = [];
  if (before !== undefined) keep.push(make(segA(s), at(s, before)));
  if (after !== undefined) keep.push(make(at(s, after), segB(s)));
  return keep;
}

/**
 * Extend the end of `s` nearest `p` until it meets the closest other segment
 * in that direction. Returns null when nothing is hit within `maxReach`.
 */
export function extendTo(s: Seg, p: Pt, targets: Seg[], maxReach = Infinity): Seg | null {
  const fromEnd = dist(p, segB(s)) < dist(p, segA(s)); // extend the B end?
  let best: number | null = null;
  for (const o of targets) {
    if (o === s) continue;
    const hit = lineIntersection(s, o);
    if (!hit || hit.tb < -1e-6 || hit.tb > 1 + 1e-6) continue;
    const beyond = fromEnd ? hit.ta > 1 + 1e-6 : hit.ta < -1e-6;
    if (!beyond) continue;
    const reach = (fromEnd ? hit.ta - 1 : -hit.ta) * segLen(s);
    if (reach > maxReach) continue;
    if (best === null || (fromEnd ? hit.ta < best : hit.ta > best)) best = hit.ta;
  }
  if (best === null) return null;
  return fromEnd ? make(segA(s), at(s, best)) : make(at(s, best), segB(s));
}

/** Parallel copy of `s` at signed distance `d` (positive = left of a→b). */
export function offsetSeg(s: Seg, d: number): Seg {
  const len = segLen(s) || 1;
  const nx = -(s.y2 - s.y1) / len, ny = (s.x2 - s.x1) / len;
  return { x1: s.x1 + nx * d, y1: s.y1 + ny * d, x2: s.x2 + nx * d, y2: s.y2 + ny * d };
}

/** Which side of `s` the point is on: +1 left, -1 right. */
export const sideOf = (s: Seg, p: Pt) => Math.sign((s.x2 - s.x1) * (p.y - s.y1) - (s.y2 - s.y1) * (p.x - s.x1)) || 1;

function collinear(a: Seg, b: Seg, angTol = 0.02, offTol = 0.5): boolean {
  const la = segLen(a), lb = segLen(b);
  if (la < EPS || lb < EPS) return false;
  const cross = ((a.x2 - a.x1) * (b.y2 - b.y1) - (a.y2 - a.y1) * (b.x2 - b.x1)) / (la * lb);
  if (Math.abs(cross) > angTol) return false;
  // b's endpoints must lie on a's line
  const off = (p: Pt) => Math.abs((a.x2 - a.x1) * (p.y - a.y1) - (a.y2 - a.y1) * (p.x - a.x1)) / la;
  return off(segA(b)) < offTol && off(segB(b)) < offTol;
}

/**
 * Join two collinear segments that touch or overlap into one spanning both.
 * Returns null if they aren't collinear or have a gap larger than `gapTol`.
 */
export function joinSegs(a: Seg, b: Seg, gapTol = 1, offTol = 0.5): Seg | null {
  if (!collinear(a, b, 0.02, offTol)) return null;
  const len = segLen(a);
  const ux = (a.x2 - a.x1) / len, uy = (a.y2 - a.y1) / len;
  const proj = (p: Pt) => (p.x - a.x1) * ux + (p.y - a.y1) * uy;
  const [a0, a1] = [0, len];
  const [b0, b1] = [proj(segA(b)), proj(segB(b))].sort((x, y) => x - y);
  if (b0 > a1 + gapTol || b1 < a0 - gapTol) return null;
  const lo = Math.min(a0, b0), hi = Math.max(a1, b1);
  return { x1: a.x1 + ux * lo, y1: a.y1 + uy * lo, x2: a.x1 + ux * hi, y2: a.y1 + uy * hi };
}

/**
 * Repeatedly join collinear touching/overlapping segments. Returns the merged
 * list and how many merges happened. Tolerances are in the segments' units:
 * the defaults suit editor px; pass much smaller ones for metres (a wall's two
 * faces are only ~0.2 m apart and must not be merged into one line).
 */
export function mergeCollinear(segs: Seg[], gapTol = 0.5, offTol = 0.5): { segs: Seg[]; merged: number } {
  const bucket = Math.max(offTol * 4, 1e-3);
  // Bucket by direction + offset so we only compare plausible partners.
  const key = (s: Seg) => {
    let ang = Math.atan2(s.y2 - s.y1, s.x2 - s.x1);
    if (ang < 0) ang += Math.PI;
    if (ang >= Math.PI - 0.01) ang -= Math.PI;
    const len = segLen(s) || 1;
    const off = ((s.x2 - s.x1) * s.y1 - (s.y2 - s.y1) * s.x1) / len; // signed distance of line from origin
    return `${Math.round(ang * 100)}:${Math.round(off / bucket)}`;
  };
  const buckets = new Map<string, Seg[]>();
  for (const s of segs) {
    if (segLen(s) < EPS) continue;
    const k = key(s);
    (buckets.get(k) ?? buckets.set(k, []).get(k)!).push(s);
  }
  const out: Seg[] = [];
  let merged = 0;
  for (const group of buckets.values()) {
    const pool = [...group];
    while (pool.length) {
      let cur = pool.pop()!;
      let changed = true;
      while (changed) {
        changed = false;
        for (let i = pool.length - 1; i >= 0; i--) {
          const j = joinSegs(cur, pool[i], gapTol, offTol);
          if (j) { cur = j; pool.splice(i, 1); merged++; changed = true; }
        }
      }
      out.push(cur);
    }
  }
  return { segs: out, merged };
}

/**
 * Uniform-grid index of segments so "what's near this point" doesn't scan
 * every wall — real plans have thousands, and gap checks ask for every end.
 * Each segment is registered in the cells along its length; a query looks at
 * the point's cell and its neighbours, so anything within `reach` is found.
 */
export class SegIndex {
  private cells = new Map<string, number[]>();
  private size: number;
  constructor(segs: Seg[], reach: number) {
    this.size = Math.max(reach * 2, 1e-6);
    segs.forEach((s, i) => {
      const steps = Math.max(1, Math.ceil(segLen(s) / (this.size / 2)));
      const seen = new Set<string>();
      for (let k = 0; k <= steps; k++) {
        const key = this.key(s.x1 + ((s.x2 - s.x1) * k) / steps, s.y1 + ((s.y2 - s.y1) * k) / steps);
        if (seen.has(key)) continue;
        seen.add(key);
        (this.cells.get(key) ?? this.cells.set(key, []).get(key)!).push(i);
      }
    });
  }
  private key(x: number, y: number) { return `${Math.floor(x / this.size)},${Math.floor(y / this.size)}`; }
  near(p: Pt): number[] {
    const cx = Math.floor(p.x / this.size), cy = Math.floor(p.y / this.size);
    const out = new Set<number>();
    for (let dx = -1; dx <= 1; dx++) for (let dy = -1; dy <= 1; dy++) {
      for (const i of this.cells.get(`${cx + dx},${cy + dy}`) ?? []) out.add(i);
    }
    return [...out];
  }
}

/**
 * Close small gaps between wall ends: an endpoint within `tol` of another
 * endpoint is moved onto it; one within `tol` of another segment's body is
 * moved onto that segment (a T-junction). Returns new segments + count fixed.
 */
export function closeGaps(segs: Seg[], tol: number): { segs: Seg[]; fixed: number } {
  const out = segs.map(s => ({ ...s }));
  let fixed = 0;
  const ends: { i: number; end: 'a' | 'b' }[] = out.flatMap((_, i) => [{ i, end: 'a' as const }, { i, end: 'b' as const }]);
  const get = (e: { i: number; end: 'a' | 'b' }) => (e.end === 'a' ? segA(out[e.i]) : segB(out[e.i]));
  const set = (e: { i: number; end: 'a' | 'b' }, p: Pt) => {
    if (e.end === 'a') { out[e.i].x1 = p.x; out[e.i].y1 = p.y; } else { out[e.i].x2 = p.x; out[e.i].y2 = p.y; }
  };
  const index = new SegIndex(segs, tol);
  for (const e of ends) {
    const p = get(e);
    const near = index.near(p);
    let connected = false;
    let bestEnd: Pt | null = null, bestD = tol;
    for (const j of near) {
      if (j === e.i) continue;
      for (const q of [segA(out[j]), segB(out[j])]) {
        const d = dist(p, q);
        if (d < 1e-6) { connected = true; break; }
        if (d <= bestD) { bestD = d; bestEnd = q; }
      }
      if (connected) break;
    }
    if (connected) continue;
    if (bestEnd) { set(e, bestEnd); fixed++; continue; }
    // T-junction onto another segment's body
    let bestBody: Pt | null = null; bestD = tol;
    for (const j of near) {
      if (j === e.i) continue;
      const pr = projectOnSegment(p, out[j]);
      if (pr.d < 1e-6) { connected = true; break; }
      if (pr.d <= bestD && pr.t > 0 && pr.t < 1) { bestD = pr.d; bestBody = pr.pt; }
    }
    if (!connected && bestBody) { set(e, bestBody); fixed++; }
  }
  return { segs: out, fixed };
}

/** Count wall ends that almost touch something (gap smaller than `tol`) without being joined. */
export function countGaps(segs: Seg[], tol: number): number {
  let gaps = 0;
  const index = new SegIndex(segs, tol);
  for (let i = 0; i < segs.length; i++) {
    for (const p of [segA(segs[i]), segB(segs[i])]) {
      let touching = false, near = false;
      for (const j of index.near(p)) {
        if (touching) break;
        if (j === i) continue;
        const pr = projectOnSegment(p, segs[j]);
        if (pr.d < 1e-6) touching = true;
        else if (pr.d <= tol) near = true;
      }
      if (!touching && near) gaps++;
    }
  }
  return gaps;
}

/** Pairs of collinear segments that overlap (partially drawn on top of each other). */
export function countOverlaps(segs: Seg[]): number {
  let n = 0;
  for (let i = 0; i < segs.length; i++) {
    for (let j = i + 1; j < segs.length; j++) {
      if (!collinear(segs[i], segs[j], 0.01, 0.3)) continue;
      const a = segs[i], len = segLen(a), ux = (a.x2 - a.x1) / len, uy = (a.y2 - a.y1) / len;
      const proj = (p: Pt) => (p.x - a.x1) * ux + (p.y - a.y1) * uy;
      const [b0, b1] = [proj(segA(segs[j])), proj(segB(segs[j]))].sort((x, y) => x - y);
      if (Math.min(len, b1) - Math.max(0, b0) > 0.5) n++;
    }
  }
  return n;
}

// ── Polygons ─────────────────────────────────────────────────────────────────

export function polygonArea(poly: Pt[]): number {
  let a = 0;
  for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) a += (poly[j].x + poly[i].x) * (poly[j].y - poly[i].y);
  return Math.abs(a / 2);
}

export function polygonCentroid(poly: Pt[]): Pt {
  let a = 0, cx = 0, cy = 0;
  for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) {
    const f = poly[j].x * poly[i].y - poly[i].x * poly[j].y;
    a += f; cx += (poly[j].x + poly[i].x) * f; cy += (poly[j].y + poly[i].y) * f;
  }
  if (Math.abs(a) < EPS) {
    const n = poly.length || 1;
    return { x: poly.reduce((s, p) => s + p.x, 0) / n, y: poly.reduce((s, p) => s + p.y, 0) / n };
  }
  return { x: cx / (3 * a), y: cy / (3 * a) };
}

export function pointInPolygon(pt: Pt, poly: Pt[]): boolean {
  let inside = false;
  for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) {
    const xi = poly[i].x, yi = poly[i].y, xj = poly[j].x, yj = poly[j].y;
    if ((yi > pt.y) !== (yj > pt.y) && pt.x < ((xj - xi) * (pt.y - yi)) / (yj - yi) + xi) inside = !inside;
  }
  return inside;
}

export function bbox(pts: Pt[]) {
  const xs = pts.map(p => p.x), ys = pts.map(p => p.y);
  return { minX: Math.min(...xs), minY: Math.min(...ys), maxX: Math.max(...xs), maxY: Math.max(...ys) };
}

/** Chain loose segments into closed loops (e.g. a 3D model sliced into a floor outline). */
export function chainLoops(segs: Seg[], tol = 0.5): Pt[][] {
  const pool = segs.map(s => [segA(s), segB(s)] as [Pt, Pt]);
  const loops: Pt[][] = [];
  while (pool.length) {
    const [a, b] = pool.pop()!;
    const loop = [a, b];
    let grew = true;
    while (grew) {
      grew = false;
      const tail = loop[loop.length - 1];
      for (let i = 0; i < pool.length; i++) {
        const [p, q] = pool[i];
        if (dist(p, tail) <= tol) { loop.push(q); pool.splice(i, 1); grew = true; break; }
        if (dist(q, tail) <= tol) { loop.push(p); pool.splice(i, 1); grew = true; break; }
      }
    }
    if (loop.length >= 4 && dist(loop[0], loop[loop.length - 1]) <= tol) { loop.pop(); loops.push(loop); }
  }
  return loops;
}

// ── Transforms (multi-select move / rotate / scale) ──────────────────────────

export const translatePt = (p: Pt, dx: number, dy: number): Pt => ({ x: p.x + dx, y: p.y + dy });
export function rotatePt(p: Pt, c: Pt, deg: number): Pt {
  const r = (deg * Math.PI) / 180, cos = Math.cos(r), sin = Math.sin(r);
  const x = p.x - c.x, y = p.y - c.y;
  return { x: c.x + x * cos - y * sin, y: c.y + x * sin + y * cos };
}
export const scalePt = (p: Pt, c: Pt, f: number): Pt => ({ x: c.x + (p.x - c.x) * f, y: c.y + (p.y - c.y) * f });

// ── 3D model slicing ─────────────────────────────────────────────────────────

/**
 * Cut a triangle mesh with the horizontal plane y = h (Y-up, metres) and
 * return the cut as plan segments in (x, z). Positions are world-space,
 * 3 floats per vertex; `index` may be null for non-indexed geometry.
 */
export function sliceMesh(positions: ArrayLike<number>, index: ArrayLike<number> | null, h: number, stride = 3): Seg[] {
  const out: Seg[] = [];
  const tri = index ? index.length / 3 : positions.length / stride / 3;
  const v = (i: number) => {
    const k = (index ? index[i] : i) * stride;
    return [positions[k], positions[k + 1], positions[k + 2]] as const;
  };
  for (let t = 0; t < tri; t++) {
    const p = [v(t * 3), v(t * 3 + 1), v(t * 3 + 2)];
    const pts: Pt[] = [];
    for (let e = 0; e < 3; e++) {
      const a = p[e], b = p[(e + 1) % 3];
      const da = a[1] - h, db = b[1] - h;
      if ((da < 0 && db >= 0) || (da >= 0 && db < 0)) {
        const k = da / (da - db);
        pts.push({ x: a[0] + (b[0] - a[0]) * k, y: a[2] + (b[2] - a[2]) * k });
      }
    }
    if (pts.length === 2 && dist(pts[0], pts[1]) > 1e-4) out.push(make(pts[0], pts[1]));
  }
  return out;
}
