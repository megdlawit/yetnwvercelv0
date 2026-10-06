/**
 * Public types for @ethi/indoor-maps-sdk.
 *
 * These are intentionally a *subset* of the internal app types (VenueGraph,
 * POI, GeoCoord, ...) — partners get a stable contract, and we stay free to
 * change internal DB columns/table shapes without breaking them. Whenever an
 * internal type changes, map it onto these shapes at the API boundary
 * (see supabase/functions/indoor-maps-api) rather than widening these.
 */
import type { CSSProperties } from 'react';

export interface GeoCoord {
  lat: number;
  lng: number;
}

export type IndoorMapPoiCategory = 'retail' | 'attraction' | 'service' | 'education';

export interface IndoorMapPoi {
  id: string;
  name: string;
  description: string;
  category: IndoorMapPoiCategory;
  lat: number | null;
  lng: number | null;
  imageUrl?: string | null;
  /** True for POIs that live outside the building (parking, entrances, nearby landmarks). */
  isOutdoor: boolean;
}

export interface IndoorMapNode {
  id: string;
  lat: number;
  lng: number;
  kind: 'junction' | 'entrance' | 'landmark';
}

export interface IndoorMapPath {
  id: string;
  fromId: string;
  toId: string;
  pathType: 'main' | 'secondary' | 'steps';
  distanceM: number;
}

/** The building's real-world location, if it has been geo-anchored. Powers
 *  the outdoor "approach + tap to enter" view — buildings without one skip
 *  straight to the indoor-only view (previous behavior). */
export interface IndoorMapBuildingAnchor {
  id: string;
  name: string;
  originLat: number;
  originLng: number;
  radiusM: number;
}

/** A schematic floor plan (nodes/floors/edges, x/y pixels) — rendered as a
 *  real floor plan (no map tiles), same as the main app's FloorMap. This is
 *  the common case for genuine multi-floor indoor buildings. */
export interface IndoorMapSchematicNode {
  id: string;
  name: string;
  x: number;
  y: number;
  isHallway: boolean;
}

export interface IndoorMapSchematicEdge {
  id: string;
  fromNodeId: string;
  toNodeId: string;
  weight: number;
}

export interface IndoorMapSchematicPoi {
  id: string;
  name: string;
  description: string;
  category: IndoorMapPoiCategory;
  imageUrl?: string | null;
  nodeId: string;
}

export interface IndoorMapSchematicFloor {
  id: string;
  level: number;
  name: string;
  width: number;
  height: number;
  nodes: IndoorMapSchematicNode[];
  edges: IndoorMapSchematicEdge[];
  pois: IndoorMapSchematicPoi[];
  /** Every floor this building has, for a future floor switcher. */
  floors: { id: string; level: number; name: string }[];
}

/** One floor of a multi-floor venue. Coordinates are plan units: `pxPerMeter` of them make a metre. */
export interface IndoorMapVenueFloor {
  id: string;
  level: number;
  name: string;
  /** 3D: height above ground and ceiling height (m), Amharic name — null means the default. */
  elevationM?: number | null;
  ceilingHeightM?: number | null;
  nameAm?: string | null;
  bounds: { minX: number; minY: number; maxX: number; maxY: number };
  /** Places (destinations and path points) on this floor. */
  nodes: IndoorMapSchematicNode[];
  /** Walkable paths between places on this floor. */
  edges: IndoorMapSchematicEdge[];
  rooms: { id: string; name: string; type: string; nodeId: string | null; outline: [number, number][]; nameAm?: string | null; floorMaterial?: string | null; hasCeiling?: boolean }[];
  /** Wall segments as [x1, y1, x2, y2]. */
  walls: [number, number, number, number][];
  /** The same walls with ids and 3D details (newer API versions). */
  walls3d?: { id: string; x1: number; y1: number; x2: number; y2: number; thicknessM: number | null; heightM: number | null; material: string | null }[];
  /** Doors, stairs, lifts, trees, furniture, labels… with their 3D details on newer API versions. */
  features: {
    id: string; kind: string; x: number; y: number; rotationDeg: number; width: number | null; depth: number | null; label: string | null;
    wallId?: string | null; offsetM?: number | null; heightM?: number | null; sillM?: number | null;
    fromFloorId?: string | null; toFloorId?: string | null; stepCount?: number | null; landing?: string | null; accessible?: boolean | null; labelAm?: string | null;
  }[];
}

/** A way between floors. `accessible` is false for stairs and escalators. */
export interface IndoorMapConnection {
  id: string;
  fromNodeId: string;
  toNodeId: string;
  fromLevel: number;
  toLevel: number;
  kind: 'stairs' | 'elevator' | 'ramp' | 'escalator' | null;
  accessible: boolean;
}

/** The whole building: every floor, and how they connect. */
export interface IndoorMapVenue {
  pxPerMeter: number;
  floors: IndoorMapVenueFloor[];
  connections: IndoorMapConnection[];
}

export interface IndoorMapRouteStep {
  text: string;
  metres: number;
  floorLevel: number;
  icon: 'start' | 'straight' | 'left' | 'right' | 'slight-left' | 'slight-right' | 'floor' | 'arrive';
  /** Index in the route's `path` where this step ends (newer API versions). */
  pathIndex?: number;
}

/** A route between two places, possibly across floors. */
export interface IndoorMapRouteResult {
  found: boolean;
  path: { placeId: string; floorLevel: number; x: number; y: number }[];
  steps: IndoorMapRouteStep[];
  metres: number;
  minutes: number;
}

export interface IndoorMapGraph {
  buildingId: string;
  floor: number;
  building: IndoorMapBuildingAnchor | null;
  /**
   * Which system this building's indoor content lives in — and therefore
   * which renderer the widget uses for the indoor view:
   *  - 'schematic': a real floor plan (FloorMap) — fully replaces the map,
   *    same as the main app.
   *  - 'geo': no floor plan exists; falls back to the zoomed-in real map
   *    (the venue's own lat/lng walkway graph, in `nodes`/`paths`/`pois`).
   *  - 'none': no indoor content at all for this building yet.
   */
  indoorKind: 'schematic' | 'geo' | 'none';
  /** Populated (rooms may be empty) when indoorKind === 'schematic'. */
  schematic: IndoorMapSchematicFloor | null;
  /** Every floor of the building and the connections between them (schematic venues). */
  venue?: IndoorMapVenue | null;
  /** Geo-native graph — outdoor POIs always live here; also indoor content
   *  when indoorKind === 'geo'. */
  nodes: IndoorMapNode[];
  paths: IndoorMapPath[];
  pois: IndoorMapPoi[];
}

export type IndoorMapStyle = 'standard' | 'satellite' | 'terrain';

export interface IndoorMapRoute {
  from: GeoCoord;
  to: GeoCoord;
}

export interface IndoorMapProps {
  /** Partner API key, scoped server-side to specific building IDs. */
  apiKey: string;
  /** Which building to render. */
  buildingId: string;
  /** Which floor to render (defaults to the building's ground floor). */
  floor?: number;
  /** Base map visual style. Defaults to 'standard'. */
  mapStyle?: IndoorMapStyle;
  /** Draw a route between two points, if provided. */
  route?: IndoorMapRoute;
  /** Override the API base URL (defaults to the production Edge Function). */
  apiBaseUrl?: string;
  /**
   * Where "Navigate" sends people to actually get walking directions — the
   * widget only ever *displays* the outdoor + indoor building, it never
   * computes routes itself. Defaults to this page's own origin (correct for
   * both the `/embed` iframe and `embed.js`, since both are served from the
   * same deployed app as the full experience), opened in a new tab.
   */
  mainAppUrl?: string;
  /** Which view to start on. Defaults to 'outdoor' when the building has a
   *  geo-anchor, otherwise 'indoor' is the only option. */
  initialView?: 'outdoor' | 'indoor';
  /** Override the default "open the main app in a new tab" Navigate behavior. */
  onNavigate?: (poi: IndoorMapPoi) => void;
  onPoiClick?: (poi: IndoorMapPoi) => void;
  onError?: (error: Error) => void;
  className?: string;
  style?: CSSProperties;
}