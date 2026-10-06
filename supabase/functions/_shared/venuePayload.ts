// The partner API's multi-floor venue payload, built from database rows.
//
// Pure (no Supabase, no Deno APIs), so the edge function and the web app's
// tests share it. The output is the stable public contract described in
// packages/indoor-maps-sdk/src/types.ts (IndoorMapVenue) — never raw rows.

import type { Connection, RouteEdge, RouteNode } from './routing.ts';

type N = number | null | undefined;
type S = string | null | undefined;

export interface VenueRows {
  floors: { id: string; level: number; name: string; elevation_m?: N; ceiling_height_m?: N; name_am?: S }[];
  nodes: { id: string; floor_id: string; name: string; x: number; y: number; is_hallway: boolean }[];
  edges: { id: string; from_node: string; to_node: string; weight: number; connection?: string | null; accessible?: boolean | null }[];
  rooms: { id: string; floor_id: string; name: string; type: string; node_id: string | null; x: number; y: number; width: number; height: number; polygon?: unknown; name_am?: S; floor_material?: S; has_ceiling?: boolean | null }[];
  walls: { id?: string; floor_id: string; x1: number; y1: number; x2: number; y2: number; thickness_m?: N; height_m?: N; material?: S }[];
  features: {
    id: string; floor_id: string; kind: string; x: number; y: number; rotation_deg: number; width: number | null; depth: number | null; label: string | null;
    wall_id?: S; offset_m?: N; height_m?: N; sill_m?: N; from_floor_id?: S; to_floor_id?: S; step_count?: N; landing?: S; accessible?: boolean | null; label_am?: S;
  }[];
}

/** A wall with what the 3D view needs (null = the default). */
export interface VenueWall3D { id: string; x1: number; y1: number; x2: number; y2: number; thicknessM: number | null; heightM: number | null; material: string | null }

export interface VenueFloorOut {
  id: string; level: number; name: string;
  /** 3D (all optional; null = default): height above ground, ceiling height, Amharic name. */
  elevationM?: number | null; ceilingHeightM?: number | null; nameAm?: string | null;
  /** Plan bounds in plan units (px; pxPerMeter of them make a metre). */
  bounds: { minX: number; minY: number; maxX: number; maxY: number };
  nodes: { id: string; name: string; x: number; y: number; isHallway: boolean }[];
  edges: { id: string; fromNodeId: string; toNodeId: string; weight: number }[];
  rooms: { id: string; name: string; type: string; nodeId: string | null; outline: [number, number][]; nameAm?: string | null; floorMaterial?: string | null; hasCeiling?: boolean }[];
  walls: [number, number, number, number][];
  /** The same walls with their 3D details (ids, thickness, height, material). */
  walls3d?: VenueWall3D[];
  features: {
    id: string; kind: string; x: number; y: number; rotationDeg: number; width: number | null; depth: number | null; label: string | null;
    /** 3D: the wall a door / arch / window is cut into, and where along it (m); its height and sill (m). */
    wallId?: string | null; offsetM?: number | null; heightM?: number | null; sillM?: number | null;
    /** Stairs / lifts: the floors they join, steps, landing, step-free. */
    fromFloorId?: string | null; toFloorId?: string | null; stepCount?: number | null; landing?: string | null; accessible?: boolean | null; labelAm?: string | null;
  }[];
}

export interface VenueConnectionOut {
  id: string; fromNodeId: string; toNodeId: string; fromLevel: number; toLevel: number;
  kind: Connection | null; accessible: boolean;
}

export interface VenueOut { pxPerMeter: number; floors: VenueFloorOut[]; connections: VenueConnectionOut[] }

export const PX_PER_METER = 40;

export function buildVenuePayload(r: VenueRows): VenueOut {
  const floorOfNode = new Map(r.nodes.map(n => [n.id, n.floor_id] as const));
  const levelOf = new Map(r.floors.map(f => [f.id, f.level] as const));
  const floors = [...r.floors].sort((a, b) => a.level - b.level).map(f => {
    const nodes = r.nodes.filter(n => n.floor_id === f.id);
    const ids = new Set(nodes.map(n => n.id));
    const walls = r.walls.filter(w => w.floor_id === f.id);
    const rooms = r.rooms.filter(x => x.floor_id === f.id);
    const features = r.features.filter(x => x.floor_id === f.id);
    const xs: number[] = [], ys: number[] = [];
    for (const w of walls) { xs.push(w.x1, w.x2); ys.push(w.y1, w.y2); }
    for (const n of nodes) { xs.push(n.x); ys.push(n.y); }
    for (const x of rooms) { xs.push(x.x, x.x + x.width); ys.push(x.y, x.y + x.height); }
    const bounds = xs.length
      ? { minX: Math.min(...xs), minY: Math.min(...ys), maxX: Math.max(...xs), maxY: Math.max(...ys) }
      : { minX: 0, minY: 0, maxX: 800, maxY: 500 };
    return {
      id: f.id, level: f.level, name: f.name, bounds,
      elevationM: f.elevation_m ?? null, ceilingHeightM: f.ceiling_height_m ?? null, nameAm: f.name_am ?? null,
      nodes: nodes.map(n => ({ id: n.id, name: n.name, x: n.x, y: n.y, isHallway: n.is_hallway })),
      edges: r.edges.filter(e => ids.has(e.from_node) && ids.has(e.to_node))
        .map(e => ({ id: e.id, fromNodeId: e.from_node, toNodeId: e.to_node, weight: e.weight })),
      rooms: rooms.map(x => ({ id: x.id, name: x.name, type: x.type, nodeId: x.node_id, outline: outline(x), nameAm: x.name_am ?? null, floorMaterial: x.floor_material ?? null, hasCeiling: x.has_ceiling !== false })),
      walls: walls.map(w => [w.x1, w.y1, w.x2, w.y2] as [number, number, number, number]),
      walls3d: walls.map((w, i) => ({ id: w.id ?? `${f.id}:w${i}`, x1: w.x1, y1: w.y1, x2: w.x2, y2: w.y2, thicknessM: w.thickness_m ?? null, heightM: w.height_m ?? null, material: w.material ?? null })),
      features: features.map(x => ({
        id: x.id, kind: x.kind, x: x.x, y: x.y, rotationDeg: x.rotation_deg, width: x.width, depth: x.depth, label: x.label,
        wallId: x.wall_id ?? null, offsetM: x.offset_m ?? null, heightM: x.height_m ?? null, sillM: x.sill_m ?? null,
        fromFloorId: x.from_floor_id ?? null, toFloorId: x.to_floor_id ?? null, stepCount: x.step_count ?? null, landing: x.landing ?? null, accessible: x.accessible ?? null, labelAm: x.label_am ?? null,
      })),
    };
  });
  const connections = r.edges.flatMap(e => {
    const fa = floorOfNode.get(e.from_node), fb = floorOfNode.get(e.to_node);
    if (!fa || !fb || fa === fb) return [];
    const kind = isConnection(e.connection) ? e.connection : null;
    return [{
      id: e.id, fromNodeId: e.from_node, toNodeId: e.to_node,
      fromLevel: levelOf.get(fa) ?? 0, toLevel: levelOf.get(fb) ?? 0,
      kind, accessible: kind ? kind === 'elevator' || kind === 'ramp' : e.accessible !== false,
    }];
  });
  return { pxPerMeter: PX_PER_METER, floors, connections };
}

/** Routing inputs for a whole venue (all floors, connections included). */
export function routingGraph(r: VenueRows): { nodes: RouteNode[]; edges: RouteEdge[] } {
  const floor = new Map(r.floors.map(f => [f.id, f] as const));
  const roomByNode = new Map(r.rooms.filter(x => x.node_id).map(x => [x.node_id!, x] as const));
  const nodes = r.nodes.map(n => ({
    id: n.id, floorId: n.floor_id, name: roomByNode.get(n.id)?.name || n.name, x: n.x, y: n.y, isHallway: n.is_hallway,
    floorLevel: floor.get(n.floor_id)?.level ?? 0, floorName: floor.get(n.floor_id)?.name ?? '',
    stairs: roomByNode.get(n.id)?.type === 'stairs', elevator: roomByNode.get(n.id)?.type === 'elevator',
  }));
  const edges = r.edges.map(e => ({
    id: e.id, fromNodeId: e.from_node, toNodeId: e.to_node, weight: e.weight,
    connection: isConnection(e.connection) ? e.connection : null,
    accessible: e.connection ? e.accessible ?? undefined : undefined,
  }));
  return { nodes, edges };
}

const isConnection = (c: unknown): c is Connection => c === 'stairs' || c === 'elevator' || c === 'ramp' || c === 'escalator';

function outline(x: VenueRows['rooms'][number]): [number, number][] {
  if (Array.isArray(x.polygon) && x.polygon.length >= 3 && x.polygon.every(p => Array.isArray(p) && p.length >= 2)) {
    return (x.polygon as [number, number][]).map(([px, py]) => [px, py]);
  }
  return [[x.x, x.y], [x.x + x.width, x.y], [x.x + x.width, x.y + x.height], [x.x, x.y + x.height]];
}
