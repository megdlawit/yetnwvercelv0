// The map assistant's brain: turns one understood request (intent.ts) into
// real changes to the map — rows to add and remove, edits to make — plus a
// human reply, what to highlight, and whether to show a preview first.
//
// Pure: works on a snapshot of the plan, writes nothing. The floor editor
// applies the result (one undo per request) and keeps the conversation going.

import { crossesWall, fromPlan, obstacles, pathsThroughWalls, repairPathsThroughWalls, type PlanRows } from '@ethi/indoor-core';
import { parsePolygon } from '@/lib/venue/features';
import { bbox, pointInPolygon, polygonArea, polygonCentroid, type Pt } from '@/lib/cad/geometry';
import { HERE, IT, THIS, addKind, roomKind, titleCase, type Direction, type MapAction, type Panel, type ViewMode } from './intent';

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
  selection: { nodes: string[]; rooms: string[]; features: string[]; walls?: string[] };
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
export interface NewFeature { id: string; floor_id: string; kind: string; x: number; y: number; label: string | null; rotation_deg?: number; width?: number | null }
export interface NewRoom { id: string; floor_id: string; name: string; type: string; x: number; y: number; width: number; height: number; node_id: string | null }

/** Row changes, written together as one undoable step. */
export interface Change {
  nodes: NewNode[];
  edges: NewEdge[];
  features: NewFeature[];
  rooms?: NewRoom[];
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
  | { op: 'show'; thing: Thing }
  | { op: 'redo' }
  | { op: 'set_type'; thing: Thing; kind: string }
  /** A rectangle room's new box (plan px), a uniform scale, or an object's size (metres). */
  | { op: 'resize'; thing: Thing; rect?: { x: number; y: number; width: number; height: number }; scale?: number; size?: { width: number | null; depth: number | null } }
  | { op: 'rotate'; thing: Thing; deg: number }
  | { op: 'duplicate'; thing: Thing }
  | { op: 'set_3d'; table: 'walls' | 'rooms' | 'map_features' | 'floors'; ids: string[]; patch: Record<string, unknown>; what: string }
  | { op: 'view'; mode: ViewMode }
  | { op: 'floor'; floorId: string }
  | { op: 'fit' }
  | { op: 'setting'; setting: 'grid' | 'snap'; on: boolean | null }
  | { op: 'tool'; tool: string }
  | { op: 'select_all' }
  | { op: 'select_none' }
  | { op: 'publish' }
  | { op: 'open'; panel: Panel };

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
const emptyChange = (): Change => ({ nodes: [], edges: [], features: [], rooms: [], removeEdges: [], removeNodes: [], roomPlaces: [] });
const isEmpty = (c: Change) => !c.nodes.length && !c.edges.length && !c.features.length && !c.rooms?.length && !c.removeEdges.length && !c.removeNodes.length && !c.roomPlaces.length;
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
    rooms: [...rows.rooms.map(r => { const l = c.roomPlaces.find(x => x.roomId === r.id); return l ? { ...r, node_id: l.nodeId } : r; }), ...(c.rooms ?? [])],
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
    case 'redo': return { reply: 'Redone.', edit: { op: 'redo' }, tone: 'ok' };
    case 'publish': return { reply: 'Publishing your map — visitors will see this version in a moment.', done: 'Published — visitors now see your latest map.', edit: { op: 'publish' }, confirm: true, tone: 'info' };
    case 'view': return { reply: action.mode === 'split' ? 'Showing the plan and the 3D view side by side.' : `Switched to ${action.mode.toUpperCase()}.`, edit: { op: 'view', mode: action.mode }, tone: 'ok' };
    case 'fit': return { reply: 'Here’s the whole floor.', edit: { op: 'fit' }, tone: 'ok' };
    case 'go_floor': return goFloor(action.floor, s);
    case 'setting': return { reply: `${action.setting === 'grid' ? 'Grid' : 'Snapping'} ${action.on == null ? 'toggled' : action.on ? 'on' : 'off'}.`, edit: { op: 'setting', setting: action.setting, on: action.on ?? null }, tone: 'ok' };
    case 'tool': return { reply: TOOL_HINT[action.tool] ?? 'Tool ready.', edit: { op: 'tool', tool: action.tool }, tone: 'ok' };
    case 'open': return { reply: PANEL_REPLY[action.panel], edit: { op: 'open', panel: action.panel }, tone: 'ok' };
    case 'select': {
      if (action.target === 'all') return { reply: 'Selected everything on this floor.', edit: { op: 'select_all' }, tone: 'ok' };
      if (action.target === 'none') return { reply: 'Selection cleared.', edit: { op: 'select_none' }, tone: 'ok' };
      const t = resolve(action.target, s, view);
      if (!t) return notFound(action.target, s);
      return { reply: `Selected ${t.name}.`, edit: { op: 'show', thing: t }, mention: t, tone: 'ok' };
    }
    case 'set_type': return setType(action.target, action.kind, s, view);
    case 'add_room': return addRoom(action, s, view);
    case 'resize': return resize(action, s, view);
    case 'rotate': {
      const t = resolve(action.target, s, view);
      if (!t) return notFound(action.target, s);
      if (!Number.isFinite(action.degrees) || !action.degrees) return ask(`How many degrees should I turn ${t.name}?`);
      return { reply: `Rotated ${t.name} ${Math.abs(action.degrees)}° ${action.degrees > 0 ? 'clockwise' : 'counter-clockwise'}.`, edit: { op: 'rotate', thing: t, deg: action.degrees }, mention: t, tone: 'ok', label: `Rotate ${t.name}` };
    }
    case 'duplicate': {
      const t = resolve(action.target, s, view);
      if (!t) return notFound(action.target, s);
      return { reply: `Made a copy of ${t.name}, 1 m down and to the right. Say "move it…" to place it.`, edit: { op: 'duplicate', thing: t }, mention: t, tone: 'ok', chips: [{ label: 'Rename it', say: 'Rename it to ' }, { label: 'Move it right', say: 'Move it to the right' }] };
    }
    case 'set_3d': return set3d(action.target, action.field, action.value, s, view);
    case 'measure': return measure(action.from, action.to, s, view);
    case 'list': return list(action.what ?? null, s, view);
    case 'describe': {
      const t = resolve(action.target, s, view);
      if (!t) return notFound(action.target, s);
      return { reply: describeThing(t, s, view), mention: t, tone: 'info', highlight: { route: [], removed: [], spots: [t.at], things: [t.id] } };
    }
  }
}

// ── The rest of the editor ──────────────────────────────────────────────────

const TOOL_HINT: Record<string, string> = {
  wall: 'Wall tool ready — click to start a wall, click again to end it. Esc to stop.',
  door: 'Door tool ready — click on a wall to put a door in it.',
  room: 'Room tool ready — click the corners, then click the first corner (or press Enter) to finish.',
  'add-edge': 'Path tool ready — click two places to connect them.',
  'add-node': 'Place tool ready — click where visitors should be able to go.',
  object: 'Object tool ready — pick an object, then click to place it.',
  scenery: 'Scenery tool ready — pick a tree, lawn, pond or lamp, then click to place it.',
  text: 'Text tool ready — click to add a label.',
  measure: 'Measure tool ready — click two points.',
  area: 'Area tool ready — click the corners, Enter to finish.',
  select: 'Select tool ready.', hand: 'Pan tool ready — drag to move around.', delete: 'Eraser ready — click anything to delete it.',
  trim: 'Trim ready — click the part of a wall to cut away.', extend: 'Extend ready — click near a wall end.',
  split: 'Split ready — click a wall to split it.', join: 'Join ready — click two walls in line.', offset: 'Offset ready — click a wall to copy it parallel.',
};
const PANEL_REPLY: Record<Panel, string> = {
  import: 'Opening the importer — drop in a DWG, DXF, SVG or a floor-plan image.',
  add_floor: 'Opening "Add floors" — choose how many and where.',
  tour: 'Starting the editor tour.',
  shortcuts: 'Here are the keyboard shortcuts.',
  world_map: 'Opening “Place on the world map” — line your plan up with the real site so GPS and outdoor directions lead visitors to your door.',
};

function goFloor(word: string, s: MapState): Plan {
  const sorted = [...s.rows.floors].sort((a, b) => a.level - b.level);
  const i = sorted.findIndex(f => f.id === s.floorId);
  let f: (typeof sorted)[number] | undefined;
  if (word === 'up') f = sorted[i + 1];
  else if (word === 'down') f = sorted[i - 1];
  else {
    const q = norm(word);
    const ord = ['ground', 'first', 'second', 'third', 'fourth', 'fifth'].indexOf(q);
    f = sorted.find(x => norm(x.name) === q || tokens(x.name).includes(q))
      ?? sorted.find(x => String(x.level) === q)
      ?? (ord >= 0 ? sorted.find(x => x.level === ord) : undefined)
      ?? (/^\d+$/.test(q) ? sorted[Number(q) - 1] : undefined);
  }
  if (!f) return ask(sorted.length < 2 ? 'This venue has one floor. Say "add a floor" to add another.' : `Which floor? This venue has ${listNames(sorted.map(x => x.name))}.`, sorted.length < 2 ? [{ label: 'Add a floor', say: 'Add a floor' }] : undefined);
  if (f.id === s.floorId) return { reply: `You're already on ${f.name}.`, tone: 'ok' };
  return { reply: `Opening ${f.name}…`, edit: { op: 'floor', floorId: f.id }, tone: 'ok' };
}

/** Room kinds and object kinds the editor stores. */
const ROOM_TYPES = ['office', 'meeting', 'entrance', 'stairs', 'elevator', 'restroom', 'reception', 'utility'];
const FEATURE_OF: Record<string, string> = { stairs: 'stairs', elevator: 'elevator', entrance: 'entrance' };

function setType(word: string, kindWord: string, s: MapState, view: MapView): Plan {
  const t = resolve(word, s, view);
  if (!t) return notFound(word, s);
  const kind = ROOM_TYPES.includes(kindWord) ? kindWord : roomKind(kindWord);
  if (!kind) return ask(`I can make it one of: ${ROOM_TYPES.join(', ')}. Which one?`);
  // A place inside a room → that room.
  const room = t.kind === 'room' ? t : (() => {
    const r = s.rows.rooms.find(x => x.floor_id === t.floorId && (x.node_id === t.nodeId || pointInPolygon(t.at, view.roomOutline(x))));
    return r ? view.things(t.floorId).find(x => x.id === r.id) ?? null : null;
  })();
  if (room) return { reply: `${room.name} is now a ${kind === 'meeting' ? 'meeting room' : kind}.`, edit: { op: 'set_type', thing: room, kind }, mention: room, tone: 'ok', label: `Make ${room.name} a ${kind}` };
  if (t.kind === 'object' && FEATURE_OF[kind]) return { reply: `${t.name} is now ${kind === 'stairs' ? 'stairs' : `an ${kind}`}.`, edit: { op: 'set_type', thing: t, kind: FEATURE_OF[kind] }, mention: t, tone: 'ok' };
  return ask(`${t.name} isn't a room. Draw a room around it (say "add a room here"), then I can set its kind.`, [{ label: 'Add a room here', say: `Add a room called ${t.name} here` }]);
}

function addRoom(action: Extract<MapAction, { op: 'add_room' }>, s: MapState, view: MapView): Plan {
  const w = Math.max(1, Math.min(200, action.width ?? 5)) * PPM, h = Math.max(1, Math.min(200, action.depth ?? 4)) * PPM;
  let near: Thing | null = null;
  let at: Pt | null;
  if (action.near === HERE) at = s.click;
  else if (action.near) {
    near = resolve(action.near, s, view);
    if (!near) return notFound(action.near, s);
    // Beside it, a room's width away.
    const side = action.side ?? 'right';
    const step = side === 'left' || side === 'right' ? w / 2 + 1.5 * PPM : h / 2 + 1.5 * PPM;
    at = { x: near.at.x + STEP[side].x * step, y: near.at.y + STEP[side].y * step };
  } else at = s.click ?? s.view;
  if (!at) return ask('Click where the room should go, then say "add a room here".');
  at = round(at);
  const taken = new Set(view.things(s.floorId).map(t => norm(t.name)));
  const base = action.name?.trim() || (action.kind ? titleCase(action.kind === 'meeting' ? 'Meeting room' : action.kind) : 'Room');
  let name = base;
  for (let i = 2; taken.has(norm(name)); i++) name = `${base} ${i}`;
  const kind = action.kind && ROOM_TYPES.includes(action.kind) ? action.kind : roomKind(name) ?? 'office';
  const c = emptyChange();
  const nodeId = newId(), roomId = newId();
  c.nodes.push({ id: nodeId, floor_id: s.floorId, name, x: at.x, y: at.y, hallway: false });
  c.rooms!.push({ id: roomId, floor_id: s.floorId, name, type: kind, x: Math.round(at.x - w / 2), y: Math.round(at.y - h / 2), width: Math.round(w), height: Math.round(h), node_id: nodeId });
  let joined = false;
  const rows = withChange(s.rows, c);
  const main = new MapView(rows, s.floorId).networks(s.floorId)[0];
  if (main?.length) {
    const link = linkWalkable(rows, nodeId, main, s.floorId);
    if (link) { c.nodes.push(...link.nodes); c.edges.push(...link.edges); joined = true; }
  }
  const v2 = new MapView(withChange(s.rows, c), s.floorId);
  const thing: Thing = { kind: 'room', id: roomId, name, at, nodeId, floorId: s.floorId };
  return {
    reply: `Added ${name} (${(w / PPM).toFixed(1)} × ${(h / PPM).toFixed(1)} m)${near ? ` next to ${near.name}` : ''}.${main?.length ? (joined ? ' Visitors can walk to it.' : ' Walls are in the way, so it isn\'t connected yet.') : ''}`,
    change: c, label: `Add ${name}`, mention: thing, tone: 'ok', select: { kind: 'rooms', id: roomId },
    highlight: { route: c.edges.map(e => v2.edgeSeg(e)).filter((x): x is Seg2 => !!x), removed: [], spots: [at], things: [] },
    chips: [{ label: 'Make it bigger', say: 'Make it bigger' }, { label: 'Rename it', say: 'Rename it to ' }, { label: 'Draw walls', say: 'Draw walls' }],
  };
}

function resize(action: Extract<MapAction, { op: 'resize' }>, s: MapState, view: MapView): Plan {
  const t = resolve(action.target, s, view);
  if (!t) return notFound(action.target, s);
  if (t.kind === 'object') {
    const f = s.rows.map_features.find(x => x.id === t.id);
    const scale = action.scale ?? null;
    const width = action.width ?? (scale && f?.width ? f.width * scale : null);
    const depth = action.depth ?? (scale && f?.depth ? f.depth * scale : null);
    if (width == null && depth == null) return ask(`How big should ${t.name} be? e.g. "make it 2 by 1 m".`);
    return { reply: `${t.name} is now ${width != null ? `${width.toFixed(1)} m wide` : ''}${width != null && depth != null ? ' and ' : ''}${depth != null ? `${depth.toFixed(1)} m deep` : ''}.`, edit: { op: 'resize', thing: t, size: { width, depth } }, mention: t, tone: 'ok' };
  }
  const room = t.kind === 'room' ? s.rows.rooms.find(r => r.id === t.id) : s.rows.rooms.find(r => r.node_id === t.nodeId);
  if (!room) return ask(`${t.name} is a point, not a room — there's no size to change. Say "add a room here" to draw one around it.`);
  const thing = t.kind === 'room' ? t : view.things(t.floorId).find(x => x.id === room.id)!;
  const outline = view.roomOutline(room);
  const b = bbox(outline);
  const bw = b.maxX - b.minX, bh = b.maxY - b.minY;
  if (action.scale && !action.width && !action.depth) {
    return { reply: `${action.scale > 1 ? 'Enlarged' : 'Shrunk'} ${thing.name} to ${((bw * action.scale) / PPM).toFixed(1)} × ${((bh * action.scale) / PPM).toFixed(1)} m.`, edit: { op: 'resize', thing, scale: action.scale }, mention: thing, tone: 'ok' };
  }
  const w = (action.width ?? bw / PPM) * PPM, h = (action.depth ?? bh / PPM) * PPM;
  if (room.polygon && parsePolygon(room.polygon)) {
    // A drawn shape keeps its shape: scale it to the new width.
    const k = action.width ? w / bw : h / bh;
    return { reply: `${thing.name} has a drawn shape, so I scaled it evenly to about ${((bw * k) / PPM).toFixed(1)} × ${((bh * k) / PPM).toFixed(1)} m.`, edit: { op: 'resize', thing, scale: k }, mention: thing, tone: 'ok' };
  }
  const cx = room.x + room.width / 2, cy = room.y + room.height / 2;
  return {
    reply: `${thing.name} is now ${(w / PPM).toFixed(1)} × ${(h / PPM).toFixed(1)} m (${((w * h) / PPM / PPM).toFixed(0)} m²).`,
    edit: { op: 'resize', thing, rect: { x: Math.round(cx - w / 2), y: Math.round(cy - h / 2), width: Math.round(w), height: Math.round(h) } }, mention: thing, tone: 'ok',
  };
}

const WALL_MATERIALS = ['plaster', 'brick', 'concrete', 'glass', 'wood', 'stone'];
const FLOOR_MATERIALS = ['tile', 'wood', 'carpet', 'concrete', 'stone', 'marble', 'grass'];
const metresOf = (v: string) => { const n = parseFloat(v.replace(',', '.')); return Number.isFinite(n) ? (/cm/.test(v) ? n / 100 : n) : null; };
const yes = (v: string) => /^(yes|true|on|1|step[- ]?free|accessible)$/i.test(v.trim());

function set3d(target: string, fieldRaw: string, value: string, s: MapState, view: MapView): Plan {
  const field = fieldRaw.toLowerCase().replace(/[\s-]+/g, '_');
  const walls = s.rows.walls.filter(w => w.floor_id === s.floorId);
  // Walls: all on this floor, or the selected ones.
  if (/^(all_)?(the_)?walls?$/.test(norm(target).replace(/ /g, '_')) || (target === THIS && s.selection.walls?.length && !s.selection.rooms.length && !s.selection.features.length)) {
    const ids = target === THIS ? s.selection.walls ?? [] : walls.map(w => w.id);
    if (!ids.length) return ask('There are no walls on this floor yet. Say "draw walls" to start.');
    const n = ids.length, which = target === THIS ? `the ${n} selected wall${n === 1 ? '' : 's'}` : `all ${n} wall${n === 1 ? '' : 's'} on this floor`;
    if (/height|tall|high/.test(field)) { const m = metresOf(value); if (!m || m < 0.3 || m > 30) return ask('How high, in metres? e.g. "make the walls 3 m high".'); return { reply: `Set ${which} to ${m} m high.`, edit: { op: 'set_3d', table: 'walls', ids, patch: { height_m: m }, what: 'Wall height' }, tone: 'ok' }; }
    if (/thick/.test(field)) { const m = metresOf(value); if (!m || m < 0.03 || m > 2) return ask('How thick, in metres? e.g. "walls 0.2 m thick".'); return { reply: `Set ${which} to ${m} m thick.`, edit: { op: 'set_3d', table: 'walls', ids, patch: { thickness_m: m }, what: 'Wall thickness' }, tone: 'ok' }; }
    if (/material|made|finish/.test(field)) { const v = value.toLowerCase().replace('wooden', 'wood'); if (!WALL_MATERIALS.includes(v)) return ask(`Walls can be ${WALL_MATERIALS.join(', ')}.`); return { reply: `${titleCase(which)} are now ${v}.`, edit: { op: 'set_3d', table: 'walls', ids, patch: { material: v }, what: 'Wall material' }, tone: 'ok' }; }
    return ask('For walls I can set the height, thickness or material.');
  }
  // The floor itself.
  if (/^(this )?(floor|level|storey)$/.test(norm(target)) || /ceiling_height|elevation/.test(field) || (field === 'ceiling' && !/^(this|it)$/.test(target) && target === 'floor')) {
    const f = s.rows.floors.find(x => x.id === s.floorId);
    if (!f) return ask('Open a floor first.');
    if (/ceiling/.test(field)) { const m = metresOf(value); if (!m || m < 1.8 || m > 40) return ask('How high is the ceiling, in metres?'); return { reply: `${f.name}'s ceiling is now ${m} m high.`, edit: { op: 'set_3d', table: 'floors', ids: [f.id], patch: { ceiling_height_m: m }, what: 'Ceiling height' }, tone: 'ok' }; }
    if (/elevation|above|height/.test(field)) { const m = metresOf(value); if (m == null) return ask('How far above the ground, in metres?'); return { reply: `${f.name} now sits ${m} m above ground.`, edit: { op: 'set_3d', table: 'floors', ids: [f.id], patch: { elevation_m: m }, what: 'Floor height' }, tone: 'ok' }; }
    if (/amharic|name_am/.test(field)) return { reply: `${f.name} is called “${value}” in Amharic now.`, edit: { op: 'set_3d', table: 'floors', ids: [f.id], patch: { name_am: value }, what: 'Amharic name' }, tone: 'ok' };
    return ask('For the floor I can set the ceiling height, its height above ground, or its Amharic name.');
  }
  const t = resolve(target, s, view);
  if (!t) return notFound(target, s);
  if (t.kind === 'room' || (t.kind === 'place' && s.rows.rooms.some(r => r.node_id === t.nodeId))) {
    const room = t.kind === 'room' ? s.rows.rooms.find(r => r.id === t.id)! : s.rows.rooms.find(r => r.node_id === t.nodeId)!;
    const name = room.name || t.name;
    if (/floor|material|finish/.test(field)) { const v = value.toLowerCase(); if (!FLOOR_MATERIALS.includes(v)) return ask(`Room floors can be ${FLOOR_MATERIALS.join(', ')}.`); return { reply: `${name} now has a ${v} floor.`, edit: { op: 'set_3d', table: 'rooms', ids: [room.id], patch: { floor_material: v }, what: 'Floor finish' }, mention: t, tone: 'ok' }; }
    if (/ceiling|roof/.test(field)) { const on = !/^(no|off|false|0|none|open)$/i.test(value.trim()); return { reply: `${name} ${on ? 'has a ceiling' : 'is open to the sky'} now.`, edit: { op: 'set_3d', table: 'rooms', ids: [room.id], patch: { has_ceiling: on }, what: 'Ceiling' }, mention: t, tone: 'ok' }; }
    if (/amharic|name_am/.test(field)) return { reply: `${name} is called “${value}” in Amharic now — visitors using Amharic will see it.`, edit: { op: 'set_3d', table: 'rooms', ids: [room.id], patch: { name_am: value }, what: 'Amharic name' }, mention: t, tone: 'ok' };
    return ask(`For ${name} I can set the floor finish, whether it has a ceiling, or its Amharic name.`);
  }
  if (t.kind === 'object') {
    if (/height|tall|high/.test(field)) { const m = metresOf(value); if (!m) return ask('How high, in metres?'); return { reply: `${t.name} is now ${m} m high.`, edit: { op: 'set_3d', table: 'map_features', ids: [t.id], patch: { height_m: m }, what: 'Height' }, mention: t, tone: 'ok' }; }
    if (/sill/.test(field)) { const m = metresOf(value); if (m == null) return ask('How high is the sill, in metres?'); return { reply: `${t.name}'s sill is now ${m} m.`, edit: { op: 'set_3d', table: 'map_features', ids: [t.id], patch: { sill_m: m }, what: 'Sill height' }, mention: t, tone: 'ok' }; }
    if (/step/.test(field) && /\d/.test(value)) return { reply: `${t.name} has ${parseInt(value, 10)} steps now.`, edit: { op: 'set_3d', table: 'map_features', ids: [t.id], patch: { step_count: parseInt(value, 10) }, what: 'Steps' }, mention: t, tone: 'ok' };
    if (/access|step_free|wheelchair/.test(field)) { const on = yes(value); return { reply: `${t.name} is ${on ? 'step-free' : 'not step-free'} now.`, edit: { op: 'set_3d', table: 'map_features', ids: [t.id], patch: { accessible: on }, what: 'Step-free' }, mention: t, tone: 'ok' }; }
    if (/amharic|label_am/.test(field)) return { reply: `${t.name} is called “${value}” in Amharic now.`, edit: { op: 'set_3d', table: 'map_features', ids: [t.id], patch: { label_am: value }, what: 'Amharic name' }, mention: t, tone: 'ok' };
    return ask(`For ${t.name} I can set its height, sill, number of steps, step-free access or Amharic name.`);
  }
  return ask(`${t.name} is a point on the map — select a room, wall or object to change its 3D details.`);
}

function measure(fromW: string, toW: string, s: MapState, view: MapView): Plan {
  const A = resolve(fromW, s, view), B = resolve(toW, s, view);
  if (!A) return notFound(fromW, s);
  if (!B) return notFound(toW, s);
  const straight = d(A.at, B.at) / PPM;
  const r = A.nodeId && B.nodeId ? view.route(A.nodeId, B.nodeId) : null;
  const walk = r ? routeLength(view, r) / PPM : null;
  const sameFloor = A.floorId === B.floorId;
  return {
    reply: `${A.name} → ${B.name}: ${sameFloor ? `${straight.toFixed(1)} m in a straight line` : 'on different floors'}${walk != null ? `, about ${walk.toFixed(0)} m on foot (${Math.max(1, Math.round(walk / 1.3 / 60))} min walk)` : ' — they aren\'t connected by paths yet'}.`,
    tone: 'info', mention: B,
    highlight: { route: r ? view.segs(r) : [], removed: [], spots: [A.at, B.at], things: [A.id, B.id] },
    chips: r ? undefined : [{ label: `Connect them`, say: `Connect ${A.name} and ${B.name}` }],
  };
}

const plural = (n: number, w: string) => `${n} ${w}${n === 1 ? '' : 's'}`;

function list(whatRaw: string | null, s: MapState, view: MapView): Plan {
  const what = (whatRaw ?? '').toLowerCase().replace(/s$/, '').replace(/^(poi|thing)$/, 'place');
  const things = view.things(s.floorId);
  const rooms = s.rows.rooms.filter(r => r.floor_id === s.floorId);
  const feats = s.rows.map_features.filter(f => f.floor_id === s.floorId);
  const floorName = view.floorName(s.floorId);
  const names = (xs: string[]) => (xs.length ? `: ${xs.slice(0, 12).join(', ')}${xs.length > 12 ? `, and ${xs.length - 12} more` : ''}` : '');
  const byKind = (k: string) => {
    const rs = rooms.filter(r => r.type === k).map(r => r.name || titleCase(k));
    const fs = feats.filter(f => f.kind === k).map(f => f.label || titleCase(k));
    const ns = things.filter(t => t.kind === 'place' && new RegExp(k, 'i').test(t.name)).map(t => t.name);
    return [...new Set([...rs, ...fs, ...ns])];
  };
  const kindWord: Record<string, string> = { toilet: 'restroom', restroom: 'restroom', lift: 'elevator', elevator: 'elevator', stair: 'stairs', staircase: 'stairs', entrance: 'entrance', exit: 'entrance', door: 'door', office: 'office', 'meeting room': 'meeting', tree: 'tree', bench: 'bench' };
  if (!what) {
    const main = new Set(view.networks(s.floorId)[0] ?? []);
    const named = things.filter(t => t.kind !== 'object');
    const reach = named.filter(t => t.nodeId && main.has(t.nodeId)).length;
    const types = Object.entries(rooms.reduce<Record<string, number>>((a, r) => { const k = r.type || 'room'; a[k] = (a[k] ?? 0) + 1; return a; }, {})).map(([k, n]) => plural(n, k === 'meeting' ? 'meeting room' : k));
    const area = rooms.reduce((sum, r) => sum + polygonArea(view.roomOutline(r)), 0) / PPM / PPM;
    const h = healthOf(s);
    return {
      reply: `${floorName}: ${plural(rooms.length, 'room')}${types.length ? ` (${types.join(', ')})` : ''}, ${plural(named.length, 'place')} (${reach} reachable on foot), ${plural(feats.length, 'object')}, ${plural(s.rows.walls.filter(w => w.floor_id === s.floorId).length, 'wall')}. Rooms cover about ${area.toFixed(0)} m².${s.rows.floors.length > 1 ? ` The venue has ${plural(s.rows.floors.length, 'floor')}.` : ''}${h.length ? ` ${plural(h.length, 'thing')} need${h.length === 1 ? 's' : ''} attention.` : ' Map health ✓'}`,
      tone: 'info', chips: h.length ? [{ label: "What's wrong?", say: "What's wrong?" }] : undefined,
    };
  }
  if (what === 'room') return { reply: `${plural(rooms.length, 'room')} on ${floorName}${names(rooms.map(r => r.name || titleCase(r.type ?? 'room')))}.`, tone: 'info' };
  if (what === 'place') { const xs = things.filter(t => t.kind !== 'object').map(t => t.name); return { reply: `${plural(xs.length, 'place')} visitors can find on ${floorName}${names(xs)}.`, tone: 'info' }; }
  if (what === 'object') {
    const counts = Object.entries(feats.reduce<Record<string, number>>((a, f) => { a[f.kind] = (a[f.kind] ?? 0) + 1; return a; }, {})).map(([k, n]) => `${n} ${k}`);
    return { reply: `${plural(feats.length, 'object')} on ${floorName}${counts.length ? `: ${counts.join(', ')}` : ''}.`, tone: 'info' };
  }
  if (what === 'floor') return { reply: `${plural(s.rows.floors.length, 'floor')}: ${[...s.rows.floors].sort((a, b) => a.level - b.level).map(f => `${f.name}${f.id === s.floorId ? ' (open)' : ''}`).join(', ')}.`, tone: 'info' };
  if (what === 'wall') return { reply: `${plural(s.rows.walls.filter(w => w.floor_id === s.floorId).length, 'wall')} on ${floorName}.`, tone: 'info' };
  if (what === 'path') {
    const es = s.rows.edges.filter(e => view.nodeAt.get(e.from_node)?.floor === s.floorId);
    const nets = view.networks(s.floorId);
    return { reply: `${plural(es.length, 'path segment')} on ${floorName}, in ${plural(nets.length, 'connected network')}${nets.length > 1 ? ' — some places are cut off from the rest. Say "fix everything" to join them.' : '.'}`, tone: nets.length > 1 ? 'warn' : 'info' };
  }
  const k = kindWord[what] ?? what;
  const xs = byKind(k);
  return { reply: xs.length ? `${plural(xs.length, k === 'stairs' ? 'stairway' : k)} on ${floorName}${names(xs)}.` : `No ${k === 'stairs' ? 'stairs' : `${k}s`} on ${floorName} yet.`, tone: 'info', chips: xs.length ? undefined : [{ label: `Add ${k === 'stairs' ? 'stairs' : `a ${k}`} here`, say: `Add ${k === 'stairs' ? 'stairs' : `a ${k}`} here` }] };
}

function describeThing(t: Thing, s: MapState, view: MapView): string {
  const parts: string[] = [];
  const floor = view.floorName(t.floorId);
  if (t.kind === 'room') {
    const r = s.rows.rooms.find(x => x.id === t.id)!;
    const o = view.roomOutline(r); const b = bbox(o);
    const kind = r.type === 'meeting' ? 'meeting room' : r.type || 'room';
    parts.push(`${t.name} is ${/^[aeiou]/.test(kind) ? 'an' : 'a'} ${kind} on ${floor}, about ${((b.maxX - b.minX) / PPM).toFixed(1)} × ${((b.maxY - b.minY) / PPM).toFixed(1)} m (${(polygonArea(o) / PPM / PPM).toFixed(0)} m²).`);
    if (r.floor_material) parts.push(`Floor: ${r.floor_material}.`);
    if (r.name_am) parts.push(`Amharic name: ${r.name_am}.`);
  } else if (t.kind === 'object') {
    const f = s.rows.map_features.find(x => x.id === t.id)!;
    parts.push(`${t.name} is ${/^[aeiou]/.test(f.kind) ? 'an' : 'a'} ${f.kind} on ${floor}${f.width ? `, ${f.width.toFixed(1)} m wide` : ''}${f.rotation_deg ? `, turned ${Math.round(f.rotation_deg)}°` : ''}.`);
  } else parts.push(`${t.name} is a place visitors can navigate to on ${floor}.`);
  if (t.nodeId) {
    const main = new Set(view.networks(t.floorId)[0] ?? []);
    const links = view.adj.get(t.nodeId)?.length ?? 0;
    parts.push(main.has(t.nodeId) ? `It's connected to the walking paths (${plural(links, 'link')}).` : crossFloor(view, t.nodeId) ? 'It links to another floor.' : "It isn't connected to the walking paths yet.");
  }
  return parts.join(' ');
}

/**
 * A compact, plain-text picture of the map for the AI: floors, what's on
 * this floor with kinds, sizes and positions (metres), the paths, what's
 * selected and what needs fixing. Names only — no personal data.
 */
export function brief(s: MapState): string {
  const view = new MapView(s.rows, s.floorId);
  const m = (v: number) => (v / PPM).toFixed(1);
  const floors = [...s.rows.floors].sort((a, b) => a.level - b.level);
  const main = new Set(view.networks(s.floorId)[0] ?? []);
  const rooms = s.rows.rooms.filter(r => r.floor_id === s.floorId);
  const roomNodes = new Set(rooms.map(r => r.node_id).filter(Boolean));
  const out: string[] = [];
  out.push(`Floors (low→high): ${floors.map(f => `${f.name} [level ${f.level}${f.id === s.floorId ? ', OPEN' : ''}${f.ceiling_height_m ? `, ceiling ${f.ceiling_height_m} m` : ''}]`).join('; ') || 'one floor'}`);
  out.push(`Rooms on this floor (${rooms.length}) — name | kind | size m | centre x,y m | reachable:`);
  for (const r of rooms.slice(0, 160)) {
    const o = view.roomOutline(r); const b = bbox(o); const c = polygonCentroid(o);
    out.push(`- ${r.name || '(unnamed)'} | ${r.type ?? 'room'} | ${m(b.maxX - b.minX)}×${m(b.maxY - b.minY)} | ${m(c.x)},${m(c.y)} | ${r.node_id && main.has(r.node_id) ? 'yes' : 'no'}${r.floor_material ? ` | floor ${r.floor_material}` : ''}`);
  }
  const places = s.rows.nodes.filter(n => n.floor_id === s.floorId && !n.is_hallway && n.name && !roomNodes.has(n.id));
  out.push(`Other places (${places.length}) — name | x,y m | reachable:`);
  for (const n of places.slice(0, 120)) out.push(`- ${n.name} | ${m(n.x)},${m(n.y)} | ${main.has(n.id) ? 'yes' : crossFloor(view, n.id) ? 'other floor' : 'no'}`);
  const feats = s.rows.map_features.filter(f => f.floor_id === s.floorId);
  const counts = feats.reduce<Record<string, number>>((a, f) => { a[f.kind] = (a[f.kind] ?? 0) + 1; return a; }, {});
  out.push(`Objects (${feats.length}): ${Object.entries(counts).map(([k, n]) => `${n} ${k}`).join(', ') || 'none'}`);
  for (const f of feats.filter(x => x.label || ['elevator', 'stairs', 'entrance', 'escalator', 'ramp'].includes(x.kind)).slice(0, 60)) out.push(`- ${f.label || f.kind} | ${f.kind} | ${m(f.x)},${m(f.y)}`);
  const walls = s.rows.walls.filter(w => w.floor_id === s.floorId);
  out.push(`Walls: ${walls.length}${walls.some(w => w.height_m) ? ` (heights: ${[...new Set(walls.map(w => w.height_m).filter(Boolean))].slice(0, 4).join(', ')} m)` : ''}`);
  const es = s.rows.edges.filter(e => view.nodeAt.get(e.from_node)?.floor === s.floorId);
  out.push(`Walking paths: ${es.length} segments in ${view.networks(s.floorId).length} network(s); ${es.filter(e => e.connection).length} floor links (${[...new Set(es.map(e => e.connection).filter(Boolean))].join(', ') || 'none'})`);
  const sel = [...s.selection.rooms.map(id => rooms.find(r => r.id === id)?.name), ...s.selection.nodes.map(id => view.nodeAt.get(id)?.name), ...s.selection.features.map(id => { const f = feats.find(x => x.id === id); return f ? f.label || f.kind : null; })].filter(Boolean);
  out.push(`Selected: ${sel.length ? sel.join(', ') : 'nothing'}${s.selection.walls?.length ? ` + ${plural(s.selection.walls.length, 'wall')}` : ''}`);
  out.push(`Last click ("here"): ${s.click ? `${m(s.click.x)},${m(s.click.y)} m` : 'none'}; screen centre ${m(s.view.x)},${m(s.view.y)} m`);
  const h = healthOf(s);
  out.push(`Health: ${h.length ? h.map(i => i.text).join('; ') : 'all good'}`);
  return out.join('\n');
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

type Room = PlanRows['rooms'][number];
const DOOR_W = 0.9 * PPM;

/** The point of segment a–b nearest p, kept `margin` from its ends (null when it's too short). */
function onWall(p: Pt, a: Pt, b: Pt, margin: number): { at: Pt; dist: number; angle: number } | null {
  const L = Math.hypot(b.x - a.x, b.y - a.y);
  if (L < 2 * margin) return null;
  const t = Math.max(margin / L, Math.min(1 - margin / L, ((p.x - a.x) * (b.x - a.x) + (p.y - a.y) * (b.y - a.y)) / (L * L)));
  const at = { x: a.x + (b.x - a.x) * t, y: a.y + (b.y - a.y) * t };
  return { at, dist: Math.hypot(p.x - at.x, p.y - at.y), angle: (Math.atan2(b.y - a.y, b.x - a.x) * 180) / Math.PI };
}

/** Distance from p to a polygon's outline. */
function toOutline(p: Pt, poly: Pt[]): number {
  let best = Infinity;
  for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) {
    const w = onWall(p, poly[j], poly[i], 0);
    if (w) best = Math.min(best, w.dist);
  }
  return best;
}

/**
 * Where a door goes — always ON a wall, turned along it; never floating in a room or outside.
 * Clicked near a wall: on that wall. A room (selected, clicked inside, or walled in): on the
 * room's own wall that faces the walking paths, where visitors would come in. Null: no wall to use.
 */
export function doorSpot(s: MapState, view: MapView, opts: { at?: Pt | null; room?: Room | null }): { x: number; y: number; rotationDeg: number } | null {
  const walls = s.rows.walls.filter(w => w.floor_id === s.floorId).map(w => ({ a: { x: w.x1, y: w.y1 }, b: { x: w.x2, y: w.y2 } }));
  if (!walls.length) return null;
  const margin = 0.5 * PPM;
  if (opts.at) {
    const near = walls.map(w => onWall(opts.at!, w.a, w.b, margin)).filter((x): x is NonNullable<typeof x> => !!x).sort((x, y) => x.dist - y.dist)[0];
    if (near && near.dist <= 1.2 * PPM) return { ...round(near.at), rotationDeg: Math.round(near.angle) };
  }
  const room = opts.room ?? (opts.at ? s.rows.rooms.find(r => r.floor_id === s.floorId && pointInPolygon(opts.at!, view.roomOutline(r))) ?? null : null);
  if (!room) return null;
  const poly = view.roomOutline(room);
  // The room's own walls: lying along its outline.
  const own = walls.filter(w => toOutline(w.a, poly) <= 0.5 * PPM && toOutline(w.b, poly) <= 0.5 * PPM);
  if (!own.length) return null;
  // Where visitors come from: the nearest point of the main walking network outside the room.
  const main = view.networks(s.floorId)[0] ?? [];
  const outside = main.map(id => view.nodeAt.get(id)).filter((n): n is NonNullable<typeof n> => !!n && !pointInPolygon(n, poly));
  const c = polygonCentroid(poly);
  const target = outside.sort((x, y) => d(x, c) - d(y, c))[0] ?? null;
  const pick = own.map(w => onWall(target ?? c, w.a, w.b, margin)).filter((x): x is NonNullable<typeof x> => !!x)
    .sort((x, y) => (target ? x.dist - y.dist : y.dist - x.dist))[0];
  return pick ? { ...round(pick.at), rotationDeg: Math.round(pick.angle) } : null;
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
  // A door is always on a wall: the clicked wall, or the selected room's wall facing the paths.
  let doorAngle: number | null = null;
  if (kind.type === 'feature' && kind.feature === 'door') {
    const sel = selected(s, view);
    const room = sel?.kind === 'room' ? s.rows.rooms.find(r => r.id === sel.id) ?? null : null;
    const spot = doorSpot(s, view, { at: action.near === HERE || !action.near ? (s.click ?? null) : at, room: s.click ? null : room })
      ?? doorSpot(s, view, { at, room });
    if (!spot) return ask('Click on the wall where the door should go (or select the room), then say "add a door here".');
    at = { x: spot.x, y: spot.y };
    doorAngle = spot.rotationDeg;
  }
  const c = emptyChange();
  const label = kind.type === 'feature' ? kind.name : kind.name;
  const taken = new Set(view.things(s.floorId).map(t => norm(t.name)));
  let name = label;
  for (let i = 2; taken.has(norm(name)) && kind.type !== 'feature'; i++) name = `${label} ${i}`;
  let nodeId: string | null = null, featureId: string | null = null;
  const walkTo = kind.type === 'place' || kind.type === 'entrance' || (kind.type === 'feature' && ['elevator', 'stairs', 'escalator', 'ramp'].includes(kind.feature));
  if (kind.type === 'feature' || kind.type === 'entrance') {
    featureId = newId();
    c.features.push({ id: featureId, floor_id: s.floorId, kind: kind.type === 'entrance' ? 'entrance' : kind.feature, x: at.x, y: at.y, label: kind.type === 'feature' && !action.name ? null : name,
      ...(doorAngle !== null ? { rotation_deg: doorAngle, width: DOOR_W } : {}) });
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
  if (doorAngle !== null) {
    const rows = withChange(s.rows, c);
    const v = new MapView(rows, s.floorId);
    const main = v.networks(s.floorId)[0];
    const mainSet = new Set(main ?? []);
    const behind = v.things(s.floorId).find(t => t.kind !== 'object' && t.nodeId && !mainSet.has(t.nodeId) && d(t.at, at!) < 6 * PPM);
    const link = behind && main?.length ? linkWalkable(rows, behind.nodeId!, main, s.floorId) : null;
    if (link) { c.nodes.push(...link.nodes); c.edges.push(...link.edges); joined = true; }
  }
  const v2 = new MapView(withChange(s.rows, c), s.floorId);
  const thing: Thing = { kind: nodeId ? 'place' : 'object', id: nodeId ?? featureId!, name, at, nodeId, floorId: s.floorId };
  const where = near ? ` next to ${near.name}` : '';
  const hasPaths = !!v2.networks(s.floorId).length;
  return {
    reply: doorAngle !== null
      ? `Added a door in the wall${joined ? ' — the room behind it is now connected to the walking paths' : ''}. Not the right spot? Say “undo” and click on the wall where it should go.`
      : `Added ${name}${where}.${nodeId && hasPaths ? (joined ? ' Visitors can walk to it.' : ' Walls are in the way, so it isn\'t connected yet.') : ''}`,
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
  let joined = 0, doors = 0;
  const stuck: string[] = [];
  for (let guard = 0; guard < 40; guard++) {
    const v = new MapView(rows, s.floorId);
    const main = v.networks(s.floorId)[0];
    if (!main?.length) break;
    const mainSet = new Set(main);
    const lonely = v.things(s.floorId).filter(t => t.kind !== 'object' && t.nodeId && !mainSet.has(t.nodeId) && !crossFloor(v, t.nodeId) && !stuck.includes(t.name));
    if (!lonely.length) break;
    const t = lonely[0];
    let link = linkWalkable(rows, t.nodeId!, main, s.floorId);
    if (!link) {
      // Walled in: give its room a door where the paths are, then try again.
      const room = rows.rooms.find(r => r.floor_id === s.floorId && (r.node_id === t.nodeId || pointInPolygon(t.at, v.roomOutline(r))));
      const spot = room ? doorSpot({ ...s, rows }, v, { room }) : null;
      if (spot) {
        const door = { id: newId(), floor_id: s.floorId, kind: 'door', x: spot.x, y: spot.y, label: null, rotation_deg: spot.rotationDeg, width: DOOR_W };
        const tryRows = withChange(s.rows, { ...c, features: [...c.features, door] });
        link = linkWalkable(tryRows, t.nodeId!, main, s.floorId);
        if (link) { c.features.push(door); doors++; }
      }
    }
    if (!link) { stuck.push(t.name); continue; }
    c.nodes.push(...link.nodes); c.edges.push(...link.edges); joined++;
    rows = withChange(s.rows, c);
  }
  if (joined) done.push(`${joined} place${joined === 1 ? ' is' : 's are'} now walkable`);
  if (doors) done.push(`${doors} walled-in room${doors === 1 ? ' got a door' : 's got doors'} on the wall facing the paths — check ${doors === 1 ? 'it' : 'them'} in the preview`);
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

/**
 * What to suggest next, from the map as it is: an empty floor → import or draw;
 * problems → the fix; a selection → act on it; "here" only after a click.
 * Every chip is a sentence the local parser understands (engine.test.ts checks
 * this), so a tap answers instantly and never waits for the AI.
 */
export function suggestions(s: MapState): Chip[] {
  const v = new MapView(s.rows, s.floorId);
  const here = (x: { floor_id: string }) => x.floor_id === s.floorId;
  const empty = !s.rows.walls.some(here) && !s.rows.rooms.some(here) && !s.rows.nodes.some(n => here(n) && !n.is_hallway);
  if (empty) {
    return [
      { label: 'Import my floor plan', say: 'Import my floor plan' },
      { label: 'Draw walls', say: 'I want to draw walls' },
      { label: 'Add a 6 by 4 m room', say: 'Add a 6 by 4 m room' },
      { label: 'Show me around', say: 'Show me around' },
    ];
  }
  const out: Chip[] = [];
  const health = healthOf(s);
  const fix = health.find(h => h.fix)?.fix;
  if (fix) out.push(fix.label === 'Fix it' || fix.label === 'Fix them' ? { label: 'Fix everything', say: fix.say } : fix);
  if (health.length) out.push({ label: "What's wrong?", say: "What's wrong?" });
  const selected = s.rows.rooms.find(r => s.selection.rooms.includes(r.id))?.name
    ?? s.rows.nodes.find(n => s.selection.nodes.includes(n.id))?.name;
  if (selected) out.push({ label: `Rename ${selected}…`, say: `Rename ${selected} to ` });
  const named = v.things(s.floorId).filter(t => t.kind !== 'object' && t.name);
  if (s.click) out.push({ label: 'Add a restroom here', say: 'Add a restroom here' });
  else if (named[0]) out.push({ label: `Add a restroom near ${named[0].name}`, say: `Add a restroom near ${named[0].name}` });
  if (named.length >= 2) out.push({ label: `Connect ${named[0].name} and ${named[1].name}`, say: `Connect ${named[0].name} and ${named[1].name}` });
  out.push({ label: 'Show it in 3D', say: 'Show it in 3D' });
  if (!health.length) out.push({ label: 'Place it on the world map', say: 'Place the venue on the world map' });
  out.push({ label: 'Check accessibility', say: 'Check accessibility' });
  const seen = new Set<string>();
  return out.filter(c => (seen.has(c.label) ? false : (seen.add(c.label), true))).slice(0, 4);
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
      { label: 'Next: place on world map', say: 'Place it on the world map' },
      { label: 'Check accessibility', say: 'Make the route wheelchair accessible' },
    ],
  };
}
