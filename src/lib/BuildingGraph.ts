/**
 * BuildingGraph — Unified multi-floor graph for cross-floor indoor routing.
 * Combines all floor nodes/edges into a single graph, adds cross-floor
 * connections (stairs, elevators), and delegates pathfinding to GraphEngine.
 */

import { Building, Floor, NavNode, NavEdge } from '@/data/types';
import { GraphEngine } from '@/lib/GraphEngine';
import { pxPerMeterOf } from '@/lib/navScale';
import {
  FullRoute,
  FloorTransition,
  estimateWalkingTime,
  formatWalkingTime,
  STAIRS_TIME_PENALTY,
  ELEVATOR_TIME_PENALTY,
} from '@/lib/RouteTypes';

/** Average indoor walking pace, m/s (as the turn-by-turn uses). */
const WALKING_SPEED_MPS = 1.3;

// Re-export for backward compatibility
export type { FloorTransition } from '@/lib/RouteTypes';

/** @deprecated Use FullRoute instead */
export type MultiFloorPath = FullRoute;

export interface CrossFloorEdge {
  id: string;
  fromNodeId: string;
  toNodeId: string;
  type: 'stairs' | 'elevator';
  weight: number;
}

// Floor changes, in plan units for buildings without a scale (the original values)…
const STAIRS_WEIGHT_PER_FLOOR = 50;
const ELEVATOR_WEIGHT_PER_FLOOR = 30;
// …and in real metres of walking for plans with one: a flight of stairs is
// about 8 m of effort; a lift adds the wait.
const STAIRS_M_PER_FLOOR = 8;
const ELEVATOR_M_PER_FLOOR = 12;
/** Stairs on consecutive floors line up within this distance (floors share one frame). */
const CONNECTOR_ALIGN_M = 10;

type Connector = { nodeId: string; floorId: string; type: 'stairs' | 'elevator'; x: number; y: number };

export class BuildingGraph {
  private graph: GraphEngine;
  private allNodes: NavNode[] = [];
  private allEdges: NavEdge[] = [];
  private crossFloorEdges: CrossFloorEdge[] = [];
  private floorMap: Map<string, Floor> = new Map();
  private nodeFloorMap: Map<string, string> = new Map();
  private nodeMap: Map<string, NavNode> = new Map();
  /** Plan pixels per metre (1 = plan units). */
  private pxPerMeter: number;
  /** Routing cost of each path, both ways round ("from|to"). */
  private edgeWeights = new Map<string, number>();

  constructor(building: Building, crossFloorEdges: CrossFloorEdge[] = []) {
    this.crossFloorEdges = crossFloorEdges;
    this.pxPerMeter = pxPerMeterOf(building);

    for (const floor of building.floors) {
      this.floorMap.set(floor.id, floor);
      for (const node of floor.nodes) {
        this.allNodes.push(node);
        this.nodeFloorMap.set(node.id, floor.id);
        this.nodeMap.set(node.id, node);
      }
    }
    // Each path once (an edge between floors is listed on both), measured from
    // where its ends really are — a stored length goes stale when a place is
    // moved. Paths drawn between floors keep a floor-change cost.
    const seen = new Set<string>();
    for (const floor of building.floors) {
      for (const e of floor.edges) {
        if (seen.has(e.id)) continue;
        seen.add(e.id);
        const a = this.nodeMap.get(e.fromNodeId), b = this.nodeMap.get(e.toNodeId);
        if (!a || !b) continue;
        const sameFloor = this.nodeFloorMap.get(a.id) === this.nodeFloorMap.get(b.id);
        const weight = sameFloor
          ? Math.max(Math.hypot(a.x - b.x, a.y - b.y), 1e-3)
          : Math.max(e.weight || 0, this.floorChangeWeight('stairs'));
        this.allEdges.push({ ...e, weight });
      }
    }

    for (const cfe of crossFloorEdges) {
      this.allEdges.push({
        id: cfe.id,
        fromNodeId: cfe.fromNodeId,
        toNodeId: cfe.toNodeId,
        weight: cfe.weight,
      });
    }

    for (const e of this.allEdges) { this.edgeWeights.set(`${e.fromNodeId}|${e.toNodeId}`, e.weight); this.edgeWeights.set(`${e.toNodeId}|${e.fromNodeId}`, e.weight); }
    this.graph = GraphEngine.fromNavData(this.allNodes, this.allEdges);
  }

  /** The stair and lift joins between floors (what the 3D view climbs). */
  getCrossFloorEdges(): readonly CrossFloorEdge[] { return this.crossFloorEdges; }

  private floorChangeWeight(type: 'stairs' | 'elevator') {
    if (this.pxPerMeter === 1) return type === 'elevator' ? ELEVATOR_WEIGHT_PER_FLOOR : STAIRS_WEIGHT_PER_FLOOR;
    return (type === 'elevator' ? ELEVATOR_M_PER_FLOOR : STAIRS_M_PER_FLOOR) * this.pxPerMeter;
  }

  /**
   * Joins floors at their stairs and lifts: rooms typed stairs/elevator and the
   * building's connectors (stair and lift objects). Each one is paired with the
   * nearest of the same kind on the next floor up — the staircase that really
   * continues there, not every staircase in the building.
   */
  static fromBuilding(building: Building): BuildingGraph {
    const ppm = pxPerMeterOf(building);
    const floors = [...building.floors].sort((a, b) => a.level - b.level);
    const connectorsOn = (floor: Floor): Connector[] => {
      const out = new Map<string, Connector>();
      for (const r of floor.rooms) {
        if ((r.type === 'stairs' || r.type === 'elevator') && r.nodeId) {
          const n = floor.nodes.find(x => x.id === r.nodeId);
          if (n) out.set(`${n.id}:${r.type}`, { nodeId: n.id, floorId: floor.id, type: r.type, x: n.x, y: n.y });
        }
      }
      for (const c of building.connectors ?? []) {
        if (c.floorId !== floor.id) continue;
        const n = floor.nodes.find(x => x.id === c.nodeId);
        if (n) out.set(`${n.id}:${c.type}`, { ...c, x: n.x, y: n.y });
      }
      return [...out.values()];
    };

    const crossEdges: CrossFloorEdge[] = [];
    for (let i = 0; i < floors.length - 1; i++) {
      const lower = connectorsOn(floors[i]);
      const upper = connectorsOn(floors[i + 1]);
      for (const type of ['stairs', 'elevator'] as const) {
        const lo = lower.filter(c => c.type === type), up = upper.filter(c => c.type === type);
        if (!lo.length || !up.length) continue;
        // One of each: they're the same staircase, wherever each plan put it.
        const alone = lo.length === 1 && up.length === 1;
        const reach = ppm === 1 ? Infinity : CONNECTOR_ALIGN_M * ppm;
        const linked = new Set<string>();
        const link = (a: Connector, b: Connector) => {
          const id = `cross-${a.nodeId}-${b.nodeId}`;
          if (linked.has(id) || a.nodeId === b.nodeId) return;
          linked.add(id);
          const weight = ppm === 1
            ? (type === 'elevator' ? ELEVATOR_WEIGHT_PER_FLOOR : STAIRS_WEIGHT_PER_FLOOR)
            : (type === 'elevator' ? ELEVATOR_M_PER_FLOOR : STAIRS_M_PER_FLOOR) * ppm;
          crossEdges.push({ id, fromNodeId: a.nodeId, toNodeId: b.nodeId, type, weight });
        };
        const nearest = (c: Connector, pool: Connector[]) => pool.reduce((best, p) => (Math.hypot(p.x - c.x, p.y - c.y) < Math.hypot(best.x - c.x, best.y - c.y) ? p : best));
        for (const c of lo) { const n = nearest(c, up); if (alone || Math.hypot(n.x - c.x, n.y - c.y) <= reach) link(c, n); }
        for (const c of up) { const n = nearest(c, lo); if (alone || Math.hypot(n.x - c.x, n.y - c.y) <= reach) link(n, c); }
      }
    }

    return new BuildingGraph(building, crossEdges);
  }

  /**
   * Find shortest path and return a FullRoute with nodes, distance,
   * estimated walking time, and floor transitions.
   */
  findPath(startNodeId: string, endNodeId: string): FullRoute | null {
    const result = this.graph.findShortestPath(startNodeId, endNodeId);
    if (!result) return null;

    const floors: string[] = [];
    const transitions: FloorTransition[] = [];
    let prevFloorId: string | null = null;

    const resolvedNodes: NavNode[] = [];

    for (let i = 0; i < result.nodeIds.length; i++) {
      const nodeId = result.nodeIds[i];
      const node = this.nodeMap.get(nodeId);
      if (node) resolvedNodes.push(node);

      const floorId = this.nodeFloorMap.get(nodeId) ?? '';

      if (floorId !== prevFloorId) {
        if (!floors.includes(floorId)) floors.push(floorId);

        if (prevFloorId !== null) {
          const prevNodeId = result.nodeIds[i - 1];
          const cfe = this.crossFloorEdges.find(e =>
            (e.fromNodeId === prevNodeId && e.toNodeId === nodeId) ||
            (e.fromNodeId === nodeId && e.toNodeId === prevNodeId),
          );
          const prevFloor = this.floorMap.get(prevFloorId);
          const curFloor = this.floorMap.get(floorId);
          const direction =
            (curFloor?.level ?? 0) > (prevFloor?.level ?? 0) ? 'up' : 'down';

          transitions.push({
            index: i,
            fromFloorId: prevFloorId,
            toFloorId: floorId,
            viaNodeId: prevNodeId,
            arrivalNodeId: nodeId,
            type: cfe?.type ?? 'stairs',
            direction,
          });
        }
        prevFloorId = floorId;
      }
    }

    // Walking time: plan units at the original pace for unscaled plans; real
    // metres at walking speed (floor changes counted by their own penalty, not
    // their routing cost) for plans with a scale.
    let seconds: number;
    let walkM: number | undefined;
    if (this.pxPerMeter === 1) seconds = estimateWalkingTime(result.distance, transitions);
    else {
      const changePx = transitions.reduce((sum, t) => sum + (this.edgeWeights.get(`${t.viaNodeId}|${t.arrivalNodeId}`) ?? 0), 0);
      walkM = Math.max(0, result.distance - changePx) / this.pxPerMeter;
      seconds = Math.round(walkM / WALKING_SPEED_MPS + transitions.reduce((sum, t) => sum + (t.type === 'elevator' ? ELEVATOR_TIME_PENALTY : STAIRS_TIME_PENALTY), 0));
    }

    return {
      nodeIds: result.nodeIds,
      nodes: resolvedNodes,
      distance: result.distance,
      walkMeters: walkM,
      estimatedSeconds: seconds,
      estimatedTimeLabel: formatWalkingTime(seconds),
      floors,
      floorTransitions: transitions,
    };
  }

  getNodeFloorId(nodeId: string): string | undefined {
    return this.nodeFloorMap.get(nodeId);
  }

  getNode(nodeId: string): NavNode | undefined {
    return this.nodeMap.get(nodeId);
  }

  getAllNodes(): NavNode[] {
    return this.allNodes;
  }

  getFloor(floorId: string): Floor | undefined {
    return this.floorMap.get(floorId);
  }

  getFloorNodes(floorId: string): NavNode[] {
    return this.allNodes.filter(n => this.nodeFloorMap.get(n.id) === floorId);
  }

  /** The node nearest to a point, optionally on one floor only. */
  findNearest(x: number, y: number, floorId?: string): NavNode | null {
    const candidates = floorId ? this.allNodes.filter(n => this.nodeFloorMap.get(n.id) === floorId) : this.allNodes;
    let best: NavNode | null = null;
    let bestDist = Infinity;
    for (const n of candidates) {
      const d = (n.x - x) ** 2 + (n.y - y) ** 2;
      if (d < bestDist) { bestDist = d; best = n; }
    }
    return best;
  }
}
