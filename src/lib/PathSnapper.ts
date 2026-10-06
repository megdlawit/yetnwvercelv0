/**
 * Path Snapper: projects user position onto nearest path edge segment.
 * Prevents drift by constraining movement to valid corridors.
 */

import { NavNode, NavEdge } from '@/data/types';

interface SnapResult {
  x: number;
  y: number;
  nearestNodeIndex: number;
  distanceToPath: number;
}

/** Project point P onto segment AB, return closest point on segment */
function projectToSegment(px: number, py: number, ax: number, ay: number, bx: number, by: number) {
  const dx = bx - ax, dy = by - ay;
  const lenSq = dx * dx + dy * dy;
  if (lenSq === 0) return { x: ax, y: ay, t: 0 };
  let t = ((px - ax) * dx + (py - ay) * dy) / lenSq;
  t = Math.max(0, Math.min(1, t));
  return { x: ax + t * dx, y: ay + t * dy, t };
}

/** Snap position to nearest edge in path */
export function snapToPath(
  x: number,
  y: number,
  path: NavNode[]
): SnapResult {
  let bestDist = Infinity;
  let bestX = x, bestY = y;
  let bestNodeIdx = 0;

  for (let i = 0; i < path.length - 1; i++) {
    const a = path[i], b = path[i + 1];
    const proj = projectToSegment(x, y, a.x, a.y, b.x, b.y);
    const d = Math.sqrt((x - proj.x) ** 2 + (y - proj.y) ** 2);
    if (d < bestDist) {
      bestDist = d;
      bestX = proj.x;
      bestY = proj.y;
      // Determine which node index we're closest to
      const dToA = Math.sqrt((proj.x - a.x) ** 2 + (proj.y - a.y) ** 2);
      const dToB = Math.sqrt((proj.x - b.x) ** 2 + (proj.y - b.y) ** 2);
      bestNodeIdx = dToA <= dToB ? i : i + 1;
    }
  }

  return { x: bestX, y: bestY, nearestNodeIndex: bestNodeIdx, distanceToPath: bestDist };
}

/** Snap to nearest edge across all floor edges (for rerouting) */
export function snapToNearestEdge(
  x: number,
  y: number,
  nodes: NavNode[],
  edges: NavEdge[]
): { x: number; y: number; nearestNodeId: string; distance: number } {
  const nodeMap = new Map(nodes.map(n => [n.id, n]));
  let bestDist = Infinity;
  let bestX = x, bestY = y;
  let bestNodeId = nodes[0]?.id ?? '';

  for (const edge of edges) {
    const a = nodeMap.get(edge.fromNodeId);
    const b = nodeMap.get(edge.toNodeId);
    if (!a || !b) continue;
    const proj = projectToSegment(x, y, a.x, a.y, b.x, b.y);
    const d = Math.sqrt((x - proj.x) ** 2 + (y - proj.y) ** 2);
    if (d < bestDist) {
      bestDist = d;
      bestX = proj.x;
      bestY = proj.y;
      const dToA = Math.sqrt((proj.x - a.x) ** 2 + (proj.y - a.y) ** 2);
      const dToB = Math.sqrt((proj.x - b.x) ** 2 + (proj.y - b.y) ** 2);
      bestNodeId = dToA <= dToB ? a.id : b.id;
    }
  }

  return { x: bestX, y: bestY, nearestNodeId: bestNodeId, distance: bestDist };
}
