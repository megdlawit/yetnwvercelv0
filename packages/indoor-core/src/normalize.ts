// Turning what a venue stored into the one metre-based model (model.ts).
//
//   fromPlan  – venues drawn in the floor editor or imported from CAD:
//               editor pixels (40 px = 1 m), the floors / walls / rooms /
//               map_features / nodes / edges / pois tables.
//   fromGeo   – outdoor-style venues drawn straight on the map: venue_nodes
//               and venue_paths in lat/lng.
//
// Both are forgiving about older data: doors not yet anchored to a wall are
// snapped to the nearest one, floors with no elevation are stacked a storey
// apart, and a floor change in the path graph with no stairs drawn gets a
// stair (or lift) worked out from where its two ends are.

import {
  DEFAULT_CEILING, DEFAULT_WALL_THICKNESS, ELEVATOR_SECONDS, OPENING_DEFAULTS, RISER, STAIRS_SECONDS, STOREY_HEIGHT, TREAD, WALK_SPEED,
  type ConnectorKind, type EdgeKind, type FloorMaterial, type GeoFrame, type IndoorConnector, type IndoorEdge, type IndoorFloor,
  type IndoorNode, type IndoorOpening, type IndoorPoi, type IndoorProp, type PropKind, PROP_SIZES, type IndoorRoom, type IndoorVenue, type IndoorWall, type OpeningKind,
  type Text2, type Vec2, type WallMaterial,
} from './model';
import { add, centroid, dist, lerp, norm, pointInPolygon, project, rot, scale, segmentsCross, sub, v } from './geometry';
import { geoToModel } from './geo';

// ── Input rows (the database's own shape; extra columns are ignored) ─────────

type N = number | null | undefined;
type S = string | null | undefined;

export interface PlanRows {
  building: { id: string; name: string; name_am?: S; origin_lat?: N; origin_lng?: N; rotation_deg?: N; meters_per_pixel?: N };
  floors: { id: string; name: string; level: number; elevation_m?: N; ceiling_height_m?: N; sort_order?: N; name_am?: S }[];
  walls: { id: string; floor_id: string; x1: number; y1: number; x2: number; y2: number; thickness_m?: N; height_m?: N; material?: S }[];
  rooms: { id: string; floor_id: string; name: S; x: number; y: number; width: number; height: number; polygon?: unknown; type?: S; node_id?: S; name_am?: S; floor_material?: S; has_ceiling?: boolean | null }[];
  map_features: {
    id: string; floor_id: string; kind: string; x: number; y: number; rotation_deg?: N; width?: N; depth?: N; label?: S;
    wall_id?: S; offset_m?: N; height_m?: N; sill_m?: N; from_floor_id?: S; to_floor_id?: S; step_count?: N; landing?: S; accessible?: boolean | null; label_am?: S;
  }[];
  nodes: { id: string; floor_id: string; name?: S; x: number; y: number; is_hallway?: boolean | null }[];
  edges: { id: string; from_node: string; to_node: string; connection?: S; accessible?: boolean | null }[];
  pois?: {
    id: string; node_id?: S; room_id?: S; floor_id?: S; name: string; name_am?: S; description?: S; description_am?: S;
    category?: S; images?: string[] | null; image_url?: S; audio_url?: S; is_visible?: boolean | null;
  }[];
}

export interface PlanOptions {
  /** Plan pixels per metre (the editor draws at 40). */
  pxPerMeter?: number;
  /** The venue's default wall / ceiling height (map settings), metres. */
  wallHeight?: number;
}

const WALL_MATERIALS: WallMaterial[] = ['plaster', 'brick', 'concrete', 'glass', 'wood', 'stone'];
const FLOOR_MATERIALS: FloorMaterial[] = ['tile', 'wood', 'carpet', 'concrete', 'stone', 'marble', 'grass'];
const pick = <T extends string>(val: S, allowed: T[], fallback: T): T => (allowed.includes(val as T) ? (val as T) : fallback);
const text = (en: S, am?: S): Text2 => ({ en: en ?? '', am: am || null });
const num = (x: N, fallback: number) => (typeof x === 'number' && Number.isFinite(x) ? x : fallback);

/** How close (m) a door must be to a wall to be cut into it. */
const SNAP_OPENING = 0.75;
/** How far (m) from a stair's footprint a floor-change path point may be and still belong to it. */
const CONNECTOR_REACH = 2.5;

export function fromPlan(rows: PlanRows, opts: PlanOptions = {}): IndoorVenue {
  const ppm = opts.pxPerMeter && opts.pxPerMeter > 0 ? opts.pxPerMeter : 40;
  const P = (x: number, y: number): Vec2 => v(x / ppm, y / ppm);
  const ceilingDefault = num(opts.wallHeight, DEFAULT_CEILING);

  // Floors: bottom to top, each a storey above the last unless told otherwise.
  const floorRows = [...rows.floors].sort((a, b) => num(a.sort_order, a.level) - num(b.sort_order, b.level) || a.level - b.level);
  const floors: IndoorFloor[] = floorRows.map((f, i) => {
    const ceilingHeight = num(f.ceiling_height_m, ceilingDefault);
    return { id: f.id, name: text(f.name, f.name_am), level: f.level, order: i, elevation: num(f.elevation_m, f.level * Math.max(STOREY_HEIGHT, ceilingHeight + 0.3)), ceilingHeight };
  });
  const floorById = new Map(floors.map(f => [f.id, f]));

  const walls: IndoorWall[] = rows.walls.filter(w => floorById.has(w.floor_id) && (w.x1 !== w.x2 || w.y1 !== w.y2)).map(w => ({
    id: w.id, floorId: w.floor_id, a: P(w.x1, w.y1), b: P(w.x2, w.y2),
    thickness: num(w.thickness_m, DEFAULT_WALL_THICKNESS),
    height: num(w.height_m, floorById.get(w.floor_id)!.ceilingHeight),
    material: pick(w.material, WALL_MATERIALS, 'plaster'),
  }));
  const wallById = new Map(walls.map(w => [w.id, w]));
  const wallsOn = groupBy(walls, w => w.floorId);

  const rooms: IndoorRoom[] = rows.rooms.filter(r => floorById.has(r.floor_id)).map(r => {
    const poly = parsePolygon(r.polygon)?.map(p => P(p.x, p.y))
      ?? [P(r.x, r.y), P(r.x + r.width, r.y), P(r.x + r.width, r.y + r.height), P(r.x, r.y + r.height)];
    return { id: r.id, floorId: r.floor_id, name: text(r.name, r.name_am), polygon: poly, floorMaterial: pick(r.floor_material, FLOOR_MATERIALS, 'tile'), ceiling: r.has_ceiling ?? true, type: r.type ?? 'office', nodeId: r.node_id ?? null };
  });

  // Doors, arches and windows, cut into their wall.
  const openings: IndoorOpening[] = [];
  for (const f of rows.map_features) {
    if (!floorById.has(f.floor_id)) continue;
    const kind: OpeningKind | null = f.kind === 'door' || f.kind === 'arch' || f.kind === 'window' ? f.kind : f.kind === 'entrance' ? 'door' : null;
    if (!kind) continue;
    const at0 = P(f.x, f.y);
    const d = OPENING_DEFAULTS[kind];
    let wall = f.wall_id ? wallById.get(f.wall_id) ?? null : null;
    let offset: number | null = wall ? num(f.offset_m, NaN) : null;
    if (wall && !Number.isFinite(offset!)) offset = project(at0, wall.a, wall.b).t * dist(wall.a, wall.b);
    if (!wall) {
      let best: { w: IndoorWall; t: number; d: number } | null = null;
      for (const w of wallsOn.get(f.floor_id) ?? []) { const p = project(at0, w.a, w.b); if (!best || p.d < best.d) best = { w, t: p.t, d: p.d }; }
      if (best && best.d <= SNAP_OPENING) { wall = best.w; offset = best.t * dist(best.w.a, best.w.b); }
      else if (f.kind === 'entrance') continue; // an entrance marker in the open, not a doorway
    }
    const width = f.width != null ? f.width / ppm : d.width;
    if (wall) {
      const L = dist(wall.a, wall.b);
      const w2 = Math.min(width, Math.max(0.3, L - 0.1));
      const off = Math.max(w2 / 2, Math.min(L - w2 / 2, offset!));
      openings.push({
        id: f.id, floorId: f.floor_id, kind, wallId: wall.id, offset: off, width: w2,
        height: Math.min(num(f.height_m, d.height), wall.height - 0.05), sill: kind === 'window' ? num(f.sill_m, d.sill) : 0,
        at: lerp(wall.a, wall.b, off / L), angle: Math.atan2(wall.b.z - wall.a.z, wall.b.x - wall.a.x), label: f.label ? text(f.label, f.label_am) : null,
      });
    } else {
      openings.push({
        id: f.id, floorId: f.floor_id, kind, wallId: null, offset: 0, width, height: num(f.height_m, d.height), sill: kind === 'window' ? num(f.sill_m, d.sill) : 0,
        at: at0, angle: num(f.rotation_deg, 0) * Math.PI / 180, label: f.label ? text(f.label, f.label_am) : null,
      });
    }
  }

  // Scenery and markers.
  const PROP_KINDS: PropKind[] = ['tree', 'bench', 'furniture', 'landmark', 'entrance', 'label'];
  const props: IndoorProp[] = rows.map_features.filter(f => floorById.has(f.floor_id) && PROP_KINDS.includes(f.kind as PropKind)).map(f => {
    const kind = f.kind as PropKind;
    return { id: f.id, floorId: f.floor_id, kind, at: P(f.x, f.y), width: f.width != null ? f.width / ppm : PROP_SIZES[kind].width, depth: f.depth != null ? f.depth / ppm : PROP_SIZES[kind].depth,
      angle: num(f.rotation_deg, 0) * Math.PI / 180, label: f.label ? text(f.label, f.label_am) : null };
  });

  // Path graph.
  const nodes: IndoorNode[] = rows.nodes.filter(n => floorById.has(n.floor_id)).map(n => ({ id: n.id, floorId: n.floor_id, at: P(n.x, n.y), name: n.name ? text(n.name) : null, hallway: !!n.is_hallway }));
  const nodeById = new Map(nodes.map(n => [n.id, n]));
  for (const r of rooms) if (r.nodeId && nodeById.has(r.nodeId)) nodeById.get(r.nodeId)!.name = r.name;
  const roomByNode = new Map(rooms.filter(r => r.nodeId).map(r => [r.nodeId!, r]));

  // Drawn stairs and lifts.
  const drawn = rows.map_features.filter(f => (f.kind === 'stairs' || f.kind === 'elevator') && floorById.has(f.floor_id)).map(f => {
    const kind = f.kind as ConnectorKind;
    const rad = num(f.rotation_deg, 0) * Math.PI / 180;
    const w = f.width != null ? f.width / ppm : kind === 'stairs' ? 1.5 : 2;
    const dpt = f.depth != null ? f.depth / ppm : kind === 'stairs' ? 3 : 2;
    return { f, kind, center: P(f.x, f.y), w, d: dpt, dir: rot(v(0, 1), rad), edges: [] as { lower: IndoorNode; upper: IndoorNode; row: PlanRows['edges'][number] }[] };
  });
  const floorAbove = (id: string) => floors[floorById.get(id)!.order + 1]?.id ?? null;

  const connectors: IndoorConnector[] = [];
  const edges: IndoorEdge[] = [];
  const pending: { row: PlanRows['edges'][number]; lower: IndoorNode; upper: IndoorNode; kind: ConnectorKind }[] = [];
  const openingsOn = groupBy(openings.filter(o => o.kind !== 'window'), o => o.floorId);

  for (const e of rows.edges) {
    const a = nodeById.get(e.from_node), b = nodeById.get(e.to_node);
    if (!a || !b || a.id === b.id) continue;
    if (a.floorId === b.floorId && e.connection !== 'elevator' && e.connection !== 'escalator' && e.connection !== 'stairs' && e.connection !== 'ramp') {
      // Through a doorway if the segment crosses one (or the venue said so).
      const door = e.connection === 'door' || (openingsOn.get(a.floorId) ?? []).some(o => crossesOpening(a.at, b.at, o));
      const length = dist(a.at, b.at);
      edges.push({ id: e.id, from: a.id, to: b.id, kind: door ? 'door' : 'walk', length, seconds: length / WALK_SPEED, accessible: e.accessible ?? true, connectorId: null });
      continue;
    }
    // A floor change: lower and upper end.
    const fa = floorById.get(a.floorId)!, fb = floorById.get(b.floorId)!;
    const [lower, upper] = fa.order <= fb.order ? [a, b] : [b, a];
    const kind: ConnectorKind = isConnector(e.connection) ? e.connection
      : [roomByNode.get(a.id)?.type, roomByNode.get(b.id)?.type].includes('elevator') || drawn.some(d => d.kind === 'elevator' && d.f.floor_id === lower.floorId && dist(d.center, lower.at) < CONNECTOR_REACH) ? 'elevator' : 'stairs';
    pending.push({ row: e, lower, upper, kind });
  }

  // Each floor change climbs a drawn stair/lift when one is close, else one worked out from its ends.
  for (const p of pending) {
    const near = drawn
      .filter(d => d.kind === (p.kind === 'elevator' ? 'elevator' : 'stairs') && d.f.floor_id === p.lower.floorId)
      .map(d => ({ d, gap: footprintGap(p.lower.at, d.center, d.w, d.d, d.dir) }))
      .filter(x => x.gap <= CONNECTOR_REACH)
      .sort((x, y) => x.gap - y.gap)[0];
    if (near) near.d.edges.push({ lower: p.lower, upper: p.upper, row: p.row });
    else {
      const c = inferConnector(p.row.id, p.kind, p.lower, p.upper, floorById, rows.edges, nodeById);
      connectors.push(c);
      edges.push(connectorEdge(p.row, p.lower, p.upper, c, floorById));
    }
  }
  for (const d of drawn) {
    const from = d.f.from_floor_id && floorById.has(d.f.from_floor_id) ? d.f.from_floor_id : d.f.floor_id;
    const to = d.f.to_floor_id && floorById.has(d.f.to_floor_id) ? d.f.to_floor_id : d.edges[0]?.upper.floorId ?? floorAbove(from);
    if (!to || to === from) continue;
    const [lo, hi] = floorById.get(from)!.order <= floorById.get(to)!.order ? [from, to] : [to, from];
    // Which end is the bottom: the end nearer the path point on the lower floor.
    let dir = d.dir;
    const L = d.edges[0]?.lower;
    if (L && dist(L.at, add(d.center, scale(dir, d.d / 2))) < dist(L.at, sub(d.center, scale(dir, d.d / 2)))) dir = scale(dir, -1);
    const rise = floorById.get(hi)!.elevation - floorById.get(lo)!.elevation;
    const half = d.kind === 'elevator' ? 0 : d.d / 2;
    const c: IndoorConnector = {
      id: d.f.id, kind: d.kind, fromFloorId: lo, toFloorId: hi, center: d.center, width: d.w, depth: d.d, dir,
      bottom: sub(d.center, scale(dir, half)), top: add(d.center, scale(dir, half)),
      steps: d.kind === 'elevator' ? 0 : Math.max(2, Math.round(num(d.f.step_count, rise / RISER))),
      landing: pick(d.f.landing, ['none', 'mid', 'top'], d.kind === 'stairs' && rise / RISER > 18 ? 'mid' : 'none'),
      accessible: d.f.accessible ?? d.kind === 'elevator', label: d.f.label ? text(d.f.label, d.f.label_am) : null, drawn: true,
    };
    connectors.push(c);
    for (const e of d.edges) edges.push(connectorEdge(e.row, e.lower, e.upper, c, floorById));
  }

  // Places.
  const pois: IndoorPoi[] = [];
  for (const p of rows.pois ?? []) {
    if (p.is_visible === false) continue;
    const node = p.node_id ? nodeById.get(p.node_id) : undefined;
    const room = (p.room_id && rooms.find(r => r.id === p.room_id)) || (node && roomByNode.get(node.id)) || (node && rooms.find(r => r.floorId === node.floorId && pointInPolygon(node.at, r.polygon))) || undefined;
    const floorId = node?.floorId ?? room?.floorId ?? (p.floor_id && floorById.has(p.floor_id) ? p.floor_id : null);
    if (!floorId) continue;
    pois.push({
      id: p.id, floorId, nodeId: node?.id ?? null, roomId: room?.id ?? null, at: node?.at ?? (room ? centroid(room.polygon) : v(0, 0)),
      name: text(p.name, p.name_am), blurb: text(p.description, p.description_am), category: p.category ?? 'attraction',
      images: p.images?.length ? p.images : p.image_url ? [p.image_url] : [], audioUrl: p.audio_url ?? null,
    });
  }

  const b = rows.building;
  const mpp = b.meters_per_pixel && b.meters_per_pixel > 0 && b.meters_per_pixel < 0.5 ? b.meters_per_pixel : 1 / ppm;
  const geo: GeoFrame | null = b.origin_lat != null && b.origin_lng != null
    ? { lat: b.origin_lat, lng: b.origin_lng, rotationDeg: num(b.rotation_deg, 0), scale: mpp * ppm } : null;

  return { id: b.id, name: text(b.name, b.name_am), source: 'plan', floors, walls, openings, rooms, connectors, props, pois, nodes, edges, geo, bounds: boundsOf(walls, rooms, nodes) };
}

// ── Geo-native venues (venue_nodes / venue_paths) ─────────────────────────────

export interface GeoRows {
  building: { id: string; name: string; name_am?: S; origin_lat?: N; origin_lng?: N; rotation_deg?: N };
  venue_nodes: { id: string; name?: S; lat: number; lng: number; kind?: S }[];
  venue_paths: { id: string; from_node?: S; from_poi?: S; to_node?: S; to_poi?: S; path_type?: S }[];
  pois?: { id: string; name: string; name_am?: S; description?: S; description_am?: S; category?: S; lat?: N; lng?: N; images?: string[] | null; image_url?: S; audio_url?: S; is_visible?: boolean | null }[];
}

/** A venue drawn on the map in lat/lng: one ground level, metres from its anchor. */
export function fromGeo(rows: GeoRows): IndoorVenue {
  const b = rows.building;
  const first = rows.venue_nodes[0];
  const frame: GeoFrame = { lat: b.origin_lat ?? first?.lat ?? 0, lng: b.origin_lng ?? first?.lng ?? 0, rotationDeg: num(b.rotation_deg, 0) };
  const floor: IndoorFloor = { id: `${b.id}:ground`, name: { en: 'Ground', am: 'መሬት' }, level: 0, order: 0, elevation: 0, ceilingHeight: DEFAULT_CEILING };
  const nodes: IndoorNode[] = rows.venue_nodes.map(n => ({ id: n.id, floorId: floor.id, at: geoToModel(frame, n.lat, n.lng), name: n.name ? text(n.name) : null, hallway: (n.kind ?? 'junction') === 'junction' }));
  const pois: IndoorPoi[] = [];
  for (const p of rows.pois ?? []) {
    if (p.is_visible === false || p.lat == null || p.lng == null) continue;
    const at = geoToModel(frame, p.lat, p.lng);
    nodes.push({ id: `poi:${p.id}`, floorId: floor.id, at, name: text(p.name, p.name_am), hallway: false });
    pois.push({ id: p.id, floorId: floor.id, nodeId: `poi:${p.id}`, roomId: null, at, name: text(p.name, p.name_am), blurb: text(p.description, p.description_am), category: p.category ?? 'attraction', images: p.images?.length ? p.images : p.image_url ? [p.image_url] : [], audioUrl: p.audio_url ?? null });
  }
  const byId = new Map(nodes.map(n => [n.id, n]));
  const edges: IndoorEdge[] = [];
  for (const e of rows.venue_paths) {
    const a = byId.get(e.from_node ?? `poi:${e.from_poi}`), c = byId.get(e.to_node ?? `poi:${e.to_poi}`);
    if (!a || !c) continue;
    const length = dist(a.at, c.at);
    edges.push({ id: e.id, from: a.id, to: c.id, kind: 'walk', length, seconds: length / WALK_SPEED, accessible: e.path_type !== 'steps', connectorId: null });
  }
  return { id: b.id, name: text(b.name, b.name_am), source: 'geo', floors: [floor], walls: [], openings: [], rooms: [], connectors: [], props: [], pois, nodes, edges, geo: frame, bounds: boundsOf([], [], nodes) };
}

// ── helpers ───────────────────────────────────────────────────────────────────

function groupBy<T>(xs: T[], key: (x: T) => string): Map<string, T[]> {
  const m = new Map<string, T[]>();
  for (const x of xs) { const k = key(x); (m.get(k) ?? m.set(k, []).get(k)!).push(x); }
  return m;
}

const isConnector = (c: S): c is ConnectorKind => c === 'stairs' || c === 'elevator' || c === 'ramp' || c === 'escalator';

/** Parse a rooms.polygon jsonb value ([[x,y],…] in plan px). */
export function parsePolygon(val: unknown): { x: number; y: number }[] | undefined {
  if (!Array.isArray(val)) return undefined;
  const pts = val.filter((p): p is [number, number] => Array.isArray(p) && typeof p[0] === 'number' && typeof p[1] === 'number').map(([x, y]) => ({ x, y }));
  return pts.length >= 3 ? pts : undefined;
}

/** Does walking a→b pass through this doorway? */
function crossesOpening(a: Vec2, b: Vec2, o: IndoorOpening): boolean {
  const half = scale(v(Math.cos(o.angle), Math.sin(o.angle)), o.width / 2);
  return segmentsCross(a, b, sub(o.at, half), add(o.at, half));
}

/** Distance from p to a rotated rectangle (0 inside). */
function footprintGap(p: Vec2, c: Vec2, w: number, d: number, dir: Vec2): number {
  const rel = sub(p, c);
  const along = Math.abs(rel.x * dir.x + rel.z * dir.z) - d / 2;
  const across = Math.abs(-rel.x * dir.z + rel.z * dir.x) - w / 2;
  return Math.hypot(Math.max(0, along), Math.max(0, across));
}

/** A stair or lift for a floor change nobody drew, sized from the rise and laid out from its ends. */
function inferConnector(id: string, kind: ConnectorKind, lower: IndoorNode, upper: IndoorNode, floorById: Map<string, IndoorFloor>,
  rawEdges: PlanRows['edges'], nodeById: Map<string, IndoorNode>): IndoorConnector {
  const rise = Math.max(0.5, floorById.get(upper.floorId)!.elevation - floorById.get(lower.floorId)!.elevation);
  const base = { id: `auto:${id}`, kind, fromFloorId: lower.floorId, toFloorId: upper.floorId, label: null, drawn: false } as const;
  if (kind === 'elevator') {
    const c = lerp(lower.at, upper.at, 0.5);
    // Nobody drew it: a slim shaft, so it doesn't crowd the corridor it stands in.
    return { ...base, center: c, width: 1.2, depth: 1.2, dir: v(1, 0), bottom: c, top: c, steps: 0, landing: 'none', accessible: true };
  }
  const steps = Math.max(2, Math.round(rise / RISER));
  const run = (steps - 1) * TREAD;
  const apart = dist(lower.at, upper.at);
  let dir: Vec2, bottom: Vec2;
  if (apart >= run * 0.6) { dir = norm(sub(upper.at, lower.at)); bottom = lower.at; }
  else {
    // Stacked ends: keep going the way you walked in to the lower end.
    const prev = rawEdges.map(e => (e.to_node === lower.id ? e.from_node : e.from_node === lower.id ? e.to_node : null))
      .map(idn => (idn ? nodeById.get(idn) : undefined)).find(n => n && n.floorId === lower.floorId && dist(n.at, lower.at) > 0.2);
    dir = prev ? norm(sub(lower.at, prev.at)) : v(1, 0);
    bottom = lower.at;
  }
  const top = add(bottom, scale(dir, Math.max(run, Math.min(apart, run * 1.6))));
  return { ...base, center: lerp(bottom, top, 0.5), width: 1.4, depth: dist(bottom, top), dir, bottom, top, steps, landing: rise / RISER > 18 ? 'mid' : 'none', accessible: kind === 'ramp' };
}

function connectorEdge(row: PlanRows['edges'][number], lower: IndoorNode, upper: IndoorNode, c: IndoorConnector, floorById: Map<string, IndoorFloor>): IndoorEdge {
  const rise = Math.abs(floorById.get(c.toFloorId)!.elevation - floorById.get(c.fromFloorId)!.elevation);
  const flat = dist(lower.at, c.bottom) + dist(c.top, upper.at);
  const kind: EdgeKind = c.kind;
  let length: number, seconds: number;
  if (kind === 'elevator') { length = flat; seconds = flat / WALK_SPEED + ELEVATOR_SECONDS; }
  else {
    const slope = Math.hypot(dist(c.bottom, c.top), rise);
    length = flat + slope;
    seconds = kind === 'escalator' ? flat / WALK_SPEED + slope / 0.5 : kind === 'ramp' ? length / (WALK_SPEED * 0.85) : flat / WALK_SPEED + slope / WALK_SPEED + STAIRS_SECONDS;
  }
  const stepFree = kind === 'elevator' || kind === 'ramp';
  return { id: row.id, from: row.from_node, to: row.to_node, kind, length, seconds, accessible: stepFree && (row.accessible ?? true) && c.accessible !== false, connectorId: c.id };
}

function boundsOf(walls: IndoorWall[], rooms: IndoorRoom[], nodes: IndoorNode[]) {
  const pts: Vec2[] = [...walls.flatMap(w => [w.a, w.b]), ...rooms.flatMap(r => r.polygon), ...nodes.map(n => n.at)];
  if (!pts.length) return { min: v(0, 0), max: v(10, 10) };
  return {
    min: v(Math.min(...pts.map(p => p.x)), Math.min(...pts.map(p => p.z))),
    max: v(Math.max(...pts.map(p => p.x)), Math.max(...pts.map(p => p.z))),
  };
}

