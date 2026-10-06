/**
 * Geo types — shared across the hybrid indoor/outdoor positioning stack.
 *
 * GeoCoord is a real-world WGS84 lat/lng. OutdoorNode/OutdoorEdge form a
 * walkable graph compatible with our existing Dijkstra engine.
 */

export interface GeoCoord {
  lat: number;
  lng: number;
}

export interface GeoFix extends GeoCoord {
  /** Horizontal accuracy in meters (lower = better). */
  accuracy: number;
  /** Heading in degrees (0..360, north=0). May be NaN if unavailable. */
  heading?: number | null;
  /** Speed in m/s. May be null. */
  speed?: number | null;
  /** Timestamp in ms (epoch). */
  timestamp: number;
}

export interface OutdoorNode {
  id: string;
  lat: number;
  lng: number;
  /** Optional human label (e.g. POI name, intersection). */
  name?: string;
  kind?: 'intersection' | 'poi' | 'entrance';
}

export interface OutdoorEdge {
  id: string;
  fromNodeId: string;
  toNodeId: string;
  /** Distance in meters. */
  weight: number;
  /** Tag from OSM (footway/path/residential/...). Purely informational. */
  highway?: string;
}

export interface OutdoorGraph {
  nodes: OutdoorNode[];
  edges: OutdoorEdge[];
  /** Bounding box used to fetch this graph. */
  bbox: { south: number; west: number; north: number; east: number };
  fetchedAt: number;
}

/** Geo-anchor describing how an indoor coordinate space maps to the world. */
export interface GeoAnchor {
  /** GPS coords of indoor (0,0). */
  originLat: number;
  originLng: number;
  /** Map-up bearing in degrees clockwise from true north. */
  rotationDeg: number;
  /** Scale: meters per indoor pixel. */
  metersPerPixel: number;
}

export type Environment = 'indoor' | 'outdoor' | 'transitioning' | 'unknown';

/** Outdoor travel mode — determines which OSM road types are routable and
 *  the assumed travel speed for ETA. Indoor navigation is always on foot. */
export type TravelMode = 'walk' | 'car';
