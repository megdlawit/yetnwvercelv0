// Visitor routing on a venue's path graph: shortest route (optionally
// step-free), then plain-language turn-by-turn directions with distance and
// walking time. Works across floors: an edge between places on different
// floors is a stair / lift / ramp / escalator connection.
//
// Shared, unchanged, by the web app (src/lib/venue/routing.ts re-exports it)
// and the partner API edge function (Deno) — so it has no imports at all.

export interface RouteNode {
  id: string;
  floorId: string;
  name: string;
  x: number;
  y: number;
  isHallway: boolean;
  floorLevel: number;
  floorName: string;
  /** This place is (part of) a staircase — skipped by step-free routes. */
  stairs?: boolean;
  elevator?: boolean;
}

export type Connection = 'stairs' | 'elevator' | 'ramp' | 'escalator';

export interface RouteEdge {
  id: string;
  fromNodeId: string;
  toNodeId: string;
  weight: number;
  /** What a floor-to-floor edge is, when the editor recorded it. */
  connection?: Connection | null;
  /** False for stairs and escalators. Undefined = unknown (older data). */
  accessible?: boolean;
}

export interface RouteOptions {
  stepFree?: boolean;
  pxPerMeter: number;
  /**
   * Step-free routes also *prefer* paths recorded as accessible (ramps,
   * lifts, level paths) over unknown ones, by making them a little cheaper.
   */
  preferAccessible?: boolean;
  /** Extra metres for passing through a place (e.g. near stairs, a narrow door) — avoided, not forbidden. */
  penalties?: Record<string, number>;
}

/** Changing floor costs extra, so a route doesn't hop floors to save a few metres. */
const FLOOR_CHANGE_COST_M = 15;

export function findRoute(nodes: RouteNode[], edges: RouteEdge[], fromId: string, toId: string, o: RouteOptions): RouteNode[] | null {
  const byId = new Map(nodes.map(n => [n.id, n] as const));
  const blocked = (n: RouteNode) => o.stepFree && n.stairs && n.id !== fromId && n.id !== toId;
  const adj = new Map<string, { to: string; w: number }[]>();
  for (const e of edges) {
    const a = byId.get(e.fromNodeId), b = byId.get(e.toNodeId);
    if (!a || !b || blocked(a) || blocked(b)) continue;
    if (o.stepFree) {
      // The edge's own record wins; older data falls back to what's near its ends.
      if (e.accessible === false) continue;
      if (e.accessible === undefined && a.floorLevel !== b.floorLevel && !(a.elevator && b.elevator)) {
        if (a.stairs || b.stairs || !(a.elevator || b.elevator)) continue;
      }
    }
    let metres = a.floorLevel === b.floorLevel ? Math.hypot(a.x - b.x, a.y - b.y) / o.pxPerMeter : FLOOR_CHANGE_COST_M;
    if (o.stepFree && o.preferAccessible && e.accessible === true) metres *= 0.8;
    const pa = o.penalties?.[a.id] ?? 0, pb = o.penalties?.[b.id] ?? 0;
    (adj.get(a.id) ?? adj.set(a.id, []).get(a.id)!).push({ to: b.id, w: metres + (b.id === toId ? 0 : pb) });
    (adj.get(b.id) ?? adj.set(b.id, []).get(b.id)!).push({ to: a.id, w: metres + (a.id === toId ? 0 : pa) });
  }

  // Dijkstra with a simple binary heap.
  const dist = new Map<string, number>([[fromId, 0]]);
  const prev = new Map<string, string>();
  const heap: [number, string][] = [[0, fromId]];
  const push = (item: [number, string]) => {
    heap.push(item);
    let i = heap.length - 1;
    while (i > 0) { const p = (i - 1) >> 1; if (heap[p][0] <= heap[i][0]) break; [heap[p], heap[i]] = [heap[i], heap[p]]; i = p; }
  };
  const pop = () => {
    const top = heap[0], last = heap.pop()!;
    if (heap.length) {
      heap[0] = last;
      let i = 0;
      for (;;) {
        const l = 2 * i + 1, r = l + 1;
        let m = i;
        if (l < heap.length && heap[l][0] < heap[m][0]) m = l;
        if (r < heap.length && heap[r][0] < heap[m][0]) m = r;
        if (m === i) break;
        [heap[m], heap[i]] = [heap[i], heap[m]]; i = m;
      }
    }
    return top;
  };
  while (heap.length) {
    const [d, id] = pop();
    if (id === toId) break;
    if (d > (dist.get(id) ?? Infinity)) continue;
    for (const { to, w } of adj.get(id) ?? []) {
      const nd = d + w;
      if (nd < (dist.get(to) ?? Infinity)) { dist.set(to, nd); prev.set(to, id); push([nd, to]); }
    }
  }
  if (!dist.has(toId)) return null;
  const path: RouteNode[] = [];
  for (let id: string | undefined = toId; id; id = prev.get(id)) path.unshift(byId.get(id)!);
  return path[0]?.id === fromId ? path : null;
}

export interface Step {
  text: string; metres: number; floorLevel: number;
  icon: 'start' | 'straight' | 'left' | 'right' | 'slight-left' | 'slight-right' | 'floor' | 'arrive';
  /** Index in the route's path where this step ends — live guidance moves on once you're past it. */
  pathIndex: number;
}

/** Turn a route into directions: merge straight stretches, call out turns and floor changes. */
export function directions(path: RouteNode[], pxPerMeter: number, destinationName: string, edges: RouteEdge[] = []): { steps: Step[]; metres: number; minutes: number } {
  const between = (a: string, b: string) => edges.find(e => (e.fromNodeId === a && e.toNodeId === b) || (e.fromNodeId === b && e.toNodeId === a));
  const steps: Step[] = [];
  let total = 0;
  if (path.length === 0) return { steps, metres: 0, minutes: 0 };
  steps.push({ text: `Start at ${path[0].name || 'your location'}`, metres: 0, floorLevel: path[0].floorLevel, icon: 'start', pathIndex: 0 });
  let run = 0;
  let heading: number | null = null;
  const flush = (icon: Step['icon'], text: string, level: number, at: number, after = at) => {
    if (run > 0.5) steps.push({ text: `Walk ${Math.round(run)} m`, metres: run, floorLevel: level, icon: 'straight', pathIndex: at });
    run = 0;
    if (text) steps.push({ text, metres: 0, floorLevel: level, icon, pathIndex: after });
  };
  for (let i = 1; i < path.length; i++) {
    const a = path[i - 1], b = path[i];
    if (a.floorLevel !== b.floorLevel) {
      const kind = between(a.id, b.id)?.connection ?? (a.elevator || b.elevator ? 'elevator' : 'stairs');
      const how = kind === 'elevator' ? 'Take the elevator' : kind === 'ramp' ? 'Take the ramp' : kind === 'escalator' ? 'Take the escalator' : 'Take the stairs';
      flush('floor', `${how} ${b.floorLevel > a.floorLevel ? 'up' : 'down'} to ${b.floorName}`, a.floorLevel, i - 1, i);
      heading = null;
      continue;
    }
    const seg = Math.hypot(b.x - a.x, b.y - a.y) / pxPerMeter;
    if (seg < 0.01) continue;
    const h = Math.atan2(b.y - a.y, b.x - a.x);
    if (heading !== null) {
      // screen coordinates have y down, so a positive angle change is a right turn
      let turn = ((h - heading) * 180) / Math.PI;
      while (turn > 180) turn -= 360;
      while (turn < -180) turn += 360;
      if (Math.abs(turn) >= 30) {
        const sharp = Math.abs(turn) >= 60;
        const right = turn > 0;
        const icon: Step['icon'] = sharp ? (right ? 'right' : 'left') : (right ? 'slight-right' : 'slight-left');
        const at = a.name && !a.isHallway ? ` at ${a.name}` : '';
        flush(icon, `${sharp ? 'Turn' : 'Bear'} ${right ? 'right' : 'left'}${at}`, a.floorLevel, i - 1);
      }
    }
    heading = h;
    run += seg;
    total += seg;
  }
  flush('arrive', `Arrive at ${destinationName}`, path[path.length - 1].floorLevel, path.length - 1);
  // ~1.3 m/s walking pace, plus a minute per floor change
  const floorChanges = steps.filter(s => s.icon === 'floor').length;
  return { steps, metres: total, minutes: Math.max(1, Math.round(total / 1.3 / 60 + floorChanges)) };
}
