// The indoor model every part of the platform shares: the visitor app, the
// admin editor's live preview and the SDK all render and route on this.
//
// One coordinate space, in metres, whatever the venue was drawn in:
//   x  → the plan's right (east when the plan isn't rotated)
//   z  → the plan's down  (south when the plan isn't rotated)
//   y  ↑ height above the venue's ground level
// It is three.js's own frame (y up), so the renderer uses it as is.
// Plan venues (editor pixels) and geo venues (lat/lng) both arrive here
// through normalize.ts.

export type Lang = 'en' | 'am';

/** A name or text in English, with Amharic when the venue has written it. */
export interface Text2 { en: string; am?: string | null }

export interface Vec2 { x: number; z: number }

export type WallMaterial = 'plaster' | 'brick' | 'concrete' | 'glass' | 'wood' | 'stone';
export type FloorMaterial = 'tile' | 'wood' | 'carpet' | 'concrete' | 'stone' | 'marble' | 'grass';
export type OpeningKind = 'door' | 'arch' | 'window';
export type ConnectorKind = 'stairs' | 'elevator' | 'ramp' | 'escalator';
/** How an edge of the path graph is walked. */
export type EdgeKind = 'walk' | 'door' | ConnectorKind;

export interface IndoorFloor {
  id: string;
  name: Text2;
  level: number;
  /** Display order, bottom to top. */
  order: number;
  /** Height of this floor's surface above ground level (m). */
  elevation: number;
  /** Floor to ceiling (m); walls default to it. */
  ceilingHeight: number;
}

export interface IndoorWall {
  id: string;
  floorId: string;
  a: Vec2;
  b: Vec2;
  thickness: number;
  height: number;
  material: WallMaterial;
}

/** A door, arch or window cut into a wall. */
export interface IndoorOpening {
  id: string;
  floorId: string;
  kind: OpeningKind;
  /** The wall it is cut into; null = free-standing (no wall close enough). */
  wallId: string | null;
  /** Centre, metres along the wall from its `a` end. */
  offset: number;
  width: number;
  height: number;
  /** Bottom edge above the floor (0 for doors and arches). */
  sill: number;
  /** Centre on the floor. */
  at: Vec2;
  /** Direction the wall runs (radians, atan2(dz, dx)). */
  angle: number;
  label: Text2 | null;
}

export interface IndoorRoom {
  id: string;
  floorId: string;
  name: Text2;
  /** Outline, counter- or clockwise; at least three points. */
  polygon: Vec2[];
  floorMaterial: FloorMaterial;
  ceiling: boolean;
  /** The editor's room type (office, restroom, stairs, …). */
  type: string;
  nodeId: string | null;
}

/** Stairs, a lift, a ramp or an escalator joining two floors. */
export interface IndoorConnector {
  id: string;
  kind: ConnectorKind;
  /** Lower floor. */
  fromFloorId: string;
  /** Upper floor. */
  toFloorId: string;
  /** Footprint centre on the lower floor. */
  center: Vec2;
  /** Across the stair (m). */
  width: number;
  /** Along the climb (m). */
  depth: number;
  /** Unit vector of the climb, lower end → upper end. */
  dir: Vec2;
  /** Centre line: where you step on and where you step off. */
  bottom: Vec2;
  top: Vec2;
  /** Number of steps (stairs, escalators). */
  steps: number;
  landing: 'none' | 'mid' | 'top';
  accessible: boolean;
  label: Text2 | null;
  /** Drawn by the venue (true) or worked out from the path graph (false). */
  drawn: boolean;
}

export interface IndoorPoi {
  id: string;
  floorId: string;
  nodeId: string | null;
  roomId: string | null;
  at: Vec2;
  name: Text2;
  blurb: Text2;
  category: string;
  images: string[];
  audioUrl: string | null;
}

export interface IndoorNode {
  id: string;
  floorId: string;
  at: Vec2;
  name: Text2 | null;
  /** A corridor junction rather than a place. */
  hallway: boolean;
}

export interface IndoorEdge {
  id: string;
  from: string;
  to: string;
  kind: EdgeKind;
  /** Metres walked (along the slope on stairs; 0 horizontal in a lift). */
  length: number;
  /** Seconds to walk it — the routing cost. */
  seconds: number;
  /** Usable without steps. */
  accessible: boolean;
  /** The stairs / lift it climbs. */
  connectorId: string | null;
}

/** Scenery and markers: trees, benches, furniture, landmarks, entrances and text labels. */
export type PropKind = 'tree' | 'bench' | 'furniture' | 'landmark' | 'entrance' | 'label'
  | 'palm' | 'shrub' | 'flowers' | 'grass' | 'water' | 'rock' | 'lamp' | 'fountain' | 'planter';
/** Scenery a venue placed itself: once there is any on the ground floor, the automatic ring of trees steps aside. */
export const GREENERY: PropKind[] = ['tree', 'palm', 'shrub', 'flowers', 'grass', 'water', 'rock', 'lamp', 'fountain', 'planter'];
export interface IndoorProp {
  id: string;
  floorId: string;
  kind: PropKind;
  at: Vec2;
  width: number;
  depth: number;
  /** Rotation about the vertical (radians, the plan's clockwise). */
  angle: number;
  label: Text2 | null;
}

/** Where the venue sits on the earth: the GPS point of the model's origin. */
export interface GeoFrame {
  lat: number; lng: number; rotationDeg: number;
  /** Real metres per model metre (a plan fitted to the map by eye may be a little off 1). Default 1. */
  scale?: number;
}

export interface IndoorVenue {
  id: string;
  name: Text2;
  source: 'plan' | 'geo';
  /** Floors bottom to top. */
  floors: IndoorFloor[];
  walls: IndoorWall[];
  openings: IndoorOpening[];
  rooms: IndoorRoom[];
  connectors: IndoorConnector[];
  props: IndoorProp[];
  pois: IndoorPoi[];
  nodes: IndoorNode[];
  edges: IndoorEdge[];
  geo: GeoFrame | null;
  bounds: { min: Vec2; max: Vec2 };
}

/** Walking pace used for times everywhere (m/s), ~4.7 km/h. */
export const WALK_SPEED = 1.3;
/** Extra seconds for a flight of stairs, and for waiting for / riding a lift. */
export const STAIRS_SECONDS = 15;
export const ELEVATOR_SECONDS = 25;
/** Default storey height when a floor has no elevation of its own (m). */
export const STOREY_HEIGHT = 3.5;
export const DEFAULT_CEILING = 2.8;
export const DEFAULT_WALL_THICKNESS = 0.18;
export const PROP_SIZES: Record<PropKind, { width: number; depth: number }> = {
  tree: { width: 3, depth: 3 }, bench: { width: 1.6, depth: 0.5 }, furniture: { width: 1, depth: 1 },
  landmark: { width: 1.5, depth: 1.5 }, entrance: { width: 1.5, depth: 1.5 }, label: { width: 0, depth: 0 },
  palm: { width: 2.5, depth: 2.5 }, shrub: { width: 1.2, depth: 1.2 }, flowers: { width: 2, depth: 1 }, grass: { width: 6, depth: 4 },
  water: { width: 5, depth: 3 }, rock: { width: 1, depth: 0.8 }, lamp: { width: 0.4, depth: 0.4 }, fountain: { width: 3, depth: 3 }, planter: { width: 1, depth: 1 },
};
export const OPENING_DEFAULTS: Record<OpeningKind, { width: number; height: number; sill: number }> = {
  door: { width: 0.9, height: 2.1, sill: 0 },
  arch: { width: 1.4, height: 2.3, sill: 0 },
  window: { width: 1.2, height: 1.2, sill: 0.9 },
};
/** Comfortable riser height used to count steps when the venue didn't (m). */
export const RISER = 0.17;
/** Comfortable going (tread depth) when a stair's run must be worked out (m). */
export const TREAD = 0.28;

/** The text in the visitor's language, falling back to English. */
export const t2 = (t: Text2 | null | undefined, lang: Lang): string => (t ? (lang === 'am' && t.am ? t.am : t.en) : '');
