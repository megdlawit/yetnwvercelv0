/**
 * Custom Map Layers — data types and sample data for the layer overlay system.
 *
 * Each layer type renders differently on the SVG map:
 *   stores       → pin markers with store icon + label
 *   routes       → polyline with direction arrows (delivery / nav paths)
 *   buildings    → filled polygon footprints with label
 *   parking      → zone polygon with P icon
 *   entrances    → door icons at specific geo-points
 *   events       → pulsing beacon with event name bubble
 *   navpaths     → animated dashed route overlay (outdoor navigation)
 */

import type { GeoCoord } from '@/lib/geo/GeoTypes';

// Shared localStorage key — layers created/edited in the Admin Layers
// Dashboard are written here, and the outdoor map (VenueMapRenderer) reads
// from the same key so admin-added layers actually show up for users.
export const ADMIN_LAYERS_STORAGE_KEY = 'ethi_admin_layers';

// ─── Layer type definitions ───────────────────────────────────────────────────

export type CustomLayerType =
  | 'stores'
  | 'routes'
  | 'buildings'
  | 'parking'
  | 'entrances'
  | 'events'
  | 'navpaths';

export interface BaseLayer {
  id: string;
  name: string;
  type: CustomLayerType;
  color: string;      // primary render color (hex)
  visible: boolean;
}

// Store location
export interface StoreFeature {
  id: string;
  name: string;
  category: string;
  lat: number;
  lng: number;
  isOpen: boolean;
}

export interface StoresLayer extends BaseLayer {
  type: 'stores';
  features: StoreFeature[];
}

// Delivery / navigation route polyline
export interface RouteFeature {
  id: string;
  name: string;
  waypoints: GeoCoord[];
  isActive: boolean;
  mode: 'delivery' | 'nav' | 'service';
}

export interface RoutesLayer extends BaseLayer {
  type: 'routes';
  features: RouteFeature[];
}

// Building footprint polygon
export interface BuildingFeature {
  id: string;
  name: string;
  polygon: GeoCoord[];   // closed polygon
  floors: number;
  use: 'commercial' | 'civic' | 'cultural' | 'utility';
}

export interface BuildingsLayer extends BaseLayer {
  type: 'buildings';
  features: BuildingFeature[];
}

// Parking zone polygon
export interface ParkingFeature {
  id: string;
  name: string;
  polygon: GeoCoord[];
  capacity: number;
  type: 'surface' | 'garage' | 'vip';
  available?: number;
}

export interface ParkingLayer extends BaseLayer {
  type: 'parking';
  features: ParkingFeature[];
}

// Indoor entrance point
export interface EntranceFeature {
  id: string;
  name: string;
  lat: number;
  lng: number;
  isAccessible: boolean;
  isMainEntrance: boolean;
}

export interface EntrancesLayer extends BaseLayer {
  type: 'entrances';
  features: EntranceFeature[];
}

// Live event location
export interface EventFeature {
  id: string;
  name: string;
  lat: number;
  lng: number;
  startTime: string;   // ISO 8601
  endTime: string;
  category: 'performance' | 'exhibit' | 'food' | 'sport' | 'workshop';
  isLive: boolean;
}

export interface EventsLayer extends BaseLayer {
  type: 'events';
  features: EventFeature[];
}

// Outdoor navigation path overlay
export interface NavPathFeature {
  id: string;
  name: string;
  waypoints: GeoCoord[];
  difficulty: 'easy' | 'moderate' | 'hard';
  distanceM: number;
}

export interface NavPathsLayer extends BaseLayer {
  type: 'navpaths';
  features: NavPathFeature[];
}

export type CustomLayer =
  | StoresLayer
  | RoutesLayer
  | BuildingsLayer
  | ParkingLayer
  | EntrancesLayer
  | EventsLayer
  | NavPathsLayer;

// ─── Sample layer catalogue ───────────────────────────────────────────────────
// All coordinates are around Unity Park, Addis Ababa (9.019° N, 38.762° E)

const PARK_CENTER = { lat: 9.0192, lng: 38.7628 };

function offset(lat: number, lng: number): GeoCoord {
  return { lat: PARK_CENTER.lat + lat, lng: PARK_CENTER.lng + lng };
}

function makeRect(cLat: number, cLng: number, dLat: number, dLng: number): GeoCoord[] {
  return [
    offset(cLat - dLat, cLng - dLng),
    offset(cLat - dLat, cLng + dLng),
    offset(cLat + dLat, cLng + dLng),
    offset(cLat + dLat, cLng - dLng),
  ];
}

export const DEFAULT_CUSTOM_LAYERS: CustomLayer[] = [
  // ── Stores ────────────────────────────────────────────────────────────────
  {
    id: 'layer-stores',
    name: 'Store Locations',
    type: 'stores',
    color: '#7c3aed',
    visible: false,
    features: [
      { id: 's1', name: 'Gift Shop',    category: 'retail',    ...offset(0.0008,  0.0006), isOpen: true  },
      { id: 's2', name: 'Café Selam',   category: 'food',      ...offset(-0.0005, 0.0012), isOpen: true  },
      { id: 's3', name: 'Souvenir Hub', category: 'retail',    ...offset(0.0003, -0.0008), isOpen: false },
      { id: 's4', name: 'Art Gallery',  category: 'culture',   ...offset(-0.0010, -0.0004), isOpen: true  },
      { id: 's5', name: 'Food Court',   category: 'food',      ...offset(0.0012,  0.0002), isOpen: true  },
    ],
  } as StoresLayer,

  // ── Delivery routes ────────────────────────────────────────────────────────
  {
    id: 'layer-routes',
    name: 'Delivery Routes',
    type: 'routes',
    color: '#f59e0b',
    visible: false,
    features: [
      {
        id: 'r1', name: 'Morning Supply Run', isActive: true, mode: 'delivery',
        waypoints: [
          offset(-0.0018, -0.0020),
          offset(-0.0010, -0.0012),
          offset(-0.0002,  0.0000),
          offset( 0.0005,  0.0008),
          offset( 0.0012,  0.0002),
        ],
      },
      {
        id: 'r2', name: 'Staff Service Route', isActive: false, mode: 'service',
        waypoints: [
          offset( 0.0018, -0.0018),
          offset( 0.0010, -0.0005),
          offset(-0.0005,  0.0010),
          offset(-0.0015,  0.0018),
        ],
      },
    ],
  } as RoutesLayer,

  // ── Buildings ─────────────────────────────────────────────────────────────
  {
    id: 'layer-buildings',
    name: 'Buildings',
    type: 'buildings',
    color: '#1e40af',
    visible: false,
    features: [
      {
        id: 'b1', name: 'Main Exhibition Hall', floors: 3, use: 'cultural',
        polygon: makeRect(0.0005, 0.0008, 0.0004, 0.0007),
      },
      {
        id: 'b2', name: 'Admin Block', floors: 2, use: 'civic',
        polygon: makeRect(-0.0008, -0.0006, 0.0003, 0.0005),
      },
      {
        id: 'b3', name: 'Amphitheatre', floors: 1, use: 'cultural',
        polygon: makeRect(0.0014, -0.0004, 0.0004, 0.0006),
      },
    ],
  } as BuildingsLayer,

  // ── Parking ───────────────────────────────────────────────────────────────
  {
    id: 'layer-parking',
    name: 'Parking Areas',
    type: 'parking',
    color: '#0891b2',
    visible: false,
    features: [
      {
        id: 'p1', name: 'Visitor Parking A', capacity: 120, available: 43, type: 'surface',
        polygon: makeRect(-0.0018,  0.0014, 0.0005, 0.0008),
      },
      {
        id: 'p2', name: 'Visitor Parking B', capacity: 80, available: 12, type: 'surface',
        polygon: makeRect(-0.0018, -0.0016, 0.0005, 0.0007),
      },
      {
        id: 'p3', name: 'VIP Parking', capacity: 30, available: 8, type: 'vip',
        polygon: makeRect(-0.0022,  0.0002, 0.0003, 0.0005),
      },
    ],
  } as ParkingLayer,

  // ── Entrances ─────────────────────────────────────────────────────────────
  {
    id: 'layer-entrances',
    name: 'Indoor Entrances',
    type: 'entrances',
    color: '#16a34a',
    visible: false,
    features: [
      { id: 'e1', name: 'Main Gate',       ...offset(-0.0016,  0.0000), isAccessible: true,  isMainEntrance: true  },
      { id: 'e2', name: 'North Entrance',  ...offset( 0.0016,  0.0000), isAccessible: true,  isMainEntrance: false },
      { id: 'e3', name: 'East Gate',       ...offset( 0.0000,  0.0020), isAccessible: false, isMainEntrance: false },
      { id: 'e4', name: 'West Gate',       ...offset( 0.0000, -0.0020), isAccessible: true,  isMainEntrance: false },
      { id: 'e5', name: 'Staff Entry',     ...offset( 0.0008, -0.0015), isAccessible: false, isMainEntrance: false },
    ],
  } as EntrancesLayer,

  // ── Events ────────────────────────────────────────────────────────────────
  {
    id: 'layer-events',
    name: 'Events',
    type: 'events',
    color: '#dc2626',
    visible: false,
    features: [
      {
        id: 'ev1', name: 'Cultural Show', category: 'performance', isLive: true,
        ...offset(0.0014, -0.0004),
        startTime: new Date(Date.now() - 30 * 60000).toISOString(),
        endTime:   new Date(Date.now() + 60 * 60000).toISOString(),
      },
      {
        id: 'ev2', name: 'Food Festival', category: 'food', isLive: false,
        ...offset(0.0005, 0.0014),
        startTime: new Date(Date.now() + 2 * 3600000).toISOString(),
        endTime:   new Date(Date.now() + 5 * 3600000).toISOString(),
      },
      {
        id: 'ev3', name: 'Photography Workshop', category: 'workshop', isLive: false,
        ...offset(-0.0006, 0.0010),
        startTime: new Date(Date.now() + 1 * 3600000).toISOString(),
        endTime:   new Date(Date.now() + 3 * 3600000).toISOString(),
      },
    ],
  } as EventsLayer,

  // ── Navigation Paths ──────────────────────────────────────────────────────
  {
    id: 'layer-navpaths',
    name: 'Navigation Paths',
    type: 'navpaths',
    color: '#1a7a45',
    visible: false,
    features: [
      {
        id: 'np1', name: 'Main Promenade', difficulty: 'easy', distanceM: 480,
        waypoints: [
          offset(-0.0016, 0.0000),
          offset(-0.0010, 0.0000),
          offset(-0.0005, 0.0002),
          offset( 0.0000, 0.0000),
          offset( 0.0005, 0.0002),
          offset( 0.0010, 0.0000),
          offset( 0.0016, 0.0000),
        ],
      },
      {
        id: 'np2', name: 'Garden Loop', difficulty: 'easy', distanceM: 680,
        waypoints: [
          offset( 0.0000,  0.0000),
          offset( 0.0008,  0.0010),
          offset( 0.0012,  0.0000),
          offset( 0.0008, -0.0010),
          offset( 0.0000, -0.0014),
          offset(-0.0008, -0.0010),
          offset(-0.0012,  0.0000),
          offset(-0.0008,  0.0010),
          offset( 0.0000,  0.0000),
        ],
      },
      {
        id: 'np3', name: 'Accessibility Route', difficulty: 'easy', distanceM: 300,
        waypoints: [
          offset(-0.0016,  0.0000),
          offset(-0.0012,  0.0004),
          offset(-0.0006,  0.0006),
          offset( 0.0000,  0.0008),
        ],
      },
    ],
  } as NavPathsLayer,
];
