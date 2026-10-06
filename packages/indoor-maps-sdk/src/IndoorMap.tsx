import React, { useEffect, useMemo, useState } from 'react';
import { fetchBuildingGraph, IndoorMapApiError } from './api';
import type { IndoorMapGraph, IndoorMapPoi, IndoorMapProps, IndoorMapSchematicFloor } from './types';

// Phase 1 (co-located extraction): the actual rendering engines still live in
// the main app, under src/components. We import them by relative path so the
// SDK can ship today without duplicating ~1000+ lines of rendering code. This
// only works when the SDK is consumed from within this same repo / Vite build
// (which covers "internal apps & partners" for now). Phase 2, once this
// proves out, is a real copy into this package with its own build (tsup) so
// it can be published standalone.
import VenueMapRenderer from '../../../src/components/VenueMapRenderer';
import FloorMap from '../../../src/components/FloorMap';
import type { VenueGraph } from '../../../src/hooks/useVenueGraph';
import type { POI } from '../../../src/data/poi';
import type { Floor } from '../../../src/data/types';
import type { VenueBuildingFootprint } from '../../../src/lib/geo/MapSurfaceLayers';

// ── Geo-native adapters (outdoor view, and the 'geo' indoor fallback) ──────

function adaptGeoGraph(graph: IndoorMapGraph): { venueGraph: VenueGraph; pois: POI[] } {
  const nodeById = new Map(graph.nodes.map((n) => [n.id, n]));
  const poiById = new Map(graph.pois.filter((p) => p.lat != null && p.lng != null).map((p) => [p.id, p]));

  const venueGraph: VenueGraph = {
    nodes: graph.nodes.map((n) => ({ id: n.id, name: n.id, lat: n.lat, lng: n.lng, kind: n.kind })),
    paths: graph.paths.map((p) => {
      const fromNode = nodeById.get(p.fromId);
      const fromPoi = poiById.get(p.fromId);
      const toNode = nodeById.get(p.toId);
      const toPoi = poiById.get(p.toId);
      return {
        id: p.id,
        from: fromNode
          ? { id: fromNode.id, lat: fromNode.lat, lng: fromNode.lng, isPoi: false }
          : { id: p.fromId, lat: fromPoi?.lat ?? 0, lng: fromPoi?.lng ?? 0, isPoi: true },
        to: toNode
          ? { id: toNode.id, lat: toNode.lat, lng: toNode.lng, isPoi: false }
          : { id: p.toId, lat: toPoi?.lat ?? 0, lng: toPoi?.lng ?? 0, isPoi: true },
        pathType: p.pathType,
        distanceM: p.distanceM,
      };
    }),
  };

  const pois: POI[] = graph.pois.map((p) => ({
    id: p.id,
    nodeId: null,
    buildingId: graph.buildingId,
    name: p.name,
    description: p.description,
    category: p.category,
    subcategory: '',
    imageUrl: p.imageUrl ?? null,
    audioUrl: null,
    isFeatured: false,
    triggerRadius: 15,
    promotions: [],
    lat: p.lat,
    lng: p.lng,
    isOutdoor: p.isOutdoor,
  }));

  return { venueGraph, pois };
}

function toPublicPoi(poi: POI): IndoorMapPoi {
  return {
    id: poi.id,
    name: poi.name,
    description: poi.description,
    category: poi.category,
    lat: poi.lat ?? null,
    lng: poi.lng ?? null,
    imageUrl: poi.imageUrl ?? null,
    isOutdoor: !!poi.isOutdoor,
  };
}

// ── Schematic adapters (the common indoor case — a real floor plan) ───────

function schematicToFloor(schematic: IndoorMapSchematicFloor): Floor {
  return {
    id: schematic.id,
    buildingId: '',
    level: schematic.level,
    name: schematic.name,
    width: schematic.width,
    height: schematic.height,
    rooms: [], // this app never authors room polygons — same as the main app
    nodes: schematic.nodes.map((n) => ({
      id: n.id,
      floorId: schematic.id,
      name: n.name,
      x: n.x,
      y: n.y,
      isHallway: n.isHallway,
    })),
    edges: schematic.edges.map((e) => ({ id: e.id, fromNodeId: e.fromNodeId, toNodeId: e.toNodeId, weight: e.weight })),
    walls: [],
  };
}

function schematicPoisToPOI(schematic: IndoorMapSchematicFloor, buildingId: string): POI[] {
  return schematic.pois.map((p) => ({
    id: p.id,
    nodeId: p.nodeId,
    buildingId,
    name: p.name,
    description: p.description,
    category: p.category,
    subcategory: '',
    imageUrl: p.imageUrl ?? null,
    audioUrl: null,
    isFeatured: false,
    triggerRadius: 15,
    promotions: [],
    lat: null,
    lng: null,
    isOutdoor: false,
  }));
}

/**
 * Drop-in indoor map widget.
 *
 * @example
 * <IndoorMap apiKey="pk_live_..." buildingId="unity-park" floor={1} />
 */
type ViewMode = 'outdoor' | 'indoor';

export const IndoorMap: React.FC<IndoorMapProps> = ({
  apiKey,
  buildingId,
  floor = 0,
  mapStyle = 'standard',
  route,
  apiBaseUrl,
  mainAppUrl,
  initialView,
  onNavigate,
  onPoiClick,
  onError,
  className,
  style,
}) => {
  const [graph, setGraph] = useState<IndoorMapGraph | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  // 'outdoor' when the building has a geo-anchor (shows the approach view +
  // tap-to-enter prompt), otherwise there's nothing to toggle and this stays
  // 'indoor' — the same single-view behavior the SDK had before.
  const [view, setView] = useState<ViewMode>('indoor');
  // Only used for the schematic (FloorMap) branch — VenueMapRenderer tracks
  // its own selected-POI card internally, FloorMap doesn't.
  const [selectedSchematicPoi, setSelectedSchematicPoi] = useState<POI | null>(null);
  // The floor on screen: starts at the `floor` prop, then the visitor can switch.
  const [activeFloor, setActiveFloor] = useState(floor);
  useEffect(() => { setActiveFloor(floor); }, [floor]);

  useEffect(() => {
    const controller = new AbortController();
    setLoading(true);
    setError(null);
    setSelectedSchematicPoi(null);

    fetchBuildingGraph({ apiKey, buildingId, floor: activeFloor, apiBaseUrl, signal: controller.signal })
      .then((g) => {
        setGraph(g);
        setView(g.building ? (initialView ?? 'outdoor') : 'indoor');
      })
      .catch((err) => {
        if (controller.signal.aborted) return;
        const message = err instanceof IndoorMapApiError ? err.message : 'Failed to load map';
        setError(message);
        onError?.(err instanceof Error ? err : new Error(message));
      })
      .finally(() => { if (!controller.signal.aborted) setLoading(false); });

    return () => controller.abort();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [apiKey, buildingId, activeFloor, apiBaseUrl]);

  const adapted = useMemo(() => (graph ? adaptGeoGraph(graph) : null), [graph]);

  const buildings = useMemo<VenueBuildingFootprint[]>(() => {
    if (!graph?.building) return [];
    return [{
      id: graph.building.id,
      name: graph.building.name,
      center: { lat: graph.building.originLat, lng: graph.building.originLng },
      radiusM: graph.building.radiusM,
    }];
  }, [graph]);

  const outdoorPois = useMemo(() => adapted?.pois.filter((p) => p.isOutdoor) ?? [], [adapted]);
  const geoIndoorPois = useMemo(() => adapted?.pois.filter((p) => !p.isOutdoor) ?? [], [adapted]);

  const schematicFloor = useMemo(() => (graph?.schematic ? schematicToFloor(graph.schematic) : null), [graph]);
  const schematicPois = useMemo(
    () => (graph?.schematic ? schematicPoisToPOI(graph.schematic, buildingId) : []),
    [graph, buildingId],
  );

  const isOutdoorView = view === 'outdoor' && !!graph?.building;
  const isSchematicIndoor = !isOutdoorView && graph?.indoorKind === 'schematic' && !!schematicFloor;
  const isGeoIndoor = !isOutdoorView && graph?.indoorKind === 'geo';

  const hasOutdoorContent = outdoorPois.length > 0;
  const hasIndoorContent = isSchematicIndoor
    ? (schematicFloor!.nodes.length > 0 || schematicPois.length > 0)
    : (adapted?.venueGraph.nodes.length ?? 0) > 0 || geoIndoorPois.length > 0;

  const handleNavigate = (poi: POI) => {
    const publicPoi = toPublicPoi(poi);
    if (onNavigate) { onNavigate(publicPoi); return; }
    // The widget only ever displays the building — actually getting
    // directions always hands off to the full app, where real routing
    // (live position, turn-by-turn, rerouting) lives.
    const base = mainAppUrl ?? (typeof window !== 'undefined' ? window.location.origin : '');
    const params = new URLSearchParams({ building: buildingId });
    if (publicPoi.id) params.set('poi', publicPoi.id);
    if (publicPoi.lat != null) params.set('lat', String(publicPoi.lat));
    if (publicPoi.lng != null) params.set('lng', String(publicPoi.lng));
    if (typeof window !== 'undefined') {
      window.open(`${base}/?${params.toString()}`, '_blank', 'noopener,noreferrer');
    }
  };

  if (loading) {
    return <div className={className} style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', minHeight: 240, ...style }}>Loading map…</div>;
  }
  if (error || !adapted || !graph) {
    return <div className={className} style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', minHeight: 240, color: '#b91c1c', ...style }}>{error ?? 'Map unavailable'}</div>;
  }

  return (
    <div className={className} style={{ position: 'relative', width: '100%', height: '100%', minHeight: 320, ...style }}>
      {isSchematicIndoor ? (
        // The real floor plan — its own SVG canvas + gradient background,
        // completely replacing the map (no tiles at all), same as the main
        // app's indoor experience.
        <FloorMap
          key={`${buildingId}-${schematicFloor!.id}`}
          floor={schematicFloor!}
          path={null}
          startNodeId={null}
          endNodeId={null}
          onRoomClick={() => {}}
          pois={schematicPois}
          selectedPoiId={selectedSchematicPoi?.id ?? null}
          buildingName={graph.building?.name}
          onZoomOutExit={graph.building ? () => setView('outdoor') : undefined}
          onPOIClick={(poi) => { setSelectedSchematicPoi(poi); onPoiClick?.(toPublicPoi(poi)); }}
        />
      ) : null}
      {isSchematicIndoor && graph.schematic && graph.schematic.floors.length > 1 ? (
        // Floor switcher for multi-floor buildings, highest floor on top.
        <div role="group" aria-label="Floor" style={{
          position: 'absolute', right: 12, top: 12, zIndex: 10, display: 'flex', flexDirection: 'column', gap: 2,
          background: 'rgba(255,255,255,0.95)', borderRadius: 12, padding: 3, boxShadow: '0 2px 8px rgba(0,0,0,0.15)',
        }}>
          {[...graph.schematic.floors].sort((a, b) => b.level - a.level).map((f) => (
            <button key={f.id} type="button" title={f.name} aria-pressed={f.level === graph.floor}
              onClick={() => setActiveFloor(f.level)}
              style={{
                minWidth: 36, padding: '6px 8px', border: 0, borderRadius: 9, cursor: 'pointer', fontWeight: 600, fontSize: 12,
                background: f.level === graph.floor ? '#0f5e3a' : 'transparent', color: f.level === graph.floor ? '#fff' : '#334155',
              }}>
              {f.level}
            </button>
          ))}
        </div>
      ) : null}
      {isSchematicIndoor ? null : (
        <VenueMapRenderer
          // Remount on every outdoor<->indoor switch: VenueMapRenderer only
          // auto-fits its camera to the visible points once (an internal ref
          // guards against re-fitting on every re-render), so without this
          // key the camera stays at the previous pan/zoom after switching.
          key={`${buildingId}-${view}`}
          venueGraph={isOutdoorView ? null : adapted.venueGraph}
          position={null}
          pois={isOutdoorView ? outdoorPois : geoIndoorPois}
          routePath={route ? [route.from, route.to] : null}
          destination={route?.to ?? null}
          navigationMode={route ? 'navigate' : 'explore'}
          venueMode
          mapStyleId={mapStyle}
          center={graph.building ? { lat: graph.building.originLat, lng: graph.building.originLng } : undefined}
          buildings={isOutdoorView ? buildings : []}
          onEnterBuilding={isOutdoorView ? () => setView('indoor') : undefined}
          onPOIClick={onPoiClick ? (poi) => onPoiClick(toPublicPoi(poi)) : undefined}
          onNavigateToPOI={handleNavigate}
        />
      )}

      {/*
        The map's own "zoom in + hover over the building for ~1s" auto-enter
        needs the camera at zoom >= 18 — a real pinch/scroll gesture most
        people won't discover inside a small embedded iframe. This button is
        the reliable way in, independent of zoom level.
      */}
      {isOutdoorView && (
        <button
          type="button"
          onClick={() => setView('indoor')}
          style={{
            position: 'absolute', top: 12, right: 12, zIndex: 9999,
            display: 'flex', alignItems: 'center', gap: 6,
            padding: '8px 14px', borderRadius: 999, border: 'none',
            background: '#1a7a45', color: 'white',
            fontSize: 12, fontWeight: 700, cursor: 'pointer',
            pointerEvents: 'auto',
          }}
        >
          View indoor map →
        </button>
      )}
      {!isOutdoorView && graph.building && (
        <button
          type="button"
          onClick={() => setView('outdoor')}
          style={{
            position: 'absolute', top: 12, left: 12, zIndex: 9999,
            display: 'flex', alignItems: 'center', gap: 6,
            padding: '8px 14px', borderRadius: 999, border: 'none',
            background: 'rgba(20, 20, 20, 0.72)', color: 'white',
            fontSize: 12, fontWeight: 700, cursor: 'pointer',
            pointerEvents: 'auto',
          }}
        >
          ← Outside
        </button>
      )}

      {/* Schematic view doesn't have a built-in POI card (unlike
          VenueMapRenderer, which shows one automatically) — this is ours. */}
      {isSchematicIndoor && selectedSchematicPoi && (
        <div style={{
          position: 'absolute', bottom: 16, left: 16, right: 16, zIndex: 9999,
          background: 'white', borderRadius: 14, padding: '14px 16px',
          boxShadow: '0 8px 24px rgba(0,0,0,0.18)',
          display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between', gap: 12,
        }}>
          <div style={{ minWidth: 0 }}>
            <div style={{ fontSize: 14, fontWeight: 700, color: '#111', marginBottom: 2 }}>
              {selectedSchematicPoi.name}
            </div>
            {selectedSchematicPoi.description && (
              <div style={{ fontSize: 12, color: '#555', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                {selectedSchematicPoi.description}
              </div>
            )}
          </div>
          <div style={{ display: 'flex', gap: 8, flexShrink: 0 }}>
            <button
              type="button"
              onClick={() => handleNavigate(selectedSchematicPoi)}
              style={{
                padding: '8px 14px', borderRadius: 999, border: 'none',
                background: '#1a7a45', color: 'white', fontSize: 12, fontWeight: 700, cursor: 'pointer',
              }}
            >
              Go
            </button>
            <button
              type="button"
              onClick={() => setSelectedSchematicPoi(null)}
              style={{
                padding: '8px 10px', borderRadius: 999, border: 'none',
                background: '#eee', color: '#333', fontSize: 12, fontWeight: 700, cursor: 'pointer',
              }}
            >
              ✕
            </button>
          </div>
        </div>
      )}

      {/*
        Distinguishes "this view has nothing to show yet" (a data gap) from
        "this looks broken." Without this, an empty indoor or outdoor graph
        just renders as a blank canvas and is indistinguishable from a bug.
      */}
      {((isOutdoorView && !hasOutdoorContent) || (!isOutdoorView && !hasIndoorContent)) && (
        <div style={{
          position: 'absolute', bottom: 16, left: '50%', transform: 'translateX(-50%)', zIndex: 9999,
          padding: '8px 14px', borderRadius: 10, background: 'rgba(20, 20, 20, 0.72)', color: 'white',
          fontSize: 12, fontWeight: 600, maxWidth: '90%', textAlign: 'center',
        }}>
          No {isOutdoorView ? 'outdoor' : 'indoor'} map data for this building yet
        </div>
      )}
    </div>
  );
};

export default IndoorMap;