/**
 * MapSurfaceLayers — adds/updates the "3D + surface image" MapLibre layers
 * on top of the real map: building extrusions (real OSM height data, plus
 * our own venue buildings highlighted in brand green) and a georeferenced
 * raster image draped on the ground over a venue building's footprint.
 *
 * These are re-applied on every style load, since MapLibre wipes custom
 * sources/layers whenever `setStyle` runs (switching Standard/Satellite/
 * Terrain re-triggers this).
 */
import type { Map as MLMap, GeoJSONSource, ImageSource } from 'maplibre-gl';
import type * as GeoJSON from 'geojson';
import type { GeoCoord } from './GeoTypes';
import { metersToLatLng } from './GeoMath';

export interface VenueBuildingFootprint {
  id: string;
  name: string;
  center: GeoCoord;
  radiusM: number;
}

export interface DrapedImage {
  /** Any stable key — changing it forces the source to be recreated. */
  key: string;
  /** Data URL or hosted URL of the image to drape. */
  url: string;
  center: GeoCoord;
  radiusM: number;
  opacity?: number;
}

const OSM_BUILDINGS_SOURCE = 'openmaptiles';
const OSM_BUILDINGS_LAYER = 'ethi-3d-osm-buildings';
const VENUE_BUILDINGS_SOURCE = 'ethi-venue-buildings';
export const VENUE_BUILDINGS_FILL_LAYER = 'ethi-venue-buildings-fill';
const VENUE_BUILDINGS_OUTLINE_LAYER = 'ethi-venue-buildings-outline';
const DRAPE_SOURCE = 'ethi-drape-image';
const DRAPE_LAYER = 'ethi-drape-image-layer';

/** Builds a regular N-gon polygon (closed ring) approximating a circle, in [lng,lat] pairs. */
function circleRing(center: GeoCoord, radiusM: number, points = 40): [number, number][] {
  const ring: [number, number][] = [];
  for (let i = 0; i <= points; i++) {
    const angle = (i / points) * 2 * Math.PI;
    const east = radiusM * Math.sin(angle);
    const north = radiusM * Math.cos(angle);
    const p = metersToLatLng(center, east, north);
    ring.push([p.lng, p.lat]);
  }
  return ring;
}

/**
 * Adds a `fill-extrusion` layer over the map style's real building data
 * (OpenMapTiles "building" layer — present on the Standard/Liberty vector
 * style, absent on the raster Satellite/Terrain styles) so buildings across
 * the whole map render as real 3D blocks using their actual height data.
 * No-ops safely if the source isn't present (e.g. on a raster base style).
 */
export function addOSMBuildingExtrusion(map: MLMap): void {
  if (map.getLayer(OSM_BUILDINGS_LAYER)) return;
  if (!map.getSource(OSM_BUILDINGS_SOURCE)) return; // raster style — nothing to extrude

  try {
    // Insert below the first symbol layer so labels stay on top of the buildings.
    const firstSymbolId = map.getStyle().layers?.find(l => l.type === 'symbol')?.id;

    map.addLayer({
      id: OSM_BUILDINGS_LAYER,
      type: 'fill-extrusion',
      source: OSM_BUILDINGS_SOURCE,
      'source-layer': 'building',
      minzoom: 15,
      paint: {
        // Warm, height-graded ramp (short buildings = soft cream, tall
        // buildings = deeper amber) instead of a single flat gray — this is
        // most of what makes extruded buildings read as "3D" rather than
        // flat blocks, especially combined with the vertical light gradient.
        'fill-extrusion-color': [
          'interpolate', ['linear'], ['coalesce', ['get', 'render_height'], 8],
          0, '#efe6d3',
          15, '#e6d8b8',
          40, '#d9c398',
          90, '#c2a978',
        ],
        'fill-extrusion-height': ['coalesce', ['get', 'render_height'], 8],
        'fill-extrusion-base': ['coalesce', ['get', 'render_min_height'], 0],
        'fill-extrusion-opacity': 0.92,
        // Shades each building's faces using the style's `light` (see
        // applyMapAtmosphere) instead of a flat fill — this is what gives
        // buildings a real sun-lit/shadowed-side look instead of looking flat.
        'fill-extrusion-vertical-gradient': true,
      },
    }, firstSymbolId);
  } catch (e) {
    // Style/schema mismatch (e.g. a future style swap with a different
    // vector schema) — fail quietly rather than break the map.
    console.warn('[MapSurfaceLayers] OSM building extrusion unavailable:', e);
  }
}

/**
 * Renders your own venue buildings as extruded, brand-green blocks (using
 * a circular footprint approximation from originLat/originLng + radiusM,
 * since we don't store real footprint polygons) so they stand out clearly
 * from the generic gray city buildings around them.
 */
export function updateVenueBuildingExtrusion(map: MLMap, buildings: VenueBuildingFootprint[]): void {
  const features = buildings.map(b => ({
    type: 'Feature' as const,
    properties: { id: b.id, name: b.name },
    geometry: {
      type: 'Polygon' as const,
      coordinates: [circleRing(b.center, b.radiusM)],
    },
  }));
  const data = { type: 'FeatureCollection' as const, features };

  const existing = map.getSource(VENUE_BUILDINGS_SOURCE) as GeoJSONSource | undefined;
  if (existing) {
    existing.setData(data as GeoJSON.FeatureCollection);
    return;
  }
  if (features.length === 0) return;

  map.addSource(VENUE_BUILDINGS_SOURCE, { type: 'geojson', data: data as GeoJSON.FeatureCollection });
  map.addLayer({
    id: VENUE_BUILDINGS_FILL_LAYER,
    type: 'fill-extrusion',
    source: VENUE_BUILDINGS_SOURCE,
    paint: {
      'fill-extrusion-color': 'hsl(152, 70%, 30%)',
      'fill-extrusion-height': 14,
      'fill-extrusion-opacity': 0.75,
      'fill-extrusion-vertical-gradient': true,
    },
  });
  map.addLayer({
    id: VENUE_BUILDINGS_OUTLINE_LAYER,
    type: 'line',
    source: VENUE_BUILDINGS_SOURCE,
    paint: {
      'line-color': 'hsl(152, 70%, 22%)',
      'line-width': 2,
    },
  });
}

/**
 * Warm directional "golden hour" light — the single biggest lever for
 * making the 3D buildings actually *read* as 3D (like Snapchat's Snap Map
 * or Google Maps' 3D mode) instead of flat gray blocks with a pitched
 * camera. MapLibre shades every fill-extrusion face relative to this light
 * position, so a warm, low, angled light makes one side of each building
 * visibly brighter than the other — a real sun-lit look instead of a flat
 * fill. Harmless at pitch 0 (2D) since there's no extruded geometry to
 * shade, so this is safe to call unconditionally.
 */
export function applyMapAtmosphere(map: MLMap): void {
  try {
    map.setLight({
      anchor: 'viewport',
      color: '#ffe3bd',
      intensity: 0.55,
      // [radial distance, azimuthal angle from true north, polar angle from zenith]
      // — a low, warm light raking in from the southwest, golden-hour style.
      position: [1.5, 210, 68],
    });
  } catch (e) {
    console.warn('[MapSurfaceLayers] setLight unavailable:', e);
  }
}

/**
 * Drapes a raster image over the ground at a venue building's footprint —
 * auto-fit to a square bounding box around the building's center/radius
 * (no manual corner-pinning yet). Pass `image: null` to remove it.
 */
export function updateDrapedImage(map: MLMap, image: DrapedImage | null): void {
  const existingSource = map.getSource(DRAPE_SOURCE) as ImageSource | undefined;

  if (!image) {
    if (map.getLayer(DRAPE_LAYER)) map.removeLayer(DRAPE_LAYER);
    if (existingSource) map.removeSource(DRAPE_SOURCE);
    return;
  }

  // Square bbox corners in MapLibre's required order: top-left, top-right,
  // bottom-right, bottom-left.
  const nw = metersToLatLng(image.center, -image.radiusM, image.radiusM);
  const ne = metersToLatLng(image.center, image.radiusM, image.radiusM);
  const se = metersToLatLng(image.center, image.radiusM, -image.radiusM);
  const sw = metersToLatLng(image.center, -image.radiusM, -image.radiusM);
  const coordinates: [[number, number], [number, number], [number, number], [number, number]] = [
    [nw.lng, nw.lat], [ne.lng, ne.lat], [se.lng, se.lat], [sw.lng, sw.lat],
  ];

  if (existingSource) {
    // ImageSource supports updating the image/coordinates in place.
    existingSource.updateImage({ url: image.url, coordinates });
    if (map.getLayer(DRAPE_LAYER)) {
      map.setPaintProperty(DRAPE_LAYER, 'raster-opacity', image.opacity ?? 0.85);
    }
    return;
  }

  map.addSource(DRAPE_SOURCE, { type: 'image', url: image.url, coordinates });
  map.addLayer({
    id: DRAPE_LAYER,
    type: 'raster',
    source: DRAPE_SOURCE,
    paint: { 'raster-opacity': image.opacity ?? 0.85 },
  });
}

/** Removes every layer/source this module may have added — used before a style swap wipes them anyway, or on unmount. */
export function clearSurfaceLayers(map: MLMap): void {
  for (const layerId of [OSM_BUILDINGS_LAYER, VENUE_BUILDINGS_FILL_LAYER, VENUE_BUILDINGS_OUTLINE_LAYER, DRAPE_LAYER]) {
    if (map.getLayer(layerId)) map.removeLayer(layerId);
  }
  for (const sourceId of [VENUE_BUILDINGS_SOURCE, DRAPE_SOURCE]) {
    if (map.getSource(sourceId)) map.removeSource(sourceId);
  }
}
