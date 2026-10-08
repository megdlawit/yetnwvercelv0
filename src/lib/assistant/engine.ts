// The map assistant's brain: turns one understood request (intent.ts) into
// real changes to the map — rows to add and remove, edits to make — plus a
// human reply, what to highlight, and whether to show a preview first.
//
// Pure: works on a snapshot of the plan, writes nothing. The floor editor
// applies the result (one undo per request) and keeps the conversation going.

import { crossesWall, fromPlan, obstacles, pathsThroughWalls, repairPathsThroughWalls, type PlanRows } from '@ethi/indoor-core';
import { parsePolygon } from '@/lib/venue/features';
import { pointInPolygon, polygonCentroid, type Pt } from '@/lib/cad/geometry';
import { HERE, IT, THIS, addKind, titleCase, type Direction, type MapAction } from './intent';

export const PPM = 40; // the editor's plan pixels per metre

/** Something on the map the conversation is about. */
export interface Thing {
  kind: 'room' | 'place' | 'object';
  id: string;
  name: string;
  at: Pt;
  /** The navigable place for it (a room's place, the place itself, the place at an object). */
  nodeId: string | null;
  floorId: string;
}

export interface MapState {
  floorId: string;
  rows: PlanRows; // every floor, including unsaved-to-state edits
  selection: { nodes: string[]; rooms: string[]; features: string[] };
  /** Where they last clicked on the plan ("here"). */
  click: Pt | null;
  /** The centre of what's on screen. */
  view: Pt;
  /** What the conversation last talked about ("it"). */
  last: Thing | null;
  /** The last change the assistant made, for "remove the path we just made". */
  lastChange: { label: string; edges: string[] } | null;
}

export interface NewNode { id: string; floor_id: string; name: string; x: number; y: number; hallway: boolean }
export interface NewEdge { id: string; from_node: string; to_node: string; weight: number; connection?: 'stairs' | 'elevator' | 'ramp' | 'escalator'; accessible?: boolean }
export interface NewFeature { id: string; floor_id: string; kind: string; x: number; y: number; label: string | null }

/** Row changes, written together as one undoable step. */
export interface Change {
  nodes: NewNode[];
  edges: NewEdge[];
  features: NewFeature[];
  removeEdges: string[];
  removeNodes: string[];
  /** Rooms that get the new place as theirs. */
  roomPlaces: { roomId: string; nodeId: string }[];
}

/** Edits the editor already knows how to make (each its own undo). */
export type Edit =
  | { op: 'move'; thing: Thing; dx: number; dy: number }
  | { op: 'rename'; thing: Thing; name: string }
  | { op: 'remove'; thing: Thing }
  | { op: 'undo' }
  | { op: 'show'; thing: Thing };

export interface Seg2 { a: Pt; b: Pt }
export interface Highlight { route: Seg2[]; removed: Seg2[]; spots: Pt[]; things: string[] }

export interface Chip { label: string; say: string }

export interface Plan {
  /** What the assistant says (before applying, when it's a preview). */
  reply: string;
  /** What it says once a preview is applied. */
  done?: string;
  change?: Change;
  edit?: Edit;
  /** Undo label — human words. */
  label?: string;
  /** Show the change and ask before writing it. */
  confirm?: boolean;
  highlight?: Highlight;
  /** Select this afterwards. */
  select?: { kind: 'nodes' | 'rooms' | 'features'; id: string };
  /** What "it" means from now on. */
  mention?: Thing | null;
  chips?: Chip[];
  /** The optional "Advanced details" lines. */
  details?: string[];
  tone?: 'ok' | 'info' | 'warn';
}

let seq = 0;
export const newId = () => (globalThis.crypto?.randomUUID ? globalThis.crypto.randomUUID() : `a${Date.now().toString(36)}${(seq++).toString(36)}`);
const emptyChange = (): Change => ({ nodes: [], edges: [], features: [], removeEdges: [], removeNodes: [], roomPlaces: [] });
const isEmpty = (c: Change) => !c.nodes.length && !c.edges.length && !c.features.length && !c.removeEdges.length && !c.removeNodes.length && !c.roomPlaces.length;
const d = (a: Pt, b: Pt) => Math.hypot(a.x - b.x, a.y - b.y);
const round = (p: Pt) => ({ x: Math.round(p.x), y: Math.round(p.y) });

// ── The map, as the assistant sees it ───────────────────────────────────────

const FEATURE_WORDS: Record<string, string[]> = {
  elevator: ['elevator', 'lift'], stairs: ['stairs', 'staircase', 'stairway', 'steps'], entrance: ['entrance', 'entry', 'way in', 'main entrance', 'exit'],
  door: ['door', 'doorway'], escalator: ['escalator'], ramp: ['ramp'], tree: ['tree'], bench: ['bench'], fountain: ['fountain'], restroom: ['restroom', 'toilet', 'wc', 'bathroom'],
};
const norm = (s: string) => s.toLowerCase().normalize('NFKD').replace(/[̀-ͯ]/g, '').replace(/[^a-z0-9ሀ-፿]+/g, ' ').replace(/^(the|a|an) /, '').trim();
const tokens = (s: string) => norm(s).split(' ').filter(Boolean);

function lev(a: string, b: string) {
  if (Math.abs(a.length - b.length) > 2) return 3;
  const dp = Array.from({ length: b.length + 1 }, (_, i) => i);
  for (let i = 1; i <= a.length; i++) {
    let prev = dp[0]; dp[0] = i;
    for (let j = 1; j <= b.length; j++) { const t = dp[j]; dp[j] = Math.min(dp[j] + 1, dp[j - 1] + 1, prev + (a[i - 1] === b[j - 1] ? 0 : 1)); prev = t; }
  }
  return dp[b.length];
}

export class MapView {
  readonly rows: PlanRows;
  readonly floorId: string;
  readonly adj = new Map<string, string[]>();
  readonly nodeAt = new Map<string, { x: number; y: number; floor: string; name: string; hallway: boolean }>();
  constructor(rows: PlanRows, floorId: string) {
    this.rows = rows; this.floorId = floorId;
    for (const n of rows.nodes) { this.nodeAt.set(n.id, { x: n.x, y: n.y, floor: n.floor_id, name: n.name ?? '', hallway: !!n.is_hallway }); this.adj.set(n.id, []); }
    for (const e of rows.edges) {
      if (!this.adj.has(e.from_node) || !this.adj.has(e.to_node)) continue;
      this.adj.get(e.from_node)!.push(e.to_node); this.adj.get(e.to_node)!.push(e.from_node);
    }
  }
  roomOutline(r: PlanRows['rooms'][number]): Pt[] {
    return parsePolygon(r.polygon) ?? [{ x: r.x, y: r.y }, { x: r.x + r.width, y: r.y }, { x: r.x + r.width, y: r.y + r.height }, { x: r.x, y: r.y + r.height }];
  }
  /** Everything with a name or a kind, as things the conversation can be about. */
  things(floor?: string): Thing[] {
    const out: Thing[] = [];
    const roomNode = new Set<string>();
    for (const r of this.rows.rooms) {
      if (floor && r.floor_id !== floor) continue;
      const at = r.node_id && this.nodeAt.get(r.node_id) ? this.nodeAt.get(r.node_id)! : polygonCentroid(this.roomOutline(r));
      out.push({ kind: 'room', id: r.id, name: r.name || titleCase(r.type ?? 'room'), at: { x: at.x, y: at.y }, nodeId: r.node_id && this.nodeAt.has(r.node_id) ? r.node_id : null, floorId: r.floor_id });
      if (r.node_id) roomNode.add(r.node_id);
    }
    for (const n of this.rows.nodes) {
      if ((floor && n.floor_id !== floor) || n.is_hallway || roomNode.has(n.id) || !n.name) continue;
      out.push({ kind: 'place', id: n.id, name: n.name, at: { x: n.x, y: n.y }, nodeId: n.id, floorId: n.floor_id });
    }
    for (const f of this.rows.map_features) {
      if (floor && f.floor_id !== floor) continue;
      const near = this.nearestNode({ x: f.x, y: f.y }, f.floor_id, 1.6 * PPM, true);
      out.push({ kind: 'object', id: f.id, name: f.label || titleCase(f.kind), at: { x: f.x, y: f.y }, nodeId: near, floorId: f.floor_id });
    }
    return out;
  }
  nearestNode(p: Pt, floor: string, within = Infinity, named = false): string | null {
    let best: string | null = null, bd = within;
    for (const n of this.rows.nodes) {
      if (n.floor_id !== floor || (named && n.is_hallway)) continue;
      const dd = d(p, n);
      if (dd < bd) { bd = dd; best = n.id; }
    }
    return best;
  }
  /** The connected group of places a place belongs to (all floors). */
  component(id: string): Set<string> {
    const seen = new Set([id]); const stack = [id];
    while (stack.length) for (const m of this.adj.get(stack.pop()!) ?? []) if (!seen.has(m)) { seen.add(m); stack.push(m); }
    return seen;
  }
  /** Groups of connected places on a floor, biggest first (lone places excluded). */
  networks(floor: string): string[][] {
    const seen = new Set<string>(); const out: string[][] = [];
    for (const n of this.rows.nodes) {
      if (n.floor_id !== floor || seen.has(n.id) || !(this.adj.get(n.id)?.length)) continue;
      const comp = [...this.component(n.id)].filter(id => this.nodeAt.get(id)?.floor === floor);
      comp.forEach(id => seen.add(id)); out.push(comp);
    }
    return out.sort((a, b) => b.length - a.length);
  }
  /** Shortest hop route between two places, as node ids. */
  route(a: string, b: string): string[] | null {
    const prev = new Map<string, string>([[a, a]]); const q = [a];
    for (let i = 0; i < q.length; i++) {
      const id = q[i]; if (id === b) break;
      for (const m of this.adj.get(id) ?? []) if (!prev.has(m)) { prev.set(m, id); q.push(m); }
    }
    if (!prev.has(b)) return null;
    const out = [b]; while (out[out.length - 1] !== a) out.push(prev.get(out[out.length - 1])!);
    return out.reverse();
  }
  segs(ids: string[]): Seg2[] {
    const out: Seg2[] = [];
    for (let i = 1; i < ids.length; i++) {
      const a = this.nodeAt.get(ids[i - 1]), b = this.nodeAt.get(ids[i]);
      if (a && b && a.floor === this.floorId && b.floor === this.floorId) out.push({ a: { x: a.x, y: a.y }, b: { x: b.x, y: b.y } });
    }
    return out;
  }
  edgeSeg(e: { from_node: string; to_node: string }): Seg2 | null {
    const a = this.nodeAt.get(e.from_node), b = this.nodeAt.get(e.to_node);
    return a && b ? { a: { x: a.x, y: a.y }, b: { x: b.x, y: b.y } } : null;
  }
  floorName(id: string) { return this.rows.floors.find(f => f.id === id)?.name ?? 'the other floor'; }
}

/** Finds what a word means on this map: "Room 1", "the café", "elevator", "this", "it". */
export function resolve(word: string, s: MapState, view = new MapView(s.rows, s.floorId)): Thing | null {
  if (word === THIS) return selected(s, view) ?? s.last;
  if (word === IT) return s.last ?? selected(s, view);
  if (word === HERE) return null;
  const q = norm(word);
  if (!q) return null;
  const qt = q.split(' ');
  const kindWords = Object.entries(FEATURE_WORDS).filter(([, ws]) => ws.includes(q)).map(([k]) => k);
  let best: Thing | null = null, bs = 0;
  const from = s.click ?? s.view;
  for (const t of view.things()) {
    const n = norm(t.name);
    const nt = n.split(' ');
    const room = t.kind === 'room' ? view.rows.rooms.find(r => r.id === t.id) : null;
    const feat = t.kind === 'object' ? view.rows.map_features.find(f => f.id === t.id) : null;
    let sc = 0;
    if (n === q) sc = 100;
    else if (qt.every(w => nt.includes(w))) sc = 80 - (nt.length - qt.length);
    else if (qt.length === 1 && nt.some(w => w.startsWith(q) && q.length >= 3)) sc = 62;
    else if (kindWords.length && ((room?.type && kindWords.includes(room.type)) || (feat && kindWords.includes(feat.kind)))) sc = 55;
    else if (q.length >= 5 && lev(n, q) <= 2) sc = 45;
    else if (qt.length > 1 && qt.filter(w => nt.includes(w)).length >= qt.length - 1 && !qt.some(w => /^\d+$/.test(w) && !nt.includes(w))) sc = 40;
    if (!sc) continue;
    if (t.floorId === s.floorId) sc += 8;
    if (t.kind === 'room') sc += 1; // a room's own place has the same name
    sc -= Math.min(4, d(t.at, from) / (25 * PPM));
    if (sc > bs) { bs = sc; best = t; }
  }
  return best;
}

function selected(s: MapState, view: MapView): Thing | null {
  const all = view.things();
  const id = s.selection.rooms[0] ?? s.selection.features[0] ?? null;
  if (id) return all.find(t => t.id === id) ?? null;
  const nid = s.selection.nodes[0];
  if (!nid) return null;
  const hit = all.find(t => t.nodeId === nid && t.kind !== 'object');
  if (hit) return hit;
  const n = view.nodeAt.get(nid);
  return n ? { kind: 'place', id: nid, name: n.name || 'this point', at: { x: n.x, y: n.y }, nodeId: nid, floorId: n.floor } : null;
}

// ── Making connections that respect walls ───────────────────────────────────

/** The plan with a change applied (for routing what comes next). */
export function withChange(rows: PlanRows, c: Change): PlanRows {
  const goneE = new Set(c.removeEdges), goneN = new Set(c.removeNodes);
  return {
    ...rows,
    nodes: [...rows.nodes.filter(n => !goneN.has(n.id)), ...c.nodes.map(n => ({ id: n.id, floor_id: n.floor_id, name: n.name, x: n.x, y: n.y, is_hallway: n.hallway }))],
    edges: [...rows.edges.filter(e => !goneE.has(e.id)), ...c.edges.map(e => ({ id: e.id, from_node: e.from_node, to_node: e.to_node, connection: e.connection ?? null }))],
    map_features: [...rows.map_features, ...c.features],
    rooms: rows.rooms.map(r => { const l = c.roomPlaces.find(x => x.roomId === r.id); return l ? { ...r, node_id: l.nodeId } : r; }),
  };
}

/**
 * A walkable link from place `a` to the nearest of `targets` (same floor):
 * a straight path if nothing is in the way, otherwise round the walls and
 * through a doorway. Null when every way is blocked by walls.
 */
export function linkWalkable(rows: PlanRows, a: string, targets: string[], floorId: string): { nodes: NewNode[]; edges: NewEdge[]; length: number; viaDoor: boolean } | null {
  const at = new Map(rows.nodes.map(n => [n.id, n]));
  const A = at.get(a);
  if (!A) return null;
  const cands = targets.map(t => at.get(t)).filter((n): n is NonNullable<typeof n> => !!n && n.floor_id === floorId && n.id !== a)
    .sort((x, y) => d(A, x) - d(A, y)).slice(0, 40);
  if (!cands.length) return null;
  const venue = fromPlan(rows, { pxPerMeter: PPM });
  const lines = obstacles(venue, floorId);
  const m = (n: { x: number; y: number }) => ({ x: n.x / PPM, z: n.y / PPM });
  // A clear straight line to one of the nearest few: done.
  for (const b of cands.slice(0, 12)) {
    if (d(A, b) > d(A, cands[0]) * 2.5 + 2 * PPM) break;
    if (!crossesWall(lines, m(A), m(b))) return { nodes: [], edges: [{ id: newId(), from_node: a, to_node: b.id, weight: Math.round(d(A, b)) }], length: d(A, b), viaDoor: false };
  }
  // Otherwise round the walls, through doorways: try the nearest few, keep the shortest.
  let best: { nodes: NewNode[]; edges: NewEdge[]; length: number; viaDoor: boolean } | null = null;
  for (const b of cands.slice(0, 5)) {
    const tmp = newId();
    const fix = repairPathsThroughWalls({ ...rows, edges: [...rows.edges, { id: tmp, from_node: a, to_node: b.id }] }, { pxPerMeter: PPM, newId, edgeIds: [tmp] });
    if (fix.dropped.length || !fix.rerouted.length) continue;
    const length = fix.edges.reduce((s, e) => s + e.weight, 0);
    if (!best || length < best.length) {
      best = { nodes: fix.nodes.map(n => ({ id: n.id, floor_id: n.floor_id, name: '', x: Math.round(n.x), y: Math.round(n.y), hallway: true })), edges: fix.edges.map(e => ({ id: e.id, from_node: e.from_node, to_node: e.to_node, weight: Math.round(e.weight) })), length, viaDoor: true };
    }
  }
  return best;
}

/** Makes sure a thing has a navigable place (a room drawn without one gets one). */
function placeFor(t: Thing, c: Change): string {
  if (t.nodeId) return t.nodeId;
  const id = newId();
  c.nodes.push({ id, floor_id: t.floorId, name: t.kind === 'object' ? '' : t.name, x: Math.round(t.at.x), y: Math.round(t.at.y), hallway: t.kind === 'object' });
  if (t.kind === 'room') c.roomPlaces.push({ roomId: t.id, nodeId: id });
  return id;
}

// ── Answering ───────────────────────────────────────────────────────────────

const ask = (reply: string, chips?: Chip[]): Plan => ({ reply, tone: 'info', chips });
const notFound = (word: string, s: MapState): Plan =>
  word === THIS || word === IT
    ? ask('Select something on the map first (click it), then ask me again.')
    : ask(`I couldn't find "${word}" on this floor. Check the name, or click it on the map and say "this".`, suggestions(s));

const STEP: Record<Direction, Pt> = { left: { x: -1, y: 0 }, right: { x: 1, y: 0 }, up: { x: 0, y: -1 }, down: { x: 0, y: 1 } };

export function plan(action: MapAction, s: MapState): Plan {
  const view = new MapView(s.rows, s.floorId);
  switch (action.op) {
    case 'undo': return { reply: 'Undone.', edit: { op: 'undo' }, tone: 'ok' };
    case 'health': return healthPlan(s, view);
    case 'fix_all': return fixAll(s);
    case 'show': {
      const t = resolve(action.target, s, view);
      if (!t) return notFound(action.target, s);
      return { reply: `Here's ${t.name}.`, edit: { op: 'show', thing: t }, mention: t, highlight: { route: [], removed: [], spots: [t.at], things: [t.id] } };
    }
    case 'connect': return connect(action.from, action.to, s, view);
    case 'walkable': return walkable(action.target, s, view);
    case 'disconnect': return disconnect(action.a, action.b ?? null, s, view);
    case 'block': return block(action.target, s, view);
    case 'add': return add(action, s, view);
    case 'move': {
      const t = resolve(action.target, s, view);
      if (!t) return notFound(action.target, s);
      let to: Pt | null = null;
      if (action.near === HERE) to = s.click;
      else if (action.near) {
        const n = resolve(action.near, s, view);
        if (!n) return notFound(action.near, s);
        const k = d(t.at, n.at) || 1;
        const gap = Math.min(1.5 * PPM, k * 0.5);
        to = { x: n.at.x + ((t.at.x - n.at.x) / k) * gap, y: n.at.y + ((t.at.y - n.at.y) / k) * gap };
      } else if (action.direction) {
        const step = (action.amount === 'lot' ? 3 : action.amount === 'little' ? 0.5 : 1) * PPM;
        to = { x: t.at.x + STEP[action.direction].x * step, y: t.at.y + STEP[action.direction].y * step };
      }
      if (!to) return ask(`Click where ${t.name} should go, then say "move it here".`);
      return { reply: `Moved ${t.name}.`, edit: { op: 'move', thing: t, dx: Math.round(to.x - t.at.x), dy: Math.round(to.y - t.at.y) }, mention: t, tone: 'ok', highlight: { route: [], removed: [], spots: [to], things: [t.id] } };
    }
    case 'rename': {
      const t = resolve(action.target, s, view);
      if (!t) return notFound(action.target, s);
      return { reply: `Renamed to ${action.name}.`, edit: { op: 'rename', thing: t, name: action.name }, mention: { ...t, name: action.name }, tone: 'ok' };
    }
    case 'remove': {
      if (/^(path|connection|route|link)s?$/.test(action.target)) return disconnect(THIS, null, s, view);
      const t = resolve(action.target, s, view);
      if (!t) return notFound(action.target, s);
      return { reply: `Removed ${t.name}.`, edit: { op: 'remove', thing: t }, mention: null, tone: 'ok', label: `Remove ${t.name}` };
    }
    case 'connect_floors': return connectFloors(action.via ?? null, action.floor ?? null, s, view);
    case 'accessible': return accessible(s, view);
  }
}

function connect(fromW: string, toW: string, s: MapState, view: MapView): Plan {
  const A = resolve(fromW, s, view), B = resolve(toW, s, view);
  if (!A) return notFound(fromW, s);
  if (!B) return notFound(toW, s);
  if (A.id === B.id) return ask(`That's the same place twice — which other place should ${A.name} connect to?`);
  if (A.floorId !== B.floorId) {
    return ask(`${A.name} and ${B.name} are on different floors. Floors connect through stairs or an elevator.`, [{ label: 'Connect floors via the elevator', say: 'Connect the floors via the elevator' }]);
  }
  const c = emptyChange();
  const a = placeFor(A, c), b = placeFor(B, c);
  let rows = withChange(s.rows, c);
  let v = new MapView(rows, s.floorId);
  const already = v.route(a, b);
  if (already && isEmpty(c)) {
    return { reply: `${A.name} and ${B.name} are already connected — here's the walking route.`, highlight: { route: v.segs(already), removed: [], spots: [], things: [A.id, B.id] }, mention: B, tone: 'ok' };
  }
  // Reuse what's there: link A's group of paths to B's at their closest walkable points.
  const groupA = [...v.component(a)].filter(id => v.nodeAt.get(id)?.floor === s.floorId);
  const groupB = [...v.component(b)].filter(id => v.nodeAt.get(id)?.floor === s.floorId);
  let link: ReturnType<typeof linkWalkable> = null;
  if (!already) {
    // Try from each end of A's group that's nearest B's group.
    const at = (id: string) => v.nodeAt.get(id)!;
    const pairs = groupA.map(x => ({ x, dd: Math.min(...groupB.map(y => d(at(x), at(y)))) })).sort((p, q) => p.dd - q.dd).slice(0, 3);
    for (const p of pairs) {
      const l = linkWalkable(rows, p.x, groupB, s.floorId);
      if (l && (!link || l.length < link.length)) link = l;
      if (l && !l.viaDoor) break;
    }
    if (!link) {
      return {
        reply: `I couldn't find a way from ${A.name} to ${B.name} that doesn't go through a wall. Is there a door between them? Click where it is and say "add a door here", then ask me again.`,
        tone: 'warn', mention: B, highlight: { route: [], removed: [], spots: [A.at, B.at], things: [A.id, B.id] },
        chips: [{ label: 'Add a door here', say: 'Add a door here' }],
      };
    }
    c.nodes.push(...link.nodes); c.edges.push(...link.edges);
    rows = withChange(s.rows, c);
    v = new MapView(rows, s.floorId);
  }
  const route = v.route(a, b) ?? [];
  return {
    reply: `Here's the walking route I'll add between ${A.name} and ${B.name}${link?.viaDoor ? ', through the doorway' : ''}.`,
    done: `Done — ${A.name} is now connected to ${B.name}.`,
    change: c, confirm: true, label: `Connect ${A.name} and ${B.name}`, mention: B, tone: 'ok',
    highlight: { route: v.segs(route), removed: [], spots: [], things: [A.id, B.id] },
    details: [`${c.edges.length} new path segment${c.edges.length === 1 ? '' : 's'}, ${c.nodes.filter(n => n.hallway).length} turning point${c.nodes.filter(n => n.hallway).length === 1 ? '' : 's'}`, `Route: ${route.length} stops, ${(routeLength(v, route) / PPM).toFixed(1)} m`],
  };
}

const routeLength = (v: MapView, ids: string[]) => v.segs(ids).reduce((sum, sg) => sum + d(sg.a, sg.b), 0);

/** Joins a place (or a new walkway point "here") to the floor's main walking network. */
function walkable(word: string, s: MapState, view: MapView): Plan {
  const c = emptyChange();
  let name: string, a: string, at: Pt;
  if (word === HERE) {
    if (!s.click) return ask('Click the spot on the map that should be walkable, then ask me again.');
    a = newId(); at = round(s.click); name = 'this spot';
    c.nodes.push({ id: a, floor_id: s.floorId, name: '', ...at, hallway: true });
  } else {
    const t = resolve(word, s, view);
    if (!t) return notFound(word, s);
    a = placeFor(t, c); name = t.name; at = t.at;
  }
  const rows = withChange(s.rows, c);
  const v = new MapView(rows, s.floorId);
  const main = v.networks(s.floorId)[0];
  if (!main) return ask(`There are no walking paths on this floor yet. Try "connect ${name} to" another place.`);
  if (main.includes(a)) return { reply: `${titleCase(name)} is already walkable — visitors can reach it.`, tone: 'ok', highlight: { route: [], removed: [], spots: [at], things: [] } };
  const link = linkWalkable(rows, a, main, s.floorId);
  if (!link) return { reply: `Walls are in the way of ${name} on every side. Add a doorway first (click it and say "add a door here").`, tone: 'warn', chips: [{ label: 'Add a door here', say: 'Add a door here' }] };
  c.nodes.push(...link.nodes); c.edges.push(...link.edges);
  const v2 = new MapView(withChange(s.rows, c), s.floorId);
  const seg = c.edges.map(e => v2.edgeSeg(e)).filter((x): x is Seg2 => !!x);
  return {
    reply: `I'll join ${name} to the walking paths${link.viaDoor ? ' through the doorway' : ''}.`, done: `Done — ${name} is walkable now.`,
    change: c, label: `Make ${name} walkable`, tone: 'ok', highlight: { route: seg, removed: [], spots: [], things: [] },
  };
}

function disconnect(aW: string, bW: string | null, s: MapState, view: MapView): Plan {
  // "this path is wrong" right after the assistant made one → take that one back.
  if ((aW === IT || aW === THIS) && !bW && s.lastChange?.edges.length && !s.selection.nodes.length && !s.selection.rooms.length) {
    return { reply: 'Taken back.', edit: { op: 'undo' }, tone: 'ok' };
  }
  const A = resolve(aW, s, view);
  if (!A) return notFound(aW, s);
  const a = A.nodeId;
  if (!a) return ask(`${A.name} has no paths yet.`);
  const edgesOf = (id: string) => s.rows.edges.filter(e => e.from_node === id || e.to_node === id);
  let gone: string[] = [];
  let goneNodes: string[] = [];
  let what: string;
  if (bW) {
    const B = resolve(bW, s, view);
    if (!B) return notFound(bW, s);
    const b = B.nodeId;
    if (!b) return ask(`${B.name} has no paths yet.`);
    gone = s.rows.edges.filter(e => (e.from_node === a && e.to_node === b) || (e.from_node === b && e.to_node === a)).map(e => e.id);
    if (!gone.length) {
      // A path of its own through turning points (hallway points only it uses).
      const chain = soloChain(view, a, b);
      if (chain) { gone = chain.edges; goneNodes = chain.nodes; }
    }
    if (!gone.length) {
      const r = view.route(a, b);
      return r
        ? { reply: `${A.name} and ${B.name} are connected through the shared hallway, not by a path of their own — removing it would cut off other places. Select the stretch that's wrong and say "remove this path".`, tone: 'info', highlight: { route: view.segs(r), removed: [], spots: [], things: [] } }
        : { reply: `${A.name} and ${B.name} aren't connected.`, tone: 'info' };
    }
    what = `the path between ${A.name} and ${B.name}`;
  } else {
    gone = edgesOf(a).map(e => e.id);
    if (!gone.length) return ask(`${A.name} has no paths to remove.`);
    what = `${A.name}'s paths`;
  }
  const removed = s.rows.edges.filter(e => gone.includes(e.id)).map(e => view.edgeSeg(e)).filter((x): x is Seg2 => !!x);
  const c = emptyChange(); c.removeEdges = gone; c.removeNodes = goneNodes;
  const cut = cutOff(s, c);
  return {
    reply: `This will remove ${what} (shown in red).${cut.length ? ` ${listNames(cut)} would then be unreachable.` : ''}`,
    done: `Removed ${what}.`, change: c, confirm: true, label: `Remove ${what}`, tone: cut.length ? 'warn' : 'info', mention: A,
    highlight: { route: [], removed, spots: [], things: [] },
  };
}

/** A run of hallway points used only by the path from a to b. */
function soloChain(v: MapView, a: string, b: string): { edges: string[]; nodes: string[] } | null {
  for (const first of v.adj.get(a) ?? []) {
    const nodes: string[] = []; let prev = a, cur = first;
    while (cur !== b && v.nodeAt.get(cur)?.hallway && (v.adj.get(cur)?.length ?? 0) === 2 && nodes.length < 50) {
      nodes.push(cur); const nx = v.adj.get(cur)!.find(x => x !== prev)!; prev = cur; cur = nx;
    }
    if (cur !== b) continue;
    const chain = [a, ...nodes, b];
    const edges = chain.slice(1).map((id, i) => v.rows.edges.find(e => (e.from_node === chain[i] && e.to_node === id) || (e.to_node === chain[i] && e.from_node === id))!.id);
    return { edges, nodes };
  }
  return null;
}

/** Named places a change would leave with no way to reach the floor's main walking network. */
function cutOff(s: MapState, c: Change): string[] {
  const before = new MapView(s.rows, s.floorId), after = new MapView(withChange(s.rows, c), s.floorId);
  const mainBefore = new Set(before.networks(s.floorId)[0] ?? []);
  const mainAfter = new Set(after.networks(s.floorId)[0] ?? []);
  return s.rows.nodes.filter(n => n.floor_id === s.floorId && !n.is_hallway && n.name && mainBefore.has(n.id) && !mainAfter.has(n.id)).map(n => n.name!);
}
const listNames = (ns: string[]) => ns.length <= 3 ? ns.join(', ').replace(/, ([^,]*)$/, ' and $1') : `${ns.slice(0, 2).join(', ')} and ${ns.length - 2} more`;

function block(word: string, s: MapState, view: MapView): Plan {
  const t = resolve(word, s, view);
  if (!t) return notFound(word, s);
  const room = t.kind === 'room' ? s.rows.rooms.find(r => r.id === t.id)
    : s.rows.rooms.filter(r => r.floor_id === s.floorId && pointInPolygon(t.at, view.roomOutline(r)))[0];
  if (!room) return disconnect(word, null, s, view);
  const poly = view.roomOutline(room);
  const own = room.node_id ?? '';
  const through = s.rows.edges.filter(e => {
    if (e.from_node === own || e.to_node === own) return false;
    const sg = view.edgeSeg(e);
    if (!sg || view.nodeAt.get(e.from_node)?.floor !== s.floorId) return false;
    const L = d(sg.a, sg.b), n = Math.max(2, Math.ceil(L / (0.25 * PPM)));
    for (let i = 1; i < n; i++) {
      const p = { x: sg.a.x + ((sg.b.x - sg.a.x) * i) / n, y: sg.a.y + ((sg.b.y - sg.a.y) * i) / n };
      if (pointInPolygon(p, poly)) return true;
    }
    return false;
  });
  const name = room.name || t.name;
  if (!through.length) return { reply: `No walking paths go through ${name}.`, tone: 'ok' };
  const c = emptyChange(); c.removeEdges = through.map(e => e.id);
  const cut = cutOff(s, c);
  return {
    reply: `${through.length} path${through.length === 1 ? ' goes' : 's go'} through ${name} (shown in red). I'll remove ${through.length === 1 ? 'it' : 'them'}.${cut.length ? ` ${listNames(cut)} would then need another way in — say "fix everything" after.` : ''}`,
    done: `Done — no more walking through ${name}.`, change: c, confirm: true, label: `No paths through ${name}`, tone: cut.length ? 'warn' : 'info',
    highlight: { route: [], removed: through.map(e => view.edgeSeg(e)!).filter(Boolean), spots: [], things: [] }, mention: t,
  };
}

function add(action: Extract<MapAction, { op: 'add' }>, s: MapState, view: MapView): Plan {
  const kind = addKind(action.what, action.name);
  // Where: here (last click), next to something, or what's selected / on screen.
  let at: Pt | null = null, near: Thing | null = null;
  if (action.near === HERE) at = s.click ?? selected(s, view)?.at ?? null;
  else if (action.near) {
    near = resolve(action.near, s, view);
    if (!near) return notFound(action.near, s);
    at = besideThing(near, action.side ?? null, s, view);
  } else at = s.click ?? selected(s, view)?.at ?? s.view;
  if (!at) return ask(`Click where it should go, then say "add a ${action.what} here".`);
  at = round(at);
  const c = emptyChange();
  const label = kind.type === 'feature' ? kind.name : kind.name;
  const taken = new Set(view.things(s.floorId).map(t => norm(t.name)));
  let name = label;
  for (let i = 2; taken.has(norm(name)) && kind.type !== 'feature'; i++) name = `${label} ${i}`;
  let nodeId: string | null = null, featureId: string | null = null;
  const walkTo = kind.type === 'place' || kind.type === 'entrance' || (kind.type === 'feature' && ['elevator', 'stairs', 'escalator', 'ramp'].includes(kind.feature));
  if (kind.type === 'feature' || kind.type === 'entrance') {
    featureId = newId();
    c.features.push({ id: featureId, floor_id: s.floorId, kind: kind.type === 'entrance' ? 'entrance' : kind.feature, x: at.x, y: at.y, label: kind.type === 'feature' && !action.name ? null : name });
  }
  if (walkTo) {
    nodeId = newId();
    c.nodes.push({ id: nodeId, floor_id: s.floorId, name, x: at.x, y: at.y, hallway: false });
  }
  let joined = false;
  if (nodeId) {
    const rows = withChange(s.rows, c);
    const v = new MapView(rows, s.floorId);
    const main = v.networks(s.floorId)[0];
    if (main?.length) {
      const link = linkWalkable(rows, nodeId, main, s.floorId);
      if (link) { c.nodes.push(...link.nodes); c.edges.push(...link.edges); joined = true; }
    }
  }
  const v2 = new MapView(withChange(s.rows, c), s.floorId);
  const thing: Thing = { kind: nodeId ? 'place' : 'object', id: nodeId ?? featureId!, name, at, nodeId, floorId: s.floorId };
  const where = near ? ` next to ${near.name}` : '';
  const hasPaths = !!v2.networks(s.floorId).length;
  return {
    reply: `Added ${name}${where}.${nodeId && hasPaths ? (joined ? ' Visitors can walk to it.' : ' Walls are in the way, so it isn\'t connected yet.') : ''}`,
    change: c, label: `Add ${name}`, mention: thing, tone: 'ok',
    select: nodeId ? { kind: 'nodes', id: nodeId } : { kind: 'features', id: featureId! },
    highlight: { route: c.edges.map(e => v2.edgeSeg(e)).filter((x): x is Seg2 => !!x), removed: [], spots: [at], things: [] },
    chips: nodeId && !joined && hasPaths ? [{ label: 'Add a door here', say: 'Add a door here' }] : [{ label: 'Rename it', say: 'Rename it to ' }, { label: 'Move it a little right', say: 'Move it a little to the right' }],
  };
}

/** A free spot beside something: on the asked side, else the side with no wall in the way. */
function besideThing(t: Thing, side: Direction | null, s: MapState, view: MapView): Pt {
  const gap = 1.6 * PPM;
  const sides: Direction[] = side ? [side] : ['right', 'left', 'down', 'up'];
  const venue = fromPlan(s.rows, { pxPerMeter: PPM });
  const lines = obstacles(venue, s.floorId);
  const m = (p: Pt) => ({ x: p.x / PPM, z: p.y / PPM });
  const occupied = (p: Pt) => view.things(s.floorId).some(o => o.id !== t.id && d(o.at, p) < 0.8 * PPM);
  for (const sd of sides) {
    const p = { x: t.at.x + STEP[sd].x * gap, y: t.at.y + STEP[sd].y * gap };
    if (side || (!crossesWall(lines, m(t.at), m(p)) && !occupied(p))) return p;
  }
  return { x: t.at.x + gap, y: t.at.y };
}

const CONNECTOR: Record<string, 'stairs' | 'elevator' | 'ramp' | 'escalator'> = { elevator: 'elevator', lift: 'elevator', stairs: 'stairs', staircase: 'stairs', stairway: 'stairs', ramp: 'ramp', escalator: 'escalator' };

function connectorOf(t: Thing, rows: PlanRows): 'stairs' | 'elevator' | 'ramp' | 'escalator' | null {
  const n = norm(t.name);
  for (const [w, k] of Object.entries(CONNECTOR)) if (n.includes(w)) return k;
  const r = t.kind === 'room' ? rows.rooms.find(x => x.id === t.id)?.type : t.kind === 'object' ? rows.map_features.find(x => x.id === t.id)?.kind : null;
  return r && CONNECTOR[r] ? CONNECTOR[r] : null;
}

function connectFloors(via: string | null, floorW: string | null, s: MapState, view: MapView): Plan {
  const others = s.rows.floors.filter(f => f.id !== s.floorId);
  if (!others.length) return ask('This venue has one floor. Add another floor first (Floors → Add floor), then I can connect them.');
  const T = via ? resolve(via, s, view) : (resolve('elevator', s, view) ?? resolve('stairs', s, view));
  if (!T || T.floorId !== s.floorId) return ask(`I couldn't find ${via ? `"${via}"` : 'an elevator or stairs'} on this floor. Click where it is and say "add an elevator here".`, [{ label: 'Add an elevator here', say: 'Add an elevator here' }]);
  const kind = connectorOf(T, s.rows) ?? (via ? CONNECTOR[norm(via)] : null) ?? 'stairs';
  let targets = others;
  if (floorW) {
    const q = norm(floorW);
    const hit = others.filter(f => tokens(f.name).includes(q) || norm(f.name) === q || String(f.level) === q || String(f.level + 1) === q);
    if (hit.length) targets = [hit.find(f => tokens(f.name).includes(q) || norm(f.name) === q) ?? hit[0]];
    else return ask(`Which floor is "${floorW}"? This venue has ${listNames(s.rows.floors.map(f => f.name))}.`);
  } else {
    // "between these floors": the floors next to this one.
    const me = s.rows.floors.find(f => f.id === s.floorId)!;
    const sorted = [...s.rows.floors].sort((a, b) => a.level - b.level);
    const i = sorted.findIndex(f => f.id === me.id);
    targets = [sorted[i - 1], sorted[i + 1]].filter((f): f is (typeof sorted)[number] => !!f);
  }
  const c = emptyChange();
  const here = placeFor(T, c);
  const missing: string[] = [], linked: string[] = [], already: string[] = [];
  for (const f of targets) {
    // The same connector on the other floor: matching name or kind, closest above / below.
    const cands = view.things(f.id).filter(o => connectorOf(o, s.rows) === kind);
    const match = cands.sort((a, b) => d(a.at, T.at) - d(b.at, T.at))[0];
    if (!match) { missing.push(f.name); continue; }
    const there = placeFor(match, c);
    if (s.rows.edges.some(e => (e.from_node === here && e.to_node === there) || (e.from_node === there && e.to_node === here))) { already.push(f.name); continue; }
    c.edges.push({ id: newId(), from_node: here, to_node: there, weight: 15 * PPM, connection: kind, accessible: kind === 'elevator' || kind === 'ramp' });
    linked.push(f.name);
  }
  const me = view.floorName(s.floorId);
  const word = kind === 'elevator' ? 'the elevator' : kind === 'stairs' ? 'the stairs' : `the ${kind}`;
  if (!linked.length) {
    if (already.length && !missing.length) return { reply: `${me} and ${listNames(already)} are already connected by ${word}.`, tone: 'ok' };
    return ask(`${listNames(missing)} ${missing.length === 1 ? "doesn't" : "don't"} have ${word} yet. Open ${missing.length === 1 ? 'that floor' : 'each floor'}, click where it is and say "add ${kind === 'stairs' ? 'stairs' : `an ${kind}`} here" — then ask me again.`);
  }
  return {
    reply: `I'll connect ${me} to ${listNames(linked)} by ${word}.${missing.length ? ` ${listNames(missing)} has no ${kind} yet, so I'll leave it.` : ''}`,
    done: `Done — ${me} and ${listNames(linked)} are now connected by ${word}.`,
    change: c, confirm: true, label: `Connect floors by ${word}`, tone: 'ok', mention: T,
    highlight: { route: [], removed: [], spots: [T.at], things: [T.id] },
    details: c.edges.map(e => `${kind} link ${kind === 'elevator' || kind === 'ramp' ? '(step-free)' : '(has steps)'}`),
  };
}

function accessible(s: MapState, view: MapView): Plan {
  const floors = s.rows.floors;
  if (floors.length < 2) return { reply: 'Everything on this floor is on one level, so every route here is already step-free.', tone: 'ok' };
  const stepFree = new Map<string, Set<string>>(floors.map(f => [f.id, new Set<string>()]));
  for (const e of s.rows.edges) {
    const a = view.nodeAt.get(e.from_node)?.floor, b = view.nodeAt.get(e.to_node)?.floor;
    if (!a || !b || a === b) continue;
    if (e.connection === 'elevator' || e.connection === 'ramp' || e.accessible) { stepFree.get(a)?.add(b); stepFree.get(b)?.add(a); }
  }
  const reach = new Set([s.floorId]); const q = [s.floorId];
  while (q.length) for (const f of stepFree.get(q.pop()!) ?? []) if (!reach.has(f)) { reach.add(f); q.push(f); }
  const stairsOnly = floors.filter(f => !reach.has(f.id)).map(f => f.name);
  if (!stairsOnly.length) return { reply: 'Wheelchair check passed ✓ Every floor can be reached by elevator or ramp, so step-free routes avoid the stairs automatically.', tone: 'ok' };
  const lift = resolve('elevator', s, view);
  return {
    reply: `${listNames(stairsOnly)} can only be reached by stairs right now, so wheelchair users can't get there.`,
    tone: 'warn',
    chips: lift && lift.floorId === s.floorId ? [{ label: 'Connect floors via the elevator', say: 'Connect the floors via the elevator' }] : [{ label: 'Add an elevator here', say: 'Add an elevator here' }],
  };
}

// ── Map health ──────────────────────────────────────────────────────────────

export interface HealthItem { text: string; fix: Chip | null; safe: boolean }

/** What would stop visitors finding their way on this floor, in plain words. */
export function healthOf(s: MapState): HealthItem[] {
  const view = new MapView(s.rows, s.floorId);
  const out: HealthItem[] = [];
  const nodes = s.rows.nodes.filter(n => n.floor_id === s.floorId);
  const main = new Set(view.networks(s.floorId)[0] ?? []);
  const hasPaths = main.size > 0;
  const blocked = pathsThroughWalls(s.rows, PPM, s.rows.edges.filter(e => view.nodeAt.get(e.from_node)?.floor === s.floorId).map(e => e.id));
  if (blocked.length) out.push({ text: `${blocked.length} path${blocked.length === 1 ? ' goes' : 's go'} through a wall`, fix: { label: 'Fix it', say: 'Fix everything' }, safe: true });
  const roomsNoPlace = s.rows.rooms.filter(r => r.floor_id === s.floorId && (!r.node_id || !view.nodeAt.has(r.node_id)));
  for (const r of roomsNoPlace.slice(0, 3)) out.push({ text: `${r.name || 'A room'} has no place visitors can navigate to`, fix: { label: 'Fix it', say: 'Fix everything' }, safe: true });
  if (roomsNoPlace.length > 3) out.push({ text: `${roomsNoPlace.length - 3} more rooms have no place`, fix: { label: 'Fix it', say: 'Fix everything' }, safe: true });
  if (hasPaths) {
    const lonely = view.things(s.floorId).filter(t => t.kind !== 'object' && t.nodeId && !main.has(t.nodeId) && !crossFloor(view, t.nodeId));
    for (const t of lonely.slice(0, 4)) out.push({ text: `${t.name} doesn't have a walkable connection`, fix: { label: 'Fix it', say: `Make ${t.name} walkable` }, safe: true });
    if (lonely.length > 4) out.push({ text: `${lonely.length - 4} more places can't be reached`, fix: { label: 'Fix them', say: 'Fix everything' }, safe: true });
  } else if (nodes.some(n => !n.is_hallway)) {
    out.push({ text: 'No walking paths yet', fix: null, safe: false });
  }
  if (s.rows.floors.length > 1) {
    const lifts = view.things(s.floorId).filter(t => connectorOf(t, s.rows) === 'elevator' || connectorOf(t, s.rows) === 'stairs');
    const linked = lifts.some(t => t.nodeId && s.rows.edges.some(e => (e.from_node === t.nodeId || e.to_node === t.nodeId) && e.connection));
    if (lifts.length && !linked) {
      const lift = lifts.find(t => connectorOf(t, s.rows) === 'elevator') ?? lifts[0];
      out.push({ text: `${lift.name} isn't connected between floors`, fix: { label: 'Connect floors', say: `Connect the floors via the ${connectorOf(lift, s.rows)}` }, safe: false });
    }
  }
  return out;
}
const crossFloor = (v: MapView, id: string) => v.rows.edges.some(e => (e.from_node === id || e.to_node === id) && e.connection);

function healthPlan(s: MapState, view: MapView): Plan {
  const items = healthOf(s);
  if (!items.length) return { reply: 'Map health ✓ Everything on this floor is connected and walkable.', tone: 'ok' };
  void view;
  return {
    reply: `${items.length} thing${items.length === 1 ? ' needs' : 's need'} attention:\n${items.map(i => `• ${i.text}`).join('\n')}`,
    tone: 'warn',
    chips: [{ label: 'Fix everything', say: 'Fix everything' }, ...items.filter(i => i.fix && i.fix.say !== 'Fix everything').slice(0, 3).map(i => ({ label: i.fix!.label === 'Fix it' ? `Fix: ${i.text.split(' ')[0]}` : i.fix!.label, say: i.fix!.say }))],
  };
}

/** Fixes what's safe to fix on its own; tells them what needs a decision. */
function fixAll(s: MapState): Plan {
  const c = emptyChange();
  const done: string[] = [], left: string[] = [];
  let rows = s.rows;
  // 1. Paths through walls → round, through a doorway.
  const view0 = new MapView(rows, s.floorId);
  const blocked = pathsThroughWalls(rows, PPM, rows.edges.filter(e => view0.nodeAt.get(e.from_node)?.floor === s.floorId).map(e => e.id));
  if (blocked.length) {
    const fix = repairPathsThroughWalls(rows, { pxPerMeter: PPM, newId, edgeIds: blocked });
    if (fix.rerouted.length) {
      c.removeEdges.push(...fix.rerouted);
      c.nodes.push(...fix.nodes.map(n => ({ id: n.id, floor_id: n.floor_id, name: '', x: Math.round(n.x), y: Math.round(n.y), hallway: true })));
      c.edges.push(...fix.edges.map(e => ({ id: e.id, from_node: e.from_node, to_node: e.to_node, weight: Math.round(e.weight) })));
      done.push(`${fix.rerouted.length} path${fix.rerouted.length === 1 ? ' now goes' : 's now go'} through doorways`);
    }
    if (fix.dropped.length) left.push(`${fix.dropped.length} path${fix.dropped.length === 1 ? '' : 's'} cross${fix.dropped.length === 1 ? 'es' : ''} a wall with no door nearby — add a door, or say "remove this path"`);
    rows = withChange(s.rows, c);
  }
  // 2. Rooms without a place.
  const v1 = new MapView(rows, s.floorId);
  const roomsNoPlace = rows.rooms.filter(r => r.floor_id === s.floorId && (!r.node_id || !v1.nodeAt.has(r.node_id)));
  for (const r of roomsNoPlace) {
    const at = round(polygonCentroid(v1.roomOutline(r)));
    const id = newId();
    c.nodes.push({ id, floor_id: s.floorId, name: r.name || 'Room', ...at, hallway: false });
    c.roomPlaces.push({ roomId: r.id, nodeId: id });
  }
  if (roomsNoPlace.length) { done.push(`${roomsNoPlace.length} room${roomsNoPlace.length === 1 ? '' : 's'} got a place visitors can navigate to`); rows = withChange(s.rows, c); }
  // 3. Places with no walkable connection → join the main walking network.
  let joined = 0;
  const stuck: string[] = [];
  for (let guard = 0; guard < 40; guard++) {
    const v = new MapView(rows, s.floorId);
    const main = v.networks(s.floorId)[0];
    if (!main?.length) break;
    const mainSet = new Set(main);
    const lonely = v.things(s.floorId).filter(t => t.kind !== 'object' && t.nodeId && !mainSet.has(t.nodeId) && !crossFloor(v, t.nodeId) && !stuck.includes(t.name));
    if (!lonely.length) break;
    const t = lonely[0];
    const link = linkWalkable(rows, t.nodeId!, main, s.floorId);
    if (!link) { stuck.push(t.name); continue; }
    c.nodes.push(...link.nodes); c.edges.push(...link.edges); joined++;
    rows = withChange(s.rows, c);
  }
  if (joined) done.push(`${joined} place${joined === 1 ? ' is' : 's are'} now walkable`);
  if (stuck.length) left.push(`${listNames(stuck)} ${stuck.length === 1 ? 'is' : 'are'} walled in — add a door to ${stuck.length === 1 ? 'it' : 'them'}`);
  // 4. Floors: needs their say (which connector), so ask.
  const floorsLeft = healthOf({ ...s, rows }).filter(i => !i.safe && i.fix);
  for (const i of floorsLeft) left.push(i.text);
  if (isEmpty(c)) {
    return left.length
      ? { reply: `Nothing I can fix on my own. ${left.length === 1 ? 'This needs' : 'These need'} you:\n${left.map(x => `• ${x}`).join('\n')}`, tone: 'warn', chips: floorsLeft.map(i => i.fix!) }
      : { reply: 'Map health ✓ Nothing needs fixing.', tone: 'ok' };
  }
  const v = new MapView(rows, s.floorId);
  return {
    reply: `Fixed ${done.length === 1 ? 'it' : 'these'}: ${done.join('; ')}.${left.length ? `\nStill needs you:\n${left.map(x => `• ${x}`).join('\n')}` : ''}`,
    change: c, label: 'Fix the map', tone: left.length ? 'warn' : 'ok',
    highlight: { route: c.edges.map(e => v.edgeSeg(e)).filter((x): x is Seg2 => !!x), removed: [], spots: c.roomPlaces.map(r => { const n = c.nodes.find(x => x.id === r.nodeId)!; return { x: n.x, y: n.y }; }), things: [] },
    chips: floorsLeft.map(i => i.fix!),
  };
}

// ── Greetings and ideas ─────────────────────────────────────────────────────

export function suggestions(s: MapState): Chip[] {
  const v = new MapView(s.rows, s.floorId);
  const named = v.things(s.floorId).filter(t => t.kind !== 'object');
  const out: Chip[] = [];
  if (named.length >= 2) out.push({ label: `Connect ${named[0].name} and ${named[1].name}`, say: `Connect ${named[0].name} and ${named[1].name}` });
  out.push({ label: 'Add a restroom here', say: 'Add a restroom here' });
  out.push({ label: 'Check accessibility', say: 'Make the route wheelchair accessible' });
  out.push({ label: "What's wrong?", say: "What's wrong?" });
  return out;
}

/** "Your floor plan is ready. I found 24 rooms, 3 entrances…" */
export function importSummary(s: MapState): { reply: string; chips: Chip[] } {
  const v = new MapView(s.rows, s.floorId);
  const things = v.things(s.floorId);
  const count = (k: string) => things.filter(t => connectorOf(t, s.rows) === k).length;
  const rooms = s.rows.rooms.filter(r => r.floor_id === s.floorId && !['stairs', 'elevator', 'entrance'].includes(r.type ?? '')).length;
  const entrances = things.filter(t => /entrance|entry|exit/i.test(t.name) || s.rows.rooms.find(r => r.id === t.id)?.type === 'entrance' || s.rows.map_features.find(f => f.id === t.id)?.kind === 'entrance').length;
  const parts = [
    rooms && `${rooms} room${rooms === 1 ? '' : 's'}`,
    entrances && `${entrances} entrance${entrances === 1 ? '' : 's'}`,
    count('stairs') && `${count('stairs')} stairway${count('stairs') === 1 ? '' : 's'}`,
    count('elevator') && `${count('elevator')} elevator${count('elevator') === 1 ? '' : 's'}`,
  ].filter(Boolean) as string[];
  const issues = healthOf(s);
  return {
    reply: `Your floor plan is ready.${parts.length ? ` I found ${parts.join(', ').replace(/, ([^,]*)$/, ' and $1')}.` : ''}${issues.length ? ` ${issues.length} thing${issues.length === 1 ? '' : 's'} need${issues.length === 1 ? 's' : ''} a look.` : ''}\nWhat would you like to fix first?`,
    chips: [
      ...(issues.length ? [{ label: 'Fix everything', say: 'Fix everything' }] : []),
      { label: 'Connect rooms', say: 'Connect ' },
      ...(entrances ? [] : [{ label: 'Add entrances', say: 'Add an entrance here' }]),
      { label: 'Review paths', say: "What's wrong?" },
      { label: 'Check accessibility', say: 'Make the route wheelchair accessible' },
    ],
  };
}
