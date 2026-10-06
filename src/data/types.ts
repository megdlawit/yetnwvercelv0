export interface Building {
  id: string;
  name: string;
  address: string;
  city: string;
  floors: Floor[];
  /** Optional geo-anchor for hybrid indoor/outdoor positioning. */
  originLat?: number | null;
  originLng?: number | null;
  rotationDeg?: number | null;
  metersPerPixel?: number | null;
  /** Approx. footprint radius (meters) for environment detection. */
  radiusM?: number | null;
  /**
   * The plan's own scale: pixels per real metre as drawn (the editor and CAD
   * import draw at 40). Distances, steps and arrival use this — not
   * metersPerPixel, which only places the plan on the world map.
   */
  planPxPerMeter?: number | null;
  /** Stairs and lifts that join floors (a path point at each), beyond rooms typed as stairs/elevator. */
  connectors?: { nodeId: string; floorId: string; type: 'stairs' | 'elevator' }[];
}

export interface Floor {
  id: string;
  buildingId: string;
  level: number;
  name: string;
  width: number;
  height: number;
  rooms: Room[];
  nodes: NavNode[];
  edges: NavEdge[];
  walls: Wall[];
}

export interface Room {
  id: string;
  floorId: string;
  name: string;
  nodeId: string; // reference to the navigation node
  x: number;
  y: number;
  width: number;
  height: number;
  type: 'office' | 'meeting' | 'entrance' | 'stairs' | 'elevator' | 'restroom' | 'reception' | 'utility';
  /** Outline when the room isn't a rectangle; x/y/width/height are then its bounding box. */
  polygon?: { x: number; y: number }[];
}

export interface NavNode {
  id: string;
  floorId: string;
  name: string;
  x: number;
  y: number;
  isHallway: boolean;
}

export interface NavEdge {
  id: string;
  fromNodeId: string;
  toNodeId: string;
  weight: number; // distance
}

export interface Wall {
  x1: number;
  y1: number;
  x2: number;
  y2: number;
}

export interface NavigationResult {
  path: NavNode[];
  distance: number;
}
