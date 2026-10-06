/**
 * mapStyles — base map style definitions for the real OpenStreetMap-backed
 * outdoor map (MapLibre GL). Three switchable styles, same pattern as
 * Google/Apple Maps' "Map type" picker:
 *
 *   Standard  → OpenFreeMap "Liberty" vector style (real OSM streets/labels,
 *               no API key, no rate limit — safe for production use)
 *   Satellite → Esri World Imagery raster tiles (free, attribution required)
 *   Terrain   → OpenTopoMap raster tiles (free, shows real topography)
 *
 * NOTE for production: OpenFreeMap and OpenTopoMap are community-run free
 * tile services. They're great for getting real OSM rendering without an
 * API key today, but for guaranteed uptime/SLA at scale you'd eventually
 * want a paid provider (MapTiler, Stadia Maps, Mapbox) — swapping the
 * `style` URL/spec below is the only change that would take.
 */
import type { StyleSpecification } from 'maplibre-gl';

export type MapStyleId = 'standard' | 'satellite' | 'terrain';

export interface BaseMapStyle {
  id: MapStyleId;
  label: string;
  /** Short attribution shown in the map's bottom-right corner. */
  attribution: string;
  /** Either a hosted style URL (vector) or an inline raster style spec. */
  style: string | StyleSpecification;
}

const SATELLITE_STYLE: StyleSpecification = {
  version: 8,
  sources: {
    'esri-imagery': {
      type: 'raster',
      tiles: [
        'https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}',
      ],
      tileSize: 256,
      attribution: 'Esri, Maxar, Earthstar Geographics',
      maxzoom: 19,
    },
  },
  layers: [{ id: 'esri-imagery', type: 'raster', source: 'esri-imagery' }],
};

const TERRAIN_STYLE: StyleSpecification = {
  version: 8,
  sources: {
    opentopomap: {
      type: 'raster',
      tiles: [
        'https://a.tile.opentopomap.org/{z}/{x}/{y}.png',
        'https://b.tile.opentopomap.org/{z}/{x}/{y}.png',
        'https://c.tile.opentopomap.org/{z}/{x}/{y}.png',
      ],
      tileSize: 256,
      attribution: 'OpenTopoMap (CC-BY-SA)',
      maxzoom: 17,
    },
  },
  layers: [{ id: 'opentopomap', type: 'raster', source: 'opentopomap' }],
};

export const MAP_STYLES: BaseMapStyle[] = [
  {
    id: 'standard',
    label: 'Standard',
    attribution: '© OpenFreeMap, OpenMapTiles, OpenStreetMap contributors',
    style: 'https://tiles.openfreemap.org/styles/liberty',
  },
  {
    id: 'satellite',
    label: 'Satellite',
    attribution: '© Esri, Maxar, Earthstar Geographics',
    style: SATELLITE_STYLE,
  },
  {
    id: 'terrain',
    label: 'Terrain',
    attribution: '© OpenTopoMap contributors (CC-BY-SA)',
    style: TERRAIN_STYLE,
  },
];

export function getMapStyle(id: MapStyleId): BaseMapStyle {
  return MAP_STYLES.find((s) => s.id === id) ?? MAP_STYLES[0];
}

export const DEFAULT_MAP_STYLE_ID: MapStyleId = 'standard';
export const MAP_STYLE_STORAGE_KEY = 'ethi_map_style';
