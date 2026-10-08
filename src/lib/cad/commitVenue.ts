// Saves a built venue to Supabase for one floor, with the signed-in user's
// session, so RLS (user_can_edit_building) applies exactly as for every other
// edit. Re-importing replaces only rows a previous import created (source ≠
// 'manual'); anything drawn by hand stays.

import type { SupabaseClient } from '@supabase/supabase-js';
import type { Database } from '@/integrations/supabase/types';
import { generatePathGraph, type PathGraphResult } from '../dxf/generatePathGraph';
import { buildRouteGraph } from './routeGraph';
import type { BuiltVenue } from './buildVenue';
import { repairPathsThroughWalls, type PlanRows } from '@ethi/indoor-core';

const CHUNK = 500;

export interface CommitResult { walls: number; rooms: number; nodes: number; edges: number; features: number; warnings: string[] }

const ROOM_TYPE_BY_NAME: [RegExp, string][] = [
  [/toilet|\bwc\b|restroom|bath|lavator|ሽንት/i, 'restroom'],
  [/stair|ደረጃ/i, 'stairs'],
  [/lift|elevat|ሊፍት/i, 'elevator'],
  [/entr|lobby|foyer|gate|መግቢያ/i, 'entrance'],
  [/recep|info|ticket|desk/i, 'reception'],
  [/meet|conf|board|seminar/i, 'meeting'],
  [/store|mech|elec|plant|util|server|janitor|clean/i, 'utility'],
];
export const roomTypeFromName = (name: string) => ROOM_TYPE_BY_NAME.find(([re]) => re.test(name))?.[1] ?? 'office';

async function chunked<T>(rows: T[], insert: (part: T[]) => PromiseLike<{ error: { message: string } | null; data?: unknown }>) {
  const results: unknown[] = [];
  for (let i = 0; i < rows.length; i += CHUNK) {
    const { error, data } = await insert(rows.slice(i, i + CHUNK));
    if (error) throw new Error(error.message);
    if (Array.isArray(data)) results.push(...data);
  }
  return results;
}

export async function commitVenue(
  supabase: SupabaseClient<Database>, buildingId: string, floorId: string, venue: BuiltVenue, source: string, pxPerMeter = 40,
  /** The walkable paths, when already worked out (walkableGraph) — e.g. to show them while saving. */
  graph: PathGraphResult = walkableGraph(venue, pxPerMeter),
): Promise<CommitResult> {
  const warnings = [...graph.warnings];

  // ── what this database supports — checked before anything is deleted ──────
  // map_features and rooms.polygon arrive with migration 20260930150000. A
  // database without it still gets walls, rooms and paths; objects and room
  // shapes are skipped with a warning instead of failing half-way through.
  const hasFeatures = !(await supabase.from('map_features').select('id').limit(1)).error;
  const hasPolygons = !(await supabase.from('rooms').select('polygon').limit(1)).error;
  if (!hasFeatures && venue.features.length) {
    warnings.push(`${venue.features.length} objects (doors, stairs, trees…) weren't saved: the database needs migration 20260930150000. Run it in the Supabase SQL editor and import again.`);
  }
  if (!hasPolygons && venue.rooms.some(r => r.polygon.length !== 4)) {
    warnings.push('Room shapes were saved as rectangles: the database needs migration 20260930150000 for exact shapes.');
  }

  // ── remove the previous import (edges → nodes → the rest) ──────────────────
  const { data: oldNodes, error: oldErr } = await supabase.from('nodes').select('id').eq('floor_id', floorId).neq('source', 'manual');
  if (oldErr) throw new Error(oldErr.message);
  const oldIds = (oldNodes ?? []).map(n => n.id);
  for (let i = 0; i < oldIds.length; i += CHUNK) {
    const part = oldIds.slice(i, i + CHUNK);
    const a = await supabase.from('edges').delete().in('from_node', part);
    if (a.error) throw new Error(a.error.message);
    const b = await supabase.from('edges').delete().in('to_node', part);
    if (b.error) throw new Error(b.error.message);
  }
  for (const table of ['rooms', 'nodes', 'walls', ...(hasFeatures ? ['map_features' as const] : [])] as const) {
    const { error } = await supabase.from(table).delete().eq('floor_id', floorId).neq('source', 'manual');
    if (error) throw new Error(`Could not clear the previous import (${table}): ${error.message}`);
  }

  // ── insert ─────────────────────────────────────────────────────────────────
  const base = { building_id: buildingId, floor_id: floorId, source };
  await chunked(venue.walls.map(w => ({ ...base, x1: w.x1, y1: w.y1, x2: w.x2, y2: w.y2 })),
    part => supabase.from('walls').insert(part));

  const nodeRows = graph.nodes.map(n => ({
    ...base,
    name: n.isHallway ? '' : venue.rooms[n.roomIndex!]?.name || '',
    x: Math.round(n.x), y: Math.round(n.y), is_hallway: n.isHallway, type: n.isHallway ? 'hallway' : 'room',
  }));
  const inserted = await chunked(nodeRows, part => supabase.from('nodes').insert(part).select('id')) as { id: string }[];
  const nodeIds = inserted.map(r => r.id);

  let edgeCount = 0;
  if (nodeIds.length === graph.nodes.length) {
    const edgeRows = graph.edges.map(e => ({ building_id: buildingId, from_node: nodeIds[e.from], to_node: nodeIds[e.to], weight: e.weight, source }));
    await chunked(edgeRows, part => supabase.from('edges').insert(part));
    edgeCount = edgeRows.length;
  }

  const roomNode = new Map<number, string>();
  graph.nodes.forEach((n, i) => { if (!n.isHallway && n.roomIndex !== null && nodeIds[i]) roomNode.set(n.roomIndex, nodeIds[i]); });
  await chunked(venue.rooms.map((r, i) => ({
    ...base, node_id: roomNode.get(i) ?? null, name: r.name,
    x: r.x, y: r.y, width: r.width, height: r.height, type: roomTypeFromName(r.name),
    ...(hasPolygons ? { polygon: r.polygon.map(p => [p.x, p.y]) } : {}),
  })), part => supabase.from('rooms').insert(part));

  if (hasFeatures) {
    await chunked(venue.features.map(f => ({
      ...base, kind: f.kind, x: f.x, y: f.y, rotation_deg: f.rotationDeg,
      width: f.width ?? null, depth: f.depth ?? null, label: f.label ?? null,
    })), part => supabase.from('map_features').insert(part));
  }

  return {
    walls: venue.walls.length, rooms: venue.rooms.length, nodes: nodeIds.length, edges: edgeCount,
    features: hasFeatures ? venue.features.length : 0, warnings,
  };
}

/**
 * The walkable graph for a built venue: room-to-room through its doors when
 * the plan has rooms (see routeGraph.ts), otherwise the older corridor
 * skeleton traced from the walls alone.
 */
export function walkableGraph(venue: BuiltVenue, pxPerMeter: number): PathGraphResult {
  const skeleton = generatePathGraph(venue.walls, venue.rooms.map(r => ({ name: r.name, x: r.x, y: r.y, width: r.width, height: r.height })), {});
  if (!venue.rooms.length) return throughDoors(venue, skeleton, pxPerMeter);
  const doors = venue.features.filter(f => f.kind === 'door' || f.kind === 'entrance').map(f => ({ x: f.x, y: f.y }));
  const rooms = buildRouteGraph({ walls: venue.walls, rooms: venue.rooms, doors, pxPerMeter });
  // Each method fails on different drawings (sealed door panels, leaky
  // gaps, rooms cut in pieces), so keep whichever connects more of the venue.
  return throughDoors(venue, connectivity(rooms) >= connectivity(skeleton) ? rooms : skeleton, pxPerMeter);
}

/**
 * No path is saved through a wall: each one that crosses a wall is sent round
 * it and through a doorway instead (new corner points), and one with no
 * doorway to use is left out — both reported in the import's warnings.
 */
export function throughDoors(venue: BuiltVenue, g: PathGraphResult, pxPerMeter: number): PathGraphResult {
  if (!g.edges.length || !venue.walls.length) return g;
  const F = 'f';
  const rows: PlanRows = {
    building: { id: 'b', name: '' },
    floors: [{ id: F, name: '', level: 0 }],
    walls: venue.walls.map((w, i) => ({ id: `w${i}`, floor_id: F, x1: w.x1, y1: w.y1, x2: w.x2, y2: w.y2 })),
    rooms: [],
    map_features: venue.features
      .filter(f => f.kind === 'door' || f.kind === 'entrance')
      .map((f, i) => ({ id: `d${i}`, floor_id: F, kind: f.kind, x: f.x, y: f.y, rotation_deg: f.rotationDeg, width: f.width ?? null })),
    nodes: g.nodes.map((n, i) => ({ id: `n${i}`, floor_id: F, x: n.x, y: n.y, is_hallway: n.isHallway })),
    edges: g.edges.map((e, i) => ({ id: `e${i}`, from_node: `n${e.from}`, to_node: `n${e.to}` })),
  };
  let k = 0;
  const fix = repairPathsThroughWalls(rows, { pxPerMeter, newId: () => `x${k++}` });
  if (!fix.rerouted.length && !fix.dropped.length) return g;

  const nodes = [...g.nodes];
  const index = new Map(g.nodes.map((_, i) => [`n${i}`, i]));
  for (const n of fix.nodes) { index.set(n.id, nodes.length); nodes.push({ x: n.x, y: n.y, isHallway: true, roomIndex: null }); }
  const gone = new Set([...fix.rerouted, ...fix.dropped]);
  const edges = [
    ...g.edges.filter((_, i) => !gone.has(`e${i}`)),
    ...fix.edges.map(e => ({ from: index.get(e.from_node)!, to: index.get(e.to_node)!, weight: e.weight })),
  ];
  const warnings = [...g.warnings];
  if (fix.rerouted.length) warnings.push(`${fix.rerouted.length} path${fix.rerouted.length === 1 ? '' : 's'} went through a wall and now go${fix.rerouted.length === 1 ? 'es' : ''} round it, through a doorway.`);
  if (fix.dropped.length) warnings.push(`${fix.dropped.length} path${fix.dropped.length === 1 ? '' : 's'} went through a wall with no doorway to use and ${fix.dropped.length === 1 ? 'was' : 'were'} left out — add the missing doors in the editor (Door tool) and connect those places.`);
  return { nodes, edges, warnings };
}

/** Rooms reachable from the largest network, minus a little for every extra network. */
export function connectivity(g: PathGraphResult): number {
  const parent = g.nodes.map((_, i) => i);
  const find = (i: number): number => (parent[i] === i ? i : (parent[i] = find(parent[i])));
  for (const e of g.edges) parent[find(e.from)] = find(e.to);
  const size = new Map<number, number>();
  g.nodes.forEach((_, i) => size.set(find(i), (size.get(find(i)) ?? 0) + 1));
  const main = [...size.entries()].sort((a, b) => b[1] - a[1])[0]?.[0];
  const reached = new Set(g.nodes.flatMap((n, i) => (n.roomIndex !== null && find(i) === main ? [n.roomIndex] : []))).size;
  return reached * 1000 - size.size;
}
