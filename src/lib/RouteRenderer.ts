/**
 * RouteRenderer — Pure functions for generating SVG route visualization data.
 * Produces polyline points, node markers, and animation configs
 * without coupling to React or DOM.
 */

export interface RoutePoint {
  x: number;
  y: number;
  nodeId: string;
  isStart: boolean;
  isEnd: boolean;
  isWaypoint: boolean;
}

export interface RoutePolyline {
  points: string; // "x1,y1 x2,y2 ..."
  nodeCount: number;
}

export interface RouteVisualization {
  polyline: RoutePolyline;
  markers: RoutePoint[];
  startPoint: RoutePoint | null;
  endPoint: RoutePoint | null;
}

/** Build visualization data from ordered path coordinates. */
export function buildRouteVisualization(
  pathCoords: { x: number; y: number; id: string }[]
): RouteVisualization {
  if (pathCoords.length === 0) {
    return { polyline: { points: '', nodeCount: 0 }, markers: [], startPoint: null, endPoint: null };
  }

  const points = pathCoords.map(p => `${p.x},${p.y}`).join(' ');

  const markers: RoutePoint[] = pathCoords.map((p, i) => ({
    x: p.x,
    y: p.y,
    nodeId: p.id,
    isStart: i === 0,
    isEnd: i === pathCoords.length - 1,
    isWaypoint: i > 0 && i < pathCoords.length - 1,
  }));

  return {
    polyline: { points, nodeCount: pathCoords.length },
    markers,
    startPoint: markers[0] ?? null,
    endPoint: markers[markers.length - 1] ?? null,
  };
}

/** Split route into completed / remaining segments for live navigation. */
export function splitRouteAtIndex(
  pathCoords: { x: number; y: number; id: string }[],
  currentIndex: number
): { completed: RoutePolyline; remaining: RoutePolyline } {
  const completedCoords = pathCoords.slice(0, currentIndex + 1);
  const remainingCoords = pathCoords.slice(currentIndex);

  return {
    completed: {
      points: completedCoords.map(p => `${p.x},${p.y}`).join(' '),
      nodeCount: completedCoords.length,
    },
    remaining: {
      points: remainingCoords.map(p => `${p.x},${p.y}`).join(' '),
      nodeCount: remainingCoords.length,
    },
  };
}

/** Calculate total route distance from coordinates. */
export function calcRouteDistance(pathCoords: { x: number; y: number }[]): number {
  let total = 0;
  for (let i = 1; i < pathCoords.length; i++) {
    const dx = pathCoords[i].x - pathCoords[i - 1].x;
    const dy = pathCoords[i].y - pathCoords[i - 1].y;
    total += Math.sqrt(dx * dx + dy * dy);
  }
  return total;
}
