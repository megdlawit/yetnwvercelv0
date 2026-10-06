/**
 * GraphEngine — In-memory graph for indoor routing.
 * Builds adjacency list from nodes/edges. Auto-calculates edge distances
 * from coordinates when weight is not provided. Exposes nearest-node lookup.
 */

import { NavNode, NavEdge } from '@/data/types';

export interface GraphNode {
  id: string;
  x: number;
  y: number;
  floor: number;
  type: 'room' | 'intersection' | 'stairs' | 'elevator';
}

export interface GraphEdge {
  from: string;
  to: string;
  distance: number;
}

interface AdjEntry {
  nodeId: string;
  distance: number;
}

export class GraphEngine {
  private adj = new Map<string, AdjEntry[]>();
  private nodeMap = new Map<string, GraphNode>();

  constructor(nodes: GraphNode[], edges: GraphEdge[]) {
    this.build(nodes, edges);
  }

  /** Build from typed NavNode/NavEdge (existing data model). Auto-calculates distance. */
  static fromNavData(nodes: NavNode[], edges: NavEdge[]): GraphEngine {
    const nodeMap = new Map(nodes.map(n => [n.id, n]));

    const graphNodes: GraphNode[] = nodes.map(n => ({
      id: n.id,
      x: n.x,
      y: n.y,
      floor: 1,
      type: n.isHallway ? 'intersection' as const : 'room' as const,
    }));

    const graphEdges: GraphEdge[] = edges.map(e => {
      const from = nodeMap.get(e.fromNodeId);
      const to = nodeMap.get(e.toNodeId);
      const autoDistance =
        from && to
          ? Math.sqrt((to.x - from.x) ** 2 + (to.y - from.y) ** 2)
          : e.weight;
      return { from: e.fromNodeId, to: e.toNodeId, distance: e.weight || autoDistance };
    });

    return new GraphEngine(graphNodes, graphEdges);
  }

  private build(nodes: GraphNode[], edges: GraphEdge[]) {
    this.nodeMap.clear();
    this.adj.clear();

    for (const n of nodes) {
      this.nodeMap.set(n.id, n);
      this.adj.set(n.id, []);
    }

    for (const e of edges) {
      const dist = e.distance > 0 ? e.distance : this.calcDistance(e.from, e.to);
      this.adj.get(e.from)?.push({ nodeId: e.to, distance: dist });
      this.adj.get(e.to)?.push({ nodeId: e.from, distance: dist });
    }
  }

  private calcDistance(a: string, b: string): number {
    const na = this.nodeMap.get(a);
    const nb = this.nodeMap.get(b);
    if (!na || !nb) return Infinity;
    return Math.sqrt((nb.x - na.x) ** 2 + (nb.y - na.y) ** 2);
  }

  getNode(id: string): GraphNode | undefined {
    return this.nodeMap.get(id);
  }

  getNeighbors(id: string): AdjEntry[] {
    return this.adj.get(id) ?? [];
  }

  getAllNodes(): GraphNode[] {
    return Array.from(this.nodeMap.values());
  }

  getAllNodeIds(): string[] {
    return Array.from(this.nodeMap.keys());
  }

  /** Find nearest node to (x, y) */
  findNearest(x: number, y: number): GraphNode | null {
    let best: GraphNode | null = null;
    let bestDist = Infinity;
    for (const n of this.nodeMap.values()) {
      const d = (n.x - x) ** 2 + (n.y - y) ** 2;
      if (d < bestDist) { bestDist = d; best = n; }
    }
    return best;
  }

  /** Dijkstra shortest path. Returns ordered node IDs + total distance, or null. */
  findShortestPath(startId: string, endId: string): { nodeIds: string[]; distance: number } | null {
    if (!this.nodeMap.has(startId) || !this.nodeMap.has(endId)) return null;

    const dist = new Map<string, number>();
    const prev = new Map<string, string | null>();
    const visited = new Set<string>();

    for (const id of this.nodeMap.keys()) {
      dist.set(id, Infinity);
      prev.set(id, null);
    }
    dist.set(startId, 0);

    while (true) {
      let minDist = Infinity;
      let current: string | null = null;
      for (const [id, d] of dist) {
        if (!visited.has(id) && d < minDist) { minDist = d; current = id; }
      }
      if (current === null || current === endId) break;
      visited.add(current);

      for (const neighbor of this.adj.get(current) ?? []) {
        if (visited.has(neighbor.nodeId)) continue;
        const alt = minDist + neighbor.distance;
        if (alt < (dist.get(neighbor.nodeId) ?? Infinity)) {
          dist.set(neighbor.nodeId, alt);
          prev.set(neighbor.nodeId, current);
        }
      }
    }

    if (dist.get(endId) === Infinity) return null;

    const nodeIds: string[] = [];
    let cur: string | null = endId;
    while (cur) {
      nodeIds.unshift(cur);
      cur = prev.get(cur) ?? null;
    }

    return { nodeIds, distance: dist.get(endId) ?? 0 };
  }
}
