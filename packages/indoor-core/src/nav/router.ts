// Routing over the path graph: A* on walking time, across floors, with a
// step-free option (lifts and ramps only — no stairs or escalators).
//
// The cost of an edge is the seconds it takes (model.ts: stairs and lifts
// carry their own penalty), and the heuristic is the straight-line 3D
// distance at walking pace — never more than the true time, so A* finds the
// same route Dijkstra would, faster.

import { WALK_SPEED, type IndoorEdge, type IndoorNode, type IndoorVenue, type Vec2 } from '../model';
import { dist } from '../geometry';

export interface RouteOptions {
  /** Only edges usable without steps. */
  stepFree?: boolean;
  /** Edges to leave out (e.g. a closed corridor). */
  avoid?: Set<string>;
}

export interface Route {
  nodeIds: string[];
  edges: IndoorEdge[];
  /** Metres walked. */
  length: number;
  /** Seconds at walking pace, stairs and lifts included. */
  seconds: number;
  /** Floors visited, in order. */
  floors: string[];
  stepFree: boolean;
}

interface Graph { adj: Map<string, { to: string; e: IndoorEdge }[]>; node: Map<string, IndoorNode>; y: Map<string, number> }

const graphs = new WeakMap<IndoorVenue, Graph>();

function graphOf(venue: IndoorVenue): Graph {
  let g = graphs.get(venue);
  if (g) return g;
  const adj = new Map<string, { to: string; e: IndoorEdge }[]>();
  const add = (a: string, b: string, e: IndoorEdge) => (adj.get(a) ?? adj.set(a, []).get(a)!).push({ to: b, e });
  for (const e of venue.edges) { add(e.from, e.to, e); add(e.to, e.from, e); }
  const elev = new Map(venue.floors.map(f => [f.id, f.elevation]));
  g = { adj, node: new Map(venue.nodes.map(n => [n.id, n])), y: new Map(venue.nodes.map(n => [n.id, elev.get(n.floorId) ?? 0])) };
  graphs.set(venue, g);
  return g;
}

/** Fastest route between two path points, or null when none (or none step-free). */
export function findRoute(venue: IndoorVenue, from: string, to: string, opts: RouteOptions = {}): Route | null {
  const g = graphOf(venue);
  const goal = g.node.get(to), start = g.node.get(from);
  if (!goal || !start) return null;
  if (from === to) return { nodeIds: [from], edges: [], length: 0, seconds: 0, floors: [start.floorId], stepFree: true };
  const h = (id: string) => {
    const n = g.node.get(id)!;
    return Math.hypot(n.at.x - goal.at.x, n.at.z - goal.at.z, (g.y.get(id) ?? 0) - (g.y.get(to) ?? 0)) / WALK_SPEED;
  };
  const cost = new Map<string, number>([[from, 0]]);
  const prev = new Map<string, { from: string; e: IndoorEdge }>();
  const open = new Heap();
  open.push(from, h(from));
  const closed = new Set<string>();
  while (open.size) {
    const u = open.pop()!;
    if (u === to) break;
    if (closed.has(u)) continue;
    closed.add(u);
    const cu = cost.get(u)!;
    for (const { to: w, e } of g.adj.get(u) ?? []) {
      if (closed.has(w) || opts.avoid?.has(e.id) || (opts.stepFree && !e.accessible)) continue;
      const c = cu + e.seconds;
      if (c < (cost.get(w) ?? Infinity)) { cost.set(w, c); prev.set(w, { from: u, e }); open.push(w, c + h(w)); }
    }
  }
  if (!prev.has(to)) return null;
  const nodeIds = [to], edges: IndoorEdge[] = [];
  for (let at = to; at !== from;) { const p = prev.get(at)!; edges.unshift(p.e); nodeIds.unshift(p.from); at = p.from; }
  const floors: string[] = [];
  for (const id of nodeIds) { const f = g.node.get(id)!.floorId; if (floors[floors.length - 1] !== f) floors.push(f); }
  return {
    nodeIds, edges, floors,
    length: edges.reduce((s, e) => s + e.length, 0),
    seconds: edges.reduce((s, e) => s + e.seconds, 0),
    stepFree: edges.every(e => e.accessible),
  };
}

/** The path point nearest a spot on a floor (to start a route from where someone is standing). */
export function nearestNode(venue: IndoorVenue, floorId: string, at: Vec2, opts: { connected?: boolean } = {}): IndoorNode | null {
  const g = graphOf(venue);
  let best: IndoorNode | null = null, bd = Infinity;
  for (const n of venue.nodes) {
    if (n.floorId !== floorId) continue;
    if (opts.connected !== false && !(g.adj.get(n.id)?.length)) continue;
    const d = dist(n.at, at);
    if (d < bd) { bd = d; best = n; }
  }
  return best;
}

/** Which path points can't be reached from `from` (for the editor's checks). */
export function unreachable(venue: IndoorVenue, from: string): string[] {
  const g = graphOf(venue);
  const seen = new Set([from]), stack = [from];
  while (stack.length) for (const { to } of g.adj.get(stack.pop()!) ?? []) if (!seen.has(to)) { seen.add(to); stack.push(to); }
  return venue.nodes.filter(n => !seen.has(n.id)).map(n => n.id);
}

/** A small binary min-heap of (id, priority). */
class Heap {
  private a: { id: string; p: number }[] = [];
  get size() { return this.a.length; }
  push(id: string, p: number) {
    const a = this.a;
    a.push({ id, p });
    for (let i = a.length - 1; i > 0;) { const j = (i - 1) >> 1; if (a[j].p <= a[i].p) break; [a[i], a[j]] = [a[j], a[i]]; i = j; }
  }
  pop(): string | undefined {
    const a = this.a;
    if (!a.length) return undefined;
    const top = a[0].id, last = a.pop()!;
    if (a.length) {
      a[0] = last;
      for (let i = 0; ;) {
        const l = 2 * i + 1, r = l + 1;
        let m = i;
        if (l < a.length && a[l].p < a[m].p) m = l;
        if (r < a.length && a[r].p < a[m].p) m = r;
        if (m === i) break;
        [a[i], a[m]] = [a[m], a[i]];
        i = m;
      }
    }
    return top;
  }
}
