import React, { useMemo, useState, useCallback, useEffect, useRef, useReducer } from 'react';
import type { Map as MLMap } from 'maplibre-gl';
import { AnimatePresence, motion } from 'framer-motion';
import { X, Navigation, MapPin, Tag } from 'lucide-react';
import type { GeoCoord } from '@/lib/geo/GeoTypes';
import type { HybridPosition } from '@/lib/geo/HybridPositioningEngine';
import type { POI } from '@/data/poi';
import { getPOIIcon, hasActivePromotions, getActivePromotions } from '@/data/poi';
import { haversineMeters } from '@/lib/geo/GeoMath';
import type { VenueGraph } from '@/hooks/useVenueGraph';
import type { POIWithDistance } from '@/hooks/usePOIProximity';
import BlueDot, { type BlueDotViewport } from './BlueDot';
import CustomLayerRenderer from './CustomLayerRenderer';
import type { CustomLayer } from '@/lib/customLayers';
import BaseMap from './BaseMap';
import type { MapStyleId } from '@/lib/mapStyles';
import {
  addOSMBuildingExtrusion, updateVenueBuildingExtrusion, updateDrapedImage, applyMapAtmosphere,
  type VenueBuildingFootprint, type DrapedImage,
  VENUE_BUILDINGS_FILL_LAYER,
} from '@/lib/geo/MapSurfaceLayers';

export interface VenueMapRendererProps {
  venueGraph: VenueGraph | null;
  /** True while the curated venue graph is being fetched. Only used to
   *  drive the loading badge — a null graph after loading finishes (no
   *  building selected, or fetch error) shouldn't show a spinner forever. */
  venueGraphLoading?: boolean;
  position: HybridPosition | null;
  isWalking?: boolean;
  pois: POI[];
  nearbyPois?: POIWithDistance[];
  routePath?: GeoCoord[] | null;
  destination?: GeoCoord | null;
  isDirect?: boolean;
  /** True while a real outdoor route is still being fetched for the current
   *  destination (Overpass graph load or OSRM long-range fetch) — shows a
   *  loading badge instead of the direct-line route/banner, which used to
   *  flash briefly before the real route swapped in. See
   *  BrainState.outdoorRouteLoading. */
  routeLoading?: boolean;
  onRetryFetch?: (() => void) | null;
  navigationMode?: 'navigate' | 'explore';
  venueMode?: boolean;
  onPOIClick?: (poi: POI) => void;
  onNavigateToPOI?: (poi: POI) => void;
  registerControls?: (controls: { zoomIn: () => void; zoomOut: () => void; recenter: () => void; resetNorth: () => void }) => void;
  /** Fired whenever the map's camera bearing changes (drag-rotate, pinch-rotate) — lets the compass control mirror it. */
  onBearingChange?: (bearingDeg: number) => void;
  /** Custom overlay layers to render on top of the base map */
  customLayers?: CustomLayer[];
  /** Where to center the map before any data has loaded. Defaults to Unity Park, Addis Ababa. */
  center?: GeoCoord;
  /** Active real-map base style (Standard / Satellite / Terrain). */
  mapStyleId?: MapStyleId;
  /** Camera tilt for the "3D" toggle — 0 flat, ~50 for a 3D look. */
  pitch?: number;
  /** Every known building, for 3D highlighting + the zoom-to-enter prompt. */
  buildings?: VenueBuildingFootprint[];
  /** Fired when the person taps the "Enter [Building]" prompt. */
  onEnterBuilding?: (buildingId: string) => void;
  /** Active admin/user-uploaded image draped on the ground at the venue. */
  imageOverlay?: DrapedImage | null;
  /** Fired when the person taps empty map space (not a marker/POI/entrance
   *  label) — lets the caller offer "navigate here" for any point on the
   *  outdoor map, the same way tapping a room selects a destination indoors. */
  onMapClick?: (coord: GeoCoord) => void;
}

// Unity Park, Addis Ababa — fallback center if no building/venue data yet.
const DEFAULT_CENTER: GeoCoord = { lat: 9.0192, lng: 38.7628 };
const DEFAULT_ZOOM = 17;

const LABEL_COLOR = '#3a4a3a';
const LABEL_ZONE = '#5c6b5c';
const ROUTE_COLOR = '#1a7a45';
const ROUTE_DONE = '#6aab82';
const PATH_FILL = '#fdfaf2';
const PATH_STROKE = 'rgba(60,80,50,0.35)';
const PATH_MAIN_FILL = '#fbf6e6';
const PATH_MAIN_STROKE = 'rgba(60,80,50,0.4)';

// Web Mercator ground resolution at MapLibre's 512px tile convention.
function metersPerPixelAt(lat: number, zoom: number): number {
  return (Math.cos((lat * Math.PI) / 180) * 40075016.686) / (512 * Math.pow(2, zoom));
}

const VenueMapRenderer: React.FC<VenueMapRendererProps> = ({
  venueGraph,
  venueGraphLoading = false,
  position,
  isWalking = false,
  pois,
  nearbyPois = [],
  routePath,
  destination,
  navigationMode = 'explore',
  venueMode = true,
  onPOIClick,
  onNavigateToPOI,
  registerControls,
  onBearingChange,
  customLayers = [],
  center,
  mapStyleId = 'standard',
  pitch = 0,
  buildings = [],
  onEnterBuilding,
  imageOverlay = null,
  isDirect = false,
  routeLoading = false,
  onRetryFetch = null,
  onMapClick,
}) => {
  const [cardPoi, setCardPoi] = useState<POI | null>(null);
  const [map, setMap] = useState<MLMap | null>(null);
  const [containerSize, setContainerSize] = useState({ width: 600, height: 600 });
  const containerRef = useRef<HTMLDivElement>(null);
  const hasAutoFitRef = useRef(false);
  const hasCenteredOnUserRef = useRef(false);
  const wasShowingRouteRef = useRef(false);

  // Force a re-render on every map move/zoom so the SVG overlay (POIs,
  // routes, custom layers) stays glued to the real map while panning.
  // BlueDot is exempt — it re-projects every animation frame on its own.
  const [tick, bumpTick] = useReducer((x: number) => x + 1, 0);
  const rafPending = useRef(false);
  const scheduleOverlaySync = useCallback(() => {
    if (rafPending.current) return;
    rafPending.current = true;
    requestAnimationFrame(() => {
      rafPending.current = false;
      bumpTick();
    });
  }, []);

  useEffect(() => {
    if (!containerRef.current || typeof ResizeObserver === 'undefined') return;
    const ro = new ResizeObserver((entries) => {
      const box = entries[0]?.contentRect;
      if (box) setContainerSize({ width: box.width, height: box.height });
    });
    ro.observe(containerRef.current);
    return () => ro.disconnect();
  }, []);

  const initialCenter = center ?? DEFAULT_CENTER;

  // ── Collect every geo point currently worth showing ────────────────────
  const allPoints = useMemo(() => {
    const pts: GeoCoord[] = [];
    if (venueGraph) for (const n of venueGraph.nodes) {
      if (Number.isFinite(n.lat) && Number.isFinite(n.lng)) pts.push(n);
    }
    for (const p of pois) if (p.lat != null && p.lng != null) pts.push({ lat: p.lat, lng: p.lng });
    return pts;
  }, [venueGraph, pois]);

  const isExplore = navigationMode === 'explore';
  const showRoute = !isExplore && !!routePath && routePath.length > 1;

  // ── Fit the camera to data once it first arrives ───────────────────────
  useEffect(() => {
    if (!map || hasAutoFitRef.current || allPoints.length === 0) return;
    hasAutoFitRef.current = true;
    fitToPoints(map, allPoints);
  }, [map, allPoints]);

  // ── Once we have a real GPS fix, show the person where they actually are —
  // the initial venue-overview fit above doesn't know about live position.
  // Skipped if a route is already being framed (that fit already includes
  // the user's position); either way this only ever fires once.
  useEffect(() => {
    if (!map || hasCenteredOnUserRef.current || !position?.geo) return;
    if (showRoute) return;
    hasCenteredOnUserRef.current = true;
    map.flyTo({
      center: [position.geo.lng, position.geo.lat],
      zoom: Math.max(map.getZoom(), 18),
      duration: 600,
    });
  }, [map, position, showRoute]);

  // ── When navigation starts, zoom out to show the whole route ───────────
  useEffect(() => {
    if (!map) return;
    if (showRoute && !wasShowingRouteRef.current && routePath) {
      const pts = position?.geo ? [position.geo, ...routePath] : routePath;
      fitToPoints(map, pts, 80);
    }
    wasShowingRouteRef.current = showRoute;
  }, [map, showRoute, routePath, position]);

  // ── Tap-to-navigate anywhere on the outdoor map — mirrors the indoor
  // "tap a room to route there" flow. POI markers/entrance labels are
  // separate overlay DOM elements that sit on top of the map canvas and
  // handle their own clicks, so this only ever fires for genuinely empty
  // map space (streets, lawns, open ground). ────────────────────────────
  useEffect(() => {
    if (!map || !onMapClick) return;
    const handler = (e: { lngLat: { lat: number; lng: number }; point: { x: number; y: number } }) => {
      // A tap on a venue's building enters it (below) — not a "navigate here".
      if (map.getLayer(VENUE_BUILDINGS_FILL_LAYER) && map.queryRenderedFeatures([e.point.x, e.point.y], { layers: [VENUE_BUILDINGS_FILL_LAYER] }).length) return;
      onMapClick({ lat: e.lngLat.lat, lng: e.lngLat.lng });
    };
    map.on('click', handler);
    return () => { map.off('click', handler); };
  }, [map, onMapClick]);

  // ── Tap a venue's 3D building: fly into it, then hand over to the indoor view.
  useEffect(() => {
    if (!map || !onEnterBuilding) return;
    let entering = false;
    const click = (e: { features?: { properties?: Record<string, unknown> }[]; lngLat: { lat: number; lng: number } }) => {
      const id = e.features?.[0]?.properties?.id as string | undefined;
      if (!id || entering) return;
      entering = true;
      const reduced = typeof matchMedia !== 'undefined' && matchMedia('(prefers-reduced-motion: reduce)').matches;
      const go = () => { entering = false; onEnterBuilding(id); };
      if (reduced) { go(); return; }
      map.flyTo({ center: [e.lngLat.lng, e.lngLat.lat], zoom: Math.max(map.getZoom(), 19), pitch: 62, duration: 900, essential: true });
      map.once('moveend', go);
      window.setTimeout(() => { if (entering) go(); }, 1200);
    };
    const over = () => { map.getCanvas().style.cursor = 'pointer'; };
    const out = () => { map.getCanvas().style.cursor = ''; };
    map.on('click', VENUE_BUILDINGS_FILL_LAYER, click);
    map.on('mouseenter', VENUE_BUILDINGS_FILL_LAYER, over);
    map.on('mouseleave', VENUE_BUILDINGS_FILL_LAYER, out);
    return () => {
      map.off('click', VENUE_BUILDINGS_FILL_LAYER, click);
      map.off('mouseenter', VENUE_BUILDINGS_FILL_LAYER, over);
      map.off('mouseleave', VENUE_BUILDINGS_FILL_LAYER, out);
    };
  }, [map, onEnterBuilding]);

  // ── Imperative zoom/pan controls (wired to MapControls buttons) ────────
  useEffect(() => {
    if (!map) return;
    registerControls?.({
      zoomIn: () => map.zoomIn({ duration: 200 }),
      zoomOut: () => map.zoomOut({ duration: 200 }),
      recenter: () => {
        if (position?.geo) {
          map.flyTo({ center: [position.geo.lng, position.geo.lat], zoom: Math.max(map.getZoom(), 18), duration: 450 });
        } else if (allPoints.length > 0) {
          fitToPoints(map, allPoints);
        } else {
          map.flyTo({ center: [initialCenter.lng, initialCenter.lat], zoom: DEFAULT_ZOOM, duration: 450 });
        }
      },
      // Google-Maps-style compass tap: spins the camera back to north-up
      // without touching center/zoom/pitch.
      resetNorth: () => map.easeTo({ bearing: 0, duration: 300 }),
    });
  }, [map, registerControls, position, allPoints, initialCenter]);

  // ── Report live bearing up to the parent so the compass icon in
  // MapControls can spin to match (and hide/show itself) — 'rotate' already
  // fires scheduleOverlaySync above, this just forwards the current value. ──
  useEffect(() => {
    if (!map || !onBearingChange) return;
    const report = () => onBearingChange(map.getBearing());
    report();
    map.on('rotate', report);
    return () => { map.off('rotate', report); };
  }, [map, onBearingChange]);

  // ── 3D buildings + draped image — re-applied every time the style (re)loads,
  // since MapLibre wipes custom sources/layers on setStyle (map type switch). ──
  useEffect(() => {
    if (!map) return;
    const applyAll = () => {
      addOSMBuildingExtrusion(map);
      updateVenueBuildingExtrusion(map, buildings);
      updateDrapedImage(map, imageOverlay);
      applyMapAtmosphere(map);
    };
    if (map.isStyleLoaded()) applyAll();
    map.on('style.load', applyAll);
    return () => { map.off('style.load', applyAll); };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [map]);

  // Keep venue building highlights in sync without waiting for a style reload.
  useEffect(() => {
    if (!map || !map.isStyleLoaded()) return;
    updateVenueBuildingExtrusion(map, buildings);
  }, [map, buildings]);

  // Keep the draped image in sync without waiting for a style reload.
  useEffect(() => {
    if (!map || !map.isStyleLoaded()) return;
    updateDrapedImage(map, imageOverlay);
  }, [map, imageOverlay]);

  // ── Zoom-to-enter: when close enough & centered over a known building,
  // surface a tap-to-enter prompt. Also auto-enters after a short dwell so
  // zooming in is enough on its own — tapping the pill just skips the wait. ──
  const nearbyBuilding = useMemo(() => {
    if (!map || buildings.length === 0) return null;
    if (map.getZoom() < 18) return null;
    const c = map.getCenter();
    const here: GeoCoord = { lat: c.lat, lng: c.lng };
    for (const b of buildings) {
      if (haversineMeters(here, b.center) <= b.radiusM) return b;
    }
    return null;
    // Recomputed on every overlay-sync tick (pan/zoom).
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [map, buildings, tick]);

  const ENTER_DWELL_MS = 900;
  const nearbyBuildingId = nearbyBuilding?.id ?? null;
  useEffect(() => {
    if (!nearbyBuildingId || !onEnterBuilding) return;
    const id = nearbyBuildingId;
    const timer = setTimeout(() => onEnterBuilding(id), ENTER_DWELL_MS);
    return () => clearTimeout(timer);
  }, [nearbyBuildingId, onEnterBuilding]);

  const project = useCallback(
    (p: GeoCoord): { x: number; y: number } => {
      if (!map || !Number.isFinite(p.lat) || !Number.isFinite(p.lng)) return { x: 0, y: 0 };
      const pt = map.project([p.lng, p.lat]);
      return { x: pt.x, y: pt.y };
    },
    [map],
  );

  const metersPerPixel = map ? metersPerPixelAt(map.getCenter().lat, map.getZoom()) : 1;
  // Recomputed every overlay-sync tick (which already fires on 'rotate'),
  // so this stays current as the person twists the map with two fingers.
  const bearing = map ? map.getBearing() : 0;

  const routeSegments = useMemo(() => {
    if (!showRoute || !routePath || !position?.geo) return { done: [] as GeoCoord[], ahead: [] as GeoCoord[] };
    let closestIdx = 0, closestD = Infinity;
    routePath.forEach((p, i) => {
      const d = haversineMeters(position.geo as GeoCoord, p);
      if (d < closestD) { closestD = d; closestIdx = i; }
    });
    return { done: routePath.slice(0, closestIdx + 1), ahead: routePath.slice(closestIdx) };
  }, [showRoute, routePath, position]);

  const nearbyIds = useMemo(() => new Set(nearbyPois.map(n => n.poi.id)), [nearbyPois]);

  const projectedPois = useMemo(
    () => pois.filter(p => p.lat != null && p.lng != null).map(p => ({ poi: p, pt: project({ lat: p.lat as number, lng: p.lng as number }) })),
    [pois, project],
  );

  const destPt = destination ? project(destination) : null;

  const blueDotViewport: BlueDotViewport = {
    projectGeo: (lat, lng) => {
      const p = project({ lat, lng });
      return { cx: p.x, cy: p.y };
    },
    metersPerPixel,
    bearing,
  };

  const cardPoiDistance = cardPoi && position?.geo && cardPoi.lat != null && cardPoi.lng != null
    ? Math.round(haversineMeters(position.geo, { lat: cardPoi.lat, lng: cardPoi.lng }))
    : null;

  const cardPt = cardPoi && cardPoi.lat != null && cardPoi.lng != null
    ? project({ lat: cardPoi.lat, lng: cardPoi.lng })
    : null;

  // POI thumbnail size
  const THUMB_W = 56;
  const THUMB_H = 44;
  const THUMB_R = 10;

  return (
    <div ref={containerRef} className="absolute inset-0 overflow-hidden">
      <BaseMap
        styleId={mapStyleId}
        initialCenter={initialCenter}
        initialZoom={DEFAULT_ZOOM}
        pitch={pitch}
        onMapInstance={setMap}
        onMove={scheduleOverlaySync}
      >
        {/* ── Venue overlay (paths, POIs, route, blue dot) ───────────── */}
        {map && (
          <svg
            width="100%"
            height="100%"
            style={{ position: 'absolute', inset: 0, overflow: 'visible' }}
          >
            <defs>
              <marker id="routeArrow" viewBox="0 0 10 10" refX="5" refY="5" markerWidth="5" markerHeight="5" orient="auto-start-reverse">
                <path d="M1 1 L9 5 L1 9" fill="none" stroke={ROUTE_COLOR} strokeWidth={2.2} strokeLinecap="round" strokeLinejoin="round" />
              </marker>
              <clipPath id="thumbClip">
                <rect x={-THUMB_W / 2} y={-THUMB_H / 2} width={THUMB_W} height={THUMB_H} rx={THUMB_R} ry={THUMB_R} />
              </clipPath>
              <clipPath id="thumbClipLg">
                <rect x={-34} y={-28} width={68} height={56} rx={12} ry={12} />
              </clipPath>
              <filter id="thumbShadow" x="-20%" y="-20%" width="140%" height="140%">
                <feDropShadow dx="0" dy="3" stdDeviation="4" floodColor="rgba(0,0,0,0.22)" />
              </filter>
            </defs>

            {/* ── Curated walkable paths (admin-defined, may not be in OSM) ── */}
            {venueGraph && (
              <g strokeLinecap="round" strokeLinejoin="round" style={{ pointerEvents: 'none' }}>
                {venueGraph.paths.map(path => {
                  const a = project(path.from);
                  const b = project(path.to);
                  const isMain = path.pathType === 'main';
                  const width = isMain ? 14 : 9;
                  const dimOpacity = showRoute ? 0.45 : 0.85;
                  return (
                    <line key={`pb-${path.id}`} x1={a.x} y1={a.y} x2={b.x} y2={b.y}
                      stroke={isMain ? PATH_MAIN_STROKE : PATH_STROKE} strokeWidth={width + 3} fill="none" opacity={dimOpacity} />
                  );
                })}
                {venueGraph.paths.map(path => {
                  const a = project(path.from);
                  const b = project(path.to);
                  const isMain = path.pathType === 'main';
                  const width = isMain ? 14 : 9;
                  const dimOpacity = showRoute ? 0.45 : 0.85;
                  return (
                    <line key={`pf-${path.id}`} x1={a.x} y1={a.y} x2={b.x} y2={b.y}
                      stroke={isMain ? PATH_MAIN_FILL : PATH_FILL} strokeWidth={width} fill="none" opacity={dimOpacity}
                      strokeDasharray={path.pathType === 'steps' ? '5 6' : undefined} />
                  );
                })}
              </g>
            )}

            {/* ── Venue node labels (entrances + landmarks) ── */}
            {venueGraph && venueGraph.nodes
              .filter(n => venueMode ? (n.kind === 'entrance' || n.kind === 'landmark') : true)
              .map(n => {
                const p = project(n);
                const isEntrance = n.kind === 'entrance';
                return (
                  <g key={`vn-${n.id}`} style={{ pointerEvents: 'none' }}>
                    {isEntrance ? (
                      <circle cx={p.x} cy={p.y} r={5} fill="white" stroke="#1a7a45" strokeWidth={2} />
                    ) : (
                      <circle cx={p.x} cy={p.y} r={3.5} fill="white" stroke={LABEL_ZONE} strokeWidth={1.5} opacity={0.7} />
                    )}
                    {n.name && (
                      <text x={p.x} y={p.y - 10} textAnchor="middle" fontSize={isEntrance ? 9.5 : 8.5}
                        fontWeight={isEntrance ? 700 : 600} fill={LABEL_COLOR} letterSpacing="0.06em" opacity={0.95}
                        style={{ fontFamily: 'system-ui, sans-serif', paintOrder: 'stroke', stroke: 'white', strokeWidth: 3 }}>
                        {n.name.toUpperCase()}
                      </text>
                    )}
                  </g>
                );
              })}

            {/* ── Active route overlay ── */}
            {showRoute && routeSegments.done.length > 1 && (
              <polyline points={routeSegments.done.map(project).map(p => `${p.x},${p.y}`).join(' ')}
                stroke={ROUTE_DONE} strokeWidth={5} strokeLinecap="round" strokeLinejoin="round" fill="none" opacity={0.6} />
            )}
            {showRoute && routeSegments.ahead.length > 1 && (
              <polyline points={routeSegments.ahead.map(project).map(p => `${p.x},${p.y}`).join(' ')}
                stroke={ROUTE_COLOR} strokeWidth={7} strokeLinecap="round" strokeLinejoin="round" fill="none"
                markerEnd="url(#routeArrow)">
                <animate attributeName="stroke-opacity" values="1;0.7;1" dur="1.6s" repeatCount="indefinite" />
              </polyline>
            )}

            {/* ── Destination pin ── */}
            {destPt && showRoute && (
              <g transform={`translate(${destPt.x} ${destPt.y})`} style={{ pointerEvents: 'none' }}>
                <circle r={12} fill="#e53935" stroke="white" strokeWidth={3} />
                <circle r={4} fill="white" />
              </g>
            )}

            {/* ── POI photo-thumbnail markers ── */}
            <g>
              {projectedPois.map(({ poi, pt }) => {
                const Icon = getPOIIcon(poi);
                const isNearby = isExplore && nearbyIds.has(poi.id);
                const promo = hasActivePromotions(poi);
                const isFeatured = poi.isFeatured;
                const tw = isFeatured ? 68 : THUMB_W;
                const th = isFeatured ? 56 : THUMB_H;
                const tr = isFeatured ? 12 : THUMB_R;
                const clipId = isFeatured ? 'thumbClipLg' : 'thumbClip';

                return (
                  <g
                    key={poi.id}
                    transform={`translate(${pt.x} ${pt.y})`}
                    onClick={() => { setCardPoi(poi); onPOIClick?.(poi); }}
                    style={{ cursor: 'pointer', pointerEvents: 'auto' }}
                  >
                    {isNearby && (
                      <circle cx={0} cy={0} r={tw / 2 + 10} fill="none" stroke="#22c55e" strokeWidth={2.5} opacity={0.5}>
                        <animate attributeName="r" values={`${tw/2+6};${tw/2+18};${tw/2+6}`} dur="2s" repeatCount="indefinite" />
                        <animate attributeName="opacity" values="0.6;0;0.6" dur="2s" repeatCount="indefinite" />
                      </circle>
                    )}

                    {isFeatured ? (
                      <g>
                        <animateTransform attributeName="transform" type="translate" values={`0 -2; 0 2; 0 -2`} dur="2.2s" repeatCount="indefinite" />
                        <rect x={-tw / 2 + 2} y={-th / 2 + 4} width={tw} height={th} rx={tr} ry={tr} fill="rgba(0,0,0,0.18)" />
                        <rect x={-tw / 2 - 2} y={-th / 2 - 2} width={tw + 4} height={th + 4} rx={tr + 2} ry={tr + 2} fill="white" />
                        {poi.imageUrl ? (
                          <image href={poi.imageUrl} x={-tw / 2} y={-th / 2} width={tw} height={th}
                            preserveAspectRatio="xMidYMid slice" clipPath={`url(#${clipId})`} />
                        ) : (
                          <rect x={-tw / 2} y={-th / 2} width={tw} height={th} rx={tr} fill="#e8f5e9" />
                        )}
                        <rect x={-tw / 2 - 2} y={-th / 2 - 2} width={tw + 4} height={th + 4} rx={tr + 2} ry={tr + 2}
                          fill="none" stroke="hsl(35 90% 50%)" strokeWidth={2.5} />
                        {!poi.imageUrl && (
                          <g transform={`translate(${tw/2 - 14} ${th/2 - 14})`}>
                            <circle r={12} fill="white" stroke="hsl(35 90% 50%)" strokeWidth={2} />
                            <Icon width={14} height={14} x={-7} y={-7} color="hsl(35 80% 42%)" strokeWidth={2} />
                          </g>
                        )}
                      </g>
                    ) : (
                      <g filter="url(#thumbShadow)">
                        <rect x={-tw / 2 + 2} y={-th / 2 + 4} width={tw} height={th} rx={tr} ry={tr} fill="rgba(0,0,0,0.15)" />
                        <rect x={-tw / 2 - 2} y={-th / 2 - 2} width={tw + 4} height={th + 4} rx={tr + 2} ry={tr + 2} fill="white" />
                        {poi.imageUrl ? (
                          <image href={poi.imageUrl} x={-tw / 2} y={-th / 2} width={tw} height={th}
                            preserveAspectRatio="xMidYMid slice" clipPath="url(#thumbClip)" />
                        ) : (
                          <>
                            <rect x={-tw / 2} y={-th / 2} width={tw} height={th} rx={tr} fill="#f0f4f0" />
                            <g transform="translate(-9 -9)">
                              <Icon width={18} height={18} color="#3d7a55" strokeWidth={2} />
                            </g>
                          </>
                        )}
                      </g>
                    )}

                    {promo && (
                      <g transform={`translate(${tw/2 - 2} ${-th/2 + 2})`}>
                        <circle r={8} fill="#e53935" stroke="white" strokeWidth={1.5} />
                        <text textAnchor="middle" dominantBaseline="central" fontSize={7} fontWeight={800} fill="white">%</text>
                      </g>
                    )}

                    {poi.imageUrl && (
                      <g transform={`translate(${-tw/2 + 10} ${th/2 - 10})`}>
                        <circle r={9} fill="white" opacity={0.92} />
                        <Icon width={11} height={11} x={-5.5} y={-5.5} color="#1a7a45" strokeWidth={2.2} />
                      </g>
                    )}
                  </g>
                );
              })}
            </g>

            {/* ── Custom overlay layers ── */}
            {customLayers.length > 0 && (
              <CustomLayerRenderer layers={customLayers} projector={{ project }} />
            )}

            {/* ── Blue Dot user position ── */}
            {position && (
              <BlueDot
                position={position}
                viewport={blueDotViewport}
                dotRadius={9}
                showCone={true}
                showAccuracy={true}
                isWalking={isWalking}
              />
            )}
          </svg>
        )}
      </BaseMap>

      {/* ── Loading badge ── */}
      {(!map || venueGraphLoading || routeLoading) && (
        <div className="absolute top-4 left-1/2 -translate-x-1/2 flex items-center gap-2 rounded-full px-3.5 py-2 shadow-md"
          style={{ background: 'rgba(255,255,255,0.95)' }}>
          <svg className="animate-spin h-3.5 w-3.5" viewBox="0 0 24 24" fill="none">
            <circle className="opacity-25" cx="12" cy="12" r="10" stroke="#1a7a45" strokeWidth="4" />
            <path className="opacity-90" fill="#1a7a45" d="M4 12a8 8 0 018-8v4a4 4 0 00-4 4H4z" />
          </svg>
          <span className="text-xs font-semibold" style={{ color: '#1a7a45' }}>
            {!map ? 'Loading map…' : venueGraphLoading ? 'Loading venue paths…' : 'Finding the best walking route…'}
          </span>
        </div>
      )}

      {/* Direct-route banner when detailed OSM path data is unavailable. Only
          shown once a real fetch has actually failed — while one is still
          in flight (routeLoading) the badge above is what's showing instead,
          so this doesn't briefly appear and then disappear a moment later. */}
      {isDirect && !venueGraphLoading && !routeLoading && (
        <div className="absolute top-4 left-1/2 -translate-x-1/2 flex items-center gap-3 rounded-full px-3.5 py-2 shadow-md z-40"
          style={{ background: 'rgba(255,245,235,0.96)', border: '1px solid rgba(0,0,0,0.06)' }}>
          <span className="text-xs font-semibold" style={{ color: '#b45309' }}>
            Detailed street data unavailable — showing a direct route
          </span>
          {onRetryFetch && (
            <button onClick={onRetryFetch} className="text-xs font-semibold px-2 py-1 rounded bg-white shadow-sm" style={{ color: '#1a7a45' }}>
              Retry
            </button>
          )}
        </div>
      )}

      {/* ── Tap-to-enter prompt — zoomed in close on a known building. Fills
          and auto-enters after a beat; tapping skips straight in. ── */}
      <AnimatePresence>
        {nearbyBuilding && onEnterBuilding && (
          <motion.button
            key={`enter-${nearbyBuilding.id}`}
            initial={{ opacity: 0, y: -14 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: -14 }}
            transition={{ type: 'spring', damping: 26, stiffness: 320 }}
            onClick={() => onEnterBuilding(nearbyBuilding.id)}
            className="absolute z-30 left-1/2 -translate-x-1/2 flex items-center gap-2 rounded-full pl-4 pr-3 py-2.5 shadow-xl tap-scale overflow-hidden"
            style={{ top: 16, background: 'hsl(152 70% 22%)' }}
          >
            <motion.div
              key={`fill-${nearbyBuilding.id}`}
              className="absolute inset-0 bg-white/15"
              initial={{ scaleX: 0 }}
              animate={{ scaleX: 1 }}
              transition={{ duration: ENTER_DWELL_MS / 1000, ease: 'linear' }}
              style={{ transformOrigin: 'left' }}
            />
            <span className="relative text-sm font-bold text-white">Enter {nearbyBuilding.name}</span>
            <span className="relative w-6 h-6 rounded-full bg-white/20 flex items-center justify-center">
              <Navigation className="w-3.5 h-3.5 text-white" />
            </span>
          </motion.button>
        )}
      </AnimatePresence>

      {/* ── Floating POI card (tap to open) ── */}
      <AnimatePresence>
        {cardPoi && cardPt && (() => {
          const promos = getActivePromotions(cardPoi);
          const left = Math.min(Math.max(cardPt.x, containerSize.width * 0.18), containerSize.width * 0.82);
          const top = Math.max(cardPt.y - containerSize.height * 0.08, containerSize.height * 0.06);
          return (
            <motion.div
              key={cardPoi.id}
              initial={{ opacity: 0, y: 14, scale: 0.93 }}
              animate={{ opacity: 1, y: 0, scale: 1 }}
              exit={{ opacity: 0, y: 8, scale: 0.95 }}
              transition={{ type: 'spring', damping: 26, stiffness: 320 }}
              className="absolute z-30 w-56 rounded-2xl overflow-hidden shadow-2xl"
              style={{ background: 'white', left, top, transform: 'translate(-50%, -100%)' }}
            >
              <button
                onClick={() => setCardPoi(null)}
                className="absolute top-2 right-2 w-6 h-6 rounded-full bg-black/40 flex items-center justify-center z-10"
                aria-label="Close"
              >
                <X className="w-3.5 h-3.5 text-white" />
              </button>
              {cardPoi.imageUrl ? (
                <div className="w-full h-28 overflow-hidden bg-gray-100">
                  <img src={cardPoi.imageUrl} alt={cardPoi.name} className="w-full h-full object-cover" />
                </div>
              ) : (
                <div className="w-full h-16 flex items-center justify-center" style={{ background: '#e8f5e9' }}>
                  {React.createElement(getPOIIcon(cardPoi), { width: 28, height: 28, color: '#1a7a45', strokeWidth: 1.8 })}
                </div>
              )}
              <div className="p-3">
                <div className="flex items-center justify-between gap-2 mb-1">
                  <p className="text-sm font-bold text-gray-900 leading-tight truncate">{cardPoi.name}</p>
                  {promos.length > 0 && (
                    <span className="flex-shrink-0 flex items-center gap-1 text-[10px] font-bold px-2 py-0.5 rounded-full bg-orange-500 text-white">
                      <Tag className="w-2.5 h-2.5" /> Offer
                    </span>
                  )}
                </div>
                <p className="text-[11px] text-gray-400 capitalize mb-3">{cardPoi.subcategory || cardPoi.category}</p>
                <div className="flex items-center justify-between gap-2">
                  {cardPoiDistance != null && (
                    <span className="flex items-center gap-1 text-[11px] font-semibold text-gray-400">
                      <MapPin className="w-3 h-3" /> {cardPoiDistance}m
                    </span>
                  )}
                  <button
                    onClick={() => onNavigateToPOI?.(cardPoi)}
                    className="flex items-center gap-1 rounded-full px-3 py-1.5 text-[11px] font-bold text-white ml-auto"
                    style={{ background: '#1a7a45' }}
                  >
                    <Navigation className="w-3 h-3" /> Go
                  </button>
                </div>
              </div>
            </motion.div>
          );
        })()}
      </AnimatePresence>
    </div>
  );
};

// ── Helpers ──────────────────────────────────────────────────────────────────
function fitToPoints(map: MLMap, points: GeoCoord[], padding = 56): void {
  const valid = points.filter(p => Number.isFinite(p.lat) && Number.isFinite(p.lng));
  if (valid.length === 0) return;
  if (valid.length === 1) {
    map.flyTo({ center: [valid[0].lng, valid[0].lat], zoom: 18, duration: 400 });
    return;
  }
  let south = Infinity, west = Infinity, north = -Infinity, east = -Infinity;
  for (const p of valid) {
    if (p.lat < south) south = p.lat;
    if (p.lat > north) north = p.lat;
    if (p.lng < west) west = p.lng;
    if (p.lng > east) east = p.lng;
  }
  map.fitBounds([[west, south], [east, north]], { padding, maxZoom: 19, duration: 450 });
}

export default VenueMapRenderer;