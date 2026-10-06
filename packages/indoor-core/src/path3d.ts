// A route as a line in 3D: what the ribbon draws and the camera follows.
// Floor changes climb the actual stairs (on at the bottom step, up the
// slope, off at the top), so the line, the camera and the floor switch all
// agree with what the visitor sees.

import type { EdgeKind, IndoorConnector, IndoorEdge, IndoorVenue, Vec2 } from './model';
import { dist } from './geometry';

export interface Point3 { x: number; y: number; z: number }

/** One stretch of the line: on a floor, or climbing between two. */
export interface PathPiece {
  kind: EdgeKind;
  /** The floor you are on during this stretch (the upper one once off the stairs). */
  floorId: string;
  points: Point3[];
  connectorId: string | null;
}

export interface Path3D {
  pieces: PathPiece[];
  /** Every point in order: the distance walked to reach it, and the floor and kind of the stretch arriving at it. */
  samples: { p: Point3; s: number; floorId: string; kind: EdgeKind }[];
  length: number;
  /** Each path point of the route and how far along the line it is. */
  nodes: { id: string; s: number }[];
}

export function edgeBetween(venue: IndoorVenue, a: string, b: string): IndoorEdge | undefined {
  return venue.edges.find(e => (e.from === a && e.to === b) || (e.from === b && e.to === a));
}

/** The 3D line through a list of path points (node ids). */
export function pathFromNodes(venue: IndoorVenue, nodeIds: string[]): Path3D {
  const node = new Map(venue.nodes.map(n => [n.id, n]));
  const floor = new Map(venue.floors.map(f => [f.id, f]));
  const conn = new Map(venue.connectors.map(c => [c.id, c]));
  const y = (floorId: string) => floor.get(floorId)?.elevation ?? 0;
  const at = (p: Vec2, h: number): Point3 => ({ x: p.x, y: h, z: p.z });

  const pieces: PathPiece[] = [];
  const marks: { id: string; piece: number }[] = nodeIds.length ? [{ id: nodeIds[0], piece: -1 }] : [];
  for (let i = 1; i < nodeIds.length; i++) {
    const a = node.get(nodeIds[i - 1]), b = node.get(nodeIds[i]);
    if (!a || !b) continue;
    const e = edgeBetween(venue, a.id, b.id);
    const c = e?.connectorId ? conn.get(e.connectorId) : undefined;
    if (a.floorId === b.floorId || !c) {
      push(pieces, { kind: e?.kind ?? 'walk', floorId: a.floorId, connectorId: null, points: [at(a.at, y(a.floorId)), at(b.at, y(b.floorId))] });
      marks.push({ id: b.id, piece: pieces.length - 1 });
      continue;
    }
    const up = (floor.get(b.floorId)?.order ?? 0) > (floor.get(a.floorId)?.order ?? 0);
    const [enter, exit] = up ? [c.bottom, c.top] : [c.top, c.bottom];
    const ya = y(a.floorId), yb = y(b.floorId);
    // Walk to the stairs on this floor, climb, step off on the other.
    push(pieces, { kind: 'walk', floorId: a.floorId, connectorId: null, points: [at(a.at, ya), at(enter, ya)] });
    push(pieces, { kind: c.kind, floorId: a.floorId, connectorId: c.id, points: climb(c, enter, exit, ya, yb) });
    push(pieces, { kind: 'walk', floorId: b.floorId, connectorId: null, points: [at(exit, yb), at(b.at, yb)] });
    marks.push({ id: b.id, piece: pieces.length - 1 });
  }

  const samples: Path3D['samples'] = [];
  let s = 0;
  for (const piece of pieces) {
    for (const p of piece.points) {
      const last = samples[samples.length - 1];
      if (last) {
        const d = Math.hypot(p.x - last.p.x, p.y - last.p.y, p.z - last.p.z);
        if (d < 1e-6) continue;
        s += d;
      }
      samples.push({ p, s, floorId: piece.floorId, kind: piece.kind });
    }
  }
  // Where each path point falls along the line: the end of the stretch that reached it.
  const nodes = marks.map(m => {
    const n = node.get(m.id);
    if (!n || m.piece < 0) return { id: m.id, s: 0 };
    const best = locateOnPath({ pieces, samples, length: s, nodes: [] }, n.at, n.floorId);
    return { id: m.id, s: best.s };
  });
  // Keep them in order (a point visited twice keeps its later place).
  for (let i = 1; i < nodes.length; i++) if (nodes[i].s < nodes[i - 1].s) nodes[i].s = nodes[i - 1].s;
  return { pieces, samples, length: s, nodes };
}

/** The point `s` metres along the line, and which way it heads there. */
export function pointAt(path: Path3D, s: number): { p: Point3; dir: Point3; floorId: string; kind: EdgeKind; index: number } {
  const S = path.samples;
  if (!S.length) return { p: { x: 0, y: 0, z: 0 }, dir: { x: 1, y: 0, z: 0 }, floorId: '', kind: 'walk', index: 0 };
  const t = Math.max(0, Math.min(path.length, s));
  let i = 1;
  while (i < S.length - 1 && S[i].s < t) i++;
  const a = S[Math.max(0, i - 1)], b = S[i] ?? a;
  const span = b.s - a.s;
  const k = span > 1e-9 ? (t - a.s) / span : 0;
  const p = { x: a.p.x + (b.p.x - a.p.x) * k, y: a.p.y + (b.p.y - a.p.y) * k, z: a.p.z + (b.p.z - a.p.z) * k };
  const l = Math.hypot(b.p.x - a.p.x, b.p.y - a.p.y, b.p.z - a.p.z) || 1;
  // On a stair, the floor flips to the upper one once past half way.
  // On a climb (stairs with landings, a lift…), the floor flips once you're half way up in height.
  let floorId = b.floorId;
  if (isClimb(b.kind)) {
    let first = i, last = i;
    while (first > 1 && isClimb(S[first - 1].kind)) first--;
    while (last < S.length - 1 && isClimb(S[last + 1].kind)) last++;
    const y0 = S[first - 1].p.y, y1 = S[last].p.y;
    const upper = S[last + 1]?.floorId ?? b.floorId;
    floorId = Math.abs(p.y - y0) > Math.abs(y1 - y0) / 2 ? upper : b.floorId;
  }
  return { p, dir: { x: (b.p.x - a.p.x) / l, y: (b.p.y - a.p.y) / l, z: (b.p.z - a.p.z) / l }, floorId, kind: b.kind, index: i };
}

const isClimb = (k: EdgeKind) => k !== 'walk' && k !== 'door';

/** Nearest point on the line to p (on floor floorId, within a stretch of the line, when given): how far along, and how far off. */
export function locateOnPath(path: Path3D, p: Vec2, floorId?: string, range?: [number, number]): { s: number; off: number } {
  const S = path.samples;
  let best = { s: 0, off: Infinity };
  for (let i = 1; i < S.length; i++) {
    const a = S[i - 1], b = S[i];
    // A stretch belongs to the floor of the sample it arrives at; stairs and lifts join both of theirs.
    if (floorId && b.floorId !== floorId && !(isClimb(b.kind) && (S[i + 1]?.floorId === floorId))) continue;
    if (range && (b.s < range[0] || a.s > range[1])) continue;
    const dx = b.p.x - a.p.x, dz = b.p.z - a.p.z, l2 = dx * dx + dz * dz;
    const t = l2 > 0 ? Math.max(0, Math.min(1, ((p.x - a.p.x) * dx + (p.z - a.p.z) * dz) / l2)) : 0;
    const off = Math.hypot(p.x - (a.p.x + dx * t), p.z - (a.p.z + dz * t));
    if (off < best.off) best = { s: a.s + (b.s - a.s) * t, off };
  }
  return best;
}

function climb(c: IndoorConnector, enter: Vec2, exit: Vec2, ya: number, yb: number): Point3[] {
  if (c.kind === 'elevator') return [{ x: c.center.x, y: ya, z: c.center.z }, { x: c.center.x, y: yb, z: c.center.z }];
  if (c.landing === 'mid' && c.kind === 'stairs') {
    // A flat landing half way: 40% of the run up, 20% flat at half height, 40% up.
    const run = dist(enter, exit), ym = (ya + yb) / 2;
    const at = (f: number, h: number) => ({ x: enter.x + (exit.x - enter.x) * f, y: h, z: enter.z + (exit.z - enter.z) * f });
    return run > 0 ? [at(0, ya), at(0.4, ym), at(0.6, ym), at(1, yb)] : [at(0, ya), at(1, yb)];
  }
  return [{ x: enter.x, y: ya, z: enter.z }, { x: exit.x, y: yb, z: exit.z }];
}

function push(pieces: PathPiece[], piece: PathPiece) {
  const last = pieces[pieces.length - 1];
  if (last && last.kind === piece.kind && last.floorId === piece.floorId && last.connectorId === piece.connectorId) last.points.push(...piece.points.slice(1));
  else pieces.push(piece);
}

/** A route given as points on one floor (metres), for callers without a path graph route. */
export function pathFromPoints(points: Vec2[], floorId: string, elevation = 0): Path3D {
  const pts = points.map(p => ({ x: p.x, y: elevation, z: p.z }));
  const samples: Path3D['samples'] = [];
  let s = 0;
  for (const p of pts) {
    const last = samples[samples.length - 1];
    if (last) { const d = Math.hypot(p.x - last.p.x, p.z - last.p.z); if (d < 1e-6) continue; s += d; }
    samples.push({ p, s, floorId, kind: 'walk' });
  }
  return { pieces: [{ kind: 'walk', floorId, points: pts, connectorId: null }], samples, length: s, nodes: [] };
}
