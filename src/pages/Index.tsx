import React, { useState, useMemo, useCallback, useEffect, useRef  } from 'react';
import type { Room, NavNode, Building } from '@/data/types';
import { pxPerMeterOf } from '@/lib/navScale';
import { celebrate } from '@/lib/celebrate';
import { cn } from '@/lib/utils';
import IndoorVenueView, { ViewDock, type Controls, type DockView } from '@/components/visitor/IndoorVenueView';
import type { CameraMode, FloorLayer } from '@/components/venue/Venue3D';
import type { Place } from '@/components/visitor/types';
import type { MapFeature } from '@/lib/venue/features';
import type { VenueTheme } from '@/lib/venue/themes';
import { INDOOR_LAYERS, type IndoorLayerId, type IndoorView, type VenueMapSettings } from '@/lib/venue/mapSettings';
import { planAngleDeg } from '@/lib/venue/pdr';
import { supabase } from '@/integrations/supabase/client';
import { sampleBuilding, buildings as sampleBuildings } from '@/data/sampleBuilding';
import LocationSplash, { type MapMode } from '@/components/LocationSplash';
import type { TravelMode } from '@/lib/geo/GeoTypes';
import type { GeoCoord } from '@/lib/geo/GeoTypes';
import FloorMap from '@/components/FloorMap';
import BottomSheet from '@/components/BottomSheet';
import { ProfileAvatar } from '@/components/HomeSheet';
import DebugDrawer from '@/components/DebugDrawer';
import QRScannerModal from '@/components/QRScannerModal';
import ManualLocationModal from '@/components/ManualLocationModal';
import StartingPointModal from '@/components/StartingPointModal';
import POICard, { type WalkInfo } from '@/components/POICard';
import MapSearchBar from '@/components/MapSearchBar';
import DesktopSidebar from '@/components/DesktopSidebar';
import MapControls from '@/components/MapControls';
import MapLayersPanel, { MAP_LAYERS } from '@/components/MapLayersPanel';
import type { CustomImageLayer } from '@/components/MapTypeSwitcher';
import type { VenueBuildingFootprint } from '@/lib/geo/MapSurfaceLayers';
import { DEFAULT_CUSTOM_LAYERS, ADMIN_LAYERS_STORAGE_KEY } from '@/lib/customLayers';
import type { CustomLayer } from '@/lib/customLayers';
import { DEFAULT_MAP_STYLE_ID, MAP_STYLE_STORAGE_KEY, type MapStyleId } from '@/lib/mapStyles';
import FloatingTopCard from '@/components/FloatingTopCard';
import IndoorTrackingModal from '@/components/IndoorTrackingModal';
import EmailGateDialog from '@/components/EmailGateDialog';
import { useProfile } from '@/contexts/UserProfileContext';
import { useVisitedPlaces } from '@/hooks/useVisitedPlaces';
import { addSteps, logActivity, rememberPlaces, rememberVenueName, snapshotOfPoi } from '@/lib/visitor/visitorStore';
import { STRIDE_M } from '@/lib/visitor/progress';
import { usePDRNavigation } from '@/hooks/usePDRNavigation';
import { useLocationAnchor } from '@/hooks/useLocationAnchor';
import { useBuildingLoader } from '@/hooks/useBuildingLoader';
import { usePOILoader } from '@/hooks/usePOILoader';
import { useNavigationBrain } from '@/hooks/useNavigationBrain';
import { useGuidanceLang } from '@/lib/guidanceLang';
import { venueModel } from '@/components/visitor/venueModel';
import type { BrowseStart } from '@/components/visitor/VenueBrowse';
import type { VenueBrowseProps } from '@/components/visitor/VenueBrowsePanel';
import type { Tables } from '@/integrations/supabase/types';
import HandoffCard, { type Handoff } from '@/components/visitor/HandoffCard';
import { floorName as coreFloorName } from '@ethi/indoor-core';
import VenueMapRenderer from '@/components/VenueMapRenderer';
import { useVenueGraph } from '@/hooks/useVenueGraph';
import PositionDebugOverlay from '@/components/PositionDebugOverlay';
import { POI } from '@/data/poi';
import type { OutdoorPlaceResult } from '@/hooks/useOutdoorPlaceSearch';
import { QRAnchorPayload } from '@/lib/QRScanner';
import { reverseGeocode } from '@/lib/ReverseGeocode';
import { toast } from 'sonner';
import { Loader2, WifiOff, Navigation2 } from 'lucide-react';
import RoomRouteCard from '@/components/RoomRouteCard';
import { BuildingGraph } from '@/lib/BuildingGraph';
import { motion, AnimatePresence } from 'framer-motion';

// ── Shell component: shows pre-onboarding, then splash, then enters the map ──
const Index = () => {
  // An address picked in the home page search (?lat=&lng=&name=) opens straight on the outdoor map.
  const linkedPlace = useMemo(() => {
    try {
      const p = new URLSearchParams(window.location.search);
      const lat = Number(p.get('lat')), lng = Number(p.get('lng'));
      return p.has('lat') && Number.isFinite(lat) && Number.isFinite(lng) ? { lat, lng, name: p.get('name') || 'Selected place' } : null;
    } catch { return null; }
  }, []);
  // Show sensor-access pre-onboarding on very first visit (before anything else)
  const [showPreOnboarding, setShowPreOnboarding] = useState(() => {
    if (linkedPlace) return false;
    try { return !localStorage.getItem('ethi_sensor_seen'); } catch { return true; }
  });
  const [mapMode, setMapMode] = useState<MapMode | null>(linkedPlace ? 'outdoor' : null);
  const [initialTravelMode, setInitialTravelMode] = useState<TravelMode>('walk');

  if (showPreOnboarding) {
    return (
      <IndoorTrackingModal
        open={true}
        onAllow={() => {
          try { localStorage.setItem('ethi_sensor_seen', '1'); } catch {}
          setShowPreOnboarding(false);
        }}
        onSkip={() => {
          try { localStorage.setItem('ethi_sensor_seen', '1'); } catch {}
          setShowPreOnboarding(false);
        }}
      />
    );
  }

  if (mapMode === null) {
    return (
      <LocationSplash
        onSelectMode={(mode, travelMode) => {
          setInitialTravelMode(travelMode ?? 'walk');
          setMapMode(mode);
        }}
      />
    );
  }
  return (
    <ExploreMap
      mapMode={mapMode}
      onChangeMode={(mode) => setMapMode(mode)}
      initialTravelMode={initialTravelMode}
    />
  );
};

/**
 * One published venue for ExploreMap — the venue map (/venue/:id) is this
 * same map and navigation, scoped to a single venue's published data.
 */
export interface ExploreVenue {
  buildings: Building[];
  pois: POI[];
  /** Where the visitor is (a QR / link entry point): node id. */
  entryNodeId?: string | null;
  /** A place to open on arrival: node id. */
  placeNodeId?: string | null;
  /** Start navigating to placeNodeId straight away. */
  navigate?: boolean;
  /** Start outdoor walking directions to the venue. */
  directionsTo?: { lat: number; lng: number; name: string } | null;
  /** A banner across the top (e.g. "Preview — not published yet"). */
  notice?: string | null;
  /** The venue's own 2D / 3D map: its 3D objects, places, look and the institution's map settings. */
  features: (MapFeature & { floorId: string })[];
  places: Place[];
  theme: VenueTheme;
  settings: VenueMapSettings;
  /** Opening indoor view from a link (?view=2d|3d), else the institution's choice. */
  initialView?: IndoorView | null;
  /** Places' Amharic names by path point (spoken and shown in Amharic guidance). */
  amNames?: Record<string, string>;
  /** Events, tours, guides and stories (Discover / Explore). */
  content?: Tables<'venue_content'>[];
  /** What Discover / Explore opens first (from a link). */
  browseStart?: BrowseStart | null;
}

// ── The map + navigation (the /explore page, and every venue map) ─────────────
export const ExploreMap = ({
  mapMode,
  onChangeMode,
  initialTravelMode,
  venue,
}: {
  mapMode: MapMode;
  onChangeMode: (m: MapMode) => void;
  initialTravelMode: TravelMode;
  venue?: ExploreVenue;
}) => {
  const { buildings: cloudBuildings, loading: cloudLoading, isOffline } = useBuildingLoader(!venue);
  const loading = venue ? false : cloudLoading;

  const allBuildings = useMemo(() => {
    if (venue) return venue.buildings;
    if (cloudBuildings.length > 0) return cloudBuildings;
    return sampleBuildings;
  }, [cloudBuildings, venue]);

  const [selectedBuildingId, setSelectedBuildingId] = useState<string>('');
  const [selectedFloorId, setSelectedFloorId] = useState<string>('');
  const [startNodeId, setStartNodeId] = useState<string | null>(null);
  const [endNodeId, setEndNodeId] = useState<string | null>(null);
  const [qrModalOpen, setQrModalOpen] = useState(false);
  const [manualModalOpen, setManualModalOpen] = useState(false);
  const [searchFocused, setSearchFocused] = useState(false);
  const [searchOpenSignal, setSearchOpenSignal] = useState(0);
  const [mapInteracted, setMapInteracted] = useState(false);
  const mapInteractedTimerRef = useRef<ReturnType<typeof setTimeout>>();
  const handleMapInteraction = useCallback(() => {
    setMapInteracted(true);
    clearTimeout(mapInteractedTimerRef.current);
    mapInteractedTimerRef.current = setTimeout(() => setMapInteracted(false), 2500);
  }, []);
  const [activeTab, setActiveTab] = useState<'explore' | 'saved' | 'profile'>('explore');
  const [layersPanelOpen, setLayersPanelOpen] = useState(false);
  const ACTIVE_LAYERS_STORAGE_KEY = 'ethi_active_layers';
  const CUSTOM_LAYERS_STORAGE_KEY = 'ethi_custom_layer_visibility';

  const [activeLayers, setActiveLayers] = useState<Set<string>>(() => {
    try {
      const saved = localStorage.getItem(ACTIVE_LAYERS_STORAGE_KEY);
      if (saved) return new Set(JSON.parse(saved) as string[]);
    } catch { /* ignore */ }
    return new Set(['micro-mobility', 'parking', 'entrances']);
  });
  useEffect(() => {
    try { localStorage.setItem(ACTIVE_LAYERS_STORAGE_KEY, JSON.stringify(Array.from(activeLayers))); }
    catch { /* ignore */ }
  }, [activeLayers]);

  // Load the layer set: prefer whatever the Admin Layers Dashboard has
  // saved (created/edited by an admin), falling back to the built-in
  // defaults if nothing has been configured yet.
  const loadBaseLayers = useCallback((): CustomLayer[] => {
    try {
      const saved = localStorage.getItem(ADMIN_LAYERS_STORAGE_KEY);
      if (saved) {
        const parsed = JSON.parse(saved) as CustomLayer[];
        if (Array.isArray(parsed) && parsed.length > 0) return parsed;
      }
    } catch { /* ignore */ }
    return DEFAULT_CUSTOM_LAYERS;
  }, []);

  const applyVisibilityOverrides = useCallback((layers: CustomLayer[], overrides: Record<string, boolean>): CustomLayer[] =>
    layers.map(l => (l.id in overrides ? { ...l, visible: overrides[l.id] } : l))
  , []);

  const loadVisibilityOverrides = useCallback((): Record<string, boolean> => {
    try {
      const saved = localStorage.getItem(CUSTOM_LAYERS_STORAGE_KEY);
      if (saved) return JSON.parse(saved) as Record<string, boolean>;
    } catch { /* ignore */ }
    return {};
  }, []);

  // Overrides only ever get an entry when a visitor explicitly flips a layer
  // themselves (see handleToggleCustomLayer below). Anything a visitor hasn't
  // touched keeps following whatever the Admin Layers Dashboard has set, so a
  // newly-published "on" layer actually shows up instead of getting masked
  // by a stale snapshot.
  const [visibilityOverrides, setVisibilityOverrides] = useState<Record<string, boolean>>(loadVisibilityOverrides);

  useEffect(() => {
    try { localStorage.setItem(CUSTOM_LAYERS_STORAGE_KEY, JSON.stringify(visibilityOverrides)); }
    catch { /* ignore */ }
  }, [visibilityOverrides]);

  const [customLayers, setCustomLayers] = useState<CustomLayer[]>(() =>
    applyVisibilityOverrides(loadBaseLayers(), visibilityOverrides)
  );

  // Keep in sync with the Admin Layers Dashboard — picks up layers added,
  // edited, or removed in another tab (or after returning from /admin),
  // including newly-toggled "on" layers registered by an admin.
  useEffect(() => {
    const refresh = () => setCustomLayers(applyVisibilityOverrides(loadBaseLayers(), visibilityOverrides));
    const handleStorage = (e: StorageEvent) => {
      if (e.key === ADMIN_LAYERS_STORAGE_KEY || e.key === null) refresh();
    };
    window.addEventListener('storage', handleStorage);
    window.addEventListener('focus', refresh);
    document.addEventListener('visibilitychange', refresh);
    return () => {
      window.removeEventListener('storage', handleStorage);
      window.removeEventListener('focus', refresh);
      document.removeEventListener('visibilitychange', refresh);
    };
  }, [loadBaseLayers, applyVisibilityOverrides, visibilityOverrides]);

  const [mapStyleId, setMapStyleId] = useState<MapStyleId>(() => {
    try { return (localStorage.getItem(MAP_STYLE_STORAGE_KEY) as MapStyleId) || DEFAULT_MAP_STYLE_ID; }
    catch { return DEFAULT_MAP_STYLE_ID; }
  });
  useEffect(() => {
    try { localStorage.setItem(MAP_STYLE_STORAGE_KEY, mapStyleId); } catch { /* ignore */ }
  }, [mapStyleId]);

  // ── 3D tilt toggle ──────────────────────────────────────────────────────
  const [is3D, setIs3D] = useState(false);

  // ── A venue's own indoor map (2D plan / 3D world, as the institution set it up) ──
  const [indoorView, setIndoorView] = useState<IndoorView>(venue?.initialView ?? venue?.settings.defaultView ?? '3d');
  // Names start hidden on phones: the place badges carry the map, names are one tap away (Aa).
  const [indoorLayers, setIndoorLayers] = useState<Record<IndoorLayerId, boolean>>(() => ({
    ...(venue?.settings.layers ?? {}),
    ...(typeof window !== 'undefined' && window.innerWidth < 640 ? { labels: false } : {}),
  } as Record<IndoorLayerId, boolean>));
  const [cameraRequest, setCameraRequest] = useState<{ mode: CameraMode; nonce: number } | null>(null);
  const [cameraMode, setCameraMode] = useState<CameraMode | null>(null);
  const [placeFocus, setPlaceFocus] = useState(0);
  const [pendingDestName, setPendingDestName] = useState<string | null>(null);
  /** The person moved the map while walking — stop following them until they tap "Back to me". */
  const [followPaused, setFollowPaused] = useState(false);
  const showDebug = useMemo(() => { try { return new URLSearchParams(window.location.search).has('debug'); } catch { return false; } }, []);

  // ── Custom surface image layers (drape uploaded image onto the ground) ──
  const CUSTOM_IMAGE_LAYERS_KEY = 'ethi_custom_image_layers';
  const ACTIVE_IMAGE_LAYER_KEY = 'ethi_active_image_layer_id';
  const [customImageLayers, setCustomImageLayers] = useState<CustomImageLayer[]>(() => {
    try {
      const saved = localStorage.getItem(CUSTOM_IMAGE_LAYERS_KEY);
      if (saved) return JSON.parse(saved) as CustomImageLayer[];
    } catch { /* ignore */ }
    return [];
  });
  const [activeImageLayerId, setActiveImageLayerId] = useState<string | null>(() => {
    try { return localStorage.getItem(ACTIVE_IMAGE_LAYER_KEY); } catch { return null; }
  });
  useEffect(() => {
    try { localStorage.setItem(CUSTOM_IMAGE_LAYERS_KEY, JSON.stringify(customImageLayers)); } catch { /* ignore */ }
  }, [customImageLayers]);
  useEffect(() => {
    try {
      if (activeImageLayerId) localStorage.setItem(ACTIVE_IMAGE_LAYER_KEY, activeImageLayerId);
      else localStorage.removeItem(ACTIVE_IMAGE_LAYER_KEY);
    } catch { /* ignore */ }
  }, [activeImageLayerId]);
  const handleAddImageLayer = useCallback((layer: CustomImageLayer) => {
    setCustomImageLayers(prev => [...prev, layer]);
    setActiveImageLayerId(layer.id);
  }, []);
  const activeImageLayer = customImageLayers.find(l => l.id === activeImageLayerId) ?? null;
  const [showDragHint, setShowDragHint] = useState(true);
  // forceOutdoorView is seeded from the user's mode selection
  const [forceOutdoorView, setForceOutdoorView] = useState(mapMode === 'outdoor');
  const [selectedPOI, setSelectedPOI] = useState<POI | null>(null);
  /** Starting-point picker: the modal itself, and whether a "tap the map"
   *  pick is currently armed (see handleOriginMapClick). */
  const [startingPointModalOpen, setStartingPointModalOpen] = useState(false);
  const [pickingOriginOnMap, setPickingOriginOnMap] = useState(false);
  const [showOnboarding, setShowOnboarding] = useState(() => {
    try { return !localStorage.getItem('ethi_onboarded'); } catch { return true; }
  });
  const { profile, loading: profileLoading, syncActivityStats, hasEmail, updateEmail } = useProfile();
  const { isVisited, recordVisit } = useVisitedPlaces(profile?.id);
  const arrivalCountedRef = useRef(false);
  const walkStartRef = useRef<number | null>(null);
  // Email gate — "Mark as visited" requires an email on file (same gate the
  // Save flow uses in BottomSheet), so history is tied to an identifiable
  // profile rather than an anonymous, easily-lost guest row.
  const [visitedEmailGateOpen, setVisitedEmailGateOpen] = useState(false);
  const [pendingVisitPoi, setPendingVisitPoi] = useState<POI | null>(null);
  /** Set when "My location" is tapped while GPS is off — consumed once the first fix arrives. */
  const wantsMyLocationRef = useRef(false);

  // ── Venue map imperative controls (zoom/pan) ──────────────────────────────
  const venueMapControls = useRef<{ zoomIn: () => void; zoomOut: () => void; recenter: () => void; resetNorth: () => void } | null>(null);
  const handleVenueZoomIn = useCallback(() => venueMapControls.current?.zoomIn(), []);
  const handleVenueZoomOut = useCallback(() => venueMapControls.current?.zoomOut(), []);
  const handleVenueRecenter = useCallback(() => venueMapControls.current?.recenter(), []);
  const handleVenueResetNorth = useCallback(() => venueMapControls.current?.resetNorth(), []);
  const [mapBearing, setMapBearing] = useState(0);

  // ── Indoor floor map imperative controls (zoom/pan/recenter-on-guidance) ──
  const floorMapControls = useRef<{ zoomIn: () => void; zoomOut: () => void; recenter: () => void } | null>(null);
  const handleFloorZoomIn = useCallback(() => floorMapControls.current?.zoomIn(), []);
  const handleFloorZoomOut = useCallback(() => floorMapControls.current?.zoomOut(), []);
  const handleFloorRecenter = useCallback(() => floorMapControls.current?.recenter(), []);

  useEffect(() => {
    setForceOutdoorView(mapMode === 'outdoor');
  }, [mapMode]);

  useEffect(() => {
    if (allBuildings.length > 0 && !selectedBuildingId) {
      setSelectedBuildingId(allBuildings[0].id);
      if (allBuildings[0].floors.length > 0) {
        setSelectedFloorId(allBuildings[0].floors[0].id);
      }
    }
  }, [allBuildings, selectedBuildingId]);

  const building = useMemo(() =>
    allBuildings.find(b => b.id === selectedBuildingId) ?? allBuildings[0] ?? sampleBuilding,
    [allBuildings, selectedBuildingId]
  );

  const currentFloor = useMemo(() =>
    building.floors.find(f => f.id === selectedFloorId) ?? building.floors[0] ?? null,
    [building, selectedFloorId]
  );

  const handleNavFloorChange = useCallback((floorId: string) => setSelectedFloorId(floorId), []);

  const { pois: loadedPois } = usePOILoader(venue ? null : building?.id);
  const pois = venue ? venue.pois : loadedPois;
  const outdoorPois = useMemo(() => pois.filter(p => p.isOutdoor && p.lat != null && p.lng != null), [pois]);
  useEffect(() => { for (const b of allBuildings) rememberVenueName(b.id, b.name); rememberPlaces(pois); }, [allBuildings, pois]);
  // Curated venue graph (venue_nodes/venue_paths): fast, no-network-dependency
  // outdoor routing. Falls back to live OSM/Overpass automatically wherever
  // it doesn't (yet) have coverage — see HybridNavigationBrain.findVenueRoute.
  // Draw/expand real paths for a building from /admin/venue-paths.
  const { graph: venueGraph, loading: venueGraphLoading } = useVenueGraph(building?.id, outdoorPois);

  const {
    state: brainState, brain,
    startNavigation: brainStartNav, stopNavigation: brainStopNav,
    toggleVoice, dismissPOI, pushIndoorPosition,
    recordStep, recordHeading, recordNoise,
    startGPS, stopGPS, setIndoorAnchor,
    speak: brainSpeak, setNavigationMode, setTravelMode, preloadOutdoorGraph, setLanguage: brainSetLanguage,
  } = useNavigationBrain({
    buildings: allBuildings,
    activeBuildingId: selectedBuildingId,
    activeFloorId: selectedFloorId,
    pois,
    venueGraph,
    onFloorChange: handleNavFloorChange,
    autoStart: true,
  });

  // Apply the travel mode chosen on the LocationSplash screen (or a later
  // in-app change) to the brain's outdoor routing engine.
  useEffect(() => {
    setTravelMode(initialTravelMode);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const travelMode = brainState.travelMode;

  // Guidance language (EN / አማ): the HUD, the instructions and the voice.
  const [lang, setLang] = useGuidanceLang();
  useEffect(() => { brainSetLanguage(lang); }, [lang, brainSetLanguage]);
  useEffect(() => { brain.setAmharicNames(venue?.amNames ?? {}); }, [brain, venue?.amNames]);

  // Walking into a building: "GPS can't follow us in here", then the 3D view glides in.
  const [handoff, setHandoff] = useState<Handoff | null>(null);
  const [introNonce, setIntroNonce] = useState(0);
  const prevEnvRef = useRef(brainState.environment);
  useEffect(() => {
    const prev = prevEnvRef.current;
    prevEnvRef.current = brainState.environment;
    if (prev === 'outdoor' && brainState.environment === 'indoor' && brainState.routingMode !== 'none') {
      setHandoff({ kind: 'gps', venue: building?.name ?? '', nonce: Date.now() });
      setIntroNonce(n => n + 1);
    }
  }, [brainState.environment, brainState.routingMode, building?.name]);

  const navSnapshot = brainState.indoor;
  const navIsActive = brainState.routingMode !== 'none' && brainState.status !== 'idle';

  const brainPath = brainState.indoorPath;

  // BUG FIX — multi-floor routing: `brainPath` is the FULL route across every
  // floor it passes through (that's what NavigationController.currentPath
  // returns). Nodes on different floors live in *independent* pixel/SVG
  // coordinate spaces per floor plan — floor 2's (x,y) values are NOT the
  // same physical space as floor 1's. Feeding the whole cross-floor path
  // into usePDRNavigation made it snap the user's live (x,y) against nodes
  // from other floors too, corrupting nearest-node/progress/"arrived"
  // detection and the on-device reroute logic the moment a route spanned
  // more than one floor. It now only ever sees the segment that's actually
  // walkable on the floor currently being displayed.
  const currentFloorPath = useMemo(() => {
    if (!brainPath.length || !currentFloor) return null;
    const floorNodes = brainPath.filter(n => n.floorId === currentFloor.id);
    return floorNodes.length > 1 ? floorNodes : null;
  }, [brainPath, currentFloor]);

  const pdrPath = currentFloorPath;

  const handleReroute = useCallback((_newPath: NavNode[]) => {}, []);

  const pdrScale = useMemo(() => ({ pxPerMeter: pxPerMeterOf(building), rotationDeg: building.rotationDeg ?? 0 }), [building]);
  const { state: pdrState, start: startPDR, stop: stopPDR, requestSensors, testSensors, stopTestSensors } = usePDRNavigation(
    pdrPath, currentFloor?.nodes ?? [], currentFloor?.edges ?? [], endNodeId, handleReroute, pdrScale,
  );
  const [isTestingSensors, setIsTestingSensors] = useState(false);

  useEffect(() => {
    // Including the very last position (the step that completes the walk),
    // so the navigation engine sees the arrival too.
    if (navIsActive && (pdrState.isNavigating || pdrState.isComplete)) {
      pushIndoorPosition(pdrState.currentPosition.x, pdrState.currentPosition.y);
    }
  }, [pdrState.currentPosition.x, pdrState.currentPosition.y, navIsActive, pdrState.isNavigating, pdrState.isComplete, pushIndoorPosition]);

  useEffect(() => {
    // Not once they've arrived — the route is still "active" then, and
    // restarting would put the dot back at the start of the route.
    if (!navIsActive || brainState.status === 'arrived' || pdrState.isNavigating || pdrState.isComplete || !pdrPath || pdrPath.length < 2) return;
    startPDR();
  }, [navIsActive, brainState.status, pdrPath, pdrState.isNavigating, pdrState.isComplete, startPDR]);

  useEffect(() => {
    if (navIsActive && pdrState.isNavigating) {
      recordHeading(pdrState.headingDeg ?? 0);
      recordNoise(pdrState.accelVariance);
    }
  }, [pdrState.headingDeg, pdrState.accelVariance, navIsActive, pdrState.isNavigating, recordHeading, recordNoise]);

  // FIX: stepCount changes mean a step just fired inside the StepDetector.
  // We forward it to the brain with the actual current timestamp so the
  // confidence engine and instruction engine get accurate cadence data.
  // (Using Date.now() here is fine — the StepDetector fires synchronously
  // before React re-renders, so the wall-clock delta is < 1 render frame.)
  const prevStepCountRef = useRef(0);
  useEffect(() => {
    if (!navIsActive || !pdrState.isNavigating) return;
    if (pdrState.stepCount > prevStepCountRef.current) {
      prevStepCountRef.current = pdrState.stepCount;
      recordStep(Date.now());
    }
  }, [pdrState.stepCount, navIsActive, pdrState.isNavigating, recordStep]);

  useEffect(() => {
    if (pdrState.isNavigating && walkStartRef.current === null) walkStartRef.current = Date.now();
  }, [pdrState.isNavigating]);

  useEffect(() => {
    if (brainState.status === 'arrived' && (pdrState.isNavigating || pdrState.isComplete)) stopPDR();
  }, [brainState.status, pdrState.isNavigating, pdrState.isComplete, stopPDR]);

  useEffect(() => {
    if (brainState.status === 'arrived' && !arrivalCountedRef.current) {
      arrivalCountedRef.current = true;
      celebrate();
      try { navigator.vibrate?.([80, 60, 160]); } catch { /* not supported */ }
      void syncActivityStats(pdrState.stepCount, { visit: true });
      const arrivedPoi = brainState.destination?.poi;
      const started = walkStartRef.current;
      walkStartRef.current = null;
      if (arrivedPoi) {
        const place = snapshotOfPoi(arrivedPoi);
        logActivity({
          kind: 'walk', title: `Walked to ${place.name}`, placeId: place.id, buildingId: place.buildingId, venueName: place.venueName,
          steps: pdrState.stepCount || undefined, meters: pdrState.stepCount ? Math.round(pdrState.stepCount * STRIDE_M) : undefined,
          seconds: started ? Math.round((Date.now() - started) / 1000) : undefined,
        });
        void recordVisit(arrivedPoi.id, 'auto', { log: false });
      }
    }
    if (brainState.status !== 'arrived') {
      arrivalCountedRef.current = false;
    }
  }, [brainState.status, brainState.destination, pdrState.stepCount, syncActivityStats, recordVisit]);

  // Every step counts — walking around a venue, not only on a guided walk.
  // Saved in batches (every 10 steps, or 3 s after the last one, or when the
  // page is hidden): on this device at once, and to the profile.
  const stepsSavedRef = useRef(0);
  const flushSteps = useCallback(() => {
    const n = pdrState.stepCount;
    if (n < stepsSavedRef.current) stepsSavedRef.current = 0; // the counter restarted (a new walk)
    const delta = n - stepsSavedRef.current;
    if (delta <= 0) return;
    stepsSavedRef.current = n;
    addSteps(delta);
    void syncActivityStats(n);
  }, [pdrState.stepCount, syncActivityStats]);
  const flushRef = useRef(flushSteps);
  flushRef.current = flushSteps;
  useEffect(() => {
    if (pdrState.stepCount <= 0) return;
    if (pdrState.stepCount - stepsSavedRef.current >= 10 || pdrState.stepCount < stepsSavedRef.current) { flushSteps(); return; }
    const t = setTimeout(() => flushRef.current(), 3000);
    return () => clearTimeout(t);
  }, [pdrState.stepCount, flushSteps]);
  useEffect(() => {
    const hide = () => { if (document.visibilityState === 'hidden') flushRef.current(); };
    document.addEventListener('visibilitychange', hide);
    window.addEventListener('pagehide', hide);
    return () => { document.removeEventListener('visibilitychange', hide); window.removeEventListener('pagehide', hide); hide(); };
  }, []);

  // iPhones only send motion (steps, compass) after the visitor allows it,
  // and Safari only asks from a tap. So the first tap on the map asks, if
  // nothing else has yet.
  useEffect(() => {
    const needsPrompt = typeof DeviceMotionEvent !== 'undefined' && typeof (DeviceMotionEvent as unknown as { requestPermission?: unknown }).requestPermission === 'function';
    if (!needsPrompt || pdrState.sensorPermission === 'granted' || pdrState.sensorPermission === 'denied') return;
    const ask = () => { void requestSensors(); };
    document.addEventListener('click', ask, { once: true, capture: true });
    return () => document.removeEventListener('click', ask, { capture: true });
  }, [pdrState.sensorPermission, requestSensors]);

  const clearAll = useCallback(() => {
    brainStopNav(); stopPDR();
    setStartNodeId(null); setEndNodeId(null);
  }, [brainStopNav, stopPDR]);

  const { anchor, anchorLocation, clearAnchor } = useLocationAnchor({
    buildings: allBuildings,
    onBuildingChange: setSelectedBuildingId,
    onFloorChange: setSelectedFloorId,
    onStartChange: setStartNodeId,
    onClearPath: clearAll,
  });

  useEffect(() => {
    setIndoorAnchor(anchor.isAnchored, anchor.isAnchored ? selectedBuildingId : null);
  }, [anchor.isAnchored, selectedBuildingId, setIndoorAnchor]);

  const handleBuildingChange = (id: string) => {
    setSelectedBuildingId(id);
    const b = allBuildings.find(b => b.id === id);
    if (b?.floors.length) setSelectedFloorId(b.floors[0].id);
    clearAll();
  };

  const handleFloorChange = (id: string) => { setSelectedFloorId(id); clearAll(); };

  const handleNavigate = useCallback(() => {
    if (!startNodeId || !endNodeId) return;
    const ok = brainStartNav({ startNodeId, destination: { nodeId: endNodeId, name: 'Destination' } });
    if (!ok) toast.error('No route found');
  }, [startNodeId, endNodeId, brainStartNav]);

  const handleStartWalking = useCallback(() => {
    if (brainState.routingMode === 'none') return;
    startPDR();
  }, [brainState.routingMode, startPDR]);

  const handleRoomClick = useCallback((room: Room) => {
    if (navIsActive || pdrState.isNavigating) return;
    if (!startNodeId) {
      setStartNodeId(room.nodeId);
      toast.info(`Start: ${room.name || 'Selected room'} — now tap your destination room`, { duration: 2500 });
    } else if (!endNodeId) {
      if (room.nodeId === startNodeId) return; // tapping the same room again does nothing
      setEndNodeId(room.nodeId);
    } else {
      // Both already picked — a third tap starts a fresh selection.
      setStartNodeId(room.nodeId);
      setEndNodeId(null);
      brainStopNav();
      toast.info(`Start: ${room.name || 'Selected room'} — now tap your destination room`, { duration: 2500 });
    }
  }, [startNodeId, endNodeId, navIsActive, pdrState.isNavigating, brainStopNav]);

  // ── Room-to-room "Directions" card ──────────────────────────────────────
  // Google-Maps-style: once both a start room and a destination room are
  // picked on the floor plan, surface a single obvious Navigate action
  // instead of requiring a trip to the bottom sheet's start/end pickers.
  const roomNameByNodeId = useMemo(() => {
    const m = new Map<string, string>();
    for (const floor of building.floors) {
      for (const room of floor.rooms) m.set(room.nodeId, room.name);
      for (const node of floor.nodes) if (!m.has(node.id) && node.name) m.set(node.id, node.name);
    }
    return m;
  }, [building]);

  const buildingGraph = useMemo(() => BuildingGraph.fromBuilding(building), [building]);

  const roomRoutePreview = useMemo(() => {
    if (!startNodeId || !endNodeId || startNodeId === endNodeId) return null;
    return buildingGraph.findPath(startNodeId, endNodeId);
  }, [buildingGraph, startNodeId, endNodeId]);

  const handleRoomRouteSwap = useCallback(() => {
    setStartNodeId(endNodeId);
    setEndNodeId(startNodeId);
  }, [startNodeId, endNodeId]);

  const handleRoomRouteClose = useCallback(() => {
    setStartNodeId(null);
    setEndNodeId(null);
  }, []);

  const nearbyPOIs = brainState.poi.nearby;
  const autoTriggeredPoi = brainState.poi.autoTriggered;
  const nearbyPoiIds = useMemo(() => new Set(nearbyPOIs.map(n => n.poi.id)), [nearbyPOIs]);

  const visiblePOI = selectedPOI ?? autoTriggeredPoi;

  // "N min walk" under each place's 3D label on this floor, from where the visitor is.
  const indoorPinSubs = useMemo<Record<string, string> | undefined>(() => {
    if (!startNodeId || !venue || !currentFloor) return undefined;
    const out: Record<string, string> = {};
    for (const p of venue.places) {
      if (p.floorId !== currentFloor.id || p.id === startNodeId) continue;
      const r = buildingGraph.findPath(startNodeId, p.id);
      if (r) out[p.id] = `${Math.max(1, Math.round(r.estimatedSeconds / 60))} min walk`;
    }
    return out;
  }, [startNodeId, venue, currentFloor, buildingGraph]);

  // How far the open place is on foot from where the visitor is (the place card's walk chips).
  const visiblePOIWalk = useMemo<WalkInfo | null>(() => {
    if (!visiblePOI?.nodeId) return null;
    const floorId = buildingGraph.getNodeFloorId(visiblePOI.nodeId);
    const floor = floorId ? building.floors.find(fl => fl.id === floorId)?.name ?? null : null;
    if (!startNodeId || startNodeId === visiblePOI.nodeId) return floor ? { metres: 0, minutes: 0, from: '', floor, unknown: true } : null;
    const r = buildingGraph.findPath(startNodeId, visiblePOI.nodeId);
    if (!r) return null;
    const startName = roomNameByNodeId.get(startNodeId);
    return {
      metres: r.walkMeters ?? r.distance / pdrScale.pxPerMeter,
      minutes: Math.max(0, Math.round(r.estimatedSeconds / 60)),
      from: startName ? `from ${startName}` : 'from you',
      floor,
    };
  }, [visiblePOI, startNodeId, buildingGraph, building, roomNameByNodeId, pdrScale]);
  // Only let a live GPS "you're outdoors" reading auto-flip the view if we were
  // genuinely tracking the person as indoor a moment ago (i.e. they really
  // walked out of the building). Otherwise this would fight an explicit
  // building selection from search — the person picks a building, we set
  // forceOutdoorView false to show its indoor map, but the positioning engine
  // still reports environment 'outdoor' (because they're not physically
  // standing inside its geofence), and that used to win regardless of the
  // manual selection, permanently stuck showing the outdoor map instead.
  const wasLiveIndoorRef = useRef(false);
  useEffect(() => {
    if (brainState.environment === 'indoor') wasLiveIndoorRef.current = true;
    if (forceOutdoorView) wasLiveIndoorRef.current = false;
  }, [brainState.environment, forceOutdoorView]);

  const showOutdoorMap = forceOutdoorView || (
    wasLiveIndoorRef.current && brainState.environment === 'outdoor'
  ) || (
    brainState.environment !== 'indoor' &&
    Boolean(visiblePOI?.isOutdoor && visiblePOI.lat != null && visiblePOI.lng != null)
  );

  const showRoomRouteCard = Boolean(
    startNodeId && endNodeId && startNodeId !== endNodeId &&
    !navIsActive && !pdrState.isNavigating && !showOutdoorMap && !visiblePOI,
  );

  // Pre-warm the outdoor routing graph as soon as the outdoor map is shown —
  // so that once a GPS fix comes in (or a place is searched), a route/path
  // can be computed immediately instead of waiting on a cold graph load.
  useEffect(() => {
    if (!showOutdoorMap) return;
    const center = building.originLat != null && building.originLng != null
      ? { lat: building.originLat, lng: building.originLng }
      : { lat: 9.0192, lng: 38.7628 }; // Unity Park fallback
    preloadOutdoorGraph(center);
  }, [showOutdoorMap, building.originLat, building.originLng, preloadOutdoorGraph]);

  // Buildings with a real geo-anchor, for the 3D highlight + zoom-to-enter prompt.
  const venueBuildings = useMemo<VenueBuildingFootprint[]>(() =>
    allBuildings
      .filter(b => b.originLat != null && b.originLng != null)
      .map(b => ({
        id: b.id,
        name: b.name,
        center: { lat: b.originLat as number, lng: b.originLng as number },
        radiusM: b.radiusM ?? 40,
      })),
    [allBuildings]
  );

  const handleEnterBuilding = useCallback((buildingId: string) => {
    setSelectedBuildingId(buildingId);
    setForceOutdoorView(false);
    onChangeMode('indoor');
    const name = allBuildings.find(b => b.id === buildingId)?.name ?? '';
    setHandoff({ kind: 'enter', venue: name, nonce: Date.now() });
    setIntroNonce(n => n + 1);
  }, [onChangeMode, allBuildings]);

  /** Zoomed out far enough on the indoor floor plan — head back outside. */
  const handleExitBuilding = useCallback(() => {
    setForceOutdoorView(true);
    onChangeMode('outdoor');
  }, [onChangeMode]);

  const handlePOIClose = useCallback(() => {
    if (selectedPOI) setSelectedPOI(null);
    else if (autoTriggeredPoi) dismissPOI(autoTriggeredPoi.id);
  }, [selectedPOI, autoTriggeredPoi, dismissPOI]);

  // FIX — tapping an existing POI pin already on the outdoor map went
  // straight to setSelectedPOI with no preload, unlike search
  // (handleOutdoorPlaceSelect) and tapping empty map space
  // (handleOutdoorMapClick), which both call preloadOutdoorGraph() the
  // instant the pin is set so the street graph has a head start loading
  // while the POI card is shown. Without that head start, by the time
  // "Navigate" is tapped the graph is still cold and computeOutdoorRoute()
  // falls back to the direct-line route — this is why clicking an existing
  // pin showed a direct route while search worked fine. Give it the same
  // preload the other two flows already get.
  const handleOutdoorPOISelect = useCallback((poi: POI) => {
    setSelectedPOI(poi);
    if (poi.isOutdoor && poi.lat != null && poi.lng != null) {
      preloadOutdoorGraph({ lat: poi.lat, lng: poi.lng });
    }
  }, [preloadOutdoorGraph]);

  // FIX — DesktopSidebar / MapSearchBar's "browse outdoor POIs" lists wire
  // onOutdoorPOISelect straight to this handler, skipping setSelectedPOI/
  // handleOutdoorPOISelect entirely — so those clicks got zero preload
  // head start at all (not even the "hope it loads before you tap
  // Navigate" gap the pin-card flow had), and reliably showed a stuck
  // direct-line route. preloadOutdoorGraph() now also retries the route
  // once the graph resolves (see HybridNavigationBrain.preloadOutdoorGraph),
  // so calling it here — even after brainStartNav has already kicked off
  // the initial (likely direct) route — is enough to upgrade it to the
  // real street-snapped path the moment the data arrives.
  /** A destination chosen before we knew where the person is — started once they set their location. */
  const pendingDestinationRef = useRef<POI | null>(null);
  const startPendingFrom = useCallback((nodeId: string) => {
    const poi = pendingDestinationRef.current;
    pendingDestinationRef.current = null;
    if (!poi?.nodeId || poi.nodeId === nodeId) return;
    setEndNodeId(poi.nodeId);
    // anchorLocation() sets the start a moment later; route from the known node now.
    setTimeout(() => {
      const ok = brainStartNav({ startNodeId: nodeId, destination: { nodeId: poi.nodeId!, poi, name: poi.name } });
      if (!ok) toast.error('No route found to this place');
    }, 80);
  }, [brainStartNav]);

  const handlePOINavigate = useCallback((poi: POI) => {
    setSelectedPOI(null);
    if (autoTriggeredPoi) dismissPOI(autoTriggeredPoi.id);
    if (poi.isOutdoor && poi.lat != null && poi.lng != null) {
      // An outdoor place: the route is on the outdoor map, wherever the visitor was looking.
      setForceOutdoorView(true);
      onChangeMode('outdoor');
      preloadOutdoorGraph({ lat: poi.lat, lng: poi.lng });
      const ok = brainStartNav({ destination: { geo: { lat: poi.lat, lng: poi.lng }, poi, name: poi.name } });
      if (!ok) toast.info('Getting your location — the route to this spot will appear in a moment.');
      return;
    }
    if (!poi.nodeId) { toast.info('This POI cannot be routed to from here.'); return; }
    if (!startNodeId) {
      // Ask where they are (QR or pick the spot) and set off as soon as they say.
      pendingDestinationRef.current = poi;
      setPendingDestName(poi.name);
      setManualModalOpen(true);
      return;
    }
    setEndNodeId(poi.nodeId);
    setTimeout(() => {
      const ok = brainStartNav({ startNodeId, destination: { nodeId: poi.nodeId, poi, name: poi.name } });
      if (!ok) toast.error('No route found to this POI');
    }, 0);
  }, [startNodeId, autoTriggeredPoi, dismissPOI, brainStartNav, preloadOutdoorGraph, onChangeMode]);

  /** Outdoor search result (from OpenStreetMap) was picked in MapSearchBar.
   *
   * FIX — this used to call brainStartNav() directly and never touch
   * selectedPOI at all, so a search pick skipped straight into routing with
   * no name/details shown anywhere, and — since no POI object existed —
   * "Mark as visited" had nothing to attach a name to either (and Navigate
   * couldn't be re-triggered from a card since there was no card).
   * handleOutdoorMapClick already does this correctly for a tapped map
   * point (wraps it as a one-off outdoor POI and shows it via POICard);
   * this now does the same for a searched place, using the richer data
   * Nominatim actually gives us (place.name / place.displayName / place.type)
   * instead of the generic "Selected location" placeholder that flow uses.
   * Tapping "Navigate" on that card already fully supports outdoor
   * lat/lng POIs via handlePOINavigate, and "Mark as visited" already shows
   * poi.name straight from this object via recordVisitWithFeedback. */
  const handleOutdoorPlaceSelect = useCallback((place: OutdoorPlaceResult) => {
    setForceOutdoorView(true);
    onChangeMode('outdoor');
    const pin: POI = {
      id: place.id,
      nodeId: null,
      buildingId: building.id,
      name: place.name,
      description: place.displayName,
      category: 'attraction',
      subcategory: place.type,
      isFeatured: false,
      triggerRadius: 20,
      promotions: [],
      lat: place.lat,
      lng: place.lng,
      isOutdoor: true,
    };
    setSelectedPOI(pin);
    // FIX — handleOutdoorMapClick (tapping a spot on the map) already
    // kicks off preloadOutdoorGraph() the moment a pin drops, so by the
    // time "Navigate" is tapped the local walking-path graph around that
    // point is usually already loaded and computeOutdoorRoute() resolves
    // a real street-snapped route immediately. A place picked from search
    // never called this, so Navigate started from a cold graph every time
    // — the first route shown was always the direct-line fallback, only
    // swapping to the real street route later (or not at all, if the
    // person doesn't stay on the card long enough / doesn't move to
    // trigger a GPS-driven retry). Preloading here as soon as the place is
    // picked gives it the same head start the map-tap flow gets.
    preloadOutdoorGraph({ lat: place.lat, lng: place.lng });
  }, [building.id, onChangeMode, preloadOutdoorGraph]);

  /** Tapped an empty spot on the outdoor map — drop a pin there and offer
   *  it as a selectable destination, the same way tapping a room selects a
   *  destination indoors. Reuses the existing POICard/"Navigate" flow by
   *  wrapping the tapped point as a lightweight, one-off outdoor POI.
   *
   * FIX — this used to hardcode name: 'Selected location' / description:
   * 'Tapped location on the map' for every tap, so the card, the Navigate
   * flow, and "Mark as visited" (all of which just read poi.name/
   * poi.description straight off this object — see handleOutdoorPlaceSelect
   * above) showed that same placeholder instead of anything about the
   * actual spot. A raw lat/lng has no name by itself — it needs a reverse
   * geocode lookup (the same Nominatim service useOutdoorPlaceSearch
   * already uses for forward search, just run backwards) to turn "this
   * point" into "Meskel Square" or similar. The pin still appears
   * immediately with a "Locating…" placeholder so the tap feels instant,
   * then gets patched in-place with the resolved name/details a moment
   * later — matched by id, and guarded against a stale/aborted lookup
   * clobbering whatever's selected by the time it resolves. */
  const reverseGeocodeAbortRef = useRef<AbortController | null>(null);
  const handleOutdoorMapClick = useCallback((coord: GeoCoord) => {
    const pinId = `pin-${coord.lat.toFixed(6)}-${coord.lng.toFixed(6)}`;
    const pin: POI = {
      id: pinId,
      nodeId: null,
      buildingId: building.id,
      name: 'Locating…',
      description: '',
      category: 'attraction',
      subcategory: '',
      isFeatured: false,
      triggerRadius: 20,
      promotions: [],
      lat: coord.lat,
      lng: coord.lng,
      isOutdoor: true,
    };
    setSelectedPOI(pin);
    preloadOutdoorGraph(coord);

    reverseGeocodeAbortRef.current?.abort();
    const controller = new AbortController();
    reverseGeocodeAbortRef.current = controller;
    void reverseGeocode(coord.lat, coord.lng, controller.signal).then((result) => {
      setSelectedPOI(prev => {
        if (!prev || prev.id !== pinId) return prev;
        return result
          ? { ...prev, name: result.name, description: result.displayName, subcategory: result.type }
          : { ...prev, name: 'Selected location', description: '' };
      });
    });
  }, [building.id]);

  // ── Starting point (outdoor "From") ────────────────────────────────────
  // Google-Maps-style: routes normally start from the device's live GPS
  // fix, but the person can override that with an arbitrary point — search
  // for one, or tap it on the map — via StartingPointModal. brain holds the
  // override (see HybridNavigationBrain.setCustomOrigin); these are just
  // the UI-side entry points into it.

  const handleUseCurrentLocationAsOrigin = useCallback(() => {
    brain.setCustomOrigin(null);
  }, [brain]);

  const handleSelectOriginPlace = useCallback((place: OutdoorPlaceResult) => {
    brain.setCustomOrigin({ geo: { lat: place.lat, lng: place.lng }, label: place.name });
  }, [brain]);

  const handlePickOriginOnMap = useCallback(() => {
    setPickingOriginOnMap(true);
    toast.info('Tap a point on the map to set your starting point', { duration: 3000 });
  }, []);

  /** Tapped the map while a "choose starting point" pick was armed —
   *  reverse-geocode the point (same lookup handleOutdoorMapClick uses for
   *  a destination pin) and set it as the route's custom origin instead of
   *  dropping a destination pin. */
  const originGeocodeAbortRef = useRef<AbortController | null>(null);
  const handleOriginMapClick = useCallback((coord: GeoCoord) => {
    setPickingOriginOnMap(false);
    // Set immediately with a generic label so the route recomputes without
    // waiting on the network — patched in place once the name resolves.
    brain.setCustomOrigin({ geo: coord, label: 'Selected location' });

    originGeocodeAbortRef.current?.abort();
    const controller = new AbortController();
    originGeocodeAbortRef.current = controller;
    void reverseGeocode(coord.lat, coord.lng, controller.signal).then((result) => {
      if (controller.signal.aborted || !result) return;
      brain.setCustomOrigin({ geo: coord, label: result.name });
    });
  }, [brain]);

  const handlePOISpeak = useCallback((poi: POI) => {
    const promos = poi.promotions?.filter(p => p.isActive) ?? [];
    const text = promos.length > 0
      ? `${poi.name}. Special offer: ${promos[0].title}. ${poi.description}`
      : `${poi.name}. ${poi.description}`;
    brainSpeak({ text, priority: 'poi' });
  }, [brainSpeak]);

  // Any place can be marked visited — ad hoc outdoor pins too: visits are kept
  // on the device first and synced to the profile when the database can hold them.
  const recordVisitWithFeedback = useCallback((poi: POI) => {
    rememberPlaces([poi]);
    void Promise.resolve(poi.id).then((realId) => {
      if (!realId) {
        toast.error("Couldn't save — check your connection and try again", { duration: 3500 });
        return;
      }
      return recordVisit(realId, 'manual').then((ok) => {
        if (ok) {
          toast.success(`Marked ${poi.name} as visited`, { duration: 2500 });
          // Swap the ad hoc id for the now-real one on the still-open card
          // (and anywhere else this exact pin is referenced) so the
          // "visited" badge — which looks up isVisited(visiblePOI.id) —
          // actually lights up, and so marking it again in this session
          // updates the same pois/visited_places rows instead of creating
          // a duplicate.
          if (realId !== poi.id) {
            setSelectedPOI(prev => (prev && prev.id === poi.id ? { ...prev, id: realId } : prev));
          }
        } else {
          toast.error("Couldn't save — check your connection and try again", { duration: 3500 });
        }
      });
    });
  }, [recordVisit]);

  const handleMarkVisited = useCallback((poi: POI) => {
    recordVisitWithFeedback(poi);
  }, [recordVisitWithFeedback]);

  const handleVisitedEmailGateSubmit = useCallback(async (email: string): Promise<boolean> => {
    if (!updateEmail) return false;
    const ok = await updateEmail(email);
    if (!ok) return false;

    setVisitedEmailGateOpen(false);
    if (pendingVisitPoi) {
      const poi = pendingVisitPoi;
      setPendingVisitPoi(null);
      recordVisitWithFeedback(poi);
    }
    return true;
  }, [updateEmail, pendingVisitPoi, recordVisitWithFeedback]);

  const handleQRScan = useCallback((payload: QRAnchorPayload) => {
    setQrModalOpen(false);
    const result = anchorLocation(payload);
    if (result.success) {
      // FIX — anchorLocation() above already switches the underlying
      // building/floor/start-node data, but nothing was ever flipping the
      // view itself out of outdoor mode. A QR code is almost always
      // scanned while still looking at the outdoor map, so `forceOutdoorView`
      // stayed true and `showOutdoorMap` kept rendering the venue map
      // instead of FloorMap — the toast said the right building, but the
      // indoor floor plan never actually appeared. Same fix
      // handleEnterBuilding already uses.
      setForceOutdoorView(false);
      onChangeMode('indoor');
      void syncActivityStats(pdrState.stepCount, { visit: true });
      const scannedPoi = pois.find(p => p.nodeId === result.nodeId);
      if (scannedPoi) void recordVisit(scannedPoi.id, 'auto');
      if (result.nodeId) startPendingFrom(result.nodeId);
      // FIX — this used to show the raw payload.nodeId (a UUID, e.g.
      // "You're at 7e2b1c4a-...") because anchorLocation() only returned
      // {success}. It now hands back the resolved building/floor/node
      // names, so show something a person actually asked for — and add a
      // "Where to?" action that opens the same search panel a manual tap
      // would, so the next step (pick a destination) is one tap away
      // instead of a dead-end confirmation toast.
      toast.success(`You're at ${result.nodeName} — ${result.buildingName}`, {
        description: 'Tap "Where to?" to pick where you want to go.',
        action: {
          label: 'Where to?',
          onClick: () => setSearchOpenSignal(v => v + 1),
        },
      });
    }
    else toast.error('QR anchor failed', { description: result.error });
  }, [anchorLocation, onChangeMode, syncActivityStats, pdrState.stepCount, pois, recordVisit, startPendingFrom]);

  const handleManualConfirm = useCallback((buildingId: string, floorId: string, nodeId: string) => {
    setManualModalOpen(false);
    const result = anchorLocation({ buildingId, floorId, nodeId });
    if (result.success) {
      // Same fix as handleQRScan above — manual "set my location" has the
      // same gap, since it goes through the same anchorLocation() call.
      setForceOutdoorView(false);
      onChangeMode('indoor');
      if (pendingDestinationRef.current) toast.success('Location set — starting directions');
      else toast.success('Location set!', { description: 'Select a destination to navigate.' });
      startPendingFrom(nodeId);
    }
    else toast.error('Could not set location', { description: result.error });
  }, [anchorLocation, onChangeMode, startPendingFrom]);

  // ── Venue links: a QR entry point, a place to open, directions ──
  const venueLinkDone = useRef(false);
  useEffect(() => {
    if (!venue || venueLinkDone.current || !building?.floors.length) return;
    venueLinkDone.current = true;
    const entry = venue.entryNodeId ? anchorLocation({ buildingId: building.id, floorId: '', nodeId: venue.entryNodeId }) : null;
    if (entry?.success) {
      setForceOutdoorView(false);
      toast.success(`You're at ${entry.nodeName}`, { description: venue.placeNodeId ? undefined : 'Tap a place to get directions from here.' });
    }
    const place = venue.placeNodeId ? pois.find(p => p.nodeId === venue.placeNodeId) : null;
    if (place && venue.navigate && entry?.success && entry.nodeId) {
      pendingDestinationRef.current = place;
      startPendingFrom(entry.nodeId);
    } else if (place && venue.navigate) {
      setForceOutdoorView(false);
      handlePOINavigate(place);
    } else if (place) {
      setForceOutdoorView(false);
      if (place.nodeId) {
        const fl = building.floors.find(f => f.nodes.some(n => n.id === place.nodeId));
        if (fl) setSelectedFloorId(fl.id);
      }
      setSelectedPOI(place);
    } else if (venue.directionsTo) {
      const d = venue.directionsTo;
      setForceOutdoorView(true);
      onChangeMode('outdoor');
      handlePOINavigate({
        id: `venue-${building.id}`, nodeId: null, buildingId: building.id, name: d.name, description: '',
        category: 'attraction', subcategory: '', isFeatured: false, triggerRadius: 20, promotions: [],
        lat: d.lat, lng: d.lng, isOutdoor: true,
      });
    }
  }, [venue, building, pois, anchorLocation, startPendingFrom, handlePOINavigate, onChangeMode]);

  const handleLayerToggle = (id: string) => {
    setActiveLayers(prev => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  };

  const handleToggleCustomLayer = (id: string) => {
    const current = customLayers.find(l => l.id === id);
    const newVisible = current ? !current.visible : true;
    setCustomLayers(prev =>
      prev.map(l => l.id === id ? { ...l, visible: newVisible } : l)
    );
    setVisibilityOverrides(prev => ({ ...prev, [id]: newVisible }));
  };

  const isLive = pdrState.isNavigating || pdrState.isPaused || pdrState.isComplete || brainState.status === 'arrived';
  const hasPath = brainPath.length > 1;
  const distance = brainState.routingMode === 'outdoor' && brainState.outdoor
    ? Math.round(brainState.outdoor.remainingM)
    : navSnapshot.distanceRemaining > 0 ? navSnapshot.distanceRemaining : null;

  // Let the person know (once per route) when we've fallen back to a direct
  // straight-line route because real path data (Overpass) is unavailable —
  // navigation still works, it just won't hug the actual walkways.
  const isDirectRoute = brainState.routingMode === 'outdoor' && !!brainState.outdoor?.isDirect;
  const notifiedDirectRef = useRef(false);
  useEffect(() => {
    if (isDirectRoute && !notifiedDirectRef.current) {
      notifiedDirectRef.current = true;
      toast.info('Map path data is temporarily unavailable — showing a direct route.', { duration: 4000 });
    }
    if (!isDirectRoute && brainState.routingMode !== 'outdoor') {
      notifiedDirectRef.current = false; // reset for the next navigation session
    }
  }, [isDirectRoute, brainState.routingMode]);

  const navStateCompat = {
    isNavigating: pdrState.isNavigating,
    isPaused: pdrState.isPaused,
    isComplete: brainState.status === 'arrived',
    currentPosition: navSnapshot.state !== 'IDLE' ? navSnapshot.position : pdrState.currentPosition,
    currentNodeIndex: navSnapshot.progressIndex,
    progress: navSnapshot.progressFraction,
    heading: pdrState.heading,
    isWalking: pdrState.isWalking,
  };

  const startName = startNodeId
    ? building.floors.flatMap(f => f.nodes).find(n => n.id === startNodeId)?.name ?? 'Start'
    : brainState.routingMode === 'outdoor'
      ? (brainState.customOrigin?.label ?? 'Your location')
      : '';
  const endName = endNodeId
    ? building.floors.flatMap(f => f.nodes).find(n => n.id === endNodeId)?.name ?? 'Destination'
    : brainState.destination?.name ?? (brainState.routingMode === 'outdoor' ? 'Destination' : '');

  const gpsActive = brainState.position.geo != null;
  const offlinePad = isOffline || venue?.notice ? 28 : 0;

  // ── "My location" crosshair button — start GPS (if needed) and fly the
  // camera to where the person actually is, on the map that's currently shown.
  const handleMyLocation = useCallback(() => {
    if (!gpsActive) {
      wantsMyLocationRef.current = true;
      startGPS();
      toast.info('Finding your location…', { duration: 1500 });
      // If no fix arrives in a reasonable time, this is very likely a
      // browser/OS location-permission issue — say so explicitly instead of
      // leaving the person staring at a map that never centers on them.
      window.setTimeout(() => {
        if (wantsMyLocationRef.current) {
          toast.error('Couldn\u2019t find your location — check that location access is allowed for this site.', { duration: 5000 });
        }
      }, 10_000);
    }
    (showOutdoorMap ? venueMapControls : floorMapControls).current?.recenter();
  }, [gpsActive, startGPS, showOutdoorMap]);

  // If GPS wasn't active yet when "My location" was tapped, recenter again
  // the moment the first fix comes in, instead of leaving the camera put.
  useEffect(() => {
    if (!wantsMyLocationRef.current || !brainState.position.geo) return;
    wantsMyLocationRef.current = false;
    (showOutdoorMap ? venueMapControls : floorMapControls).current?.recenter();
  }, [brainState.position.geo, showOutdoorMap]);

  // ── The venue's indoor map ──
  const registerFloorControls = useCallback((c: Controls) => { floorMapControls.current = c; }, []);
  const otherIndoorFloors = useMemo<FloorLayer[]>(() => (!venue || !currentFloor ? [] : building.floors
    .filter(fl => fl.id !== currentFloor.id)
    .map(fl => ({ id: fl.id, name: fl.name, level: fl.level, walls: fl.walls, rooms: fl.rooms, features: venue.features.filter(x => x.floorId === fl.id) }))),
  [venue, building, currentFloor]);
  // Stable inputs for the 3D / 2D map: the navigation engine re-renders this
  // page on every step and compass reading, and a "new" floor or route each
  // time would make the 3D scene rebuild and its route camera restart.
  const indoorModel = useMemo(() => (venue ? venueModel(building, venue.features, buildingGraph, venue.settings.wallHeightM) : null),
    [venue, building, buildingGraph]);
  const indoorRouteNodes = useMemo(() => (brainPath.length > 1 ? brainPath.map(n => n.id) : roomRoutePreview?.nodeIds ?? null), [brainPath, roomRoutePreview]);

  const indoorFloor = useMemo(() => (venue && currentFloor
    ? { ...currentFloor, features: venue.features.filter(x => x.floorId === currentFloor.id) }
    : null), [venue, currentFloor]);
  const indoorRouteKey = brainState.routingMode !== 'outdoor' && currentFloorPath ? currentFloorPath.map(n => n.id).join('|') : '';
  const indoorRoute = useMemo(() => (indoorRouteKey && currentFloorPath ? currentFloorPath.map(n => ({ x: n.x, y: n.y })) : null),
    [indoorRouteKey]); // eslint-disable-line react-hooks/exhaustive-deps
  /** Where the visitor is on this floor: walking a route, or the spot they scanned. */
  const liveHere = isLive && pdrState.isNavigating ? navStateCompat.currentPosition : null;
  const hereX = liveHere?.x ?? (anchor.isAnchored && anchor.anchorFloorId === currentFloor?.id ? anchor.anchorPosition?.x : undefined);
  const hereY = liveHere?.y ?? (anchor.isAnchored && anchor.anchorFloorId === currentFloor?.id ? anchor.anchorPosition?.y : undefined);
  const indoorHere = useMemo(() => (hereX != null && hereY != null ? { x: hereX, y: hereY } : null), [hereX, hereY]);
  const handleIndoorSelect = useCallback((nodeId: string | null) => {
    if (!nodeId) { setSelectedPOI(null); return; }
    const poi = pois.find(p => p.nodeId === nodeId);
    if (poi) setSelectedPOI(poi);
  }, [pois]);
  // Discover / Explore for this venue (its events, tours, guides and stories), in the panels.
  const venueBrowse = useMemo<VenueBrowseProps | undefined>(() => {
    if (!venue) return undefined;
    const content = venue.content ?? [];
    const now = Date.now();
    const on = content.filter(c => (c.kind === 'event' || c.kind === 'announcement') && (!c.ends_at || new Date(c.ends_at).getTime() >= now)).length;
    return {
      name: building.name, sub: `${venue.places.length} places${on ? ` · ${on} on now` : ''}`,
      accent: { primary: venue.theme.primary, route: venue.theme.route },
      places: venue.places, content, start: venue.browseStart ?? null,
      onPlace: (nodeId: string) => { setForceOutdoorView(false); handleIndoorSelect(nodeId); },
      onNavigate: (nodeId: string) => { const poi = pois.find(p => p.nodeId === nodeId); if (poi) handlePOINavigate(poi); },
    };
  }, [venue, building.name, pois, handleIndoorSelect, handlePOINavigate]);
  // However a place gets picked (map, sidebar, search, a link), frame it on the map.
  const focusedNodeId = venue ? visiblePOI?.nodeId ?? null : null;
  useEffect(() => { if (focusedNodeId) setPlaceFocus(n => n + 1); }, [focusedNodeId]);
  const venueDock = (className: string, compact = false) => venue && (
    <ViewDock
      compact={compact}
      className={className}
      view={showOutdoorMap ? 'outdoor' : indoorView}
      onView={handleDockView}
      outdoorAvailable={venueBuildings.length > 0}
      floors={building.floors.map(fl => ({ id: fl.id, name: fl.name, level: fl.level, onRoute: brainPath.some(n => n.floorId === fl.id) }))}
      floorId={currentFloor?.id ?? null}
      onFloor={setSelectedFloorId}
      cameraMode={cameraMode}
      onCamera={mode => setCameraRequest(r => ({ mode, nonce: (r?.nonce ?? 0) + 1 }))}
      hasRoute={!!currentFloorPath && brainState.routingMode !== 'outdoor'}
    />
  );
  const handleMapPointerDown = () => {
    handleMapInteraction();
    // Dragging the 2D plan (or orbiting in 3D) while walking: let them look around.
    if (venue && isLive && (indoorView === '2d' || cameraMode !== 'navigate')) setFollowPaused(true);
  };
  const backToMe = () => {
    setFollowPaused(false);
    if (indoorView === '3d') setCameraRequest(r => ({ mode: 'navigate', nonce: (r?.nonce ?? 0) + 1 }));
  };
  useEffect(() => { if (!isLive) setFollowPaused(false); }, [isLive]);
  const turnId = isLive && brainState.status !== 'arrived' ? brainState.hud.current?.id ?? null : null;
  const lastTurnRef = useRef<string | null>(null);
  useEffect(() => {
    if (turnId && lastTurnRef.current && turnId !== lastTurnRef.current) { try { navigator.vibrate?.(40); } catch { /* not supported */ } }
    lastTurnRef.current = turnId;
  }, [turnId]);

  // An address from the home page search (?lat=&lng=&name=): show it, ready to navigate to.
  const linkedOnce = useRef(false);
  useEffect(() => {
    if (linkedOnce.current || venue) return;
    linkedOnce.current = true;
    const p = new URLSearchParams(window.location.search);
    const lat = Number(p.get('lat')), lng = Number(p.get('lng'));
    if (!p.has('lat') || !Number.isFinite(lat) || !Number.isFinite(lng)) return;
    const name = p.get('name') || 'Selected place';
    handleOutdoorPlaceSelect({ id: `link-${lat},${lng}`, name, displayName: name, type: 'place', lat, lng });
  }, [venue, handleOutdoorPlaceSelect]);

  const indoorSearchPois = useMemo(() => pois.filter(p => !p.isOutdoor && p.nodeId), [pois]);
  const handlePlacePick = useCallback((poi: POI) => {
    if (!poi.isOutdoor && poi.nodeId) {
      const fl = building.floors.find(x => x.nodes.some(n => n.id === poi.nodeId));
      if (fl) setSelectedFloorId(fl.id);
      if (showOutdoorMap) { setForceOutdoorView(false); onChangeMode('indoor'); }
    }
    setSelectedPOI(poi);
  }, [building, showOutdoorMap, onChangeMode]);

  const handleDockView = useCallback((v: DockView) => {
    if (v === 'outdoor') { setForceOutdoorView(true); onChangeMode('outdoor'); return; }
    setIndoorView(v);
    if (showOutdoorMap) { setForceOutdoorView(false); onChangeMode('indoor'); }
  }, [showOutdoorMap, onChangeMode]);

  if (loading) {
    return (
      <div className="h-[100dvh] w-screen flex items-center justify-center" style={{ background: '#f0f4f0' }}>
        <div className="text-center space-y-4">
          <div className="w-16 h-16 rounded-3xl flex items-center justify-center mx-auto"
            style={{ background: 'hsl(var(--primary) / 0.1)' }}>
            <Loader2 className="h-8 w-8 animate-spin" style={{ color: 'hsl(var(--primary))' }} />
          </div>
          <div>
            <p className="text-base font-bold" style={{ color: 'hsl(var(--primary))' }}>Loading Map</p>
            <p className="text-sm text-muted-foreground mt-1">Fetching {venue?.buildings[0]?.name ?? 'Unity Park'}…</p>
          </div>
        </div>
      </div>
    );
  }

  // The phone home sheet steps aside for other UI; while it's up it carries "my location".
  const homeSheetCovered = searchFocused || qrModalOpen || manualModalOpen || layersPanelOpen || !!visiblePOI;
  const homeSheetShown = !homeSheetCovered && activeTab === 'explore'
    && !(pdrState.isNavigating || pdrState.isPaused || pdrState.isComplete);

  return (
    <div className="indoor-map h-[100dvh] w-screen bg-background font-inter text-foreground relative overflow-hidden flex flex-col lg:flex-row lg:gap-3 lg:p-3">

      {/* ── Desktop-only sidebar (hidden below lg, untouched mobile UI lives inside the map container below) ── */}
      <DesktopSidebar
        browse={venueBrowse}
        parkName={building.name || 'Unity Park'}
        buildings={allBuildings}
        buildingsLoading={loading}
        onBuildingSelect={(buildingId) => {
          setSelectedBuildingId(buildingId);
          setForceOutdoorView(false);
          onChangeMode('indoor');
        }}
        onOutdoorPlaceSelect={handleOutdoorPlaceSelect}
        onCategorySelect={(categoryId) => {
          const outdoorSelected = categoryId === 'outdoors';
          setForceOutdoorView(outdoorSelected);
          onChangeMode(outdoorSelected ? 'outdoor' : 'indoor');
        }}
        onQRScan={() => setQrModalOpen(true)}
        outdoorPois={outdoorPois}
        allPois={pois}
        onOutdoorPOISelect={handlePOINavigate}
        parkCenter={building.originLat != null && building.originLng != null
          ? { lat: building.originLat, lng: building.originLng }
          : undefined}
        gpsActive={gpsActive}
        onToggleGPS={() => gpsActive ? stopGPS() : startGPS()}
        pois={pois}
        nearbyPOIs={nearbyPOIs}
        onPOISelect={handlePlacePick}
        activeTab={activeTab}
        onTabChange={setActiveTab}
        isLive={isLive}
        isComplete={pdrState.isComplete}
        hasPath={hasPath}
        path={hasPath ? brainPath : null}
        navStateCompat={navStateCompat}
        pxPerMeter={pdrScale.pxPerMeter}
        stepCount={pdrState.stepCount}
        voiceEnabled={brainState.voiceEnabled}
        onToggleVoice={toggleVoice}
        onReset={clearAll}
        startName={startName}
        endName={endName}
        showRoute={brainState.routingMode !== 'none'}
        onEditStart={brainState.routingMode === 'outdoor' ? () => setStartingPointModalOpen(true) : undefined}
      />

      {/* ── Map + all existing (mobile-first) overlay UI — unchanged, now just nested in a flex-1 pane so it fills the remaining width next to the desktop sidebar ── */}
      {/* Desktop: the map is a rounded card beside the sidebar card. */}
      <div className="relative flex-1 h-full overflow-hidden lg:rounded-[28px] lg:border lg:border-white/70 lg:shadow-[0_18px_50px_rgba(20,50,30,.16)]">
        <HandoffCard handoff={handoff} lang={lang} onDone={() => setHandoff(null)} />

      {/* Offline banner */}
      {isOffline && (
        <div className="absolute top-0 left-0 right-0 z-50 bg-destructive text-destructive-foreground text-center py-1.5 text-xs flex items-center justify-center gap-1.5 font-semibold">
          <WifiOff className="h-3.5 w-3.5" /> Offline — using cached data
        </div>
      )}

      {venue?.notice && !isOffline && !pickingOriginOnMap && (
        <div className="absolute top-0 left-0 right-0 z-50 bg-amber-500 text-white text-center py-1.5 text-xs font-semibold">
          {venue.notice}
        </div>
      )}

      {/* Armed "tap the map to set starting point" banner */}
      {pickingOriginOnMap && (
        <div className="absolute top-0 left-0 right-0 z-50 bg-primary text-primary-foreground text-center py-1.5 text-xs flex items-center justify-center gap-2 font-semibold">
          Tap the map to set your starting point
          <button
            onClick={() => setPickingOriginOnMap(false)}
            className="underline underline-offset-2 font-bold"
          >
            Cancel
          </button>
        </div>
      )}

      {/* ── Full-screen map background ── */}
      <div className="absolute inset-0" style={{ top: offlinePad }} onPointerDownCapture={handleMapPointerDown}>
        <AnimatePresence mode="wait" initial={false}>
          {showOutdoorMap ? (
            <motion.div
              key="outdoor"
              className="absolute inset-0"
              initial={{ opacity: 0, scale: 1.03 }}
              animate={{ opacity: 1, scale: 1 }}
              exit={{ opacity: 0, scale: 0.97 }}
              transition={{ duration: 0.38, ease: 'easeInOut' }}
            >
              <VenueMapRenderer
                venueGraph={venueGraph}
                venueGraphLoading={venueGraphLoading}
                position={brainState.position}
                isWalking={pdrState.isWalking}
                pois={outdoorPois}
                nearbyPois={brainState.poi.nearby}
                destination={brainState.destination?.geo ?? null}
                routePath={brainState.outdoor?.path
                  ?.map(n => ({ lat: n.lat, lng: n.lng }))
                  .filter(p => Number.isFinite(p.lat) && Number.isFinite(p.lng)) ?? []}
                isDirect={brainState.outdoor?.isDirect ?? false}
                onRetryFetch={() => {
                  const target = brainState.destination?.geo ?? (brainState.position?.geo ?? (building.originLat != null && building.originLng != null ? { lat: building.originLat, lng: building.originLng } : undefined));
                  if (target) preloadOutdoorGraph(target);
                }}
                navigationMode={brainState.navigationMode}
                venueMode
                onPOIClick={handleOutdoorPOISelect}
                onNavigateToPOI={handlePOINavigate}
                onMapClick={pickingOriginOnMap ? handleOriginMapClick : handleOutdoorMapClick}
                registerControls={(c) => { venueMapControls.current = c; }}
                onBearingChange={setMapBearing}
                customLayers={customLayers}
                center={building.originLat != null && building.originLng != null
                  ? { lat: building.originLat, lng: building.originLng }
                  : undefined}
                mapStyleId={mapStyleId}
                pitch={is3D ? 62 : 0}
                buildings={venueBuildings}
                onEnterBuilding={handleEnterBuilding}
                imageOverlay={activeImageLayer && building.originLat != null && building.originLng != null
                  ? {
                      key: activeImageLayer.id,
                      url: activeImageLayer.dataUrl,
                      center: { lat: building.originLat, lng: building.originLng },
                      radiusM: building.radiusM ?? 60,
                    }
                  : null}
              />
            </motion.div>
          ) : (
            <motion.div
              key={currentFloor ? `indoor-${currentFloor.id}` : 'indoor-empty'}
              className="absolute inset-0"
              initial={{ opacity: 0, scale: 0.97 }}
              animate={{ opacity: 1, scale: 1 }}
              exit={{ opacity: 0, scale: 1.03 }}
              transition={{ duration: 0.38, ease: 'easeInOut' }}
            >
              {indoorFloor && venue ? (
                <IndoorVenueView
                  view={indoorView}
                  floor={indoorFloor}
                  otherFloors={otherIndoorFloors}
                  places={venue.places}
                  selectedNodeId={visiblePOI?.nodeId ?? null}
                  pinSubs={indoorPinSubs}
                  onSelect={handleIndoorSelect}
                  route={indoorRoute}
                  here={indoorHere}
                  headingPlanDeg={isLive && pdrState.isNavigating ? planAngleDeg(pdrState.headingDeg ?? 0, building.rotationDeg ?? 0) : null}
                  follow={isLive && !followPaused}
                  layers={indoorLayers}
                  wallHeight={venue.settings.wallHeightM}
                  theme={venue.theme}
                  pxPerMeter={pdrScale.pxPerMeter}
                  registerControls={registerFloorControls}
                  cameraRequest={cameraRequest}
                  focusNonce={placeFocus}
                  onCameraModeChange={setCameraMode}
                  model={indoorModel}
                  routeNodeIds={indoorRouteNodes}
                  onFloorChange={id => { if (id !== selectedFloorId) setSelectedFloorId(id); }}
                  introNonce={introNonce}
                  onZoomOutExit={building.originLat != null ? handleExitBuilding : undefined}
                />
              ) : currentFloor ? (
                <div className="relative w-full h-full">
                  <FloorMap
                    floor={currentFloor}
                    path={currentFloorPath}
                    startNodeId={startNodeId}
                    endNodeId={endNodeId}
                    onRoomClick={handleRoomClick}
                    navState={navStateCompat}
                    navSnapshot={navSnapshot}
                    pois={pois.filter(p => !p.isOutdoor)}
                    onPOIClick={setSelectedPOI}
                    nearbyPoiIds={nearbyPoiIds}
                    selectedPoiId={selectedPOI?.id ?? null}
                    registerControls={(c) => { floorMapControls.current = c; }}
                    onZoomOutExit={handleExitBuilding}
                    buildingName={building.name}
                  />
                </div>
              ) : (
                <div className="w-full h-full outdoor-map-bg" />
              )}
            </motion.div>
          )}
        </AnimatePresence>
      </div>

      {/* ── Overlay layer: top controls (mobile only — desktop has these in the sidebar) ── */}
      <div className={cn('absolute left-0 right-0 px-4 lg:hidden', searchFocused ? 'z-[60]' : 'z-10')}
        style={{ top: `calc(env(safe-area-inset-top, 0px) + ${offlinePad + 10}px)` }}>

        {/* Search bar — full width */}
        <MapSearchBar
          onQRScan={() => setQrModalOpen(true)}
          onCategorySelect={(categoryId) => {
            const outdoorSelected = categoryId === 'outdoors';
            setForceOutdoorView(outdoorSelected);
            onChangeMode(outdoorSelected ? 'outdoor' : 'indoor');
          }}
          buildings={allBuildings}
          buildingsLoading={loading}
          onBuildingSelect={(buildingId) => {
            setSelectedBuildingId(buildingId);
            setForceOutdoorView(false);
            onChangeMode('indoor');
          }}
          onOutdoorPlaceSelect={handleOutdoorPlaceSelect}
          outdoorPois={outdoorPois}
          allPois={pois}
          onOutdoorPOISelect={handlePOINavigate}
          parkName={building.name || 'Unity Park'}
          parkCenter={building.originLat != null && building.originLng != null
            ? { lat: building.originLat, lng: building.originLng }
            : undefined}
          onFocusChange={setSearchFocused}
          openSignal={searchOpenSignal}
          indoorPois={indoorSearchPois}
          onIndoorPOISelect={handlePlacePick}
          trailing={<ProfileAvatar name={profile?.full_name || profile?.email} onClick={() => setActiveTab('profile')} />}
        />
        {/* GPS starts from "My location" (on the home sheet's edge). */}
      </div>

      {/* ── Right side map controls ── */}
      <div className="absolute z-10 flex flex-col items-end gap-2"
        style={{ top: `calc(env(safe-area-inset-top, 0px) + ${offlinePad + 74}px)`, right: 16 }}>
        <MapControls
          onZoomIn={showOutdoorMap ? handleVenueZoomIn : handleFloorZoomIn}
          onZoomOut={showOutdoorMap ? handleVenueZoomOut : handleFloorZoomOut}
          onRecenter={showOutdoorMap ? handleVenueRecenter : handleFloorRecenter}
          onMyLocation={handleMyLocation}
          onOpenLayers={() => setLayersPanelOpen(v => !v)}
          showLayersPanel={layersPanelOpen}
          showDragHint={showDragHint && !navIsActive && !pdrState.isNavigating}
          onDismissHint={() => setShowDragHint(false)}
          show3DToggle={showOutdoorMap || !!venue}
          is3D={showOutdoorMap || !venue ? is3D : indoorView === '3d'}
          onToggle3D={() => (showOutdoorMap || !venue ? setIs3D(v => !v) : setIndoorView(v => (v === '3d' ? '2d' : '3d')))}
          bearing={showOutdoorMap ? mapBearing : 0}
          onResetNorth={showOutdoorMap ? handleVenueResetNorth : undefined}
          showNames={!!indoorLayers.labels}
          onToggleNames={venue && !showOutdoorMap ? () => setIndoorLayers(prev => ({ ...prev, labels: !prev.labels })) : undefined}
          phone3D={showOutdoorMap || !venue}
          phoneMyLocation={!homeSheetShown}
        />
        {/* Floor picker (indoor, several floors; venues use the view dock) — top floor first */}
        {!venue && !showOutdoorMap && brainState.environment !== 'outdoor' && building.floors.length > 1 && (
          <div className="flex flex-col gap-0.5 rounded-full bg-white p-1 font-inter shadow-[0_6px_20px_rgba(20,50,30,.14)]" role="group" aria-label="Floor">
            {[...building.floors].sort((a, b) => b.level - a.level).map(floor => (
              <button
                key={floor.id}
                onClick={() => handleFloorChange(floor.id)}
                aria-pressed={floor.id === (currentFloor?.id ?? selectedFloorId)}
                aria-label={floor.name}
                title={floor.name}
                className={cn('grid h-9 w-9 place-items-center rounded-full text-[13px] font-bold transition-colors',
                  floor.id === (currentFloor?.id ?? selectedFloorId) ? 'bg-ink text-white' : 'text-ink/70 hover:bg-ink/[.06]')}
              >
                {floorShort(floor.name, floor.level)}
              </button>
            ))}
          </div>
        )}
        {/* Debug drawer — explore page on desktop; phones and venues only with ?debug=1 */}
        <div className={cn('relative', !showDebug && (venue ? 'hidden' : 'hidden lg:block'))}>
          <DebugDrawer
            headingDeg={pdrState.headingDeg ?? 0}
            headingCardinal={
              (() => {
                const d = ((pdrState.headingDeg ?? 0) % 360 + 360) % 360;
                if (d < 22.5 || d >= 337.5) return 'North';
                if (d < 67.5)  return 'NE';
                if (d < 112.5) return 'East';
                if (d < 157.5) return 'SE';
                if (d < 202.5) return 'South';
                if (d < 247.5) return 'SW';
                if (d < 292.5) return 'West';
                return 'NW';
              })()
            }
            stepCount={pdrState.stepCount}
            isWalking={pdrState.isWalking}
            isStationary={pdrState.isStationary}
            accelVariance={pdrState.accelVariance}
            sensorMode={pdrState.sensorMode}
            confidenceSnapshot={navSnapshot.confidenceSnapshot}
            sensorPermission={pdrState.sensorPermission}
            rawEventCount={pdrState.rawEventCount}
            lastEventMsAgo={pdrState.lastEventMsAgo}
            isNavigating={pdrState.isNavigating}
            pathLength={pdrPath?.length ?? 0}
            isTestingSensors={isTestingSensors}
            onTestSensors={async () => {
              setIsTestingSensors(true);
              await testSensors();
            }}
            onStopTestSensors={() => {
              stopTestSensors();
              setIsTestingSensors(false);
            }}
          />
        </div>
      </div>

      {/* ── Map Layers bottom sheet (portal-level, above everything) ── */}
      <MapLayersPanel
        open={layersPanelOpen}
        activeLayers={activeLayers}
        onToggle={handleLayerToggle}
        onClose={() => setLayersPanelOpen(false)}
        customLayers={customLayers}
        onToggleCustomLayer={handleToggleCustomLayer}
        mapStyleId={mapStyleId}
        onMapStyleChange={setMapStyleId}
        customImageLayers={customImageLayers}
        onAddImageLayer={handleAddImageLayer}
        activeImageLayerId={activeImageLayerId}
        onSelectImageLayer={setActiveImageLayerId}
        indoorLayers={venue && !showOutdoorMap ? INDOOR_LAYERS.map(l => ({ ...l, on: indoorLayers[l.id] })) : undefined}
        onToggleIndoorLayer={id => setIndoorLayers(prev => ({ ...prev, [id]: !prev[id as IndoorLayerId] }))}
      />

      {/* ── Navigation HUD (when route active) ──
          BUG FIX: this used to require `startNodeId && endNodeId`, which
          are indoor floor-plan node ids. Outdoor navigation (POI search,
          map search, "walk here") never sets those — it routes by
          lat/lng — so the turn-by-turn HUD (which the brain computes
          correctly for both modes via InstructionEngine) never appeared
          outdoors at all. Gate on the brain's actual routing mode instead. */}
      {(brainState.routingMode !== 'none' || venue) && (
        <div className="pointer-events-none absolute z-10 flex max-w-[calc(100%-100px)] flex-col items-start gap-2"
          style={{ top: `calc(env(safe-area-inset-top, 0px) + ${offlinePad + 74}px)`, left: 16 }}>
          {brainState.routingMode !== 'none' && <div className="pointer-events-auto">
          <FloatingTopCard
            startName={startName}
            endName={endName}
            hud={brainState.hud}
            isNavigating={isLive || brainState.routingMode === 'outdoor'}
            isRerouting={brainState.rerouting}
            isFetchingRoute={brainState.routingMode === 'outdoor' && brainState.isFetchingOutdoorRoute}
            deviationSec={brainState.deviationSec}
            voiceEnabled={brainState.voiceEnabled}
            onToggleVoice={toggleVoice}
            onCancel={clearAll}
            travelMode={brainState.routingMode === 'outdoor' ? travelMode : undefined}
            onToggleTravelMode={setTravelMode}
            onEditStart={brainState.routingMode === 'outdoor' ? () => setStartingPointModalOpen(true) : undefined}
            arrived={brainState.status === 'arrived'}
            lang={lang}
            onLanguage={setLang}
            floorLabel={brainState.routingMode === 'indoor' && currentFloor && building.floors.length > 1
              ? coreFloorName({ id: currentFloor.id, name: { en: lang === 'en' ? currentFloor.name : '' }, level: currentFloor.level, order: currentFloor.level, elevation: 0, ceilingHeight: 3 }, lang)
              : null}
            walk={pdrState.isNavigating && brainState.routingMode !== 'outdoor'
              ? { steps: pdrState.stepCount, walking: pdrState.isWalking, metres: pdrState.distanceM }
              : null}
          />
          </div>}
          {/* Phones: the view dock sits under the card (below the search and GPS pill otherwise), clear of the bottom sheet. */}
          {!searchFocused && venueDock('lg:hidden', true)}
        </div>
      )}

      {/* ── "Back to me" — after looking around while walking ── */}
      <AnimatePresence>
        {venue && isLive && followPaused && !showOutdoorMap && (
          <motion.button
            initial={{ opacity: 0, y: 12, scale: 0.95 }} animate={{ opacity: 1, y: 0, scale: 1 }} exit={{ opacity: 0, y: 12 }}
            onClick={backToMe}
            className="absolute left-1/2 z-20 -translate-x-1/2 flex items-center gap-2 rounded-full bg-primary px-4 py-2.5 text-sm font-bold text-primary-foreground shadow-xl bottom-[calc(env(safe-area-inset-bottom,0px)+170px)] lg:bottom-6"
          >
            <Navigation2 className="h-4 w-4" /> Back to me
          </motion.button>
        )}
      </AnimatePresence>

      {/* ── A venue's view dock (desktop: bottom left; phones: under the top card) ── */}
      {venueDock('absolute left-3 bottom-6 z-[6] hidden lg:flex')}

      {/* ── POI Card ── */}
      <POICard
        poi={visiblePOI}
        onClose={handlePOIClose}
        onNavigate={handlePOINavigate}
        onSpeak={handlePOISpeak}
        variant={autoTriggeredPoi && !selectedPOI ? 'auto-toast' : 'modal'}
        isVisited={visiblePOI ? isVisited(visiblePOI.id) : false}
        onMarkVisited={handleMarkVisited}
        venueName={building.name}
        walk={visiblePOIWalk}
      />

      {/* ── Room-to-room Directions card ── */}
      <RoomRouteCard
        visible={showRoomRouteCard}
        fromName={startNodeId ? (roomNameByNodeId.get(startNodeId) ?? 'Start') : ''}
        toName={endNodeId ? (roomNameByNodeId.get(endNodeId) ?? 'Destination') : ''}
        timeLabel={roomRoutePreview?.estimatedTimeLabel}
        hasRoute={!!roomRoutePreview}
        crossFloor={(roomRoutePreview?.floors.length ?? 0) > 1}
        onNavigate={handleNavigate}
        onSwap={handleRoomRouteSwap}
        onClose={handleRoomRouteClose}
      />

      {/* ── Email gate — shown once when marking a place visited without an email on file ── */}
      <EmailGateDialog
        open={visitedEmailGateOpen}
        onSubmit={handleVisitedEmailGateSubmit}
        reason="mark places as visited"
        onCancel={() => { setVisitedEmailGateOpen(false); setPendingVisitPoi(null); }}
      />

      {/* ── Bottom Sheet (fixed to bottom of viewport, mobile only) ── */}
      <div className="absolute bottom-0 left-0 right-0 z-20 lg:hidden">
        <BottomSheet
          browse={venueBrowse}
          buildings={allBuildings}
          selectedBuildingId={selectedBuildingId}
          selectedFloorId={selectedFloorId}
          startNodeId={startNodeId}
          endNodeId={endNodeId}
          currentFloor={currentFloor}
          path={hasPath ? brainPath : null}
          distance={distance}
          navState={pdrState}
          navStateCompat={navStateCompat}
          navSnapshot={navSnapshot}
          onBuildingChange={handleBuildingChange}
          onFloorChange={handleFloorChange}
          onStartChange={setStartNodeId}
          onEndChange={setEndNodeId}
          onNavigate={handleNavigate}
          onClear={clearAll}
          onStartNav={handleStartWalking}
          onReset={clearAll}
          onEnableSensors={requestSensors}
          hasPath={hasPath}
          onOpenQRScanner={() => setQrModalOpen(true)}
          onOpenManualLocation={() => setManualModalOpen(true)}
          isAnchored={anchor.isAnchored}
          anchorName={anchor.anchorName}
          voiceEnabled={brainState.voiceEnabled}
          onToggleVoice={toggleVoice}
          building={building}
          pois={pois}
          nearbyPOIs={nearbyPOIs}
          onPOISelect={handlePlacePick}
          parkName={building.name || 'Unity Park'}
          activeTab={activeTab}
          onTabChange={setActiveTab}
          autoOpenRoute={!venue}
          hideExploreStrip={homeSheetCovered}
          collapseSheet={mapInteracted}
          onDirections={venue ? () => setSearchOpenSignal(n => n + 1) : undefined}
          onPOINavigate={handlePOINavigate}
          onMyLocation={handleMyLocation}
        />
      </div>

      {/* ── Modals ── */}
      <QRScannerModal open={qrModalOpen} onClose={() => setQrModalOpen(false)} onScan={handleQRScan} />
      <ManualLocationModal
        open={manualModalOpen}
        buildings={allBuildings}
        selectedBuildingId={selectedBuildingId}
        selectedFloorId={selectedFloorId}
        onClose={() => { setManualModalOpen(false); setPendingDestName(null); }}
        onConfirm={(b, fl, n) => { setPendingDestName(null); handleManualConfirm(b, fl, n); }}
        onScanQR={() => { setManualModalOpen(false); setQrModalOpen(true); }}
        destinationName={pendingDestName}
        destinationNodeId={pendingDestinationRef.current?.nodeId ?? null}
      />
      <StartingPointModal
        open={startingPointModalOpen}
        center={building.originLat != null && building.originLng != null
          ? { lat: building.originLat, lng: building.originLng }
          : { lat: brainState.position.geo?.lat ?? 0, lng: brainState.position.geo?.lng ?? 0 }}
        hasCustomOrigin={!!brainState.customOrigin}
        onClose={() => setStartingPointModalOpen(false)}
        onUseCurrentLocation={handleUseCurrentLocationAsOrigin}
        onSelectPlace={handleSelectOriginPlace}
        onPickOnMap={handlePickOriginOnMap}
      />

      {/* ── Indoor Tracking Onboarding ── */}
      <IndoorTrackingModal
        open={showOnboarding}
        onAllow={() => { requestSensors(); try { localStorage.setItem('ethi_onboarded', '1'); } catch {} setShowOnboarding(false); }}
        onSkip={() => { try { localStorage.setItem('ethi_onboarded', '1'); } catch {} setShowOnboarding(false); }}
      />

      </div>
    </div>
  );
};

export default Index;
/** A floor's one- or two-character label for the floor picker: "Ground Floor" → G, "First Floor" → 1, "Level 3" → 3. */
function floorShort(name: string, level: number): string {
  const n = name.toLowerCase();
  if (/ground|lobby/.test(n)) return 'G';
  if (/basement/.test(n)) return 'B';
  const digits = n.match(/-?\d+/);
  if (digits) return digits[0];
  const words = ['first', 'second', 'third', 'fourth', 'fifth', 'sixth', 'seventh', 'eighth', 'ninth', 'tenth'];
  const i = words.findIndex(w => n.includes(w));
  return i >= 0 ? String(i + 1) : String(level);
}
