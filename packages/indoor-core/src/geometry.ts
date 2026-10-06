// Small 2D helpers on the floor plane (x, z), in metres.

import type { Vec2 } from './model';

export const v = (x: number, z: number): Vec2 => ({ x, z });
export const add = (a: Vec2, b: Vec2): Vec2 => ({ x: a.x + b.x, z: a.z + b.z });
export const sub = (a: Vec2, b: Vec2): Vec2 => ({ x: a.x - b.x, z: a.z - b.z });
export const scale = (a: Vec2, k: number): Vec2 => ({ x: a.x * k, z: a.z * k });
export const dot = (a: Vec2, b: Vec2) => a.x * b.x + a.z * b.z;
/** z-component of the 3D cross product: > 0 when b turns left of a… in a y-down plan it is right. See turnOf(). */
export const cross = (a: Vec2, b: Vec2) => a.x * b.z - a.z * b.x;
export const len = (a: Vec2) => Math.hypot(a.x, a.z);
export const dist = (a: Vec2, b: Vec2) => Math.hypot(a.x - b.x, a.z - b.z);
export const lerp = (a: Vec2, b: Vec2, t: number): Vec2 => ({ x: a.x + (b.x - a.x) * t, z: a.z + (b.z - a.z) * t });
export const norm = (a: Vec2): Vec2 => { const l = len(a); return l > 1e-9 ? { x: a.x / l, z: a.z / l } : { x: 1, z: 0 }; };
export const rot = (a: Vec2, rad: number): Vec2 => { const c = Math.cos(rad), s = Math.sin(rad); return { x: a.x * c - a.z * s, z: a.x * s + a.z * c }; };

/** Closest point on segment ab to p: where (t in 0..1) and how far. */
export function project(p: Vec2, a: Vec2, b: Vec2): { t: number; d: number; at: Vec2 } {
  const ab = sub(b, a), l2 = dot(ab, ab);
  const t = l2 > 0 ? Math.max(0, Math.min(1, dot(sub(p, a), ab) / l2)) : 0;
  const at = lerp(a, b, t);
  return { t, d: dist(p, at), at };
}

/** Do segments ab and cd cross (touching counts)? */
export function segmentsCross(a: Vec2, b: Vec2, c: Vec2, d: Vec2): boolean {
  const o = (p: Vec2, q: Vec2, r: Vec2) => Math.sign(cross(sub(q, p), sub(r, p)));
  const o1 = o(a, b, c), o2 = o(a, b, d), o3 = o(c, d, a), o4 = o(c, d, b);
  if (o1 !== o2 && o3 !== o4) return true;
  const on = (p: Vec2, q: Vec2, r: Vec2) => Math.min(p.x, r.x) - 1e-9 <= q.x && q.x <= Math.max(p.x, r.x) + 1e-9 && Math.min(p.z, r.z) - 1e-9 <= q.z && q.z <= Math.max(p.z, r.z) + 1e-9;
  return (o1 === 0 && on(a, c, b)) || (o2 === 0 && on(a, d, b)) || (o3 === 0 && on(c, a, d)) || (o4 === 0 && on(c, b, d));
}

/** Signed area (positive = counter-clockwise in x/z as drawn with z down… i.e. clockwise on screen). */
export function signedArea(poly: Vec2[]): number {
  let s = 0;
  for (let i = 0; i < poly.length; i++) { const a = poly[i], b = poly[(i + 1) % poly.length]; s += a.x * b.z - b.x * a.z; }
  return s / 2;
}

export function centroid(poly: Vec2[]): Vec2 {
  const A = signedArea(poly);
  if (Math.abs(A) < 1e-9) return scale(poly.reduce(add, v(0, 0)), 1 / Math.max(1, poly.length));
  let x = 0, z = 0;
  for (let i = 0; i < poly.length; i++) { const a = poly[i], b = poly[(i + 1) % poly.length], f = a.x * b.z - b.x * a.z; x += (a.x + b.x) * f; z += (a.z + b.z) * f; }
  return v(x / (6 * A), z / (6 * A));
}

export function pointInPolygon(p: Vec2, poly: Vec2[]): boolean {
  let inside = false;
  for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) {
    const a = poly[i], b = poly[j];
    if ((a.z > p.z) !== (b.z > p.z) && p.x < ((b.x - a.x) * (p.z - a.z)) / (b.z - a.z) + a.x) inside = !inside;
  }
  return inside;
}

/** The four corners of a w×d rectangle centred on c, its depth along dir. */
export function rectCorners(c: Vec2, w: number, d: number, dir: Vec2): Vec2[] {
  const along = scale(dir, d / 2), across = scale(v(-dir.z, dir.x), w / 2);
  return [sub(sub(c, along), across), add(sub(c, along), across), add(add(c, along), across), sub(add(c, along), across)];
}
