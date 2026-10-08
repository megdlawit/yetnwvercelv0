// View Map — the visitor experience of a published venue, at /venue/:buildingId.
//
// Discover (recommendations, what's on, categories, search in everyday words),
// Explore (collections and tours), place details, and directions you can
// follow live: GPS outdoors, counted steps indoors, QR codes to set where you
// are. Walking into a place greets you once; nearby highlights are suggested.
// Shown as a 2D map, the 3D world, or the real outdoor map around the venue.
//
// Links: ?from=<place> (a QR code: "you are here"), ?place=<place> (open a place),
// ?preview=1 (the venue's team sees unpublished changes).

import { useEffect, useMemo, useRef, useState, lazy, Suspense, type CSSProperties } from 'react';
import { useNavigate, useParams, useSearchParams } from 'react-router-dom';
import { toast } from 'sonner';
import { Input } from '@/components/ui/input';
import { Search, X, MapPin, Loader2, Square, Box, Globe2, Compass, Sparkles, Home as HomeIcon, Map as MapIcon, CalendarDays } from 'lucide-react';
import { motion, AnimatePresence } from 'framer-motion';
import BottomSheet, { useIsDesktop, type Snap } from '@/components/visitor/BottomSheet';
import { cn } from '@/lib/utils';
import type { FeatureKind } from '@/lib/venue/features';
import { findRoute, directions, type RouteNode } from '@/lib/venue/routing';
import type { FloorLayer } from '@/components/venue/Venue3D';
import { CONTENT_KINDS, type ContentKind } from '@/lib/venue/places';
import { themeOf, hexToHslVar } from '@/lib/venue/themes';
import { anchorOf, lineToGeo } from '@/lib/venue/geoVenue';
import { indoorToGeo } from '@/lib/geo/GeoMath';
import { VISITOR_CATEGORIES, collections as buildCollections, metresBetween, recommend, searchVenue, walkMinutes, type VisitorCategory } from '@/lib/venue/discover';
import { useCurrentOutdoorVenue, useSiblingVenues } from '@/components/venue/useOutdoorVenues';
import { CATEGORY_COLORS, PX_PER_METER, type Place, type VisitorPosition } from '@/components/visitor/types';
import { useVisitorVenue, resolveEntry } from '@/components/visitor/useVisitorVenue';
import { useSavedPlaces } from '@/components/visitor/useSavedPlaces';
import { useGps, useStepCounter, metresTo, STRIDE_M } from '@/components/visitor/usePositioning';
import { planAngleDeg, snapToPaths, stepForward, type Segment } from '@/lib/venue/pdr';
import { useGuidance } from '@/components/visitor/useGuidance';
import { useStreetDirections } from '@/components/visitor/useStreetDirections';
import { useGeofences } from '@/components/visitor/useGeofences';
import { PlaceDetail, type DistanceOf } from '@/components/visitor/PlaceViews';
import { ContentDetail, ContentRowButton } from '@/components/visitor/ContentViews';
import { CategoryChips, CategoryList, CollectionView, DiscoverHome, ExploreView, SearchResults } from '@/components/visitor/BrowseViews';
import { DirectionsPanel, GuidanceCard } from '@/components/visitor/NavigationViews';
import { GreetingCard, LocateButtons, NearbyChip, OutsideBanner, QrScanDialog, StartSheet } from '@/components/visitor/MapOverlays';
import PlanView from '@/components/visitor/PlanView';

const Venue3D = lazy(() => import('@/components/venue/Venue3D'));
const OutdoorView = lazy(() => import('@/components/venue/OutdoorView'));
type Pos = [number, number];

export default function ViewMap() {
  const { buildingId: venueParam } = useParams<{ buildingId: string }>();
  const [params] = useSearchParams();
  const navigate = useNavigate();
  const preview = params.get('preview') === '1';

  // ── Data (shared with the home page, so arriving from its hero is instant) ──
  const venue = useVisitorVenue(venueParam, preview);
  const { state, places, placeById, floorById, roomByNode } = venue;
  const building = venue.data?.building ?? null;
  const buildingId = building?.id;
  const previewing = venue.data?.previewing ?? false;
  const floors = useMemo(() => venue.data?.floors ?? [], [venue.data]);
  const nodes = useMemo(() => venue.data?.nodes ?? [], [venue.data]);
  const edges = useMemo(() => venue.data?.edges ?? [], [venue.data]);
  const rooms = useMemo(() => venue.data?.rooms ?? [], [venue.data]);
  const walls = useMemo(() => venue.data?.walls ?? [], [venue.data]);
  const features = useMemo(() => venue.data?.features ?? [], [venue.data]);
  const content = useMemo(() => venue.data?.content ?? [], [venue.data]);
  // ?from= / ?entry= — a QR code or link that says where the visitor is (a place id or "main-entrance").
  const qrStart = useMemo(() => resolveEntry(params.get('entry') ?? params.get('from'), places), [params, places]);

  // ── View ──
  const [floorId, setFloorId] = useState<string | null>(null);
  const [mode, setMode] = useState<'2d' | '3d' | 'outdoor'>('2d');
  const [tab, setTab] = useState<'discover' | 'explore'>('discover');
  const [query, setQuery] = useState('');
  const [category, setCategory] = useState<VisitorCategory | null>(null);
  const [collectionId, setCollectionId] = useState<string | null>(null);
  const [selected, setSelected] = useState<string | null>(null);
  const [openContent, setOpenContent] = useState<string | null>(null);
  const [navigating, setNavigating] = useState(false);
  const [guiding, setGuiding] = useState(false);
  const [stepFree, setStepFree] = useState(false);
  const [fromId, setFromId] = useState<string | null>(null);
  const [scanOpen, setScanOpen] = useState(false);
  const [showStreetRoute, setShowStreetRoute] = useState(false);
  const [outsideDismissed, setOutsideDismissed] = useState(false);
  const [focus, setFocus] = useState(0);              // bump to fly the camera to the selected place
  // Phones: the bottom sheet's height. Desktop: a floating panel.
  const [snap, setSnap] = useState<Snap>('half');
  const isDesktop = useIsDesktop();
  const [startSheet, setStartSheet] = useState(false);
  const closeStartSheet = () => { setStartSheet(false); try { sessionStorage.setItem(`yetnew-start-${buildingId}`, '1'); } catch { /* private mode */ } };
  const saved = useSavedPlaces(buildingId, places, building?.name);

  // First look, once the venue is in: where the link says to start, which view, which panel.
  const [initialised, setInitialised] = useState(false);
  useEffect(() => {
    if (state !== 'ready' || !building || initialised) return;
    setInitialised(true);
    const placeParam = params.get('place');
    const view = params.get('view');
    if (qrStart) setFromId(qrStart);
    if (view === '2d' || view === '3d' || view === 'outdoor') setMode(view === 'outdoor' && !anchorOf(building) ? '3d' : view);
    // Outdoor sites placed on the world map open on the outdoor view (unless a QR code put you somewhere specific).
    else if (anchorOf(building) && building.layout === 'site' && !qrStart) setMode('outdoor');
    const focusId = qrStart ?? placeParam;
    setFloorId((focusId ? placeById.get(focusId)?.floorId : null) ?? floors[0]?.id ?? null);
    if (placeParam && placeById.has(placeParam)) {
      setSelected(placeParam); setFocus(n => n + 1);
      if (params.get('navigate') === '1' && placeById.get(placeParam)?.navigable) setNavigating(true);
    }
    if (params.get('tab') === 'explore') setTab('explore');
    const cat = params.get('category');
    if (cat && cat in VISITOR_CATEGORIES) setCategory(cat as VisitorCategory);
    if (params.get('events') === '1') setCollectionId('events');
    if (params.get('directions') === '1' && anchorOf(building)) { setMode('outdoor'); gps.start(); setShowStreetRoute(true); }
    // Phones: ask how to follow the visitor, once per visit (unless a QR code or link already said where they are).
    const touch = typeof window !== 'undefined' && window.matchMedia?.('(pointer: coarse)').matches;
    let asked = false;
    try { asked = sessionStorage.getItem(`yetnew-start-${building.id}`) === '1'; } catch { /* private mode */ }
    if (touch && !asked && !qrStart && !placeParam && params.get('directions') !== '1') setStartSheet(true);
  }, [state, building, initialised, params, qrStart, placeById, floors]); // eslint-disable-line react-hooks/exhaustive-deps -- runs once (initialised)

  const multiFloor = floors.length > 1;

  // ── Routing graph: stairs / lifts are places in such rooms, or next to such objects ──
  const routeNodes = useMemo<RouteNode[]>(() => nodes.map(n => {
    const room = roomByNode.get(n.id);
    const near = (kind: FeatureKind) => features.some(f => f.floorId === n.floorId && f.kind === kind && Math.hypot(f.x - n.x, f.y - n.y) < 2.5 * PX_PER_METER);
    return { ...n, floorName: floorById.get(n.floorId)?.name ?? '', stairs: room?.type === 'stairs' || near('stairs'), elevator: room?.type === 'elevator' || near('elevator') };
  }), [nodes, roomByNode, features, floorById]);
  // Step-free routes steer well clear of stairs (not just off them).
  const stairPenalties = useMemo(() => {
    const out: Record<string, number> = {};
    for (const n of nodes) if (features.some(f => f.floorId === n.floorId && (f.kind === 'stairs') && Math.hypot(f.x - n.x, f.y - n.y) < 5 * PX_PER_METER)) out[n.id] = 30;
    return out;
  }, [nodes, features]);

  // ── Where the visitor is ──
  const anchor = useMemo(() => (building ? anchorOf(building) : null), [building]);
  const groundId = useMemo(() => [...floors].sort((a, z) => a.level - z.level)[0]?.id ?? null, [floors]);
  const gps = useGps(anchor);
  const stepCounter = useStepCounter();

  const ground = useMemo(() => {
    if (!groundId) return null;
    const ns = nodes.filter(n => n.floorId === groundId), byId = new Map(ns.map(n => [n.id, n] as const));
    return {
      walls: walls.filter(w => w.floorId === groundId), rooms: rooms.filter(r => r.floorId === groundId),
      places: places.filter(p => p.floorId === groundId).map(p => ({ id: p.id, name: p.name, x: p.x, y: p.y })),
      paths: edges.flatMap(e => { const a = byId.get(e.fromNodeId), z = byId.get(e.toNodeId); return a && z ? [{ a, b: z }] : []; }),
    };
  }, [groundId, nodes, walls, rooms, places, edges]);
  const currentOutdoor = useCurrentOutdoorVenue(building, ground, floors.length);
  const siblings = useSiblingVenues(anchor ? building : null);
  const outdoorVenues = useMemo(() => (currentOutdoor ? [currentOutdoor, ...siblings] : []), [currentOutdoor, siblings]);
  // The venue on the earth: its centre and size, to tell "inside" from "on the way".
  const venueGeo = useMemo(() => {
    if (!currentOutdoor) return null;
    const pts = currentOutdoor.ring.slice(0, -1);
    const c = { lng: pts.reduce((s, p) => s + p[0], 0) / pts.length, lat: pts.reduce((s, p) => s + p[1], 0) / pts.length };
    const radius = Math.max(...pts.map(p => metresTo({ lat: p[1], lng: p[0], accuracy: 0, timestamp: 0 }, c) ?? 0));
    return { center: c, radius };
  }, [currentOutdoor]);
  const gpsDistance = metresTo(gps.fix, venueGeo?.center ?? null);
  const gpsInside = gpsDistance != null && venueGeo != null && gpsDistance <= venueGeo.radius + 40;
  const gpsOutside = gpsDistance != null && venueGeo != null && gpsDistance > venueGeo.radius + 80;

  const nearestNode = (x: number, y: number, fl: string) => {
    let best: string | null = null, d = Infinity;
    for (const n of nodes) if (n.floorId === fl) { const dd = Math.hypot(n.x - x, n.y - y); if (dd < d) { d = dd; best = n.id; } }
    return best;
  };

  // ── Walking with the phone (as in the original app): every counted step moves "you" one stride
  // in the compass direction, snapped onto the walking paths. GPS re-syncs it outdoors; a QR code resets it.
  const [pdr, setPdr] = useState<{ x: number; y: number; floorId: string } | null>(null);
  const segmentsByFloor = useMemo(() => {
    const byId = new Map(nodes.map(n => [n.id, n] as const)), out = new Map<string, Segment[]>();
    for (const e of edges) {
      const p = byId.get(e.fromNodeId), q = byId.get(e.toNodeId);
      if (!p || !q || p.floorId !== q.floorId) continue;
      (out.get(p.floorId) ?? out.set(p.floorId, []).get(p.floorId)!).push({ a: p, b: q });
    }
    return out;
  }, [nodes, edges]);
  const lastSteps = useRef(0);
  useEffect(() => {
    const n = stepCounter.steps - lastSteps.current;
    lastSteps.current = stepCounter.steps;
    if (n <= 0 || stepCounter.heading == null) return;
    setPdr(prev => {
      if (!prev) return prev;
      let p = { x: prev.x, y: prev.y };
      for (let i = 0; i < n; i++) p = stepForward(p, stepCounter.heading!, STRIDE_M, PX_PER_METER, anchor?.rotationDeg ?? 0);
      return { ...snapToPaths(p, segmentsByFloor.get(prev.floorId) ?? [], 3 * PX_PER_METER), floorId: prev.floorId };
    });
  }, [stepCounter.steps]); // eslint-disable-line react-hooks/exhaustive-deps
  // A good GPS fix (open sky) is better than counted steps — re-sync to it.
  useEffect(() => {
    if (gpsInside && gps.plan && groundId && (gps.fix?.accuracy ?? 99) <= 12) setPdr({ x: gps.plan.x, y: gps.plan.y, floorId: groundId });
  }, [gps.fix]); // eslint-disable-line react-hooks/exhaustive-deps

  // Default start: GPS (when inside), the QR code's place, else an entrance (an accessible one for step-free), else the first place.
  const gpsStart = gpsInside && gps.plan && groundId ? nearestNode(gps.plan.x, gps.plan.y, groundId) : null;
  const pdrStart = !gpsStart && pdr && !fromId ? nearestNode(pdr.x, pdr.y, pdr.floorId) : null;
  const entrances = places.filter(p => p.category === 'entrances');
  const accessibleEntrance = entrances.find(p => p.access.stepFree || p.access.wheelchair);
  const start = fromId ?? gpsStart ?? pdrStart ?? (stepFree ? accessibleEntrance?.id : null) ?? entrances[0]?.id ?? places[0]?.id ?? null;
  const seedPdrAt = (id: string | null) => { const p = id ? placeById.get(id) ?? nodes.find(n => n.id === id) : null; if (p) setPdr({ x: p.x, y: p.y, floorId: p.floorId }); };

  const route = useMemo(() => {
    if (!navigating || !start || !selected || start === selected) return null;
    const path = findRoute(routeNodes, edges, start, selected, { pxPerMeter: PX_PER_METER, stepFree, preferAccessible: true, penalties: stepFree ? stairPenalties : undefined });
    if (!path) return { path: null, info: null };
    return { path, info: directions(path, PX_PER_METER, placeById.get(selected)?.name ?? 'your destination', edges) };
  }, [navigating, start, selected, routeNodes, edges, stepFree, stairPenalties, placeById]);

  const gpsSensed = useMemo(() => (gpsInside && gps.plan && groundId ? { ...gps.plan, floorId: groundId } : null), [gpsInside, gps.plan?.x, gps.plan?.y, groundId]); // eslint-disable-line react-hooks/exhaustive-deps
  const guidance = useGuidance({
    path: guiding ? route?.path ?? null : null, steps: route?.info?.steps ?? [], pxPerMeter: PX_PER_METER, active: guiding,
    // Where the visitor really is: GPS, or the step-and-compass position…
    sensedPlan: gpsSensed ?? (stepCounter.heading != null ? pdr : null),
    // …or, on phones without a compass, just how far they've walked.
    walkedM: stepCounter.heading == null ? stepCounter.metres : 0,
  });
  const tracking: 'gps' | 'steps' | 'manual' = gpsSensed ? 'gps' : stepCounter.active ? 'steps' : 'manual';

  const position = useMemo<VisitorPosition | null>(() => {
    if (guiding && guidance.position) return { ...guidance.position, source: tracking === 'gps' ? 'gps' : 'steps' };
    if (gpsSensed && (gps.fix?.accuracy ?? 99) <= 25) return { ...gpsSensed, floorLevel: floorById.get(groundId!)?.level ?? 0, source: 'gps' };
    if (pdr && stepCounter.active) return { ...pdr, floorLevel: floorById.get(pdr.floorId)?.level ?? 0, source: 'steps' };
    const qrPlace = fromId ? placeById.get(fromId) : null;
    return qrPlace ? { x: qrPlace.x, y: qrPlace.y, floorId: qrPlace.floorId, floorLevel: qrPlace.floorLevel, source: 'qr' } : null;
  }, [guiding, guidance.position, tracking, gpsSensed, gps.fix, groundId, floorById, pdr, stepCounter.active, fromId, placeById]);
  // Which way the visitor faces, drawn on the plan.
  const planHeading = stepCounter.heading != null ? planAngleDeg(stepCounter.heading, anchor?.rotationDeg ?? 0) : null;

  // The map follows the visitor between floors while navigating.
  useEffect(() => { if (guiding && position && position.floorId !== floorId) setFloorId(position.floorId); }, [guiding, position?.floorId]); // eslint-disable-line react-hooks/exhaustive-deps

  const distance: DistanceOf = useMemo(() => (p: Place) => {
    if (!position) return null;
    const m = metresBetween(position, p, PX_PER_METER);
    return m < 3 ? null : { metres: m, minutes: walkMinutes(m) };
  }, [position]);

  // ── Geofenced greetings & nearby suggestions ──
  const geo = useGeofences(buildingId, places, position && position.source !== 'qr' ? position : null, fromId);
  const greetingMessage = (p: Place) => {
    const story = p.poiId ? content.find(c => c.poi_id === p.poiId && c.summary) : null;
    return story?.summary ?? p.description?.split(/(?<=[.!?])\s/)[0] ?? null;
  };

  // ── Getting here from outside ──
  const entranceGeo = useMemo(() => {
    const e = accessibleEntrance ?? entrances[0];
    if (anchor && e) { const g = indoorToGeo(anchor, e.x, e.y); return { lat: g.lat, lng: g.lng }; }
    return venueGeo?.center ?? null;
  }, [anchor, accessibleEntrance, entrances, venueGeo]);
  // Walking route along the streets — to the entrance, or to a place the visitor picked.
  const [streetTo, setStreetTo] = useState<{ lat: number; lng: number } | null>(null);
  const street = useStreetDirections(gps.fix, streetTo ?? entranceGeo, gpsOutside || (!!streetTo && !!gps.fix));

  // ── Browse ──
  const now = new Date();
  const whatsOn = useMemo(() => content.filter(c => CONTENT_KINDS[c.kind as ContentKind]?.dated && (!c.ends_at || new Date(c.ends_at) >= now)), [content]); // eslint-disable-line react-hooks/exhaustive-deps
  const recommended = useMemo(() => recommend(places, { pxPerMeter: PX_PER_METER, origin: position }), [places, position]);
  const collections = useMemo(() => buildCollections(places, content, { pxPerMeter: PX_PER_METER }), [places, content]);
  const results = useMemo(() => searchVenue(query, places, content), [query, places, content]);

  const theme = themeOf(building?.theme);
  const themeVars = useMemo<CSSProperties | undefined>(() => {
    if (document.documentElement.classList.contains('dark')) return undefined;
    const v = hexToHslVar(theme.accent);
    return { '--primary': v, '--ring': v } as CSSProperties;
  }, [theme]);

  // ── Floor data for the maps ──
  const floorData = useMemo(() => {
    const on = <T extends { floorId: string }>(xs: T[]) => xs.filter(x => x.floorId === floorId);
    const fNodes = on(nodes), ids = new Set(fNodes.map(n => n.id));
    return { walls: on(walls), rooms: on(rooms), features: on(features), nodes: fNodes, edges: edges.filter(e => ids.has(e.fromNodeId) && ids.has(e.toNodeId)) };
  }, [floorId, nodes, walls, rooms, features, edges]);
  const otherFloors = useMemo<FloorLayer[]>(() => floors.filter(f => f.id !== floorId).map(f => ({
    id: f.id, name: f.name, level: f.level,
    walls: walls.filter(w => w.floorId === f.id), rooms: rooms.filter(r => r.floorId === f.id), features: features.filter(x => x.floorId === f.id),
  })), [floors, floorId, walls, rooms, features]);
  const routeOnFloor = useMemo(() => route?.path?.filter(n => n.floorId === floorId).map(n => ({ x: n.x, y: n.y })) ?? null, [route, floorId]);

  // ── Actions ──
  const resetBrowse = () => { setOpenContent(null); setCollectionId(null); };
  const selectPlace = (id: string | null) => {
    resetBrowse();
    setSelected(id);
    // Show the place on the map: a full-height sheet drops to half, a peek opens to half.
    setSnap(s => (id && s === 'full' ? 'half' : s === 'peek' ? 'half' : s));
    if (id) setFocus(n => n + 1);   // fly the camera there and highlight it
    setNavigating(false);
    setGuiding(false);
    const p = id ? placeById.get(id) : null;
    if (p && p.floorId !== floorId) setFloorId(p.floorId);
  };
  /** "Use my location": GPS (outdoors) plus steps and compass (everywhere). Runs from a tap — iPhones ask permission. */
  const startTracking = async () => {
    if (anchor) gps.start();
    const ok = await stepCounter.start();
    if (!pdr) seedPdrAt(fromId ?? accessibleEntrance?.id ?? entrances[0]?.id ?? null);
    if (!ok && !anchor) toast.info('Motion sensors aren\'t available here — scan a QR code to show where you are.');
    return ok;
  };
  const stopTracking = () => { gps.stop(); stepCounter.stop(); };
  const startGuidance = async () => {
    setGuiding(true);
    stepCounter.reset();
    lastSteps.current = 0;
    seedPdrAt(start);
    // Count steps and read the compass (asks for motion permission on iPhone — this runs from the tap).
    if (!(gpsInside && gps.plan)) {
      const ok = await stepCounter.start();
      if (!ok) toast.info('Tap › as you walk to move through the directions.');
    }
  };
  const endGuidance = () => { setGuiding(false); window.speechSynthesis?.cancel(); };
  const onScanned = (p: { buildingId: string; nodeId: string; floorId: string }) => {
    if (p.buildingId !== buildingId) { navigate(`/venue/${p.buildingId}?from=${p.nodeId}`); return; }
    setFromId(p.nodeId);
    setFloorId(p.floorId);
    seedPdrAt(p.nodeId);   // you're exactly here now
    toast.success(`You're at ${placeById.get(p.nodeId)?.name ?? 'this spot'}`);
  };
  const enterVenue = (id: string) => {
    if (id === buildingId) { if (groundId) setFloorId(groundId); setMode('3d'); }
    else navigate(`/venue/${id}${preview ? '?preview=1' : ''}`);
  };
  const share = async (p: Place) => {
    const url = `${location.origin}/venue/${buildingId}?place=${p.id}`;
    try {
      if (navigator.share) await navigator.share({ title: p.name, text: `${p.name} at ${building?.name}`, url });
      else { await navigator.clipboard.writeText(url); toast.success('Link copied'); }
    } catch { /* cancelled */ }
  };

  // ── Render ──
  if (state === 'loading') {
    return <div className="flex h-[100dvh] items-center justify-center text-muted-foreground"><Loader2 className="mr-2 h-6 w-6 animate-spin" /> Opening the map…</div>;
  }
  if (state === 'unavailable' || !building) {
    return (
      <div className="flex h-[100dvh] flex-col items-center justify-center px-6 text-center">
        <MapPin className="mb-3 h-10 w-10 text-muted-foreground/40" />
        <h1 className="text-lg font-semibold">This venue isn't available</h1>
        <p className="mt-1 max-w-sm text-sm text-muted-foreground">It may not be published yet, or the link is wrong. Please ask staff for help.</p>
      </div>
    );
  }

  const sel = selected ? placeById.get(selected) : null;
  const item = openContent ? content.find(c => c.id === openContent) : null;
  const collection = collectionId ? collections.find(c => c.id === collectionId) : null;
  const placeOfPoi = (poiId: string | null) => (poiId ? places.find(p => p.poiId === poiId) : undefined);
  const hereOnFloor = position && position.floorId === floorId ? { x: position.x, y: position.y } : null;
  const toGeo = (x: number, y: number): Pos => { const g = indoorToGeo(anchor!, x, y); return [g.lng, g.lat]; };
  const outdoorHere: Pos | null = gps.fix ? [gps.fix.lng, gps.fix.lat] : anchor && position && position.floorId === groundId ? toGeo(position.x, position.y) : null;
  const outdoorRoute: Pos[] | null = showStreetRoute && street.directions ? street.directions.line
    : anchor && route?.path ? lineToGeo(anchor, route.path.filter(n => n.floorId === groundId)) : null;
  // The category chips switch between categories; the home view shows big category tiles instead.
  const showChips = !sel && !item && !collection && !query && tab === 'discover' && !!category;
  const viewKey = item ? `c:${item.id}` : sel && navigating ? `n:${sel.id}` : sel ? `p:${sel.id}` : collection ? `col:${collection.id}` : query.trim() ? 'search' : tab === 'explore' ? 'explore' : category ? `cat:${category}` : 'home';
  // What the panel covers, so the plan centres in the part of the map you can see.
  const mapInset = isDesktop ? { left: 420 } : { bottom: guiding ? 60 : 60 + (snap === 'peek' ? 150 : snap === 'half' ? Math.round(window.innerHeight * 0.5) : 0) };
  const pinColors = Object.fromEntries(places.map(p => [p.id, CATEGORY_COLORS[p.category]]));

  const panel = (() => {
    if (item) {
      return <ContentDetail item={item} place={placeOfPoi(item.poi_id)} stops={(item.stops ?? []).map(id => placeOfPoi(id)).filter((p): p is Place => !!p)}
        onNavigate={id => { selectPlace(id); setNavigating(true); }} onBack={() => setOpenContent(null)} onShowPlace={id => selectPlace(id)} />;
    }
    if (sel && navigating) {
      return <DirectionsPanel dest={sel} places={places} start={start} stepFree={stepFree} onStepFree={setStepFree} info={route?.info ?? null}
        startLabel={p => (p.id === gpsStart ? `Your location (GPS) — near ${p.name}` : p.id === fromId ? `You are here — ${p.name}` : p.name)}
        onStart={id => setFromId(id)} floors={floors} onPickFloor={setFloorId} onBack={() => { setNavigating(false); endGuidance(); }} onGo={startGuidance}
        problem={start === sel.id ? 'You are already here.' : stepFree ? 'No step-free route found. Try turning step-free off, or ask staff for help.' : 'No route found between these places yet.'} />;
    }
    if (sel) {
      const linked = sel.poiId ? content.filter(c => c.poi_id === sel.poiId) : [];
      return <PlaceDetail p={sel} multiFloor={multiFloor} distance={distance} hasElevator={routeNodes.some(n => n.elevator)}
        onBack={() => setSelected(null)} onNavigate={() => setNavigating(true)} onShare={() => share(sel)}
        onExplore={() => { setFocus(n => n + 1); if (mode === 'outdoor') setMode('3d'); setSnap('peek'); }}
        saved={saved.has(sel.id)} onSave={() => toast.success(saved.toggle(sel) ? `Saved ${sel.name}` : 'Removed from saved')}
        onStreetDirections={anchor && sel.gps ? () => { setStreetTo(sel.gps); gps.start(); setShowStreetRoute(true); setMode('outdoor'); setSnap('peek'); } : undefined}
        stories={linked.length ? <div className="space-y-1.5">{linked.map(c => <ContentRowButton key={c.id} c={c} onOpen={() => setOpenContent(c.id)} />)}</div> : null} />;
    }
    if (collection) {
      return <CollectionView collection={collection} places={places} content={content} onBack={() => setCollectionId(null)}
        onPlace={id => selectPlace(id)} onContent={setOpenContent} distance={distance} multiFloor={multiFloor} />;
    }
    if (query.trim()) {
      return <SearchResults query={query} places={results.places} content={results.content} onPlace={id => selectPlace(id)} onContent={setOpenContent} distance={distance} multiFloor={multiFloor} />;
    }
    if (tab === 'explore') return <ExploreView collections={collections} onOpen={setCollectionId} />;
    if (category) return <CategoryList category={category} places={places} onPlace={id => selectPlace(id)} distance={distance} multiFloor={multiFloor} />;
    return <DiscoverHome recommended={recommended} whatsOn={whatsOn} collections={collections} places={places}
      saved={saved.ids.map(id => placeById.get(id)).filter((p): p is Place => !!p)}
      onPlace={id => selectPlace(id)} onContent={setOpenContent} onCollection={setCollectionId} onCategory={setCategory} distance={distance} multiFloor={multiFloor} />;
  })();

  // ── The panel (floating card on desktop, bottom sheet on phones) ──
  const panelHeader = (
    <div className="space-y-3 px-4 pb-3 md:pt-4">
      <div className="flex items-center justify-between gap-2">
        <div className="flex min-w-0 items-center gap-2.5">
          <span className="grid h-10 w-10 shrink-0 place-items-center rounded-2xl text-white shadow-md" style={{ background: `linear-gradient(135deg, ${theme.primary}, ${theme.route})` }}>
            <MapIcon className="h-5 w-5" />
          </span>
          <div className="min-w-0">
            <h1 className="truncate text-base font-bold leading-tight">{building.name}</h1>
            <p className="truncate text-[11px] text-muted-foreground">
              {!building.is_published ? <span className="text-amber-600">Preview — not published yet</span>
                : previewing ? <span className="text-amber-600">Preview — includes unpublished changes</span>
                : `${places.length} places${whatsOn.length ? ` · ${whatsOn.length} on today` : ''}`}
            </p>
          </div>
        </div>
        {!sel && !item && !collection && (
          <div className="flex shrink-0 rounded-full bg-muted p-0.5 text-xs font-semibold" role="tablist">
            {([['discover', Sparkles, 'Discover'], ['explore', Compass, 'Explore']] as const).map(([id, Icon, label]) => (
              <button key={id} role="tab" aria-selected={tab === id} onClick={() => { setTab(id); setCategory(null); }}
                className={cn('flex items-center gap-1 rounded-full px-2.5 py-1.5 transition-all', tab === id ? 'bg-card shadow-sm' : 'text-muted-foreground')}>
                <Icon className="h-3.5 w-3.5" /> {label}
              </button>
            ))}
          </div>
        )}
      </div>
      <div className="relative">
        <Search className="absolute left-4 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
        <Input value={query} onFocus={() => !isDesktop && setSnap('full')} onChange={e => { setQuery(e.target.value); setSelected(null); setNavigating(false); resetBrowse(); }}
          placeholder="Search places, events… e.g. toilet, coffee" className="h-11 rounded-2xl border-transparent bg-muted/70 pl-10 pr-10 text-sm shadow-inner focus-visible:bg-card" aria-label="Search this venue" />
        {query && <button onClick={() => setQuery('')} className="absolute right-3 top-1/2 -translate-y-1/2 rounded-full p-1 hover:bg-muted" aria-label="Clear search"><X className="h-4 w-4 text-muted-foreground" /></button>}
      </div>
      {showChips && <CategoryChips places={places} active={category} onPick={setCategory} />}
    </div>
  );
  const panelBody = (
    <AnimatePresence mode="wait" initial={false}>
      <motion.div key={viewKey} initial={{ opacity: 0, x: 18 }} animate={{ opacity: 1, x: 0 }} exit={{ opacity: 0, x: -18 }} transition={{ duration: 0.18, ease: 'easeOut' }}>
        {panel}
      </motion.div>
    </AnimatePresence>
  );
  const glass = 'border border-white/50 bg-card/85 shadow-xl backdrop-blur-xl dark:border-white/10';

  return (
    <div className="relative h-[100dvh] overflow-hidden bg-background text-foreground" style={themeVars}>
      {/* ── The map fills the screen ── */}
      <main className="absolute inset-0">
        {mode === 'outdoor' && outdoorVenues.length ? (
          <Suspense fallback={<div className="flex h-full items-center justify-center text-sm text-muted-foreground"><Loader2 className="mr-2 h-5 w-5 animate-spin" /> Loading the outdoor map…</div>}>
            <OutdoorView venues={outdoorVenues} theme={theme} selectedPlaceId={selected} onSelectPlace={id => selectPlace(id)}
              onEnterVenue={enterVenue} route={outdoorRoute} here={outdoorHere} className="h-full" defaultTerrain={building.layout === 'site'} />
          </Suspense>
        ) : mode === '3d' ? (
          <Suspense fallback={<div className="flex h-full items-center justify-center text-sm text-muted-foreground"><Loader2 className="mr-2 h-5 w-5 animate-spin" /> Building 3D world…</div>}>
            <Venue3D walls={floorData.walls} rooms={floorData.rooms} nodes={floorData.nodes} edges={floorData.edges} features={floorData.features}
              level={floorById.get(floorId ?? '')?.level ?? 0} otherFloors={otherFloors} pinColors={pinColors} chrome="minimal"
              selectedNodeId={selected} onSelectNode={id => id && selectPlace(id)} pxPerMeter={PX_PER_METER} focusNonce={focus}
              route={routeOnFloor && routeOnFloor.length > 1 ? routeOnFloor : null} showPaths={false} theme={theme} here={hereOnFloor} />
          </Suspense>
        ) : (
          <PlanView floorId={floorId} data={floorData} selected={selected} start={start} route={routeOnFloor}
            onSelect={id => selectPlace(id)} places={places} here={hereOnFloor} follow={guiding || (!!position && position.source !== 'qr')} heading={planHeading}
            focus={sel && sel.floorId === floorId ? { x: sel.x, y: sel.y, nonce: focus } : null} inset={mapInset} />
        )}
      </main>

      {/* ── Top left: home, and where you are / what's near ── */}
      <div className="pointer-events-none absolute left-3 top-3 z-20 flex max-w-[calc(100%-7.5rem)] flex-col items-start gap-2 md:left-[436px]">
        <div className="flex items-center gap-2">
          <button onClick={() => navigate(`/visit?v=${buildingId}`)} className={cn('pointer-events-auto grid h-10 w-10 place-items-center rounded-2xl', glass)} aria-label="Venue home">
            <HomeIcon className="h-[18px] w-[18px]" />
          </button>
          {position && !guiding && (
            <div className={cn('pointer-events-auto flex items-center gap-1.5 rounded-full px-3 py-2 text-xs font-medium', glass)}>
              <span className="relative flex h-2.5 w-2.5"><span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-sky-400 opacity-60" /><span className="relative inline-flex h-2.5 w-2.5 rounded-full bg-sky-500" /></span>
              {position.source === 'gps' ? 'Following your location' : position.source === 'steps' ? `Following your steps${stepCounter.steps ? ` · ${stepCounter.steps} steps` : ''}` : `You are at ${fromId ? placeById.get(fromId)?.name : 'this spot'}`}
            </div>
          )}
        </div>
        {geo.nearby && !guiding && !sel && (
          <NearbyChip name={geo.nearby.place.name} minutes={geo.nearby.minutes}
            onOpen={() => selectPlace(geo.nearby!.place.id)} onDismiss={() => geo.dismissNearby(geo.nearby!.place.id)} />
        )}
      </div>

      {/* ── Top right: view, floors, locate ── */}
      <div className="pointer-events-none absolute right-3 top-3 z-20 flex flex-col items-end gap-2">
        <div className={cn('pointer-events-auto flex rounded-full p-1', glass)}>
          {([...(outdoorVenues.length ? [['outdoor', Globe2, 'Outdoor'] as const] : []), ['2d', Square, '2D'] as const, ['3d', Box, '3D'] as const]).map(([id, Icon, label]) => (
            <button key={id} onClick={() => setMode(id)} aria-pressed={mode === id}
              className={cn('relative flex items-center gap-1 rounded-full px-3 py-1.5 text-xs font-semibold transition-colors', mode === id ? 'text-primary-foreground' : 'text-muted-foreground hover:text-foreground')}>
              {mode === id && <motion.span layoutId="view-pill" className="absolute inset-0 rounded-full bg-primary shadow" transition={{ type: 'spring', stiffness: 500, damping: 35 }} />}
              <span className="relative flex items-center gap-1"><Icon className="h-3.5 w-3.5" /> <span className="hidden sm:inline">{label}</span><span className="sm:hidden">{id === 'outdoor' ? 'Out' : label}</span></span>
            </button>
          ))}
        </div>
        {multiFloor && mode !== 'outdoor' && (
          <div className={cn('pointer-events-auto flex flex-col rounded-2xl p-1', glass)} role="group" aria-label="Floor">
            {[...floors].reverse().map(f => {
              const onRoute = route?.path?.some(n => n.floorId === f.id);
              return (
                <button key={f.id} onClick={() => setFloorId(f.id)} aria-pressed={f.id === floorId} title={f.name}
                  className={cn('relative min-w-10 rounded-xl px-2.5 py-1.5 text-xs font-bold transition-colors', f.id === floorId ? 'bg-primary text-primary-foreground shadow' : 'text-muted-foreground hover:bg-muted')}>
                  {f.level}
                  {onRoute && f.id !== floorId && <span className="absolute right-1 top-1 h-1.5 w-1.5 rounded-full bg-sky-500" />}
                </button>
              );
            })}
          </div>
        )}
        {mode !== 'outdoor' && (
          <LocateButtons tracking={gps.active || stepCounter.active} gpsStatus={gps.status} onScan={() => setScanOpen(true)}
            onLocate={() => (gps.active || stepCounter.active ? stopTracking() : startTracking())} />
        )}
      </div>

      {/* ── Messages over the map ── */}
      {geo.greeting && !(guiding && geo.greeting.id === selected) && (
        <GreetingCard place={geo.greeting} message={greetingMessage(geo.greeting)} onClose={geo.dismissGreeting} placement={guiding ? 'opposite' : 'top'}
          onOpen={() => { const id = geo.greeting!.id; geo.dismissGreeting(); selectPlace(id); }} />
      )}
      {gpsOutside && !outsideDismissed && !guiding && entranceGeo && (
        <OutsideBanner venueName={building.name} metres={gpsDistance!} minutes={street.directions?.minutes ?? null} loading={street.loading}
          approximate={!!street.directions?.approximate} onClose={() => setOutsideDismissed(true)}
          onShow={() => { setShowStreetRoute(true); setMode('outdoor'); setOutsideDismissed(true); }} />
      )}
      {guiding && route?.info && sel && (
        <GuidanceCard steps={route.info.steps} stepIndex={guidance.stepIndex} remainingM={guidance.remainingM} totalM={guidance.total}
          arrived={guidance.arrived} destName={sel.name} tracking={tracking} voice={guidance.voice} onVoice={guidance.setVoice}
          onNext={guidance.next} onBack={guidance.back} onEnd={endGuidance} onRecalibrate={() => setScanOpen(true)}
          onTrack={() => startTracking()} offRoute={(guidance.offRouteM ?? 0) > 15}
          walked={stepCounter.active ? { steps: stepCounter.steps, metres: stepCounter.metres } : null} />
      )}

      {/* ── The panel ── */}
      {isDesktop ? (
        <motion.aside initial={{ opacity: 0, x: -24 }} animate={{ opacity: 1, x: 0 }} transition={{ duration: 0.35, ease: 'easeOut' }}
          className="absolute bottom-4 left-4 top-4 z-30 flex w-[404px] flex-col overflow-hidden rounded-[28px] border border-white/60 bg-card/90 shadow-2xl backdrop-blur-xl dark:border-white/10">
          <div className="shrink-0 border-b border-border/60">{panelHeader}</div>
          <div className="min-h-0 flex-1 overflow-y-auto">{panelBody}</div>
        </motion.aside>
      ) : !guiding && (
        <BottomSheet snap={snap} onSnap={setSnap} header={panelHeader} bottomOffset={60}>{panelBody}</BottomSheet>
      )}

      {/* ── Phone navigation ── */}
      {!isDesktop && (
        <nav className="fixed inset-x-0 bottom-0 z-40 grid h-[60px] grid-cols-4 border-t border-border/60 bg-card/95 pb-[env(safe-area-inset-bottom)] backdrop-blur-xl" aria-label="Visitor">
          {([
            ['home', HomeIcon, 'Home', () => navigate(`/visit?v=${buildingId}`)],
            ['map', MapIcon, 'Map', () => { selectPlace(null); endGuidance(); setSnap('peek'); }],
            ['explore', Compass, 'Explore', () => { selectPlace(null); setQuery(''); setTab('explore'); setSnap('half'); }],
            ['events', CalendarDays, 'Events', () => { selectPlace(null); setQuery(''); setCollectionId('events'); setSnap('half'); }],
          ] as const).map(([id, Icon, label, go]) => {
            const active = id === 'map' ? snap === 'peek' : id === 'explore' ? tab === 'explore' && snap !== 'peek' && !collection : id === 'events' ? collectionId === 'events' : false;
            return (
              <button key={id} onClick={go} className={cn('relative flex flex-col items-center justify-center gap-0.5 text-[11px] font-semibold transition-colors', active ? 'text-primary' : 'text-muted-foreground')}>
                {active && <motion.span layoutId="nav-dot" className="absolute top-1 h-1 w-6 rounded-full bg-primary" />}
                <Icon className="h-5 w-5" /> {label}
              </button>
            );
          })}
        </nav>
      )}

      <QrScanDialog open={scanOpen} onOpenChange={setScanOpen} onResult={onScanned} />
      {startSheet && (
        <StartSheet venueName={building.name} entranceName={(accessibleEntrance ?? entrances[0])?.name ?? null}
          onLocate={() => { closeStartSheet(); startTracking().then(ok => ok && toast.success('Following you — walk and watch the blue dot')); }}
          onScan={() => { closeStartSheet(); setScanOpen(true); }}
          onEntrance={() => { const e = accessibleEntrance ?? entrances[0]; closeStartSheet(); if (e) { setFromId(e.id); setFloorId(e.floorId); seedPdrAt(e.id); } }}
          onBrowse={closeStartSheet} />
      )}
    </div>
  );
}
