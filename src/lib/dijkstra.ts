import { NavNode, NavEdge, NavigationResult } from '@/data/types';

interface AdjEntry {
  nodeId: string;
  weight: number;
}

export function findShortestPath(
  nodes: NavNode[],
  edges: NavEdge[],
  startId: string,
  endId: string
): NavigationResult | null {
  const adj = new Map<string, AdjEntry[]>();
  
  for (const node of nodes) {
    adj.set(node.id, []);
  }

  for (const edge of edges) {
    adj.get(edge.fromNodeId)?.push({ nodeId: edge.toNodeId, weight: edge.weight });
    adj.get(edge.toNodeId)?.push({ nodeId: edge.fromNodeId, weight: edge.weight });
  }

  const dist = new Map<string, number>();
  const prev = new Map<string, string | null>();
  const visited = new Set<string>();

  for (const node of nodes) {
    dist.set(node.id, Infinity);
    prev.set(node.id, null);
  }
  dist.set(startId, 0);

  while (true) {
    let minDist = Infinity;
    let current: string | null = null;

    for (const [id, d] of dist) {
      if (!visited.has(id) && d < minDist) {
        minDist = d;
        current = id;
      }
    }

    if (current === null || current === endId) break;
    visited.add(current);

    for (const neighbor of adj.get(current) || []) {
      if (visited.has(neighbor.nodeId)) continue;
      const alt = minDist + neighbor.weight;
      if (alt < (dist.get(neighbor.nodeId) ?? Infinity)) {
        dist.set(neighbor.nodeId, alt);
        prev.set(neighbor.nodeId, current);
      }
    }
  }

  if (dist.get(endId) === Infinity) return null;

  const path: NavNode[] = [];
  let currentId: string | null = endId;
  const nodeMap = new Map(nodes.map(n => [n.id, n]));

  while (currentId) {
    const node = nodeMap.get(currentId);
    if (node) path.unshift(node);
    currentId = prev.get(currentId) ?? null;
  }

  return { path, distance: dist.get(endId) ?? 0 };
}
